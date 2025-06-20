document.addEventListener('DOMContentLoaded', () => {
    const mapCenter = [13.7563, 100.5018];
    const map = L.map('map').setView(mapCenter, 15);
    const stopIcon = L.icon({ iconUrl: 'https://img.icons8.com/officel/80/bus-stop.png', iconSize: [30, 30] });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    let existingMarkers = {};

    // 1. ดึงและแสดงจุดจอดที่มีอยู่แล้ว
    async function loadStops() {
        const response = await fetch('/api/bus-stops');
        const stops = await response.json();
        stops.forEach(stop => {
            const marker = L.marker([stop.location.latitude, stop.location.longitude], { icon: stopIcon })
                .addTo(map)
                .bindPopup(`<b>${stop.name}</b><br/><button onclick="deleteStop('${stop.id}')">ลบจุดนี้</button>`);
            existingMarkers[stop.id] = marker;
        });
    }

    // 2. เมื่อคลิกบนแผนที่
    map.on('click', (e) => {
        const latlng = e.latlng;
        const popupContent = `
            <b>เพิ่มจุดจอดใหม่ที่นี่?</b><br/>
            Lat: ${latlng.lat.toFixed(5)}, Lng: ${latlng.lng.toFixed(5)}
            <br/><br/>
            <input type="text" id="stopName" placeholder="ใส่ชื่อจุดจอด">
            <button onclick="addStop(${latlng.lat}, ${latlng.lng})">บันทึก</button>
        `;
        L.popup().setLatLng(latlng).setContent(popupContent).openOn(map);
    });

    // 3. ฟังก์ชันสำหรับเรียก API (ต้องประกาศใน global scope เพื่อให้ button เรียกได้)
    window.addStop = async (lat, lng) => {
        const name = document.getElementById('stopName').value;
        if (!name) { alert('กรุณาใส่ชื่อจุดจอด'); return; }
        
        await fetch('/api/add-bus-stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, latitude: lat, longitude: lng })
        });
        map.closePopup();
        loadStops(); // โหลดใหม่เพื่อแสดงผล
    };

    window.deleteStop = async (id) => {
        if (!confirm('คุณแน่ใจหรือไม่ว่าจะลบจุดจอดนี้?')) return;

        await fetch(`/api/delete-bus-stop/${id}`, { method: 'DELETE' });
        map.removeLayer(existingMarkers[id]); // ลบ marker ออกจากแผนที่
    };
    
    loadStops();
});