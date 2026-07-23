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

function showGenericModal(message, { showInput = false, defaultValue = "", showCancel = true, confirmLabel = "OK" } = {}) {
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

// Sostituisce confirm(): risolve a true/false
window.showConfirmModal = function(message) {
    return showGenericModal(message, { showInput: false });
};

// Sostituisce prompt(): risolve al testo inserito, o null se annullato
window.showPromptModal = function(message, defaultValue = "") {
    return showGenericModal(message, { showInput: true, defaultValue });
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

    // Inizializza i moduli principali
    await initApp();

    // Inizializza gli event listeners di navigazione
    setupNavigation();

    // Inizializza il centro notifiche
    setupNotificationBell();

    // Collega il pulsante di uscita
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) btnLogout.addEventListener("click", () => { if (window.performLogout) window.performLogout(); });
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
                "map-section": "Mappa & Crowdsourcing Waze",
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
        avatarEl.innerHTML = `<img src="${usr.profilePhoto}" alt="Foto profilo" class="avatar-photo">`;
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
            ${n.text}
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

    // Timbri delle Vette
    renderDashboardStamps();

    // Rinfresca lo stato del Dead Man's Switch nella dashboard
    if (window.updateDashboardSafetyCard) {
        window.updateDashboardSafetyCard();
    }

    // Card Profilo: verifica KYC + Layer Esperto Locale
    renderProfileCard(usr);
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

// Render dei Timbri sbloccati nella dashboard
function renderDashboardStamps() {
    const container = document.getElementById("stamps-collection");
    if (!container) return;

    // Punti timbrabili fissi nel nostro simulatore alpino
    const allStamps = [
        { id: "stamp_mezzeno", name: "Rifugio Franchetti", emoji: "🧗", alt: 2433 },
        { id: "stamp_gemelli", name: "Corno Grande", emoji: "⛺", alt: 2912 },
        { id: "stamp_gnifetti", name: "Rifugio Zilioli", emoji: "❄️", alt: 2250 },
        { id: "stamp_margherita", name: "Monte Vettore", emoji: "👑", alt: 2476 }
    ];

    container.innerHTML = "";
    
    let unlockedCount = 0;
    
    allStamps.forEach(stamp => {
        const isUnlocked = window.CamoscioState.stamps.some(s => s.stampId === stamp.id);
        if (isUnlocked) unlockedCount++;

        const slot = document.createElement("div");
        slot.className = `stamp-slot ${isUnlocked ? 'unlocked' : ''}`;
        
        const unlockedInfo = window.CamoscioState.stamps.find(s => s.stampId === stamp.id);
        const dateText = unlockedInfo ? unlockedInfo.dateUnlocked : "Bloccato";

        slot.innerHTML = `
            <span class="stamp-icon">${stamp.emoji}</span>
            <span class="stamp-name">${stamp.name}</span>
            <span class="stamp-date">${dateText}</span>
        `;
        container.appendChild(slot);
    });

    // Aggiorna progressi della sfida Gran Sasso
    const challengePercentText = document.getElementById("challenge-percent");
    const challengeFill = document.getElementById("challenge-fill");

    // Conta quanti timbri del Gran Sasso (rifugio Franchetti e Corno Grande) sono sbloccati
    const gransassoStamps = ["stamp_mezzeno", "stamp_gemelli"];
    const orobieUnlocked = window.CamoscioState.stamps.filter(s => gransassoStamps.includes(s.stampId)).length;
    const progressPercent = Math.round((orobieUnlocked / 2) * 100);

    challengePercentText.textContent = `${progressPercent}%`;
    challengeFill.style.width = `${progressPercent}%`;
}
