require('cross-fetch/polyfill');

'use strict';
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken'); 
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const bcrypt = require('bcryptjs'); 

// --- Initializations ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const config = { channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN, channelSecret: process.env.CHANNEL_SECRET };
const client = new line.Client(config);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
const TOTAL_ROOMS = 5;

const app = express();

// --- Middleware & Routes ---
app.use(express.static('public'));
app.post('/webhook', line.middleware(config), (req, res) => { Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result)).catch((err) => { console.error("Webhook Error:", err); res.status(500).end(); }); });
app.use(express.json());

// --- Staff API Routes ---
app.post('/api/staff-register', async (req, res) => {
    try {
        const { displayName, username, password, orgSecret } = req.body;
        if (!displayName || !username || !password || !orgSecret) { return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' }); }
        if (orgSecret !== process.env.ORGANIZATION_SECRET) { return res.status(403).json({ success: false, message: 'รหัสลับองค์กรไม่ถูกต้อง' }); }
        const existingStaff = await db.collection('staffs').where('username', '==', username).get();
        if (!existingStaff.empty) { return res.status(409).json({ success: false, message: 'Username นี้มีผู้ใช้งานแล้ว' }); }
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('staffs').add({ username, password: hashedPassword, displayName, role: 'Staff', registeredAt: new Date() });
        res.status(201).json({ success: true, message: 'สมัครสมาชิกสำเร็จ!' });
    } catch (error) {
        console.error("Staff Registration Error:", error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

app.post('/api/staff-login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) { return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' }); }
        const staffQuery = await db.collection('staffs').where('username', '==', username).limit(1).get();
        if (staffQuery.empty) { return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' }); }
        const staffDoc = staffQuery.docs[0];
        const staffData = staffDoc.data();
        const isPasswordMatch = await bcrypt.compare(password, staffData.password);
        if (!isPasswordMatch) { return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' }); }
        const staffToken = jwt.sign({ staffId: staffDoc.id, staffName: staffData.displayName }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, message: 'ล็อกอินสำเร็จ!', token: staffToken, staffName: staffData.displayName });
    } catch (error) {
        console.error("Staff Login Error:", error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' });
    }
});

// Endpoint สร้างภาพ QR Code
app.get('/generate-qr', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) { return res.status(400).send('Token is required'); }
    const qrCodeBuffer = await QRCode.toBuffer(token);
    res.set('Content-Type', 'image/png');
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error("QR Generation Error:", error);
    res.status(500).send('Error generating QR code');
  }
});

// Endpoint ตรวจสอบ QR Code
app.post('/api/verify-check-in', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) { return res.status(403).json({ success: false, message: 'ไม่ได้รับอนุญาต (No staff token)' }); }
        const staffToken = authHeader.split(' ')[1];
        const staffDecoded = jwt.verify(staffToken, process.env.JWT_SECRET);
        const staffName = staffDecoded.staffName;

        const { token } = req.body;
        if (!token) { return res.status(400).json({ success: false, message: 'ไม่พบ Token ของผู้ใช้' }); }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.uid;
        const displayName = decoded.name;
        const checkinEventRef = db.collection('checkin_events').doc();
        await checkinEventRef.set({ userId, displayName, status: 'CHECKED_IN', checkInTime: new Date(), scannedBy: staffName });
        res.json({ success: true, message: `เช็คอินสำเร็จ!\nผู้ใช้: ${displayName}` });
    } catch (error) {
        if (error.name === 'TokenExpiredError') { res.status(401).json({ success: false, message: 'QR Code หมดอายุแล้ว!' }); }
        else if (error.name === 'JsonWebTokenError') { res.status(401).json({ success: false, message: 'QR Code ไม่ถูกต้อง!' }); }
        else { console.error("Verify Check-in Error:", error); res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' }); }
    }
});

// --- ** API Endpoint ใหม่สำหรับจัดการการยินยอมจากหน้าเว็บ ** ---
app.get('/api/consent-response', async (req, res) => {
    try {
        const { choice, token } = req.query;
        if (!token || !choice) {
            return res.status(400).send('Missing required parameters.');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.uid;
        const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;

        if (choice === 'agree') {
            await db.collection('users').doc(userId).set({ consentGiven: true, consentTimestamp: new Date() }, { merge: true });
            
            // ใช้ Push Message ส่งข้อความกลับไปใน LINE เพื่อขอเบอร์โทร
            await client.pushMessage(userId, {
                type: 'text',
                text: 'ขอบคุณที่ยินยอมครับ ขั้นตอนต่อไป กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักของท่านเพื่อใช้ในการลงทะเบียนครับ (ตัวอย่าง: 0812345678)'
            });
            // ส่งผู้ใช้ไปยังหน้า "สำเร็จ"
            res.redirect(`${projectUrl}/consent_success.html`);

        } else if (choice === 'disagree') {
            await client.pushMessage(userId, {
                type: 'text',
                text: 'ท่านได้ปฏิเสธการให้ข้อมูล ทางเราจึงไม่สามารถดำเนินการลงทะเบียนให้ท่านได้ ขออภัยในความไม่สะดวกครับ'
            });
             // ส่งผู้ใช้ไปยังหน้า "ปฏิเสธ"
            res.redirect(`${projectUrl}/consent_declined.html`);
        } else {
            res.status(400).send('Invalid choice.');
        }

    } catch (error) {
        console.error("Consent Response Error:", error);
        res.status(500).send('An error occurred.');
    }
});


// --- Event Handler (แก้ไข Logic การลงทะเบียน) ---
async function handleEvent(event) {
    
    if (lowerCaseMessage === 'bugo') {
    const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
    const bugoTrackerUrl = `${projectUrl}/bugo.html`;

    return client.replyMessage(event.replyToken, {
        type: 'flex',
        altText: 'เปิดระบบติดตามรถกอล์ฟ Bugo',
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: 'Bugo Tracker', weight: 'bold', size: 'xl' },
                    { type: 'text', text: 'ระบบติดตามตำแหน่งรถกอล์ฟแบบ Real-time แตะปุ่มด้านล่างเพื่อเปิดแผนที่ครับ', wrap: true, margin: 'md' }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [{
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: { type: 'uri', label: 'เปิดแผนที่ติดตาม', uri: bugoTrackerUrl }
                }]
            }
        }
    });
}
  
  
    // ** ลบส่วนจัดการ postback ออก เพราะไม่ได้ใช้แล้ว **
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    const lowerCaseMessage = messageText.toLowerCase();

    try {
        // --- จัดการการพิมพ์เบอร์โทร ---
        const phoneRegex = /^0\d{9}$/;
        if (phoneRegex.test(messageText)) {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            if (doc.exists && doc.data().consentGiven && !doc.data().phoneNumber) {
                const profile = await client.getProfile(userId);
                await userRef.set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl, phoneNumber: messageText, registeredAt: new Date() }, { merge: true });
                return client.replyMessage(event.replyToken, { type: 'text', text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName} (เบอร์โทร: ${messageText})` });
            }
        }

        // --- จัดการคำสั่งพิเศษ ---
        if (lowerCaseMessage === '/help') { return Promise.resolve(null); }
        
        // --- คำสั่ง: ลงทะเบียน (Logic ใหม่: ส่งไปหน้าเว็บ) ---
        if (lowerCaseMessage === 'ลงทะเบียน') {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            if (doc.exists && doc.data().phoneNumber) {
                return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้เรียบร้อยแล้วครับ' });
            }

            // สร้าง Token สำหรับหน้าเว็บยินยอม มีอายุ 15 นาที
            const consentToken = jwt.sign({ uid: userId, purpose: 'consent' }, process.env.JWT_SECRET, { expiresIn: '15m' });
            const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
            const consentUrl = `${projectUrl}/consent.html?token=${consentToken}`;

            // ส่งข้อความพร้อมปุ่มไปยังหน้า Landing Page
            return client.replyMessage(event.replyToken, {
                type: 'flex',
                altText: 'กรุณาอ่านและยินยอมข้อตกลงเพื่อดำเนินการต่อ',
                contents: {
                    type: 'bubble',
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            { type: 'text', text: 'ขั้นตอนการลงทะเบียน', weight: 'bold', size: 'xl' },
                            { type: 'text', text: 'เพื่อดำเนินการต่อ กรุณาอ่านและให้ความยินยอมในข้อตกลงและเงื่อนไขการให้บริการของเราก่อนครับ', wrap: true, margin: 'md'}
                        ]
                    },
                    footer: {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{
                            type: 'button',
                            style: 'primary',
                            height: 'sm',
                            action: { type: 'uri', label: 'อ่านข้อตกลงและเงื่อนไข', uri: consentUrl }
                        }]
                    }
                }
            });
        }

        // --- (โค้ดคำสั่งอื่นๆ และ AI ทั้งหมดเหมือนเดิม) ---
        
        // คำสั่ง: เช็คอิน
        if (lowerCaseMessage === 'เช็คอิน') {
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            if (!userDoc.exists || !userDoc.data().phoneNumber) { return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณา "ลงทะเบียน" ให้เสร็จสิ้นก่อนทำการเช็คอินครับ' }); }
            const payload = { uid: userId, name: userDoc.data().displayName, iat: Math.floor(Date.now() / 1000) };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
            const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
            const qrImageUrl = `${projectUrl}/generate-qr?token=${token}`;
            return client.replyMessage(event.replyToken, [
                { type: 'text', text: `นี่คือ QR Code ประจำตัวของคุณ ${userDoc.data().displayName} ครับ\n\nใช้สำหรับยืนยันตัวตน, เข้าร่วมกิจกรรม, หรือสะสมแต้ม QR Code นี้มีอายุ 5 นาทีครับ`},
                { type: 'image', originalContentUrl: qrImageUrl, previewImageUrl: qrImageUrl }
            ]);
        }

        // คำสั่ง: จองคิว
        if (lowerCaseMessage === 'จองคิว') {
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            if (!userDoc.exists || !userDoc.data().phoneNumber) { return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาพิมพ์ "ลงทะเบียน" ให้เสร็จสิ้นก่อนทำการจองคิวครับ' }); }
            const existingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', 'in', ['WAITING', 'SERVING']).get();
            if (!existingQueueSnapshot.empty) { const queueData = existingQueueSnapshot.docs[0].data(); return client.replyMessage(event.replyToken, { type: 'text', text: `คุณมีคิวอยู่แล้วครับ\nสถานะ: ${queueData.status === 'SERVING' ? 'กำลังใช้บริการห้อง ' + queueData.roomNumber : 'กำลังรอคิวที่ ' + queueData.queueNumber}` }); }
            const servingSnapshot = await db.collection('queues').where('status', '==', 'SERVING').get();
            if (servingSnapshot.size < TOTAL_ROOMS) {
                let assignedRoom = 0;
                for (let i = 1; i <= TOTAL_ROOMS; i++) { if (!servingSnapshot.docs.map(doc => doc.data().roomNumber).includes(i)) { assignedRoom = i; break; } }
                await db.collection('queues').add({ lineUserId: userId, displayName: userDoc.data().displayName, status: 'SERVING', checkInTime: new Date(), roomNumber: assignedRoom });
                return client.replyMessage(event.replyToken, { type: 'text', text: `ถึงคิวของคุณแล้ว! เชิญที่ห้องหมายเลข ${assignedRoom} ได้เลยครับ` });
            } else {
                const allQueuesSnapshot = await db.collection('queues').get();
                const newQueueNumber = allQueuesSnapshot.size + 1;
                await db.collection('queues').add({ lineUserId: userId, displayName: userDoc.data().displayName, queueNumber: newQueueNumber, status: 'WAITING', checkInTime: new Date() });
                return client.replyMessage(event.replyToken, { type: 'text', text: `เช็คอินสำเร็จ! คุณได้รับคิวที่ ${newQueueNumber} นะครับ\nตอนนี้ห้องเต็ม กรุณารอสักครู่` });
            }
        }

        // คำสั่ง: เสร็จสิ้น
        if (lowerCaseMessage === 'เสร็จสิ้น') {
            const servingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'SERVING').limit(1).get();
            if (servingQueueSnapshot.empty) { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณยังไม่ได้เข้าใช้บริการเลยครับผม' }); }
            const queueDoc = servingQueueSnapshot.docs[0];
            const finishedRoomNumber = queueDoc.data().roomNumber;
            await queueDoc.ref.update({ status: 'FINISHED', finishTime: new Date() });
            await client.replyMessage(event.replyToken, { type: 'text', text: `ขอบคุณที่ใช้บริการครับ! (ออกจากห้อง ${finishedRoomNumber})` });
            return callNextUser(finishedRoomNumber);
        }
        
        // คำสั่ง: สถานะ
        if (lowerCaseMessage === 'สถานะ' || lowerCaseMessage === 'คิว') {
            const servingSnapshot = await db.collection('queues').where('status', '==', 'SERVING').orderBy('checkInTime').get();
            const waitingSnapshot = await db.collection('queues').where('status', '==', 'WAITING').orderBy('queueNumber').get();
            let servingText = servingSnapshot.empty ? 'ตอนนี้ทุกห้องว่างครับ!' : 'ห้องที่กำลังมีคนใช้:\n' + servingSnapshot.docs.map(doc => `- ห้อง ${doc.data().roomNumber} (คุณ ${doc.data().displayName})`).join('\n');
            let waitingText = waitingSnapshot.empty ? '\nไม่มีคิวรอเลยครับ' : '\n\nคิวที่กำลังรอ:\n' + waitingSnapshot.docs.map(doc => `- คิวที่ ${doc.data().queueNumber} (คุณ ${doc.data().displayName})`).join('\n');
            return client.replyMessage(event.replyToken, { type: 'text', text: servingText + waitingText });
        }

        // --- สมองส่วนที่ 2: ถ้าไม่ใช่คำสั่งพิเศษ ให้ส่งไปให้ AI ---
        const prompt = `
          คุณคือ 'DIVA' ผู้ช่วย AI อัจฉริยะใน BURSAI-CHAT-PLATFORM บุคลิกของคุณคือความเป็นมิตร สุภาพ ตลก และใช้คำลงท้ายว่า "ครับ"
  หน้าที่หลักของคุณคือการพูดคุยทั่วไปและตอบคำถามต่างๆ ของผู้ใช้

  สิ่งสำคัญที่ต้องรู้:
  1. บอทนี้มีความสามารถหลักๆ คือ "ลงทะเบียน", "จองคิว" (สำหรับเข้าห้อง), และ "เช็คอิน" (สำหรับยืนยันตัวตนทั่วไป)
  2. "จองคิว" ใช้สำหรับจองคิวเพื่อเข้าใช้บริการห้อง/พื้นที่ และเมื่อถึงคิวจะมีการแจ้งเตือน
  3. "เช็คอิน" ใช้สำหรับสร้าง QR Code เพื่อยืนยันตัวตน ณ จุดบริการ, เข้าร่วมกิจกรรม, หรือสะสมแต้ม
  4. ถ้าผู้ใช้ต้องการทำอะไรที่เกี่ยวกับคิวหรือห้อง ให้แนะนำให้พิมพ์ "จองคิว" หรือ "สถานะ"
  5. ถ้าผู้ใช้ต้องการ QR Code เพื่อยืนยันตัวตน ให้แนะนำให้พิมพ์ "เช็คอิน"
  6. ถ้าผู้ใช้ถามเกี่ยวกับการสมัครสมาชิก ให้แนะนำให้พิมพ์ "ลงทะเบียน"
  7. ถ้าผู้ใช้ถามเรื่องการออกจากห้อง หรือใช้เสร็จแล้ว ให้แนะนำให้พิมพ์ "เสร็จสิ้น"
  8. สำหรับคำถามอื่นๆ ทั้งหมด ให้คุณตอบอย่างเป็นธรรมชาติในฐานะ 'DIVA' , คุณเป็นผู้ชาย, คุณขี้เล่นและสุภาพ
  9. ข้อความที่คุณพิมพ์หาผู้ใช้มีความยาว 1 - 2 ประโยคพอ

  คำถามจากผู้ใช้: "${messageText}"
`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiReply = response.text();
        return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });

    } catch (error) {
        console.error("An error occurred:", error);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ' });
    }
}

// ** ไม่ต้องใช้ฟังก์ชัน createConsentBubble แล้ว สามารถลบทิ้งได้ **

// --- ฟังก์ชันสำหรับเรียกคิวถัดไป ---
async function callNextUser(freedRoomNumber) {
    const nextUserSnapshot = await db.collection('queues').where('status', '==', 'WAITING').orderBy('queueNumber').limit(1).get();
    if (nextUserSnapshot.empty) {
        console.log(`Room ${freedRoomNumber} is now free. No users in waiting queue.`);
        return Promise.resolve(null);
    }
    const nextUserDoc = nextUserSnapshot.docs[0];
    const nextUserData = nextUserDoc.data();
    await nextUserDoc.ref.update({ status: 'SERVING', roomNumber: freedRoomNumber });
    const notificationMessage = { type: 'text', text: `ถึงคิวของคุณ ${nextUserData.displayName} แล้วครับ! (คิวที่ ${nextUserData.queueNumber})\nเชิญที่ห้องหมายเลข ${freedRoomNumber} ได้เลย` };
    console.log(`Calling user ${nextUserData.displayName} (Queue: ${nextUserData.queueNumber}) to Room ${freedRoomNumber}`);
    return client.pushMessage(nextUserData.lineUserId, notificationMessage);
}// --- ** Bugo - Golf Cart Simulator ** ---

// 1. กำหนดจุดจอดรถ (Bus Stops) เป็นพิกัด Lat/Lng
const busStops = [
    { name: "หน้าอาคาร A", location: new admin.firestore.GeoPoint(13.7580, 100.5018) },
    { name: "โรงอาหารกลาง", location: new admin.firestore.GeoPoint(13.7565, 100.5035) },
    { name: "หอสมุด", location: new admin.firestore.GeoPoint(13.7540, 100.5025) },
    { name: "คณะวิศวกรรมศาสตร์", location: new admin.firestore.GeoPoint(13.7555, 100.5005) },
    // เพิ่มจุดจอดได้ตามต้องการ
];

// 2. ฟังก์ชันสำหรับอัปเดตตำแหน่งรถกอล์ฟ
async function updateCartPosition() {
    const cartRef = db.collection('golf_carts').doc('cart_01');
    const cartDoc = await cartRef.get();
    if (!cartDoc.exists) {
        console.log("Cart 'cart_01' not found in Firestore. Skipping update.");
        return;
    }

    const currentData = cartDoc.data();
    // หาว่าจุดต่อไปคือที่ไหน (ถ้าถึงจุดสุดท้ายแล้วให้วนกลับไปที่ 0)
    let nextStopIndex = (currentData.currentStopIndex + 1) % busStops.length;
    
    const nextStop = busStops[nextStopIndex];

    // อัปเดตตำแหน่งใน Firestore
    await cartRef.update({
        location: nextStop.location,
        status: `Moving to ${nextStop.name}`,
        currentStopIndex: nextStopIndex,
        lastUpdate: new Date()
    });

    console.log(`Bugo 1 moved to: ${nextStop.name} (Lat: ${nextStop.location.latitude}, Lng: ${nextStop.location.longitude})`);
}

// 3. เริ่มการทำงานของ Simulator
// สั่งให้ฟังก์ชัน updateCartPosition ทำงานทุกๆ 15 วินาที
setInterval(updateCartPosition, 15000); 

app.get('/api/bugo-status', async (req, res) => {
    try {
        const cartSnapshot = await db.collection('golf_carts').doc('cart_01').get();
        if (!cartSnapshot.exists) {
            return res.status(404).json({ error: 'Cart not found' });
        }
        // ส่งข้อมูลทั้งหมดของรถกลับไปเป็น JSON
        res.set('Access-Control-Allow-Origin', '*');
        res.json(cartSnapshot.data());
    } catch (error) {
        console.error("Bugo Status API Error:", error);
        res.status(500).json({ error: 'Failed to fetch cart status' });
    }
});


// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});