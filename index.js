'use strict';

// --- 0. SETUP ENVIRONMENT ---
require('dotenv').config(); // โหลดค่าจากไฟล์ .env เข้ามาใช้งาน

// --- 1. IMPORT LIBRARIES ---
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
const OpenAI = require('openai'); // <-- เพิ่ม OpenAI

// --- 2. INITIALIZE SERVICES ---
// เชื่อมต่อ Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// เชื่อมต่อ LINE (ดึงค่าจาก .env)
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// เชื่อมต่อ OpenAI (ดึงค่าจาก .env)
const openai = new OpenAI({
    apiKey: process.env.API_KEY,
});

const app = express();

// --- 3. WEBHOOK ---
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// --- 4. EVENT HANDLER (หัวใจหลักของบอท) ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const messageText = event.message.text.trim(); // ไม่ต้อง toLowerCase() แล้ว เพื่อให้ OpenAI เข้าใจประโยคปกติ

  // --- FEATURE: ลงทะเบียน (เหมือนเดิม) ---
  if (messageText.toLowerCase() === 'ลงทะเบียน') {
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้แล้วค่ะ' });
    } else {
      const profile = await client.getProfile(userId);
      await userRef.set({
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        registeredAt: new Date()
      });
      return client.replyMessage(event.replyToken, { type: 'text', text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName}` });
    }
  }

  // --- FEATURE: เช็คอิน/รับคิว (เหมือนเดิม) ---
  if (messageText.toLowerCase() === 'เช็คอิน') {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาพิมพ์ "ลงทะเบียน" ก่อนทำการเช็คอินค่ะ' });
    }
    const queueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'WAITING').get();
    if (!queueSnapshot.empty) {
      const queueData = queueSnapshot.docs[0].data();
      return client.replyMessage(event.replyToken, { type: 'text', text: `คุณมีคิวที่รออยู่แล้ว หมายเลขคิวของคุณคือ ${queueData.queueNumber}` });
    }
    const profile = userDoc.data();
    const todayQueueSnapshot = await db.collection('queues').where('status', 'in', ['WAITING', 'SERVING']).get();
    const newQueueNumber = todayQueueSnapshot.size + 1;
    await db.collection('queues').add({
      lineUserId: userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      queueNumber: newQueueNumber,
      status: 'WAITING',
      checkInTime: new Date()
    });
    return client.replyMessage(event.replyToken, { type: 'text', text: `เช็คอินสำเร็จ! คุณได้รับคิวที่ ${newQueueNumber}` });
  }

  // ---  *** ส่วนที่เพิ่มเข้ามา: ตอบโต้ด้วย OpenAI *** ---
  // ถ้าข้อความที่เข้ามาไม่ใช่คำสั่งเฉพาะด้านบน ให้ส่งไปให้ AI
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: "คุณคือ 'DIVA' ผู้ช่วยอัจฉริยะที่เป็นมิตรและพูดคุยเป็นภาษาไทยอย่างเป็นธรรมชาติ" },
        { role: "user", content: messageText },
      ],
      model: "gemini-2.0-flash",
    });

    const aiReply = completion.choices[0].message.content;

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: aiReply
    });

  } catch (error) {
    console.error("OpenAI Error:", error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ขออภัยค่ะ ตอนนี้ระบบ AI มีปัญหาเล็กน้อย โปรดลองอีกครั้งในภายหลัง'
    });
  }
}

// --- 5. START SERVER ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai  is listening on port ${port}`);
});