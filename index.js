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

// --- Middleware & Routes (เหมือนเดิม) ---
app.use(express.static('public'));
app.post('/webhook', line.middleware(config), (req, res) => { Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result)).catch((err) => { console.error("Webhook Error:", err); res.status(500).end(); }); });
app.use(express.json());
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
    const { token } = req.body;
    if (!token) { return res.status(400).json({ success: false, message: 'ไม่พบ Token' }); }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.uid;
    const displayName = decoded.name;
    const queueDocId = decoded.queueDocId;
    if (!queueDocId) { return res.status(400).json({ success: false, message: 'Token ไม่ถูกต้อง (ไม่มีข้อมูลคิว)' }); }
    const queueDocRef = db.collection('queues').doc(queueDocId);
    const queueDoc = await queueDocRef.get();
    if (!queueDoc.exists) { return res.status(404).json({ success: false, message: 'ไม่พบคิวนี้ในระบบ' }); }
    const queueData = queueDoc.data();
    if (queueData.checkedIn) { return res.status(409).json({ success: false, message: `คิวของคุณ ${displayName} ได้เช็คอินเข้าห้อง ${queueData.roomNumber} ไปแล้ว` }); }
    if (queueData.status !== 'SERVING') { return res.status(403).json({ success: false, message: `ยังไม่ถึงคิวของคุณ ${displayName} กรุณารอสักครู่` }); }
    await queueDocRef.update({ checkedIn: true, checkedInAt: new Date(), scannedBy: 'staff_01' });
    res.json({ success: true, message: `เช็คอินสำเร็จ!\nผู้ใช้: ${displayName}\nห้อง: ${queueData.roomNumber}` });
  } catch (error) {
    if (error.name === 'TokenExpiredError') { res.status(401).json({ success: false, message: 'QR Code หมดอายุแล้ว!' }); }
    else if (error.name === 'JsonWebTokenError') { res.status(401).json({ success: false, message: 'QR Code ไม่ถูกต้อง!' }); }
    else { console.error("Verify Check-in Error:", error); res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในระบบ' }); }
  }
});

// --- Event Handler (แก้ไข Flow การลงทะเบียน) ---
async function handleEvent(event) {

  // --- 1. จัดการ Event ประเภท Postback ---
  if (event.type === 'postback') {
    const data = event.postback.data;
    const userId = event.source.userId;
    if (data === 'consent_agree') {
      await db.collection('users').doc(userId).set({ consentGiven: true, consentTimestamp: new Date() }, { merge: true });
      // ** แก้ไขแล้ว: ส่งข้อความให้ผู้ใช้พิมพ์เบอร์โทรโดยตรง ไม่มี Quick Reply **
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ขอบคุณที่ยินยอมครับ ขั้นตอนต่อไป กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักของท่านเพื่อใช้ในการลงทะเบียนครับ (ตัวอย่าง: 0812345678)'
      });
    } else if (data === 'consent_disagree') {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ท่านได้ปฏิเสธการให้ข้อมูล ทางเราจึงไม่สามารถดำเนินการลงทะเบียนให้ท่านได้ ขออภัยในความไม่สะดวกครับ' });
    }
    return Promise.resolve(null);
  }

  // --- 2. ถ้าไม่ใช่ Message Event หรือไม่ใช่ Text Message ก็ไม่ต้องทำอะไร ---
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  // --- 3. จัดการ Message ประเภท Text ---
  const userId = event.source.userId;
  const messageText = event.message.text.trim();
  const lowerCaseMessage = messageText.toLowerCase();

  try {
    // --- จัดการการพิมพ์เบอร์โทร ---
    const phoneRegex = /^0\d{9}$/;
    if (phoneRegex.test(messageText)) {
      const userRef = db.collection('users').doc(userId);
      const doc = await userRef.get();
      // ตรวจสอบว่าเคยกดยินยอมแล้ว และยังไม่มีเบอร์โทร
      if (doc.exists && doc.data().consentGiven && !doc.data().phoneNumber) {
        const profile = await client.getProfile(userId);
        await userRef.set({
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          phoneNumber: messageText, // ใช้เบอร์ที่พิมพ์เข้ามา
          registeredAt: new Date()
        }, { merge: true });
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName} (เบอร์โทร: ${messageText})`
        });
      }
    }

    // --- จัดการคำสั่งพิเศษอื่นๆ ---
    if (lowerCaseMessage === '/help') { return Promise.resolve(null); }
    
    // คำสั่ง: ลงทะเบียน (Logic เดิมที่ถูกต้อง)
    if (lowerCaseMessage === 'ลงทะเบียน') {
      const userRef = db.collection('users').doc(userId);
      const doc = await userRef.get();
      if (doc.exists && doc.data().phoneNumber) {
        return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้เรียบร้อยแล้วครับ' });
      }
      return client.replyMessage(event.replyToken, { type: 'flex', altText: 'ข้อความขอความยินยอมในการให้ข้อมูล', contents: createConsentBubble() });
    }

    // คำสั่ง: เช็คอิน
    if (lowerCaseMessage === 'เช็คอิน') {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists || !userDoc.data().phoneNumber) { return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณา "ลงทะเบียน" ให้เสร็จสิ้นก่อน' });}
      const servingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'SERVING').limit(1).get();
      if (servingQueueSnapshot.empty) {
        const waitingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'WAITING').get();
        if (!waitingQueueSnapshot.empty) { return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่ถึงคิวของคุณครับ กรุณารอการแจ้งเตือนอีกครั้ง' }); }
        else { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณยังไม่มีคิวที่ต้องเช็คอินครับ กรุณา "จองคิว" ก่อน' }); }
      }
      const queueDoc = servingQueueSnapshot.docs[0];
      const queueData = queueDoc.data();
      const payload = { uid: userId, name: queueData.displayName, queueDocId: queueDoc.id, iat: Math.floor(Date.now() / 1000) };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m' });
      const projectUrl = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
      const qrImageUrl = `${projectUrl}/generate-qr?token=${token}`;
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: `นี่คือ QR Code สำหรับเข้าใช้บริการห้องหมายเลข ${queueData.roomNumber} ครับ\n\nQR Code นี้มีอายุ 5 นาที กรุณาแสดงให้เจ้าหน้าที่เพื่อสแกนยืนยันครับ` },
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
      1. บอทนี้มีความสามารถพิเศษในการ "ลงทะเบียน", "จองคิว", "เสร็จสิ้น", "เช็คอิน" และดู "สถานะ" คิว
      2. ถ้าผู้ใช้ถามเกี่ยวกับการสมัครสมาชิก ให้แนะนำให้พิมพ์ "ลงทะเบียน"
      3. ถ้าผู้ใช้ถามเกี่ยวกับการรับคิว ให้แนะนำให้พิมพ์ "จองคิว"
      4. ถ้าผู้ใช้ถามเรื่องการออกจากห้อง หรือใช้เสร็จแล้ว ให้แนะนำให้พิมพ์ "เสร็จสิ้น"
      5. ถ้าผู้ใช้ถามว่าตอนนี้ถึงคิวไหนแล้ว ให้แนะนำให้พิมพ์ "สถานะ"
      6. ถ้าผู้ใช้ต้องการยืนยันตัวตน, แสดง QR Code, หรือเข้างาน ให้แนะนำให้พิมพ์ "เช็คอิน"
      7. สำหรับคำถามอื่นๆ ทั้งหมด ให้คุณตอบอย่างเป็นธรรมชาติในฐานะ 'DIVA' , คุณเป็นผู้ชาย, คุณขี้เล่นและสุภาพ
      8. ข้อความที่คุณพิมพ์หาผู้ใช้มีความยาว 1 - 2 ประโยคพอ

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

// --- ฟังก์ชันสำหรับสร้าง Flex Message ---
function createConsentBubble() {
  return {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'คำขอยินยอมให้ข้อมูล', weight: 'bold', size: 'xl', color: '#FFFFFF' } ], backgroundColor: '#007BFF', paddingAll: '20px' },
    body: { type: 'box', layout: 'vertical', contents: [ { type: 'text', text: 'ข้อตกลงและเงื่อนไข', weight: 'bold', size: 'lg', margin: 'md' }, { type: 'text', text: 'เพื่อการลงทะเบียนและให้บริการจองคิว ทางเรามีความจำเป็นต้องเก็บรวบรวมข้อมูลโปรไฟล์ LINE ของท่าน อันได้แก่ ชื่อ, รูปโปรไฟล์, และเบอร์โทรศัพท์', wrap: true, margin: 'md' }, { type: 'text', text: 'ข้อมูลของท่านจะถูกใช้เพื่อการยืนยันตัวตนและการติดต่อกลับในกรณีที่จำเป็นเท่านั้น', wrap: true, margin: 'md'}, { type: 'separator', margin: 'xxl' } ] },
    footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [ { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: 'ไม่ยินยอม', data: 'consent_disagree' } }, { type: 'button', style: 'primary', height: 'sm', action: { type: 'postback', label: 'ยินยอม', data: 'consent_agree' } } ] }
  };
}

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