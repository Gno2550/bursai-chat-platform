// bugo.js

// --- 1. การตั้งค่าเริ่มต้น ---
const API_URL = '/api/bugo-status';
const UPDATE_INTERVAL = 5000; // 5 วินาที

// พิกัดจุดศูนย์กลางของแผนที่และระดับการซูม
const mapCenter = [13.7563, 100.5018]; 
const mapZoom = 15;

// ไอคอนสำหรับรถกอล์ฟและป้ายรถ
const cartIcon = L.icon({ iconUrl: 'https://img.icons8.com/plasticine/100/golf-cart.png', iconSize: [50, 50] });
const stopIcon = L.icon({ iconUrl: 'https://img.icons8.com/officel/80/bus-stop.png', iconSize: [30, 30] });

// จุดจอด (ควรจะตรงกับใน Backend)
const busStops = [
    { name: "หน้าอาคาร A", location: [13.7580, 100.5018] },
    { name: "โรงอาหารกลาง", location: [13.7565, 100.5035] },
    { name: "หอสมุด", location: [13.7540, 100.5025] },
    { name: "คณะวิศวกรรมศาสตร์", location: [13.7555, 100.5005] },
];

// --- 2. สร้างแผนที่และตัวแปร ---
const map = L.map('map').setView(mapCenter, mapZoom);
let cartMarker = null; // ตัวแปรสำหรับเก็บ Marker ของรถกอล์ฟ

// เพิ่ม Layer แผนที่ (ใช้ OpenStreetMap ฟรี)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// วาดจุดจอดลงบนแผนที่
busStops.forEach(stop => {
    L.marker(stop.location, { icon: stopIcon }).addTo(map)
        .bindPopup(`<b>${stop.name}</b>`);
});

// --- 3. ฟังก์ชันอัปเดตข้อมูล ---
async function updateCartOnMap() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        const cartPosition = [data.location._latitude, data.location._longitude];

        // อัปเดต Marker ของรถ
        if (!cartMarker) {
            // ถ้ายังไม่มี Marker ให้สร้างใหม่
            cartMarker = L.marker(cartPosition, { icon: cartIcon }).addTo(map);
        } else {
            // ถ้ามีแล้ว ให้ย้ายตำแหน่ง
            cartMarker.setLatLng(cartPosition);
        }
        cartMarker.bindPopup(`<b>Bugo 1</b><br>สถานะ: ${data.status}`).openPopup();

        // อัปเดตแถบสถานะ
        document.getElementById('cart-status').textContent = data.status;
        document.getElementById('last-update').textContent = new Date(data.lastUpdate._seconds * 1000).toLocaleTimeString('th-TH');

    } catch (error) {
        console.error("Failed to update cart position:", error);
        document.getElementById('cart-status').textContent = 'ขาดการเชื่อมต่อ';
    }
}

// --- 4. เริ่มการทำงาน ---
// เรียกใช้ครั้งแรกทันที
updateCartOnMap();
// ตั้งเวลาให้มันอัปเดตทุกๆ 5 วินาที
setInterval(updateCartOnMap, UPDATE_INTERVAL);