function initProfileModule() {
    setupProfileCardEvents();
}

// Foto scelta ma non ancora salvata (punto 40): come registerPhotoDataUrl in auth.js.
let newProfilePhotoDataUrl = null;

// Collega i pulsanti della card "Il Tuo Profilo" (foto, bio, esperto locale, cambio password)
function setupProfileCardEvents() {
    const btnSaveExpert = document.getElementById("btn-save-local-expert");
    if (btnSaveExpert) {
        btnSaveExpert.addEventListener("click", saveLocalExpertStatus);
    }

    const btnChangePassword = document.getElementById("btn-change-password");
    if (btnChangePassword) {
        btnChangePassword.addEventListener("click", changePassword);
    }

    const bioField = document.getElementById("profile-bio");
    if (bioField) {
        bioField.addEventListener("input", () => {
            document.getElementById("profile-bio-counter").textContent = bioField.value.length;
        });
    }

    // Stesso limite e stesso formato (data URL) della foto in registrazione: nessun
    // campo nuovo sul modello, la validazione lato server (MAX_PHOTO_LENGTH) e' gia'
    // pronta da quando "profilePhoto" e' entrato in SELF_EDITABLE_FIELDS.
    const photoInput = document.getElementById("profile-photo-input");
    if (photoInput) {
        photoInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 1.5 * 1024 * 1024) {
                window.showToast("Foto troppo grande, scegline una più piccola (max ~1.5MB).", "error");
                e.target.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                newProfilePhotoDataUrl = reader.result;
                document.getElementById("profile-photo-preview").innerHTML = `<img src="${reader.result}" alt="Anteprima">`;
            };
            reader.readAsDataURL(file);
        });
    }

    const btnSaveProfileInfo = document.getElementById("btn-save-profile-info");
    if (btnSaveProfileInfo) {
        btnSaveProfileInfo.addEventListener("click", saveProfilePhotoAndBio);
    }
}

// Salva foto e bio (punto 40 di cose_da_fare.txt): prima si potevano scrivere solo in
// registrazione, senza nessun modo di tornarci sopra dopo.
async function saveProfilePhotoAndBio() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    const payload = { bio: document.getElementById("profile-bio").value.trim() };
    // Manda la foto SOLO se ne e' stata scelta una nuova: il PUT ignora i campi assenti
    // dal corpo (vedi SELF_EDITABLE_FIELDS in routes/users.js), quindi senza questo "if"
    // non salvare una foto nuova cancellerebbe comunque quella vecchia con "undefined".
    if (newProfilePhotoDataUrl) payload.profilePhoto = newProfilePhotoDataUrl;

    try {
        const response = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            newProfilePhotoDataUrl = null;
            window.showToast("Profilo aggiornato.", "success");
            await refreshState();
            updateHeaderUserWidget();
            renderDashboard();
        } else {
            const dati = await response.json();
            window.showToast(dati.error || "Non è stato possibile salvare le modifiche.", "error");
        }
    } catch (e) {
        console.error("Errore nel salvataggio di foto/bio:", e);
        window.showToast("Impossibile contattare il server. Riprova.", "error");
    }
}

// Cambio password per chi e' gia' dentro (punto 7 di cose_da_fare.txt). Prima di oggi non
// esisteva nessuna schermata per farlo: l'unico modo era fingere di aver dimenticato la
// password e passare dal link via email.
async function changePassword() {
    const campoAttuale = document.getElementById("cp-current");
    const campoNuova = document.getElementById("cp-new");
    const campoConferma = document.getElementById("cp-confirm");
    const bottone = document.getElementById("btn-change-password");

    const currentPassword = campoAttuale.value;
    const newPassword = campoNuova.value;

    if (!currentPassword) {
        window.showToast("Scrivi la tua password attuale.", "error");
        return;
    }
    if (newPassword.length < 8) {
        window.showToast("La nuova password deve avere almeno 8 caratteri.", "error");
        return;
    }
    if (newPassword !== campoConferma.value) {
        window.showToast("Le due nuove password non coincidono.", "error");
        return;
    }

    bottone.disabled = true;
    try {
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const dati = await response.json();

        if (!response.ok) {
            window.showToast(dati.error || "Non è stato possibile cambiare la password.", "error");
            return;
        }

        // I campi si svuotano SEMPRE dopo un cambio riuscito: lasciare la password nuova
        // scritta in chiaro sullo schermo di una pagina che resta aperta non ha senso.
        campoAttuale.value = "";
        campoNuova.value = "";
        campoConferma.value = "";
        window.showToast("Password cambiata. Resti collegato su questo dispositivo.", "success");
    } catch (e) {
        console.error("Errore nel cambio password:", e);
        window.showToast("Impossibile contattare il server. Riprova.", "error");
    } finally {
        bottone.disabled = false;
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
