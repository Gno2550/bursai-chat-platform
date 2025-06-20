// driver.js (Automatic GPS Tracking)
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    let watchId = null; // ตัวแปรสำหรับเก็บ ID ของ watchPosition

    const API_URL = '/api/update-live-location';

    function updateLocation(position) {
        const { latitude, longitude, speed, heading } = position.coords;
        const statusText = `Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`;
        statusDiv.textContent = `กำลังส่งตำแหน่ง... (${statusText})`;
        statusDiv.style.color = 'blue';

        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude,
                longitude,
                // ส่งความเร็วและทิศทางไปด้วย (ถ้ามี) เพื่อการคำนวณที่แม่นยำขึ้นในอนาคต
                speed: speed || 0, 
                heading: heading || 0 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                statusDiv.textContent = `ส่งตำแหน่งล่าสุดแล้ว! (${new Date().toLocaleTimeString()})`;
                statusDiv.style.color = 'green';
            } else {
                throw new Error(data.message);
            }
        })
        .catch(err => {
            statusDiv.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
            statusDiv.style.color = 'red';
        });
    }

    function handleError(error) {
        statusDiv.textContent = `เกิดข้อผิดพลาดในการเข้าถึง GPS: ${error.message}`;
        statusDiv.style.color = 'red';
    }

    startBtn.addEventListener('click', () => {
        if (watchId) return; // ป้องกันการกดซ้ำ
        
        // เริ่มการติดตามตำแหน่งแบบ real-time
        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true, // ขอความแม่นยำสูงสุด
            timeout: 10000,
            maximumAge: 0
        });
        statusDiv.textContent = 'เริ่มการติดตามตำแหน่งแล้ว...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
    });

    stopBtn.addEventListener('click', () => {
        if (!watchId) return;

        // หยุดการติดตาม
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        statusDiv.textContent = 'หยุดการติดตามแล้ว';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });
});