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

// 1. จัดการ Firebase Admin SDK (ส่วนที่แก้ไข)
try {
  const serviceAccountString = process.env.GOOGLE_CREDENTIALS;
  if (!serviceAccountString) {
    throw new Error('The GOOGLE_CREDENTIALS environment variable is not set.');
  }
  const serviceAccount = JSON.parse(serviceAccountString);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
  // ใน Production อาจจะต้องการให้ process หยุดทำงานไปเลยถ้าเชื่อม Firebase ไม่ได้
  // process.exit(1); 
}

// 2. ตั้งค่าส่วนที่เหลือ
const db = admin.firestore();
const config = { channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN, channelSecret: process.env.CHANNEL_SECRET };
const client = new line.Client(config);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
const TOTAL_ROOMS = 5;

const arrivalAudioMap = {
    "BUS_STOP1": "/assets/finished.mp3",
    "BUS_STOP2": "/assets/finished.mp3",
    "BUS_STOP3": "/assets/finished.mp3"
};
const approachingAudioMap = {
    "BUS_STOP1": "/assets/BUSSTOP AUD-1.mp3",
    "BUS_STOP2": "/assets/BUSSTOP AUD-2.mp3",
    "BUS_STOP3": "/assets/BUSSTOP AUD-3.mp3"
};

const app = express();

app.use(express.static('public'));
app.post('/webhook', line.middleware(config), (req, res) => { Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result)).catch((err) => { console.error("Webhook Error:", err); res.status(500).end(); }); });
app.use(express.json());

// --- Staff API Routes ---
app.post("/api/staff-register", async (req, res) => {
  try {
    const { displayName, username, password, orgSecret } = req.body;
    if (!displayName || !username || !password || !orgSecret) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }
    if (orgSecret !== process.env.ORGANIZATION_SECRET) {
      return res
        .status(403)
        .json({ success: false, message: "รหัสลับองค์กรไม่ถูกต้อง" });
    }
    const existingStaff = await db
      .collection("staffs")
      .where("username", "==", username)
      .get();
    if (!existingStaff.empty) {
      return res
        .status(409)
        .json({ success: false, message: "Username นี้มีผู้ใช้งานแล้ว" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db
      .collection("staffs")
      .add({
        username,
        password: hashedPassword,
        displayName,
        role: "Staff",
        registeredAt: new Date(),
      });
    res.status(201).json({ success: true, message: "สมัครสมาชิกสำเร็จ!" });
  } catch (error) {
    console.error("Staff Registration Error:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในระบบ" });
  }
});
app.post("/api/staff-login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณากรอก Username และ Password" });
    }
    const staffQuery = await db
      .collection("staffs")
      .where("username", "==", username)
      .limit(1)
      .get();
    if (staffQuery.empty) {
      return res
        .status(401)
        .json({ success: false, message: "Username หรือ Password ไม่ถูกต้อง" });
    }
    const staffDoc = staffQuery.docs[0];
    const staffData = staffDoc.data();
    const isPasswordMatch = await bcrypt.compare(password, staffData.password);
    if (!isPasswordMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Username หรือ Password ไม่ถูกต้อง" });
    }
    const staffToken = jwt.sign(
      { staffId: staffDoc.id, staffName: staffData.displayName },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({
      success: true,
      message: "ล็อกอินสำเร็จ!",
      token: staffToken,
      staffName: staffData.displayName,
    });
  } catch (error) {
    console.error("Staff Login Error:", error);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

// --- User-Facing API Routes ---
app.get("/generate-qr", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Token is required");
    }
    const qrCodeBuffer = await QRCode.toBuffer(token);
    res.set("Content-Type", "image/png");
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error("QR Generation Error:", error);
    res.status(500).send("Error generating QR code");
  }
});
app.post("/api/verify-check-in", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่ได้รับอนุญาต (No staff token)" });
    }
    const staffToken = authHeader.split(" ")[1];
    const staffDecoded = jwt.verify(staffToken, process.env.JWT_SECRET);
    const staffName = staffDecoded.staffName;
    const { token } = req.body;
    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "ไม่พบ Token ของผู้ใช้" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.uid;
    const displayName = decoded.name;
    const checkinEventRef = db.collection("checkin_events").doc();
    await checkinEventRef.set({
      userId,
      displayName,
      status: "CHECKED_IN",
      checkInTime: new Date(),
      scannedBy: staffName,
    });
    res.json({
      success: true,
      message: `เช็คอินสำเร็จ!\nผู้ใช้: ${displayName}`,
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      res.status(401).json({ success: false, message: "QR Code หมดอายุแล้ว!" });
    } else if (error.name === "JsonWebTokenError") {
      res.status(401).json({ success: false, message: "QR Code ไม่ถูกต้อง!" });
    } else {
      console.error("Verify Check-in Error:", error);
      res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในระบบ" });
    }
  }
});
app.get("/api/consent-response", async (req, res) => {
  try {
    const { choice, token } = req.query;
    if (!token || !choice) {
      return res.status(400).send("Missing required parameters.");
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.uid;
    const projectUrl = process.env.BASE_URL; // ดึงค่าจาก Environment Variable ที่เราตั้งไว้;
    if (choice === "agree") {
      await db
        .collection("users")
        .doc(userId)
        .set(
          { consentGiven: true, consentTimestamp: new Date() },
          { merge: true }
        );
      await client.pushMessage(userId, {
        type: "text",
        text: "ขอบคุณที่ยินยอมครับ ขั้นตอนต่อไป กรุณาพิมพ์เบอร์โทรศัพท์ 10 หลักของท่านเพื่อใช้ในการลงทะเบียนครับ (ตัวอย่าง: 0812345678)",
      });
      res.redirect(`${projectUrl}/consent_success.html`);
    } else if (choice === "disagree") {
      await client.pushMessage(userId, {
        type: "text",
        text: "ท่านได้ปฏิเสธการให้ข้อมูล ทางเราจึงไม่สามารถดำเนินการลงทะเบียนให้ท่านได้ ขออภัยในความไม่สะดวกครับ",
      });
      res.redirect(`${projectUrl}/consent_declined.html`);
    } else {
      res.status(400).send("Invalid choice.");
    }
  } catch (error) {
    console.error("Consent Response Error:", error);
    res.status(500).send("An error occurred.");
  }
});
app.get("/api/bugo-status", async (req, res) => {
  try {
    const cartSnapshot = await db.collection("golf_carts").doc("cart_01").get();
    if (!cartSnapshot.exists) {
      return res.status(404).json({ error: "Cart not found" });
    }
    res.set("Access-Control-Allow-Origin", "*");
    res.json(cartSnapshot.data());
  } catch (error) {
    console.error("Bugo Status API Error:", error);
    res.status(500).json({ error: "Failed to fetch cart status" });
  }
});
app.get("/api/bus-stops", async (req, res) => {
  try {
    const stopsSnapshot = await db
      .collection("bus_stops")
      .orderBy("name")
      .get();
    const stops = stopsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.set("Access-Control-Allow-Origin", "*");
    res.json(stops);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bus stops" });
  }
});
app.post("/api/add-bus-stop", async (req, res) => {
  try {
    const { name, latitude, longitude } = req.body;
    const newStop = {
      name: name,
      location: new admin.firestore.GeoPoint(
        parseFloat(latitude),
        parseFloat(longitude)
      ),
    };
    await db.collection("bus_stops").add(newStop);
    res.status(201).json({ success: true, message: "Bus stop added" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add bus stop" });
  }
});
app.delete("/api/delete-bus-stop/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("bus_stops").doc(id).delete();
    res.status(200).json({ success: true, message: "Bus stop deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete bus stop" });
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
        const notifiedForStop = currentCartData.notifiedForStop || null;

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
        let distanceToNextStop = 0;
        let etaMinutes = 0;
        let audioNotificationUrl = null; 
        const now = new Date();
        const travelLogsRef = db.collection('travel_logs');

        if (closestStop && minDistance < 15) { 
            statusMessage = `ถึงแล้ว: ${closestStop.name}`;
            if (!previousStatus.includes(statusMessage)) {
                audioNotificationUrl = arrivalAudioMap[closestStop.name];
                const lastDepartureQuery = await travelLogsRef.where('cartId', '==', 'cart_01').where('status', '==', 'DEPARTED').orderBy('departureTime', 'desc').limit(1).get();
                if (!lastDepartureQuery.empty) {
                    const departureDoc = lastDepartureQuery.docs[0];
                    const travelTimeSeconds = (now.getTime() / 1000) - departureDoc.data().departureTime.seconds;
                    await departureDoc.ref.update({ status: 'COMPLETED', destination: closestStop.name, arrivalTime: now, durationSeconds: travelTimeSeconds });
                    console.log(`Travel log COMPLETED for: ${closestStop.name}`);
                }
            }
        } else if (closestStop && minDistance < 50) { 
            if (!previousStatus.startsWith(`ถึงแล้ว: ${closestStop.name}`)) {
                statusMessage = `กำลังเข้าใกล้ ${closestStop.name}`;
                if (notifiedForStop !== closestStop.name) {
                    audioNotificationUrl = approachingAudioMap[closestStop.name];
                    await cartRef.update({ notifiedForStop: closestStop.name });
                }
            } else {
                statusMessage = `กำลังออกจาก: ${closestStop.name}`;
            }
        } else if (closestStop) {
            statusMessage = `กำลังมุ่งหน้าไป ${closestStop.name}`;
            if (previousStatus.startsWith('ถึงแล้ว:') || previousStatus.startsWith('กำลังออกจาก:')) {
                const departedStopName = previousStatus.replace('ถึงแล้ว: ', '').replace('กำลังออกจาก: ', '');
                await cartRef.update({ notifiedForStop: null });
                const lastDepartureQuery = await travelLogsRef.where('origin', '==', departedStopName).where('status', '==', 'DEPARTED').orderBy('departureTime', 'desc').limit(1).get();
                if (lastDepartureQuery.empty) {
                     await travelLogsRef.add({ cartId: 'cart_01', status: 'DEPARTED', origin: departedStopName, departureTime: now });
                     console.log(`Travel log DEPARTED from: ${departedStopName}`);
                }
            }
            try {
                const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${longitude},${latitude};${closestStop.location.longitude},${closestStop.location.latitude}`;
                const osrmResponse = await fetch(osrmUrl);
                const routeData = await osrmResponse.json();
                if (routeData.code === 'Ok' && routeData.routes.length > 0) {
                    const route = routeData.routes[0];
                    distanceToNextStop = route.distance;
                    etaMinutes = route.duration / 60;
                } else {
                    distanceToNextStop = minDistance;
                    etaMinutes = (minDistance / ((15 * 1000) / 3600)) / 60;
                }
            } catch (osrmError) {
                console.error("OSRM API Error:", osrmError);
                statusMessage = "ไม่สามารถเชื่อมต่อระบบนำทางได้";
            }
        }
        
        await cartRef.set({ 
            location: new admin.firestore.GeoPoint(latitude, longitude), 
            status: statusMessage, 
            distanceToNextStop: distanceToNextStop, 
            etaMinutes: etaMinutes, 
            lastUpdate: now
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

app.post('/api/stop-tracking', async (req, res) => {
    try {
        const cartRef = db.collection('golf_carts').doc('cart_01');
        await cartRef.update({
            status: 'คนขับออฟไลน์',
            lastUpdate: new Date(),
            notifiedForStop: null 
        });
        console.log("Driver cart_01 has stopped tracking.");
        res.json({ success: true, message: 'Tracking stopped successfully.' });
    } catch (error) {
        console.error("Stop Tracking API Error:", error);
        res.status(500).json({ success: false, message: 'Failed to stop tracking.' });
    }
});


app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [
            usersSnapshot,
            registrationsTodaySnapshot,
            checkinsSnapshot,
            servingSnapshot,
            waitingSnapshot,
            recentUsersSnapshot,
            finishedQueuesTodaySnapshot
        ] = await Promise.all([
            db.collection('users').get(),
            db.collection('users').where('registeredAt', '>=', today).get(),
            db.collection('checkin_events').where('checkInTime', '>=', today).get(),
            db.collection('queues').where('status', '==', 'SERVING').get(),
            db.collection('queues').where('status', '==', 'WAITING').get(),
            db.collection('users').where('registeredAt', '>=', sevenDaysAgo).orderBy('registeredAt').get(),
            db.collection('queues').where('status', '==', 'FINISHED').where('finishTime', '>=', today).get()
        ]);
        
        const totalUsers = usersSnapshot.size;
        const registrationsToday = registrationsTodaySnapshot.size;
        const checkinsToday = checkinsSnapshot.size;
        
        const queueStatus = {
            serving: servingSnapshot.docs.map(doc => doc.data()),
            waiting: waitingSnapshot.docs.map(doc => doc.data()),
        };

        const registrationChartData = { labels: [], data: [] };
        const regCounts = {};
        recentUsersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.registeredAt && data.registeredAt.seconds) {
                const date = new Date(data.registeredAt.seconds * 1000).toLocaleDateString('en-CA');
                regCounts[date] = (regCounts[date] || 0) + 1;
            }
        });
        for(let i=6; i>=0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const label = d.toLocaleDateString('en-CA');
            registrationChartData.labels.push(label);
            registrationChartData.data.push(regCounts[label] || 0);
        }

        const checkinChartData = { labels: [], data: [] };
        const checkinCounts = Array(24).fill(0); 
        checkinsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.checkInTime && data.checkInTime.seconds) {
                const hour = new Date(data.checkInTime.seconds * 1000).getHours();
                checkinCounts[hour]++;
            }
        });
        for (let i = 0; i < 24; i++) {
            checkinChartData.labels.push(`${i}:00`);
            checkinChartData.data.push(checkinCounts[i]);
        }
        
        const staffCheckinCounts = {};
        checkinsSnapshot.docs.forEach(doc => {
            const staffName = doc.data().scannedBy;
            if (staffName) {
                staffCheckinCounts[staffName] = (staffCheckinCounts[staffName] || 0) + 1;
            }
        });
        const staffLeaderboard = Object.entries(staffCheckinCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        let totalWaitTimeMinutes = 0;
        let validFinishedQueuesCount = 0;
        finishedQueuesTodaySnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.finishTime && data.checkInTime) {
                const waitTime = (data.finishTime.seconds - data.checkInTime.seconds) / 60;
                totalWaitTimeMinutes += waitTime;
                validFinishedQueuesCount++;
            }
        });
        
        const averageWaitTime = validFinishedQueuesCount > 0 
            ? (totalWaitTimeMinutes / validFinishedQueuesCount).toFixed(1) 
            : 0;

        const summaryData = {
            topPerformingStaff: staffLeaderboard.length > 0 ? staffLeaderboard[0] : null,
            averageWaitTime: averageWaitTime,
            totalFinishedToday: finishedQueuesTodaySnapshot.size
        };

        res.json({
            totalUsers,
            registrationsToday,
            checkinsToday,
            queueStatus,
            registrationChartData,
            checkinChartData,
            staffLeaderboard,
            summaryData
        });

    } catch (error) {
        console.error("Dashboard Stats API Error:", error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});


app.get('/api/dashboard/travel-times', async (req, res) => {
    try {
        const completedLogsSnapshot = await db.collection('travel_logs')
            .where('status', '==', 'COMPLETED')
            .get();

        const travelStats = {};

        completedLogsSnapshot.docs.forEach(doc => {
            const log = doc.data();
            if (log.origin && log.destination && typeof log.durationSeconds === 'number') {
                const routeKey = `${log.origin} -> ${log.destination}`;
                if (!travelStats[routeKey]) {
                    travelStats[routeKey] = {
                        totalDuration: 0,
                        count: 0
                    };
                }
                travelStats[routeKey].totalDuration += log.durationSeconds;
                travelStats[routeKey].count++;
            }
        });

        const result = Object.entries(travelStats).map(([route, stats]) => {
            const averageSeconds = stats.totalDuration / stats.count;
            const averageMinutes = (averageSeconds / 60).toFixed(1);
            return {
                route: route,
                averageTimeMinutes: averageMinutes,
                tripCount: stats.count
            }
        }).sort((a,b) => b.tripCount - a.tripCount);

        res.json(result);

    } catch (error) {
        console.error("Travel Times API Error:", error);
        res.status(500).json({ error: 'Failed to fetch travel times' });
    }
});

// --- ** ส่วนจัดการ Logic หลักของบอท (handleEvent) ** ---
app.get('/api/dashboard/travel-times', async (req, res) => {
    try {
        const completedLogsSnapshot = await db.collection('travel_logs')
            .where('status', '==', 'COMPLETED')
            .get();

        const travelStats = {};

        completedLogsSnapshot.docs.forEach(doc => {
            const log = doc.data();
            if (log.origin && log.destination && typeof log.durationSeconds === 'number') {
                const routeKey = `${log.origin} -> ${log.destination}`;
                if (!travelStats[routeKey]) {
                    travelStats[routeKey] = {
                        totalDuration: 0,
                        count: 0
                    };
                }
                travelStats[routeKey].totalDuration += log.durationSeconds;
                travelStats[routeKey].count++;
            }
        });

        const result = Object.entries(travelStats).map(([route, stats]) => {
            const averageSeconds = stats.totalDuration / stats.count;
            const averageMinutes = (averageSeconds / 60).toFixed(1);
            return {
                route: route,
                averageTimeMinutes: averageMinutes,
                tripCount: stats.count
            }
        }).sort((a,b) => b.tripCount - a.tripCount);

        res.json(result);

    } catch (error) {
        console.error("Travel Times API Error:", error);
        res.status(500).json({ error: 'Failed to fetch travel times' });
    }
});

async function handleEvent(event) {
  if (event.type === "postback") {
    return handlePostback(event);
  }
  if (event.type !== "message") {
    return Promise.resolve(null);
  }
  switch (event.message.type) {
    case "text":
      return handleTextMessage(event);
    case "contact":
      return handleContactMessage(event);
    default:
      return Promise.resolve(null);
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
  console.log(
    `Received contact message from ${userId} with phone: ${phoneNumber}`
  );
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
      const userRef = db.collection("users").doc(userId);
      const doc = await userRef.get();
      if (doc.exists && doc.data().consentGiven && !doc.data().phoneNumber) {
        const profile = await client.getProfile(userId);
        await userRef.set(
          {
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
            phoneNumber: messageText,
            registeredAt: new Date(),
          },
          { merge: true }
        );
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${profile.displayName} (เบอร์โทร: ${messageText})`,
        });
      }
    }

    if (lowerCaseMessage === "/help") {
      return Promise.resolve(null);
    }

    if (lowerCaseMessage === "ลงทะเบียน") {
      const userRef = db.collection("users").doc(userId);
      const doc = await userRef.get();
      if (doc.exists && doc.data().phoneNumber) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "คุณได้ลงทะเบียนไว้เรียบร้อยแล้วครับ",
        });
      }
      const consentToken = jwt.sign(
        { uid: userId, purpose: "consent" },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );
      // ใช้โค้ดใหม่นี้แทน
      const projectUrl = process.env.BASE_URL; // ดึงค่าจาก Environment Variable ที่เราตั้งไว้
      const consentUrl = `${projectUrl}/consent.html?token=${consentToken}`;
      return client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "กรุณาอ่านและยินยอมข้อตกลงเพื่อดำเนินการต่อ",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "ขั้นตอนการลงทะเบียน",
                weight: "bold",
                size: "xl",
              },
              {
                type: "text",
                text: "เพื่อดำเนินการต่อ กรุณาอ่านและให้ความยินยอมในข้อตกลงและเงื่อนไขการให้บริการของเราก่อนครับ",
                wrap: true,
                margin: "md",
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: {
                  type: "uri",
                  label: "อ่านข้อตกลงและเงื่อนไข",
                  uri: consentUrl,
                },
              },
            ],
          },
        },
      });
    }

    if (lowerCaseMessage === "เช็คอิน") {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists || !userDoc.data().phoneNumber) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: 'กรุณา "ลงทะเบียน" ให้เสร็จสิ้นก่อนทำการเช็คอินครับ',
        });
      }
      const payload = {
        uid: userId,
        name: userDoc.data().displayName,
        iat: Math.floor(Date.now() / 1000),
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "5m",
      });
      const projectUrl = process.env.BASE_URL; // ดึงค่าจาก Environment Variable ที่เราตั้งไว้;
      const qrImageUrl = `${projectUrl}/generate-qr?token=${token}`;
      return client.replyMessage(event.replyToken, [
        {
          type: "text",
          text: `นี่คือ QR Code ประจำตัวของคุณ ${
            userDoc.data().displayName
          } ครับ\n\nใช้สำหรับยืนยันตัวตน, เข้าร่วมกิจกรรม, หรือสะสมแต้ม QR Code นี้มีอายุ 5 นาทีครับ`,
        },
        {
          type: "image",
          originalContentUrl: qrImageUrl,
          previewImageUrl: qrImageUrl,
        },
      ]);
    }

    if (lowerCaseMessage === "จองคิว") {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists || !userDoc.data().phoneNumber) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: 'กรุณาพิมพ์ "ลงทะเบียน" ให้เสร็จสิ้นก่อนทำการจองคิวครับ',
        });
      }
      const existingQueueSnapshot = await db
        .collection("queues")
        .where("lineUserId", "==", userId)
        .where("status", "in", ["WAITING", "SERVING"])
        .get();
      if (!existingQueueSnapshot.empty) {
        const queueData = existingQueueSnapshot.docs[0].data();
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `คุณมีคิวอยู่แล้วครับ\nสถานะ: ${
            queueData.status === "SERVING"
              ? "กำลังใช้บริการห้อง " + queueData.roomNumber
              : "กำลังรอคิวที่ " + queueData.queueNumber
          }`,
        });
      }
      const servingSnapshot = await db
        .collection("queues")
        .where("status", "==", "SERVING")
        .get();
      if (servingSnapshot.size < TOTAL_ROOMS) {
        let assignedRoom = 0;
        for (let i = 1; i <= TOTAL_ROOMS; i++) {
          if (
            !servingSnapshot.docs
              .map((doc) => doc.data().roomNumber)
              .includes(i)
          ) {
            assignedRoom = i;
            break;
          }
        }
        await db
          .collection("queues")
          .add({
            lineUserId: userId,
            displayName: userDoc.data().displayName,
            status: "SERVING",
            checkInTime: new Date(),
            roomNumber: assignedRoom,
          });
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `ถึงคิวของคุณแล้ว! เชิญที่ห้องหมายเลข ${assignedRoom} ได้เลยครับ`,
        });
      } else {
        const allQueuesSnapshot = await db.collection("queues").get();
        const newQueueNumber = allQueuesSnapshot.size + 1;
        await db
          .collection("queues")
          .add({
            lineUserId: userId,
            displayName: userDoc.data().displayName,
            queueNumber: newQueueNumber,
            status: "WAITING",
            checkInTime: new Date(),
          });
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `เช็คอินสำเร็จ! คุณได้รับคิวที่ ${newQueueNumber} นะครับ\nตอนนี้ห้องเต็ม กรุณารอสักครู่`,
        });
      }
    }

    if (lowerCaseMessage === "เสร็จสิ้น") {
      const servingQueueSnapshot = await db
        .collection("queues")
        .where("lineUserId", "==", userId)
        .where("status", "==", "SERVING")
        .limit(1)
        .get();
      if (servingQueueSnapshot.empty) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "คุณยังไม่ได้เข้าใช้บริการเลยครับผม",
        });
      }
      const queueDoc = servingQueueSnapshot.docs[0];
      const finishedRoomNumber = queueDoc.data().roomNumber;
      await queueDoc.ref.update({ status: "FINISHED", finishTime: new Date() });
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `ขอบคุณที่ใช้บริการครับ! (ออกจากห้อง ${finishedRoomNumber})`,
      });
      return callNextUser(finishedRoomNumber);
    }

    if (lowerCaseMessage === "สถานะ" || lowerCaseMessage === "คิว") {
      const servingSnapshot = await db
        .collection("queues")
        .where("status", "==", "SERVING")
        .orderBy("checkInTime")
        .get();
      const waitingSnapshot = await db
        .collection("queues")
        .where("status", "==", "WAITING")
        .orderBy("queueNumber")
        .get();
      let servingText = servingSnapshot.empty
        ? "ตอนนี้ทุกห้องว่างครับ!"
        : "ห้องที่กำลังมีคนใช้:\n" +
          servingSnapshot.docs
            .map(
              (doc) =>
                `- ห้อง ${doc.data().roomNumber} (คุณ ${
                  doc.data().displayName
                })`
            )
            .join("\n");
      let waitingText = waitingSnapshot.empty
        ? "\nไม่มีคิวรอเลยครับ"
        : "\n\nคิวที่กำลังรอ:\n" +
          waitingSnapshot.docs
            .map(
              (doc) =>
                `- คิวที่ ${doc.data().queueNumber} (คุณ ${
                  doc.data().displayName
                })`
            )
            .join("\n");
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: servingText + waitingText,
      });
    }

    if (lowerCaseMessage === "bugo") {
      const projectUrl = process.env.BASE_URL; // ดึงค่าจาก Environment Variable ที่เราตั้งไว้;
      const bugoTrackerUrl = `${projectUrl}/bugo.html`;
      return client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "เปิดระบบติดตามรถกอล์ฟ Bugo",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "Bugo Tracker",
                weight: "bold",
                size: "xl",
              },
              {
                type: "text",
                text: "ระบบติดตามตำแหน่งรถกอล์ฟแบบ Real-time แตะปุ่มด้านล่างเพื่อเปิดแผนที่ครับและดูตำแหน่งของรถ",
                wrap: true,
                margin: "md",
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                height: "sm",
                action: {
                  type: "uri",
                  label: "เปิดแผนที่ติดตาม",
                  uri: bugoTrackerUrl,
                },
              },
            ],
          },
        },
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
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiReply,
    });
  } catch (error) {
    console.error("An error occurred in handleTextMessage:", error);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "ขออภัยครับ เกิดข้อผิดพลาดในระบบ",
    });
  }
}

// --- Helper Functions ---
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radius of the earth in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in meters
  return d;
}

async function callNextUser(freedRoomNumber) {
  const nextUserSnapshot = await db
    .collection("queues")
    .where("status", "==", "WAITING")
    .orderBy("queueNumber")
    .limit(1)
    .get();
  if (nextUserSnapshot.empty) {
    console.log(
      `Room ${freedRoomNumber} is now free. No users in waiting queue.`
    );
    return Promise.resolve(null);
  }
  const nextUserDoc = nextUserSnapshot.docs[0];
  const nextUserData = nextUserDoc.data();
  await nextUserDoc.ref.update({
    status: "SERVING",
    roomNumber: freedRoomNumber,
  });
  const notificationMessage = {
    type: "text",
    text: `ถึงคิวของคุณ ${nextUserData.displayName} แล้วครับ! (คิวที่ ${nextUserData.queueNumber})\nเชิญที่ห้องหมายเลข ${freedRoomNumber} ได้เลย`,
  };
  console.log(
    `Calling user ${nextUserData.displayName} (Queue: ${nextUserData.queueNumber}) to Room ${freedRoomNumber}`
  );
  return client.pushMessage(nextUserData.lineUserId, notificationMessage);
}

// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bursai Flexible Bot is listening on port ${port}`);
});
