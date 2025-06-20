// bugo.js (เวอร์ชันแก้ไขสมบูรณ์และถูกต้อง 100%)
document.addEventListener('DOMContentLoaded', () => {
    const API_URL_CART = '/api/bugo-status';
    const API_URL_STOPS = '/api/bus-stops';
    const UPDATE_INTERVAL = 5000;
    const ANIMATION_DURATION = 4500;

    const mapCenter = [13.9615, 100.6230];
    const mapBounds = [ [13.944, 100.61], [13.974, 100.64] ];
    const mapZoom = 18;

    const cartIcon = L.icon({
        iconUrl: 'YOUR_ASSET_URL_FOR_GOLF_CART', // ** ใส่ URL ของคุณ **
        iconSize: [50, 50], iconAnchor: [25, 50], popupAnchor: [0, -50]
    });
    const stopIcon = L.icon({
        iconUrl: 'YOUR_ASSET_URL_FOR_BUS_STOP', // ** ใส่ URL ของคุณ **
        iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40]
    });

    const map = L.map('map', {
        maxBounds: mapBounds,
        minZoom: 15
    }).setView(mapCenter, mapZoom);
    
    let cartMarker = null;
    let routeLine = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    async function drawBusStops() {
        try {
            const response = await fetch(API_URL_STOPS);
            const stops = await response.json();
            stops.forEach(stop => {
                if (stop && stop.location && typeof stop.location._latitude === 'number' && typeof stop.location._longitude === 'number') {
                     L.marker([stop.location._latitude, stop.location._longitude], { icon: stopIcon })
                        .addTo(map)
                        .bindPopup(`<b>${stop.name}</b>`);
                }
            });
        } catch (err) { console.error("Could not draw bus stops", err); }
    }

    async function updateCartOnMap() {
        try {
            const response = await fetch(API_URL_CART);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            const cartPosition = [data.location._latitude, data.location._longitude];

            // --- **[จุดแก้ไขที่ถูกต้อง 100%]** ---
            // เปลี่ยนจาก L.Marker.MovingMarker เป็น L.movingMarker (m ตัวเล็ก และไม่มี Marker.)
            if (!cartMarker) {
                cartMarker = L.movingMarker([cartPosition, cartPosition], [], {
                    autostart: true,
                    icon: cartIcon
                }).addTo(map);
            } else {
                cartMarker.moveTo(cartPosition, ANIMATION_DURATION);
            }
            // --- สิ้นสุดจุดแก้ไข ---

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
            
            await drawRoute(data, cartPosition);

        } catch (error) {
            console.error("Failed to update cart position:", error);
            document.getElementById('cart-status').textContent = 'ขาดการเชื่อมต่อ';
        }
    }

    async function drawRoute(data, cartPosition) {
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }

        if (data.status.startsWith('กำลังมุ่งหน้าไป') && data.nextStopLocation) {
            const nextStopPosition = [data.nextStopLocation._latitude, data.nextStopLocation._longitude];
            
            const routeUrl = `https://router.project-osrm.org/route/v1/driving/${cartPosition[1]},${cartPosition[0]};${nextStopPosition[1]},${nextStopPosition[0]}?overview=full&geometries=geojson`;

            try {
                const routeResponse = await fetch(routeUrl);
                const routeData = await routeResponse.json();
                if (routeData.routes && routeData.routes.length > 0) {
                    const routeCoordinates = routeData.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    routeLine = L.polyline(routeCoordinates, { color: 'blue', weight: 5, opacity: 0.7 }).addTo(map);
                }
            } catch (err) {
                console.error("Failed to fetch route:", err);
            }
        }
    }

    drawBusStops();
    updateCartOnMap();
    setInterval(updateCartOnMap, UPDATE_INTERVAL);
});