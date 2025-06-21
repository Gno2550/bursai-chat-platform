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

// --- User-Facing API Routes ---
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
app.get('/api/consent-response', async (req, res) => {
    try {
        const { choice, token } = req.query;
        if (!token || !choice) { return res.status(400).send('Missing required parameters.'); }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.uid;
        const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
        if (choice === 'agree') {
            await db.collection('users').doc(userId).set({ consentGiven: true, consentTimestamp: new Date() }, { merge: true });
            await client.pushMessage(userId, { type: 'text', text: 'ขอบคุณที่ยินยอมครับ ขั้นตอนต่อไป กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักของท่านเพื่อใช้ในการลงทะเบียนครับ (ตัวอย่าง: 0812345678)' });
            res.redirect(`${projectUrl}/consent_success.html`);
        } else if (choice === 'disagree') {
            await client.pushMessage(userId, { type: 'text', text: 'ท่านได้ปฏิเสธการให้ข้อมูล ทางเราจึงไม่สามารถดำเนินการลงทะเบียนให้ท่านได้ ขออภัยในความไม่สะดวกครับ' });
            res.redirect(`${projectUrl}/consent_declined.html`);
        } else {
            res.status(400).send('Invalid choice.');
        }
    } catch (error) {
        console.error("Consent Response Error:", error);
        res.status(500).send('An error occurred.');
    }
});
app.get('/api/bugo-status', async (req, res) => {
    try {
        const cartSnapshot = await db.collection('golf_carts').doc('cart_01').get();
        if (!cartSnapshot.exists) { return res.status(404).json({ error: 'Cart not found' }); }
        res.set('Access-Control-Allow-Origin', '*');
        res.json(cartSnapshot.data());
    } catch (error) {
        console.error("Bugo Status API Error:", error);
        res.status(500).json({ error: 'Failed to fetch cart status' });
    }
});
app.get('/api/bus-stops', async (req, res) => {
    try {
        const stopsSnapshot = await db.collection('bus_stops').orderBy('name').get();
        const stops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.set('Access-Control-Allow-Origin', '*');
        res.json(stops);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bus stops' });
    }
});
app.post('/api/add-bus-stop', async (req, res) => {
    try {
        const { name, latitude, longitude } = req.body;
        const newStop = { name: name, location: new admin.firestore.GeoPoint(parseFloat(latitude), parseFloat(longitude)) };
        await db.collection('bus_stops').add(newStop);
        res.status(201).json({ success: true, message: 'Bus stop added' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add bus stop' });
    }
});
app.delete('/api/delete-bus-stop/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('bus_stops').doc(id).delete();
        res.status(200).json({ success: true, message: 'Bus stop deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete bus stop' });
    }
});
app.post('/api/update-live-location', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        if (!latitude || !longitude) { return res.status(400).json({ success: false, message: 'Invalid location data' }); }
        
        const cartRef = db.collection('golf_carts').doc('cart_01');
        const cartDoc = await cartRef.get();
        const currentCartData = cartDoc.exists ? cartDoc.data() : {};
        const previousStatus = currentCartData.status || '';

        const stopsSnapshot = await db.collection('bus_stops').orderBy('name').get();
        const stops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        let closestStop = null;
        let minDistance = Infinity;
        if (stops.length > 0) {
            stops.forEach(stop => {
                const distance = getDistanceFromLatLonInM(latitude, longitude, stop.location.latitude, stop.location.longitude);
                if (distance < minDistance) { minDistance = distance; closestStop = stop; }
            });
        }
        
        let statusMessage = "ระหว่างทาง";
        let etaMinutes = 0;
        let nextStopLocation = null;
        let audioNotificationUrl = null; 
        
        if (closestStop && minDistance < 20) {
            statusMessage = `ถึงแล้ว: ${closestStop.name}`;
            
            if (!previousStatus.includes(closestStop.name)) {
                // ย้าย Key มาเก็บใน .env เพื่อความปลอดภัย
                const apiKey = process.env.BOTNOI_API_KEY || "iqLAn3GJUe6DfxCSrwQFtY8WbIcxibzf";
                const textToSpeak = `ถึงแล้ว, ${closestStop.name}`;
                const encodedText = encodeURIComponent(textToSpeak);
                audioNotificationUrl = `https://botnoi-voice.onrender.com/api/v1/tts?text=${encodedText}&speaker=b_male&speed=1&type=wav&auth=${apiKey}`;
                console.log(`Generated TTS URL with API Key for arrival: ${audioNotificationUrl}`);
            }
        } else if (closestStop) {
            const AVERAGE_SPEED_KMPH = 15;
            const speedMps = (AVERAGE_SPEED_KMPH * 1000) / 3600;
            etaMinutes = (minDistance / speedMps) / 60;
            statusMessage = `กำลังมุ่งหน้าไป ${closestStop.name}`;
            nextStopLocation = closestStop.location;
        }
        
        await cartRef.set({ 
            location: new admin.firestore.GeoPoint(latitude, longitude), 
            status: statusMessage, 
            distanceToNextStop: minDistance, 
            etaMinutes: etaMinutes, 
            lastUpdate: new Date(),
            nextStopLocation: nextStopLocation
        }, { merge: true });
        
        res.json({ 
            success: true, 
            message: 'Location updated',
            audioUrl: audioNotificationUrl 
        });

    } catch (error) {
        console.error("Update Live Location Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- ** ส่วนจัดการ Logic หลักของบอท (handleEvent) ** ---
async function handleEvent(event) {
    if (event.type === 'postback') { return handlePostback(event); }
    if (event.type !== 'message') { return Promise.resolve(null); }
    switch (event.message.type) {
        case 'text': return handleTextMessage(event);
        case 'contact': return handleContactMessage(event);
        default: return Promise.resolve(null);
    }
}

// --- ฟังก์ชันย่อยสำหรับจัดการ Postback Event ---
async function handlePostback(event) {
    const data = event.postback.data;
    console.log("Received postback data:", data);
    return Promise.resolve(null);
}

// --- ฟังก์ชันย่อยสำหรับจัดการ Contact Message ---
async function handleContactMessage(event) {
    const userId = event.source.userId;
    const phoneNumber = event.message.phoneNumber;
    console.log(`Received contact message from ${userId} with phone: ${phoneNumber}`);
    return Promise.resolve(null);
}

// --- ฟังก์ชันย่อยสำหรับจัดการ Text Message ---
async function handleTextMessage(event) {
    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    const lowerCaseMessage = messageText.toLowerCase();

    try {
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

        if (lowerCaseMessage === '/help') { return Promise.resolve(null); }
        
        if (lowerCaseMessage === 'ลงทะเบียน') {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            if (doc.exists && doc.data().phoneNumber) { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้เรียบร้อยแล้วครับ' }); }
            const consentToken = jwt.sign({ uid: userId, purpose: 'consent' }, process.env.JWT_SECRET, { expiresIn: '15m' });
            const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
            const consentUrl = `${projectUrl}/consent.html?token=${consentToken}`;
            return client.replyMessage(event.replyToken, {
                type: 'flex', altText: 'กรุณาอ่านและยินยอมข้อตกลงเพื่อดำเนินการต่อ',
                contents: {
                    type: 'bubble',
                    body: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'ขั้นตอนการลงทะเบียน', weight: 'bold', size: 'xl' }, { type: 'text', text: 'เพื่อดำเนินการต่อ กรุณาอ่านและให้ความยินยอมในข้อตกลงและเงื่อนไขการให้บริการของเราก่อนครับ', wrap: true, margin: 'md'} ] },
                    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', height: 'sm', action: { type: 'uri', label: 'อ่านข้อตกลงและเงื่อนไข', uri: consentUrl } }] }
                }
            });
        }

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

        if (lowerCaseMessage === 'เสร็จสิ้น') {
            const servingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'SERVING').limit(1).get();
            if (servingQueueSnapshot.empty) { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณยังไม่ได้เข้าใช้บริการเลยครับผม' }); }
            const queueDoc = servingQueueSnapshot.docs[0];
            const finishedRoomNumber = queueDoc.data().roomNumber;
            await queueDoc.ref.update({ status: 'FINISHED', finishTime: new Date() });
            await client.replyMessage(event.replyToken, { type: 'text', text: `ขอบคุณที่ใช้บริการครับ! (ออกจากห้อง ${finishedRoomNumber})` });
            return callNextUser(finishedRoomNumber);
        }
        
        if (lowerCaseMessage === 'สถานะ' || lowerCaseMessage === 'คิว') {
            const servingSnapshot = await db.collection('queues').where('status', '==', 'SERVING').orderBy('checkInTime').get();
            const waitingSnapshot = await db.collection('queues').where('status', '==', 'WAITING').orderBy('queueNumber').get();
            let servingText = servingSnapshot.empty ? 'ตอนนี้ทุกห้องว่างครับ!' : 'ห้องที่กำลังมีคนใช้:\n' + servingSnapshot.docs.map(doc => `- ห้อง ${doc.data().roomNumber} (คุณ ${doc.data().displayName})`).join('\n');
            let waitingText = waitingSnapshot.empty ? '\nไม่มีคิวรอเลยครับ' : '\n\nคิวที่กำลังรอ:\n' + waitingSnapshot.docs.map(doc => `- คิวที่ ${doc.data().queueNumber} (คุณ ${doc.data().displayName})`).join('\n');
            return client.replyMessage(event.replyToken, { type: 'text', text: servingText + waitingText });
        }

        if (lowerCaseMessage === 'bugo') {
            const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
            const bugoTrackerUrl = `${projectUrl}/bugo.html`;
            return client.replyMessage(event.replyToken, {
                type: 'flex', altText: 'เปิดระบบติดตามรถกอล์ฟ Bugo',
                contents: {
                    type: 'bubble',
                    body: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'Bugo Tracker', weight: 'bold', size: 'xl' }, { type: 'text', text: 'ระบบติดตามตำแหน่งรถกอล์ฟแบบ Real-time แตะปุ่มด้านล่างเพื่อเปิดแผนที่ครับและดูตำแหน่งของรถ', wrap: true, margin: 'md' } ] },
                    footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', height: 'sm', action: { type: 'uri', label: 'เปิดแผนที่ติดตาม', uri: bugoTrackerUrl } }] }
                }
            });
        }

        const prompt = `
          คุณคือ 'Chatai', 'ชาไทย' ผู้ช่วย AI อัจฉริยะใน BURSAI-CHAT-PLATFORM บุคลิกของคุณคือความเป็นมิตร สุภาพ ตลก และใช้คำลงท้ายว่า "ครับ"
          หน้าที่หลักของคุณคือการพูดคุยทั่วไปและตอบคำถามต่างๆ ของผู้ใช้
          สิ่งสำคัญที่ต้องรู้:
          1. บอทนี้มีความสามารถพิเศษในการ "ลงทะเบียน", "จองคิว", "เสร็จสิ้น", "เช็คอิน", ดู "สถานะ" คิว, และติดตามรถกอล์ฟ "bugo"
          2. ถ้าผู้ใช้ถามเกี่ยวกับการสมัครสมาชิก ให้แนะนำให้พิมพ์ "ลงทะเบียน"
          3. ถ้าผู้ใช้ถามเกี่ยวกับการรับคิว ให้แนะนำให้พิมพ์ "จองคิว"
          4. ถ้าผู้ใช้ถามเรื่องการออกจากห้อง หรือใช้เสร็จแล้ว ให้แนะนำให้พิมพ์ "เสร็จสิ้น"
          5. ถ้าผู้ใช้ถามว่าตอนนี้ถึงคิวไหนแล้ว ให้แนะนำให้พิมพ์ "สถานะ"
          6. ถ้าผู้ใช้ต้องการ QR Code เพื่อยืนยันตัวตน ให้แนะนำให้พิมพ์ "เช็คอิน"
          7. ถ้าผู้ใช้ต้องการติดตามรถกอล์ฟ ให้แนะนำให้พิมพ์ "bugo"
          8. สำหรับคำถามอื่นๆ ทั้งหมด ให้คุณตอบอย่างเป็นธรรมชาติในฐานะ 'DIVA' , คุณเป็นผู้ชาย, คุณขี้เล่นและสุภาพ
          9. ข้อความที่คุณพิมพ์หาผู้ใช้มีความยาว 1 - 2 ประโยคพอ
          คำถามจากผู้ใช้: "${messageText}"
        `;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiReply = response.text();
        return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });

    } catch (error) {
        console.error("An error occurred in handleTextMessage:", error);
        return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ' });
    }
}

// --- Helper Functions ---
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

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