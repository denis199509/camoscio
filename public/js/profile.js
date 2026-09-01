// Rollout traduzione punto 102: getEligibilityBadge (secondo lotto, 22/08/2026 - il suo
// output compare su ogni card escursione, buildHikeCard in social.js) e, dal TERZO lotto
// (27/08/2026), il Profilo proprio - renderMyProfilePage e i toast di questa pagina.
// La Dashboard e' in app.js; le funzioni condivise identita'/escursioni/preferiti stanno
// in userprofile.js (tradotte nel primo lotto, valgono per entrambe le pagine profilo).
// "var", non "const": vedi la nota in cima a i18n.js sul perche'.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

function initProfileModule() {
    setupProfileCardEvents();
}

// Punto 59: pagina profilo propria, separata dalla Dashboard - stesso principio della
// pagina profilo di un altro utente (public/js/userprofile.js), stessa funzione
// condivisa per intestazione/badge personale/badge guadagnati (CamoscioProfileIdentity).
// A differenza di quella, qui non c'e' nessun fetch: i dati dell'utente collegato e i
// suoi timbri sono gia' tutti in window.CamoscioState da refreshState().
function renderMyProfilePage() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;
    const esc = window.escapeHtml;

    // Titolo di sezione (#section-title): FISSO, non dinamico come #user-profile (che ci
    // scrive lo username). La mappa id->titolo vive in un solo posto - prettyNames in
    // app.js, piu' 'sectionTitle.my-profile' nel dizionario per l'inglese: updateSectionTitle
    // lo rimette a posto da solo anche a ogni cambio lingua, senza un onChange dedicato.
    if (window.CamoscioUpdateSectionTitle) window.CamoscioUpdateSectionTitle("my-profile");

    if (window.CamoscioProfileIdentity) {
        window.CamoscioProfileIdentity.render(usr, window.CamoscioState.stamps, {
            header: document.getElementById("my-profile-header"),
            badgeBox: document.getElementById("my-profile-personal-badge"),
            badgesGrid: document.getElementById("my-profile-badges"),
            expertPeaks: document.getElementById("my-profile-expert-peaks")
        }, window.CamoscioState.peakAscents);
    }

    // V2 UX PASSO 12: #my-profile e' sola vista. Bio in sola lettura (nascosta se vuota),
    // esperto locale = solo lo stato dichiarato, stesso markup di #user-profile-local-expert
    // (userprofile.js). La modifica di entrambi vive in #settings ("Impostazioni").
    const bioView = document.getElementById("my-profile-bio-view");
    if (bioView) {
        bioView.innerHTML = usr.bio
            ? `<p class="profile-bio-text">${esc(usr.bio)}</p>`
            : "";
    }
    const localExpertBox = document.getElementById("my-profile-local-expert");
    if (localExpertBox) {
        localExpertBox.innerHTML = (usr.localExpert && usr.localExpert.active)
            ? `<p class="local-expert-line"><i data-lucide="star"></i> ${esc(T('profile.espertoLocale') || 'Esperto locale')}: <b>${esc(usr.localExpert.area)}</b></p>`
            : "";
    }
    if (window.lucide) window.lucide.createIcons();

    // Punto 74: a differenza dell'identita' qui sopra, le escursioni non sono gia' in
    // CamoscioState (Completion/ActiveHikeSession non ci vivono) - stesso fetch della
    // pagina dell'altro utente, stessa funzione condivisa.
    if (window.CamoscioProfileHikes) {
        window.CamoscioProfileHikes.render(usr.id, document.getElementById("my-profile-hikes"));
    }

    // Punto 80/G: sentieri preferiti, stessa funzione condivisa con la pagina profilo di un
    // altro utente - gia' in CamoscioState, nessun fetch qui.
    if (window.CamoscioProfileBookmarks) {
        window.CamoscioProfileBookmarks.render(usr.id, document.getElementById("my-profile-bookmarks"));
    }
}
window.renderMyProfilePage = renderMyProfilePage;

// V2 UX PASSO 12: pagina "Impostazioni" (#settings). Popola i controlli spostati qui
// da #my-profile (renderProfileCard, in app.js, gli stessi id di prima) e aggancia una
// volta lingua + logout. I gestori "salva" (foto/bio/esperto/password) restano
// agganciati da setupProfileCardEvents (per id, invariati).
function renderSettingsPage() {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    if (window.CamoscioUpdateSectionTitle) window.CamoscioUpdateSectionTitle("settings");
    // renderProfileCard e' un global di app.js (dichiarazione di funzione top-level):
    // popola foto/bio/esperto e nasconde il cambio password ai demo, tutto per id.
    if (typeof renderProfileCard === "function") renderProfileCard(usr);

    // Logout: riusa il pulsante dell'header invece di ripetere la logica. Aggancio
    // unico (dataset) come setupEmailVerifyBanner.
    const btnLogout = document.getElementById("btn-settings-logout");
    if (btnLogout && !btnLogout.dataset.collegato) {
        btnLogout.dataset.collegato = "1";
        btnLogout.addEventListener("click", () => {
            const header = document.getElementById("btn-logout");
            if (header) header.click();
        });
    }
    // Le bandiere in #settings sono gia' agganciate da i18n.js (aggancia TUTTE le
    // .lang-flag-btn del documento) - niente da fare qui.
    if (window.lucide) window.lucide.createIcons();
}
window.renderSettingsPage = renderSettingsPage;

// Foto scelta ma non ancora salvata (punto 40): come registerPhotoDataUrl in auth.js.
let newProfilePhotoDataUrl = null;
// Richiesta di rimozione, non ancora salvata: distinta da "nessuna foto nuova scelta"
// (quel caso non deve mandare il campo, altrimenti il PUT lo tratterebbe come "nessun
// cambiamento" - vedi il commento sopra saveProfilePhotoAndBio). Qui invece l'utente ha
// chiesto esplicitamente di togliere la foto: va mandato profilePhoto:null per davvero.
let removePhotoRequested = false;

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
                window.showToast(T('myProfile.fotoTroppoGrande') || "Foto troppo grande, scegline una più piccola (max ~1.5MB).", "error");
                e.target.value = "";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                newProfilePhotoDataUrl = reader.result;
                removePhotoRequested = false; // scegliere un file nuovo annulla una rimozione appena chiesta
                document.getElementById("profile-photo-preview").innerHTML = `<img src="${reader.result}" alt="Anteprima">`;
            };
            reader.readAsDataURL(file);
        });
    }

    // Rimuovi foto: al posto della foto torna il simbolo montagna gia' usato come
    // avatar di default in tutto il sito (usr.avatar) - nessuna icona nuova da creare.
    // Come la scelta di un file nuovo, resta "in sospeso" finche' non si preme
    // "Salva foto e bio": stesso pulsante, stesso momento di conferma.
    const btnRemovePhoto = document.getElementById("btn-remove-profile-photo");
    if (btnRemovePhoto) {
        btnRemovePhoto.addEventListener("click", () => {
            removePhotoRequested = true;
            newProfilePhotoDataUrl = null;
            const photoInput = document.getElementById("profile-photo-input");
            if (photoInput) photoInput.value = "";
            const usr = window.CamoscioState.currentUser;
            document.getElementById("profile-photo-preview").innerHTML = window.escapeHtml(usr ? usr.avatar : "🏔️");
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
    // Manda la foto SOLO se ne e' stata scelta una nuova, o se e' stata chiesta la
    // rimozione: il PUT ignora i campi assenti dal corpo (vedi SELF_EDITABLE_FIELDS in
    // routes/users.js), quindi senza questo "if" non toccare la foto cancellerebbe
    // comunque quella esistente con "undefined". removePhotoRequested manda null per
    // davvero (accettato lato server, torna al simbolo montagna di default).
    if (newProfilePhotoDataUrl) payload.profilePhoto = newProfilePhotoDataUrl;
    else if (removePhotoRequested) payload.profilePhoto = null;

    try {
        const response = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            newProfilePhotoDataUrl = null;
            removePhotoRequested = false;
            window.showToast(T('myProfile.profiloAggiornato') || "Profilo aggiornato.", "success");
            await refreshState();
            updateHeaderUserWidget();
            // V2 UX PASSO 12: il salvataggio parte da #settings - si ripopolano i suoi
            // controlli; la vista #my-profile si ridisegna da sola alla prossima apertura
            // (triggerSectionRender case "my-profile"), o subito se e' lei l'attiva.
            renderProfileCard(window.CamoscioState.currentUser);
            if (document.getElementById("my-profile") && document.getElementById("my-profile").classList.contains("active")) {
                renderMyProfilePage();
            }
        } else {
            const dati = await response.json();
            window.showToast(dati.error || T('myProfile.erroreSalva') || "Non è stato possibile salvare le modifiche.", "error");
        }
    } catch (e) {
        console.error("Errore nel salvataggio di foto/bio:", e);
        window.showToast(T('common.erroreServer') || "Impossibile contattare il server. Riprova.", "error");
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
        window.showToast(T('myProfile.scriviPwdAttuale') || "Scrivi la tua password attuale.", "error");
        return;
    }
    if (newPassword.length < 8) {
        window.showToast(T('myProfile.pwdMin8') || "La nuova password deve avere almeno 8 caratteri.", "error");
        return;
    }
    if (newPassword !== campoConferma.value) {
        window.showToast(T('myProfile.pwdNonCoincidono') || "Le due nuove password non coincidono.", "error");
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
            window.showToast(dati.error || T('myProfile.errorePwd') || "Non è stato possibile cambiare la password.", "error");
            return;
        }

        // I campi si svuotano SEMPRE dopo un cambio riuscito: lasciare la password nuova
        // scritta in chiaro sullo schermo di una pagina che resta aperta non ha senso.
        campoAttuale.value = "";
        campoNuova.value = "";
        campoConferma.value = "";
        window.showToast(T('myProfile.pwdCambiata') || "Password cambiata. Resti collegato su questo dispositivo.", "success");
    } catch (e) {
        console.error("Errore nel cambio password:", e);
        window.showToast(T('common.erroreServer') || "Impossibile contattare il server. Riprova.", "error");
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
        window.showToast(T('myProfile.indicaZona') || "Indica la zona in cui sei esperto per attivare il layer esperto locale.", "error");
        return;
    }

    try {
        const response = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localExpert: { active, area } })
        });

        if (response.ok) {
            window.showToast(active
                ? (T('myProfile.espertoAttivato') || "Sei ora un esperto locale per questa zona!")
                : (T('myProfile.espertoDisattivato') || "Layer esperto locale disattivato."), "success");

            await refreshState();
            // V2 UX PASSO 12: come per foto/bio - si ripopola #settings; #my-profile
            // (stato dichiarato + cime col livello) si aggiorna alla prossima apertura.
            renderProfileCard(window.CamoscioState.currentUser);
            if (document.getElementById("my-profile") && document.getElementById("my-profile").classList.contains("active")) {
                renderMyProfilePage();
            }
        }
    } catch (e) {
        console.error("Errore nel salvataggio dello stato esperto locale:", e);
    }
}

// Calcolo tempi del sentiero personalizzati in base al passo dell'utente (Pace Calculator)
// La formula di sintesi CAI vera e propria vive ora in public/js/cai-tempi.js (punto 92),
// condivisa col server: prima stava solo qui, ma il server ne ha bisogno per invertirla
// (lib/hikeStats.js:paceUpDaMisura) - un'unica copia, mai due formule che possono divergere.
// IPOTESI DI PARTENZA quando il passo dell'utente non è mai stato misurato: qui un divisore
// serve comunque, quindi il numero si usa - ma il risultato NON va presentato come "sul tuo
// passo" (vedi passoMisurato nel valore di ritorno, e chi lo legge in social.js).
// Deve restare uguale a DEFAULT_PACE_UP di lib/hikeStats.js: è lo stesso numero visto dai due
// lati: là è il server a usarlo per riscalare la discesa, qui è il browser a usarlo come
// stima. Se cambia uno dei due, cambiano entrambi.
const PASSO_SALITA_IPOTESI = 350;

function calculateHikeTimes(hike, user) {
    const dPlus = hike.elevationGain;
    const distance = hike.distanceKm;

    // 1. CALCOLO CAI STANDARD
    const standardTotalHours = window.oreCai(dPlus, distance);

    // 2. CALCOLO PERSONALIZZATO UTENTE
    // Il campo esiste solo se c'è almeno un'osservazione vera dietro (models/User.js): il
    // vecchio "|| 350" non bastava a distinguere i due casi, perché fino al 16/08/2026 il 350
    // era scritto sul documento di ogni utente appena registrato ed era un numero verità.
    const paceUp = Number(user.averagePaceUp);
    const passoMisurato = Number.isFinite(paceUp) && paceUp > 0;

    // Salita calibrata sulla velocità dell'utente, in discesa usiamo il suo passo di discesa
    const customTotalHours = window.oreCai(dPlus, distance, passoMisurato ? paceUp : PASSO_SALITA_IPOTESI);

    return {
        standardText: formatHoursToMin(standardTotalHours),
        // customText c'è sempre (il calcolo non si rompe mai), ma chi lo mostra deve prima
        // guardare passoMisurato: chiamarlo "il tuo passo" senza una misura dietro è la
        // stessa bugia della card "Passo & Fatica" in Dashboard.
        customText: formatHoursToMin(customTotalHours),
        passoMisurato,
        fatigueIndex: (passoMisurato ? (window.PASSO_SALITA_CAI / paceUp).toFixed(2) : null),
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
            text: T('eligibility.idoneo') || "Idoneo (Livello Passo Ok)"
        };
    } else {
        return {
            eligible: false,
            class: "badge-red",
            text: T('eligibility.richiestoPassoSuperiore') || "Richiesto Passo Superiore"
        };
    }
}

window.initProfileModule = initProfileModule;
window.calculateHikeTimes = calculateHikeTimes;
window.formatHoursToMin = formatHoursToMin;
window.getEligibilityBadge = getEligibilityBadge;
