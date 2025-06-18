require('cross-fetch/polyfill');

'use strict';
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
// --- 1. เพิ่ม Library ของ Gemini ---
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Firebase Initialization (เหมือนเดิม) ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- LINE Bot Initialization (เหมือนเดิม) ---
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// --- 2. เพิ่มการเชื่อมต่อ Gemini AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

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

// --- Event Handler (อัปเกรดเป็น Hybrid Brain แล้ว) ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const messageText = event.message.text.trim();
  const lowerCaseMessage = messageText.toLowerCase();

  try {
    // --- สมองส่วนที่ 1: ตรวจจับคำสั่งพิเศษ (เหมือนเดิม) ---
    if (lowerCaseMessage === 'ลงทะเบียน') {
      const userRef = db.collection('users').doc(userId);
      const doc = await userRef.get();
      if (doc.exists) {
        return client.replyMessage(event.replyToken, { type: 'text', text: 'คุณได้ลงทะเบียนไว้แล้วครับ' });
      } else {
        const profile = await client.getProfile(userId);
        await userRef.set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl, registeredAt: new Date() });
        return client.replyMessage(event.replyToken, { type: 'text', text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName}` });
      }
    }

    if (lowerCaseMessage === 'เช็คอินเข้างาน') {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) { return client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาพิมพ์ "ลงทะเบียน" ก่อนทำการเช็คอินครับ' }); }
      const queueSnapshot = await db.collection('queues').where('lineUserId', '==', userId).where('status', '==', 'WAITING').get();
      if (!queueSnapshot.empty) { const queueData = queueSnapshot.docs[0].data(); return client.replyMessage(event.replyToken, { type: 'text', text: `คุณมีคิวที่รออยู่แล้ว หมายเลขคิวของคุณคือ ${queueData.queueNumber}` }); }
      const profile = userDoc.data();
      const todayQueueSnapshot = await db.collection('queues').where('status', 'in', ['WAITING', 'SERVING']).get();
      const newQueueNumber = todayQueueSnapshot.size + 1;
      await db.collection('queues').add({ lineUserId: userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, queueNumber: newQueueNumber, status: 'WAITING', checkInTime: new Date() });
      return client.replyMessage(event.replyToken, { type: 'text', text: `เช็คอินสำเร็จ! คุณได้รับคิวที่ ${newQueueNumber}` });
    }

    // --- สมองส่วนที่ 2: ถ้าไม่ใช่คำสั่งพิเศษ ให้ส่งไปให้ AI ---
    // (ลบ default reply เก่าออก แล้วแทนที่ด้วยส่วนนี้)
    const prompt = `
      คุณคือ 'DIVA' ผู้ช่วย AI อัจฉริยะใน BURSAI-CHAT-PLATFORM บุคลิกของคุณคือความเป็นมิตร สุภาพ ตลก และใช้คำลงท้ายว่า "ครับ"
      หน้าที่หลักของคุณคือการพูดคุยทั่วไปและตอบคำถามต่างๆ ของผู้ใช้

      สิ่งสำคัญที่ต้องรู้:
      1. บอทนี้มีความสามารถพิเศษในการ "ลงทะเบียน" และ "เช็คอิน" เพื่อรับคิว
      2. ถ้าผู้ใช้ถามเกี่ยวกับวิธีการสมัครสมาชิก, สมัครยังไง, หรือข้อความที่คล้ายกัน ให้คุณแนะนำอย่างสุภาพให้ผู้ใช้พิมพ์คำว่า "ลงทะเบียน"
      3. ถ้าผู้ใช้ถามเกี่ยวกับการรับคิว, ขอคิว, หรือข้อความที่คล้ายกัน ให้คุณแนะนำอย่างสุภาพให้ผู้ใช้พิมพ์คำว่า "เช็คอินเข้างาน"
      4. สำหรับคำถามอื่นๆ ทั้งหมด ให้คุณตอบอย่างเป็นธรรมชาติในฐานะ 'DIVA' กระชับและขี้เล่น
      5.ข้อความที่คุณพิมพ์หาผู้ใช้มีความยาวไม่เกิน 2 บรรทัดเพื่อความกระชับ

      คำถามจากผู้ใช้: "${messageText}"
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiReply = response.text();
    return client.replyMessage(event.replyToken, { type: 'text', text: aiReply });

  } catch (error) {
    // เพิ่มการจัดการ Error ให้ครอบคลุมมากขึ้น
    console.error("An error occurred:", error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ขออภัยครับ เกิดข้อผิดพลาดในระบบ โปรดลองอีกครั้งในภายหลัง'
    });
  }
}

// --- Start Server (เหมือนเดิม) ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});