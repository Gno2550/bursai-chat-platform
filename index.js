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
        const newStop = { name: name, location: new admin.firestore.GeoPoint(latitude, longitude) };
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
        if (closestStop && minDistance < 20) {
            statusMessage = `ถึงแล้ว: ${closestStop.name}`;
            etaMinutes = 0;
        } else if (closestStop) {
            const AVERAGE_SPEED_KMPH = 15;
            const speedMps = (AVERAGE_SPEED_KMPH * 1000) / 3600;
            etaMinutes = (minDistance / speedMps) / 60;
            statusMessage = `กำลังมุ่งหน้าไป ${closestStop.name}`;
        }
        await cartRef.set({ location: new admin.firestore.GeoPoint(latitude, longitude), status: statusMessage, distanceToNextStop: minDistance, etaMinutes: etaMinutes, lastUpdate: new Date() }, { merge: true });
        res.json({ success: true, message: 'Location updated' });
    } catch (error) {
        console.error("Update Live Location Error:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- ** ส่วนจัดการ Logic หลักของบอท (handleEvent) - จัดโครงสร้างใหม่ ** ---
async function handleEvent(event) {
    // 1. จัดการ Event ที่ไม่ใช่ Message ก่อน
    if (event.type === 'postback') {
        return handlePostback(event);
    }
    if (event.type !== 'message') {
        return Promise.resolve(null);
    }

    // 2. แยกประเภทของ Message
    switch (event.message.type) {
        case 'text':
            return handleTextMessage(event);
        case 'contact':
            return handleContactMessage(event);
        default:
            return Promise.resolve(null);
    }
}

// --- ฟังก์ชันย่อยสำหรับจัดการ Postback Event ---
async function handlePostback(event) {
    // โค้ดส่วนนี้ไม่ได้ถูกใช้ใน Flow ปัจจุบัน (ที่ใช้หน้าเว็บ) แต่คงไว้เผื่ออนาคต
    const data = event.postback.data;
    console.log("Received postback data:", data);
    return Promise.resolve(null);
}

// --- ฟังก์ชันย่อยสำหรับจัดการ Contact Message ---
async function handleContactMessage(event) {
    // ส่วนนี้ก็ไม่ได้ถูกใช้ใน Flow ปัจจุบัน แต่เป็นโครงสร้างที่ดี
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
        // จัดการการพิมพ์เบอร์โทร
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

        // จัดการคำสั่งพิเศษ
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

        // AI Fallback
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
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- Helper Functions ---
function createConsentBubble() {
  return {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'คำขอยินยอมให้ข้อมูล', weight: 'bold', size: 'xl', color: '#FFFFFF' } ], backgroundColor: '#007BFF', paddingAll: '20px' },
    body: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'ข้อตกลงและเงื่อนไข', weight: 'bold', size: 'lg', margin: 'md' }, { type: 'text', text: 'เพื่อการลงทะเบียนและให้บริการจองคิว ทางเรามีความจำเป็นต้องเก็บรวบรวมข้อมูลโปรไฟล์ LINE ของท่าน อันได้แก่ ชื่อ, รูปโปรไฟล์, และเบอร์โทรศัพท์', wrap: true, margin: 'md' }, { type: 'text', text: 'ข้อมูลของท่านจะถูกใช้เพื่อการยืนยันตัวตนและการติดต่อกลับในกรณีที่จำเป็นเท่านั้น', wrap: true, margin: 'md'}, { type: 'separator', margin: 'xxl' } ] },
    footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [ { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: 'ไม่ยินยอม', data: 'consent_disagree' } }, { type: 'button', style: 'primary', height: 'sm', action: { type: 'postback', label: 'ยินยอม', data: 'consent_agree' } } ] }
  };
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

async function updateCartPosition() {
    const cartRef = db.collection('golf_carts').doc('cart_01');
    const cartDoc = await cartRef.get();
    if (!cartDoc.exists) {
        console.log("Cart 'cart_01' not found. Creating it at the first stop.");
        await cartRef.set({ name: 'Bugo 1', status: 'STOPPED', location: busStops[0].location, currentStopIndex: 0, lastUpdate: new Date() });
        return;
    }
    const currentData = cartDoc.data();
    let nextStopIndex = (currentData.currentStopIndex + 1) % busStops.length;
    const nextStop = busStops[nextStopIndex];
    await cartRef.update({ location: nextStop.location, status: `Moving to ${nextStop.name}`, currentStopIndex: nextStopIndex, lastUpdate: new Date() });
    console.log(`Bugo 1 moved to: ${nextStop.name} (Lat: ${nextStop.location.latitude}, Lng: ${nextStop.location.longitude})`);
}
setInterval(updateCartPosition, 15000); 

// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});