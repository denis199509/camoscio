// Fase F - Tracciamento GPS live durante l'escursione.
//
// Principi seguiti (vedi cose_da_fare.txt / cronologia.txt):
// - watchPosition continuo, mai un singolo getCurrentPosition.
// - I punti GPS si mettono SEMPRE in coda in IndexedDB per primi (sopravvivono a un
//   crash/chiusura del tab) e si inviano al server a GRUPPI ogni ~25s o al ritorno del
//   segnale, mai uno alla volta - se l'invio fallisce restano in coda e si ritenta da soli.
// - La mappa NON si riscarica mai durante l'escursione (vedi public/js/offline-map.js):
//   va scaricata prima, quando c'e' ancora campo.
// - Pensato apposta per essere comodo su schermo piccolo (telefono in montagna): un
//   pulsante flottante sempre raggiungibile + un pannello con numeri grandi, indipendenti
//   dalla sidebar non responsive del resto dell'app.

const trackingState = {
    sessionId: null,
    hikeId: null,
    startedAtMs: null,
    status: 'idle', // idle | active | paused | ended
    watchId: null,
    flushTimer: null,
    uiTimer: null,
    lastAccuracy: null,
    distanceKm: 0,
    elevationGainM: 0,
    durationSeconds: 0,
    avgSpeedKmh: 0,
    // Tempo gia' maturato (dal server o da un pausa/ripresa precedente) + il momento in cui
    // e' ripartito il conteggio "adesso": separati apposta per poter congelare l'orologio
    // durante una pausa senza perdere il totale precedente.
    baselineSeconds: 0,
    activeResumedAtMs: null
};

let lastLocalPoint = null;
let isFlushInProgress = false;

// Fase G - Sentieri conosciuti vicini alla zona dell'escursione (coordinate complete),
// scaricati UNA VOLTA al primo fix GPS della sessione (non l'intero database regionale:
// il telefono deve restare leggero) e usati solo per un aggancio "veloce e approssimato"
// del puntino mostrato sulla mappa, in attesa della correzione autorevole del server ad
// ogni sincronizzazione (vedi flushPendingPoints). null = non ancora richiesti.
let nearbyTrailSegments = null;

// --- Ciclo di vita della sessione ---

function applySessionState(session) {
    trackingState.sessionId = session.id;
    trackingState.hikeId = session.hikeId || null;
    trackingState.startedAtMs = new Date(session.startedAt).getTime();
    trackingState.status = session.status;
    trackingState.distanceKm = session.distanceKm || 0;
    trackingState.elevationGainM = session.elevationGainM || 0;
    trackingState.baselineSeconds = session.durationSeconds || 0;
    trackingState.activeResumedAtMs = session.status === 'active' ? Date.now() : null;
    resetLocalStats();
    nearbyTrailSegments = null; // ogni escursione puo' essere in una zona diversa, si riscarica da capo
}

async function startTracking() {
    if (!navigator.geolocation) {
        window.showToast("Il tuo browser non supporta la geolocalizzazione: impossibile registrare il percorso reale.", "error");
        return;
    }

    // Il consenso scelto in registrazione (Fase C) e il suo salvataggio stanno ora in un
    // punto solo, geolocation.js: da quando esiste anche il puntino blu (punto 26) la stessa
    // richiesta parte da due posti diversi, e due copie sarebbero finite per divergere.
    if (window.CamoscioGeo) {
        const ok = await window.CamoscioGeo.assicuraConsenso(
            "Per registrare il percorso GPS dell'escursione serve la posizione reale del telefono. Avevi lasciato il consenso alla geolocalizzazione disattivato in registrazione: vuoi attivarlo ora e continuare?"
        );
        if (!ok) return;
    }

    const hikeSelect = document.getElementById('tracking-hike-select');
    const hikeId = hikeSelect && hikeSelect.value ? hikeSelect.value : null;
    const btnStart = document.getElementById('btn-tracking-start');
    if (btnStart) btnStart.disabled = true;

    try {
        const res = await fetch('/api/tracking/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hikeId })
        });
        if (!res.ok) throw new Error('Richiesta fallita');
        const session = await res.json();

        applySessionState(session);
        if (window.resetLiveTrackPolyline) window.resetLiveTrackPolyline();
        // Punto 11: porta la mappa sulla posizione reale a zoom da camminata e falla
        // seguire. Senza questo la mappa resta a zoom 9, dove un'ora di cammino si
        // sposta di pochi pixel e il segnaposto sembra bloccato.
        if (window.beginLiveGpsView) window.beginLiveGpsView();
        beginWatchingPosition();
        startUiTimer();
        startFlushTimer();
        renderTrackingUi();
        updateMapRecordButton();
        window.showToast("Tracciamento GPS avviato: buona escursione! 🥾", "success");
    } catch (e) {
        console.error("Errore avvio tracciamento:", e);
        window.showToast("Impossibile avviare il tracciamento GPS. Riprova.", "error");
    } finally {
        if (btnStart) btnStart.disabled = false;
    }
}

async function pauseTracking() {
    if (trackingState.activeResumedAtMs) {
        trackingState.baselineSeconds += (Date.now() - trackingState.activeResumedAtMs) / 1000;
        trackingState.activeResumedAtMs = null;
    }
    stopWatchingPosition();
    stopUiTimer();
    trackingState.status = 'paused';
    updatePanelButtonsForStatus();
    renderTrackingStats();

    // Si svuota la coda PRIMA di avvisare il server della pausa: altrimenti l'ultimo
    // gruppo di punti (gia' in coda da prima del click) arriverebbe dopo e rimetterebbe
    // per errore lo stato lato server su "active".
    await flushPendingPoints();
    stopFlushTimer();

    try {
        await fetch(`/api/tracking/${trackingState.sessionId}/pause`, { method: 'POST' });
    } catch (e) {
        console.error("Errore pausa tracciamento:", e);
    }
}

async function resumeTracking() {
    trackingState.activeResumedAtMs = Date.now();
    trackingState.status = 'active';
    // Solo la DISTANZA si azzera qui, non tutta resetLocalStats(): serve a evitare un salto
    // fasullo fra il punto pre-pausa e il primo dopo. La memoria del dislivello invece NON va
    // azzerata, perche' il server non azzera elevationRefM su una pausa - azzerarla solo qui
    // farebbe divergere i due conti, ed e' proprio il genere di differenza che poi si vede a
    // schermo come un numero che cambia da solo.
    lastLocalPoint = null;
    beginWatchingPosition();
    startUiTimer();
    startFlushTimer();
    updatePanelButtonsForStatus();

    try {
        await fetch(`/api/tracking/${trackingState.sessionId}/resume`, { method: 'POST' });
    } catch (e) {
        console.error("Errore ripresa tracciamento:", e);
    }
}

async function endTracking() {
    const confirmed = await window.showConfirmModal("Vuoi terminare il tracciamento di questa escursione? Il riepilogo finale userà i dati raccolti finora.");
    if (!confirmed) return;

    if (trackingState.activeResumedAtMs) {
        trackingState.baselineSeconds += (Date.now() - trackingState.activeResumedAtMs) / 1000;
        trackingState.activeResumedAtMs = null;
    }

    stopWatchingPosition();
    stopUiTimer();
    await flushPendingPoints();
    stopFlushTimer();

    let finalSession = null;
    try {
        const res = await fetch(`/api/tracking/${trackingState.sessionId}/end`, { method: 'POST' });
        finalSession = await res.json();
    } catch (e) {
        console.error("Errore chiusura tracciamento:", e);
    }

    trackingState.status = 'ended';
    if (window.endLiveGpsView) window.endLiveGpsView();
    updateMapRecordButton();
    renderSummary(finalSession);
}

async function completeLinkedHike(durationSeconds) {
    if (!trackingState.hikeId) return;
    const actualTimeHours = Math.round((durationSeconds / 3600) * 100) / 100;

    try {
        const res = await fetch(`/api/hikes/${trackingState.hikeId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actualTimeHours })
        });
        if (res.ok) {
            window.showToast("Escursione segnata come completata con i dati reali del tracciamento!", "success");
            await refreshState();
            if (window.renderHikesList) window.renderHikesList();
        } else {
            const body = await res.json().catch(() => ({}));
            window.showToast(body.error || "Non è stato possibile segnare l'escursione come completata.", "error");
        }
    } catch (e) {
        console.error("Errore nel completamento automatico:", e);
        window.showToast("Non è stato possibile segnare l'escursione come completata.", "error");
    }

    const btn = document.getElementById('btn-tracking-mark-complete');
    if (btn) btn.classList.add('hidden');
}

// --- Geolocalizzazione ---

function beginWatchingPosition() {
    if (trackingState.watchId !== null) return;

    // Punto 26 - da qui in poi il GPS lo tiene acceso il tracciamento, e il puntino blu si
    // limita a consumare i fix che arrivano di qua (vedi onPositionUpdate). Senza questa
    // riga resterebbero DUE watchPosition accesi insieme per tutta l'escursione: proprio nel
    // momento in cui la batteria conta di piu'.
    if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(true);

    trackingState.watchId = navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
    });
}

function stopWatchingPosition() {
    if (trackingState.watchId !== null) {
        navigator.geolocation.clearWatch(trackingState.watchId);
        trackingState.watchId = null;
    }
    // L'altra meta' della transizione: il puntino torna a procurarsi i fix da solo. Va fatto
    // SEMPRE, anche se il watch era gia' chiuso, altrimenti una pausa seguita da uno stop
    // lascerebbe il puntino in attesa di fix da una fonte che non c'e' piu'.
    if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(false);
}

async function onPositionUpdate(pos) {
    if (trackingState.status !== 'active') return; // in pausa: nessun nuovo punto registrato

    const { latitude, longitude, altitude, accuracy } = pos.coords;
    const seconds = Math.round((Date.now() - trackingState.startedAtMs) / 1000);
    const point = [
        Math.round(longitude * 1e5) / 1e5,
        Math.round(latitude * 1e5) / 1e5,
        (typeof altitude === 'number' && !Number.isNaN(altitude)) ? Math.round(altitude) : null,
        seconds,
        Math.round(accuracy || 0)
    ];

    trackingState.lastAccuracy = point[4];

    // Fase G - Al primissimo fix GPS della sessione si scaricano (una volta sola) i
    // sentieri conosciuti nella zona, per un aggancio rapido e approssimato mostrato subito
    // sulla mappa. Il dato definitivo resta comunque quello calcolato dal server (vedi
    // flushPendingPoints): qui e' solo un riscontro visivo immediato, non autorevole.
    if (nearbyTrailSegments === null) {
        nearbyTrailSegments = [];
        loadNearbyTrailSegments(longitude, latitude);
    }
    const quickSnapResult = quickSnapToNearbyTrail(longitude, latitude, point[4]);
    const displayLng = quickSnapResult ? quickSnapResult.point[0] : longitude;
    const displayLat = quickSnapResult ? quickSnapResult.point[1] : latitude;

    // Punto 26 - al puntino blu va la posizione GREZZA con la sua precisione vera, non quella
    // agganciata al sentiero qui sopra: il puntino deve dire dove il telefono crede di essere
    // e quanto poco ne e' sicuro, mentre l'aggancio e' una correzione utile alla traccia ma
    // che darebbe l'impressione di una precisione che il GPS non ha.
    if (window.CamoscioGeo) window.CamoscioGeo.pushPosition(latitude, longitude, accuracy);

    // Riscontro immediato lato client, prima ancora della risposta del server
    accumulateLocalStats([displayLng, displayLat, point[2], point[3], point[4]]);
    if (window.updateLiveGpsPosition) window.updateLiveGpsPosition(displayLat, displayLng);
    if (window.addLiveTrackPoint) window.addLiveTrackPoint(displayLat, displayLng);
    renderTrackingStats();
    renderGpsQuality();

    try {
        // In coda/al server va SEMPRE il punto GPS grezzo, non quello corretto in locale:
        // il server rifa' comunque l'aggancio per conto suo con l'intero database dei
        // sentieri (non solo la zona vicina scaricata qui), e' lui il dato definitivo.
        await idbQueuePoints(trackingState.sessionId, [point]);
    } catch (e) {
        console.error("Impossibile mettere in coda il punto GPS:", e);
    }
}

// Scarica una volta sola (non l'intero database regionale: solo la zona interessata) i
// sentieri noti vicini al punto dato, per il controllo rapido lato telefono.
async function loadNearbyTrailSegments(lng, lat) {
    try {
        const res = await fetch(`/api/tracking/nearby-trails?lng=${lng}&lat=${lat}&radiusKm=5`);
        nearbyTrailSegments = res.ok ? await res.json() : [];
    } catch (e) {
        console.error("Impossibile scaricare i sentieri vicini per l'aggancio rapido:", e);
        nearbyTrailSegments = [];
    }
}

// Punto piu' vicino sul segmento [a,b] a "pt" (tutti [lng,lat]) - stessa identica logica di
// nearestPointOnSegment in lib/geometry.js lato server, duplicata qui perche' il frontend
// non ha un bundler condiviso col backend (stesso criterio gia' in uso per altre piccole
// funzioni geometriche come calculateDistance).
function nearestPointOnSegmentClient(pt, a, b) {
    const mLat = 111320, mLng = 111320 * Math.cos(pt[1] * Math.PI / 180);
    const x0 = pt[0] * mLng, y0 = pt[1] * mLat;
    const x1 = a[0] * mLng, y1 = a[1] * mLat;
    const x2 = b[0] * mLng, y2 = b[1] * mLat;
    const dx = x2 - x1, dy = y2 - y1;

    let t = 0;
    if (dx !== 0 || dy !== 0) {
        t = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)));
    }
    const px = x1 + t * dx, py = y1 + t * dy;
    return { point: [px / mLng, py / mLat], distanceM: Math.hypot(x0 - px, y0 - py) };
}

// Aggancio "veloce e approssimato" lato telefono (Fase G): stessa soglia adattiva usata
// dal server (10m di margine OSM + precisione GPS del momento, tetto 60m), ma solo contro
// i sentieri della zona gia' scaricati - non e' quello autorevole, serve solo a mostrare
// subito un puntino stabile invece che ballerino in attesa della sincronizzazione.
function quickSnapToNearbyTrail(lng, lat, accuracyM) {
    if (!nearbyTrailSegments || nearbyTrailSegments.length === 0) return null;

    const threshold = Math.min(10 + (accuracyM || 20), 60);
    let best = null;

    for (const coords of nearbyTrailSegments) {
        for (let i = 0; i < coords.length - 1; i++) {
            const { point, distanceM } = nearestPointOnSegmentClient([lng, lat], coords[i], coords[i + 1]);
            if (distanceM <= threshold && (!best || distanceM < best.distanceM)) {
                best = { point, distanceM };
            }
        }
    }
    return best;
}

function onPositionError(err) {
    console.warn("Errore geolocalizzazione:", err.message);
    if (err.code === err.PERMISSION_DENIED) {
        window.showToast("Permesso di geolocalizzazione negato: il tracciamento non può registrare la posizione reale.", "error");
        renderGpsQuality(true);
    }
}

// La soglia del dislivello: la STESSA del server (SOGLIA_DISLIVELLO_M in lib/gpx.js) e la
// stessa dei file .gpx importati. Qui il valore e' scritto perche' il browser non puo'
// leggere un file del server, ma non e' una seconda regola: e' la stessa, e se un giorno la
// si cambia va cambiata in tutti e due i posti.
const SOGLIA_DISLIVELLO_M = 10;

// Quota piu' bassa vista da quando si sta salendo. E' la memoria della regola, la stessa che
// il server tiene in elevationRefM.
let quotaRiferimento = null;

function resetLocalStats() { lastLocalPoint = null; quotaRiferimento = null; }

// Il conto istantaneo mentre si cammina, in attesa che il server risponda coi totali veri
// (flushPendingPoints li riallinea a ogni sincronizzazione).
//
// USA LA STESSA REGOLA DEL SERVER, e deve: prima sommava ogni salto sopra i 3 metri, cioe'
// contava come salita il tremolio della quota GPS - che su un telefono sbaglia molto piu' di
// 3 metri. Il risultato era un numero che saliva da solo stando fermi, e che poi calava di
// colpo alla prima sincronizzazione, quando arrivava il totale del server: due numeri diversi
// sotto gli occhi della stessa persona.
function accumulateLocalStats(point) {
    if (lastLocalPoint) {
        const distKm = calculateDistance(lastLocalPoint[1], lastLocalPoint[0], point[1], point[0]) / 1000;
        trackingState.distanceKm += distKm;
    }
    lastLocalPoint = point;

    const quota = point[2];
    if (typeof quota !== 'number' || !isFinite(quota)) return;
    if (quotaRiferimento === null) { quotaRiferimento = quota; return; }

    if (quota > quotaRiferimento + SOGLIA_DISLIVELLO_M) {
        trackingState.elevationGainM += quota - quotaRiferimento;
        quotaRiferimento = quota;
    } else if (quota < quotaRiferimento) {
        quotaRiferimento = quota;
    }
}

// --- Sincronizzazione con il server (coda IndexedDB -> invio a gruppi) ---

async function flushPendingPoints() {
    if (isFlushInProgress || !trackingState.sessionId) return;
    isFlushInProgress = true;

    try {
        const records = await idbGetQueuedPoints(trackingState.sessionId);
        if (records.length === 0) {
            setSyncBadge('synced');
            return;
        }
        setSyncBadge('syncing');

        const res = await fetch(`/api/tracking/${trackingState.sessionId}/points`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: records.map(r => r.point) })
        });

        if (res.ok) {
            const updated = await res.json();
            // Riconcilia con i totali autorevoli del server: corregge da sola qualunque
            // piccola deriva tra il calcolo lato client (istantaneo) e quello lato server.
            trackingState.distanceKm = updated.distanceKm;
            trackingState.elevationGainM = updated.elevationGainM;
            trackingState.baselineSeconds = updated.durationSeconds;
            if (trackingState.activeResumedAtMs) trackingState.activeResumedAtMs = Date.now();

            await idbDeleteQueuedPoints(records.map(r => r.localId));
            setSyncBadge('synced');
            renderTrackingStats();
        } else {
            setSyncBadge('offline');
        }
    } catch (e) {
        setSyncBadge('offline');
    } finally {
        isFlushInProgress = false;
    }
}

function startFlushTimer() {
    stopFlushTimer();
    trackingState.flushTimer = setInterval(flushPendingPoints, 25000);
}

function stopFlushTimer() {
    if (trackingState.flushTimer) {
        clearInterval(trackingState.flushTimer);
        trackingState.flushTimer = null;
    }
}

// --- Orologio live (esclude il tempo in pausa) ---

function currentDurationSeconds() {
    let secs = trackingState.baselineSeconds;
    if (trackingState.activeResumedAtMs) {
        secs += (Date.now() - trackingState.activeResumedAtMs) / 1000;
    }
    return Math.round(secs);
}

function tickUiTimer() {
    trackingState.durationSeconds = currentDurationSeconds();
    trackingState.avgSpeedKmh = trackingState.durationSeconds > 0
        ? (trackingState.distanceKm / (trackingState.durationSeconds / 3600))
        : 0;
    renderTrackingStats();
}

function startUiTimer() {
    stopUiTimer();
    trackingState.uiTimer = setInterval(tickUiTimer, 1000);
    tickUiTimer();
}

function stopUiTimer() {
    if (trackingState.uiTimer) {
        clearInterval(trackingState.uiTimer);
        trackingState.uiTimer = null;
    }
}

// --- Interfaccia: pulsante flottante + pannello ---

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderTrackingStats() {
    const timeText = formatDuration(trackingState.durationSeconds);
    const distText = `${trackingState.distanceKm.toFixed(2)} km`;
    const elevText = `${Math.round(trackingState.elevationGainM)} m`;
    const speedText = `${trackingState.avgSpeedKmh.toFixed(1)} km/h`;

    setText('tracking-stat-time', timeText);
    setText('tracking-stat-distance', distText);
    setText('tracking-stat-elevation', elevText);
    setText('tracking-stat-speed', speedText);

    setText('tracking-mini-time', timeText);
    setText('tracking-mini-distance', distText);
}

function renderGpsQuality(denied = false) {
    const badge = document.getElementById('tracking-gps-quality');
    if (!badge) return;

    if (denied) {
        badge.textContent = 'GPS: permesso negato';
        badge.className = 'badge badge-red';
        return;
    }

    const acc = trackingState.lastAccuracy;
    if (acc == null) {
        badge.textContent = 'GPS: in attesa del segnale...';
        badge.className = 'badge badge-primary';
    } else if (acc <= 15) {
        badge.textContent = `GPS: ottima precisione (±${acc}m)`;
        badge.className = 'badge badge-green';
    } else if (acc <= 40) {
        badge.textContent = `GPS: buona precisione (±${acc}m)`;
        badge.className = 'badge badge-primary';
    } else {
        badge.textContent = `GPS: precisione scarsa (±${acc}m)`;
        badge.className = 'badge badge-red';
    }
}

function setSyncBadge(state) {
    const badge = document.getElementById('tracking-sync-status');
    if (!badge) return;
    if (state === 'synced') {
        badge.textContent = 'Sincronizzato';
        badge.className = 'badge badge-green';
    } else if (state === 'syncing') {
        badge.textContent = 'Sincronizzazione...';
        badge.className = 'badge badge-primary';
    } else {
        badge.textContent = 'Offline: dati in coda';
        badge.className = 'badge badge-red';
    }
}

function renderMiniBarIcon() {
    const icon = document.getElementById('tracking-mini-icon');
    if (icon) icon.textContent = trackingState.status === 'paused' ? '⏸️' : '🔴';
}

// --- Punto 14: tasto unico "Comincia registrazione" sulla mappa ---
// Il pannello del pulsante a scarpone resta (serve per scegliere l'escursione collegata,
// scaricare la mappa offline, mettere in pausa). Questo invece e' la scorciatoia chiesta
// esplicitamente: sei sulla mappa, premi un tasto, parte la registrazione.

// Una registrazione e' "in corso" sia mentre si cammina sia durante una pausa: in
// entrambi i casi la sessione e' aperta e il tasto sulla mappa deve dire "Termina".
window.CamoscioTrackingIsRecording = function () {
    return trackingState.status === 'active' || trackingState.status === 'paused';
};

function updateMapRecordButton() {
    const btn = document.getElementById('btn-map-quick-record');
    const label = document.getElementById('map-record-label');
    if (!btn || !label) return;

    const recording = window.CamoscioTrackingIsRecording();
    label.textContent = recording ? 'Termina registrazione' : 'Comincia registrazione';
    btn.classList.toggle('btn-danger', recording);
    btn.classList.toggle('btn-primary', !recording);
    btn.classList.toggle('is-recording', recording);

    // Punto 45: hike-select e download mappa offline, spostati qui dal vecchio pannello a
    // scarpone, si bloccano mentre si registra - l'hikeId si fissa a startTracking() e un
    // select ancora modificabile mentirebbe a schermo su quale escursione si sta registrando.
    const hikeSelect = document.getElementById('tracking-hike-select');
    if (hikeSelect) hikeSelect.disabled = recording;
    const btnDownload = document.getElementById('btn-tracking-download-map');
    if (btnDownload) btnDownload.disabled = recording;

    if (window.updateRecenterButton) window.updateRecenterButton();
}

async function onMapRecordButtonClick() {
    if (window.CamoscioTrackingIsRecording()) {
        await endTracking();
    } else {
        // Si riusa esattamente startTracking(), cosi' questo tasto e quello del pannello
        // non possono divergere nel comportamento (consenso geolocalizzazione, escursione
        // collegata gia' selezionata, gestione errori: tutto in un posto solo).
        await startTracking();
    }
    updateMapRecordButton();
}

function updatePanelButtonsForStatus() {
    const btnPause = document.getElementById('btn-tracking-pause');
    const btnResume = document.getElementById('btn-tracking-resume');
    renderMiniBarIcon();
    if (!btnPause || !btnResume) return;

    if (trackingState.status === 'paused') {
        btnPause.classList.add('hidden');
        btnResume.classList.remove('hidden');
    } else {
        btnPause.classList.remove('hidden');
        btnResume.classList.add('hidden');
    }
}

function renderHikeSelectOptions() {
    const select = document.getElementById('tracking-hike-select');
    if (!select) return;

    const db = window.CamoscioState;
    const hikes = db.hikes || [];
    const currentValue = select.value;

    select.innerHTML = '<option value="">Nessuna - traccia libera</option>' +
        hikes.map(h => `<option value="${h.id}">${escapeHtml(h.title)}</option>`).join('');

    if (currentValue && hikes.some(h => h.id === currentValue)) {
        select.value = currentValue;
    } else if (db.activeHikeId && hikes.some(h => h.id === db.activeHikeId)) {
        select.value = db.activeHikeId;
    }
}

function toggleGeoConsentAlert() {
    const alertBox = document.getElementById('tracking-geo-consent-alert');
    if (!alertBox) return;
    const usr = window.CamoscioState.currentUser;
    const needsConsent = !!(usr && !usr.geolocationConsent && !usr.isDemoAccount);
    alertBox.classList.toggle('hidden', !needsConsent);
}

function renderTrackingUi() {
    const idle = document.getElementById('tracking-state-idle');
    const active = document.getElementById('tracking-state-active');
    const summary = document.getElementById('tracking-state-summary');
    const miniBar = document.getElementById('tracking-mini-bar');
    if (!idle || !active || !summary || !miniBar) return;

    if (trackingState.status === 'active' || trackingState.status === 'paused') {
        idle.classList.add('hidden');
        summary.classList.add('hidden');
        active.classList.remove('hidden');
        miniBar.classList.remove('hidden');
        updatePanelButtonsForStatus();
        renderTrackingStats();
        renderGpsQuality();
    } else if (trackingState.status === 'idle') {
        active.classList.add('hidden');
        summary.classList.add('hidden');
        idle.classList.remove('hidden');
        miniBar.classList.add('hidden');
        renderHikeSelectOptions();
        toggleGeoConsentAlert();
    }
}

function renderSummary(finalSession) {
    document.getElementById('tracking-state-idle').classList.add('hidden');
    document.getElementById('tracking-state-active').classList.add('hidden');
    document.getElementById('tracking-state-summary').classList.remove('hidden');
    document.getElementById('tracking-mini-bar').classList.add('hidden');

    const distanceKm = finalSession ? finalSession.distanceKm : trackingState.distanceKm;
    const elevationGainM = finalSession ? finalSession.elevationGainM : trackingState.elevationGainM;
    const durationSeconds = finalSession ? finalSession.durationSeconds : trackingState.durationSeconds;
    const avgSpeedKmh = finalSession ? finalSession.avgSpeedKmh : trackingState.avgSpeedKmh;

    setText('tracking-summary-time', formatDuration(durationSeconds));
    setText('tracking-summary-distance', `${distanceKm.toFixed(2)} km`);
    setText('tracking-summary-elevation', `${Math.round(elevationGainM)} m`);
    setText('tracking-summary-speed', `${avgSpeedKmh.toFixed(1)} km/h`);

    const btnComplete = document.getElementById('btn-tracking-mark-complete');
    if (btnComplete) {
        if (trackingState.hikeId) {
            btnComplete.classList.remove('hidden');
            btnComplete.onclick = () => completeLinkedHike(durationSeconds);
        } else {
            btnComplete.classList.add('hidden');
        }
    }

    showPanel();
}

function showPanel() {
    const panel = document.getElementById('tracking-panel');
    if (panel) panel.classList.remove('hidden');
}

function hidePanel() {
    const panel = document.getElementById('tracking-panel');
    if (panel) panel.classList.add('hidden');
}

function resetToIdleUi() {
    trackingState.status = 'idle';
    trackingState.sessionId = null;
    trackingState.hikeId = null;
    trackingState.distanceKm = 0;
    trackingState.elevationGainM = 0;
    trackingState.baselineSeconds = 0;
    trackingState.durationSeconds = 0;
    trackingState.avgSpeedKmh = 0;
    trackingState.lastAccuracy = null;
    resetLocalStats();
    nearbyTrailSegments = null;
    if (window.clearLiveTrackPolyline) window.clearLiveTrackPolyline();
    if (window.endLiveGpsView) window.endLiveGpsView();
    hidePanel();
    renderTrackingUi();
    updateMapRecordButton();
}

// --- Mappa offline ---

async function handleDownloadOfflineMap() {
    if (!window.getHikeBounds || !window.estimateOfflineDownloadSize || !window.downloadOfflineMapForBounds) {
        window.showToast("Funzione mappa offline non disponibile in questo momento.", "error");
        return;
    }

    const select = document.getElementById('tracking-hike-select');
    const hikeId = select ? select.value : null;
    const db = window.CamoscioState;
    const hike = hikeId ? db.hikes.find(h => h.id === hikeId) : null;

    let bounds;
    if (hike) {
        bounds = window.getHikeBounds(hike);
    } else if (window.mapInstance) {
        bounds = window.mapInstance.getBounds();
    } else {
        window.showToast("Apri prima la sezione Mappa, cosi' posso capire quale area scaricare.", "error");
        return;
    }

    const estimate = window.estimateOfflineDownloadSize(bounds);
    const confirmed = await window.showConfirmModal(
        `Verranno scaricate circa ${estimate.tileCount} porzioni di mappa (~${estimate.estimatedMb} MB). Continuare? (consigliato con Wi-Fi o comunque buona connessione)`
    );
    if (!confirmed) return;

    const progressBox = document.getElementById('tracking-download-progress');
    const progressFill = document.getElementById('tracking-download-progress-fill');
    const progressLabel = document.getElementById('tracking-download-progress-label');
    const btn = document.getElementById('btn-tracking-download-map');

    if (progressBox) progressBox.classList.remove('hidden');
    if (btn) btn.disabled = true;

    try {
        const result = await window.downloadOfflineMapForBounds(bounds, (done, total, failed) => {
            const pct = Math.round((done / total) * 100);
            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressLabel) progressLabel.textContent = `${done}/${total} tile${failed ? ` (${failed} non riuscite)` : ''}`;
        });
        window.showToast(`Mappa offline pronta: ${result.total - result.failed}/${result.total} tile salvate sul dispositivo.`, "success");
    } catch (e) {
        console.error("Errore download mappa offline:", e);
        window.showToast("Errore durante il download della mappa offline.", "error");
    } finally {
        if (btn) btn.disabled = false;
        if (progressBox) setTimeout(() => progressBox.classList.add('hidden'), 3000);
    }
}

// --- Ripresa dopo un ricaricamento della pagina ---

async function checkForResumableSession() {
    try {
        const res = await fetch('/api/tracking/active');
        if (!res.ok) return;
        const session = await res.json();
        if (!session) return;

        applySessionState(session);

        if (window.resetLiveTrackPolyline) window.resetLiveTrackPolyline();
        (session.points || []).forEach(p => {
            if (window.addLiveTrackPoint) window.addLiveTrackPoint(p[1], p[0]);
        });
        if (session.points && session.points.length > 0 && window.updateLiveGpsPosition) {
            const last = session.points[session.points.length - 1];
            window.updateLiveGpsPosition(last[1], last[0], true);
        }

        if (session.status === 'active') {
            // Anche riprendendo dopo un ricaricamento della pagina la mappa deve tornare
            // a inseguire la posizione reale (punto 11), non restare sulla panoramica.
            if (window.beginLiveGpsView) {
                const last = (session.points || [])[(session.points || []).length - 1];
                if (last) window.beginLiveGpsView(last[1], last[0]);
                else window.beginLiveGpsView();
            }
            beginWatchingPosition();
            startUiTimer();
            startFlushTimer();
        }

        renderTrackingUi();
        updateMapRecordButton();
        window.showToast("Tracciamento GPS ripreso da dove eri rimasto.", "info");
    } catch (e) {
        console.error("Impossibile verificare un tracciamento GPS in corso:", e);
    }
}

// --- Inizializzazione modulo ---

function initTrackingModule() {
    const miniBar = document.getElementById('tracking-mini-bar');
    const panelClose = document.getElementById('tracking-panel-close');
    const btnStart = document.getElementById('btn-tracking-start');
    const btnPause = document.getElementById('btn-tracking-pause');
    const btnResume = document.getElementById('btn-tracking-resume');
    const btnEnd = document.getElementById('btn-tracking-end');
    const btnDownload = document.getElementById('btn-tracking-download-map');
    const btnSummaryClose = document.getElementById('btn-tracking-summary-close');

    // Punto 45: il pulsante a scarpone che apriva questo pannello da fermo non c'e' piu' (il
    // suo posto lo prende #report-fab, map.js) - si arriva qui solo mentre si registra
    // (tocco sulla mini-bar) o a fine escursione (riepilogo, vedi renderSummary/showPanel).
    if (miniBar) miniBar.addEventListener('click', () => { renderTrackingUi(); showPanel(); });
    if (panelClose) panelClose.addEventListener('click', hidePanel);
    if (btnStart) btnStart.addEventListener('click', startTracking);
    if (btnPause) btnPause.addEventListener('click', pauseTracking);
    if (btnResume) btnResume.addEventListener('click', resumeTracking);
    if (btnEnd) btnEnd.addEventListener('click', endTracking);
    if (btnDownload) btnDownload.addEventListener('click', handleDownloadOfflineMap);
    if (btnSummaryClose) btnSummaryClose.addEventListener('click', resetToIdleUi);

    // Punto 14: tasto unico sulla mappa + tasto per tornare a farsi seguire (punto 11)
    const btnMapRecord = document.getElementById('btn-map-quick-record');
    const btnMapRecenter = document.getElementById('btn-map-recenter');
    if (btnMapRecord) btnMapRecord.addEventListener('click', onMapRecordButtonClick);
    if (btnMapRecenter) btnMapRecenter.addEventListener('click', () => {
        if (window.recenterOnLiveGps) window.recenterOnLiveGps();
    });
    updateMapRecordButton();

    window.addEventListener('online', () => {
        if (trackingState.sessionId && trackingState.status === 'active') flushPendingPoints();
    });

    checkForResumableSession();
}

window.initTrackingModule = initTrackingModule;
// Punto 45: hike-select e alert di consenso, spostati sulla pagina Mappa vicino al tasto di
// registrazione - prima erano raggiungibili SOLO aprendo il pannello da fermo (il ramo idle
// di renderTrackingUi), che con il vecchio pulsante a scarpone rimosso non si apre piu' da
// soli. Chiamate esplicitamente dal caso "map-section" di triggerSectionRender (app.js).
window.renderHikeSelectOptions = renderHikeSelectOptions;
window.toggleGeoConsentAlert = toggleGeoConsentAlert;
