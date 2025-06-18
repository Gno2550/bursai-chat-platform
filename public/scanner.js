// scanner.js

const resultsDiv = document.getElementById('qr-reader-results');
const VERIFY_API_URL = '/api/verify-check-in'; // API ที่เราสร้างไว้ใน Backend

// ฟังก์ชันที่จะทำงานเมื่อสแกน QR Code ได้สำเร็จ
function onScanSuccess(decodedText, decodedResult) {
    // decodedText คือ Token String ที่เราต้องการ
    
    // หยุดการสแกนชั่วคราว
    html5QrcodeScanner.pause();
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
    .then(response => response.json())
    .then(data => {
        // แสดงผลลัพธ์ที่ได้จาก Backend
        if (data.success) {
            resultsDiv.textContent = data.message;
            resultsDiv.className = 'success';
        } else {
            resultsDiv.textContent = `เกิดข้อผิดพลาด: ${data.message}`;
            resultsDiv.className = 'error';
        }
    })
    .catch(error => {
        resultsDiv.textContent = 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้';
        resultsDiv.className = 'error';
        console.error('Fetch error:', error);
    })
    .finally(() => {
        // ให้เริ่มสแกนใหม่หลังจากผ่านไป 3 วินาที
        setTimeout(() => {
            resultsDiv.textContent = 'กรุณาหันกล้องไปที่ QR Code ของผู้ใช้...';
            resultsDiv.className = '';
            html5QrcodeScanner.resume();
        }, 3000);
    });
}

// ฟังก์ชันที่ทำงานเมื่อเกิด Error (เช่น ไม่สามารถเปิดกล้องได้)
function onScanFailure(error) {
    console.warn(`QR Code scan error = ${error}`);
}

// สร้างและเริ่มการทำงานของสแกนเนอร์
let html5QrcodeScanner = new html5QrcodeScanner(
    "qr-reader", // ID ของ div ที่จะให้แสดงกล้อง
    { fps: 10, qrbox: { width: 250, height: 250 } }, // ตั้งค่าการสแกน
    false // verbose
);
html5QrcodeScanner.render(onScanSuccess, onScanFailure);