require('cross-fetch/polyfill');

'use strict';
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Firebase Initialization ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- LINE Bot Initialization ---
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// --- Gemini AI Initialization ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// --- ** การตั้งค่าระบบคิว ** ---
const TOTAL_ROOMS = 5; // กำหนดจำนวนห้องทั้งหมดที่นี่

const app = express();

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// --- Event Handler (อัปเกรดเป็น Hybrid Brain + Queue Management) ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const messageText = event.message.text.trim();
  const lowerCaseMessage = messageText.toLowerCase();

  try {
    // --- สมองส่วนที่ 1: ตรวจจับคำสั่งพิเศษ ---

    // คำสั่ง: ลงทะเบียน (เหมือนเดิม)
    if (lowerCaseMessage === 'ลงทะเบียน') {
      const userRef = db.collection('users').doc(userId);
      const doc = await userRef.get();
      if (doc.exists) { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้แล้วครับ' }); }
      else { const profile = await client.getProfile(userId); await userRef.set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl, registeredAt: new Date() }); return client.replyMessage(event.replyToken, { type: 'text', text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName}` }); }
    }

    // คำสั่ง: เช็คอินเข้างาน (Logic ใหม่ทั้งหมด)
    if (lowerCaseMessage === 'เช็คอินเข้างาน') {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) { return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาพิมพ์ "ลงทะเบียน" ก่อนทำการเช็คอินครับ' }); }

      const existingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', 'in', ['WAITING', 'SERVING']).get();
      if (!existingQueueSnapshot.empty) {
        const queueData = existingQueueSnapshot.docs[0].data();
        return client.replyMessage(event.replyToken, { type: 'text', text: `คุณมีคิวอยู่แล้วครับ\nสถานะ: ${queueData.status === 'SERVING' ? 'กำลังใช้บริการห้อง ' + queueData.roomNumber : 'กำลังรอคิวที่ ' + queueData.queueNumber}` });
      }

      const servingSnapshot = await db.collection('queues').where('status', '==', 'SERVING').get();
      const busyRooms = servingSnapshot.docs.map(doc => doc.data().roomNumber);

      if (servingSnapshot.size < TOTAL_ROOMS) {
        let assignedRoom = 0;
        for (let i = 1; i <= TOTAL_ROOMS; i++) { if (!busyRooms.includes(i)) { assignedRoom = i; break; } }
        
        await db.collection('queues').add({ lineUserId: userId, displayName: userDoc.data().displayName, status: 'SERVING', checkInTime: new Date(), roomNumber: assignedRoom });
        return client.replyMessage(event.replyToken, { type: 'text', text: `ถึงคิวของคุณแล้ว! เชิญที่ห้องหมายเลข ${assignedRoom} ได้เลยครับ` });
      } else {
        const allQueuesSnapshot = await db.collection('queues').get();
        const newQueueNumber = allQueuesSnapshot.size + 1;
        await db.collection('queues').add({ lineUserId: userId, displayName: userDoc.data().displayName, queueNumber: newQueueNumber, status: 'WAITING', checkInTime: new Date() });
        return client.replyMessage(event.replyToken, { type: 'text', text: `เช็คอินสำเร็จ! คุณได้รับคิวที่ ${newQueueNumber} นะครับ\nตอนนี้ห้องเต็ม กรุณารอสักครู่` });
      }
    }

    // คำสั่ง: เสร็จสิ้น (คำสั่งใหม่)
    if (lowerCaseMessage === 'เสร็จสิ้น') {
      const servingQueueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'SERVING').limit(1).get();
      if (servingQueueSnapshot.empty) { return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณยังไม่ได้เข้าใช้บริการเลยครับผม' }); }

      const queueDoc = servingQueueSnapshot.docs[0];
      const finishedRoomNumber = queueDoc.data().roomNumber;
      await queueDoc.ref.update({ status: 'FINISHED', finishTime: new Date() });
      await client.replyMessage(event.replyToken, { type: 'text', text: `ขอบคุณที่ใช้บริการครับ! (ออกจากห้อง ${finishedRoomNumber})` });
      return callNextUser(finishedRoomNumber); // เรียกคิวถัดไป!
    }
    
    // คำสั่ง: สถานะ (คำสั่งใหม่)
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
      1. บอทนี้มีความสามารถพิเศษในการ "ลงทะเบียน", "เช็คอินเข้างาน", "เสร็จสิ้น", และดู "สถานะ" คิว
      2. ถ้าผู้ใช้ถามเกี่ยวกับการสมัครสมาชิก ให้แนะนำให้พิมพ์ "ลงทะเบียน"
      3. ถ้าผู้ใช้ถามเกี่ยวกับการรับคิว ให้แนะนำให้พิมพ์ "เช็คอินเข้างาน"
      4. ถ้าผู้ใช้ถามเรื่องการออกจากห้อง หรือใช้เสร็จแล้ว ให้แนะนำให้พิมพ์ "เสร็จสิ้น"
      5. ถ้าผู้ใช้ถามว่าตอนนี้ถึงคิวไหนแล้ว ให้แนะนำให้พิมพ์ "สถานะ"
      6. สำหรับคำถามอื่นๆ ทั้งหมด ให้คุณตอบอย่างเป็นธรรมชาติในฐานะ 'DIVA' กระชับและขี้เล่น
      7. ข้อความที่คุณพิมพ์หาผู้ใช้มีความยาว 1 - 2 ประโยคพอ

      คำถามจากผู้ใช้: "${messageText}"
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiReply = response.text();
    return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });

  } catch (error) {
    console.error("An error occurred:", error);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ โปรดลองอีกครั้งในภายหลัง' });
  }
}

// --- ฟังก์ชันใหม่สำหรับเรียกคิวถัดไป ---
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

// --- Start Server (เหมือนเดิม) ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});