// driver.js (เวอร์ชันแก้ไข Syntax Error และจัดระเบียบ)
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM Elements & Global Variables ---
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    const API_URL = '/api/update-live-location';
    let watchId = null;
    let map;
    let driverMarker = null;
    
    // --- 2. Asset URLs (รวมไว้ที่เดียว) ---
    const driverIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/bugo-logo2.png?v=1750575455756', iconSize: [55, 60] });
    const stopIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/icons8-bus-stop-96.png?v=1750447498203', iconSize: [35, 35] });
    const startupAudioUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/0-%E0%B9%80%E0%B8%A3%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%95%E0%B8%B4.mp3?v=1750521728365";
    
    const notificationChimeUrl = "https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/chime.mp3?v=1750654848143";

    // --- 3. Audio Management System ---
    let isPlayingSequence = false;
    const audioQueue = [];

    function playNextInQueue() {
        if (audioQueue.length > 0) {
            const nextSpeechUrl = audioQueue.shift();
            playNotificationSequence(nextSpeechUrl);
        } else {
            isPlayingSequence = false;
        }
    }

    function playNotificationSequence(speechAudioUrl) {
        if (!speechAudioUrl) return;
        if (isPlayingSequence) {
            if (!audioQueue.includes(speechAudioUrl)) {
                audioQueue.push(speechAudioUrl);
            }
            return;
        }
        isPlayingSequence = true;
        const chimeSound = new Audio(notificationChimeUrl);
        const speechSound = new Audio(speechAudioUrl);
        chimeSound.play().catch(e => {
            console.error("Chime Error:", e);
            playNextInQueue();
        });
        chimeSound.addEventListener('ended', () => speechSound.play().catch(e => {
            console.error("Speech Error:", e);
            playNextInQueue();
        }));
        speechSound.addEventListener('ended', () => playNextInQueue());
        chimeSound.addEventListener('error', () => playNextInQueue());
        speechSound.addEventListener('error', () => playNextInQueue());
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
                    playNotificationSequence(data.audioUrl);
                }
            } else { throw new Error(data.message); }
        })
        .catch(err => { statusDiv.textContent = `เกิดข้อผิดพลาด: ${err.message}`; });
    }

    function handleError(error) {
        statusDiv.textContent = `GPS Error: ${error.message}`;
    }

    // --- 5. Event Listeners ---
    startBtn.addEventListener('click', () => {
        if (watchId) return;

        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });

        statusDiv.textContent = 'เริ่มการติดตาม...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        playNotificationSequence(startupAudioUrl);
    });

    stopBtn.addEventListener('click', () => {
        if (!watchId) return;

        navigator.geolocation.clearWatch(watchId);
        watchId = null;

        statusDiv.textContent = 'กำลังหยุดระบบ...';
        startBtn.disabled = true; 
        stopBtn.disabled = true;

        fetch('/api/stop-tracking', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    statusDiv.textContent = 'หยุดการติดตามแล้ว';
                    startBtn.disabled = false;
                } else {
                    throw new Error('Server failed to acknowledge stop.');
                }
            })
            .catch(error => {
                console.error('Failed to notify server of stop:', error);
                statusDiv.textContent = 'หยุด GPS แล้ว แต่แจ้งเซิร์ฟเวอร์ไม่สำเร็จ';
                startBtn.disabled = false;
            });
    });

    // --- 6. Initial Load ---
    initMap();
});