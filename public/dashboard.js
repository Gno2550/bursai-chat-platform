// dashboard.js (เวอร์ชันปรับปรุง)
document.addEventListener('DOMContentLoaded', () => {
    // --- URLs & Intervals ---
    const STATS_API_URL = '/api/dashboard/stats';
    const UPDATE_INTERVAL = 30000; // 30 วินาที

    // --- DOM Elements ---
    const totalUsersStat = document.getElementById('total-users-stat');
    const registrationsTodayStat = document.getElementById('registrations-today-stat');
    const checkinsTodayStat = document.getElementById('checkins-today-stat');
    const servingListDiv = document.querySelector('.serving-list');
    const waitingListUl = document.querySelector('.waiting-list');
    const leaderboardOl = document.querySelector('.leaderboard-list'); 

    // --- Chart.js Setup ---
    const regCtx = document.getElementById('registration-chart').getContext('2d');
    let registrationChart = new Chart(regCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'ผู้ลงทะเบียนใหม่', data: [], borderColor: 'rgb(75, 192, 192)', borderWidth: 2, tension: 0.2, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
    
    const checkinCtx = document.getElementById('checkin-chart').getContext('2d');
    let checkinChart = new Chart(checkinCtx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'จำนวนเช็คอิน', data: [], backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgb(54, 162, 235)', borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    // --- Data Fetching & Rendering Function ---
    async function updateDashboard() {
        try {
            const response = await fetch(STATS_API_URL);
            const stats = await response.json();

            // สถิติหลัก
            totalUsersStat.textContent = stats.totalUsers;
            registrationsTodayStat.textContent = stats.registrationsToday;
            checkinsTodayStat.textContent = stats.checkinsToday;

            // สถานะคิว - กำลังให้บริการ
            servingListDiv.innerHTML = ''; 
            if (stats.queueStatus.serving.length > 0) {
                stats.queueStatus.serving.forEach(q => {
                    servingListDiv.innerHTML += `<div><strong>ห้อง ${q.roomNumber}:</strong> ${q.displayName}</div>`;
                });
            } else {
                servingListDiv.innerHTML = '<p>ไม่มีห้องที่ให้บริการ</p>';
            }

            // สถานะคิว - กำลังรอ
            waitingListUl.innerHTML = '';
            if (stats.queueStatus.waiting.length > 0) {
                 stats.queueStatus.waiting.forEach(q => {
                    waitingListUl.innerHTML += `<li><strong>คิวที่ ${q.queueNumber}:</strong> ${q.displayName}</li>`;
                });
            } else {
                waitingListUl.innerHTML = '<li>ไม่มีคิวรอ</li>';
            }
            
             // --- **[เพิ่มส่วนนี้]** อัปเดต Leaderboard ---
            leaderboardOl.innerHTML = ''; // Clear old data
            if (stats.staffLeaderboard && stats.staffLeaderboard.length > 0) {
                stats.staffLeaderboard.forEach((staff, index) => {
                    let medal = '';
                    if (index === 0) medal = '<span class="medal">🥇</span>';
                    else if (index === 1) medal = '<span class="medal">🥈</span>';
                    else if (index === 2) medal = '<span class="medal">🥉</span>';
                    else medal = `<span class="medal" style="font-size:1.1rem; width: 1.5rem; display: inline-block; text-align: center;">${index + 1}</span>`;

                    const listItem = `
                        <li>
                            ${medal}
                            <span class="staff-name">${staff.name}</span>
                            <span class="checkin-count">${staff.count} คน</span>
                        </li>
                    `;
                    leaderboardOl.innerHTML += listItem;
                });
            } else {
                leaderboardOl.innerHTML = '<li>ยังไม่มีข้อมูลการเช็คอินของ Staff วันนี้</li>';
            }
            // --- สิ้นสุดการเพิ่ม ---
            // กราฟลงทะเบียน
            registrationChart.data.labels = stats.registrationChartData.labels;
            registrationChart.data.datasets[0].data = stats.registrationChartData.data;
            registrationChart.update();
            
            // กราฟเช็คอิน
            checkinChart.data.labels = stats.checkinChartData.labels;
            checkinChart.data.datasets[0].data = stats.checkinChartData.data;
            checkinChart.update();

        } catch (error) {
            console.error("Failed to update dashboard:", error);
        }
    }

    // --- Initial Load & Interval ---
    updateDashboard();
    setInterval(updateDashboard, UPDATE_INTERVAL);
});