document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');
    errorMsg.textContent = '';
    try {
        const response = await fetch('/api/staff-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('staffToken', data.token);
            localStorage.setItem('staffName', data.staffName);
            window.location.href = '/scanner.html';
        } else {
            errorMsg.textContent = data.message;
        }
    } catch (err) {
        errorMsg.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
    }
});