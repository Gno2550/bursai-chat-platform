// driver.js (เวอร์ชันแก้ไขสมบูรณ์และถูกต้องที่สุด)
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    let watchId = null;

    // สร้าง Audio object ไว้ใช้ซ้ำสำหรับเสียงแจ้งเตือน "ถึงแล้ว"
    const notificationSound = new Audio();

    const API_URL = '/api/update-live-location';

    function updateLocation(position) {
        const { latitude, longitude, speed, heading } = position.coords;

        // ด่านตรวจพิกัดที่แม่นยำ ป้องกันพิกัดที่ผิดพลาด
        if (latitude === 0 && longitude === 0) {
            statusDiv.textContent = 'กำลังรอสัญญาณ GPS ที่แม่นยำ...';
            statusDiv.style.color = 'orange';
            return;
        }
        if (latitude < 5 || latitude > 21 || longitude < 97 || longitude > 106) {
             statusDiv.textContent = `พิกัดไม่ถูกต้อง (${latitude.toFixed(2)}, ${longitude.toFixed(2)}), กำลังหาตำแหน่งใหม่...`;
             statusDiv.style.color = 'orange';
             return;
        }
        
        const statusText = `Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`;
        statusDiv.textContent = `กำลังส่งตำแหน่ง... (${statusText})`;
        statusDiv.style.color = 'blue';

        // ส่งข้อมูลตำแหน่งไปยังเซิร์ฟเวอร์
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
        .then(res => {
            if (!res.ok) {
                throw new Error(`Network response was not ok, status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success) {
                statusDiv.textContent = `ส่งตำแหน่งล่าสุดแล้ว! (${new Date().toLocaleTimeString()})`;
                statusDiv.style.color = 'green';

                // Logic เล่นเสียงแจ้งเตือนเมื่อถึงป้าย (จากเซิร์ฟเวอร์)
                if (data.audioUrl) {
                    console.log("Received arrival audio URL:", data.audioUrl);
                    notificationSound.src = data.audioUrl;
                    notificationSound.play().catch(e => console.error("Error playing arrival audio:", e));
                }
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

        // เริ่มติดตามตำแหน่ง GPS
        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true, 
            timeout: 10000, 
            maximumAge: 0
        });

        // อัปเดตสถานะบนหน้าเว็บ
        statusDiv.textContent = 'เริ่มการติดตามตำแหน่งแล้ว...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // --- [Logic การเล่นเสียงตอนเริ่มต้น ที่ถูกต้องและสมบูรณ์] ---
        try {
            const startSound = new Audio();
            
            // 1. ตั้งค่า Event Listener: "ถ้าโหลดเสียงนี้พร้อมเล่นเมื่อไหร่ ให้สั่ง play ทันที"
            // ใช้ { once: true } เพื่อให้ Listener ทำงานแค่ครั้งเดียวแล้วลบตัวเองทิ้งไป
            startSound.addEventListener('canplaythrough', () => {
                console.log("Start-up audio is ready to play.");
                startSound.play().catch(e => console.error("Error playing start audio:", e));
            }, { once: true });

            startSound.addEventListener('error', (e) => {
                console.error("An error occurred with the start-up audio:", e);
                // อาจจะแสดงข้อความบน UI ด้วยก็ได้
                // statusDiv.textContent = 'ไม่สามารถเล่นเสียงเริ่มต้นได้';
            });
            
            // 2. สร้าง URL สำหรับเรียก API ของ Botnoi
            const apiKey = "iqLAn3GJUe6DfxCSrwQFtY8WbIcxibzf";
            const textToSpeak = "เริ่มการติดตามด้วยระบบบียูโก";
            const encodedText = encodeURIComponent(textToSpeak);
            const startAudioUrl = `https://botnoi-voice.onrender.com/api/v1/tts?text=${encodedText}&speaker=b_male&speed=1&type=wav&auth=${apiKey}`;
            
            // 3. กำหนด URL ให้กับ Audio object (ขั้นตอนนี้จะเริ่มกระบวนการดาวน์โหลดเสียง)
            console.log("Requesting start-up audio from Botnoi...");
            startSound.src = startAudioUrl;

        } catch (error) {
            console.error("Could not initialize start-up sound:", error);
        }
        // --- สิ้นสุด Logic การเล่นเสียง ---
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