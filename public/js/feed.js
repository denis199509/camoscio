// ==========================================================================
// PUNTO 113 — PAGINA FEED
//
// Le uscite pubblicate dalle persone che segui, più recenti prima. Voce di barra subito
// dopo Dashboard. Paginazione a cursore su publishedAt (GET /api/feed?before=<ISO>): la
// pagina successiva si chiede con "Carica altre", non con lo scroll infinito.
//
// I punti GPS della traccia NON arrivano qui (è una lista): si chiedono per una sola
// uscita alla volta aprendo la sua pagina (passo 6, window.showOutingPage). Fino ad allora
// il click su una card è un no-op silenzioso.
// ==========================================================================

// "var" e non "const": <script> classico che condivide lo scope globale con app.js/
// userprofile.js ecc. (vedi la nota in cima a i18n.js sul perché "const T" collide).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

var feedItems = [];        // accumulati fra una pagina e l'altra
var feedNextBefore = null; // cursore per la pagina successiva (ISO), null = fine
var feedCaricando = false;
var feedFinito = false;
var feedErrore = false;

// Chiamata da triggerSectionRender (app.js) ad ogni ingresso in pagina: riparte SEMPRE da
// capo (reset), come le altre sezioni.
async function renderFeed() {
    feedItems = [];
    feedNextBefore = null;
    feedFinito = false;
    feedErrore = false;

    const box = document.getElementById('feed-list');
    if (!box) return;
    box.innerHTML = `<p class="text-muted small">${window.escapeHtml(T('feed.caricamento') || 'Caricamento...')}</p>`;

    await caricaPaginaFeed();
    disegnaFeed();
}

async function caricaPaginaFeed() {
    if (feedCaricando || feedFinito) return;
    feedCaricando = true;
    try {
        const url = '/api/feed' + (feedNextBefore ? ('?before=' + encodeURIComponent(feedNextBefore)) : '');
        const res = await fetch(url);
        if (!res.ok) throw new Error('feed ' + res.status);
        const data = await res.json();
        feedItems = feedItems.concat(data.items || []);
        feedNextBefore = data.nextBefore || null;
        if (!feedNextBefore) feedFinito = true;
    } catch (e) {
        console.error('Errore caricamento feed:', e);
        feedErrore = true;
        feedFinito = true; // non ritentare in loop
    } finally {
        feedCaricando = false;
    }
}

function disegnaFeed() {
    const box = document.getElementById('feed-list');
    if (!box) return;
    const db = window.CamoscioState;

    if (feedItems.length === 0) {
        let msg;
        if (feedErrore) {
            msg = T('feed.errore') || 'Non è stato possibile caricare il feed. Riprova più tardi.';
        } else if (db && db.following && db.following.length) {
            msg = T('feed.vuoto') || 'Ancora nessuna uscita pubblicata dalle persone che segui.';
        } else {
            msg = T('feed.nessunSeguito') || 'Non segui ancora nessuno. Trova le persone in "Cerca Persone" o nel loro profilo e seguile: le loro uscite pubblicate compariranno qui.';
        }
        box.innerHTML = `<div class="glass-card text-center py-4 text-muted">${window.escapeHtml(msg)}</div>`;
        return;
    }

    box.innerHTML = feedItems.map(schedaFeed).join('')
        + (feedFinito ? '' : `<button type="button" class="btn btn-secondary btn-block" id="feed-load-more">${window.escapeHtml(T('feed.caricaAltre') || 'Carica altre')}</button>`);

    const more = document.getElementById('feed-load-more');
    if (more) {
        more.addEventListener('click', async () => {
            more.disabled = true;
            await caricaPaginaFeed();
            disegnaFeed();
        });
    }

    box.querySelectorAll('[data-outing-like]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // non aprire l'uscita: il bottone è fuori da .feed-item-body, ma per sicurezza
            toggleMiPiaceFeed(btn.getAttribute('data-outing-like'), btn);
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function schedaFeed(item) {
    const esc = window.escapeHtml;
    const db = window.CamoscioState;
    const autore = (db.users || []).find(u => u.id === item.userId);
    const nome = autore ? esc(autore.username) : esc(T('common.utente') || 'Utente');
    const avatar = autore ? esc(autore.avatar) : '👤';
    const quando = formattaData(item.publishedAt || item.startedAt);

    // caption: testo scritto dall'autore. NON tradotto (punto 102), sempre via escapeHtml.
    const captionHtml = item.caption ? `<p class="feed-item-caption">${esc(item.caption)}</p>` : '';

    // Corpo: la stessa card compatta di "Le mie escursioni" e del profilo (km / dislivello /
    // durata + badge registrata/importata).
    const cardStats = window.CamoscioSchedeCompatte.uscita(item, {});

    // Passo 7: "mi piace" (emoji montagna). data-outing-like porta l'id: il listener si
    // aggancia in disegnaFeed (ridisegna solo il bottone toccato, non tutto il feed).
    const attivo = !!item.likedByMe;
    const titolo = attivo
        ? (T('feed.miPiaceTogli') || 'Togli il mi piace')
        : (T('feed.miPiaceMetti') || 'Metti un mi piace');
    const miPiaceHtml = `<div class="feed-item-actions">
        <button type="button" class="mi-piace-btn${attivo ? ' attivo' : ''}" data-outing-like="${esc(item.id)}" title="${esc(titolo)}" aria-pressed="${attivo}">
            <span class="mi-piace-emoji" aria-hidden="true">⛰️</span>
            <span class="mi-piace-conteggio">${item.likeCount || 0}</span>
        </button>
    </div>`;

    return `<article class="feed-item">
        <div class="feed-item-author" onclick="event.stopPropagation(); showUserProfile('${esc(item.userId)}')">
            <span class="feed-item-avatar">${avatar}</span>
            <span class="feed-item-author-name"><b>${nome}</b><span class="feed-item-when"> · ${quando}</span></span>
        </div>
        ${captionHtml}
        <div class="feed-item-body" onclick="apriUscita('${esc(item.id)}')">${cardStats}</div>
        ${miPiaceHtml}
    </article>`;
}

// Toggle "mi piace" da una card del feed. Come toggleMiPiace in outingpage.js: stato vero
// dal server, mai ottimistico. Aggiorna solo il bottone toccato e l'item in memoria - un
// ridisegno dell'intero feed perderebbe la posizione di scroll.
async function toggleMiPiaceFeed(sessionId, btn) {
    const item = feedItems.find(i => i.id === sessionId);
    if (!item || !btn) return;
    btn.disabled = true;
    try {
        const res = await fetch('/api/tracking/sessions/' + encodeURIComponent(sessionId) + '/like', {
            method: item.likedByMe ? 'DELETE' : 'POST'
        });
        if (!res.ok) {
            if (window.showToast) window.showToast(T('feed.miPiaceErrore') || 'Non è stato possibile aggiornare il mi piace.', 'error');
            btn.disabled = false;
            return;
        }
        const d = await res.json();
        item.likeCount = d.likeCount;
        item.likedByMe = d.likedByMe;
        btn.classList.toggle('attivo', !!d.likedByMe);
        btn.setAttribute('aria-pressed', String(!!d.likedByMe));
        btn.title = d.likedByMe
            ? (T('feed.miPiaceTogli') || 'Togli il mi piace')
            : (T('feed.miPiaceMetti') || 'Metti un mi piace');
        const c = btn.querySelector('.mi-piace-conteggio');
        if (c) c.textContent = d.likeCount;
        btn.disabled = false;
    } catch (e) {
        console.error('Errore mi piace feed:', e);
        btn.disabled = false;
    }
}

// Nome del mese per esteso: cambia con la lingua (en-GB / it-IT), stessa scelta di
// formattaDataItaliana in userprofile.js.
function formattaData(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const lang = window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en' ? 'en-GB' : 'it-IT';
    return d.toLocaleDateString(lang, { day: '2-digit', month: 'long', year: 'numeric' });
}

// Apre la pagina della singola uscita (passo 6). Fino ad allora: no-op silenzioso.
function apriUscita(sessionId) {
    if (typeof window.showOutingPage === 'function') window.showOutingPage(sessionId);
}

window.renderFeed = renderFeed;
window.apriUscita = apriUscita;

// Cambio lingua: ridisegna dagli item già in memoria (nessun fetch). Solo se il Feed è la
// sezione aperta - stesso criterio di social.js/storico.js.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    const feed = document.getElementById('feed');
    if (feed && feed.classList.contains('active')) disegnaFeed();
});
