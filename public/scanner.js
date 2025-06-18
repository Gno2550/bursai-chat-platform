// scanner.js (เวอร์ชันแก้ไข Html5Qrcode is not defined)

document.addEventListener('DOMContentLoaded', function () {
    const resultsDiv = document.getElementById('qr-reader-results');
    const VERIFY_API_URL = '/api/verify-check-in';

    // ประกาศตัวแปรสแกนเนอร์ไว้ที่นี่
    let html5QrcodeScanner;

    function onScanSuccess(decodedText, decodedResult) {
        // เมื่อสแกนสำเร็จ ให้หยุดสแกนเนอร์ชั่วคราว
        // เราสามารถเข้าถึง html5QrcodeScanner ที่ประกาศไว้ด้านนอกได้
        html5QrcodeScanner.pause();

        resultsDiv.textContent = 'กำลังตรวจสอบ Token...';
        resultsDiv.className = '';

        fetch(VERIFY_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: decodedText })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw err; });
            }
            return response.json();
        })
        .then(data => {
            resultsDiv.textContent = data.message;
            resultsDiv.className = 'success';
        })
        .catch(error => {
            resultsDiv.textContent = `เกิดข้อผิดพลาด: ${error.message || 'ไม่สามารถเชื่อมต่อได้'}`;
            resultsDiv.className = 'error';
            console.error('API Error:', error);
        })
        .finally(() => {
            // ให้เริ่มสแกนใหม่หลังจากผ่านไป 5 วินาที
            setTimeout(() => {
                // ** แก้ไขจุดที่ 1: ตรวจสอบสถานะด้วย getState() แต่ไม่ต้องใช้ Class แม่ **
                if (html5QrcodeScanner && html5QrcodeScanner.getState() === 2) { // 2 คือสถานะ PAUSED
                    resultsDiv.textContent = 'กรุณาหันกล้องไปที่ QR Code ของผู้ใช้...';
                    resultsDiv.className = '';
                    html5QrcodeScanner.resume();
                }
            }, 5000);
        });
    }

    function onScanFailure(error) {
        resultsDiv.textContent = 'ไม่สามารถเปิดใช้งานกล้องได้';
        resultsDiv.className = 'error';
        console.error(`QR Code scanner initialization failed: ${error}`);
    }

    // สร้าง object ของสแกนเนอร์ และกำหนดค่าให้กับตัวแปรที่ประกาศไว้
    html5QrcodeScanner = new html5QrcodeScanner( // ** แก้ไขจุดที่ 2: ใช้ชื่อ Class ที่ถูกต้อง **
        "qr-reader", 
        { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            facingMode: "environment" 
        },
        false
    );

    // เริ่มการทำงานของสแกนเนอร์
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});