document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements & Global Vars ---
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    let watchId = null;
    const notificationSound = new Audio();
    const API_URL = '/api/update-live-location';

    // --- Leaflet Map Setup ---
    let map;
    let driverMarker = null;
    const driverIcon = L.icon({ iconUrl: 'YOUR_GOLF_CART_ICON_URL', iconSize: [45, 45] });
    const stopIcon = L.icon({ iconUrl: 'YOUR_BUS_STOP_ICON_URL', iconSize: [35, 35] });

    function initMap() {
        map = L.map('map').setView([13.9615, 100.6230], 18);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        drawBusStops(); // วาดป้ายรถเมล์ตอนเริ่ม
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

    // --- Core Functions ---
    function updateLocation(position) {
        const { latitude, longitude } = position.coords;

        if (latitude === 0 && longitude === 0) { /* ... */ return; }
        if (latitude < 5 || latitude > 21 || longitude < 97 || longitude > 106) { /* ... */ return; }
        
        // **[ใหม่]** อัปเดตตำแหน่ง Marker บนแผนที่
        const driverPosition = [latitude, longitude];
        if (!driverMarker) {
            driverMarker = L.marker(driverPosition, { icon: driverIcon }).addTo(map);
        } else {
            driverMarker.setLatLng(driverPosition);
        }
        map.panTo(driverPosition); // เลื่อนแผนที่ตามคนขับ

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
                    console.log("Received audio URL:", data.audioUrl);
                    notificationSound.src = data.audioUrl;
                    notificationSound.play().catch(e => console.error("Error playing audio:", e));
                }
            } else { throw new Error(data.message); }
        })
        .catch(err => { statusDiv.textContent = `เกิดข้อผิดพลาด: ${err.message}`; });
    }

    function handleError(error) { /* ... เหมือนเดิม ... */ }

    // --- Event Listeners ---
    startBtn.addEventListener('click', () => {
        if (watchId) return;

        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });

        statusDiv.textContent = 'เริ่มการติดตาม...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // เล่นเสียงเริ่มต้น (จากไฟล์ใน assets)
        try {
            const startAudioUrl = "YOUR_STARTUP_MP3_URL_FROM_ASSETS";
            const startSound = new Audio(startAudioUrl);
            startSound.play().catch(e => console.error("Error playing start audio:", e));
        } catch (error) { console.error("Could not play start-up sound:", error); }
    });

    stopBtn.addEventListener('click', () => {
        if (!watchId) return;
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        statusDiv.textContent = 'หยุดการติดตามแล้ว';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });

    // --- Initial Load ---
    initMap();
});