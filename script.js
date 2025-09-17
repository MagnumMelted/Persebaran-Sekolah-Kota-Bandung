document.addEventListener("alpine:init", () => {
    Alpine.data("petaSekolah", () => ({
        // ----------------------------------------------------------------
        // I. STATE & PROPERTI INTI
        // ----------------------------------------------------------------
        map: null,
        layer: null,        // Layer utama untuk data sekolah dari GeoJSON
        drawnItems: null,   // Layer untuk hasil digitasi pengguna
        sekolah: [],        // Array mentah untuk semua data sekolah
        
        // State untuk UI (filter, pencarian, dll)
        kategori: '',
        layers: { sd: true, smp: true, sma: true, man: true, mas: true, mi: true, mts: true },
        
        // State untuk fitur "Tambah Data Sekolah"
        showModal: false,
        tempMarker: null,
        newSchool: {
            nama: '', npsn: '', alamat: '', tautan: '', kategori: 'sd', geometry: null
        },
        
        // State untuk utilitas lain
        exportFormat: 'geojson',
        loadingLocation: false,
        isLoading: false,
        manualSchools: [],
        isAddingSchool: false, 
        isBufferVisible: false,   // State khusus untuk hasil buffer
        isRouteVisible: false,    // State khusus untuk hasil rute
        isBuffering: false,
        isRouting: false,
        isProcessingRoute: false,
        routingControl: null,
        showLayoutModal: false,
        mapTitle: 'Peta Persebaran Sekolah di Kota Bandung',
        
        // ----------------------------------------------------------------
        // II. METODE UTAMA & INISIALISASI
        // ----------------------------------------------------------------
        initMap() {
            // 1. Inisialisasi Peta
            this.map = L.map('map', {
                zoomSnap: 0,
                zoomDelta: 0.1
            }).setView([-6.9175, 107.6191], 13);
            this.map.attributionControl.setPrefix('');

            // 2. Tambahkan Basemap
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(this.map);

            // 3. Inisialisasi Layer Sekolah
            this.layer = L.geoJSON(null, {
                pointToLayer: this.pointToLayer.bind(this),
                onEachFeature: this.onEachFeature.bind(this)
            }).addTo(this.map);

            // 4. Inisialisasi Layer Digitasi (ganti drawnItems → digitasiLayer)
            this.digitasiLayer = L.geoJSON().addTo(this.map);

            // 5. Aktifkan Toolbar Leaflet-Geoman
            this.map.pm.addControls({
                position: 'topleft',
                drawMarker: true,
                drawPolyline: true,
                drawPolygon: true,
                drawRectangle: true,
                editMode: true,
                dragMode: true,
                removalMode: true
            });

            // 6. Event: Saat user menggambar objek baru → minta nama layer
            this.map.on('pm:create', (e) => {
                const layer = e.layer;

                // Buat popup HTML untuk input nama + warna
                const popupContent = document.createElement('div');
                popupContent.innerHTML = `
                    <label style="font-size:12px;">Nama Layer</label>
                    <input id="layer-name" type="text" value="Layer Baru"
                        style="width:100%; margin-bottom:4px; font-size:12px; padding:2px;">

                    <label style="font-size:12px;">Warna</label>
                    <input id="layer-color" type="color" value="#ff0000"
                        style="width:100%; height:30px; margin-bottom:6px;">

                    <button id="save-layer" style="width:100%; background:#2563eb; color:#fff; border:none; padding:4px; cursor:pointer; font-size:12px;">
                        Simpan
                    </button>
                `;

                const popup = L.popup()
                    .setLatLng(layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng())
                    .setContent(popupContent)
                    .openOn(this.map);

                popupContent.querySelector('#save-layer').addEventListener('click', () => {
                    const nama = popupContent.querySelector('#layer-name').value || "Tanpa Nama";
                    const warna = popupContent.querySelector('#layer-color').value || "#ff0000";

                    // Simpan properti ke feature
                    layer.feature = {
                        type: "Feature",
                        properties: {
                            layerName: nama,
                            color: warna
                        },
                        geometry: layer.toGeoJSON().geometry
                    };

                    // Terapkan style warna ke layer
                    if (layer.setStyle) {
                        layer.setStyle({ color: warna, fillColor: warna });
                    } else if (layer.setIcon) {
                        // Untuk marker, ubah warna via icon sederhana
                        const icon = L.divIcon({
                            className: 'custom-icon',
                            html: `<div style="background:${warna};width:14px;height:14px;border-radius:50%;border:1px solid #333;"></div>`,
                            iconSize: [14, 14]
                        });
                        layer.setIcon(icon);
                    }

                    this.digitasiLayer.addLayer(layer);
                    // Tambahkan ke layer digitasi
                    this.digitasiLayer.addLayer(layer);

                    // Tambahkan klik kanan untuk edit
                    layer.on('contextmenu', () => {
                        this.editDigitasiLayer(layer);
                    });
                    this.map.closePopup();
                });
            });

            // 7. Muat Data Sekolah Awal
            this.loadData();

            // 8. Event Klik Layer Sekolah → Buffering / Routing
            this.layer.on('click', (e) => {
                if (this.isBuffering) {
                    this.createBuffer(e.layer.feature);
                    return;
                }
                if (this.isRouting) {
                    if (e.layer && e.layer.feature) {
                        this.calculateRoute(e.layer.feature);
                    } else {
                        alert('Feature tidak ditemukan untuk routing.');
                    }
                    return;
                }
                // default: popup akan muncul otomatis
            });
        },

        startAddSchool() {
            this.isAddingSchool = true;
            document.getElementById('map').style.cursor = 'crosshair';

            const mapClickHandler = (e) => {
                if (!this.isAddingSchool) return;

                const latlng = e.latlng;
                this.isAddingSchool = false;
                document.getElementById('map').style.cursor = '';

                const popupContent = document.createElement('div');
                popupContent.innerHTML = `
                    <label style="font-size:12px;">Nama Sekolah</label>
                    <input id="school-name" type="text" style="width:100%; margin-bottom:4px; font-size:12px; padding:2px;">

                    <label style="font-size:12px;">Jenjang</label>
                    <select id="school-jenjang" style="width:100%; margin-bottom:4px; font-size:12px; padding:2px;">
                        <option>SD</option>
                        <option>SMP</option>
                        <option>SMA</option>
                        <option>MI</option>
                        <option>MTS</option>
                        <option>MAN</option>
                    </select>

                    <label style="font-size:12px;">NPSN</label>
                    <input id="school-npsn" type="text" oninput="this.value = this.value.replace(/[^0-9]/g, '')" style="width:100%; margin-bottom:4px; font-size:12px; padding:2px;">

                    <label style="font-size:12px;">Alamat</label>
                    <textarea id="school-address" style="width:100%; margin-bottom:6px; font-size:12px; padding:2px;"></textarea>

                    <button id="save-school" style="width:100%; background:#2563eb; color:#fff; border:none; padding:4px; cursor:pointer; font-size:12px;">
                        Simpan
                    </button>
                `;

                const popup = L.popup()
                    .setLatLng(latlng)
                    .setContent(popupContent)
                    .openOn(this.map);

                popupContent.querySelector('#save-school').addEventListener('click', () => {
                    const nama = popupContent.querySelector('#school-name').value || 'Tanpa Nama';
                    const jenjang = popupContent.querySelector('#school-jenjang').value;
                    const npsn = popupContent.querySelector('#school-npsn') ? popupContent.querySelector('#school-npsn').value : '-';
                    const alamat = popupContent.querySelector('#school-address').value || '-';

                    const feature = {
                        type: "Feature",
                        geometry: {
                            type: "Point",
                            coordinates: [latlng.lng, latlng.lat]
                        },
                        properties: {
                            nama, jenjang, npsn, alamat
                        }
                    };

                    // Simpan ke array
                    this.manualSchools.push(feature);

                    // Tambahkan marker ke peta
                    const marker = L.marker(latlng).addTo(this.map);
                    marker.bindPopup(`
                        <b>${nama}</b><br>
                        Jenjang: ${jenjang}<br>
                        NPSN: ${npsn}<br>
                        Alamat: ${alamat}
                    `);

                    this.map.closePopup();
                    this.map.off('click', mapClickHandler);
                });
            };

            this.map.on('click', mapClickHandler);
        },

        exportSchoolsToExcel() {
            if (this.manualSchools.length === 0) {
                alert("Belum ada data sekolah yang ditambahkan.");
                return;
            }

            const header = ["Nama Sekolah", "Jenjang", "Alamat", "Longitude", "Latitude"];
            const rows = this.manualSchools.map(f => [
                f.properties.nama,
                f.properties.jenjang,
                f.properties.alamat,
                f.geometry.coordinates[0],
                f.geometry.coordinates[1]
            ]);

            // Buat workbook
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
            XLSX.utils.book_append_sheet(wb, ws, "Sekolah");

            XLSX.writeFile(wb, "Data_Sekolah_Manual.xlsx");
        },

        mapZoomPercent: 100,
        baseZoomLevel: null, // simpan zoom awal pertama kali buka

        applyMapZoom() {
            const scale = this.mapZoomPercent / 100;

            if (this.baseZoomLevel === null) {
                this.baseZoomLevel = this.map.getZoom();
            }

            // hitung zoom baru berbasis skala logaritmik
            const newZoom = this.baseZoomLevel + Math.log2(scale);

            this.map.setZoom(newZoom);
        },

        addCustomControls() {
            L.control.scale({ position: 'bottomleft' }).addTo(this.map);
            const drawControl = new L.Control.Draw({
                edit: { featureGroup: this.drawnItems },
                draw: {
                    polygon: true, polyline: true, rectangle: true, circle: true, circlemarker: false, marker: true
                }
            });
            this.map.addControl(drawControl);
        },

        setupDrawEvents() {
            this.map.on('draw:created', (e) => {
                if (e.layerType === 'marker') {
                    // Gunakan Alpine reaktif dengan setTimeout agar siklus DOM Alpine sinkron
                    setTimeout(() => {
                        this.handleMarkerCreated(e.layer);
                        this.showModal = true; // langsung tampilkan modal
                    });
                } else {
                    this.drawnItems.addLayer(e.layer);
                }
            });
        },

        // ----------------------------------------------------------------
        // III. METODE UNTUK MANAJEMEN DATA
        // ----------------------------------------------------------------
        loadData() {
            fetch('/geojson/Fasilitas_Pendidikan.geojson')
                .then(res => res.json())
                .then(data => {
                    this.sekolah = data.features.map(feature => ({
                        ...feature,
                        properties: {
                            ...feature.properties,
                            kategori: this.getKategori(feature.properties.Nama)
                        }
                    }));
                    this.updateMap();
                });
        },

        updateMap() {
            const filtered = this.sekolah.filter(item => this.layers[item.properties.kategori]);
            this.layer.clearLayers();
            this.layer.addData({ type: 'FeatureCollection', features: filtered });
        },

        getKategori(nama) {
            if (!nama) return 'sd';
            const lowerNama = nama.toLowerCase();
            if (lowerNama.includes('sd')) return 'sd';
            if (lowerNama.includes('smp')) return 'smp';
            if (lowerNama.includes('sma')) return 'sma';
            if (lowerNama.includes('man')) return 'man';
            if (lowerNama.includes('mas')) return 'mas';
            if (lowerNama.includes('mi')) return 'mi';
            if (lowerNama.includes('mts')) return 'mts';
            return 'sd'; // Default
        },

        filteredSekolah() {
            if (this.kategori.length < 2) return [];
            return this.sekolah.filter(s =>
                s.properties.Nama.toLowerCase().includes(this.kategori.toLowerCase())
            ).slice(0, 10);
        },

        pointToLayer(feature, latlng) {
            let color = {
                'sd': 'blue', 'smp': 'green', 'sma': 'yellow', 'man': '#800080',
                'mas': '#FF4500', 'mi': '#FFA500', 'mts': '#6A5ACD'
            }[feature.properties.kategori] || 'gray';

            return L.circleMarker(latlng, {
                radius: 8, fillColor: color, color: '#000', weight: 1, opacity: 1, fillOpacity: 0.8
            });
        },

        onEachFeature(feature, layer) {
            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
                <h3 style='font-size: 14px; font-weight: bold; margin-bottom: 5px;'>${feature.properties.Nama}</h3>
                <b>NPSN:</b> ${feature.properties.NPSN || '-'}<br>
                <b>Alamat:</b> ${feature.properties.Alamat || '-'}<br>
                <a href='${feature.properties.Tautan}' target='_blank' rel='noopener noreferrer'>Lihat profil</a>
            `;
            layer.bindPopup(popupContent);
        },

        createBuffer(feature) {
            const radiusStr = prompt("Masukkan radius buffer dalam meter:", "500");
            if (!radiusStr) return;

            const radius = parseInt(radiusStr);
            if (isNaN(radius) || radius <= 0) {
                alert("Harap masukkan angka yang valid.");
                return;
            }

            // === 1. TAMPILKAN LOADING ===
            this.isLoading = true;
            this.map.closePopup();
            this.cancelBufferMode(); // Keluar dari mode buffering setelah klik

            // Gunakan setTimeout untuk memberi waktu pada browser menampilkan animasi loading
            setTimeout(() => {
                try {
                    // Buat buffer menggunakan Turf.js
                    const buffered = turf.buffer(feature, radius, { units: 'meters' });

                    // Tampilkan buffer di peta
                    this.analysisLayer = L.geoJSON(null, {
                        style: {
                            color: '#00FFFF',      // Warna garis (cyan)
                            weight: 2,
                            opacity: 0.8,
                            fillColor: '#00FFFF',  // Warna isian
                            fillOpacity: 0.3
                        }
                    }).addTo(this.map);
                    this.analysisLayer.addData(buffered);
                    
                    // Zoom ke area buffer
                    this.map.fitBounds(this.analysisLayer.getBounds());

                    this.isBufferVisible = true;

                } catch (error) {
                    console.error("Terjadi error saat membuat buffer:", error);
                    alert("Gagal membuat buffer. Silakan cek console untuk detail.");
                } finally {
                    // Sembunyikan loading, baik berhasil maupun gagal
                    this.isLoading = false;
                }
            }, 500);
        },

        startBufferMode() {
            this.isBuffering = true;
            document.getElementById('map').style.cursor = 'crosshair';
            alert('Mode Analisis Buffer Aktif: Silakan klik pada salah satu titik sekolah di peta.');
        },

        cancelBufferMode() {
            this.isBuffering = false;
            document.getElementById('map').style.cursor = '';
        },

        startRoutingMode() {
            this.isRouting = true;
            document.getElementById('map').style.cursor = 'crosshair';
            alert('Mode Analisis Rute Aktif: Silakan klik pada salah satu titik sekolah sebagai tujuan.');
        },

        calculateRoute(feature) {
            this.isLoading = true;

            // Matikan mode analisis agar klik berikutnya tidak memicu ulang
            this.cancelBufferMode();
            this.cancelRoutingMode();

            // Hapus analisis/rute sebelumnya
            this.clearAnalysis();

            // Pastikan ada geometry
            if (!feature || !feature.geometry || !feature.geometry.coordinates) {
                alert('Koordinat tujuan tidak valid.');
                this.isLoading = false;
                return;
            }

            const lat = feature.geometry.coordinates[1];
            const lng = feature.geometry.coordinates[0];
            const destination = L.latLng(lat, lng);

            // Ambil lokasi pengguna (fallback jika tidak tersedia)
            if (!navigator.geolocation) {
                alert('Geolocation tidak tersedia di browser ini.');
                this.isLoading = false;
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const start = L.latLng(position.coords.latitude, position.coords.longitude);

                    // buat routing control dengan router OSRM eksplisit
                    this.routingControl = L.Routing.control({
                        router: L.Routing.osrmv1({
                            serviceUrl: 'https://router.project-osrm.org/route/v1'
                        }),
                        waypoints: [start, destination],
                        routeWhileDragging: false,
                        addWaypoints: false,
                        showAlternatives: false,
                        fitSelectedRoute: true,
                        createMarker: function(i, wp, n) {
                            // Buat marker kecil untuk start & dest sehingga pengguna tahu rute
                            return L.marker(wp.latLng);
                        }
                    }).addTo(this.map);

                    this.isRouteVisible = true;
                    this.isLoading = false;

                    // Setelah route muncul, matikan mode routing
                    this.isRouting = false;
                    document.getElementById('map').style.cursor = '';
                },
                (error) => {
                    alert(`Gagal mendapatkan lokasi Anda: ${error.message}`);
                    this.isLoading = false;
                    // pastikan mode routing dimatikan
                    this.isRouting = false;
                    document.getElementById('map').style.cursor = '';
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        },

        cancelRoutingMode() {
            this.isRouting = false;
            document.getElementById('map').style.cursor = '';
        },

        clearAnalysis() {
            // Hapus layer hasil analisis (buffer)
            try {
                if (this.analysisLayer) {
                    this.map.removeLayer(this.analysisLayer);
                    this.analysisLayer = null;
                }
            } catch (err) {
                console.warn('clearAnalysis: no analysisLayer to remove', err);
            }

            // Hapus routing control jika ada
            if (this.routingControl) {
                try {
                    this.map.removeControl(this.routingControl);
                } catch (err) {
                    console.warn('clearAnalysis: failed to remove routingControl', err);
                }
                this.routingControl = null;
            }

            // reset state yang relevan
            this.isAnalysisLayerVisible = false;
        },

        clearBufferAnalysis() {
            if (confirm("Yakin ingin menghapus hasil analisis?")) {
                this.analysisLayer.clearLayers();
                this.isBufferVisible = false;
            }
        },

        clearRoutingAnalysis() {
            if (confirm("Yakin ingin menghapus hasil analisis?")) {
                if (this.routingControl) {
                    this.map.removeControl(this.routingControl);
                    this.routingControl = null;
                }
                this.isRouteVisible = false;
            }
        },
        
        zoomTo(item) {
            const [lng, lat] = item.geometry.coordinates;
            this.map.setView([lat, lng], 17);
            this.kategori = item.properties.Nama;
            
            // Buka popup setelah zoom
            this.layer.eachLayer(layer => {
                if (layer.feature.properties.Nama === item.properties.Nama) {
                    layer.openPopup();
                }
            });
        },
        
        saveDigitasi() {
            // 1. Pastikan ada sesuatu yang digambar

            if (this.exportFormat === 'screenshot') {
                this.prepareLayout();
                return;
            }

            if (this.drawnItems.getLayers().length === 0) {
                alert("Tidak ada data digitasi untuk diekspor. Silakan gambar sesuatu di peta terlebih dahulu.");
                return;
            }

            // 2. Konversi layer yang digambar menjadi format GeoJSON
            const data = this.drawnItems.toGeoJSON();

            // 3. Logika untuk menangani setiap format ekspor
            if (this.exportFormat === 'geojson') {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                this.downloadFile(blob, 'digitasi.geojson');

            } else if (this.exportFormat === 'kml') {
                // Konversi GeoJSON ke KML menggunakan togeojson.js
                const kmlString = togeojson.kml(data);
                const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
                this.downloadFile(blob, 'digitasi.kml');

            } else if (this.exportFormat === 'shp') {
                // Shapefile export memerlukan library shp-write dan bersifat asinkron
                shpwrite.zip(data)
                    .then(zipContent => {
                        const blob = new Blob([zipContent], { type: 'application/zip' });
                        this.downloadFile(blob, 'digitasi.zip');
                    })
                    .catch(error => console.error("Gagal membuat Shapefile:", error));

            }
        },

        downloadFile(blob, fileName) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        },

        async exportLayoutAsImage() {
            this.showLayoutModal = false;
            this.isLoading = true;

            // 1. Kumpulkan semua data yang diperlukan untuk layout
            const legendContainer = document.createElement('div');
            Object.keys(this.layers).forEach(key => {
                if (this.layers[key]) {
                    const color = {sd: 'blue', smp: 'green', sma: 'yellow', man: '#800080', mas: '#FF4500', mi: '#FFA500', mts: '#6A5ACD'}[key];
                    legendContainer.innerHTML += `<div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span><span>${key.toUpperCase()}</span></div>`;
                }
            });
            if (this.drawnItems.getLayers().length > 0) {
                legendContainer.innerHTML += `<div class="flex items-center"><span class="w-3 h-3 mr-2" style="border: 2px solid #3388ff;"></span><span>Digitasi</span></div>`;
            }
            if (this.analysisLayer && this.analysisLayer.getLayers().length > 0) {
                legendContainer.innerHTML += `<div class="flex items-center"><span class="w-3 h-3 mr-2" style="background-color: #00FFFF; opacity: 0.5;"></span><span>Hasil Analisis</span></div>`;
            }

            const layoutData = {
                title: this.mapTitle,
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                schools: this.layer.toGeoJSON(),
                drawnItems: this.drawnItems.toGeoJSON(),
                analysis: this.analysisLayer ? this.analysisLayer.toGeoJSON() : null,
                legendHTML: legendContainer.innerHTML
            };

            // 2. Simpan data ke sessionStorage
            sessionStorage.setItem('layoutData', JSON.stringify(layoutData));
            
            // 3. Buka layout.html di jendela pop-up baru
            window.open('layout.html', 'MapLayout', 'width=1100,height=850,scrollbars=yes,resizable=yes');

            this.isLoading = false;
        },

        locateUser() {
            // 1. Aktifkan status loading untuk menampilkan spinner di tombol
            this.loadingLocation = true;
            
            // 2. Minta Leaflet untuk mencari lokasi pengguna
            // setView: true -> otomatis zoom ke lokasi yang ditemukan
            // maxZoom: 16 -> tingkat zoom maksimal saat ditemukan
            this.map.locate({ setView: true, maxZoom: 16 });

            // 3. Siapkan event listener untuk JIKA lokasi berhasil ditemukan
            this.map.once('locationfound', (e) => {
                // Buat marker di lokasi yang ditemukan
                L.marker(e.latlng).addTo(this.map)
                    .bindPopup('Lokasi Anda Saat Ini').openPopup();
                
                // Buat lingkaran untuk menunjukkan radius akurasi
                L.circle(e.latlng, { radius: e.accuracy / 2 }).addTo(this.map);

                // Matikan status loading
                this.loadingLocation = false;
            });

            // 4. Siapkan event listener untuk JIKA lokasi GAGAL ditemukan
            this.map.once('locationerror', (e) => {
                // Tampilkan pesan error kepada pengguna
                alert('Gagal mendapatkan lokasi: ' + e.message);
                
                // Matikan status loading
                this.loadingLocation = false;
            });
        },

        layoutTitle: '',
        digitasiLayerName: '',

        editDigitasiLayer(layer) {
            const currentName = layer.feature?.properties?.layerName || "Tanpa Nama";
            const currentColor = layer.feature?.properties?.color || "#ff0000";

            const popupContent = document.createElement('div');
            popupContent.innerHTML = `
                <label style="font-size:12px;">Ubah Nama Layer</label>
                <input id="edit-name" type="text" value="${currentName}"
                    style="width:100%; margin-bottom:4px; font-size:12px; padding:2px;">

                <label style="font-size:12px;">Ubah Warna</label>
                <input id="edit-color" type="color" value="${currentColor}"
                    style="width:100%; height:30px; margin-bottom:6px;">

                <button id="save-edit" style="width:100%; background:#16a34a; color:#fff; border:none; padding:4px; cursor:pointer; font-size:12px;">
                    Simpan Perubahan
                </button>
            `;

            const center = layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng();

            const popup = L.popup()
                .setLatLng(center)
                .setContent(popupContent)
                .openOn(this.map);

            popupContent.querySelector('#save-edit').addEventListener('click', () => {
                const newName = popupContent.querySelector('#edit-name').value || "Tanpa Nama";
                const newColor = popupContent.querySelector('#edit-color').value || "#ff0000";

                // Simpan ke properties
                layer.feature.properties.layerName = newName;
                layer.feature.properties.color = newColor;

                // Terapkan warna baru
                if (layer.setStyle) {
                    layer.setStyle({ color: newColor, fillColor: newColor });
                } else if (layer.setIcon) {
                    const icon = L.divIcon({
                        className: 'custom-icon',
                        html: `<div style="background:${newColor};width:14px;height:14px;border-radius:50%;border:1px solid #333;"></div>`,
                        iconSize: [14, 14]
                    });
                    layer.setIcon(icon);
                }

                this.map.closePopup();
            });
        },

        saveLayoutInput() {
            const saved = {
                layoutTitle: this.layoutTitle,
                digitasiLayerName: this.digitasiLayerName
            };
            sessionStorage.setItem('layoutMeta', JSON.stringify(saved));
            alert('✅ Judul Peta & Nama Layer Digitasi berhasil disimpan!');
        },

        openMapLayout() {
            const center = this.map.getCenter();
            const drawnGeo = this.digitasiLayer.toGeoJSON();
            localStorage.setItem('digitasiData', JSON.stringify(drawnGeo));

            const meta = JSON.parse(sessionStorage.getItem('layoutMeta') || '{}');

            let legendHTML = `
                <p><span style="background-color: blue; width: 10px; height: 10px; display:inline-block; margin-right: 5px;"></span> SD</p>
                <p><span style="background-color: green; width: 10px; height: 10px; display:inline-block; margin-right: 5px;"></span> SMP</p>
                <p><span style="background-color: yellow; width: 10px; height: 10px; display:inline-block; margin-right: 5px;"></span> SMA</p>
                <hr style="margin:4px 0;">
            `;

            if (drawnGeo.features.length > 0) {
                legendHTML += `<h4 style="margin:2px 0;">Layer Digitasi:</h4>`;
                drawnGeo.features.forEach(f => {
                    const name = f.properties?.layerName || 'Tanpa Nama';
                    const color = f.properties?.color || 'cyan';
                    const g = f.geometry.type;
                    legendHTML += `
                        <p><span style="background-color:${color}; width: 10px; height: 10px; display:inline-block; margin-right: 5px; border:1px solid #333;"></span> ${name} (${g})</p>
                    `;
                });
            };

            const layoutData = {
                title: meta.layoutTitle || "Peta Persebaran Sekolah",
                center: [center.lat, center.lng],
                zoom: this.map.getZoom(),
                schools: { type: "FeatureCollection", features: this.sekolah },
                drawnItems: drawnGeo,
                analysis: this.analysisLayer ? this.analysisLayer.toGeoJSON() : null,
                legendHTML: legendHTML
            };

            sessionStorage.setItem("layoutData", JSON.stringify(layoutData));
            window.open("layout.html", "_blank");
        }
    }));
});