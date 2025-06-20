// bugo.js (เวอร์ชันสมบูรณ์: ล็อกแผนที่ + ดึงจุดจอดจาก API)

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. การตั้งค่าเริ่มต้น ---
    const API_URL_CART = '/api/bugo-status';
    const API_URL_STOPS = '/api/bus-stops'; // API สำหรับดึงจุดจอด
    const UPDATE_INTERVAL = 5000; // อัปเดตทุก 5 วินาที
    
    // --- พิกัดสำหรับเซียร์ รังสิต ---
    const mapCenter = [13.9575, 100.6225]; // จุดศูนย์กลาง
    const mapBounds = [ [13.94, 100.61], [13.97, 100.64] ]; // กรอบสี่เหลี่ยม
    const mapZoom = 16; // ระดับการซูมเริ่มต้น

    // --- 2. สร้าง Custom Icons ---
    const cartIcon = L.icon({
        iconUrl: 'https://img.icons8.com/plasticine/100/golf-cart.png',
        iconSize: [50, 50],
        iconAnchor: [25, 50],
        popupAnchor: [0, -50]
    });
    const stopIcon = L.icon({
        iconUrl: 'https://img.icons8.com/plasticine/100/bus-stop.png',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
    });

    // --- 3. สร้างแผนที่พร้อม Options การล็อก ---
    const map = L.map('map', {
        maxBounds: mapBounds,   // จำกัดขอบเขต
        minZoom: 15,            // จำกัดการซูมออก
    }).setView(mapCenter, mapZoom);

    let cartMarker = null; // ตัวแปรสำหรับเก็บ Marker ของรถกอล์ฟ

    // เพิ่ม Layer แผนที่ (ใช้ OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // --- 4. ฟังก์ชันสำหรับดึงและวาดจุดจอดทั้งหมดจาก Firebase ---
    async function drawBusStops() {
        try {
            const response = await fetch(API_URL_STOPS);
            if (!response.ok) {
                throw new Error('Failed to fetch bus stops');
            }
            const stops = await response.json();
            
            // วาด Marker ของแต่ละจุดจอดลงบนแผนที่
            stops.forEach(stop => {
                L.marker([stop.location.latitude, stop.location.longitude], { 
                    icon: stopIcon 
                }).addTo(map)
                  .bindPopup(`<b>${stop.name}</b>`);
            });
        } catch (err) {
            console.error("Could not draw bus stops:", err);
            // อาจจะมีการแจ้งเตือนผู้ใช้บนหน้าจอถ้าต้องการ
        }
    }

    // --- 5. ฟังก์ชันสำหรับอัปเดตตำแหน่งรถกอล์ฟและข้อมูลต่างๆ ---
    async function updateCartOnMap() {
        try {
            const response = await fetch(API_URL_CART);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            
            // ดึงค่า Lat/Lng จาก Geopoint ของ Firebase
            const cartPosition = [data.location._latitude, data.location._longitude];

            // อัปเดตตำแหน่ง Marker ของรถ
            if (!cartMarker) {
                // ถ้ายังไม่มี Marker ให้สร้างใหม่
                cartMarker = L.marker(cartPosition, { 
                    icon: cartIcon 
                }).addTo(map);
            } else {
                // ถ้ามีแล้ว ให้ย้ายตำแหน่ง
                cartMarker.setLatLng(cartPosition);
            }
            // แสดง Popup ที่ Marker ของรถ
            cartMarker.bindPopup(`<b>Bugo 1</b><br>สถานะ: ${data.status}`).openPopup();

            // อัปเดตข้อมูลในแถบสถานะด้านล่าง
            document.getElementById('cart-status').textContent = data.status || 'กำลังคำนวณ...';
            document.getElementById('last-update').textContent = new Date(data.lastUpdate._seconds * 1000).toLocaleTimeString('th-TH');
            
            // แสดงผลระยะทางและเวลา (ตรวจสอบก่อนว่ามีข้อมูลหรือไม่)
            if (data.distanceToNextStop !== undefined && data.etaMinutes !== undefined) {
                document.getElementById('distance').textContent = data.distanceToNextStop.toFixed(0);
                document.getElementById('eta').textContent = data.etaMinutes.toFixed(0);
            } else {
                document.getElementById('distance').textContent = 'N/A';
                document.getElementById('eta').textContent = 'N/A';
            }

        } catch (error) {
            console.error("Failed to update cart position:", error);
            document.getElementById('cart-status').textContent = 'ขาดการเชื่อมต่อ';
        }
    }

    // --- 6. เริ่มการทำงานของสคริปต์ ---
    drawBusStops();      // เรียกวาดจุดจอดก่อนเป็นอันดับแรก
    updateCartOnMap();   // เรียกอัปเดตรถครั้งแรกทันที
    setInterval(updateCartOnMap, UPDATE_INTERVAL); // ตั้งเวลาอัปเดตซ้ำๆ
});