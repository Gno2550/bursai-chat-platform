require('cross-fetch/polyfill');

'use strict';
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken'); 
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    const { token } = req.body;
    if (!token) { return res.status(400).json({ success: false, message: 'ไม่พบ Token' }); }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.uid;
    const displayName = decoded.name;
    const checkinEventRef = db.collection('checkin_events').doc(); 
    await checkinEventRef.set({ userId: userId, displayName: displayName, status: 'CHECKED_IN', checkInTime: new Date(), scannedBy: 'staff_01' });
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
          คุณคือ 'DIVA' ผู้ช่วย AI อัจฉริยะใน BURSAI-CHAT-PLATFORM ... (ข้อความ Prompt เหมือนเดิม)
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
}

// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});