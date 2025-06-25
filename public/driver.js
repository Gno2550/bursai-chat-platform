// driver.js (เวอร์ชันสุดท้าย - แก้ไขและรวมทุกอย่างให้ถูกต้อง)
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM Elements & Global Variables ---
    const statusDiv = document.getElementById('status');
    const toggleBtn = document.getElementById('toggle-tracking-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const notificationPlayer = document.getElementById('notification-player');
    const API_URL = '/api/update-live-location';
    let watchId = null;
    let isTracking = false; // สถานะการติดตามปัจจุบัน
    let map;
    let driverMarker = null;

    // --- 2. Asset URLs ---
    const driverIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/bugo-logo2.png?v=1750575455756', iconSize: [55, 60] });
    const stopIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/icons8-bus-stop-96.png?v=1750447498203', iconSize: [35, 35] });
    const startupAudioUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/0-%E0%B9%80%E0%B8%A3%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%95%E0%B8%B4.mp3?v=1750521728365";
    const notificationChimeUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/chime.mp3?v=1750654848143";

    // --- 3. Audio Management System ---
    let isPlaying = false;
    const audioQueue = [];

    function playFromQueue() {
        if (isPlaying || audioQueue.length === 0) {
            return;
        }
        isPlaying = true;
        const nextUrl = audioQueue.shift();
        notificationPlayer.src = nextUrl;
        notificationPlayer.play().catch(e => {
            console.error("Playback Error:", e);
            isPlaying = false;
            playFromQueue();
        });
    }

    notificationPlayer.addEventListener('ended', () => {
        isPlaying = false;
        playFromQueue();
    });
    
    notificationPlayer.addEventListener('error', () => {
        console.error("An error occurred with the audio player.");
        isPlaying = false;
        playFromQueue();
    });

    function queueSound(speechUrl) {
        if (!speechUrl) return;
        audioQueue.push(notificationChimeUrl);
        audioQueue.push(speechUrl);
        playFromQueue();
    }

    // --- 4. Map & Core Logic Functions ---
    function initMap() {
        map = L.map('map', { zoomControl: false }).setView([13.9615, 100.6230], 18);
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

        if (latitude === 0 || longitude === 0) return;
        if (latitude < 5 || latitude > 21 || longitude < 97 || longitude > 106) return;
        
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
                    queueSound(data.audioUrl);
                }
            } else { throw new Error(data.message); }
        })
        .catch(err => { statusDiv.textContent = `เกิดข้อผิดพลาด: ${err.message}`; });
    }

    function handleError(error) {
        statusDiv.textContent = `GPS Error: ${error.message}`;
    }
    
    // --- 5. Tracking Control Functions ---
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
        statusDiv.textContent = 'กำลังติดตามตำแหน่ง...';
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

    // --- 6. Event Listeners ---
    toggleBtn.addEventListener('click', () => {
        if (isTracking) {
            stopTracking();
        } else {
            startTracking();
        }
    });

    
// --- **[แก้ไขส่วนนี้]** ---
fullscreenBtn.addEventListener('click', () => {
    // เราจะสั่งให้ Element หลักของหน้าเว็บ (<html>) เข้าสู่โหมดเต็มจอ
    const docEl = document.documentElement;

    // ตรวจสอบว่าตอนนี้ไม่ได้อยู่ในโหมดเต็มจอใช่หรือไม่
    if (!document.fullscreenElement) {
        // ถ้าเบราว์เซอร์รองรับ ให้สั่งให้เข้าโหมดเต็มจอ
        if (docEl.requestFullscreen) {
            docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) { /* สำหรับ Safari */
            docEl.webkitRequestFullscreen();
        } else if (docEl.msRequestFullscreen) { /* สำหรับ IE11 */
            docEl.msRequestFullscreen();
        }
    } else {
        // ถ้าอยู่ในโหมดเต็มจออยู่แล้ว ให้สั่งให้ออก
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* สำหรับ Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* สำหรับ IE11 */
            document.msExitFullscreen();
        }
    }
});
// --- สิ้นสุดการแก้ไข ---


    // --- 7. Initial Load ---
    initMap();
});