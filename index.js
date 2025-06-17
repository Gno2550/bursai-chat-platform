

'use strict';
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');

// --- โค้ดใหม่ที่อ่านจากไฟล์โดยตรง ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);


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

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const messageText = event.message.text.trim();

  if (messageText.toLowerCase() === 'ลงทะเบียน') {
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

  if (messageText.toLowerCase() === 'เช็คอิน') {
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
return client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'สวัสดีครับ กรุณาพิมพ์ "ลงทะเบียน" เพื่อสมัครสมาชิก หรือ "เช็คอิน" เพื่อรับคิวครับ'
  });
}

// --- Start Server (เหมือนเดิม) ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Bot (Core Features) is listening on port ${port}`);
});