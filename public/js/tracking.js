// Fase F - Tracciamento GPS live durante l'escursione.
//
// Principi seguiti (vedi cose_da_fare.txt / leggimi.txt):
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
    lastLocalPoint = null;
}

async function startTracking() {
    if (!navigator.geolocation) {
        window.showToast("Il tuo browser non supporta la geolocalizzazione: impossibile registrare il percorso reale.", "error");
        return;
    }

    const usr = window.CamoscioState.currentUser;
    if (usr && !usr.geolocationConsent && !usr.isDemoAccount) {
        const proceed = await window.showConfirmModal("Per registrare il percorso GPS dell'escursione serve la posizione reale del telefono. Avevi lasciato il consenso alla geolocalizzazione disattivato in registrazione: vuoi attivarlo ora e continuare?");
        if (!proceed) return;
        try {
            await fetch(`/api/users/${usr.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geolocationConsent: true })
            });
            usr.geolocationConsent = true;
        } catch (e) {
            console.error("Impossibile aggiornare il consenso geolocalizzazione:", e);
        }
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
        beginWatchingPosition();
        startUiTimer();
        startFlushTimer();
        renderTrackingUi();
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
    lastLocalPoint = null; // evita un salto di distanza fasullo tra il punto pre-pausa e il primo dopo
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

    // Riscontro immediato lato client, prima ancora della risposta del server
    accumulateLocalStats(point);
    if (window.updateLiveGpsPosition) window.updateLiveGpsPosition(latitude, longitude);
    if (window.addLiveTrackPoint) window.addLiveTrackPoint(latitude, longitude);
    renderTrackingStats();
    renderGpsQuality();

    try {
        await idbQueuePoints(trackingState.sessionId, [point]);
    } catch (e) {
        console.error("Impossibile mettere in coda il punto GPS:", e);
    }
}

function onPositionError(err) {
    console.warn("Errore geolocalizzazione:", err.message);
    if (err.code === err.PERMISSION_DENIED) {
        window.showToast("Permesso di geolocalizzazione negato: il tracciamento non può registrare la posizione reale.", "error");
        renderGpsQuality(true);
    }
}

function accumulateLocalStats(point) {
    if (lastLocalPoint) {
        const distKm = calculateDistance(lastLocalPoint[1], lastLocalPoint[0], point[1], point[0]) / 1000;
        trackingState.distanceKm += distKm;

        if (typeof point[2] === 'number' && typeof lastLocalPoint[2] === 'number') {
            const delta = point[2] - lastLocalPoint[2];
            if (delta > 3) trackingState.elevationGainM += delta;
        }
    }
    lastLocalPoint = point;
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
        hikes.map(h => `<option value="${h.id}">${h.title}</option>`).join('');

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

function togglePanel() {
    const panel = document.getElementById('tracking-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
        renderTrackingUi();
        showPanel();
    } else {
        hidePanel();
    }
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
    lastLocalPoint = null;
    if (window.clearLiveTrackPolyline) window.clearLiveTrackPolyline();
    hidePanel();
    renderTrackingUi();
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
            beginWatchingPosition();
            startUiTimer();
            startFlushTimer();
        }

        renderTrackingUi();
        window.showToast("Tracciamento GPS ripreso da dove eri rimasto.", "info");
    } catch (e) {
        console.error("Impossibile verificare un tracciamento GPS in corso:", e);
    }
}

// --- Inizializzazione modulo ---

function initTrackingModule() {
    const fab = document.getElementById('tracking-fab');
    const miniBar = document.getElementById('tracking-mini-bar');
    const panelClose = document.getElementById('tracking-panel-close');
    const btnStart = document.getElementById('btn-tracking-start');
    const btnPause = document.getElementById('btn-tracking-pause');
    const btnResume = document.getElementById('btn-tracking-resume');
    const btnEnd = document.getElementById('btn-tracking-end');
    const btnDownload = document.getElementById('btn-tracking-download-map');
    const btnSummaryClose = document.getElementById('btn-tracking-summary-close');

    if (fab) fab.addEventListener('click', togglePanel);
    if (miniBar) miniBar.addEventListener('click', () => { renderTrackingUi(); showPanel(); });
    if (panelClose) panelClose.addEventListener('click', hidePanel);
    if (btnStart) btnStart.addEventListener('click', startTracking);
    if (btnPause) btnPause.addEventListener('click', pauseTracking);
    if (btnResume) btnResume.addEventListener('click', resumeTracking);
    if (btnEnd) btnEnd.addEventListener('click', endTracking);
    if (btnDownload) btnDownload.addEventListener('click', handleDownloadOfflineMap);
    if (btnSummaryClose) btnSummaryClose.addEventListener('click', resetToIdleUi);

    window.addEventListener('online', () => {
        if (trackingState.sessionId && trackingState.status === 'active') flushPendingPoints();
    });

    checkForResumableSession();
}

window.initTrackingModule = initTrackingModule;
