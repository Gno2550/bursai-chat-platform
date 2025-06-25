// driver.js (เวอร์ชันแก้ไขระบบเสียงสมบูรณ์)
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM Elements & Global Variables ---
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    const notificationPlayer = document.getElementById('notification-player'); // Player หลัก
    const API_URL = '/api/update-live-location';
    let watchId = null;
    let map;
    let driverMarker = null;
    
    // --- 2. Asset URLs ---
    const driverIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/bugo-logo2.png?v=1750575455756', iconSize: [55, 60] });
    const stopIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/icons8-bus-stop-96.png?v=1750447498203', iconSize: [35, 35] });
    const startupAudioUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/0-%E0%B9%80%E0%B8%A3%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%95%E0%B8%B4.mp3?v=1750521728365";
    const notificationChimeUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/chime.mp3?v=1750654848143";

    // --- 3. Robust Audio Management System ---
    let isPlaying = false;
    const audioQueue = [];

    function playFromQueue() {
        if (isPlaying || audioQueue.length === 0) {
            return; // ถ้ากำลังเล่นอยู่ หรือคิวว่าง ให้หยุด
        }

        isPlaying = true;
        const nextUrl = audioQueue.shift(); // ดึงเสียงถัดไปออกจากคิว
        console.log("Now playing from queue:", nextUrl);
        
        notificationPlayer.src = nextUrl;
        notificationPlayer.play().catch(e => {
            console.error("Playback Error:", e);
            isPlaying = false; // ปลดล็อกถ้าเล่นไม่ได้
            playFromQueue(); // พยายามเล่นเสียงถัดไป
        });
    }

    notificationPlayer.addEventListener('ended', () => {
        console.log("Audio finished playing.");
        isPlaying = false;
        playFromQueue(); // เมื่อเล่นจบ ให้เล่นเสียงถัดไปในคิว
    });
    
    notificationPlayer.addEventListener('error', () => {
        console.error("An error occurred with the audio player.");
        isPlaying = false;
        playFromQueue();
    });

    function queueSound(speechUrl) {
        if (!speechUrl) return;
        // เพิ่มเสียงสัญญาณนำก่อนเสมอ
        audioQueue.push(notificationChimeUrl);
        audioQueue.push(speechUrl);
        console.log("Queued sounds. Current queue:", audioQueue);
        playFromQueue(); // เริ่มเล่นทันทีถ้า Player ว่างอยู่
    }

    // --- 4. Map & Core Logic Functions ---
    function initMap() {
        map = L.map('map').setView([13.9615, 100.6230], 18);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        drawBusStops();
    }

    async function drawBusStops() {
        try {
            const response = await fetch('/api/bus-stops');
            const stops = await response.json();
            stops.forEach(stop => {
                if (stop.location) {
                    L.marker([stop.location._latitude, stop.location._longitude], { icon: stopIcon })
                     .addTo(map).bindPopup(stop.name);
                }
            });
        } catch (error) {
            console.error("Could not draw bus stops:", error);
        }
    }

    function updateLocation(position) {
        const { latitude, longitude } = position.coords;

        if (latitude === 0 || longitude === 0) { return; }
        if (latitude < 5 || latitude > 21 || longitude < 97 || longitude > 106) { return; }
        
        const driverPosition = [latitude, longitude];
        if (!driverMarker) {
            driverMarker = L.marker(driverPosition, { icon: driverIcon }).addTo(map);
        } else {
            driverMarker.setLatLng(driverPosition);
        }
        map.panTo(driverPosition);

        statusDiv.textContent = `กำลังส่งตำแหน่ง...`;
        
        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                statusDiv.textContent = `ส่งตำแหน่งล่าสุดแล้ว!`;
                if (data.audioUrl) {
                    // เรียกใช้ฟังก์ชันใหม่เพื่อเอาเสียงไปต่อคิว
                    queueSound(data.audioUrl);
                }
            } else { throw new Error(data.message); }
        })
        .catch(err => { statusDiv.textContent = `เกิดข้อผิดพลาด: ${err.message}`; });
    }

    function handleError(error) {
        statusDiv.textContent = `GPS Error: ${error.message}`;
    }
    
// --- **[ใหม่]** ฟังก์ชันควบคุมการเริ่ม/หยุด ---
function startTracking() {
    if (isTracking) return;

    // ปลดล็อก Audio Context
    if (notificationPlayer.paused) {
       notificationPlayer.play().catch(() => {});
       notificationPlayer.pause();
    }

    watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0
    });

    isTracking = true;
    statusDiv.textContent = 'เริ่มการติดตาม...';
    toggleBtn.textContent = 'หยุดการติดตาม';
    toggleBtn.className = 'stop';
    
    queueSound(startupAudioUrl);
}

function stopTracking() {
    if (!isTracking) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isTracking = false;

    statusDiv.textContent = 'กำลังหยุดระบบ...';
    toggleBtn.disabled = true;

    fetch('/api/stop-tracking', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                statusDiv.textContent = 'หยุดการติดตามแล้ว';
            } else { throw new Error('Server failed to acknowledge stop.'); }
        })
        .catch(error => {
            console.error('Failed to notify server of stop:', error);
            statusDiv.textContent = 'หยุด GPS แล้ว แต่แจ้งเซิร์ฟเวอร์ไม่สำเร็จ';
        })
        .finally(() => {
            toggleBtn.textContent = 'เริ่มการติดตาม';
            toggleBtn.className = 'start';
            toggleBtn.disabled = false;
        });
}

// --- Event Listeners ---
toggleBtn.addEventListener('click', () => {
    if (isTracking) {
        stopTracking();
    } else {
        startTracking();
    }
});

fullscreenBtn.addEventListener('click', () => {
    const mapContainer = document.getElementById('map-container');
    if (!document.fullscreenElement) {
        mapContainer.requestFullscreen().catch(err => {
            alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    } else {
        document.exitFullscreen();
    }
});
 // --- 6. Initial Load ---
    initMap();
});