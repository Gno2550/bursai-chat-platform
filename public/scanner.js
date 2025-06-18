// scanner.js (เวอร์ชันปรับปรุงใหม่ทั้งหมด)

document.addEventListener('DOMContentLoaded', function () {
    // --- 1. กำหนดค่าและ Element ที่ต้องใช้ ---
    const resultsDiv = document.getElementById('qr-reader-results');
    const VERIFY_API_URL = '/api/verify-check-in';
    
    // ประกาศตัวแปรสแกนเนอร์ไว้ด้านนอกเพื่อให้เข้าถึงได้จากทุกที่
    let html5QrcodeScanner;

    // --- 2. ฟังก์ชันที่จะทำงานเมื่อสแกนสำเร็จ ---
    function onScanSuccess(decodedText, decodedResult) {
        // หยุดการสแกนทันทีที่เจอ QR Code
        if (html5QrcodeScanner && html5QrcodeScanner.getState() === html5QrcodeScanner.ScannerState.SCANNING) {
            html5QrcodeScanner.pause();
        }

        resultsDiv.textContent = 'กำลังตรวจสอบ Token...';
        resultsDiv.className = '';

        // ใช้ AJAX (fetch) เพื่อส่ง Token ไปให้ Backend
        fetch(VERIFY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: decodedText })
        })
        .then(response => {
            // ตรวจสอบว่า response สำเร็จหรือไม่ ก่อนจะแปลงเป็น JSON
            if (!response.ok) {
                // ถ้า server ตอบกลับมาด้วย status error (เช่น 401, 409) ให้โยนเป็น error
                return response.json().then(err => { throw err; });
            }
            return response.json();
        })
        .then(data => {
            // แสดงผลลัพธ์ที่ได้จาก Backend
            resultsDiv.textContent = data.message;
            resultsDiv.className = 'success';
        })
        .catch(error => {
            // ดักจับ error ที่เรา throw มา หรือ error จาก network
            // error.message จะมาจาก JSON ที่ server ส่งกลับมา
            resultsDiv.textContent = `เกิดข้อผิดพลาด: ${error.message || 'ไม่สามารถเชื่อมต่อได้'}`;
            resultsDiv.className = 'error';
            console.error('API Error:', error);
        })
        .finally(() => {
            // ให้เริ่มสแกนใหม่หลังจากผ่านไป 5 วินาที ไม่ว่าผลลัพธ์จะเป็นอะไรก็ตาม
            setTimeout(() => {
                if (html5QrcodeScanner && html5QrcodeScanner.getState() === html5QrcodeScanner.ScannerState.PAUSED) {
                    resultsDiv.textContent = 'กรุณาหันกล้องไปที่ QR Code ของผู้ใช้...';
                    resultsDiv.className = '';
                    html5QrcodeScanner.resume();
                }
            }, 5000); // เพิ่มเวลาเป็น 5 วินาทีเพื่อให้พนักงานอ่านผลทัน
        });
    }

    // --- 3. ฟังก์ชันที่ทำงานเมื่อเกิด Error ตอนเปิดกล้อง ---
    function onScanFailure(error) {
        // ฟังก์ชันนี้จะถูกเรียกเมื่อไม่สามารถเริ่มการสแกนได้ ไม่ใช่ตอนสแกนไม่เจอ
        // เราสามารถปล่อยว่างไว้ได้ หรือจะแสดงข้อความก็ได้
        resultsDiv.textContent = 'ไม่สามารถเปิดใช้งานกล้องได้';
        resultsDiv.className = 'error';
        console.error(`QR Code scanner initialization failed: ${error}`);
    }

    // --- 4. สร้างและเริ่มการทำงานของสแกนเนอร์ ---
    // สร้าง object ของสแกนเนอร์
    html5QrcodeScanner = new html5QrcodeScanner(
        "qr-reader", 
        { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            facingMode: "environment" 
        },
        false // verbose
    );

    // เริ่มการทำงานของสแกนเนอร์
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});