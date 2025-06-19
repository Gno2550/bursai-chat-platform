document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('displayName').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const orgSecret = document.getElementById('orgSecret').value;
    const responseMsg = document.getElementById('response-msg');
    responseMsg.textContent = '';
    responseMsg.className = '';
    try {
        const response = await fetch('/api/staff-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, username, password, orgSecret })
        });
        const data = await response.json();
        if (data.success) {
            responseMsg.textContent = data.message;
            responseMsg.className = 'success';
            alert('สมัครสมาชิกสำเร็จ! กำลังกลับไปที่หน้าล็อกอิน');
            window.location.href = '/login.html';
        } else {
            responseMsg.textContent = data.message;
            responseMsg.className = 'error';
        }
    } catch (err) {
        responseMsg.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
        responseMsg.className = 'error';
    }
});