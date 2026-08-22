// Pagina profilo di un ALTRO utente — non richiesta in cose_da_fare.txt, chiesta da
// Denis in sessione (01/08/2026). Si apre cliccando un nome/avatar altrove nel sito
// (per ora: nome dell'organizzatore e avatar dei partecipanti sulla scheda escursione,
// vedi public/js/social.js). Mostra SOLO badge personale, badge guadagnati e un avviso
// che la pagina e' in aggiornamento - il resto lo decidera' Denis in seguito.
//
// I timbri di un altro utente sono "achievement pubblici tra utenti loggati" (vedi
// routes/stamps.js): niente da nascondere. /api/users/:id applica gia' da solo il
// filtro privacy (serializeUserForViewer in routes/users.js) per gli altri campi -
// se profilePhoto sparisce per via della privacy dell'altro, si torna alla sua emoji,
// non e' un difetto di questo file.
// Rollout traduzione punto 102 (22/08/2026). "var", non "const": vedi la nota in
// cima a i18n.js sul perche' (piu' file <script> classici che condividono lo
// stesso scope globale, "const T" ripetuto in due file darebbe SyntaxError).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Ultimo profilo aperto, SOLO per rimettere a posto #section-title a un cambio
// lingua (vedi CamoscioI18n.onChange in fondo al file) - non per un re-render
// completo, vedi la nota li' sotto sul perche'.
var profiloUserIdAperto = null;

async function showUserProfile(userId) {
    if (!userId) return;
    if (window.navigateTo) window.navigateTo("user-profile");
    await renderUserProfile(userId);
}

// Intestazione (avatar/nome/livello), badge personale e griglia dei badge guadagnati:
// stessa identica presentazione sia per il profilo di un altro utente sia per il
// proprio (public/js/profile.js, punto 59) - cambiano solo i dati (utente/timbri) e
// dove scrivere (els). Non duplicarla e' la stessa lezione gia' applicata a
// statoBadge()/statoBadgePer() in badges.js.
function renderProfileIdentity(utente, timbri, els, ascese) {
    const esc = window.escapeHtml;

    if (els.header) {
        const avatarHtml = utente.profilePhoto
            ? `<img src="${esc(utente.profilePhoto)}" alt="${esc(T('profile.fotoProfilo') || 'Foto profilo')}" class="avatar-photo">`
            : esc(utente.avatar);
        const livelloTesto = T('profile.livelloReputazione', esc(utente.experienceLevel), utente.reputation)
            || `Livello: ${esc(utente.experienceLevel)} · Reputazione: ${utente.reputation}%`;
        els.header.innerHTML = `
            <span class="user-profile-avatar">${avatarHtml}</span>
            <div class="user-details">
                <h3 class="font-bold">${esc(utente.username)}</h3>
                <p class="small text-muted">${livelloTesto}</p>
            </div>
        `;
    }

    if (els.badgeBox) {
        const personale = window.CamoscioPersonalBadges ? window.CamoscioPersonalBadges.get(utente.id) : null;
        els.badgeBox.innerHTML = personale ? `
            <div class="glass-card personal-badge-showcase">
                <img src="img/badge-personali/${esc(personale.icon)}" alt="${esc(personale.titolo)}" class="personal-badge-illustration">
                <div>
                    <h4>${esc(personale.titolo)}</h4>
                    <p>${esc(personale.descrizione)}</p>
                    <p class="small text-muted">${esc(T('badges.personale.nota') || 'Distintivo assegnato a mano dal team di Camoscio: non si guadagna, è un riconoscimento personale.')}</p>
                </div>
            </div>
        ` : "";
    }

    if (els.badgesGrid && window.CamoscioBadges) {
        els.badgesGrid.innerHTML = "";
        const stato = window.CamoscioBadges.statoBadgePer(timbri || [], ascese || {});
        const presi = stato.filter(b => b.sbloccato)
            .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
        if (presi.length === 0) {
            els.badgesGrid.innerHTML = `<div class="glass-card text-center py-4 text-muted">${esc(T('profile.nessunBadge') || 'Nessun badge conquistato per ora.')}</div>`;
        } else {
            presi.forEach(b => els.badgesGrid.appendChild(window.CamoscioBadges.schedaBadge(b)));
        }

        // Punto 63b, 17/08/2026: le cime dove e' stato raggiunto un livello (5+ salite)
        // diventano anche una riga "Esperto locale" - guadagnata, non dichiarata a mano.
        // Sempre mostrata (non dipende dal checkbox "Sono un esperto locale", che riguarda
        // solo la zona scritta a mano: qui non c'e' niente da attivare, e' gia' successo).
        // Presente sia sul proprio profilo sia su quello di un altro, perche' e' proprio
        // questa funzione condivisa a disegnarla in entrambi i casi.
        if (els.expertPeaks) {
            const montagne = window.CamoscioBadges.montagneEsperienza(stato);
            els.expertPeaks.innerHTML = montagne.map(m => `
                <p class="local-expert-line earned"><i data-lucide="mountain"></i> ${esc(m.nome)} — <b>${esc(m.livello.titolo)}</b></p>
            `).join('');
        }
    }

    if (window.lucide) window.lucide.createIcons();
}
window.CamoscioProfileIdentity = { render: renderProfileIdentity };

// Punto 74: le escursioni di questa persona, sia sul proprio profilo sia su quello di un
// altro - stesso principio di renderProfileIdentity sopra, una funzione sola con "chi" e
// "dove scrivere" a parametro. Due fonti diverse, unite in un solo elenco per data:
//  - ActiveHikeSession (punto 15/tracciamento): gpx importati e uscite registrate dal vivo,
//    GET /api/tracking/sessions/:userId (punto 74, gemella della propria in tracking.js);
//  - Completion (escursioni create sul sito e completate, singole o in gruppo - punto 64),
//    incrociate con window.CamoscioState.hikes (gia' in cache, GET /api/hikes non e' filtrata
//    per utente) per avere titolo/data/stato.
// Le card di schedaEscursioneCompletata/schedaUscitaProfilo qui sotto sono le stesse
// riusate, con i bottoni azione (carica gpx/cestino), dalla propria pagina "Le mie
// escursioni" (punto 80/B, public/js/storico.js) - qui invece SENZA azioniHtml: restano
// sola lettura, perche' questa funzione disegna anche il profilo di un ALTRO utente e
// cancellare una propria escursione/uscita ha senso solo dalla propria pagina.
// Nome del mese per esteso ("15 giugno 2026"): a differenza di dataItaliana in
// badges.js (solo numeri, GG/MM/AAAA - identica in italiano e inglese, vedi la
// nota in cima a i18n.js) qui il nome del mese e' scritto per intero, quindi VA
// scelto il locale giusto - altrimenti una card in inglese mostrerebbe comunque
// "giugno" invece di "June". 'en-GB' e non 'en-US': stesso ordine giorno/mese
// gia' scelto per la bandiera 🇬🇧, coerente col resto del sito.
function formattaDataItaliana(iso) {
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

// Virgola italiana o punto inglese per i decimali (km/dislivello sulle card):
// la lingua CAMBIA il separatore, a differenza delle date sopra che restano
// identiche. Usata dalle tre card compatte qui sotto invece di ripetere
// ".toFixed(1).replace('.', ',')" tre volte con lo stesso bug potenziale.
function formattaDecimale(n) {
    const testo = (n || 0).toFixed(1);
    const lang = window.CamoscioI18n && window.CamoscioI18n.getLang();
    return lang === 'en' ? testo : testo.replace('.', ',');
}

// Punto 80/B: azioniHtml è iniettato dal chiamante, mai deciso qui dentro con un
// controllo tipo "isOwnProfile" - questa stessa funzione la chiama anche il profilo di
// UN ALTRO utente (renderProfileHikes qui sotto, sempre sola lettura), e un controllo
// interno sbagliato metterebbe il cestino sul profilo di qualcun altro. Chi chiama con
// azioniHtml (public/js/storico.js, la propria pagina "Le mie escursioni") decide cosa
// mostrare; chi non lo passa resta sola lettura come sempre.
function schedaEscursioneCompletata(hike, completion, { azioniHtml = '' } = {}) {
    const esc = window.escapeHtml;

    // Punto 79: se questa persona ha un tempo di cammino reale misurato da un .gpx per
    // questa escursione (Completion.movingTimeHours, solo quando la traccia era abbastanza
    // fitta da fidarsene), confrontato con lo standard CAI calcolato sugli stessi dati VERI
    // dell'escursione - stessa logica di buildHikeCard in social.js, qui perche' questa
    // scheda resta consultabile nel tempo anche dopo che l'escursione e' sparita dalle liste.
    let tempoRealeHtml = '';
    if (completion && completion.movingTimeHours) {
        const tVertStandard = (hike.elevationGain || 0) / 400;
        const tFlatStandard = (hike.distanceKm || 0) / 4;
        const caiOre = Math.max(tVertStandard, tFlatStandard) + Math.min(tVertStandard, tFlatStandard) / 2;
        const pauseOre = completion.actualTimeHours
            ? Math.max(0, completion.actualTimeHours - completion.movingTimeHours)
            : 0;
        const pausaText = pauseOre > (1 / 60)
            ? (T('profile.diPause', window.formatHoursToMin(pauseOre)) || ` (+ ${window.formatHoursToMin(pauseOre)} di pause)`)
            : '';
        const camminoLabel = esc(T('profile.cammino') || 'Cammino');
        tempoRealeHtml = `<p class="small text-muted rp-nota-dislivello"><i data-lucide="footprints"></i><span>${camminoLabel}: <b>${window.formatHoursToMin(completion.movingTimeHours)}</b>${pausaText} · CAI: <b>${window.formatHoursToMin(caiOre)}</b></span></p>`;
    }

    // Titolo su una riga TUTTA sua, fuori da .outing-card-head: quella e' una riga flex
    // pensata per un tag corto accanto a un nome file/data breve (storico.js). Un titolo
    // vero in piu' parole ("Alba Corno Grande") condivisa con due badge si vede spezzare
    // a meta' parola (overflow-wrap:anywhere su poco spazio) - qui il titolo ha sempre
    // tutta la larghezza della card, i badge stanno sotto in una riga propria.
    return `
        <div class="outing-card">
            <span class="outing-card-title">${esc(hike.title)}</span>
            <div class="outing-card-head" style="margin-top: 4px;">
                <span class="badge badge-primary outing-tag">${esc(hike.difficulty)}</span>
                ${hike.groupCompletedAt
                    ? `<span class="badge badge-green outing-tag" title="${esc(T('profile.completataGruppoTitle') || 'Completata insieme al gruppo')}"><i data-lucide="users"></i> ${esc(T('profile.inGruppo') || 'in gruppo')}</span>`
                    : ''}
            </div>
            <span class="outing-card-sub">${formattaDataItaliana(hike.date)}</span>
            <div class="outing-card-stats">
                <div><strong>${formattaDecimale(hike.distanceKm)}</strong><span>km</span></div>
                <div><strong>${Math.round(hike.elevationGain || 0)}</strong><span>${esc(T('profile.mDisliv') || 'm disliv.')}</span></div>
                <div><strong>${Math.round(hike.maxAltitude || 0)}</strong><span>${esc(T('profile.quotaMax') || 'quota max')}</span></div>
            </div>
            ${tempoRealeHtml}
            ${azioniHtml ? `<div class="outing-card-actions">${azioniHtml}</div>` : ''}
        </div>`;
}

// Stesso principio di azioniHtml spiegato sopra su schedaEscursioneCompletata.
// data-outing-id resta SEMPRE presente (anche in sola lettura): cancellaUscita
// (public/js/storico.js) lo usa per ritrovare titolo/tipo della scheda cliccata.
function schedaUscitaProfilo(s, { azioniHtml = '' } = {}) {
    const esc = window.escapeHtml;
    const importata = s.importedFrom === 'gpx';
    const titolo = importata && s.importedName ? esc(s.importedName) : formattaDataItaliana(s.startedAt);
    const sottotitolo = (importata && s.importedName) ? formattaDataItaliana(s.startedAt) : '';
    return `
        <div class="outing-card" data-outing-id="${esc(s.id)}">
            <div class="outing-card-head">
                <span class="outing-card-title">${titolo}</span>
                ${importata
                    ? `<span class="badge badge-accent outing-tag" title="${esc(T('profile.tracciaImportataTitle') || 'Traccia caricata da un file .gpx, non registrata dal sito')}"><i data-lucide="upload"></i> ${esc(T('profile.importata') || 'importata')}</span>`
                    : `<span class="badge badge-green outing-tag" title="${esc(T('profile.tracciaRegistrataTitle') || "Registrata col GPS durante l'escursione")}"><i data-lucide="satellite-dish"></i> ${esc(T('profile.registrata') || 'registrata')}</span>`}
            </div>
            ${sottotitolo ? `<span class="outing-card-sub">${sottotitolo}</span>` : ''}
            <div class="outing-card-stats">
                <div><strong>${formattaDecimale(s.distanceKm)}</strong><span>km</span></div>
                <div><strong>${Math.round(s.elevationGainM || 0)}</strong><span>${esc(T('profile.mDisliv') || 'm disliv.')}</span></div>
                ${s.durationUnknown
                    ? `<div title="${esc(T('profile.durataIgnotaTitle') || 'Il file .gpx non conteneva gli orari dei punti: durata non disponibile.')}"><strong>—</strong><span>${esc(T('profile.durataIgnota') || 'durata ignota')}</span></div>`
                    : `<div><strong>${formattaDurata(s.durationSeconds)}</strong><span>${esc(T('profile.durata') || 'durata')}</span></div>`}
            </div>
            ${azioniHtml ? `<div class="outing-card-actions">${azioniHtml}</div>` : ''}
        </div>`;
}
// Punto 80/B: superficie pubblica esplicita per queste due card compatte - riusate da
// public/js/storico.js (Le mie escursioni, con azioniHtml) oltre che da qui sotto
// (profilo, sempre sola lettura). Un'unica formula per card, mai una copia per file.
window.CamoscioSchedeCompatte = { escursione: schedaEscursioneCompletata, uscita: schedaUscitaProfilo };

// Bugfix 21/08/2026, segnalato da Denis: "Le mie escursioni" (storico.js) applica gia' due
// pulizie alle sessioni di tracciamento prima di mostrarle - qui in renderProfileHikes
// mancavano ENTRAMBE, e il profilo (proprio e di chiunque altro) mostrava quello che
// storico.js nasconde apposta:
//  1) sessioni senza nemmeno un punto GPS vero (avvii annullati o prove finite subito -
//     se ne sono accumulate a dozzine testando dal vivo il tracciamento del punto 94), che
//     restavano visibili PER SEMPRE: "Le mie escursioni" non le mostra mai, quindi nessun
//     cestino le raggiunge da li';
//  2) una sessione GPS reale ma gia' rappresentata da un'escursione "completata" collegata
//     allo stesso hikeId, mostrata una seconda volta come uscita separata invece di essere
//     riconosciuta come la stessa camminata.
// Soglia e regola condivise qui una volta sola - storico.js le riusa da qui, mai due copie
// della stessa logica che possono divergere in silenzio (stessa lezione del punto 98/B).
function usciteVisibili(sessioni, hikeIdGiaRappresentati) {
    return sessioni
        .filter(s => (s.distanceKm || 0) > 0.05)
        .filter(s => {
            if (s.hikeId && hikeIdGiaRappresentati.has(s.hikeId)) {
                hikeIdGiaRappresentati.delete(s.hikeId); // al massimo una per hikeId
                return false;
            }
            return true;
        });
}
window.CamoscioUsciteVisibili = usciteVisibili;

async function renderProfileHikes(userId, container) {
    if (!container) return;
    container.innerHTML = `<p class="text-muted small">${window.escapeHtml(T('profile.caricamento') || 'Caricamento...')}</p>`;

    let completions = [];
    let sessioni = [];
    try {
        [completions, sessioni] = await Promise.all([
            fetch(`/api/completions/${userId}`).then(r => r.ok ? r.json() : []),
            fetch(`/api/tracking/sessions/${userId}`).then(r => r.ok ? r.json() : [])
        ]);
    } catch (e) {
        console.error("Errore nel caricamento delle escursioni del profilo:", e);
        container.innerHTML = `<p class="text-muted small">${window.escapeHtml(T('profile.erroreCaricamentoEscursioni') || 'Non è stato possibile caricare le escursioni.')}</p>`;
        return;
    }

    const db = window.CamoscioState;
    const vociHike = completions
        .map(c => {
            const h = (db.hikes || []).find(h => h.id === c.hikeId);
            return h ? { tipo: 'hike', data: h.date, html: schedaEscursioneCompletata(h, c), hikeIdCollegato: h.id } : null;
        })
        .filter(Boolean);

    const hikeIdGiaRappresentati = new Set(vociHike.map(v => v.hikeIdCollegato));
    const vociUscita = usciteVisibili(sessioni, hikeIdGiaRappresentati)
        .map(s => ({ tipo: 'uscita', data: s.startedAt, html: schedaUscitaProfilo(s) }));

    const tutte = [...vociHike, ...vociUscita].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

    container.innerHTML = tutte.length
        ? `<div class="outings-grid">${tutte.map(v => v.html).join('')}</div>`
        : `<div class="glass-card text-center py-4 text-muted">${window.escapeHtml(T('profile.nessunaEscursione') || 'Nessuna escursione da mostrare per ora.')}</div>`;

    if (window.lucide) window.lucide.createIcons();
}
window.CamoscioProfileHikes = { render: renderProfileHikes };

// Punto 80/G: sentieri salvati nei preferiti (tasto capra sulla scheda escursione,
// public/js/social.js) - stesso principio di renderProfileHikes qui sopra, una funzione
// sola per il proprio profilo e quello di un altro. A differenza di quella pero' non serve
// nessun fetch: bookmarks e hikes sono gia' entrambi in window.CamoscioState da
// refreshState() (GET /api/bookmarks non e' filtrata per utente apposta, serve anche al
// "compagno di sentiero" in social.js). Il tasto per togliere un preferito compare SOLO
// quando si guarda il proprio profilo: la rotta DELETE toglie sempre e solo il preferito di
// chi ha fatto login, quindi mostrarlo anche sul profilo di un altro toglierebbe IL PROPRIO
// preferito mentre si guarda la pagina di qualcun altro, senza che sia ovvio perche'.
function schedaSentieroPreferito(hike, isOwnProfile, containerId) {
    const esc = window.escapeHtml;
    const togliLabel = esc(T('profile.togliPreferiti') || 'Togli dai preferiti');
    const rimuoviBtn = isOwnProfile ? `
        <button class="outing-card-del" onclick="removeProfileBookmark('${esc(hike.id)}', '${esc(containerId)}')"
                title="${togliLabel}" aria-label="${togliLabel}">🐐</button>
    ` : '';
    return `
        <div class="outing-card">
            <div class="outing-card-head">
                <span class="outing-card-title">${esc(hike.title)}</span>
                ${rimuoviBtn}
            </div>
            <span class="outing-card-sub">${formattaDataItaliana(hike.date)}</span>
            <div class="outing-card-stats">
                <div><strong>${formattaDecimale(hike.distanceKm)}</strong><span>km</span></div>
                <div><strong>${Math.round(hike.elevationGain || 0)}</strong><span>${esc(T('profile.mDisliv') || 'm disliv.')}</span></div>
                <div><strong>${Math.round(hike.maxAltitude || 0)}</strong><span>${esc(T('profile.quotaMax') || 'quota max')}</span></div>
            </div>
        </div>`;
}

function renderProfileBookmarks(userId, container) {
    if (!container) return;
    const db = window.CamoscioState;
    const isOwnProfile = !!(db.currentUser && db.currentUser.id === userId);

    const hikes = (db.bookmarks || [])
        .filter(b => b.userId === userId)
        .map(b => (db.hikes || []).find(h => h.id === b.hikeId))
        .filter(Boolean)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    container.innerHTML = hikes.length
        ? `<div class="outings-grid">${hikes.map(h => schedaSentieroPreferito(h, isOwnProfile, container.id)).join('')}</div>`
        : `<div class="glass-card text-center py-4 text-muted">${window.escapeHtml(T('profile.nessunSentieroPreferito') || 'Nessun sentiero nei preferiti per ora.')}</div>`;

    if (window.lucide) window.lucide.createIcons();
}
window.CamoscioProfileBookmarks = { render: renderProfileBookmarks };

window.removeProfileBookmark = async function(hikeId, containerId) {
    await window.toggleBookmark(hikeId);
    const container = document.getElementById(containerId);
    const userId = window.CamoscioState.currentUser.id;
    if (container) renderProfileBookmarks(userId, container);
};

async function renderUserProfile(userId) {
    profiloUserIdAperto = userId;
    const header = document.getElementById("user-profile-header");
    const badgeBox = document.getElementById("user-profile-personal-badge");
    const badgesGrid = document.getElementById("user-profile-badges");
    if (!header || !badgesGrid) return;

    header.innerHTML = `<p class="text-muted">${window.escapeHtml(T('profile.caricamento') || 'Caricamento...')}</p>`;
    badgeBox.innerHTML = "";
    badgesGrid.innerHTML = "";

    let utente = null;
    let timbri = [];
    let ascese = {};
    try {
        let asceseArray;
        [utente, timbri, asceseArray] = await Promise.all([
            fetch(`/api/users/${userId}`).then(r => r.ok ? r.json() : null),
            fetch(`/api/stamps/${userId}`).then(r => r.ok ? r.json() : []),
            // Punto 42b: quante volte, non solo "se" - stessa rotta usata per il proprio
            // profilo (app.js), qui per un altro utente. Stessa trasformazione in oggetto.
            fetch(`/api/tracking/peak-ascents/${userId}`).then(r => r.ok ? r.json() : [])
        ]);
        asceseArray.forEach(a => { ascese[a.stampId] = a; });
    } catch (e) {
        console.error("Errore nel caricamento del profilo:", e);
        header.innerHTML = `<p class="text-muted">${window.escapeHtml(T('profile.erroreCaricamento') || 'Non è stato possibile caricare questo profilo. Riprova più tardi.')}</p>`;
        return;
    }

    if (!utente) {
        header.innerHTML = `<p class="text-muted">${window.escapeHtml(T('profile.nonTrovato') || 'Profilo non trovato.')}</p>`;
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = utente.username;

    const esc = window.escapeHtml;

    // Punto 63(a): campo gia' esistente (localExpert), oggi visibile solo come tooltip
    // sull'avatar in una scheda escursione (social.js). Stesso testo usato li',
    // "Esperto locale: <zona>" - il nome non cambia finche' Denis non decide (punto 63b).
    // Solo per il profilo di un ALTRO: sul proprio la stessa informazione si vede e si
    // cambia direttamente nel modulo "esperto locale" qui sotto, una riga in piu' sarebbe
    // ridondante.
    const localExpertBox = document.getElementById("user-profile-local-expert");
    if (localExpertBox) {
        localExpertBox.innerHTML = (utente.localExpert && utente.localExpert.active)
            ? `<p class="local-expert-line"><i data-lucide="star"></i> ${esc(T('profile.espertoLocale') || 'Esperto locale')}: <b>${esc(utente.localExpert.area)}</b></p>`
            : "";
    }

    renderProfileIdentity(utente, timbri, { header, badgeBox, badgesGrid, expertPeaks: document.getElementById("user-profile-expert-peaks") }, ascese);
    renderProfileHikes(userId, document.getElementById("user-profile-hikes"));
    renderProfileBookmarks(userId, document.getElementById("user-profile-bookmarks"));
}

window.showUserProfile = showUserProfile;

// NESSUN re-render completo qui al cambio lingua, di proposito (a differenza di
// badges.js): renderUserProfile fa tre fetch veri (users/stamps/peak-ascents)
// ogni volta che viene chiamata. Ridisegnare tutto a ogni cambio lingua avrebbe
// voluto dire tre richieste di rete in piu' e uno "Caricamento..." che cancella
// per un istante un profilo gia' a schermo, solo per ridipingere del testo -
// peggio di lasciare la pagina cosi' com'e'. Residuo onesto: cambiando lingua
// MENTRE si guarda un profilo, il corpo della pagina (card badge/escursioni/
// preferiti) resta nella lingua di prima finche' non si riapre la pagina (un
// altro click sullo stesso profilo la ridisegna gia' nella lingua giusta).
//
// SOLO IL TITOLO in alto (#section-title) si aggiorna comunque, trovato provando
// dal vivo: updateSectionTitle (app.js) lo sovrascrive ad ogni cambio lingua con
// prettyNames['user-profile'] ("Profilo"/"Profile"), cancellando lo username vero
// che renderUserProfile ci aveva scritto - db.users ce l'ha gia' in cache, zero
// fetch per rimetterlo a posto.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    const section = document.getElementById('user-profile');
    if (!section || !section.classList.contains('active') || !profiloUserIdAperto) return;
    const utente = (window.CamoscioState.users || []).find(u => u.id === profiloUserIdAperto);
    const sectionTitle = document.getElementById('section-title');
    if (utente && sectionTitle) sectionTitle.textContent = utente.username;
});
