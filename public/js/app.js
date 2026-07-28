// Global state cache
window.CamoscioState = {
    currentUser: null,
    users: [],
    hikes: [],
    reports: [],
    stamps: [],
    squads: [],
    diaries: [],
    bookmarks: [],
    completions: [], // Escursioni già segnate come completate dall'utente corrente
    notifications: [], // Notifiche dell'utente corrente (nuove escursioni di squadra, esiti iscrizioni)
    activeHikeId: null // Escursione attualmente selezionata da Zaino/Carpooling/Mappa; default hikes[0] finché non se ne sceglie una
};

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
    }, 4000);
};

function showGenericModal(message, { showInput = false, defaultValue = "", showCancel = true, confirmLabel = "OK", inputType = "text", inputMax = null } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById("generic-modal");
        const messageEl = document.getElementById("generic-modal-message");
        const inputWrapper = document.getElementById("generic-modal-input-wrapper");
        const input = document.getElementById("generic-modal-input");
        const btnConfirm = document.getElementById("generic-modal-confirm");
        const btnCancel = document.getElementById("generic-modal-cancel");

        messageEl.textContent = message;
        btnConfirm.textContent = confirmLabel;
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
// abbastanza - deve dire cosa succede premendolo.
window.showConfirmModal = function(message, confirmLabel = "OK") {
    return showGenericModal(message, { showInput: false, confirmLabel });
};

// Sostituisce prompt(): risolve al testo inserito, o null se annullato
window.showPromptModal = function(message, defaultValue = "") {
    return showGenericModal(message, { showInput: true, defaultValue });
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

    // Stesso motivo: anche "Esci" deve funzionare da subito, non solo a caricamento
    // finito - chi si accorge di essere entrato con l'account sbagliato vuole poterne
    // uscire immediatamente.
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) btnLogout.addEventListener("click", () => { if (window.performLogout) window.performLogout(); });

    // Inizializza i moduli principali (lento: dati + nove moduli)
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

        // Inizializza i sottomoduli in ordine
        if (window.initProfileModule) window.initProfileModule();
        if (window.initMapModule) window.initMapModule();
        if (window.initWeatherModule) window.initWeatherModule();
        if (window.initBackpackModule) window.initBackpackModule();
        if (window.initCarpoolModule) window.initCarpoolModule();
        if (window.initSafetyModule) window.initSafetyModule();
        if (window.initSocialModule) window.initSocialModule();
        if (window.initTrackingModule) window.initTrackingModule();
        if (window.initTrailheadPicker) window.initTrailheadPicker();
        if (window.initStorico) window.initStorico();
        if (window.initRoutePlanner) window.initRoutePlanner(); // punto 13

        // Forza il render della dashboard iniziale
        renderDashboard();

    } catch (e) {
        console.error("Errore durante l'inizializzazione dell'app:", e);
    }
}

// Aggiorna lo stato globale richiamando le API
async function refreshState() {
    const fetchApi = async (url) => {
        const res = await fetch(url);
        return res.json();
    };

    try {
        const [users, hikes, reports, diaries, squads, bookmarks] = await Promise.all([
            fetchApi('/api/users'),
            fetchApi('/api/hikes'),
            fetchApi('/api/reports'),
            fetchApi('/api/diaries'),
            fetchApi('/api/squads'),
            fetchApi('/api/bookmarks')
        ]);

        window.CamoscioState.users = users;
        window.CamoscioState.hikes = hikes;
        window.CamoscioState.reports = reports;
        window.CamoscioState.diaries = diaries;
        window.CamoscioState.squads = squads;
        window.CamoscioState.bookmarks = bookmarks;

        // Imposta l'escursione attiva di default sulla prima disponibile, solo se non è già stata scelta
        if (!window.CamoscioState.activeHikeId && hikes.length > 0) {
            window.CamoscioState.activeHikeId = hikes[0].id;
        }

        if (window.CamoscioState.currentUser) {
            // Aggiorna l'utente corrente con i dati freschi dal server
            window.CamoscioState.currentUser = users.find(u => u.id === window.CamoscioState.currentUser.id) || window.CamoscioState.currentUser;
            
            // Carica i timbri dell'utente corrente
            const stamps = await fetchApi(`/api/stamps/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.stamps = stamps;

            // Carica le escursioni già segnate come completate dall'utente corrente
            const completions = await fetchApi(`/api/completions/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.completions = completions;

            // Carica le notifiche dell'utente corrente
            const notifications = await fetchApi(`/api/notifications/${window.CamoscioState.currentUser.id}`);
            window.CamoscioState.notifications = notifications;
            renderNotificationBell();
        }
    } catch (e) {
        console.error("Impossibile contattare le API locali. Assicurarsi che il server node sia attivo.", e);
    }
}

// Imposta la navigazione SPA
function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn, .btn-nav-trigger");
    const sections = document.querySelectorAll(".page-section");
    const sectionTitle = document.getElementById("section-title");

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
        if (sectionTitle) {
            const prettyNames = {
                "dashboard": "Dashboard",
                "hikes": "Escursioni",
                "my-hikes": "Le mie escursioni",
                "badges": "I tuoi Badge",
                "map-section": "Mappa & Sentieri",
                "carpool": "Carpooling & Spese Viaggio",
                "backpack": "Zaino Intelligente Checklist",
                "safety": "Sicurezza & Mesh Simulator",
                "social": "Tribù, Recensioni & Squadre"
            };
            sectionTitle.textContent = prettyNames[targetId] || "Camoscio";
        }

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
}

// Innesca il render corretto della sezione aperta
function triggerSectionRender(sectionId) {
    refreshState().then(() => {
        switch (sectionId) {
            case "dashboard":
                renderDashboard();
                break;
            case "hikes":
                if (window.renderHikesList) window.renderHikesList();
                break;
            case "my-hikes":
                if (window.renderMyHikes) window.renderMyHikes();
                // Punto 15: lo storico delle uscite registrate/importate vive nella stessa
                // pagina ma legge da un'altra rotta (le sessioni di tracciamento, non le
                // escursioni), quindi si aggiorna per conto suo.
                if (window.renderStorico) window.renderStorico();
                if (window.renderProgetti) window.renderProgetti(); // punto 13: i miei progetti
                break;
            case "badges":
                if (window.renderBadges) window.renderBadges();
                break;
            case "map-section":
                if (window.renderWazeReportsList) window.renderWazeReportsList();
                if (window.renderMapMarkers) window.renderMapMarkers();
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
    document.getElementById("current-user-exp").textContent = `Livello: ${usr.experienceLevel}`;
    
    const kycBadge = document.getElementById("current-user-kyc");
    if (usr.kycVerified) {
        kycBadge.classList.remove("hidden");
    } else {
        kycBadge.classList.add("hidden");
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

    list.innerHTML = notifications.map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead('${n.id}')">
            ${escapeHtml(n.text)}
            <span class="notification-time">${new Date(n.createdAt).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    `).join("");
}

// Segna una notifica come letta al click
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

// Apre/chiude il pannello notifiche
function setupNotificationBell() {
    const btnBell = document.getElementById("btn-notification-bell");
    const dropdown = document.getElementById("notification-dropdown");
    if (!btnBell || !dropdown) return;

    btnBell.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.classList.contains("hidden") && !dropdown.contains(e.target) && e.target !== btnBell) {
            dropdown.classList.add("hidden");
        }
    });
}

// Renderizzazione Dashboard
function renderDashboard() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    // Statistiche generali
    document.getElementById("dash-welcome-name").textContent = usr.username.split(" ")[0];
    document.getElementById("stat-completed-hikes").textContent = usr.completedHikes;
    document.getElementById("stat-stamps-count").textContent = window.CamoscioState.stamps.length;
    document.getElementById("stat-reputation").textContent = `${usr.reputation}%`;

    // Sezione Passo Personalizzato
    document.getElementById("pace-up-val").textContent = usr.averagePaceUp;
    document.getElementById("pace-down-val").textContent = usr.averagePaceDown;
    
    // Indice di fatica: CAI standard stima 400m/h in salita.
    const fatigueIndex = (400 / usr.averagePaceUp).toFixed(2);
    document.getElementById("pace-index-val").textContent = fatigueIndex;

    // Disegna il grafico del passo
    renderPaceChart(usr);

    // Punto 16: i totali reali di distanza, dislivello e velocita' media. Non si aspetta la
    // sua risposta (nessun await): il resto della Dashboard deve comparire subito, e i tre
    // numeri si riempiono da soli un istante dopo.
    renderTrackingTotals();

    // Timbri delle Vette
    renderDashboardStamps();

    // Rinfresca lo stato del Dead Man's Switch nella dashboard
    if (window.updateDashboardSafetyCard) {
        window.updateDashboardSafetyCard();
    }

    // Card Profilo: verifica KYC + Layer Esperto Locale
    renderProfileCard(usr);
}

// Punto 16 di cose_da_fare.txt - totali reali di cammino in Dashboard.
// La somma la fa il server (GET /api/tracking/totals): qui arrivano gia' tre numeri, invece
// dell'elenco di tutte le sessioni con dentro le tracce GPS complete.
async function renderTrackingTotals() {
    const elDistanza = document.getElementById("total-distance");
    const elDislivello = document.getElementById("total-elevation");
    const elVelocita = document.getElementById("total-speed");
    const nota = document.getElementById("dash-totals-note");
    if (!elDistanza) return;

    try {
        const res = await fetch('/api/tracking/totals');
        if (!res.ok) throw new Error('Richiesta fallita');
        const t = await res.json();

        elDistanza.textContent = t.distanzaKm.toLocaleString('it-IT');
        elDislivello.textContent = t.dislivelloM.toLocaleString('it-IT');
        // La velocita' media a 0 non si scrive "0": senza tempo registrato non e' zero, e'
        // che non si sa ancora. Sono due cose diverse e mostrarle uguali sarebbe una bugia.
        elVelocita.textContent = t.velocitaMediaKmh > 0 ? t.velocitaMediaKmh.toLocaleString('it-IT') : "—";

        if (nota) {
            if (t.sessioni === 0) {
                nota.textContent = "Non hai ancora registrato nessuna escursione: avvia il tracciamento GPS dalla mappa e questi numeri cominceranno a salire.";
            } else {
                const ore = Math.floor(t.secondi / 3600);
                const minuti = Math.round((t.secondi % 3600) / 60);
                const tempo = ore > 0 ? `${ore}h ${minuti}min` : `${minuti} min`;
                let testo = `${t.sessioni} ${t.sessioni === 1 ? 'escursione registrata' : 'escursioni registrate'}, ${tempo} di cammino in totale.`;

                // Le uscite importate da un file .gpx senza orari hanno km e dislivello veri
                // ma nessuna durata, quindi restano fuori dal tempo e dalla velocita' media
                // (vedi /totals in routes/tracking.js). Va DETTO: chi conosce i propri numeri
                // e vede una velocita' media che non torna coi chilometri mostrati sopra
                // penserebbe a un errore del sito, e avrebbe ragione a pensarlo.
                const senza = t.sessioniSenzaDurata || 0;
                if (senza > 0) {
                    testo += senza === 1
                        ? " Un'uscita importata è senza orari: i suoi chilometri sono contati, il tempo e la velocità media no."
                        : ` ${senza} uscite importate sono senza orari: i loro chilometri sono contati, il tempo e la velocità media no.`;
                }
                nota.textContent = testo;
            }
        }
    } catch (e) {
        console.error("Impossibile calcolare i totali delle escursioni:", e);
        // Meglio lasciare i trattini e dirlo, che mostrare degli zeri: uno zero verrebbe
        // letto come "non hai mai camminato", che e' un'informazione sbagliata.
        if (nota) nota.textContent = "Non è stato possibile caricare i totali. Riprova più tardi.";
    }
}

// Aggiorna la card "Il Tuo Profilo" (verifica KYC, esperto locale)
function renderProfileCard(usr) {
    const btnKyc = document.getElementById("btn-trigger-kyc");
    const kycVerifiedBadge = document.getElementById("profile-kyc-verified-badge");
    if (btnKyc && kycVerifiedBadge) {
        if (usr.kycVerified) {
            btnKyc.classList.add("hidden");
            kycVerifiedBadge.classList.remove("hidden");
        } else {
            btnKyc.classList.remove("hidden");
            kycVerifiedBadge.classList.add("hidden");
        }
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
function renderPaceChart(user) {
    const ctx = document.getElementById("paceChart");
    if (!ctx) return;

    if (paceChartInstance) {
        paceChartInstance.destroy();
    }

    // Dati per il grafico: confronta il passo dell'utente con lo standard CAI
    paceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Ascesa (m/ora)', 'Discesa (m/ora)'],
            datasets: [
                {
                    label: 'Tuo Passo Rilevato',
                    data: [user.averagePaceUp, user.averagePaceDown],
                    backgroundColor: 'rgba(193, 102, 46, 0.65)',
                    borderColor: '#C1662E',
                    borderWidth: 2,
                    borderRadius: 6
                },
                {
                    label: 'Standard CAI Alpino',
                    data: [400, 600],
                    backgroundColor: 'rgba(76, 126, 144, 0.25)',
                    borderColor: '#4C7E90',
                    borderWidth: 2,
                    borderRadius: 6
                }
            ]
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

// Render dei Timbri sbloccati nella dashboard.
// PUNTO 18: l'elenco dei quattro timbri era scritto a mano proprio qui. Ora la fonte e'
// una sola, il catalogo di public/js/badges.js, usato anche dalla pagina Badge e dal
// geofencing della Mappa: tre copie dello stesso elenco sarebbero divergite alla prima
// aggiunta, ed e' lo stesso motivo per cui al punto 10 la scheda dell'escursione era
// stata estratta in buildHikeCard invece di essere copiata.
// Qui restano solo QUATTRO riquadri anche se i badge sono di piu': questa e' una scheda
// di riepilogo, l'elenco intero e' la pagina Badge. Quali quattro lo decide anteprima():
// prima quelli presi, poi i piu' alti da prendere.
function renderDashboardStamps() {
    const container = document.getElementById("stamps-collection");
    if (!container) return;

    const daMostrare = window.CamoscioBadges
        ? window.CamoscioBadges.anteprima(4)
        : [];

    container.innerHTML = "";

    daMostrare.forEach(badge => {
        const slot = document.createElement("div");
        slot.className = `stamp-slot ${badge.sbloccato ? 'unlocked' : ''}`;

        slot.innerHTML = `
            <span class="stamp-icon">${escapeHtml(badge.emoji)}</span>
            <span class="stamp-name">${escapeHtml(badge.nome)}</span>
            <span class="stamp-date">${escapeHtml(badge.sbloccato ? window.CamoscioBadges.dataItaliana(badge.data) : "Bloccato")}</span>
        `;
        container.appendChild(slot);
    });

    // "3 badge su 10": senza questa riga la scheda mostrerebbe quattro riquadri senza
    // far capire che gli altri esistono, e il pulsante qui sotto sembrerebbe portare
    // alla stessa cosa vista piu' in grande.
    const contatore = document.getElementById("passport-count");
    if (contatore && window.CamoscioBadges) {
        const tutti = window.CamoscioBadges.statoBadge();
        const presi = tutti.filter(b => b.sbloccato).length;
        contatore.textContent = `${presi} badge su ${tutti.length}`;
    }

    // La pagina Badge mostra gli stessi dati di questa scheda: si ridisegna insieme,
    // cosi' chi sblocca un timbro dalla Mappa la ritrova aggiornata senza che ogni
    // punto che tocca i timbri debba ricordarsi di chiamarla. Stesso criterio gia' in
    // uso fra renderHikesList e renderMyHikes (punto 10).
    if (window.renderBadges) window.renderBadges();

    // Punto 19: qui si aggiornava la barra della "sfida Gran Sasso". La percentuale era vera
    // (contava i timbri sbloccati), ma la sfida NO: nessuno l'aveva mai creata o accettata,
    // compariva a chiunque appena registrato, e l'etichetta "(0/2)" accanto era scritta a mano
    // nell'HTML e restava 0 anche dopo aver preso i timbri. Tolta insieme al suo riquadro.
}
