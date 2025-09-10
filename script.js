document.addEventListener("alpine:init", () => {
    Alpine.data("petaSekolah", () => ({
        kategori: "",
        layers: { sd: true, smp: true, sma: true, man: true, mas: true, mi: true, mts: true },
        sekolah: [],
        selectedFeature: null,
        map: null,
        layer: null,
        
        initMap() {
            // Inisialisasi map
            this.map = L.map("map", { zoomControl: false }).setView([-6.9175, 107.6191], 13);

            // Basemap
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "&copy; OpenStreetMap"
            }).addTo(this.map);

            this.layer = L.geoJSON().addTo(this.map);
            this.addCustomControls();
            this.loadData();
            // Digitasi
            this.drawnItems = new L.FeatureGroup();
            this.map.addLayer(this.drawnItems);
            const drawControl = new L.Control.Draw({
                edit: { featureGroup: this.drawnItems },
                draw: { circle: false } // Opsional: matikan circle jika tidak perlu
            });
            this.map.addControl(drawControl);
            
            this.map.on('draw:created', (e) => {
                this.drawnItems.addLayer(e.layer);
            });
        },
        saveDigitasi() {
            const data = this.drawnItems.toGeoJSON();
            let blob, fileName, link;
            if (this.exportFormat === 'geojson') {
                blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
                fileName = 'digitasi.geojson';
            } else if (this.exportFormat === 'kml') {
                // Gunakan turf untuk konversi (togeojson sebenarnya untuk import, gunakan library kml-geojson jika perlu, atau server-side)
                // Placeholder: Kirim ke server CI4 untuk konversi
                alert('KML ekspor melalui server, kirim data GeoJSON ke backend');
                // Contoh call API CI4
                fetch('/api/ekspor/kml', { method: 'POST', body: JSON.stringify(data) })
                    .then(res => res.blob())
                    .then(blob => {
                        link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = 'digitasi.kml';
                        link.click();
                    });
            } else if (this.exportFormat === 'shapefile') {
                const zip = shpwrite.zip(data);
                blob = zip;
                fileName = 'digitasi.zip';
            } else if (this.exportFormat === 'screenshot') {
                html2canvas(document.getElementById('map')).then(canvas => {
                    canvas.toBlob((blob) => {
                        link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = 'digitasi.png';
                        link.click();
                    });
                });
                return;
            }
            link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();
        },

        loadData() {
            fetch("/geojson/Fasilitas_Pendidikan.geojson")
                .then(res => res.json())
                .then(data => {
                    // Tambah kategori ke setiap feature
                    this.sekolah = data.features.map(feature => ({
                        ...feature,
                        properties: {
                            ...feature.properties,
                            kategori:
                                feature.properties.Nama.includes("SD") || feature.properties.Nama.includes("SDN") ? "sd" :
                                feature.properties.Nama.includes("SMP") ? "smp" :
                                feature.properties.Nama.includes("SMA") || feature.properties.Nama.includes("SMAS") ? "sma" :
                                feature.properties.Nama.includes("MAN") ? "man" :
                                feature.properties.Nama.includes("MAS") ? "mas" :
                                feature.properties.Nama.includes("MI") || feature.properties.Nama.includes("MIN") || feature.properties.Nama.includes("MIS") ? "mi" :
                                feature.properties.Nama.includes("MTs") || feature.properties.Nama.includes("MtsN") || feature.properties.Nama.includes("MTSS") ? "mts" :
                                "sd"
                        }
                    }));

                    this.updateMap();

                    // Buat chart statistik
                    this.buildChart(data);

                    // Tambahkan Search Control
                    this.addSearchControl(data);
                });
        },

        updateMap() {
            let filtered = this.sekolah.filter(item => this.layers[item.properties.kategori]);

            this.layer.clearLayers();
            this.layer = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
                pointToLayer: (feature, latlng) => {
                    let color = {
                        sd: "blue",
                        smp: "green",
                        sma: "yellow",
                        man: "#800080",
                        mas: "#FF4500",
                        mi: "#FFA500",
                        mts: "#6A5ACD"
                    }[feature.properties.kategori] || "gray";
                    
                    return L.circleMarker(latlng, {
                        radius: 8,
                        fillColor: color,
                        color: "#000",
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    });
                },
                onEachFeature: (feature, layer) => {
                    let popupContent = `
                        <div style="font-size:14px;">
                            <b>${feature.properties.Nama}</b><br>
                            <b>NPSN:</b> ${feature.properties.NPSN}<br>
                            <b>Alamat:</b> ${feature.properties.Alamat}<br>
                            <a href="${feature.properties.Tautan}" target="_blank">Profil Sekolah</a>
                        </div>`;
                    layer.bindPopup(popupContent);

                    layer.on("click", () => this.selectedFeature = feature);
                }
            }).addTo(this.map);
        },

        zoomTo(item) {
            let [lng, lat] = item.geometry.coordinates;
            this.map.setView([lat, lng], 17);
            this.selectedFeature = item;
            this.kategori = item.properties.Nama;
        },

        addCustomControls() {
            L.control.zoom({ position: "topleft" }).addTo(this.map);
            L.control.scale({ position: "bottomleft" }).addTo(this.map);
        },

        filteredSekolah() {
            if (this.kategori.length < 1) return [];
            return this.sekolah.filter(s =>
                s.properties.Nama.toLowerCase().includes(this.kategori.toLowerCase())
            ).slice(0, 10);
        },

        buildChart(data) {
            const categoryCounts = {};
            data.features.forEach(feature => {
                const nama = feature.properties.Nama;
                const kategori =
                    nama.includes("SD") || nama.includes("SDN") ? "sd" :
                    nama.includes("SMP") ? "smp" :
                    nama.includes("SMA") || nama.includes("SMAS") ? "sma" :
                    nama.includes("MAN") ? "man" :
                    nama.includes("MAS") ? "mas" :
                    nama.includes("MI") || nama.includes("MIN") || nama.includes("MIS") ? "mi" :
                    nama.includes("MTs") || nama.includes("MtsN") || nama.includes("MTSS") ? "mts" :
                    "sd";
                categoryCounts[kategori] = (categoryCounts[kategori] || 0) + 1;
            });

            new Chart(document.getElementById("sekolahChart"), {
                type: "bar",
                data: {
                    labels: ["SD", "SMP", "SMA", "MAN", "MAS", "MI", "MTs"],
                    datasets: [{
                        label: "Jumlah Sekolah",
                        data: [
                            categoryCounts["sd"] || 0,
                            categoryCounts["smp"] || 0,
                            categoryCounts["sma"] || 0,
                            categoryCounts["man"] || 0,
                            categoryCounts["mas"] || 0,
                            categoryCounts["mi"] || 0,
                            categoryCounts["mts"] || 0
                        ],
                        backgroundColor: ["#4CAF50", "#388E3C", "#FFC107", "#800080", "#FF4500", "#FFA500", "#6A5ACD"],
                        borderColor: "#388E3C",
                        borderWidth: 1
                    }]
                },
                options: {
                    scales: { y: { beginAtZero: true } }
                }
            });
        },

        addSearchControl(data) {
            const sekolahLayer = L.geoJSON(data);
            var searchControl = new L.Control.Search({
                layer: sekolahLayer,
                propertyName: "Nama",
                marker: false,
                moveToLocation: (latlng, title, map) => {
                    map.setView(latlng, 17);
                }
            });
            searchControl.addTo(this.map);

            searchControl.on("search:locationfound", e => {
                if (e.layer) e.layer.openPopup();
            });
        }
    }));
});
