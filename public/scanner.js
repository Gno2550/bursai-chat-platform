document.addEventListener('DOMContentLoaded', function () {
    const staffToken = localStorage.getItem('staffToken');
    const staffName = localStorage.getItem('staffName');

    if (!staffToken) {
        window.location.href = '/login.html';
        return; 
    }

    document.getElementById('staff-name').textContent = staffName;
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('staffToken');
        localStorage.removeItem('staffName');
        window.location.href = '/login.html';
    });

    const resultsDiv = document.getElementById('qr-reader-results');
    
    function onScanSuccess(decodedText, decodedResult) {
        html5QrcodeScanner.pause();
        resultsDiv.textContent = 'กำลังตรวจสอบ Token...';
        resultsDiv.className = '';

        fetch('/api/verify-check-in', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${staffToken}` 
            },
            body: JSON.stringify({ token: decodedText })
        })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (ok) {
                resultsDiv.textContent = data.message;
                resultsDiv.className = 'success';
            } else {
                throw new Error(data.message);
            }
        })
        .catch(error => {
            resultsDiv.textContent = `เกิดข้อผิดพลาด: ${error.message || 'ไม่สามารถเชื่อมต่อได้'}`;
            resultsDiv.className = 'error';
            console.error('API Error:', error);
        })
        .finally(() => {
            setTimeout(() => {
                if (html5QrcodeScanner.getState() === 2) { // 2 = PAUSED
                    resultsDiv.textContent = 'กรุณาหันกล้องไปที่ QR Code ของผู้ใช้...';
                    resultsDiv.className = '';
                    html5QrcodeScanner.resume();
                }
            }, 5000);
        });
    }

    function onScanFailure(error) { }

    const html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 }, facingMode: "environment" }, false);
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
});