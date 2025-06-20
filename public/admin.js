// admin.js (เวอร์ชันอัปเกรด เพิ่มระบบค้นหา)

document.addEventListener('DOMContentLoaded', () => {
    const mapCenter = [13.7563, 100.5018];
    const map = L.map('map').setView(mapCenter, 15);
     // --- ** 1. สร้าง Custom Icon ของเรา ** ---
    const busStopIcon = L.icon({
        iconUrl: 'https://img.icons8.com/plasticine/100/bus-stop.png',
        iconSize: [40, 40], // ขนาดของไอคอน (กว้าง, สูง)
        iconAnchor: [20, 40], // จุดที่ "ปลายหมุด" จะปักลงบนแผนที่ (ครึ่งหนึ่งของความกว้าง, ความสูงทั้งหมด)
        popupAnchor: [0, -40] // จุดที่ Popup จะเด้งขึ้นมา (สัมพันธ์กับ iconAnchor)
    });
  

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    let existingMarkers = {};

    // --- ** 1. เพิ่มระบบค้นหา (GeoSearch) ** ---
    // สร้าง Provider (ใช้ OpenStreetMap ฟรี)
    const provider = new GeoSearch.OpenStreetMapProvider();
    
    // สร้าง Control (กล่องค้นหา)
    const searchControl = new GeoSearch.GeoSearchControl({
      provider: provider,
      style: 'bar', // รูปแบบของช่องค้นหา
      showMarker: true, // แสดงหมุดที่ตำแหน่งที่ค้นหา
      showPopup: false, // ไม่ต้องแสดง Pop-up อัตโนมัติ
      marker: {
        icon: new L.Icon.Default(),
        draggable: false,
      },
      autoClose: true, // ปิดผลการค้นหาเมื่อเลือกตำแหน่ง
      searchLabel: 'ค้นหาสถานที่หรือพิกัด...', // ข้อความในช่องค้นหา
      keepResult: true // ให้หมุดผลการค้นหาคงอยู่
    });

    // เพิ่ม Control ลงในแผนที่
    map.addControl(searchControl);
    // --- ** สิ้นสุดส่วนที่เพิ่มเข้ามา ** ---
  
    // 1. ดึงและแสดงจุดจอดที่มีอยู่แล้ว
   
    // 2. ดึงและแสดงจุดจอดที่มีอยู่แล้ว (โดยใช้ไอคอนใหม่)
    async function loadStops() {
        const response = await fetch('/api/bus-stops');
        const stops = await response.json();
        
        // ล้าง marker เก่าก่อนวาดใหม่
        for (let id in existingMarkers) {
            map.removeLayer(existingMarkers[id]);
        }
        existingMarkers = {};
        
        stops.forEach(stop => {
            const marker = L.marker([stop.location.latitude, stop.location.longitude], { 
                icon: busStopIcon // <-- ** 3. บอกให้ใช้ไอคอนนี้ **
            })
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