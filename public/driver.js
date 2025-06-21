// driver.js (Automatic GPS Tracking - FINAL VERSION)
// driver.js (Automatic GPS Tracking - with Audio Notification)
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    let watchId = null;

    // **[เพิ่ม]** สร้าง Audio object ไว้ใช้ซ้ำ
    const notificationSound = new Audio();

    const API_URL = '/api/update-live-location';

    function updateLocation(position) {
        const { latitude, longitude, speed, heading } = position.coords;

        // --- **[แก้ไข]** เพิ่มด่านตรวจพิกัด ---
        // 1. ตรวจสอบว่าพิกัดไม่ใช่ (0, 0)
        // 2. ตรวจสอบคร่าวๆ ว่าพิกัดอยู่ในประเทศไทย (ละติจูด 5-21, ลองจิจูด 97-106)
        if (latitude === 0 && longitude === 0) {
            statusDiv.textContent = 'กำลังรอสัญญาณ GPS ที่แม่นยำ...';
            statusDiv.style.color = 'orange';
            return; // ไม่ส่งข้อมูลถ้าพิกัดเป็น 0,0
        }
        if (latitude < 5 || latitude > 21 || longitude < 97 || longitude > 106) {
             statusDiv.textContent = `พิกัดไม่ถูกต้อง (${latitude.toFixed(2)}, ${longitude.toFixed(2)}), กำลังหาตำแหน่งใหม่...`;
             statusDiv.style.color = 'orange';
             return; // ไม่ส่งข้อมูลถ้าพิกัดอยู่นอกประเทศไทย
        }
        // --- สิ้นสุดส่วนแก้ไข ---

        const statusText = `Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`;
        statusDiv.textContent = `กำลังส่งตำแหน่ง... (${statusText})`;
        statusDiv.style.color = 'blue';

        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude,
                longitude,
                speed: speed || 0, 
                heading: heading || 0 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                statusDiv.textContent = `ส่งตำแหน่งล่าสุดแล้ว! (${new Date().toLocaleTimeString()})`;
                statusDiv.style.color = 'green';
             // --- **[เพิ่ม Logic เล่นเสียง]** ---
            if (data.audioUrl) {
                    console.log("Received audio URL:", data.audioUrl);
                    notificationSound.src = data.audioUrl;
                    notificationSound.play().catch(e => console.error("Error playing audio:", e));
                }
                // --- สิ้นสุด Logic ---
            } else {
                throw new Error(data.message || 'Server returned an error');
            }
        })
        .catch(err => {
            statusDiv.textContent = `เกิดข้อผิดพลาดในการส่งข้อมูล: ${err.message}`;
            statusDiv.style.color = 'red';
        });
    }

    function handleError(error) {
        let message = '';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = "คุณปฏิเสธการเข้าถึงตำแหน่ง";
                break;
            case error.POSITION_UNAVAILABLE:
                message = "ไม่สามารถหาตำแหน่งปัจจุบันได้";
                break;
            case error.TIMEOUT:
                message = "หมดเวลาในการค้นหาตำแหน่ง";
                break;
            default:
                message = "เกิดข้อผิดพลาดที่ไม่รู้จัก";
                break;
        }
        statusDiv.textContent = `เกิดข้อผิดพลาด GPS: ${message}`;
        statusDiv.style.color = 'red';
    }

    startBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            statusDiv.textContent = 'เบราว์เซอร์นี้ไม่รองรับ Geolocation';
            return;
        }
        if (watchId) return;
        
        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
        statusDiv.textContent = 'เริ่มการติดตามตำแหน่งแล้ว...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
    });

    stopBtn.addEventListener('click', () => {
        if (!watchId) return;

        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        statusDiv.textContent = 'หยุดการติดตามแล้ว';
        statusDiv.style.color = 'black';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });
});