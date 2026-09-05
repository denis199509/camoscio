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
        if (window.navigateTo) window.navigateTo('outing-page', null, { entita: sessionId });
        await renderOutingPage(sessionId);
    }

    async function renderOutingPage(sessionId) {
        uscitaIdAperta = sessionId;
        metaCorrente = null;
        const headerBox = document.getElementById('outing-page-header');
        const statsBox = document.getElementById('outing-page-stats');
        const captionBox = document.getElementById('outing-page-caption');
        const actionsBox = document.getElementById('outing-page-actions');
        if (!headerBox || !statsBox || !captionBox) return;

        headerBox.innerHTML = `<p class="text-muted">${esc(T('outing.caricamento') || 'Caricamento...')}</p>`;
        statsBox.innerHTML = '';
        captionBox.innerHTML = '';
        if (actionsBox) actionsBox.innerHTML = '';

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
        disegnaAzioni(meta);
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

        // Punto 115: il NOME dell'uscita, come titolo della pagina. Prima non c'era: aprendo
        // un'uscita si vedeva solo "autore · data", quindi due uscite dello stesso giorno
        // erano indistinguibili. Senza nome (importedName), si mostra la data dell'uscita
        // (diversa da `quando`, che e' la data di PUBBLICAZIONE).
        const titoloUscita = meta.importedName
            ? esc(meta.importedName)
            : formattaData(meta.startedAt);

        document.getElementById('outing-page-header').innerHTML = `
            <h3 class="outing-page-title">${titoloUscita}</h3>
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

    // Riga azioni sotto le statistiche: "mi piace" (emoji montagna, contatore + toggle) e
    // "Crea percorso" (copia la traccia fra "I miei progetti"). Ridisegnabile da sola (dal
    // cambio lingua e dopo un toggle) leggendo metaCorrente.
    function disegnaAzioni(meta) {
        const box = document.getElementById('outing-page-actions');
        if (!box) return;
        const n = meta.likeCount || 0;
        const attivo = !!meta.likedByMe;
        const titoloLike = attivo
            ? (T('outing.miPiaceTogli') || 'Togli il mi piace')
            : (T('outing.miPiaceMetti') || 'Metti un mi piace');
        box.innerHTML = `
            <button type="button" class="mi-piace-btn${attivo ? ' attivo' : ''}" id="btn-mi-piace" title="${esc(titoloLike)}" aria-pressed="${attivo}">
                <span class="mi-piace-emoji" aria-hidden="true">⛰️</span>
                <span class="mi-piace-conteggio">${n}</span>
            </button>
            <button type="button" class="btn btn-sm btn-secondary" id="btn-crea-percorso">
                <i data-lucide="route"></i> ${esc(T('outing.creaPercorso') || 'Crea percorso')}
            </button>`;
        const like = document.getElementById('btn-mi-piace');
        if (like) like.addEventListener('click', toggleMiPiace);
        const crea = document.getElementById('btn-crea-percorso');
        if (crea) crea.addEventListener('click', creaPercorso);
        if (window.lucide) window.lucide.createIcons();
    }

    // "Crea percorso": copia la traccia di QUESTA uscita fra "I miei progetti" (SavedRoute),
    // per riusarla come linea da seguire (decisioni 4-5 di Denis). Chiede solo un nome; la
    // geometria, l'etichetta "da <autore>" e i totali li mette il server. Il percorso resta
    // anche se l'uscita sorgente viene cancellata o spubblicata (nessun sessionId salvato).
    async function creaPercorso() {
        if (!uscitaIdAperta || !metaCorrente) return;
        const db = window.CamoscioState;
        const autore = (db.users || []).find(u => u.id === metaCorrente.userId);
        const nomeAutore = autore ? autore.username : (T('common.utente') || 'Utente');
        const quando = formattaData(metaCorrente.publishedAt || metaCorrente.startedAt);
        const nomeDefault = String(T('outing.creaPercorsoNomeDefault', nomeAutore, quando)
            || `${nomeAutore} · ${quando}`).slice(0, 80);
        const nome = window.showPromptModal
            ? await window.showPromptModal(T('outing.creaPercorsoChiediNome') || 'Che nome vuoi dare a questo percorso? Lo troverai in "Le mie escursioni" → I miei progetti.', nomeDefault)
            : nomeDefault;
        if (!nome) return;

        const btn = document.getElementById('btn-crea-percorso');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/routing/saved-routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: uscitaIdAperta, nome })
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (window.showToast) window.showToast(d.error || (T('outing.creaPercorsoErrore') || 'Non è stato possibile creare il percorso.'), 'error');
                if (btn) btn.disabled = false;
                return;
            }
            if (window.showToast) window.showToast(T('outing.creaPercorsoFatto') || 'Percorso creato: lo trovi in "Le mie escursioni" → I miei progetti.', 'success');
            if (btn) btn.disabled = false;
        } catch (e) {
            console.error('Errore creazione percorso:', e);
            if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
            if (btn) btn.disabled = false;
        }
    }

    // Stato vero dal server, mai ottimistico (stessa lezione di toggleFollow/toggleBookmark):
    // si aspetta la risposta e si ridisegna il bottone col conteggio che dice lei.
    async function toggleMiPiace() {
        if (!uscitaIdAperta || !metaCorrente) return;
        const btn = document.getElementById('btn-mi-piace');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(uscitaIdAperta)}/like`, {
                method: metaCorrente.likedByMe ? 'DELETE' : 'POST'
            });
            if (!res.ok) {
                if (window.showToast) window.showToast(T('outing.miPiaceErrore') || 'Non è stato possibile aggiornare il mi piace.', 'error');
                if (btn) btn.disabled = false;
                return;
            }
            const d = await res.json();
            metaCorrente.likeCount = d.likeCount;
            metaCorrente.likedByMe = d.likedByMe;
            disegnaAzioni(metaCorrente);
        } catch (e) {
            console.error('Errore mi piace:', e);
            if (btn) btn.disabled = false;
        }
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
            disegnaAzioni(metaCorrente);
        }
    });

    // Click su una notifica di "mi piace" (relatedSessionId, app.js renderNotificationBell):
    // chiude il campanello e apre l'uscita. Come goToHikeToComplete/goToReportModeration.
    window.goToOutingFromNotification = function (sessionId) {
        const dropdown = document.getElementById('notification-dropdown');
        if (dropdown) dropdown.classList.add('hidden');
        showOutingPage(sessionId);
    };
})();
