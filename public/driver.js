// driver.js (Automatic GPS Tracking - FINAL VERSION)
document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-tracking');
    const stopBtn = document.getElementById('stop-tracking');
    let watchId = null;

    // สร้าง Audio object ไว้ใช้ซ้ำสำหรับเสียงแจ้งเตือน
    const notificationSound = new Audio();

    const API_URL = '/api/update-live-location';

    function updateLocation(position) {
        const { latitude, longitude, speed, heading } = position.coords;

        // ด่านตรวจพิกัดที่แม่นยำ
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

                // Logic เล่นเสียงแจ้งเตือนเมื่อถึงป้าย
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
        
        watchId = navigator.geolocation.watchPosition(updateLocation, handleError, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });

        statusDiv.textContent = 'เริ่มการติดตามตำแหน่งแล้ว...';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Logic เล่นเสียงตอนเริ่มต้น
        try {
            const apiKey = "iqLAn3GJUe6DfxCSrwQFtY8WbIcxibzf";
            const textToSpeak = "เริ่มการติดตามด้วยระบบบียูโก";
            const encodedText = encodeURIComponent(textToSpeak);
            
            const startAudioUrl = `https://botnoi-voice.onrender.com/api/v1/tts?text=${encodedText}&speaker=b_male&speed=1&type=wav&auth=${apiKey}`;
            
            console.log("Playing start-up audio with API Key.");
            const startSound = new Audio(startAudioUrl);
            startSound.play().catch(e => console.error("Error playing start audio:", e));

        } catch (error) {
            console.error("Could not play start-up sound:", error);
        }
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