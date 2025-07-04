// admin.js (เวอร์ชันแก้ไข Error Handling และชื่อ Field)
document.addEventListener('DOMContentLoaded', () => {
    const mapCenter = [13.9615, 100.6230];
    const mapBounds = [ [13.944, 100.61], [13.974, 100.64] ];

    const map = L.map('map', { maxBounds: mapBounds, minZoom: 18, }).setView(mapCenter, 18);
    
    const busStopIcon = L.icon({
        iconUrl: '/assets/icons8-bus-stop-96', // ** ใส่ URL จาก Asset ของคุณ **
        iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40]
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    let existingMarkers = {};

    async function loadStops() {
        try {
            const response = await fetch('/api/bus-stops');
            const stops = await response.json();
            
            for (let id in existingMarkers) { map.removeLayer(existingMarkers[id]); }
            existingMarkers = {};
            
            stops.forEach(stop => {
                if (stop && stop.location && typeof stop.location._latitude === 'number' && typeof stop.location._longitude === 'number') {
                    // --- **[แก้ไข]** เปลี่ยนเป็น ._latitude และ ._longitude ---
                    const marker = L.marker([stop.location._latitude, stop.location._longitude], { icon: busStopIcon })
                        .addTo(map)
                        .bindPopup(`<b>${stop.name}</b><br/><button onclick="deleteStop('${stop.id}')">ลบจุดนี้</button>`);
                    existingMarkers[stop.id] = marker;
                } else {
                    console.warn("Skipping invalid stop data received from server:", stop);
                }
            });
        } catch (error) {
            console.error("Failed to load bus stops:", error);
            alert("ไม่สามารถโหลดข้อมูลจุดจอดได้");
        }
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
        loadStops();
    };
    
    loadStops();
});