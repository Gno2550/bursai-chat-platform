// admin.js (เวอร์ชันปรับมุมกล้อง)
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. กำหนดค่าพิกัดใหม่ ---
    const mapCenter = [13.9615, 100.6230]; // <-- ค่าใหม่: เลื่อนขึ้น
    const mapBounds = [
        [13.944, 100.61], // <-- ค่าใหม่: เลื่อนขอบเขตขึ้น
        [13.974, 100.64]  // <-- ค่าใหม่: เลื่อนขอบเขตขึ้น
    ];

    const map = L.map('map', {
        maxBounds: mapBounds,
        minZoom: 18,
    }).setView(mapCenter, 18);
    
    const busStopIcon = L.icon({
        iconUrl: '/bus-stop.png', // <-- **[แก้ไข]** เปลี่ยนเป็น Local Path
        iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40]
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    let existingMarkers = {};

    async function loadStops() {
        const response = await fetch('/api/bus-stops');
        const stops = await response.json();
        for (let id in existingMarkers) { map.removeLayer(existingMarkers[id]); }
        existingMarkers = {};
        stops.forEach(stop => {
            const marker = L.marker([stop.location.latitude, stop.location.longitude], { icon: busStopIcon })
                .addTo(map)
                .bindPopup(`<b>${stop.name}</b><br/><button onclick="deleteStop('${stop.id}')">ลบจุดนี้</button>`);
            existingMarkers[stop.id] = marker;
        });
    }

    map.on('click', (e) => {
        const latlng = e.latlng;
        const popupContent = `<b>เพิ่มจุดจอดใหม่?</b><br/>Lat: ${latlng.lat.toFixed(5)}, Lng: ${latlng.lng.toFixed(5)}<br/><br/><input type="text" id="stopName" placeholder="ใส่ชื่อจุดจอด"><button onclick="addStop(${latlng.lat}, ${latlng.lng})">บันทึก</button>`;
        L.popup().setLatLng(latlng).setContent(popupContent).openOn(map);
    });

    window.addStop = async (lat, lng) => {
        const name = document.getElementById('stopName').value;
        if (!name) { alert('กรุณาใส่ชื่อจุดจอด'); return; }
        await fetch('/api/add-bus-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, latitude: lat, longitude: lng }) });
        map.closePopup();
        loadStops();
    };

    window.deleteStop = async (id) => {
        if (!confirm('คุณแน่ใจหรือไม่ว่าจะลบจุดจอดนี้?')) return;
        await fetch(`/api/delete-bus-stop/${id}`, { method: 'DELETE' });
        if (existingMarkers[id]) { map.removeLayer(existingMarkers[id]); delete existingMarkers[id]; }
        loadStops(); // โหลดใหม่เพื่อให้แน่ใจว่าข้อมูลตรงกัน
    };
    
    loadStops();
});