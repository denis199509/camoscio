// ==========================================================================
// PUNTO 113 — PAGINA DI UNA USCITA PUBBLICATA
//
// Si apre cliccando una card nel Feed, o una card uscita sul profilo di chi segui. Nessuna
// voce in barra: stesso principio di hikepage.js/squadpage.js, ma qui i dati NON sono in
// CamoscioState - si leggono da GET /api/tracking/sessions/:id/meta (metadati) e
// /points?scopo=mini (traccia per la mini-mappa). Entrambe protette: autore, oppure
// follower di un'uscita pubblicata (decisione 6 di Denis).
//
// Il file è dentro una IIFE (come storico.js/routeplanner.js): così i piccoli helper di
// formato non collidono con quelli omonimi di feed.js/userprofile.js, che vivono nello
// scope globale.
// ==========================================================================

(function () {
    const T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };
    const esc = (s) => window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s);

    let uscitaIdAperta = null;
    let metaCorrente = null;     // ultimo /meta: per ridisegnare la testata al cambio lingua senza rifetch
    let miniMap = null;          // UNA sola istanza Leaflet, riusata; NON su window (là vive mapInstance)
    let miniMapLayer = null;     // il layer della polyline/marker, da rimuovere e ridisegnare

    function formattaData(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const lang = window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en' ? 'en-GB' : 'it-IT';
        return d.toLocaleDateString(lang, { day: '2-digit', month: 'long', year: 'numeric' });
    }
    function formattaDurata(secondi) {
        if (!secondi || secondi < 60) return '—';
        const ore = Math.floor(secondi / 3600);
        const minuti = Math.round((secondi % 3600) / 60);
        return ore > 0 ? `${ore}h ${minuti}min` : `${minuti} min`;
    }
    function formattaDecimale(n) {
        const testo = (n || 0).toFixed(1);
        const lang = window.CamoscioI18n && window.CamoscioI18n.getLang();
        return lang === 'en' ? testo : testo.replace('.', ',');
    }

    async function showOutingPage(sessionId) {
        if (!sessionId) return;
        if (window.navigateTo) window.navigateTo('outing-page');
        await renderOutingPage(sessionId);
    }

    async function renderOutingPage(sessionId) {
        uscitaIdAperta = sessionId;
        metaCorrente = null;
        const headerBox = document.getElementById('outing-page-header');
        const statsBox = document.getElementById('outing-page-stats');
        const captionBox = document.getElementById('outing-page-caption');
        if (!headerBox || !statsBox || !captionBox) return;

        headerBox.innerHTML = `<p class="text-muted">${esc(T('outing.caricamento') || 'Caricamento...')}</p>`;
        statsBox.innerHTML = '';
        captionBox.innerHTML = '';

        let meta;
        try {
            const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(sessionId)}/meta`);
            if (res.status === 403 || res.status === 404) {
                headerBox.innerHTML = `<p class="text-muted">${esc(T('outing.nonVisibile') || 'Non puoi vedere questa uscita: forse non è più pubblica, o non segui più chi l\'ha pubblicata.')}</p>`;
                svuotaTraccia();
                return;
            }
            if (!res.ok) throw new Error('meta ' + res.status);
            meta = await res.json();
        } catch (e) {
            console.error('Errore caricamento uscita:', e);
            headerBox.innerHTML = `<p class="text-muted">${esc(T('outing.errore') || 'Non è stato possibile caricare questa uscita. Riprova più tardi.')}</p>`;
            svuotaTraccia();
            return;
        }
        if (uscitaIdAperta !== sessionId) return; // nel frattempo se n'è aperta un'altra

        metaCorrente = meta;
        disegnaTestata(meta);
        disegnaTraccia(sessionId);

        if (window.lucide) window.lucide.createIcons();
    }

    // Solo testata + statistiche + didascalia. Richiamabile da sola dal cambio lingua
    // (dai dati già in metaCorrente, nessun fetch) - come refreshHikePageHeaderAndMembers.
    function disegnaTestata(meta) {
        const db = window.CamoscioState;
        const autore = (db.users || []).find(u => u.id === meta.userId);
        const nome = autore ? esc(autore.username) : esc(T('common.utente') || 'Utente');
        const avatar = autore ? esc(autore.avatar) : '👤';
        const quando = formattaData(meta.publishedAt || meta.startedAt);

        // #section-title: updateSectionTitle (app.js) lo rimette a "Uscita" ad ogni cambio
        // lingua/navigazione; qui lo riportiamo al nome dell'autore, come showHikePage/
        // renderUserProfile (l'onChange in fondo lo rifà).
        const sectionTitle = document.getElementById('section-title');
        if (sectionTitle) sectionTitle.textContent = nome;

        document.getElementById('outing-page-header').innerHTML = `
            <div class="outing-page-author" onclick="showUserProfile('${esc(meta.userId)}')">
                <span class="feed-item-avatar">${avatar}</span>
                <span><b>${nome}</b><span class="feed-item-when"> · ${quando}</span></span>
            </div>`;

        const durataHtml = meta.durationUnknown
            ? `<div title="${esc(T('outing.durataIgnotaTitle') || 'Il file .gpx non conteneva gli orari dei punti.')}"><strong>—</strong><span>${esc(T('outing.durataIgnota') || 'durata ignota')}</span></div>`
            : `<div><strong>${formattaDurata(meta.durationSeconds)}</strong><span>${esc(T('outing.durata') || 'durata')}</span></div>`;
        document.getElementById('outing-page-stats').innerHTML = `
            <div class="outing-card-stats">
                <div><strong>${formattaDecimale(meta.distanceKm)}</strong><span>km</span></div>
                <div><strong>${Math.round(meta.elevationGainM || 0)}</strong><span>${esc(T('outing.mDisliv') || 'm disliv.')}</span></div>
                ${durataHtml}
            </div>`;

        // caption: testo scritto dall'autore. NON tradotto (punto 102), sempre via escapeHtml.
        document.getElementById('outing-page-caption').innerHTML =
            meta.caption ? `<p class="outing-page-caption">${esc(meta.caption)}</p>` : '';
    }

    function disegnaTraccia(sessionId) {
        const box = document.getElementById('outing-page-map');
        if (!box || typeof L === 'undefined') return;

        fetch(`/api/tracking/sessions/${encodeURIComponent(sessionId)}/points?scopo=mini`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (uscitaIdAperta !== sessionId) return; // aperta un'altra uscita nel frattempo
                const punti = (data && data.punti) || [];
                const latlng = punti
                    .map(p => [p[1], p[0]])
                    .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));

                if (!miniMap) {
                    miniMap = L.map('outing-page-map', { minZoom: 6 });
                    L.tileLayer(window.CAMOSCIO_TILE_URL, window.CAMOSCIO_TILE_OPTIONS).addTo(miniMap);
                }
                if (miniMapLayer) { miniMap.removeLayer(miniMapLayer); miniMapLayer = null; }

                if (latlng.length >= 2) {
                    // #7FB5C7: il colore della traccia REGISTRATA in tutto il progetto (map.js) -
                    // ed è esattamente cosa stiamo guardando.
                    miniMapLayer = L.polyline(latlng, { color: '#7FB5C7', weight: 4, opacity: 0.9 }).addTo(miniMap);
                    miniMap.fitBounds(miniMapLayer.getBounds(), { padding: [24, 24] });
                } else if (latlng.length === 1) {
                    miniMapLayer = L.marker(latlng[0]).addTo(miniMap);
                    miniMap.setView(latlng[0], 14);
                } else {
                    const b = window.CAMOSCIO_REGION_BOUNDS;
                    if (b) miniMap.fitBounds([[b.minLat, b.minLng], [b.maxLat, b.maxLng]]);
                }
                // la sezione è appena diventata visibile: Leaflet deve rimisurare il contenitore
                setTimeout(() => { if (miniMap) miniMap.invalidateSize(); }, 60);
            })
            .catch(e => console.error('Errore traccia mini-mappa:', e));
    }

    function svuotaTraccia() {
        if (miniMap && miniMapLayer) { miniMap.removeLayer(miniMapLayer); miniMapLayer = null; }
    }

    window.showOutingPage = showOutingPage;

    // Cambio lingua: ridisegna solo testata/statistiche/didascalia (da metaCorrente, nessun
    // fetch). La mini-mappa NON si tocca - Leaflet è costoso e la traccia non cambia con la
    // lingua. Stesso criterio di hikepage.js.
    if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
        const sec = document.getElementById('outing-page');
        if (sec && sec.classList.contains('active') && uscitaIdAperta && metaCorrente) {
            disegnaTestata(metaCorrente);
        }
    });
})();
