// dashboard.js
document.addEventListener('DOMContentLoaded', () => {
    // --- URLs & Intervals ---
    const STATS_API_URL = '/api/dashboard/stats';
    const BUGO_API_URL = '/api/bugo-status';
    const STOPS_API_URL = '/api/bus-stops';
    const UPDATE_INTERVAL = 10000; // 10 วินาที

    // --- DOM Elements ---
    const totalUsersStat = document.getElementById('total-users-stat');
    const checkinsTodayStat = document.getElementById('checkins-today-stat');
    const servingListDiv = document.querySelector('.serving-list');
    const waitingListUl = document.querySelector('.waiting-list');
    const busStopListDiv = document.getElementById('bus-stop-list');
    const cartStatusSpan = document.getElementById('cart-status');

    // --- Chart.js Setup ---
    const ctx = document.getElementById('user-chart').getContext('2d');
    let userChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'ผู้ลงทะเบียนใหม่', data: [], borderWidth: 2, tension: 0.2 }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
    
    // --- Leaflet Map Setup ---
    let map;
    let cartMarker = null;
    const busStopIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/icons8-bus-stop-96.png?v=1750447498203', iconSize: [35, 35] });
    const cartIcon = L.icon({ iconUrl: 'https://cdn.glitch.global/4a2b378a-09fc-47bc-b98f-5ba993690b44/icons8-golf-cart-80.png?v=1750438227729', iconSize: [45, 45] });

    function initMap() {
        map = L.map('map').setView([13.9615, 100.6230], 18);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        
        // ทำให้ Admin สามารถเพิ่มจุดจอดได้จากหน้านี้
        map.on('click', (e) => {
            const stopName = prompt("กรุณาใส่ชื่อจุดจอดใหม่:");
            if (stopName) {
                addBusStop(stopName, e.latlng.lat, e.latlng.lng);
            }
        });
    }

    // --- Data Fetching & Rendering Functions ---

    // 1. อัปเดตสถิติและคิวทั้งหมด
    async function updateDashboardStats() {
        try {
            const response = await fetch(STATS_API_URL);
            const stats = await response.json();

            // สถิติหลัก
            totalUsersStat.textContent = stats.totalUsers;
            checkinsTodayStat.textContent = stats.checkinsToday;

            // สถานะคิว - กำลังให้บริการ
            servingListDiv.innerHTML = ''; // Clear old data
            if (stats.queueStatus.serving.length > 0) {
                stats.queueStatus.serving.forEach(q => {
                    servingListDiv.innerHTML += `<div><strong>ห้อง ${q.roomNumber}:</strong> ${q.displayName}</div>`;
                });
            } else {
                servingListDiv.innerHTML = '<p>ไม่มีห้องที่ให้บริการ</p>';
            }

            // สถานะคิว - กำลังรอ
            waitingListUl.innerHTML = ''; // Clear old data
            if (stats.queueStatus.waiting.length > 0) {
                 stats.queueStatus.waiting.forEach(q => {
                    waitingListUl.innerHTML += `<li><strong>คิวที่ ${q.queueNumber}:</strong> ${q.displayName}</li>`;
                });
            } else {
                waitingListUl.innerHTML = '<li>ไม่มีคิวรอ</li>';
            }
            
            // กราฟ
            userChart.data.labels = stats.userChartData.labels;
            userChart.data.datasets[0].data = stats.userChartData.data;
            userChart.update();

        } catch (error) {
            console.error("Failed to update dashboard stats:", error);
        }
    }

    // 2. อัปเดตแผนที่และรายการป้ายรถ
    async function updateMapAndStops() {
        // อัปเดตรถ
        try {
            const response = await fetch(BUGO_API_URL);
            const data = await response.json();
            const cartPosition = [data.location._latitude, data.location._longitude];
            
            if (!cartMarker) {
                cartMarker = L.Marker.movingMarker([cartPosition, cartPosition], [], { autostart: true, icon: cartIcon }).addTo(map);
            } else {
                cartMarker.moveTo(cartPosition, 4500);
            }
            cartStatusSpan.textContent = data.status;
        } catch (error) {
            console.error("Failed to update cart position:", error);
            cartStatusSpan.textContent = "ขาดการเชื่อมต่อ";
        }
        
        // อัปเดตป้ายรถและรายการ
        try {
            const response = await fetch(STOPS_API_URL);
            const stops = await response.json();
            busStopListDiv.innerHTML = '<h4>รายการป้ายทั้งหมด</h4>';
            stops.forEach(stop => {
                L.marker([stop.location._latitude, stop.location._longitude], { icon: busStopIcon }).addTo(map);
                busStopListDiv.innerHTML += `<div class="bus-stop-item"><span>${stop.name}</span><button onclick="deleteBusStop('${stop.id}')">ลบ</button></div>`;
            });
        } catch (error) {
             console.error("Failed to update bus stops:", error);
        }
    }

    // --- Helper Functions for Bus Stop Management ---
    async function addBusStop(name, lat, lng) {
        await fetch('/api/add-bus-stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, latitude: lat, longitude: lng })
        });
        alert("เพิ่มจุดจอดสำเร็จ!");
        updateMapAndStops(); // Refresh map
    }
    
    window.deleteBusStop = async (id) => {
        if (confirm("คุณแน่ใจหรือไม่ว่าจะลบจุดจอดนี้?")) {
            await fetch(`/api/delete-bus-stop/${id}`, { method: 'DELETE' });
            alert("ลบจุดจอดสำเร็จ!");
            window.location.reload(); // ง่ายที่สุดคือโหลดหน้าใหม่เลย
        }
    }


    // --- Initial Load & Interval ---
    initMap();
    updateDashboardStats();
    updateMapAndStops();
    setInterval(() => {
        updateDashboardStats();
        updateMapAndStops();
    }, UPDATE_INTERVAL);
});