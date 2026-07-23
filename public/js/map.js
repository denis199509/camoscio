// Global map variables
window.mapInstance = null;
let userGpsMarker = null;
let hikePolyline = null;
let reportMarkersGroup = null;
let peakMarkersGroup = null;
let activeHikePath = []; // Array di coordinate per il sentiero attivo

// Ambito geografico attuale della demo: Lazio, Molise, Abruzzo, Marche ("per ora", vedi nota owner).
// Unico punto da modificare per allargare l'ambito in futuro (es. a tutta Italia).
window.CAMOSCIO_REGION_BOUNDS = { minLat: 40.8, maxLat: 43.9, minLng: 11.4, maxLng: 15.2 };

// Coordinate di default (Campo Imperatore, Gran Sasso - Abruzzo)
const defaultCenter = [42.62, 13.40];
window.userSimulatedLocation = { lat: 42.4423, lng: 13.5581 }; // Partenza da Campo Imperatore di default

function initMapModule() {
    // Inizializza la mappa Leaflet, vincolata all'ambito geografico corrente
    const b = window.CAMOSCIO_REGION_BOUNDS;
    window.mapInstance = L.map('map', {
        maxBounds: [[b.minLat, b.minLng], [b.maxLat, b.maxLng]],
        maxBoundsViscosity: 1.0,
        minZoom: 7
    }).setView(defaultCenter, 9);

    // Carica i tiles da OpenStreetMap (Open Source)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(window.mapInstance);

    // Gruppi di marker per poterli pulire e ricreare facilmente
    reportMarkersGroup = L.layerGroup().addTo(window.mapInstance);
    peakMarkersGroup = L.layerGroup().addTo(window.mapInstance);

    // Crea il marker GPS dell'utente trascinabile (Simulazione)
    createUserGpsMarker();

    // Event listener per il click sulla mappa (per Waze crowdsourcing)
    window.mapInstance.on('click', onMapClick);

    // Carica i marker dei report Waze e i sentieri
    renderMapMarkers();
    
    // Inizializza eventi dei form
    setupMapForms();
}

// Crea e gestisce il marker della posizione GPS simulata
function createUserGpsMarker() {
    const userIcon = L.divIcon({
        className: 'user-gps-leaflet-marker',
        html: `<div style="font-size: 2rem; filter: drop-shadow(0 0 5px rgba(255,107,53,0.8));">🥾</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    userGpsMarker = L.marker([userSimulatedLocation.lat, userSimulatedLocation.lng], {
        draggable: true,
        icon: userIcon
    }).addTo(window.mapInstance);

    userGpsMarker.bindTooltip("<b>Tu (Tracciamento GPS)</b><br>Trascina il marker per spostarti sui sentieri", {
        permanent: false,
        direction: 'top'
    });

    // Quando l'utente sposta il marker, controlliamo il geofencing delle vette
    userGpsMarker.on('dragend', function (event) {
        const position = userGpsMarker.getLatLng();
        window.userSimulatedLocation = { lat: position.lat, lng: position.lng };
        
        // Se il modulo mesh simulator radar è attivo, aggiorna la posizione anche lì
        if (window.updateRadarPosition) {
            window.updateRadarPosition(userSimulatedLocation);
        }

        checkGeofencing(position.lat, position.lng);
    });
}

// Sposta il marker GPS via codice (usato quando si clicca su una cima o trailhead)
function teleportUserGps(lat, lng) {
    window.userSimulatedLocation = { lat, lng };
    if (userGpsMarker) {
        userGpsMarker.setLatLng([lat, lng]);
        window.mapInstance.panTo([lat, lng]);
        checkGeofencing(lat, lng);
    }
}

// Rileva se il marker GPS è vicino a vette o rifugi per sbloccare i timbri
function checkGeofencing(lat, lng) {
    const db = window.CamoscioState;
    let foundNearPeak = null;
    let distance = Infinity;

    // Controlla tutte le vette in tutte le escursioni
    db.hikes.forEach(hike => {
        hike.peaks.forEach(peak => {
            const dist = calculateDistance(lat, lng, peak.lat, peak.lng);
            if (dist < 150) { // Distanza in metri per sbloccare (150m)
                foundNearPeak = peak;
                distance = dist;
            }
        });
    });

    if (foundNearPeak) {
        const stampId = foundNearPeak.stampId;
        const alreadyHasStamp = db.stamps.some(s => s.stampId === stampId);

        if (alreadyHasStamp) {
            userGpsMarker.bindPopup(`
                <div style="color: white; font-family: inherit;">
                    <h5 style="margin: 0 0 6px 0;">📍 ${foundNearPeak.name}</h5>
                    <p style="font-size: 0.8rem; margin: 0;">Hai già collezionato questo timbro del passaporto!</p>
                </div>
            `).openPopup();
        } else {
            userGpsMarker.bindPopup(`
                <div style="color: white; font-family: inherit; text-align: center;">
                    <h4 style="margin: 0 0 4px 0;">🎉 Vetta Raggiunta!</h4>
                    <h5 style="margin: 0 0 8px 0; color: #FF6B35;">${foundNearPeak.name} (${foundNearPeak.altitude}m)</h5>
                    <p style="font-size: 0.8rem; margin: 0 0 10px 0;">Sei a soli ${Math.round(distance)}m dalla cima.</p>
                    <button class="btn btn-sm btn-primary" onclick="unlockStampDirectly('${stampId}', '${foundNearPeak.name}')">TIMBRA PASSAPORTO</button>
                </div>
            `).openPopup();
        }
    } else {
        userGpsMarker.closePopup();
    }
}

// Funzione globale per poter essere chiamata dal popup Leaflet
window.unlockStampDirectly = async function(stampId, peakName) {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    try {
        const response = await fetch('/api/stamps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: usr.id, stampId })
        });
        
        if (response.ok) {
            // Rinfresca lo stato globale
            await window.CamoscioState.stamps.push({
                userId: usr.id,
                stampId,
                dateUnlocked: new Date().toISOString().split('T')[0]
            });
            
            userGpsMarker.bindPopup(`
                <div style="color: white; text-align: center;">
                    <h4>Timbro Sbloccato! 🏆</h4>
                    <p style="font-size: 0.8rem; margin-top: 6px;">Il passaporto delle vette per <b>${peakName}</b> è stato timbrato con successo!</p>
                </div>
            `).openPopup();

            // Aggiorna la dashboard se aperta
            if (document.getElementById("dashboard").classList.contains("active")) {
                window.renderDashboardStamps();
            }
        }
    } catch (e) {
        console.error("Errore nello sblocco del timbro:", e);
    }
};

// Calcolo distanza tramite formula Haversine (Open Source standard)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // raggio terrestre in metri
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// Click sulla mappa per segnalare anomalia (Waze)
function onMapClick(e) {
    const formContainer = document.getElementById("waze-form-container");
    if (!formContainer) return;

    formContainer.classList.remove("hidden");
    
    // Memorizza le coordinate cliccate nei campi temporanei o negli attributi del form
    formContainer.setAttribute("data-clicked-lat", e.latlng.lat);
    formContainer.setAttribute("data-clicked-lng", e.latlng.lng);

    // Sposta la visualizzazione della mappa leggermente per far spazio
    window.mapInstance.panTo(e.latlng);
}

// Configura i form relativi alla mappa
function setupMapForms() {
    // Form Waze
    const form = document.getElementById("waze-report-form");
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formContainer = document.getElementById("waze-form-container");
            const lat = parseFloat(formContainer.getAttribute("data-clicked-lat"));
            const lng = parseFloat(formContainer.getAttribute("data-clicked-lng"));
            
            const type = document.getElementById("waze-type").value;
            const desc = document.getElementById("waze-desc").value;

            if (isNaN(lat) || isNaN(lng)) return;

            try {
                const response = await fetch('/api/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, lat, lng, description: desc })
                });

                if (response.ok) {
                    form.reset();
                    formContainer.classList.add("hidden");
                    
                    // Ricarica i marker
                    await refreshState();
                    renderMapMarkers();
                    renderWazeReportsList();
                }
            } catch (e) {
                console.error("Errore nell'invio del report:", e);
            }
        });
    }

    const btnCancel = document.getElementById("btn-waze-cancel");
    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            document.getElementById("waze-form-container").classList.add("hidden");
        });
    }

    // Bottoni di selezione rapida meteo/mappa
    const btnOrobie = document.getElementById("btn-weather-orobie");
    const btnRosa = document.getElementById("btn-weather-rosa");

    if (btnOrobie && btnRosa) {
        // Cerca per titolo invece che per un ID fisso: dalla Fase B gli ID sono generati
        // da MongoDB e cambiano ad ogni migrazione, il titolo invece resta stabile.
        const findHikeByTitle = (fragment) =>
            window.CamoscioState.hikes.find(h => h.title.includes(fragment));

        btnOrobie.addEventListener("click", () => {
            btnOrobie.classList.add("active");
            btnRosa.classList.remove("active");
            const hike = findHikeByTitle("Corno Grande");
            if (hike) loadActiveHikeOnMap(hike.id);
        });

        btnRosa.addEventListener("click", () => {
            btnRosa.classList.add("active");
            btnOrobie.classList.remove("active");
            const hike = findHikeByTitle("Vettore");
            if (hike) loadActiveHikeOnMap(hike.id);
        });
    }

    // Pulsante posizione GPS reale (aggiuntivo, il marker trascinabile resta il sistema principale)
    const btnRealGps = document.getElementById("btn-use-real-gps");
    if (btnRealGps) {
        btnRealGps.addEventListener("click", useRealGpsPosition);
    }
}

// Usa la Geolocation API standard del browser per centrare il marker sulla posizione reale.
// Funziona anche su http://localhost senza HTTPS (localhost è considerato un contesto sicuro).
function useRealGpsPosition() {
    const btn = document.getElementById("btn-use-real-gps");
    if (!navigator.geolocation) {
        window.showToast("Il tuo browser non supporta la geolocalizzazione. Usa il marker trascinabile per simulare la posizione.", "error");
        return;
    }

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader"></i> Localizzazione in corso...`;
    if (window.lucide) window.lucide.createIcons();

    navigator.geolocation.getCurrentPosition(
        (position) => {
            teleportUserGps(position.coords.latitude, position.coords.longitude);
            window.mapInstance.setView([position.coords.latitude, position.coords.longitude], 13);
            btn.disabled = false;
            btn.innerHTML = originalLabel;
            if (window.lucide) window.lucide.createIcons();
        },
        (error) => {
            btn.disabled = false;
            btn.innerHTML = originalLabel;
            if (window.lucide) window.lucide.createIcons();

            let msg = "Impossibile ottenere la posizione GPS reale.";
            if (error.code === error.PERMISSION_DENIED) {
                msg = "Permesso di geolocalizzazione negato. Puoi comunque simulare la posizione trascinando il marker sulla mappa.";
            }
            window.showToast(msg, "error");
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Render dei marker sulla mappa (Waze reports + Vette e Rifugi)
function renderMapMarkers() {
    if (!window.mapInstance) return;

    // Svuota i gruppi precedenti
    reportMarkersGroup.clearLayers();
    peakMarkersGroup.clearLayers();

    const db = window.CamoscioState;

    // Disegna pericoli Waze
    db.reports.forEach(rep => {
        if (rep.status !== 'active') return;

        const emojiMap = {
            frana: '⚠️',
            ghiaccio: '❄️',
            fontana_secca: '💧',
            ostacolo: '🌲'
        };
        const titleMap = {
            frana: 'Frana / Cedimento',
            ghiaccio: 'Presenza Ghiaccio',
            fontana_secca: 'Sorgente Senz\'Acqua',
            ostacolo: 'Sentiero Ostruito'
        };

        const emoji = emojiMap[rep.type] || '⚠️';
        const title = titleMap[rep.type] || 'Avviso';

        const customIcon = L.divIcon({
            className: 'waze-leaflet-marker',
            html: `<div style="font-size: 1.8rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #EF4444; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">${emoji}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        const marker = L.marker([rep.lat, rep.lng], { icon: customIcon });
        
        marker.bindPopup(`
            <div style="color: white; font-family: inherit;">
                <h5 style="margin: 0 0 4px 0; color: #EF4444;">${title}</h5>
                <p style="font-size: 0.8rem; margin: 0 0 8px 0;">${rep.description}</p>
                <span class="small text-muted">Segnalato il: ${new Date(rep.createdAt).toLocaleDateString()}</span>
            </div>
        `);
        
        reportMarkersGroup.addLayer(marker);
    });

    // Disegna vette/rifugi legati al percorso attivo
    const activeHike = db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]; // Escursione scelta, o la prima disponibile
    if (activeHike) {
        activeHike.peaks.forEach(peak => {
            const peakIcon = L.divIcon({
                className: 'peak-leaflet-marker',
                html: `<div style="font-size: 1.6rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #00D2FF; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">🏔️</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const marker = L.marker([peak.lat, peak.lng], { icon: peakIcon });
            
            const isUnlocked = db.stamps.some(s => s.stampId === peak.stampId);
            
            marker.bindPopup(`
                <div style="color: white; font-family: inherit; text-align: center;">
                    <h5 style="margin: 0 0 4px 0;">📍 ${peak.name}</h5>
                    <p style="font-size: 0.8rem; margin: 0 0 6px 0;">Altitudine: <b>${peak.altitude}m</b></p>
                    <span class="badge ${isUnlocked ? 'badge-green' : 'badge-accent'}">
                        ${isUnlocked ? 'Timbro Collezionato ✓' : 'Timbro non Sbloccato'}
                    </span>
                    <br><br>
                    <button class="btn btn-sm btn-secondary" onclick="teleportUserGps(${peak.lat}, ${peak.lng})">Teletrasporta GPS qui</button>
                </div>
            `);
            
            peakMarkersGroup.addLayer(marker);
        });
    }
}

// Render della lista segnalazioni nella sidebar mappa
function renderWazeReportsList() {
    const container = document.getElementById("waze-list-container");
    if (!container) return;

    const db = window.CamoscioState;
    container.innerHTML = "";

    const activeReports = db.reports.filter(r => r.status === 'active');

    if (activeReports.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessuna segnalazione attiva sui sentieri.</div>`;
        return;
    }

    activeReports.forEach(rep => {
        const item = document.createElement("div");
        item.className = "waze-item";

        const emojiMap = { frana: '⚠️', ghiaccio: '❄️', fontana_secca: '💧', ostacolo: '🌲' };
        const emoji = emojiMap[rep.type] || '⚠️';

        item.innerHTML = `
            <span>${emoji}</span>
            <div class="waze-item-desc">
                <strong>${rep.description}</strong>
                <div class="text-muted small">Coord: ${rep.lat.toFixed(3)}, ${rep.lng.toFixed(3)}</div>
            </div>
            <button class="waze-item-resolve" onclick="resolveReportDirectly('${rep.id}')" title="Risolvi segnalazione">✓</button>
        `;
        container.appendChild(item);
    });
}

// Rimuove un report risolto
window.resolveReportDirectly = async function(reportId) {
    // Nel nostro server locale possiamo simulare la rimozione o inviare una richiesta
    // In questo mock aggiorniamo lo stato locale per reattività immediata
    const db = window.CamoscioState;
    const index = db.reports.findIndex(r => r.id === reportId);
    if (index !== -1) {
        db.reports[index].status = 'resolved';
        // Invia una finta cancellazione al DB locale del server (oppure lo aggiorna)
        try {
            await fetch(`/api/reports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Salvando l'anomalia come risolta
                body: JSON.stringify({ id: reportId, status: 'resolved' })
            });
        } catch(e) {}
        
        renderMapMarkers();
        renderWazeReportsList();
    }
};

// Carica e disegna un percorso specifico sulla mappa
function loadActiveHikeOnMap(hikeId) {
    if (!window.mapInstance) return;

    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    // Questa è ora l'escursione attiva anche per Zaino Intelligente e Carpooling
    db.activeHikeId = hikeId;

    // Centra mappa sul ritrovo
    window.mapInstance.setView([hike.trailhead.lat, hike.trailhead.lng], 13);

    // Pulisce sentiero precedente
    if (hikePolyline) {
        window.mapInstance.removeLayer(hikePolyline);
    }

    // Genera un percorso fittizio ma sensato attorno al trailhead
    // Per far vedere l'algoritmo di esposizione solare, creiamo segmenti Nord e Sud
    const centerLat = hike.trailhead.lat;
    const centerLng = hike.trailhead.lng;

    activeHikePath = [
        [centerLat - 0.02, centerLng - 0.02], // Base
        [centerLat - 0.01, centerLng - 0.015], // Salita versante Nord (Ombreggiato)
        [centerLat, centerLng], // Rifugio / Punto intermedio
        [centerLat + 0.01, centerLng + 0.01], // Cresta soleggiata
        [centerLat + 0.02, centerLng + 0.015] // Cima (Versante Sud)
    ];

    // Se l'utente vuole l'esposizione solare, coloriamo il sentiero in modo speciale
    // Altrimenti lo coloriamo di verde foresta standard
    hikePolyline = L.polyline(activeHikePath, {
        color: '#10B981',
        weight: 6,
        opacity: 0.8
    }).addTo(window.mapInstance);

    // Sposta il marker GPS dell'utente alla partenza
    teleportUserGps(activeHikePath[0][0], activeHikePath[0][1]);

    // Rigenera i marker delle vette relative a questa escursione
    peakMarkersGroup.clearLayers();
    hike.peaks.forEach(peak => {
        const peakIcon = L.divIcon({
            className: 'peak-leaflet-marker',
            html: `<div style="font-size: 1.6rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #00D2FF; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">🏔️</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([peak.lat, peak.lng], { icon: peakIcon });
        const isUnlocked = db.stamps.some(s => s.stampId === peak.stampId);
        
        marker.bindPopup(`
            <div style="color: white; font-family: inherit; text-align: center;">
                <h5 style="margin: 0 0 4px 0;">📍 ${peak.name}</h5>
                <p style="font-size: 0.8rem; margin: 0 0 6px 0;">Altitudine: <b>${peak.altitude}m</b></p>
                <span class="badge ${isUnlocked ? 'badge-green' : 'badge-accent'}">
                    ${isUnlocked ? 'Timbro Collezionato ✓' : 'Timbro non Sbloccato'}
                </span>
                <br><br>
                <button class="btn btn-sm btn-secondary" onclick="teleportUserGps(${peak.lat}, ${peak.lng})">Teletrasporta GPS qui</button>
            </div>
        `);
        
        peakMarkersGroup.addLayer(marker);
    });

    // Aggiorna consigli esposizione solare nella sidebar della mappa
    renderSolarExposureAdvice(hike);
    
    // Trigger aggiornamento meteo multi-quota
    if (window.fetchWeatherForCoords) {
        window.fetchWeatherForCoords(hike.trailhead.lat, hike.trailhead.lng, hike.title);
    }
}

// Calcola l'orientamento iniziale (bearing) in gradi (0-360) da un punto A ad un punto B
function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = deg => deg * Math.PI / 180;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const bearingRad = Math.atan2(y, x);

    return (bearingRad * 180 / Math.PI + 360) % 360;
}

// Classifica un orientamento in uno degli 8 settori cardinali
function bearingToCompassSector(bearing) {
    const sectors = [
        { label: "Nord", key: "N" }, { label: "Nord-Est", key: "NE" },
        { label: "Est", key: "E" }, { label: "Sud-Est", key: "SE" },
        { label: "Sud", key: "S" }, { label: "Sud-Ovest", key: "SW" },
        { label: "Ovest", key: "W" }, { label: "Nord-Ovest", key: "NW" }
    ];
    const index = Math.round(bearing / 45) % 8;
    return sectors[index];
}

// Algoritmo di consiglio esposizione solare: orientamento reale trailhead->cima + stagione,
// generalizzato a qualunque escursione (non più legato a id fissi). Un vero calcolo di pendenza
// da modello digitale del terreno resta fuori scope: qui si usa l'orientamento come proxy.
function renderSolarExposureAdvice(hike) {
    const adviceBox = document.getElementById("sun-advice-box");
    if (!adviceBox) return;

    const month = new Date().getMonth(); // 0 = Gen, 6 = Lug
    const isSummer = (month >= 5 && month <= 8); // Giugno - Settembre

    if (!hike.peaks || hike.peaks.length === 0) {
        adviceBox.className = "sun-advice-box info";
        adviceBox.innerHTML = `Nessuna vetta registrata per questo percorso: impossibile stimare l'orientamento del versante. Valuta comunque partenze anticipate nei mesi estivi per evitare le ore più calde.`;
        return;
    }

    // Usa l'orientamento verso l'ultima cima registrata (tipicamente la vetta principale)
    const summit = hike.peaks[hike.peaks.length - 1];
    const bearing = calculateBearing(hike.trailhead.lat, hike.trailhead.lng, summit.lat, summit.lng);
    const sector = bearingToCompassSector(bearing);
    const isNorthFacing = ["N", "NE", "NW"].includes(sector.key);
    const isGlacierRisk = hike.maxAltitude > 3500;

    let html = "";
    if (isGlacierRisk) {
        adviceBox.className = "sun-advice-box summer";
        html = `<strong>❄️ Alta Quota: Riflesso Ghiacciaio Elevato (versante ${sector.label})</strong><br>
            A quota superiore a 3500m l'esposizione solare è massima. Obbligo di occhiali da sole categoria 4 e crema protettiva. Attenzione al riscaldamento del ghiacciaio dalle ore 12:00 che rende instabili i ponti di neve.`;
    } else if (isSummer && !isNorthFacing) {
        adviceBox.className = "sun-advice-box summer";
        html = `<strong>☀️ Consiglio Estivo: Versante ${sector.label}, esposizione elevata</strong><br>
            Il percorso verso la cima è orientato a ${sector.label} e si scalda rapidamente nelle ore centrali. Si raccomanda la partenza entro le 07:00 per evitare colpi di calore e attenzione al rischio fulmini pomeridiano.`;
    } else if (isSummer && isNorthFacing) {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>🌲 Consiglio Estivo: Versante ${sector.label}, più ombreggiato</strong><br>
            Il percorso verso la cima è orientato a ${sector.label}: resta più fresco anche nelle ore centrali, ma può trattenere neve o ghiaccio residuo più a lungo negli avvallamenti. Portare comunque protezione solare per i tratti allo scoperto.`;
    } else if (!isSummer && !isNorthFacing) {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>❄️ Consiglio Stagionale: Versante ${sector.label}, massimizza la luce</strong><br>
            Si consiglia di effettuare la salita nelle ore centrali (10:00 - 14:00) sfruttando il versante ${sector.label} per beneficiare del soleggiamento.`;
    } else {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>❄️ Consiglio Stagionale: Versante ${sector.label}, rischio ghiaccio</strong><br>
            Il percorso verso la cima è orientato a ${sector.label}, poco soleggiato in questa stagione: valuta ramponcini/bastoncini e un rientro non troppo tardivo per il rischio di ghiaccio improvviso.`;
    }

    adviceBox.innerHTML = html;
}

// Invocato quando l'utente loggato cambia
function onUserSwitched() {
    renderMapMarkers();
}

// Collegamento globale per inizializzatore
window.onUserSwitched = onUserSwitched;
window.renderMapMarkers = renderMapMarkers;
window.renderWazeReportsList = renderWazeReportsList;
window.loadActiveHikeOnMap = loadActiveHikeOnMap;
window.teleportUserGps = teleportUserGps;
