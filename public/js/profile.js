function initProfileModule() {
    setupProfileCardEvents();
}

// Collega i pulsanti della card "Il Tuo Profilo" (verifica KYC, esperto locale)
function setupProfileCardEvents() {
    const btnKyc = document.getElementById("btn-trigger-kyc");
    if (btnKyc) {
        btnKyc.addEventListener("click", () => window.triggerKycVerification());
    }

    const btnSaveExpert = document.getElementById("btn-save-local-expert");
    if (btnSaveExpert) {
        btnSaveExpert.addEventListener("click", saveLocalExpertStatus);
    }
}

// Salva lo stato di "esperto locale" (attivo/non attivo + zona) sul profilo dell'utente corrente
async function saveLocalExpertStatus() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    const active = document.getElementById("local-expert-toggle").checked;
    const area = document.getElementById("local-expert-area").value.trim();

    if (active && !area) {
        window.showToast("Indica la zona in cui sei esperto per attivare il layer esperto locale.", "error");
        return;
    }

    try {
        const response = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localExpert: { active, area } })
        });

        if (response.ok) {
            window.showToast(active ? "Sei ora un esperto locale per questa zona!" : "Layer esperto locale disattivato.", "success");

            await refreshState();
            renderDashboard();

            const activeSec = document.querySelector(".page-section.active");
            if (activeSec && activeSec.id === "hikes") {
                window.renderHikesList();
            }
        }
    } catch (e) {
        console.error("Errore nel salvataggio dello stato esperto locale:", e);
    }
}

// Calcolo tempi del sentiero personalizzati in base al passo dell'utente (Pace Calculator)
// Formula CAI Standard:
// - Salita: 400 metri di dislivello all'ora.
// - Discesa: 600 metri all'ora.
// - In piano: 4 km all'ora.
// Formula di sintesi CAI: Max(tempo_dislivello, tempo_sviluppo) + Min(tempo_dislivello, tempo_sviluppo)/2
function calculateHikeTimes(hike, user) {
    const dPlus = hike.elevationGain;
    const distance = hike.distanceKm;
    
    // 1. CALCOLO CAI STANDARD
    const tVertStandard = dPlus / 400; // ore
    const tFlatStandard = distance / 4; // ore
    const standardTotalHours = Math.max(tVertStandard, tFlatStandard) + Math.min(tVertStandard, tFlatStandard) / 2;

    // 2. CALCOLO PERSONALIZZATO UTENTE
    // Salita calibrata sulla velocità dell'utente, in discesa usiamo il suo passo di discesa
    const tVertUpCustom = dPlus / (user.averagePaceUp || 350); 
    const tFlatCustom = distance / 4; 
    const customTotalHours = Math.max(tVertUpCustom, tFlatCustom) + Math.min(tVertUpCustom, tFlatCustom) / 2;

    return {
        standardText: formatHoursToMin(standardTotalHours),
        customText: formatHoursToMin(customTotalHours),
        fatigueIndex: (user.averagePaceUp ? (400 / user.averagePaceUp).toFixed(2) : "1.00"),
        hoursDifference: (customTotalHours - standardTotalHours)
    };
}

// Format ore decimali in stringa leggibile (es: 3.5 ore -> 3h 30m)
function formatHoursToMin(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return `${hours}h ${minutes}m`;
}

// Procedura di Verifica KYC Light (Simulazione SMS)
window.triggerKycVerification = async function() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    if (usr.kycVerified) {
        window.showToast("Il tuo profilo è già verificato!", "info");
        return;
    }

    const phoneNumber = await window.showPromptModal("Inserisci il tuo numero di cellulare per ricevere il codice di sicurezza (KYC Light):", "333-1234567");
    if (!phoneNumber) return;

    // Genera un codice OTP simulato a 4 cifre
    const otpCode = Math.floor(1000 + Math.random() * 9000);

    // Mostra il codice a schermo per simulare la ricezione dell'SMS sul telefono
    await window.showAlertModal(`💬 [SMS Ricevuto al numero ${phoneNumber}]:\nIl tuo codice di verifica Camoscio è: ${otpCode}`, "Continua");

    const userOtp = await window.showPromptModal("Digita il codice di verifica a 4 cifre ricevuto via SMS:");

    if (userOtp === otpCode.toString()) {
        try {
            // Aggiorna sul server
            const response = await fetch(`/api/users/${usr.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kycVerified: true })
            });

            if (response.ok) {
                // Aggiorna lo stato locale
                usr.kycVerified = true;

                window.showToast("Congratulazioni! Il tuo profilo è stato verificato con successo. La spunta blu è ora attiva!", "success");

                // Aggiorna widget superiore e dashboard
                await refreshState();
                updateHeaderUserWidget();

                const activeSec = document.querySelector(".page-section.active");
                if (activeSec && activeSec.id === "dashboard") {
                    renderDashboard();
                } else if (activeSec && activeSec.id === "hikes") {
                    window.renderHikesList();
                }
            }
        } catch(e) {
            console.error("Errore durante il KYC:", e);
        }
    } else {
        window.showToast("Codice errato. Verifica fallita.", "error");
    }
};

// Calcola il badge idoneità escursione in base allo storico
// Se l'utente ha affrontato dislivelli entro il 20% di tolleranza rispetto a quello dell'escursione, ha il badge d'idoneità
function getEligibilityBadge(hike, user) {
    const hikeDPlus = hike.elevationGain;
    
    // Un utente "Esperto" può fare tutto.
    // Un "Intermedio" può fare fino a 1200m D+.
    // Un "Principiante" può fare fino a 700m D+.
    let userMaxDPlus = 600;
    if (user.experienceLevel === "Esperto") userMaxDPlus = 2200;
    else if (user.experienceLevel === "Intermedio") userMaxDPlus = 1200;
    else userMaxDPlus = 700;

    // Aggiungiamo un bonus in base alla sua reputazione (+1% per ogni punto di reputazione sopra 50)
    const repBonusFactor = 1 + (Math.max(0, user.reputation - 50) / 100);
    const adjustedMax = userMaxDPlus * repBonusFactor;

    if (hikeDPlus <= adjustedMax) {
        return {
            eligible: true,
            class: "badge-green",
            text: "Idoneo (Livello Passo Ok)"
        };
    } else {
        return {
            eligible: false,
            class: "badge-red",
            text: "Richiesto Passo Superiore"
        };
    }
}

// Segna un'escursione come completata: aggiorna cronologia, passo personale e livello esperienza
window.markHikeCompleted = async function(hikeId) {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    if (!usr) return;

    const hoursInput = await window.showPromptModal("Quante ore hai impiegato per completare l'escursione? (Lascia vuoto se non lo ricordi con precisione)");
    if (hoursInput === null) return; // Annullato

    const actualTimeHours = hoursInput.trim() ? parseFloat(hoursInput.trim()) : null;
    if (hoursInput.trim() && (isNaN(actualTimeHours) || actualTimeHours <= 0)) {
        window.showToast("Numero di ore non valido.", "error");
        return;
    }

    try {
        const response = await fetch(`/api/hikes/${hikeId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: usr.id, actualTimeHours })
        });

        if (response.ok) {
            window.showToast("Escursione segnata come completata! Il tuo passo e il tuo livello di esperienza sono stati aggiornati.", "success");

            await refreshState();
            updateHeaderUserWidget();

            const activeSec = document.querySelector(".page-section.active");
            if (activeSec && activeSec.id === "hikes") {
                window.renderHikesList();
            } else if (activeSec && activeSec.id === "dashboard") {
                renderDashboard();
            }
        } else {
            const err = await response.json();
            window.showToast(err.error || "Non è stato possibile segnare l'escursione come completata.", "error");
        }
    } catch (e) {
        console.error("Errore nel segnare l'escursione come completata:", e);
    }
};

window.initProfileModule = initProfileModule;
window.calculateHikeTimes = calculateHikeTimes;
window.getEligibilityBadge = getEligibilityBadge;
