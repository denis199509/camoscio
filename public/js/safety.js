let safetyTimerInterval = null;
let deadManActive = false;
let returnTimestamp = 0;
let socket = null;

function initSafetyModule() {
    // Inizializza WebSocket per il Mesh Network Simulator
    initMeshWebSocket();
    
    // Ripristina lo stato del Dead Man's Switch da LocalStorage se attivo
    restoreDeadManState();

    // Event listeners
    setupSafetyEvents();
}

function setupSafetyEvents() {
    const btnActivate = document.getElementById("btn-activate-switch");
    const btnDeactivate = document.getElementById("btn-deactivate-switch");
    const btnBannerCheckin = document.getElementById("btn-banner-checkin");
    const btnDashCheckin = document.getElementById("btn-dash-checkin");

    if (btnActivate) {
        btnActivate.addEventListener("click", () => {
            activateDeadManSwitch();
        });
    }

    const checkinHandler = () => {
        deactivateDeadManSwitch(true);
    };

    if (btnDeactivate) btnDeactivate.addEventListener("click", checkinHandler);
    if (btnBannerCheckin) btnBannerCheckin.addEventListener("click", checkinHandler);
    if (btnDashCheckin) btnDashCheckin.addEventListener("click", checkinHandler);

    // Form di invio chat mesh
    const formMesh = document.getElementById("mesh-send-form");
    if (formMesh) {
        formMesh.addEventListener("submit", (e) => {
            e.preventDefault();
            sendMeshChatMessage(false);
        });
    }

    const btnMeshSos = document.getElementById("btn-mesh-sos");
    if (btnMeshSos) {
        btnMeshSos.addEventListener("click", () => {
            sendMeshChatMessage(true);
        });
    }
}

// Inizializza WebSocket per la chat ed SOS in tempo reale
function initMeshWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${location.host}`;
    
    try {
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
            document.getElementById("mesh-connection-status").textContent = "Attivo (Connesso al Server Mesh)";
            document.getElementById("mesh-connection-status").className = "status-indicator online";
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleMeshMessageReceived(data);
        };

        socket.onclose = () => {
            document.getElementById("mesh-connection-status").textContent = "Offline (Tentativo riconnessione...)";
            document.getElementById("mesh-connection-status").className = "status-indicator offline";
            // Riconnessione dopo 5 secondi
            setTimeout(initMeshWebSocket, 5000);
        };
    } catch (e) {
        console.error("Errore connessione WebSocket Mesh:", e);
    }
}

// --- DEAD MAN'S SWITCH LOGIC ---

function activateDeadManSwitch() {
    const contact = document.getElementById("safety-contact").value;
    const durationHours = parseFloat(document.getElementById("safety-duration").value) || 0;
    const exactTime = document.getElementById("safety-time").value;

    let targetTimeMs = 0;

    if (exactTime) {
        const [hours, minutes] = exactTime.split(":");
        const now = new Date();
        const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
        
        // Se l'orario è già passato oggi, assume sia domani
        if (targetDate.getTime() <= now.getTime()) {
            targetDate.setDate(targetDate.getDate() + 1);
        }
        targetTimeMs = targetDate.getTime();
    } else {
        targetTimeMs = Date.now() + (durationHours * 3600 * 1000);
    }

    deadManActive = true;
    returnTimestamp = targetTimeMs;

    // Salva lo stato in local storage
    localStorage.setItem("deadman_active", "true");
    localStorage.setItem("deadman_timestamp", returnTimestamp.toString());
    localStorage.setItem("deadman_contact", contact);

    // Aggiorna UI
    document.getElementById("btn-activate-switch").classList.add("hidden");
    document.getElementById("btn-deactivate-switch").classList.remove("hidden");
    document.getElementById("emergency-banner").classList.remove("hidden");

    // Registra evento sul log satellitare simulato
    logSimulatedSms("SYSTEM", `Switch Attivato. Rientro atteso: ${new Date(returnTimestamp).toLocaleTimeString()}. Contatto emergenza: ${contact}.`);

    startSafetyCountdown();
    updateDashboardSafetyCard();
}

function deactivateDeadManSwitch(isSafeCheckin) {
    deadManActive = false;
    returnTimestamp = 0;

    clearInterval(safetyTimerInterval);

    // Cancella local storage
    localStorage.removeItem("deadman_active");
    localStorage.removeItem("deadman_timestamp");

    // Aggiorna UI
    document.getElementById("btn-activate-switch").classList.remove("hidden");
    document.getElementById("btn-deactivate-switch").classList.add("hidden");
    document.getElementById("emergency-banner").classList.add("hidden");

    if (isSafeCheckin) {
        logSimulatedSms("SAFE", `Check-in completato con successo. Dispositivo disattivato. Stazione Sicura.`);
    }

    updateDashboardSafetyCard();
}

function restoreDeadManState() {
    const isActive = localStorage.getItem("deadman_active") === "true";
    const ts = parseInt(localStorage.getItem("deadman_timestamp")) || 0;
    const contact = localStorage.getItem("deadman_contact") || "";

    if (isActive && ts > Date.now()) {
        deadManActive = true;
        returnTimestamp = ts;
        document.getElementById("safety-contact").value = contact;
        
        document.getElementById("btn-activate-switch").classList.add("hidden");
        document.getElementById("btn-deactivate-switch").classList.remove("hidden");
        document.getElementById("emergency-banner").classList.remove("hidden");

        startSafetyCountdown();
    } else if (isActive && ts <= Date.now()) {
        // È già scaduto mentre era chiuso! Invia allarme retroattivo
        triggerEmergencyAlarm();
    }
}

function startSafetyCountdown() {
    if (safetyTimerInterval) clearInterval(safetyTimerInterval);

    safetyTimerInterval = setInterval(() => {
        const timeLeft = returnTimestamp - Date.now();

        if (timeLeft <= 0) {
            clearInterval(safetyTimerInterval);
            triggerEmergencyAlarm();
        } else {
            // Aggiorna i timer visivi
            const hours = Math.floor(timeLeft / 3600000).toString().padStart(2, '0');
            const minutes = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
            const seconds = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');

            const timeStr = `${hours}:${minutes}:${seconds}`;
            const shortTimeStr = `${hours}:${minutes}`;

            document.getElementById("emergency-banner-timer").textContent = shortTimeStr;
            
            const dashTimer = document.getElementById("dash-timer-countdown");
            if (dashTimer) dashTimer.textContent = timeStr;
        }
    }, 1000);
}

// Scadenza del timer: scatta l'allarme SOS satellitare!
function triggerEmergencyAlarm() {
    const contact = localStorage.getItem("deadman_contact") || "Contatti fidati";
    const lat = window.userSimulatedLocation.lat.toFixed(5);
    const lng = window.userSimulatedLocation.lng.toFixed(5);
    
    // Costruisce il messaggio di allerta
    const msg = `ALLARME SOS: L'escursionista non è rientrato in tempo. Ultima posizione GPS: Lat ${lat}, Lng ${lng}. Avviare ricerche!`;

    logSimulatedSms("SOS", `A: ${contact} - MSG: ${msg}`);

    // Notifica visiva forte, persistente finché non viene riconosciuta (non un toast auto-dismiss:
    // un allarme di emergenza non deve poter passare inosservato)
    window.showAlertModal(`🚨 EMERGENZA SCATURITA 🚨\n\nSMS Satellitare inviato a: ${contact}\nMessaggio: ${msg}`);

    deactivateDeadManSwitch(false);
}

// Scrittura nel registro del log satellitare
function logSimulatedSms(type, text) {
    const container = document.getElementById("sms-log-entries");
    if (!container) return;

    if (container.querySelector(".italic")) {
        container.innerHTML = ""; // Rimuove il messaggio vuoto
    }

    const entry = document.createElement("div");
    
    if (type === "SAFE") {
        entry.className = "sms-entry";
        entry.style.background = "rgba(76, 122, 68, 0.08)";
        entry.style.borderColor = "rgba(76, 122, 68, 0.2)";
        entry.innerHTML = `<strong style="color:var(--accent-green)">[SATELLITE SAFE]</strong> ${text}`;
    } else if (type === "SOS") {
        entry.className = "sms-entry blink";
        entry.style.background = "rgba(168, 59, 46, 0.12)";
        entry.style.borderColor = "var(--accent-red)";
        entry.innerHTML = `<strong style="color:var(--accent-red)">[SATELLITE SOS ALERT]</strong> ${text}`;
    } else {
        entry.className = "sms-entry";
        entry.innerHTML = `<strong>[SISTEMA]</strong> ${text}`;
    }

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

// Sincronizza la card della dashboard
function updateDashboardSafetyCard() {
    const idleBlock = document.getElementById("dash-safety-status-idle");
    const activeBlock = document.getElementById("dash-safety-status-active");
    if (!idleBlock || !activeBlock) return;

    if (deadManActive) {
        idleBlock.classList.add("hidden");
        activeBlock.classList.remove("hidden");
    } else {
        idleBlock.classList.remove("hidden");
        activeBlock.classList.add("hidden");
    }
}

// --- MESH NETWORKING SIMULATOR ---

// Sposta il marker GPS e ricalcola il radar dei compagni
function updateRadarPosition(coords) {
    renderRadarScreen(coords);
}

// Disegna lo schermo radar calcolando le distanze in coordinate polari
function renderRadarScreen(userCoords) {
    const radarPeersContainer = document.getElementById("radar-peers");
    if (!radarPeersContainer) return;

    radarPeersContainer.innerHTML = "";

    // Compagni simulati sul sentiero Campo Imperatore (Gran Sasso) con coordinate fisse
    const mockPeers = [
        { id: "user_sofia", name: "Sofia Foto", lat: 42.4433, lng: 13.5575, avatar: "📸" },  // a circa 110m
        { id: "user_luca", name: "Luca Trail", lat: 42.4425, lng: 13.5585, avatar: "🏃" },    // a circa 35m
        { id: "user_giulia", name: "Giulia Esc", lat: 42.4421, lng: 13.5580, avatar: "🥾" }    // a circa 20m
    ];

    mockPeers.forEach(peer => {
        // Calcola distanza in metri
        const distance = calculateDistance(userCoords.lat, userCoords.lng, peer.lat, peer.lng);
        
        // Il radar copre un raggio di 100 metri
        if (distance <= 100) {
            // Calcola l'angolo in radianti (direzione rispetto all'utente)
            const dLat = peer.lat - userCoords.lat;
            const dLng = peer.lng - userCoords.lng;
            const angle = Math.atan2(dLng, dLat); // Angolo polare

            // Calcola posizione x, y nel cerchio radar (diametro 200px, raggio 100px)
            // x = center_x + (distanza_normalizzata * raggio_pixel) * sin(angolo)
            // y = center_y - (distanza_normalizzata * raggio_pixel) * cos(angolo) (y va in giù in CSS)
            const normalizedDist = distance / 100; // da 0 a 1
            const radarRadiusPx = 100;
            
            const x = 100 + (normalizedDist * radarRadiusPx * Math.sin(angle));
            const y = 100 - (normalizedDist * radarRadiusPx * Math.cos(angle));

            const dot = document.createElement("div");
            dot.className = "radar-dot peer-node";
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
            
            dot.setAttribute("title", `${peer.name} (${Math.round(distance)}m)`);
            
            // Aggiunge un tooltip sul radar
            dot.addEventListener("mouseover", () => {
                dot.style.transform = "translate(-50%, -50%) scale(1.5)";
            });
            dot.addEventListener("mouseout", () => {
                dot.style.transform = "translate(-50%, -50%) scale(1)";
            });

            radarPeersContainer.appendChild(dot);
        }
    });
}

// Invia un pacchetto chat/SOS sulla rete mesh locale
function sendMeshChatMessage(isSos) {
    const input = document.getElementById("mesh-input-msg");
    let text = isSos ? "SOS! RICHIESTA ASSISTENZA IMMEDIATA / INCIDENTE SUL SENTIERO!" : input.value;
    
    if (!text && !isSos) return;
    if (input) input.value = "";

    const db = window.CamoscioState;
    const packet = {
        type: "mesh_packet",
        senderId: db.currentUser.id,
        senderName: db.currentUser.username,
        text: text,
        lat: window.userSimulatedLocation.lat,
        lng: window.userSimulatedLocation.lng,
        isSos: isSos,
        timestamp: new Date().toLocaleTimeString()
    };

    // 1. Mostra il mio messaggio localmente
    displayMeshMessage(packet, true);

    // 2. Trasmetti il pacchetto a tutte le schede connesse tramite WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(packet));
    }
}

// Gestione dei pacchetti ricevuti da altri utenti in tempo reale
function handleMeshMessageReceived(packet) {
    if (packet.type === "mesh_packet") {
        // Ricalcola il radar per vedere se l'utente che trasmette è vicino
        const distance = calculateDistance(
            window.userSimulatedLocation.lat,
            window.userSimulatedLocation.lng,
            packet.lat,
            packet.lng
        );

        // La rete mesh offline locale ha raggio massimo di 100m
        if (distance <= 100) {
            displayMeshMessage(packet, false);
        }
    }
}

// Stampa i messaggi mesh a schermo
function displayMeshMessage(packet, isSentByMe) {
    const container = document.getElementById("mesh-messages-log");
    if (!container) return;

    if (container.querySelector(".system")) {
        container.innerHTML = ""; // Pulisce
    }

    const msgDiv = document.createElement("div");
    
    if (packet.isSos) {
        msgDiv.className = "message sos blink";
        msgDiv.innerHTML = `🚨 <strong>[SOS] ${packet.senderName.split(" ")[0]}</strong>: ${packet.text} <span class="small" style="display:block; font-weight:normal; opacity:0.8;">Pos: ${packet.lat.toFixed(5)}, ${packet.lng.toFixed(5)}</span>`;
    } else {
        msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
        msgDiv.innerHTML = `<strong>${packet.senderName.split(" ")[0]}</strong>: ${packet.text} <span class="small" style="font-size:0.6rem; display:block; opacity:0.6; text-align:right;">${packet.timestamp}</span>`;
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// Helper di renderizzazione generale
function renderSafetyModule() {
    updateDashboardSafetyCard();
    renderRadarScreen(window.userSimulatedLocation);
}

// Calcolo distanza (Haversine) locale
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
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

window.initSafetyModule = initSafetyModule;
window.renderSafetyModule = renderSafetyModule;
window.updateRadarPosition = updateRadarPosition;
window.updateDashboardSafetyCard = updateDashboardSafetyCard;
