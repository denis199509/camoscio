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

    // A-3.1 (revisione sicurezza 21a): revoca del consenso alla geolocalizzazione.
    renderStatoConsensoGps(usr);

    // A-3.3: export dei propri dati (GDPR).
    const btnExport = document.getElementById("btn-export-my-data");
    if (btnExport && !btnExport.dataset.collegato) {
        btnExport.dataset.collegato = "1";
        btnExport.addEventListener("click", esportaMieiDati);
    }

    // A-3.4: eliminazione account. La card e' nascosta per i demo (condivisi, senza password).
    const cardDelete = document.getElementById("settings-delete-card");
    if (cardDelete) cardDelete.classList.toggle("hidden", !!usr.isDemoAccount);
    const btnDelete = document.getElementById("btn-delete-account");
    if (btnDelete && !btnDelete.dataset.collegato) {
        btnDelete.dataset.collegato = "1";
        btnDelete.addEventListener("click", eliminaMioAccount);
    }

    if (window.lucide) window.lucide.createIcons();
}
window.renderSettingsPage = renderSettingsPage;

// A-3.3: scarica un JSON con tutti i propri dati. Si passa da fetch + blob (non una semplice
// navigazione all'URL) per poter gestire un errore senza lasciare la pagina.
async function esportaMieiDati() {
    const btn = document.getElementById("btn-export-my-data");
    if (!btn) return;
    const etichetta = btn.textContent;
    btn.disabled = true;
    btn.textContent = T('settings.esportaInCorso') || 'Preparo il file…';
    try {
        const res = await fetch('/api/users/me/export');
        if (!res.ok) throw new Error('Export rifiutato: ' + res.status);
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="([^"]+)"/);
        const nome = (m && m[1]) || 'camoscio-dati.json';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        window.showToast(T('settings.esportaFatto') || 'Export scaricato.', 'success');
    } catch (e) {
        console.error('Export dati fallito:', e);
        window.showToast(T('settings.esportaErrore') || "Non sono riuscito a preparare l'export. Riprova.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = etichetta;
    }
}

// A-3.4: eliminazione del proprio account. Chiede la ri-digitazione della password (come
// il cambio password), poi DELETE /api/users/me. Il soft-delete e la chiusura delle
// sessioni li fa il server; qui si mostra solo l'esito e si torna alla porta d'accesso.
async function eliminaMioAccount() {
    const usr = window.CamoscioState && window.CamoscioState.currentUser;
    if (!usr || usr.isDemoAccount) return;

    const pwd = await window.showPasswordModal(
        T('settings.eliminaModaleTesto') || "Scrivi la tua password per eliminare l'account. I tuoi contenuti restano visibili col nome «Account eliminato». Hai 30 giorni per annullare: basta rientrare col login.",
        {
            confirmLabel: T('settings.eliminaBtn') || 'Elimina il mio account',
            cancelLabel: T('common.cancella') || 'Annulla'
        }
    );
    if (pwd === null) return; // annullato
    if (!pwd) {
        window.showToast(T('settings.eliminaScriviPwd') || 'Scrivi la password per confermare.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/users/me', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
        });
        const dati = await res.json().catch(() => ({}));

        if (res.status === 401) {
            window.showToast(T('settings.eliminaPwdErrata') || 'Password non corretta.', 'error');
            return;
        }
        if (res.status === 409 && Array.isArray(dati.escursioni)) {
            const righe = dati.escursioni.map(h => `• ${h.title} (${h.date})`).join('\n');
            await window.showAlertModal(
                (T('settings.eliminaBloccoEscursioni') || "Hai escursioni in programma organizzate da te. Annullale o passale a un altro organizzatore, poi riprova:")
                + '\n\n' + righe
            );
            return;
        }
        if (!res.ok) {
            window.showToast(dati.error || T('settings.eliminaErrore') || "Non è stato possibile eliminare l'account. Riprova.", 'error');
            return;
        }

        mostraSchermataAccountEliminato();
    } catch (e) {
        console.error('Eliminazione account fallita:', e);
        window.showToast(T('common.erroreServer') || 'Impossibile contattare il server. Riprova.', 'error');
    }
}

// Toglie dal DISPOSITIVO i dati che la cache locale conserva sull'utente: su un computer
// condiviso sono esattamente quello che l'eliminazione doveva rimuovere. Le tracce GPS in
// coda (IndexedDB), la zona di partenza da casa, il punto meteo, il conto alla rovescia
// del timer di sicurezza, gli extra dello zaino. NON tocca le preferenze pure di
// interfaccia (lingua, gruppi di menu aperti): non sono dati personali.
function pulisciDatiLocaliDelDispositivo() {
    try { if (window.indexedDB) indexedDB.deleteDatabase('camoscio-tracking'); } catch (e) {}
    try {
        const daTogliere = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k === 'camoscio_punto_meteo' || k === 'deadman_active' || k === 'deadman_timestamp'
                || k.indexOf('home_city_') === 0 || k.indexOf('backpack_') === 0) {
                daTogliere.push(k);
            }
        }
        daTogliere.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}

// Schermata a tutto schermo dopo l'eliminazione: la sessione e' gia' chiusa dal server,
// il tasto "OK" ricarica la pagina -> checkAuthAndShowGate non trova sessione -> porta
// d'accesso, dove rientrare (entro 30 giorni) annulla l'eliminazione.
function mostraSchermataAccountEliminato() {
    if (document.querySelector('.account-deleted-overlay')) return;
    pulisciDatiLocaliDelDispositivo();
    const esc = window.escapeHtml;
    const ov = document.createElement('div');
    ov.className = 'account-deleted-overlay';
    ov.innerHTML = `
        <div class="account-deleted-box">
            <h2>${esc(T('settings.eliminatoTitolo') || 'Account eliminato')}</h2>
            <p>${esc(T('settings.eliminatoTesto') || 'Il tuo account è stato eliminato. Hai 30 giorni per ripensarci: rientra con le tue credenziali per annullare. Dopo, i dati personali verranno cancellati definitivamente.')}</p>
            <button type="button" class="btn btn-primary" id="account-deleted-ok">OK</button>
        </div>`;
    document.body.appendChild(ov);
    document.getElementById('account-deleted-ok').addEventListener('click', () => window.location.reload());
}

// A-3.1: mostra lo stato del consenso GPS e, se e' attivo, il tasto per revocarlo. I demo
// non hanno un consenso vero da gestire (entrano senza registrarsi) - per loro niente tasto.
function renderStatoConsensoGps(usr) {
    const stato = document.getElementById("settings-geo-consent-state");
    const btn = document.getElementById("btn-revoke-geo-consent");
    if (!stato || !btn) return;

    if (usr.isDemoAccount) {
        stato.textContent = T('settings.geoConsentDemo') || "Il consenso alla posizione non si applica agli account demo.";
        btn.classList.add("hidden");
        return;
    }

    if (usr.geolocationConsent) {
        stato.textContent = T('settings.geoConsentDato') || "Hai dato il consenso all'uso della tua posizione.";
        btn.classList.remove("hidden");
    } else {
        stato.textContent = T('settings.geoConsentNon') || "Non hai dato (o hai revocato) il consenso all'uso della posizione: ti verrà richiesto quando servirà.";
        btn.classList.add("hidden");
    }

    if (!btn.dataset.collegato) {
        btn.dataset.collegato = "1";
        btn.addEventListener("click", revocaConsensoGps);
    }
}

async function revocaConsensoGps() {
    const usr = window.CamoscioState && window.CamoscioState.currentUser;
    if (!usr) return;

    // Non si revoca mentre una registrazione GPS e' in corso: perderebbe senso a meta'.
    // Si chiede all'utente di fermarla prima, invece di ucciderla noi (rischio perdita dati).
    if (window.CamoscioTrackingIsRecording && window.CamoscioTrackingIsRecording()) {
        window.showToast(T('settings.geoRevocaTracciamento') || "C'è una registrazione GPS in corso: fermala prima di revocare il consenso.", "error");
        return;
    }

    const procedi = await window.showConfirmModal(
        T('settings.geoRevocaConferma') || "Revocare il consenso all'uso della tua posizione? Le funzioni che ne hanno bisogno (registrazione percorsi, «dove sono», escursioni vicine) te lo richiederanno di nuovo.",
        T('settings.revocaGeo') || 'Revoca il consenso alla posizione',
        { cancelLabel: T('common.cancella') || 'Annulla', danger: true }
    );
    if (!procedi) return;

    try {
        const res = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geolocationConsent: false })
        });
        if (!res.ok) throw new Error('Revoca rifiutata');
        usr.geolocationConsent = false;
        renderStatoConsensoGps(usr);
        // Rimette l'avviso "serve il consenso" nella pagina di tracciamento.
        if (window.toggleGeoConsentAlert) window.toggleGeoConsentAlert();
        window.showToast(T('settings.geoRevocaFatto') || "Consenso revocato. Ricordati di togliere anche il permesso del sito dalle impostazioni del browser, se vuoi bloccarlo del tutto.", "success");
    } catch (e) {
        console.error("Revoca consenso GPS fallita:", e);
        window.showToast(T('settings.geoRevocaErrore') || "Non sono riuscito a revocare il consenso. Riprova.", "error");
    }
}

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

    // ALTO, follow-up revisione sicurezza (30ª): prima si leggeva il file scelto cosi'
    // com'e' (fino a 1.5 MB), stesso identico buco gia' chiuso su Squad.photo. Ora si
    // comprime sempre lato client (imagecompress.js, come le foto squadra/segnalazioni),
    // sempre JPEG - il server (lib/profilePhoto.js) accetta solo quel formato.
    const photoInput = document.getElementById("profile-photo-input");
    if (photoInput) {
        photoInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = window.CamoscioImageCompress
                ? await window.CamoscioImageCompress.comprimi(file)
                : null;
            e.target.value = "";
            if (!dataUrl) {
                window.showToast(T('myProfile.fotoNonElaborata') || "Non è stato possibile elaborare la foto scelta.", "error");
                return;
            }
            newProfilePhotoDataUrl = dataUrl;
            removePhotoRequested = false; // scegliere un file nuovo annulla una rimozione appena chiesta
            document.getElementById("profile-photo-preview").innerHTML = `<img src="${dataUrl}" alt="Anteprima">`;
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
            // MEDIO, follow-up sicurezza: GET /api/users non porta piu' profilePhoto
            // (select:false a schema) - refreshState() da solo non aggiornerebbe piu' la
            // foto appena salvata. La risposta di QUESTA put la contiene ancora, ma SOLO
            // quando il salvataggio tocca davvero la foto (routes/users.js, rilievo M-1 del
            // giro agente: select condizionale, altrimenti ogni PUT pesa fino a ~800 KB).
            // 'profilePhoto' in dati (rilievo M-2), non un truthy/?? check: un salvataggio di
            // sola bio non la tocca, la chiave e' ASSENTE dalla risposta - scriverci sopra
            // "null" cancellerebbe la foto dall'header senza che sul server sia cambiato
            // niente.
            const dati = await response.json().catch(() => null);
            if (dati && window.CamoscioState.currentUser && 'profilePhoto' in dati) {
                window.CamoscioState.currentUser.profilePhoto = dati.profilePhoto ?? null;
            }
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
