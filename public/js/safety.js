let safetyTimerInterval = null;
let deadManActive = false;
let returnTimestamp = 0;
let socket = null;

function initSafetyModule() {
    // Inizializza WebSocket per il Mesh Network Simulator
    initMeshWebSocket();

    // Punto 21 - PRIMA di ripristinare lo stato: il contatto non e' piu' una stringa scritta
    // a mano in localStorage ma una scelta fra i contatti veri dell'utente, e restoreDeadManState
    // deve trovare l'elenco gia' pronto per poter riselezionare quello di prima.
    popolaContattiEmergenza();

    // Ripristina lo stato del Dead Man's Switch da LocalStorage se attivo
    restoreDeadManState();

    // Event listeners
    setupSafetyEvents();
}

function setupSafetyEvents() {
    const btnActivate = document.getElementById("btn-activate-switch");
    const btnDeactivate = document.getElementById("btn-deactivate-switch");
    const btnBannerCheckin = document.getElementById("btn-banner-checkin");

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

    // Punto 20 - il tasto SOS verso il 112, sulla mappa.
    const btnSos = document.getElementById("btn-sos-112");
    if (btnSos) btnSos.addEventListener("click", chiamaSos);

    // Punto 21 - scelta del contatto e aggiunta di uno nuovo.
    const selContatto = document.getElementById("safety-contact");
    if (selContatto) selContatto.addEventListener("change", aggiornaHintContatto);

    const btnMostraForm = document.getElementById("btn-toggle-add-contact");
    if (btnMostraForm) {
        btnMostraForm.addEventListener("click", () => {
            const form = document.getElementById("safety-add-contact");
            if (form) mostraFormContatto(form.classList.contains("hidden"));
        });
    }

    const btnSalvaContatto = document.getElementById("btn-save-emergency-contact");
    if (btnSalvaContatto) btnSalvaContatto.addEventListener("click", salvaNuovoContatto);

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

// --- PUNTO 20: CHIAMATA AL 112 ---
//
// Quello che una pagina web puo' fare e' UNA cosa sola: aprire il telefono col numero gia'
// composto. Non puo' chiamare da sola, non puo' usare il satellite, non puo' mandare la
// posizione a nessuno. Il valore aggiunto sta tutto nel passaggio prima: chi chiama il 112
// dalla montagna quasi mai sa dire DOVE si trova, ed e' la prima cosa che gli chiedono.
// Per questo la finestra mostra le coordinate da leggere ad alta voce.
// Fa anche da conferma contro il tocco per sbaglio - che e' la ragione per cui l'utente
// ha chiesto di tenere questo tasto lontano da quello di fine escursione.
async function chiamaSos() {
    const righe = ["Stai per chiamare il 112, il numero unico di emergenza.", ""];

    // La posizione VERA del GPS (punto 26), non il segnaposto trascinabile: leggere al
    // centralino delle coordinate simulate sarebbe peggio che non darne affatto.
    const p = window.CamoscioGeo && window.CamoscioGeo.ultimaPosizione();
    if (p) {
        righe.push("LEGGI QUESTE COORDINATE ALL'OPERATORE:");
        righe.push(`${p.lat.toFixed(5)}   ${p.lng.toFixed(5)}`);
        righe.push(`(rilevata ${daQuantoInParole(p.quando)}, precisa entro ${Math.round(p.precisioneM || 0)} metri)`);
    } else {
        righe.push("NON HO LA TUA POSIZIONE.");
        righe.push("Se hai un momento: chiudi, premi «Dove sono» in alto a destra sulla mappa e riprova. Sapere dove sei è la prima cosa che ti chiederanno.");
        righe.push("Se non c'è tempo, chiama lo stesso e descrivi a voce dove ti trovi.");
    }

    righe.push("");
    // Detto esplicitamente per non promettere quello che il sito non puo' garantire: e' la
    // nota tecnica scritta nel punto 20 di cose_da_fare.txt.
    righe.push("Il sito apre solo il telefono col numero pronto: la chiamata la fai tu. Se non c'è campo e il tuo telefono ha l'SOS satellitare, sarà il telefono a usarlo — non questo sito.");

    const procedi = await window.showConfirmModal(righe.join("\n"), "Chiama 112");
    if (procedi) window.location.href = "tel:112";
}

function daQuantoInParole(quando) {
    const secondi = Math.max(0, Math.round((Date.now() - (quando || 0)) / 1000));
    if (secondi < 60) return "adesso";
    const minuti = Math.round(secondi / 60);
    if (minuti < 60) return `${minuti} minut${minuti === 1 ? 'o' : 'i'} fa`;
    const ore = Math.round(minuti / 60);
    return `${ore} or${ore === 1 ? 'a' : 'e'} fa`;
}

// --- PUNTO 21: I CONTATTI DI EMERGENZA VERI ---
//
// Prima il contatto era una casella di testo libera con dentro un numero di esempio scritto
// a mano nell'HTML, e finiva in localStorage: valeva solo su quel browser, e non aveva
// NESSUN rapporto con i contatti di emergenza che l'utente inserisce obbligatoriamente in
// registrazione e che stanno gia' sul database (Fase C). Due dati per la stessa cosa, di cui
// quello usato davvero era il piu' fragile.

function contattiUtente() {
    const u = window.CamoscioState && window.CamoscioState.currentUser;
    return (u && Array.isArray(u.emergencyContacts)) ? u.emergencyContacts : [];
}

function contattoScelto() {
    const sel = document.getElementById("safety-contact");
    if (!sel || sel.value === "") return null;
    return contattiUtente()[Number(sel.value)] || null;
}

function mostraFormContatto(mostra) {
    const form = document.getElementById("safety-add-contact");
    const btn = document.getElementById("btn-toggle-add-contact");
    if (!form) return;
    form.classList.toggle("hidden", !mostra);
    if (btn) btn.classList.toggle("hidden", mostra);
}

function aggiornaHintContatto() {
    const hint = document.getElementById("safety-contact-hint");
    if (!hint) return;
    const c = contattoScelto();
    // textContent, mai innerHTML: nome ed email li scrive l'utente (regola della Fase H).
    // Punto 37: l'email, non il telefono - e' il canale vero dell'allarme automatico. Dal
    // 16/08/2026 il telefono non si chiede piu' affatto (richiesta di Denis): resta salvato
    // solo sui contatti inseriti prima di allora, e nessuna funzione del sito lo compone -
    // il tasto SOS chiama il 112, mai il contatto personale (vedi chiamaSos qui sopra).
    hint.textContent = c
        ? `Alla scadenza l'allarme andrebbe all'email di ${c.name} (${c.email}).`
        : "";
}

function popolaContattiEmergenza() {
    const sel = document.getElementById("safety-contact");
    if (!sel) return;

    const btnAttiva = document.getElementById("btn-activate-switch");
    const hint = document.getElementById("safety-contact-hint");
    const contatti = contattiUtente();
    const sceltaPrecedente = sel.value;

    sel.innerHTML = "";

    if (!contatti.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Nessun contatto salvato";
        sel.appendChild(opt);
        sel.disabled = true;
        if (btnAttiva) btnAttiva.disabled = true;
        if (hint) {
            hint.textContent = "Non hai nessun contatto di emergenza: senza, il timer non avrebbe nessuno da avvisare. Aggiungine uno qui sotto.";
        }
        mostraFormContatto(true);
        return;
    }

    // Punto 37: un contatto senza email non puo' ricevere l'allarme vero (l'email e' il
    // canale scelto) - capita solo ai contatti salvati prima di questo punto, dato che il
    // form ora la richiede sempre. Resta in contattiUtente() (serve intatto altrove, es. per
    // non perderlo mandando l'array completo al server) ma qui non e' selezionabile: mostrarlo
    // come scelta possibile prometterebbe un allarme che non puo' partire (vincolo hard 7).
    const usabili = contatti.filter(c => c && c.email);
    if (!usabili.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Nessun contatto con email";
        sel.appendChild(opt);
        sel.disabled = true;
        if (btnAttiva) btnAttiva.disabled = true;
        if (hint) {
            hint.textContent = "I tuoi contatti salvati non hanno un'email, serve per mandare l'allarme vero: aggiungine uno nuovo qui sotto.";
        }
        mostraFormContatto(true);
        return;
    }

    sel.disabled = false;
    if (btnAttiva) btnAttiva.disabled = false;
    contatti.forEach((c, i) => {
        if (!c || !c.email) return;
        const opt = document.createElement("option");
        opt.value = String(i); // indice VERO nell'array completo, non nella lista filtrata
        opt.textContent = `${c.name} (${c.relationship})`;
        sel.appendChild(opt);
    });

    // Conserva la scelta precedente se e' ancora valida: popolaContattiEmergenza() viene
    // richiamata anche dopo aver aggiunto un contatto, e non deve far ricominciare da capo.
    const precedente = contatti[Number(sceltaPrecedente)];
    if (sceltaPrecedente !== "" && precedente && precedente.email) {
        sel.value = sceltaPrecedente;
    }
    mostraFormContatto(false);
    aggiornaHintContatto();
}

async function salvaNuovoContatto() {
    const nome = document.getElementById("safety-new-name").value.trim();
    const relazione = document.getElementById("safety-new-rel").value.trim();
    const email = document.getElementById("safety-new-email").value.trim();

    // Nome e relazione sono obbligatori anche nello schema del database
    // (emergencyContactSchema): se mancasse uno il server rifiuterebbe l'intero salvataggio.
    // Il telefono non si chiede piu' dal 16/08/2026 (richiesta di Denis) e lo schema non lo
    // pretende piu'; il campo esiste ancora solo per non perdere i numeri gia' salvati.
    // L'email (punto 37, canale dell'allarme vero) NON e' obbligatoria a livello di schema -
    // altrimenti un contatto vecchio senza email dentro lo stesso array bloccherebbe questo
    // salvataggio - ma lo e' qui: senza, il contatto verrebbe salvato e basta comparire nel
    // menu "Chi avvisare" senza poter mai ricevere nulla (vedi popolaContattiEmergenza).
    if (!nome || !relazione || !email) {
        window.showToast("Servono tutti e tre i campi: nome, chi è ed email.", "error");
        return;
    }
    if (!email.includes('@')) {
        window.showToast("L'email non sembra valida.", "error");
        return;
    }

    const usr = window.CamoscioState && window.CamoscioState.currentUser;
    if (!usr) return;

    const btn = document.getElementById("btn-save-emergency-contact");
    const etichetta = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Salvataggio…";

    // Si manda l'elenco COMPLETO e non solo il nuovo: emergencyContacts e' un array e il
    // server lo sostituisce per intero (SELF_EDITABLE_FIELDS in routes/users.js). Mandare
    // solo l'ultimo cancellerebbe gli altri.
    const nuovi = contattiUtente().concat([{ name: nome, relationship: relazione, email }]);

    try {
        const res = await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emergencyContacts: nuovi })
        });
        if (!res.ok) throw new Error('Salvataggio rifiutato');

        usr.emergencyContacts = nuovi;
        document.getElementById("safety-new-name").value = "";
        document.getElementById("safety-new-rel").value = "";
        document.getElementById("safety-new-email").value = "";
        popolaContattiEmergenza();
        // Si sceglie da solo quello appena aggiunto: e' quasi sempre quello che si voleva.
        const sel = document.getElementById("safety-contact");
        sel.value = String(nuovi.length - 1);
        aggiornaHintContatto();
        window.showToast("Contatto di emergenza salvato.", "success");
    } catch (e) {
        console.error("Salvataggio contatto di emergenza fallito:", e);
        window.showToast("Non sono riuscito a salvare il contatto. Riprova.", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = etichetta;
    }
}

// --- DEAD MAN'S SWITCH LOGIC ---

// Punto 37: prova ad armare il conto alla rovescia anche sul server, l'unico che puo'
// farlo scattare davvero a pagina chiusa. Non blocca mai l'uso locale (si e' in montagna,
// magari senza linea proprio nel momento in cui si attiva): se fallisce il timer VISIBILE
// funziona comunque come prima, ma senza la rete di sicurezza vera - va detto a schermo,
// non taciuto (vincolo hard 7).
async function attivaSulServer(targetTimeMs, contactIndex) {
    try {
        const res = await fetch('/api/safety/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expiresAt: new Date(targetTimeMs).toISOString(),
                contactIndex: Number(contactIndex)
            })
        });
        return res.ok;
    } catch (e) {
        console.error("Attivazione Dead Man's Switch sul server fallita:", e);
        return false;
    }
}

async function disattivaSulServer() {
    try {
        const res = await fetch('/api/safety/deactivate', { method: 'POST' });
        return res.ok;
    } catch (e) {
        console.error("Disattivazione Dead Man's Switch sul server fallita:", e);
        return false;
    }
}

async function activateDeadManSwitch() {
    const contatto = contattoScelto();
    if (!contatto) {
        window.showToast("Scegli chi avvisare prima di attivare il timer.", "error");
        return;
    }
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

    const contactIndex = document.getElementById("safety-contact").value;
    const armatoSulServer = await attivaSulServer(targetTimeMs, contactIndex);

    deadManActive = true;
    returnTimestamp = targetTimeMs;

    // Salva lo stato in local storage.
    // PUNTO 21 - qui finiva il NUMERO DI TELEFONO del contatto, copiato per intero. Ora si
    // salva solo la POSIZIONE nell'elenco: il dato vero sta sul database e si rilegge da li'.
    // Meno copie di un numero di telefono altrui in giro, e soprattutto una sola copia da
    // tenere aggiornata - correggendo il contatto nel profilo, il timer gia' attivo usera'
    // il numero nuovo invece di uno vecchio congelato al momento dell'attivazione.
    localStorage.setItem("deadman_active", "true");
    localStorage.setItem("deadman_timestamp", returnTimestamp.toString());
    localStorage.setItem("deadman_contact_index", contactIndex);
    localStorage.removeItem("deadman_contact"); // vecchia chiave col numero dentro: si toglie

    aggiornaStatoTimer();

    // Registra evento sul log satellitare simulato
    logSimulatedSms("SYSTEM", `Timer attivato. Rientro atteso: ${new Date(returnTimestamp).toLocaleTimeString()}. Da avvisare: ${escapeHtml(contatto.name)}.`);

    if (!armatoSulServer) {
        window.showToast(
            "Il timer è attivo su questo telefono, ma non sono riuscito ad avvisarne il server: " +
            "se chiudi la pagina l'allarme automatico potrebbe non partire. Riprova quando hai linea.",
            "error"
        );
    }

    startSafetyCountdown();
    aggiornaStatoTimer();
}

async function deactivateDeadManSwitch(isSafeCheckin) {
    // Il check-in VERO deve raggiungere il server: e' l'unico modo per fermare l'allarme che
    // altrimenti partirebbe comunque alla scadenza (vedi routes/safety.js). Se la chiamata
    // fallisce non si spegne lo stato locale - il tasto resta li' per poter riprovare, invece
    // di far credere disattivato un timer che sul server e' ancora armato.
    // Quando isSafeCheckin e' false (chiamata da triggerEmergencyAlarm: il timer locale e'
    // gia' scaduto) non si tocca il server per niente - non e' un check-in, e' solo la
    // pulizia dello stato visivo dopo che l'allarme e' gia' scattato (o sta per scattare al
    // prossimo giro del controllo esterno).
    if (isSafeCheckin) {
        const ok = await disattivaSulServer();
        if (!ok) {
            window.showAlertModal(
                "Non sono riuscito ad avvisare il server che sei al sicuro. Il tuo contatto di " +
                "emergenza potrebbe ricevere comunque un avviso quando scade il tempo. Riprova " +
                "appena hai linea, oppure avvisalo/a direttamente tu."
            );
            return;
        }
    }

    deadManActive = false;
    returnTimestamp = 0;

    clearInterval(safetyTimerInterval);

    // Cancella local storage
    localStorage.removeItem("deadman_active");
    localStorage.removeItem("deadman_timestamp");
    localStorage.removeItem("deadman_contact_index");

    aggiornaStatoTimer();

    if (isSafeCheckin) {
        logSimulatedSms("SAFE", `Check-in completato con successo. Dispositivo disattivato. Stazione Sicura.`);
    }

    aggiornaStatoTimer();
}

function restoreDeadManState() {
    // Il server (currentUser.deadMan*, gia' dentro /api/auth/me) e' la fonte di verita': e'
    // l'unico a contare mentre la pagina resta chiusa. Se dice che il timer e' attivo ci si
    // fida anche se questo browser non lo sapeva ancora (es. primo accesso da un telefono
    // diverso mentre il timer corre gia'), riallineando prima localStorage cosi' il resto
    // della funzione non cambia.
    const utente = window.CamoscioState && window.CamoscioState.currentUser;
    if (utente && utente.deadManActive && utente.deadManExpiresAt) {
        localStorage.setItem("deadman_active", "true");
        localStorage.setItem("deadman_timestamp", new Date(utente.deadManExpiresAt).getTime().toString());
        if (utente.deadManContactIndex !== undefined && utente.deadManContactIndex !== null) {
            localStorage.setItem("deadman_contact_index", String(utente.deadManContactIndex));
        }
    }

    const isActive = localStorage.getItem("deadman_active") === "true";
    const ts = parseInt(localStorage.getItem("deadman_timestamp")) || 0;
    const indiceContatto = localStorage.getItem("deadman_contact_index");

    if (isActive && ts > Date.now()) {
        deadManActive = true;
        returnTimestamp = ts;
        // Riseleziona il contatto scelto all'attivazione. Se nel frattempo e' stato tolto
        // dal profilo, l'elenco non ha piu' quella posizione e resta selezionato il primo:
        // meglio avvisare qualcuno che nessuno.
        const sel = document.getElementById("safety-contact");
        if (sel && indiceContatto !== null && contattiUtente()[Number(indiceContatto)]) {
            sel.value = indiceContatto;
        }
        aggiornaHintContatto();

        aggiornaStatoTimer();
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
            
            const contatore = document.getElementById("safety-countdown");
            if (contatore) contatore.textContent = timeStr;
        }
    }, 1000);
}

// Scadenza del timer.
function triggerEmergencyAlarm() {
    // Punto 21 - il contatto si rilegge dal database attraverso l'indice salvato, non da una
    // stringa congelata in localStorage.
    const indice = localStorage.getItem("deadman_contact_index");
    const contatto = contattiUtente()[Number(indice)] || null;
    // Il telefono non si chiede piu' dai form (16/08/2026): un contatto salvato da allora ha
    // solo nome/relazione/email, uno piu' vecchio puo' ancora avere un numero. Senza questo
    // controllo qui si leggerebbe "Anna (undefined)" a schermo. Si mostra il recapito che
    // c'e' davvero - il numero se salvato, altrimenti l'email - e se non c'e' nessuno dei
    // due solo il nome, invece di una parentesi vuota.
    const recapito = contatto ? (contatto.phone || contatto.email || "") : "";
    const aChi = contatto
        ? (recapito ? `${contatto.name} (${recapito})` : contatto.name)
        : "nessun contatto salvato";

    // Punto 21 - la posizione VERA del GPS quando c'e' (punto 26). Prima si usava sempre e
    // solo il segnaposto trascinabile, che di norma e' fermo a Campo Imperatore: un allarme
    // con dentro una posizione inventata e' peggio di un allarme senza posizione, perche'
    // manderebbe a cercare qualcuno nel posto sbagliato.
    const p = window.CamoscioGeo && window.CamoscioGeo.ultimaPosizione();
    const posizione = p
        ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (rilevata ${daQuantoInParole(p.quando)})`
        : "sconosciuta - il GPS non ha mai dato una posizione";

    const msg = `L'escursionista non è rientrato entro l'ora prevista. Ultima posizione nota: ${posizione}.`;

    logSimulatedSms("SOS", `A: ${escapeHtml(aChi)} - MSG: ${escapeHtml(msg)}`);

    // Notifica visiva forte, persistente finché non viene riconosciuta (non un toast auto-dismiss:
    // un allarme di emergenza non deve poter passare inosservato).
    // QUESTA FINESTRA E' SOLO LOCALE, NON MANDA NIENTE DA SOLA: dal punto 37 (08/08/2026) l'invio
    // vero lo fa il server (routes/safety.js, controlla-scadenze), chiamato da un trigger esterno
    // ogni 5 minuti indipendentemente da questa pagina - verificato dal vivo lo stesso giorno.
    // Prima di allora questa finestra diceva "SMS Satellitare inviato a...", che era falso: nessun
    // messaggio partiva mai. Ora e' vero, ma non e' QUESTA funzione a farlo partire - dirlo bene
    // evita di far credere che chiudere questa finestra fermi (o non fermi) l'allarme reale.
    window.showAlertModal(
        `⏰ IL TEMPO È SCADUTO\n\n${msg}\n\n` +
        `Avresti dovuto avvisare: ${aChi}\n\n` +
        `Questo avviso su schermo non manda niente da solo: è solo qui, su questo telefono. ` +
        `L'invio vero lo fa il server, entro pochi minuti e indipendentemente da questa pagina. ` +
        `Se sei tu a leggerlo e stai bene, fai il check-in subito per fermarlo. Se stai leggendo ` +
        `questo per conto di qualcun altro, avvisa tu il contatto qui sopra.`
    );

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

// Punto 17 - unico posto che accende e spegne i comandi del timer. Prima le stesse tre
// righe erano ripetute in attivazione, disattivazione e ripristino: tre copie della stessa
// verita', ed e' il genere di duplicazione che prima o poi si disallinea (era gia' successo
// col riquadro in Dashboard, che restava "attivo" dopo un check-in fatto da un'altra
// schermata). Prende lo stato da deadManActive e basta.
function aggiornaStatoTimer() {
    const btnAttiva = document.getElementById("btn-activate-switch");
    const btnDisattiva = document.getElementById("btn-deactivate-switch");
    const banner = document.getElementById("emergency-banner");
    const contatore = document.getElementById("safety-countdown");
    if (!btnAttiva || !btnDisattiva) return;

    btnAttiva.classList.toggle("hidden", deadManActive);
    btnDisattiva.classList.toggle("hidden", !deadManActive);
    if (banner) banner.classList.toggle("hidden", !deadManActive);
    if (contatore) contatore.classList.toggle("hidden", !deadManActive);

    // Mentre il timer corre non si cambia chi avvisare: sarebbe una modifica che non ha
    // effetto sul conto alla rovescia gia' partito, e farebbe credere il contrario.
    const sel = document.getElementById("safety-contact");
    if (sel) sel.disabled = deadManActive || !contattiUtente().length;
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

    // Un pacchetto mesh arriva da un altro client via WebSocket (vedi initMeshWebSocket):
    // va trattato come dato non fidato ed escapato prima di finire in innerHTML, altrimenti
    // chiunque potrebbe eseguire script arbitrario nel browser di chi legge semplicemente
    // scrivendo HTML nel campo testo/nome (vedi caccia ai bug Fase H).
    const senderFirstName = escapeHtml(typeof packet.senderName === 'string' ? packet.senderName.split(" ")[0] : 'Sconosciuto');
    const text = escapeHtml(typeof packet.text === 'string' ? packet.text : '');

    if (packet.isSos) {
        msgDiv.className = "message sos blink";
        msgDiv.innerHTML = `🚨 <strong>[SOS] ${senderFirstName}</strong>: ${text} <span class="small" style="display:block; font-weight:normal; opacity:0.8;">Pos: ${packet.lat.toFixed(5)}, ${packet.lng.toFixed(5)}</span>`;
    } else {
        msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
        msgDiv.innerHTML = `<strong>${senderFirstName}</strong>: ${text} <span class="small" style="font-size:0.6rem; display:block; opacity:0.6; text-align:right;">${escapeHtml(typeof packet.timestamp === 'string' ? packet.timestamp : '')}</span>`;
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// Helper di renderizzazione generale
function renderSafetyModule() {
    aggiornaStatoTimer();
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
window.aggiornaStatoTimer = aggiornaStatoTimer;
