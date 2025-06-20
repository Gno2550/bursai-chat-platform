// bugo.js (เวอร์ชันปรับมุมกล้อง)
document.addEventListener('DOMContentLoaded', () => {
    const API_URL_CART = '/api/bugo-status';
    const API_URL_STOPS = '/api/bus-stops';
    const UPDATE_INTERVAL = 5000;
    
    // --- ** 1. กำหนดค่าพิกัดใหม่ ** ---
    const mapCenter = [13.9615, 100.6230]; // <-- ค่าใหม่: เลื่อนขึ้น
    const mapBounds = [ [13.944, 100.61], [13.974, 100.64] ]; // <-- ค่าใหม่: เลื่อนขอบเขตขึ้น
    const mapZoom = 18;

    const cartIcon = L.icon({
        iconUrl: 'https://img.icons8.com/plasticine/100/golf-cart.png',
        iconSize: [50, 50], iconAnchor: [25, 50], popupAnchor: [0, -50]
    });
    const stopIcon = L.icon({
        iconUrl: 'https://img.icons8.com/plasticine/100/bus-stop.png',
        iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40]
    });

    const map = L.map('map', {
        maxBounds: mapBounds,
        minZoom: 15
    }).setView(mapCenter, mapZoom);
    
    let cartMarker = null;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    async function drawBusStops() {
        try {
            const response = await fetch(API_URL_STOPS);
            const stops = await response.json();
            stops.forEach(stop => {
                L.marker([stop.location.latitude, stop.location.longitude], { icon: stopIcon })
                    .addTo(map)
                    .bindPopup(`<b>${stop.name}</b>`);
            });
        } catch (err) { console.error("Could not draw bus stops", err); }
    }

    async function updateCartOnMap() {
        try {
            const response = await fetch(API_URL_CART);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            const cartPosition = [data.location._latitude, data.location._longitude];
            if (!cartMarker) {
                cartMarker = L.marker(cartPosition, { icon: cartIcon }).addTo(map);
            } else {
                cartMarker.setLatLng(cartPosition);
            }
            cartMarker.bindPopup(`<b>Bugo 1</b><br>สถานะ: ${data.status}`).openPopup();
            document.getElementById('cart-status').textContent = data.status || 'กำลังคำนวณ...';
            document.getElementById('last-update').textContent = new Date(data.lastUpdate._seconds * 1000).toLocaleTimeString('th-TH');
            if (data.distanceToNextStop !== undefined) {
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

    drawBusStops();
    updateCartOnMap();
    setInterval(updateCartOnMap, UPDATE_INTERVAL);
});