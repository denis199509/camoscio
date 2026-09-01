// Global state cache
window.CamoscioState = {
    currentUser: null,
    users: [],
    hikes: [],
    reports: [],
    stamps: [],
    squads: [],
    bookmarks: [],
    completions: [], // Escursioni già segnate come completate dall'utente corrente
    following: [], // Punto 113: documenti Follow dell'utente corrente (chi segue) - tasto "Segui", liste in Tribù & Squadre, Feed
    notifications: [], // Notifiche dell'utente corrente (nuove escursioni di squadra, esiti iscrizioni)
    moderation: null, // Punto 111: {scadute, risoluzioniRichieste, daVerificare, totale} da GET /api/reports/moderation, solo per chi modera
    activeHikeId: null // Escursione attualmente selezionata da Zaino/Carpooling/Mappa; default hikes[0] finché non se ne sceglie una
};

// Rollout traduzione punto 102, terzo lotto (27/08/2026): il dizionario EN vive in
// i18n.js, l'italiano resta il testo di ripiego qui sotto (T('chiave') || 'italiano').
// "var" e non "const": app.js e' un <script> classico che condivide lo scope globale
// con profile.js/userprofile.js, che dichiarano gia' un "T" - un "const T" darebbe
// SyntaxError e bloccherebbe l'intero file (vedi la nota in cima a i18n.js).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Escaping di sicurezza per inserire testo scritto da un utente (titoli, bio, nomi, messaggi...)
// dentro innerHTML: senza questo, chiunque potrebbe eseguire script arbitrario nel browser di chi
// legge semplicemente scrivendo HTML nei tanti campi di testo libero dell'app (username, titoli
// escursione, messaggi mesh, ecc. - vedi caccia ai bug Fase H). "Chrome globale" come showToast
// sotto: caricato da app.js ma usato da tutti gli altri moduli, stesso criterio già in uso.
window.escapeHtml = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// --- COMPONENTE TOAST/MODAL NON BLOCCANTE (sostituisce alert/confirm/prompt nativi) ---
// "Chrome globale" dell'app, non legato a un singolo modulo/funzionalità - stesso criterio già
// usato per window.CamoscioState.

// Notifica non bloccante, si chiude da sola. Sostituisce alert().
window.showToast = function(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("fade-out");
        setTimeout(() => toast.remove(), 250);
    }, 9000);
};

function showGenericModal(message, { showInput = false, defaultValue = "", showCancel = true, confirmLabel = "OK", cancelLabel = "Annulla", danger = false, inputType = "text", inputMax = null } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById("generic-modal");
        const messageEl = document.getElementById("generic-modal-message");
        const inputWrapper = document.getElementById("generic-modal-input-wrapper");
        const input = document.getElementById("generic-modal-input");
        const btnConfirm = document.getElementById("generic-modal-confirm");
        const btnCancel = document.getElementById("generic-modal-cancel");

        messageEl.textContent = message;
        btnConfirm.textContent = confirmLabel;
        btnCancel.textContent = cancelLabel;
        // "danger" colora di rosso il bottone di conferma (riusa .btn-danger, gia' in CSS)
        // per un'azione distruttiva - sempre risistemato ad ogni chiamata, mai solo quando
        // serve: il modale e' UNO SOLO riusato da tutto il sito (stessa cautela gia' presa
        // per input.type sotto), un rosso rimasto da una cancellazione non deve appiccicarsi
        // alla prossima conferma non distruttiva.
        btnConfirm.classList.toggle("btn-primary", !danger);
        btnConfirm.classList.toggle("btn-danger", danger);
        btnCancel.classList.toggle("hidden", !showCancel);
        if (showInput) {
            inputWrapper.classList.remove("hidden");
            // Il TIPO del campo e' un parametro: per una data, type="date" fa comparire il
            // calendario del telefono invece della tastiera, ed e' l'unico modo perche' uno
            // non debba scrivere a mano "2026-06-14" col pollice. Si rimette sempre a posto
            // (anche nel ramo "text") perche' il campo e' UNO SOLO riusato da tutte le
            // finestre: lasciarlo su "date" farebbe comparire un calendario alla prossima
            // richiesta di testo.
            input.type = inputType;
            if (inputMax) input.setAttribute("max", inputMax); else input.removeAttribute("max");
            input.value = defaultValue;
        } else {
            inputWrapper.classList.add("hidden");
        }

        modal.classList.remove("hidden");
        if (showInput) input.focus();

        const cleanup = (result) => {
            modal.classList.add("hidden");
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            resolve(result);
        };

        const onConfirm = () => cleanup(showInput ? input.value : true);
        const onCancel = () => cleanup(showInput ? null : false);

        btnConfirm.addEventListener("click", onConfirm);
        btnCancel.addEventListener("click", onCancel);
    });
}

// Sostituisce confirm(): risolve a true/false.
// L'etichetta del pulsante di conferma e' un parametro (punto 20): davanti a una finestra
// che sta per far partire una telefonata al 112, un pulsante che dice "OK" non dice
// abbastanza - deve dire cosa succede premendolo. cancelLabel/danger nelle opzioni: per
// una cancellazione (escursioni/uscite) Denis vuole le parole "Cancella" per tornare
// indietro ed "Elimina" rosso per confermare, diverse da "Annulla"/"OK" di una conferma
// qualunque - senza toccare nessun altro chiamante, che resta sui default di sempre.
window.showConfirmModal = function(message, confirmLabel = "OK", { cancelLabel = "Annulla", danger = false } = {}) {
    return showGenericModal(message, { showInput: false, confirmLabel, cancelLabel, danger });
};

// Sostituisce prompt(): risolve al testo inserito, o null se annullato
window.showPromptModal = function(message, defaultValue = "") {
    return showGenericModal(message, { showInput: true, defaultValue });
};

// Punto 114: un file .fit e' binario, non si puo' mandare come testo dentro il JSON come
// si fa col .gpx. Si legge come ArrayBuffer e si converte in base64, cosi' viaggia nello
// stesso corpo JSON di sempre senza bisogno di un upload multipart (che vorrebbe dire una
// libreria in piu' sul server). Usato sia dallo storico (storico.js) sia dal tasto ⬆ di
// un'escursione completata (social.js): una funzione sola, non due copie.
window.fileToBase64 = async function(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // A blocchi: String.fromCharCode(...bytes) con un file di qualche MB sfonderebbe il
    // limite di argomenti dello stack. 0x8000 byte per giro e' il valore prudente d'uso comune.
    let binario = '';
    const BLOCCO = 0x8000;
    for (let i = 0; i < bytes.length; i += BLOCCO) {
        binario += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCCO));
    }
    return btoa(binario);
};

// Come showPromptModal ma con un campo DATA (calendario nativo sul telefono) e un tetto
// a oggi: un'escursione gia' fatta non puo' essere nel futuro. Serve al caricamento dei
// file .gpx senza orari, dove la data la deve dire l'utente (punto 32).
window.showDateModal = function(message, defaultValue = "", confirmLabel = "Conferma") {
    const oggi = new Date();
    const max = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
    return showGenericModal(message, { showInput: true, defaultValue, confirmLabel, inputType: "date", inputMax: max });
};

// Notifica persistente a riconoscimento singolo (no Annulla) - per messaggi che non devono
// poter passare inosservati né chiudersi da soli, es. l'allarme del Dead Man's Switch.
window.showAlertModal = function(message, confirmLabel = "Ho capito") {
    return showGenericModal(message, { showInput: false, showCancel: false, confirmLabel });
};

// Ingrandimento immagine badge (chiesto da Denis il 20/08/2026, non in cose_da_fare.txt):
// dopo aver personalizzato le icone dei badge voleva che i dettagli si vedessero bene, non
// solo nel cerchio piccolo ritagliato (object-fit:cover) della scheda.
// Delegazione su document invece di un ascoltatore per scheda: le .page-section restano
// tutte nel DOM insieme (vedi 07-Trappole-Tecniche.md del vault), quindi un solo
// ascoltatore copre badge propri (Badge), badge di un altro utente (profilo) e il badge
// personale (Dashboard/profilo) senza dover toccare badges.js/userprofile.js.
window.openImageLightbox = function(src, alt, grayscale, stampId) {
    const modal = document.getElementById("image-lightbox");
    const img = document.getElementById("image-lightbox-img");
    if (!modal || !img || !src) return;
    img.src = src;
    img.alt = alt || "";
    // Un badge non ancora conquistato resta grigio anche ingrandito - stesso motivo del
    // grayscale piccolo sulla scheda, non ha senso svelarlo a colori prima di averlo preso.
    img.classList.toggle("image-lightbox-grayscale", !!grayscale);

    // "i" in alto a destra (chiesto da Denis il 28/08/2026): compare solo se questo badge
    // ha una scheda in badge-info.js - le cime e i rifugi del catalogo. I badge personali
    // e le vette ricavate dalle escursioni non ne hanno, e la "i" resta nascosta.
    const info = (window.CamoscioBadgeInfo && stampId) ? window.CamoscioBadgeInfo.get(stampId) : null;
    const btnInfo = document.getElementById("image-lightbox-info-btn");
    const boxInfo = document.getElementById("image-lightbox-info");
    if (btnInfo && boxInfo) {
        const titInfo = document.getElementById("image-lightbox-info-title");
        const txtInfo = document.getElementById("image-lightbox-info-text");
        if (info) {
            if (titInfo) titInfo.textContent = info.nome || "";
            if (txtInfo) txtInfo.textContent = info.testo || "";
        }
        btnInfo.classList.toggle("hidden", !info);
        // Sempre chiuso all'apertura del modale: il pannello si vede solo premendo la "i".
        boxInfo.classList.add("hidden");
        btnInfo.setAttribute("aria-expanded", "false");
    }

    modal.classList.remove("hidden");
};

// Apre/chiude il pannello informativo dentro il modale immagine (bottone "i").
window.toggleImageLightboxInfo = function() {
    const btnInfo = document.getElementById("image-lightbox-info-btn");
    const boxInfo = document.getElementById("image-lightbox-info");
    if (!btnInfo || !boxInfo) return;
    const daMostrare = boxInfo.classList.contains("hidden");
    boxInfo.classList.toggle("hidden", !daMostrare);
    btnInfo.setAttribute("aria-expanded", daMostrare ? "true" : "false");
};

window.closeImageLightbox = function() {
    const modal = document.getElementById("image-lightbox");
    if (!modal) return;
    modal.classList.add("hidden");
    // Svuotato alla chiusura: non tiene in memoria un'immagine grande per una finestra chiusa.
    const img = document.getElementById("image-lightbox-img");
    if (img) img.src = "";
    // Pannello "i" richiuso, cosi' la prossima apertura riparte sempre dall'immagine.
    const boxInfo = document.getElementById("image-lightbox-info");
    if (boxInfo) boxInfo.classList.add("hidden");
    const btnInfo = document.getElementById("image-lightbox-info-btn");
    if (btnInfo) btnInfo.setAttribute("aria-expanded", "false");
};

document.addEventListener("click", (e) => {
    // .badge-card-icon-img (pagina Badge/profilo) e .stamp-icon-img ("Ultimi traguardi" in
    // Dashboard, renderDashAchievements in questo stesso file) sono due componenti diversi
    // sugli stessi dati (badges.js: schedaBadge / ultimiTraguardi) - stessa icona, nomi di
    // classe diversi, quindi vanno cercati entrambi qui.
    const img = e.target.closest(".badge-card-icon-img, .stamp-icon-img, .personal-badge-illustration");
    if (!img) return;
    // "unlocked" sta su .badge-card (pagina Badge/profilo) o su .stamp-slot (anteprima
    // Dashboard) a seconda del componente; .personal-badge-illustration non ha questo
    // concetto (i badge personali sono sempre a colori, assegnati a mano) - nessuno dei due
    // antenati esiste, bloccato resta false.
    const card = img.closest(".badge-card, .stamp-slot");
    const bloccato = !!(card && !card.classList.contains("unlocked"));
    // stampId (messo da schedaBadge in badges.js e da renderDashAchievements qui sotto)
    // serve alla "i": .personal-badge-illustration non ha una card antenata, quindi resta
    // undefined e il pannello informativo semplicemente non compare.
    const stampId = card ? card.dataset.stampId : null;
    window.openImageLightbox(img.src, img.alt, bloccato, stampId);
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.closeImageLightbox();
});

// Main routing and initialization
document.addEventListener("DOMContentLoaded", async () => {
    // Verifica se c'e' gia' una sessione valida (login o demo-login): se no, mostra
    // la schermata di accesso/registrazione e si ferma qui - initApp() parte solo dopo.
    const authenticated = await checkAuthAndShowGate();
    if (!authenticated) return;

    // BUG TROVATO IL 2026-07-26 provando il sito online: la navigazione veniva
    // collegata DOPO "await initApp()", che e' lento (carica tutti i dati dal server e
    // inizializza nove moduli, uno dei quali scarica pure i confini regionali). Ma
    // l'interfaccia viene mostrata PRIMA, da checkAuthAndShowGate: nel mezzo restava una
    // finestra di alcuni secondi in cui il sito sembrava pronto ma i pulsanti del menu
    // non facevano assolutamente niente, perche' non avevano ancora nessun listener.
    // Sul piano gratuito di Render, che si risveglia con calma, la finestra e' lunga
    // abbastanza da incontrarla davvero (riprodotta: il primo click andava perso, dal
    // secondo in poi funzionava tutto).
    // Ora la navigazione si collega SUBITO: non dipende dai dati, si limita a mostrare/
    // nascondere sezioni e a chiedere il rendering, che a sua volta ricarica i dati.
    setupNavigation();
    setupNotificationBell();

    // Punto 45, stesso motivo del blocco email piu' sotto: checkAuthAndShowGate ha appena
    // messo currentUser con la risposta piena di /api/auth/me, che contiene gia'
    // canModerateReports - non serve aspettare initApp()/refreshState() per decidere se
    // mostrare il triangolo. Collegarlo solo dentro initApp() sarebbe la stessa trappola
    // "modulo che si aggancia tardi" gia' pagata due volte (navigazione 26/07, profilo 06/08).
    if (window.setupPendingReportsTriangle) window.setupPendingReportsTriangle();

    // Stesso motivo: anche "Esci" deve funzionare da subito, non solo a caricamento
    // finito - chi si accorge di essere entrato con l'account sbagliato vuole poterne
    // uscire immediatamente.
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) btnLogout.addEventListener("click", () => { if (window.performLogout) window.performLogout(); });

    // E STESSO MOTIVO ANCORA per la fascia "conferma il tuo indirizzo email", spostata qui
    // il 2026-07-30. Prima si collegava SOLO in fondo a initApp(): la fascia compariva a
    // caricamento finito - misurati 2,3 secondi in locale, e su Render gratuito che si
    // sveglia da fermo sono molti di piu'. Per tutto quel tempo in cima alla pagina non
    // c'era nessun tasto da premere, quindi chi apriva il sito per confermare l'indirizzo
    // poteva non trovarlo affatto e concludere che non funzionasse.
    // Qui i dati ci sono gia' tutti: checkAuthAndShowGate ha appena messo currentUser con
    // la risposta di /api/auth/me, che contiene sia emailVerified sia isDemoAccount - cioe'
    // le uniche due cose che servono per decidere se mostrarla. Non dipende da initApp.
    // LA CHIAMATA IN FONDO A initApp() RESTA, e serve: refreshState() rimpiazza currentUser
    // con la versione presa da /api/users, quindi la seconda chiamata riallinea la fascia se
    // nel frattempo l'indirizzo e' stato confermato altrove. Chiamarla due volte e' sicuro:
    // l'ascoltatore del tasto e' protetto da dataset.collegato e non si aggancia due volte.
    setupEmailVerifyBanner();

    // STESSO BUG DEL 26/07/2026 QUI SOPRA, trovato di nuovo il 06/08/2026 mentre si
    // indagava il punto 7 (cambio password dal profilo): initProfileModule() collegava i
    // pulsanti della card profilo (cambio password, salva bio/foto, esperto locale) da
    // dentro initApp(), DOPO await refreshState(). Il profilo pero' si apre e si popola
    // subito (navigateTo + renderMyProfilePage, vedi il click su #btn-goto-profile qui
    // sopra), senza aspettare initApp(): restava la stessa finestra di qualche istante in
    // cui il pulsante "Cambia password" si vedeva ma non faceva niente al click, senza
    // nessun errore. Stesso rimedio: si collega SUBITO, non dipende dai dati (li legge
    // solo dentro i gestori, al momento del click, non qui).
    if (window.initProfileModule) window.initProfileModule();

    // Inizializza i moduli principali (lento: dati + moduli rimasti)
    await initApp();
});

// Ritorna true (e mostra l'app) se esiste gia' una sessione valida (GET /api/auth/me),
// altrimenti mostra la schermata di login/registrazione e ritorna false.
async function checkAuthAndShowGate() {
    try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
            const user = await res.json();
            window.CamoscioState.currentUser = user;
            document.getElementById("auth-gate").classList.add("hidden");
            document.getElementById("main-app-container").classList.remove("hidden");
            return true;
        }
    } catch (e) {
        console.error("Errore nel controllo della sessione:", e);
    }

    document.getElementById("main-app-container").classList.add("hidden");
    document.getElementById("auth-gate").classList.remove("hidden");
    if (window.setupAuthGate) window.setupAuthGate();
    if (window.lucide) lucide.createIcons();
    return false;
}

// Richiamato da auth.js dopo un login/registrazione riusciti: la ricarica pagina
// e' il modo piu' semplice e affidabile per far ripartire initApp() da zero con
// il nuovo utente (tutti i moduli si reinizializzano gia' correttamente cosi').
window.onAuthSuccess = function () {
    window.location.reload();
};

async function initApp() {
    try {
        // Carica tutti i dati dal server backend (l'utente corrente e' gia' impostato
        // da checkAuthAndShowGate a partire dalla sessione)
        await refreshState();

        // Aggiorna l'interfaccia utente superiore
        updateHeaderUserWidget();

        // Inizializza i sottomoduli in ordine (initProfileModule si collega prima, vedi sopra)
        if (window.initMapModule) window.initMapModule();
        if (window.initWeatherModule) window.initWeatherModule();
        if (window.initBackpackModule) window.initBackpackModule();
        if (window.initCarpoolModule) window.initCarpoolModule();
        if (window.initSafetyModule) window.initSafetyModule();
        if (window.initSocialModule) window.initSocialModule();
        if (window.initPeopleSearchModule) window.initPeopleSearchModule();
        if (window.initTrackingModule) window.initTrackingModule();
        if (window.initTrailheadPicker) window.initTrailheadPicker();
        if (window.initStorico) window.initStorico();
        if (window.initRoutePlanner) window.initRoutePlanner(); // punto 13

        // Fascia "conferma il tuo indirizzo email"
        setupEmailVerifyBanner();

        // Forza il render della dashboard iniziale
        renderDashboard();

    } catch (e) {
        console.error("Errore durante l'inizializzazione dell'app:", e);
    }
}

// Aggiorna lo stato globale richiamando le API
// Segnala una sola volta che la sessione e' scaduta: refreshState viene richiamato a ogni
// cambio di sezione, quindi senza questo l'avviso comparirebbe a ripetizione.
let sessioneScadutaGiaSegnalata = false;

async function refreshState() {
    // Ogni risposta va controllata PRIMA di usarla (punto 35). Con la sessione scaduta il
    // server risponde 401 con {error:...} al posto dell'elenco atteso: senza questo controllo
    // finiva dritto nello stato globale, e i moduli che ci lavorano sopra cadevano
    // (map.js -> "db.stamps.some non e' una funzione"). Meglio NON aggiornare lo stato che
    // aggiornarlo con dati che elenchi non sono: quello di prima e' comunque valido.
    const fetchApi = async (url) => {
        const res = await fetch(url);
        if (!res.ok) {
            const errore = new Error(`${url} ha risposto ${res.status}`);
            errore.status = res.status;
            throw errore;
        }
        return res.json();
    };

    try {
        const [users, hikes, reports, squads, bookmarks] = await Promise.all([
            fetchApi('/api/users'),
            fetchApi('/api/hikes'),
            fetchApi('/api/reports'),
            fetchApi('/api/squads'),
            fetchApi('/api/bookmarks')
        ]);

        window.CamoscioState.users = users;
        window.CamoscioState.hikes = hikes;
        window.CamoscioState.reports = reports;
        window.CamoscioState.squads = squads;
        window.CamoscioState.bookmarks = bookmarks;

        // activeHikeId resta null finché l'utente non sceglie DAVVERO un'escursione (clic sul
        // tasto "Mappa" di una scheda -> loadActiveHikeOnMap in map.js). Prima qui c'era un
        // default su hikes[0], cioè la PRIMA escursione del database di chiunque: ogni
        // selettore che legge activeHikeId (registrazione GPS, Zaino) ci atterrava sopra
        // senza che l'utente l'avesse scelta. Stesso difetto già tolto dallo Zaino a suo
        // tempo (vedi il commento in backpack.js/escursioneDiRiferimento).

        if (window.CamoscioState.currentUser) {
            // Aggiorna l'utente corrente con i dati freschi dal server
            window.CamoscioState.currentUser = users.find(u => u.id === window.CamoscioState.currentUser.id) || window.CamoscioState.currentUser;
            
            // Carica i timbri dell'utente corrente
            const stamps = await fetchApi(`/api/stamps/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.stamps = stamps;

            // Punto 42b: quante volte una vetta gia' conquistata e' stata raggiunta -
            // trasformato in oggetto {stampId: {...}} qui una volta sola, cosi' badges.js
            // lo legge con una ricerca diretta invece di scorrere un array ad ogni scheda.
            const ascese = await fetchApi(`/api/tracking/peak-ascents/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.peakAscents = {};
            ascese.forEach(a => { window.CamoscioState.peakAscents[a.stampId] = a; });

            // Carica le escursioni già segnate come completate dall'utente corrente
            const completions = await fetchApi(`/api/completions/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.completions = completions;

            // Carica le notifiche dell'utente corrente
            const notifications = await fetchApi(`/api/notifications/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.notifications = notifications;
            renderNotificationBell();

            // Punto 113: chi segue l'utente corrente. Come stamps/completions/notifiche qui
            // sopra si ricarica ad ogni refreshState() (cioè ad ogni cambio sezione), nessun
            // polling - lo useranno il tasto "Segui" sui profili, le liste follow in Tribù &
            // Squadre e la pagina Feed.
            const following = await fetchApi('/api/follow/following');
            window.CamoscioState.following = following;

            // Punto 45: il conteggio del triangolo, SOLO per chi puo' moderare - altrimenti
            // sarebbe una fetch-e-403 sprecata per chiunque altro ad ogni cambio sezione.
            // Stessa cadenza event-driven gia' in uso per le notifiche sopra (nessun polling
            // a intervallo in tutto il progetto): si aggiorna ad ogni refreshState(), cioe'
            // ad ogni cambio pagina.
            // Punto 111: /moderation ha sostituito /pending - il pallino ora conta tutto
            // cio' che chiede una decisione (da verificare + risoluzioni + scadute), non
            // solo le 'pending'. Il totale lo calcola il server.
            if (window.CamoscioState.currentUser.canModerateReports) {
                const moderation = await fetchApi('/api/reports/moderation');
                window.CamoscioState.moderation = moderation;
                if (window.renderPendingReportsBadge) window.renderPendingReportsBadge(moderation.totale);
            }
        }
    } catch (e) {
        if (e.status === 401) {
            // Sessione scaduta con la pagina rimasta aperta. Lo stato NON viene toccato e si
            // avvisa una volta sola. NON si ricarica la pagina da soli di proposito: se e' in
            // corso una registrazione GPS, farla sparire senza preavviso sarebbe peggio del
            // problema. Chi ricarica torna alla schermata di accesso, come dopo il logout.
            console.warn("Sessione scaduta: lo stato non e' stato aggiornato.", e);
            if (!sessioneScadutaGiaSegnalata) {
                sessioneScadutaGiaSegnalata = true;
                if (window.showToast) {
                    window.showToast("La sessione e' scaduta. Ricarica la pagina per rientrare.", "error");
                }
            }
            return;
        }
        console.error("Impossibile contattare le API locali. Assicurarsi che il server node sia attivo.", e);
    }
}

// Imposta la navigazione SPA
function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn, .btn-nav-trigger");
    const sections = document.querySelectorAll(".page-section");
    const sectionTitle = document.getElementById("section-title");

    // Mappa sectionId -> titolo italiano, scritta un'unica volta: la usano sia
    // la navigazione (sotto) sia il cambio lingua (i18n.js, per rimettere a
    // posto il titolo quando si cambia lingua senza navigare altrove).
    const prettyNames = {
        "dashboard": "Dashboard",
        "feed": "Feed",
        "hikes": "Escursioni",
        "my-hikes": "Le mie escursioni",
        "badges": "I tuoi Badge",
        "map-section": "Mappa & Sentieri",
        "carpool": "Carpooling & Spese Viaggio",
        "backpack": "Zaino Intelligente Checklist",
        "safety": "Sicurezza & Mesh Simulator",
        "social": "Tribù, Recensioni & Squadre",
        "people-search": "Cerca Persone",
        "user-profile": "Profilo",
        // #my-profile ha un titolo FISSO (a differenza di #user-profile, dove
        // renderUserProfile ci scrive lo username): tenendolo qui, updateSectionTitle
        // lo rimette a posto da solo a ogni cambio lingua - vedi 'sectionTitle.my-profile'
        // in i18n.js e renderMyProfilePage in profile.js (rollout punto 102, terzo lotto).
        "my-profile": "Il Tuo Profilo",
        // #pending-reports-page: stesso caso di #my-profile - titolo fisso, nessuna
        // voce in barra. showPendingReportsPage non lo scrive piu' a mano, ci pensa
        // updateSectionTitle via 'sectionTitle.pending-reports-page' (punto 102, settimo lotto).
        // Punto 111: la pagina ora ha tre code, non solo "da verificare".
        "pending-reports-page": "Moderazione segnalazioni",
        // Punto 113: titolo di ripiego - disegnaTestata (outingpage.js) ci scrive poi il
        // nome dell'autore, come #user-profile con lo username.
        "outing-page": "Uscita"
    };

    // Estratta da navigateTo il 22/08/2026 perche' serve anche a i18n.js: se
    // si cambia lingua stando gia' sulla pagina Badge, il titolo deve
    // aggiornarsi senza aspettare una nuova navigazione.
    function updateSectionTitle(targetId) {
        if (!sectionTitle) return;
        const tradotto = window.CamoscioI18n && window.CamoscioI18n.t("sectionTitle." + targetId);
        sectionTitle.textContent = tradotto || prettyNames[targetId] || "Camoscio";
    }
    window.CamoscioUpdateSectionTitle = updateSectionTitle;

    function navigateTo(targetId) {
        sections.forEach(sec => {
            if (sec.id === targetId) {
                sec.classList.add("active");
            } else {
                sec.classList.remove("active");
            }
        });

        // Aggiorna i pulsanti sidebar
        document.querySelectorAll(".nav-btn").forEach(btn => {
            if (btn.getAttribute("data-target") === targetId) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        // Aggiorna il titolo dell'header
        updateSectionTitle(targetId);

        // Trigger di ridimensionamento mappa se si apre la sezione mappa
        if (targetId === "map-section" && window.mapInstance) {
            setTimeout(() => {
                window.mapInstance.invalidateSize();
            }, 100);
        }

        // Punto 26 - il puntino blu della posizione vive solo mentre si guarda la Mappa:
        // tenere acceso il GPS mentre si legge la Dashboard sarebbe batteria buttata.
        // Questo e' l'unico imbuto della navigazione (ci passano sia i pulsanti della barra
        // sia i .btn-nav-trigger), quindi basta metterlo qui.
        // accendi(true) = accensione automatica: se il permesso e' bloccato o il consenso e'
        // spento resta spento in silenzio, senza aprire finestre a chi voleva solo la mappa.
        if (window.CamoscioGeo) {
            if (targetId === "map-section") {
                window.CamoscioGeo.accendi(true);
            } else if (!(window.CamoscioTrackingIsRecording && window.CamoscioTrackingIsRecording())) {
                // Durante una registrazione NON si spegne: il tracciamento continua da
                // qualunque sezione (pulsante flottante a scarpone) e tornando alla mappa il
                // percorso deve essere ancora li'.
                window.CamoscioGeo.spegni();
            }
        }

        // Ri-esegui il rendering della sezione specifica per aggiornare i dati freschi
        triggerSectionRender(targetId);
    }

    // Navigazione tramite pulsanti della sidebar
    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-target");
            navigateTo(target);
        });
    });

    // Delegazione dei click per pulsanti interni di navigazione dinamici
    document.addEventListener("click", (e) => {
        const trigger = e.target.closest(".btn-nav-trigger");
        if (trigger) {
            const target = trigger.getAttribute("data-target");
            navigateTo(target);
        }
    });

    // Punto 59 di cose_da_fare.txt: l'icona del profilo in alto a destra porta alla
    // pagina "Il Tuo Profilo", separata dalla Dashboard (prima ci si scorreva dentro,
    // punto 40 - Denis ha chiesto di toglierla da li' e farne una pagina a se').
    const profileWidget = document.getElementById("btn-goto-profile");
    if (profileWidget) {
        profileWidget.addEventListener("click", () => {
            navigateTo("my-profile");
            if (window.renderMyProfilePage) window.renderMyProfilePage();
        });
    }

    // Esposta per la pagina profilo di un altro utente (public/js/userprofile.js):
    // "user-profile" non ha una voce nella barra laterale (cambia contenuto in base
    // a CHI si e' cliccato), ma deve comunque passare da qui per nascondere le altre
    // sezioni, spegnere il GPS se si stava guardando la Mappa, ecc.
    window.navigateTo = navigateTo;
}

// Innesca il render corretto della sezione aperta
function triggerSectionRender(sectionId) {
    refreshState().then(() => {
        switch (sectionId) {
            case "dashboard":
                renderDashboard();
                break;
            case "feed":
                if (window.renderFeed) window.renderFeed(); // punto 113
                break;
            case "hikes":
                if (window.renderHikesList) window.renderHikesList();
                break;
            case "my-hikes":
                // Punto 80/B: renderMyHikes() ora richiama da sola anche la lista
                // unificata "Escursioni completate" (renderCompletate, storico.js) -
                // niente piu' una seconda chiamata qui, sarebbe stata una sezione
                // ridisegnata due volte a ogni ingresso in pagina.
                if (window.renderMyHikes) window.renderMyHikes();
                if (window.renderProgetti) window.renderProgetti(); // punto 13: i miei progetti
                break;
            case "badges":
                if (window.renderBadges) window.renderBadges();
                break;
            case "map-section":
                if (window.renderWazeReportsList) window.renderWazeReportsList();
                if (window.renderMapMarkers) window.renderMapMarkers();
                // Punto 45: hike-select e alert di consenso del tracciamento, spostati qui
                // dal vecchio pannello a scarpone (idle, non piu' raggiungibile da solo -
                // vedi tracking.js). Senza questa chiamata il menu resterebbe vuoto per
                // sempre: prima lo popolava solo renderTrackingUi() nel suo ramo idle.
                if (window.renderHikeSelectOptions) window.renderHikeSelectOptions();
                if (window.renderRouteToFollowOptions) window.renderRouteToFollowOptions();
                if (window.toggleGeoConsentAlert) window.toggleGeoConsentAlert();
                break;
            case "carpool":
                if (window.renderCarpoolModule) window.renderCarpoolModule();
                break;
            case "backpack":
                if (window.renderBackpackModule) window.renderBackpackModule();
                break;
            case "safety":
                if (window.renderSafetyModule) window.renderSafetyModule();
                break;
            case "social":
                if (window.renderSocialModule) window.renderSocialModule();
                break;
            case "people-search":
                if (window.renderPeopleSearchModule) window.renderPeopleSearchModule();
                break;
        }
    });
}

// Aggiorna l'header superiore
function updateHeaderUserWidget() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    const avatarEl = document.getElementById("current-user-avatar");
    if (usr.profilePhoto) {
        avatarEl.innerHTML = `<img src="${escapeHtml(usr.profilePhoto)}" alt="Foto profilo" class="avatar-photo">`;
    } else {
        avatarEl.textContent = usr.avatar;
    }
    document.getElementById("current-user-name").textContent = usr.username;
    document.getElementById("current-user-reputation").textContent = usr.reputation;
    // Solo l'etichetta "Livello:" si traduce; il valore (Principiante/Intermedio/
    // Esperto) resta invariato, coerente con la card identita' di profilo.
    document.getElementById("current-user-exp").textContent = `${T('header.livelloLabel') || 'Livello:'} ${usr.experienceLevel}`;

    // Badge personale (chiesto da Denis in sessione il 01/08/2026): assegnato a
    // mano, non guadagnato - vedi personal-badges.js.
    const personalBadgeEl = document.getElementById("current-user-personal-badge");
    if (personalBadgeEl) {
        const personale = window.CamoscioPersonalBadges ? window.CamoscioPersonalBadges.get(usr.id) : null;
        if (personale) {
            personalBadgeEl.src = `img/badge-personali/${personale.icon}`;
            personalBadgeEl.title = `${personale.titolo}: ${personale.descrizione}`;
            personalBadgeEl.classList.remove("hidden");
        } else {
            personalBadgeEl.classList.add("hidden");
        }
    }
}

// Aggiorna il contatore e la lista del centro notifiche
function renderNotificationBell() {
    const badge = document.getElementById("notification-count-badge");
    const list = document.getElementById("notification-dropdown-list");
    if (!badge || !list) return;

    const notifications = window.CamoscioState.notifications;
    const unreadCount = notifications.filter(n => !n.read).length;

    if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? "9+" : unreadCount;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }

    if (notifications.length === 0) {
        list.innerHTML = `<div class="text-muted small italic text-center" style="padding: 16px;">Nessuna notifica al momento.</div>`;
        return;
    }

    // Punto 81: una notifica legata a un'escursione (il promemoria "non hai ancora
    // completato", relatedHikeId - lib/hikeStats.js) porta li' invece di limitarsi a
    // segnarsi come letta: aprire il campanello gia' la segna letta da sola (vedi sotto),
    // quindi cliccarla sopra puo' fare qualcosa di piu' utile.
    // Punto 111: stesso schema per una notifica di segnalazione sentiero (relatedReportId
    // - richiesta di risoluzione o scadenza): porta Denis alla pagina Moderazione
    // (goToReportModeration in pendingreports.js).
    // Punto 113: stesso schema per un "mi piace" ricevuto (relatedSessionId): il click apre
    // la pagina dell'uscita (goToOutingFromNotification in outingpage.js).
    list.innerHTML = notifications.map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}" onclick="${n.relatedReportId ? `goToReportModeration()` : n.relatedHikeId ? `goToHikeToComplete('${n.relatedHikeId}')` : n.relatedSessionId ? `goToOutingFromNotification('${n.relatedSessionId}')` : `markNotificationRead('${n.id}')`}">
            ${escapeHtml(n.text)}
            <span class="notification-time">${new Date(n.createdAt).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    `).join("");
}

// Segna una notifica come letta al click - solo quelle senza un posto dove portare
// (ne' relatedReportId ne' relatedHikeId ne' relatedSessionId, vedi renderNotificationBell sopra).
window.markNotificationRead = async function(notificationId) {
    const notif = window.CamoscioState.notifications.find(n => n.id === notificationId);
    if (!notif || notif.read) return;

    try {
        await fetch(`/api/notifications/${notificationId}/read`, { method: 'PUT' });
        notif.read = true;
        renderNotificationBell();
    } catch (e) {
        console.error("Errore nel segnare la notifica come letta:", e);
    }
};

// Punto 81: aprire il pannello del campanello basta a considerare tutto letto, senza dover
// cliccare ogni notifica una per una - chiesto esplicitamente da Denis.
window.markAllNotificationsRead = async function() {
    const db = window.CamoscioState;
    if (!db.notifications.some(n => !n.read)) return;

    try {
        await fetch('/api/notifications/read-all', { method: 'PUT' });
        db.notifications.forEach(n => { n.read = true; });
        renderNotificationBell();
    } catch (e) {
        console.error("Errore nel segnare tutte le notifiche come lette:", e);
    }
};

// Apre/chiude il pannello notifiche
function setupNotificationBell() {
    const btnBell = document.getElementById("btn-notification-bell");
    const dropdown = document.getElementById("notification-dropdown");
    if (!btnBell || !dropdown) return;

    // Spostato a figlio diretto di <body> una volta sola: .top-header ha
    // backdrop-filter (per l'effetto vetro smerigliato), e in Chrome un
    // backdrop-filter sull'antenato diventa il blocco di contenimento per i
    // discendenti "position:fixed" - un riquadro finto-fixed dentro .top-header
    // resta comunque ancorato li', quindi resta comunque dentro alla colonna
    // .main-content (overflow:hidden) e si taglia lo stesso. Fuori da entrambi,
    // "position:fixed" torna a essere relativo al viewport per davvero.
    document.body.appendChild(dropdown);

    btnBell.addEventListener("click", (e) => {
        e.stopPropagation();
        const opening = dropdown.classList.contains("hidden");
        dropdown.classList.toggle("hidden");
        if (opening) {
            // La posizione si calcola dal campanello vero ad ogni apertura (stesso
            // posto di prima, stessa dimensione: su schermo largo c'e' sempre spazio).
            // Il "Math.max" e' la sola differenza: se incollare il riquadro al
            // campanello lo spingerebbe oltre il bordo sinistro vero dello schermo
            // (il campanello non e' mai al bordo destro vero: c'e' sempre l'avatar
            // dopo di lui), si scivola verso sinistra fino a un margine minimo invece
            // di uscire dallo schermo - la dimensione del riquadro non cambia mai,
            // solo dove viene messo.
            const bellRect = btnBell.getBoundingClientRect();
            const dropdownWidth = dropdown.getBoundingClientRect().width;
            const margin = 8;
            const left = Math.max(margin, bellRect.right - dropdownWidth);
            dropdown.style.position = "fixed";
            dropdown.style.top = (bellRect.bottom + 8) + "px";
            dropdown.style.left = left + "px";
            dropdown.style.right = "auto";

            // Punto 81: aprire il pannello basta a considerare tutto letto - chiesto
            // esplicitamente da Denis, non serve piu' cliccare ogni notifica una per una.
            window.markAllNotificationsRead();
        }
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.classList.contains("hidden") && !dropdown.contains(e.target) && e.target !== btnBell) {
            dropdown.classList.add("hidden");
        }
    });
}

// Blocco di apertura della Dashboard (revisione UX v2). Due stati:
//  - senza una prossima avventura: sottotitolo neutro, nessuna card
//  - con un'escursione CONFERMATA in programma: sottotitolo dedicato + la card
//    #dash-hero-adventure (titolo, "Organizzata da te" se l'ho creata io, quando + conto alla
//    rovescia, numeri se ci sono, punto di partenza se c'e', partecipanti, "Apri escursione",
//    link "vedi tutte" se ne ho piu' di una in programma - le ultime due, FASE 3).
function renderDashHero(usr) {
    const nome = usr.username.split(" ")[0];
    const greetEl = document.getElementById("dash-hero-greet");
    if (greetEl) greetEl.textContent = T("dash.ciaoNome", nome) || ("Ciao " + nome + " 👋");

    const avventura = prossimaAvventura(usr);

    const subEl = document.getElementById("dash-hero-sub");
    if (subEl) {
        subEl.textContent = avventura
            ? (T("dash.heroSubProssima") || "La tua prossima avventura è quasi pronta.")
            : (T("dash.heroSubDefault") || "Pronto per la prossima avventura?");
    }

    const card = document.getElementById("dash-hero-adventure");
    const openBtn = document.getElementById("dash-hero-adventure-open");
    if (!card) return;

    if (!avventura) {
        card.classList.add("hidden");
        if (openBtn) openBtn.onclick = null;
        return;
    }

    const prossima = avventura.hike;
    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === "en") ? "en-GB" : "it-IT";

    // Titolo: testo scritto dall'utente -> textContent, mai innerHTML.
    document.getElementById("dash-hero-adv-title").textContent = prossima.title;

    // FASE 3: "Organizzata da te", solo se l'ha creata l'utente - qualifica il titolo, quindi
    // gli sta subito sotto. Stesso meccanismo .hidden di -stats/-from piu' sotto.
    const orgEl = document.getElementById("dash-hero-adv-org");
    if (orgEl) {
        orgEl.textContent = T("dash.avventuraOrganizzata") || "Organizzata da te";
        orgEl.classList.toggle("hidden", !avventura.organizzata);
    }

    // Quando: "Giorno D mese · <oggi | domani | fra N giorni>".
    const d = new Date(prossima.date + "T12:00:00");
    let quando = d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
    quando = quando.charAt(0).toUpperCase() + quando.slice(1);
    const g = giorniAllaData(prossima.date);
    const rel = g <= 0
        ? (T("dash.avventuraOggi") || "oggi")
        : g === 1
            ? (T("dash.avventuraDomani") || "domani")
            : (T("dash.avventuraFraGiorni", g) || ("fra " + g + " giorni"));
    document.getElementById("dash-hero-adv-when").textContent = quando + " · " + rel;

    // Numeri: solo quelli davvero presenti (quota / distanza / dislivello sono tutti opzionali
    // nello schema; "mai un numero finto senza dati veri", punto 85).
    // useGrouping:true forza il separatore migliaia: l'italiano da solo NON raggruppa i numeri
    // a 4 cifre (2912 -> "2912"), e una quota o un dislivello stanno quasi sempre in quel range.
    const raggr = { useGrouping: true };
    const nums = [];
    if (Number.isFinite(prossima.maxAltitude) && prossima.maxAltitude > 0) nums.push(prossima.maxAltitude.toLocaleString(loc, raggr) + " m");
    if (Number.isFinite(prossima.distanceKm) && prossima.distanceKm > 0) nums.push(prossima.distanceKm.toLocaleString(loc, raggr) + " km");
    if (Number.isFinite(prossima.elevationGain) && prossima.elevationGain > 0) nums.push("+" + prossima.elevationGain.toLocaleString(loc, raggr) + " m");
    const statsEl = document.getElementById("dash-hero-adv-stats");
    statsEl.textContent = nums.join(" · ");
    statsEl.classList.toggle("hidden", nums.length === 0);

    // Punto di partenza, solo se l'escursione ce l'ha.
    const fromEl = document.getElementById("dash-hero-adv-from");
    const partenza = prossima.trailhead && prossima.trailhead.name;
    if (partenza) fromEl.textContent = T("dash.avventuraDa", partenza) || ("da " + partenza);
    fromEl.classList.toggle("hidden", !partenza);

    // Partecipanti.
    const n = (prossima.participants || []).length;
    document.getElementById("dash-hero-adv-people").textContent =
        "👥 " + (T("dash.avventuraPartecipanti", n) || (n + (n === 1 ? " partecipante" : " partecipanti")));

    // FASE 3: link "vedi tutte", solo se ce n'e' piu' di una in futuro - con una sola non
    // porterebbe a vedere niente di diverso da questa stessa card.
    const moreEl = document.getElementById("dash-hero-adv-more");
    if (moreEl) moreEl.classList.toggle("hidden", avventura.totale <= 1);

    if (openBtn) openBtn.onclick = () => { if (window.showHikePage) window.showHikePage(prossima.id); };
    card.classList.remove("hidden");
}

// La PROSSIMA AVVENTURA: fra le escursioni CONFERMATE (create da me, o dove sono gia' fra i
// participants - non le semplici richieste ancora in pendingApproval), quelle con data da oggi
// in avanti, la piu' vicina. Date "YYYY-MM-DD" (models/Hike.js), si ordinano come stringhe.
// NB: non si riusa escursioneDiRiferimento() dello Zaino - quella tiene conto del selettore
// manuale dello Zaino e dell'activeHikeId, che qui sarebbero effetti collaterali sbagliati.
// FASE 3: oltre all'escursione, serve sapere quante ce ne sono in futuro (per il link "vedi
// tutte") e se questa l'ha creata l'utente (per "Organizzata da te") - calcolate qui una volta
// sola sulla stessa lista "confermate", invece di rifare altrove lo stesso filtro (punti 98/B,
// 101: mai due copie della stessa logica che possono disallinearsi in silenzio).
function prossimaAvventura(usr) {
    if (!window.classificaMieEscursioni) return null;
    const { create, partecipo } = window.classificaMieEscursioni();
    const confermate = create.concat(partecipo.filter(h => (h.participants || []).includes(usr.id)));
    const oggi = new Date().toISOString().slice(0, 10);
    const future = confermate
        .filter(h => h.date && h.date >= oggi)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (!future.length) return null;
    return { hike: future[0], totale: future.length, organizzata: create.includes(future[0]) };
}

// Giorni interi da oggi alla data "YYYY-MM-DD". Ancorate a mezzogiorno cosi' il passaggio
// all'ora legale non sposta il conteggio di un giorno (stesso accorgimento di backpack.js).
function giorniAllaData(dateStr) {
    const oggi = new Date().toISOString().slice(0, 10);
    return Math.round((new Date(dateStr + "T12:00:00") - new Date(oggi + "T12:00:00")) / 86400000);
}

// Renderizzazione Dashboard
function renderDashboard() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    // PASSO 1 revisione UX: l'apertura e' "Ciao [Nome] + un'azione", non piu' tre statistiche.
    // Saluto, sottotitolo e riga della prossima escursione sono contestuali: li riscrive
    // renderDashHero a ogni render (quindi anche a ogni cambio lingua - onChange in fondo).
    renderDashHero(usr);

    // Sezione Passo Personalizzato.
    // IL PASSO SI MOSTRA SOLO SE E' STATO MISURATO. Il campo esiste sul documento utente solo
    // quando c'e' almeno un'osservazione vera dietro (models/User.js: default undefined dal
    // 16/08/2026, ricostruito da recalculatePersonalPace in lib/hikeStats.js) - quindi qui
    // basta guardare se il numero c'e', senza nessun controllo su isDemoAccount: i 4 account
    // demo hanno un passo assegnato a mano apposta ed e' giusto che continuino a vederlo.
    // Prima di oggi ogni utente nasceva con 350/500 gia' scritti e la Dashboard li mostrava
    // come "passo rilevato" a chi non aveva mai camminato: un'ipotesi travestita da misura.
    // Stessa regola gia' applicata alla velocita' media dei totali ("senza tempo registrato
    // non e' zero, e' che non si sa ancora").
    const paceUp = Number(usr.averagePaceUp);
    const paceDown = Number(usr.averagePaceDown);
    const passoMisurato = Number.isFinite(paceUp) && paceUp > 0 && Number.isFinite(paceDown) && paceDown > 0;

    document.getElementById("pace-up-val").textContent = passoMisurato ? paceUp : "—";
    document.getElementById("pace-down-val").textContent = passoMisurato ? paceDown : "—";
    // Indice di fatica: CAI standard stima 400m/h in salita.
    document.getElementById("pace-index-val").textContent = passoMisurato ? (400 / paceUp).toFixed(2) : "—";

    // Le unita' di misura seguono il numero: "— m/h" e "—x rispetto a CAI" sarebbero due
    // frasi che promettono un dato che non c'e' (vedi index.html, .pace-unit).
    for (const id of ["pace-up-unit", "pace-down-unit", "pace-index-unit"]) {
        const unita = document.getElementById(id);
        if (unita) unita.classList.toggle("hidden", !passoMisurato);
    }

    const notaPasso = document.getElementById("dash-pace-note");
    if (notaPasso) {
        notaPasso.textContent = passoMisurato
            ? ""
            : (T('dash.passoNotaVuoto') || "Il tuo passo non è ancora stato misurato: completa un'escursione indicando il tempo impiegato (o allegando la traccia .gpx) e questi numeri compariranno.");
    }

    // Disegna il grafico del passo
    renderPaceChart(usr, passoMisurato);

    // FASE 4: "Il tuo <anno>" al posto dei totali di sempre. Nessun await: il resto della
    // Dashboard compare subito, i pochi numeri si riempiono da soli un istante dopo e la card
    // non si svuota mentre carica.
    renderDashYearSummary();

    // FASE 4: "Il tuo cammino" (progressione per zona) + "Ultimi traguardi" al posto del
    // Passaporto. I dati sono gia' in CamoscioState (statoBadge), render sincrono.
    renderDashJourney();
    renderDashAchievements();

    // Rinfresca lo stato del Dead Man's Switch nella dashboard
    if (window.updateDashboardSafetyCard) {
        window.updateDashboardSafetyCard();
    }
}

// FASE 4 revisione UX - "Il tuo <anno>": riepilogo dell'anno in corso, al posto dei totali di
// sempre (card "Quanto hai camminato", rimossa). escursioni / km / dislivello dal server
// (GET /api/tracking/totals?anno=, stessa rotta di prima con un filtro anno opzionale); le
// vette dell'anno si contano qui dai timbri gia' in memoria (statoBadge), la loro data di
// sblocco e' "YYYY-MM-DD". Niente velocita' media (non e' nel riepilogo dell'anno) e nessun
// link "Vedi statistiche" (pagina statistiche filtrabile = fase a parte).
async function renderDashYearSummary() {
    const elHikes = document.getElementById("year-hikes");
    const elDistanza = document.getElementById("year-distance");
    const elDislivello = document.getElementById("year-elevation");
    const elVette = document.getElementById("year-peaks");
    const titolo = document.getElementById("dash-year-title");
    const nota = document.getElementById("dash-year-note");
    if (!elHikes) return;

    const anno = new Date().getFullYear();
    // Separatore migliaia: virgola in inglese, punto in italiano - stessa scelta di locale gia'
    // fatta altrove (rollout punto 102). useGrouping:true perche' l'italiano da solo non
    // raggruppa i numeri a 4 cifre (un dislivello annuale ci arriva facile), stesso motivo
    // della card prossima avventura in Fase 2.
    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    const raggr = { useGrouping: true };

    if (titolo) titolo.textContent = T('dash.annoTitolo', anno) || ('Il tuo ' + anno);

    // Vette dell'anno: lato client, nessuna rotta. Un timbro "cima" sbloccato con dateUnlocked
    // nell'anno in corso. Numero diverso da "vette conquistate" di "Il tuo cammino", che e' il
    // totale di sempre - qui e' solo il 2026.
    if (elVette && window.CamoscioBadges) {
        const vetteAnno = window.CamoscioBadges.statoBadge()
            .filter(b => b.tipo === 'cima' && b.sbloccato && String(b.data || '').slice(0, 4) === String(anno))
            .length;
        elVette.textContent = vetteAnno.toLocaleString(loc, raggr);
    }

    try {
        const res = await fetch('/api/tracking/totals?anno=' + anno);
        if (!res.ok) throw new Error('Richiesta fallita');
        const t = await res.json();

        elHikes.textContent = t.sessioni.toLocaleString(loc, raggr);
        elDistanza.textContent = t.distanzaKm.toLocaleString(loc, raggr);
        elDislivello.textContent = t.dislivelloM.toLocaleString(loc, raggr);

        if (nota) {
            nota.textContent = t.sessioni === 0
                ? (T('dash.annoNotaVuoto', anno) || ('Nessuna escursione registrata nel ' + anno + ' per ora: questi numeri si aggiornano da soli mentre cammini.'))
                : "";
        }
    } catch (e) {
        console.error("Impossibile calcolare il riepilogo dell'anno:", e);
        // Meglio i trattini e dirlo, che degli zeri: uno zero si leggerebbe come "non hai
        // camminato", che e' un'informazione sbagliata.
        if (nota) nota.textContent = T('dash.totaliErrore') || "Non è stato possibile caricare i totali. Riprova più tardi.";
    }
}

// Fascia in cima al sito per chi non ha ancora confermato l'indirizzo email.
// LA REGOLA: si vede solo se l'utente NON ha confermato E non e' un account demo. I 4
// account demo entrano senza password dalla pagina /demo e non hanno un indirizzo: per
// loro la fascia sarebbe un invito a fare una cosa impossibile.
function setupEmailVerifyBanner() {
    const banner = document.getElementById("email-verify-banner");
    const bottone = document.getElementById("btn-resend-verification");
    const usr = window.CamoscioState.currentUser;
    if (!banner || !usr) return;

    const daConfermare = !usr.isDemoAccount && !usr.emailVerified;
    banner.classList.toggle("hidden", !daConfermare);
    if (!daConfermare) return;

    if (bottone && !bottone.dataset.collegato) {
        // dataset.collegato evita di agganciare due volte lo stesso ascoltatore se questa
        // funzione venisse richiamata: due invii per un solo clic consumerebbero il freno
        // anti-abuso al doppio della velocita'.
        bottone.dataset.collegato = "1";
        bottone.addEventListener("click", async () => {
            bottone.disabled = true;
            const testoIniziale = bottone.textContent;
            bottone.textContent = "Invio…";
            try {
                const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
                const dati = await res.json();
                if (res.ok) {
                    window.showToast(dati.message || "Ti abbiamo mandato l'email.", "success");
                } else {
                    window.showToast(dati.error || "Non è stato possibile mandare l'email.", "error");
                }
            } catch (e) {
                console.error("Errore nel rinvio dell'email di conferma:", e);
                window.showToast("Impossibile contattare il server. Riprova.", "error");
            } finally {
                bottone.disabled = false;
                bottone.textContent = testoIniziale;
            }
        });
    }

    if (window.lucide) lucide.createIcons();
}

// Aggiorna la card "Il Tuo Profilo" (foto, bio, esperto locale, cambio password)
function renderProfileCard(usr) {
    // Punto 40: mostra la foto vera se c'e', altrimenti la stessa emoji del widget in alto.
    const photoPreview = document.getElementById("profile-photo-preview");
    if (photoPreview) {
        photoPreview.innerHTML = usr.profilePhoto
            ? `<img src="${escapeHtml(usr.profilePhoto)}" alt="Foto profilo">`
            : usr.avatar;
    }
    const bioField = document.getElementById("profile-bio");
    const bioCounter = document.getElementById("profile-bio-counter");
    if (bioField) {
        bioField.value = usr.bio || "";
        if (bioCounter) bioCounter.textContent = bioField.value.length;
    }

    const expertToggle = document.getElementById("local-expert-toggle");
    const expertArea = document.getElementById("local-expert-area");
    if (expertToggle && expertArea) {
        expertToggle.checked = !!(usr.localExpert && usr.localExpert.active);
        expertArea.value = (usr.localExpert && usr.localExpert.area) || "";
    }

    // Cambio password (punto 7): nascosto per i 4 account demo, che entrano dalla pagina
    // /demo senza password e quindi non ne hanno una da cambiare. Mostrargliela vorrebbe
    // dire offrire un modulo che risponde sempre "password attuale non corretta".
    const changePasswordSection = document.getElementById("change-password-section");
    if (changePasswordSection) {
        changePasswordSection.classList.toggle("hidden", !!usr.isDemoAccount);
    }
}

// Disegna il grafico delle prestazioni di ascesa/discesa con Chart.js
let paceChartInstance = null;
// "passoMisurato" arriva da renderDashboard, che ha gia' guardato se il numero esiste: senza
// una misura vera la barra blu NON si disegna e la sua voce sparisce anche dalla legenda -
// una barra alta 350 m/h disegnata su un'ipotesi e' la stessa bugia dei tre numeri sopra, e
// una legenda che promette "Tuo Passo Rilevato" senza nessuna barra sotto sarebbe pure
// peggio (sembrerebbe un guasto). Resta il solo Standard CAI Alpino, che e' un riferimento
// vero e non una supposizione su chi guarda.
function renderPaceChart(user, passoMisurato) {
    const ctx = document.getElementById("paceChart");
    if (!ctx) return;

    if (paceChartInstance) {
        paceChartInstance.destroy();
    }

    const datasetUtente = {
        label: T('dash.chartTuoPasso') || 'Tuo Passo Rilevato',
        data: [Number(user.averagePaceUp), Number(user.averagePaceDown)],
        backgroundColor: 'rgba(76, 126, 144, 0.65)',
        borderColor: '#4C7E90',
        borderWidth: 2,
        borderRadius: 6
    };
    const datasetCai = {
        label: T('dash.chartCaiStandard') || 'Standard CAI Alpino',
        data: [400, 600],
        backgroundColor: 'rgba(193, 102, 46, 0.25)',
        borderColor: '#C1662E',
        borderWidth: 2,
        borderRadius: 6
    };

    // Dati per il grafico: confronta il passo dell'utente con lo standard CAI
    paceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [T('dash.chartAscesa') || 'Ascesa (m/ora)', T('dash.chartDiscesa') || 'Discesa (m/ora)'],
            datasets: passoMisurato ? [datasetUtente, datasetCai] : [datasetCai]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#9CA3AF',
                        font: { size: 10 }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9CA3AF' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#9CA3AF' }
                }
            }
        }
    });
}

// FASE 4 revisione UX - "Il tuo cammino": la progressione dell'utente sulle vette, al posto
// del Passaporto (quattro riquadri senza contesto). Stessa fonte di sempre - statoBadge() in
// badges.js, un solo catalogo condiviso con la pagina Badge e il geofencing della Mappa - letta
// come "quante cime su quante" invece che come elenco. Tre stati, sullo schema .hidden gia' in
// uso per #dash-hero-adventure:
//  - nessuna vetta ancora presa       -> riquadro "Inizia il tuo cammino"
//  - vette prese, una zona a meta'     -> conteggi + barra + "ti mancano N vette"
//  - vette prese, nessuna zona a meta' -> conteggi, niente barra, CTA "scopri le prossime"
function renderDashJourney() {
    const card = document.getElementById("dash-journey");
    if (!card || !window.CamoscioBadges) return;

    const stato = window.CamoscioBadges.statoBadge();
    const vette = stato.filter(b => b.tipo === 'cima' && b.sbloccato).length;
    const rifugi = stato.filter(b => b.tipo === 'rifugio' && b.sbloccato).length;
    const badge = stato.filter(b => b.sbloccato).length;

    const main = document.getElementById("dash-journey-main");
    const empty = document.getElementById("dash-journey-empty");

    // Stato vuoto: nessuna vetta conquistata (punto 6 dello spec).
    if (vette === 0) {
        main.classList.add("hidden");
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");
    main.classList.remove("hidden");

    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    document.getElementById("dash-journey-peaks-n").textContent = vette.toLocaleString(loc);
    document.getElementById("dash-journey-peaks-l").textContent =
        T('dash.camminoVette', vette) || (vette === 1 ? 'vetta conquistata' : 'vette conquistate');
    document.getElementById("dash-journey-sub").textContent =
        T('dash.camminoSub', rifugi, badge)
        || `${rifugi} ${rifugi === 1 ? 'rifugio visitato' : 'rifugi visitati'} · ${badge} ${badge === 1 ? 'badge sbloccato' : 'badge sbloccati'}`;

    const zone = window.CamoscioBadges.progressoZone();
    const goal = document.getElementById("dash-journey-goal");
    const cta = document.getElementById("dash-journey-cta").querySelector("span");

    if (zone.length) {
        // La zona piu' significativa (quasi completata > maggior progresso > vista di recente:
        // l'ordine lo fa progressoZone). Una sola, mai piu' di una in Dashboard.
        const z = zone[0];
        goal.classList.remove("hidden");
        document.getElementById("dash-journey-zona").textContent = z.zona;
        document.getElementById("dash-journey-bar").style.width = z.percentuale + "%";
        document.getElementById("dash-journey-track").setAttribute("aria-label",
            T('dash.camminoBarraAria', z.presi, z.totale, z.zona) || `${z.presi} vette su ${z.totale} nel ${z.zona}`);
        document.getElementById("dash-journey-count").textContent = `${z.presi} / ${z.totale}`;
        document.getElementById("dash-journey-left").textContent =
            T('dash.camminoMancano', z.mancano, z.zona)
            || `Ti ${z.mancano === 1 ? 'manca' : 'mancano'} ${z.mancano} ${z.mancano === 1 ? 'vetta' : 'vette'} per completare ${z.zona}.`;
        cta.textContent = T('dash.camminoCta') || "Continua il tuo cammino";
    } else {
        // Vette conquistate ma nessuna zona a meta' (una sola presa, o le zone toccate sono
        // gia' complete): niente barra, il CTA invita a guardare quali vette mancano (punto 7).
        goal.classList.add("hidden");
        cta.textContent = T('dash.camminoCtaScopri') || "Scopri le prossime vette";
    }
}

// FASE 4 revisione UX - "Ultimi traguardi": anteprima dei badge presi piu' di recente, al
// posto della vecchia anteprima "presi + i piu' alti da prendere" (che aveva senso quando il
// riquadro doveva restare sempre pieno). Stesso componente visivo di prima (.stamp-slot),
// stessa fonte (badges.js); cambia solo la selezione: ultimiTraguardi() da' SOLO i presi.
function renderDashAchievements() {
    const grid = document.getElementById("dash-achievements-grid");
    const more = document.getElementById("dash-achievements-more");
    const empty = document.getElementById("dash-achievements-empty");
    if (!grid || !window.CamoscioBadges) return;

    const presi = window.CamoscioBadges.ultimiTraguardi(4);

    if (!presi.length) {
        // Nessun badge ancora: stato vuoto curato, non quattro riquadri grigi (punto 12).
        grid.classList.add("hidden");
        more.classList.add("hidden");
        empty.classList.remove("hidden");
    } else {
        empty.classList.add("hidden");
        grid.classList.remove("hidden");
        more.classList.remove("hidden");

        grid.innerHTML = "";
        presi.forEach(badge => {
            const slot = document.createElement("div");
            slot.className = "stamp-slot unlocked";
            // Come prima: il click sull'icona risale a questo slot per aprire il modale
            // immagine e la scheda "i" (badge-info.js, delegato in app.js).
            if (badge.stampId) slot.dataset.stampId = badge.stampId;

            const iconaHtml = badge.icona
                ? `<img src="${escapeHtml(badge.icona)}" alt="" class="stamp-icon stamp-icon-img">`
                : `<span class="stamp-icon">${escapeHtml(badge.emoji)}</span>`;

            slot.innerHTML = `
                ${iconaHtml}
                <span class="stamp-name">${escapeHtml(badge.nome)}</span>
                <span class="stamp-date">${escapeHtml(window.CamoscioBadges.dataItaliana(badge.data))}</span>
            `;
            grid.appendChild(slot);
        });
    }

    // La pagina Badge mostra gli stessi timbri: si ridisegna insieme, cosi' chi ne sblocca uno
    // dalla Mappa la ritrova aggiornata (renderBadges esce subito se la pagina non e' a
    // schermo). Comportamento ereditato dalla vecchia renderDashboardStamps.
    if (window.renderBadges) window.renderBadges();
}

// Rollout traduzione punto 102, terzo lotto (27/08/2026): due ridisegni al cambio lingua.
//
// 1) HEADER CONDIVISO (sempre visibile): alcuni pezzi hanno data-i18n che
//    applyStaticTranslations riporta al testo di partenza ("Caricamento...", il
//    guscio di "Reputazione: --%"); updateHeaderUserWidget rimette nome/reputazione
//    e traduce l'etichetta "Livello:". Legge solo currentUser, nessun fetch.
//
// 2) DASHBOARD: ridisegno completo solo se e' la sezione aperta. Quasi tutti i suoi
//    dati sono gia' in CamoscioState: il re-render sincrono e' gratis. renderDashYearSummary
//    rifa' un fetch di pochi numeri, ma non svuota la card mentre carica - niente flicker, a
//    differenza del caso userprofile.js dove l'onChange completo e' stato sconsigliato.
//    Nota: renderDashAchievements chiama renderBadges, che ha gia' un proprio onChange in
//    badges.js - a un toggle fatto dalla Dashboard renderBadges gira quindi due volte
//    (~40 nodi ricostruiti, costo trascurabile, non vale codice per evitarlo).
if (window.CamoscioI18n) {
    window.CamoscioI18n.onChange(function () {
        if (window.CamoscioState.currentUser) updateHeaderUserWidget();
        const dash = document.getElementById("dashboard");
        if (dash && dash.classList.contains("active")) renderDashboard();
    });
}
