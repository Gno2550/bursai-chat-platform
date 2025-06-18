// scanner.js

document.addEventListener('DOMContentLoaded', function () {
    const resultsDiv = document.getElementById('qr-reader-results');
    const VERIFY_API_URL = '/api/verify-check-in';

    function onScanSuccess(decodedText, decodedResult) {
        // เมื่อสแกนสำเร็จ ให้หยุดสแกนเนอร์ชั่วคราว
        // เราสามารถเข้าถึง html5QrcodeScanner ได้ เพราะมันอยู่ใน Scope เดียวกัน
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
                if (html5QrcodeScanner.getState() === html5QrcodeScanner.ScannerState.PAUSED) {
                    resultsDiv.textContent = 'กรุณาหันกล้องไปที่ QR Code ของผู้ใช้...';
                    resultsDiv.className = '';
                    html5QrcodeScanner.resume();
                }
            }, 3000);
        });
    }

    function onScanFailure(error) {
        // เราสามารถเลือกที่จะไม่แสดง console.warn เพื่อไม่ให้ดูรกได้
        // console.warn(`QR Code scan error = ${error}`);
    }

    // สร้าง object ของสแกนเนอร์
    const html5QrcodeScanner = new html5QrcodeScanner(
        "qr-reader", // ID ของ div ที่จะให้แสดงกล้อง
        { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            // เพิ่มตัวเลือกให้ใช้กล้องหลังบนมือถือเป็นหลัก
            facingMode: "environment" 
        },
        false // verbose
    );

    // เริ่มการทำงานของสแกนเนอร์
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});