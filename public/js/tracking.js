// Fase F - Tracciamento GPS live durante l'escursione.
//
// Principi seguiti (vedi cose_da_fare.txt / cronologia.txt):
// - watchPosition continuo, mai un singolo getCurrentPosition.
// - I punti GPS si mettono SEMPRE in coda in IndexedDB per primi (sopravvivono a un
//   crash/chiusura del tab) e si inviano al server a GRUPPI ogni ~25s o al ritorno del
//   segnale, mai uno alla volta - se l'invio fallisce restano in coda e si ritenta da soli.
// - La mappa NON si riscarica mai durante l'escursione (vedi public/js/offline-map.js):
//   va scaricata prima, quando c'e' ancora campo.
// - Pensato apposta per essere comodo su schermo piccolo (telefono in montagna): un
//   pulsante flottante sempre raggiungibile + un pannello con numeri grandi, indipendenti
//   dalla sidebar non responsive del resto dell'app.

// Rollout traduzione punto 102 (lotto Mappa, area 4: Tracciamento GPS + mappa offline).
// var, non const: questo file non e' avvolto in una IIFE e "const T" in un secondo
// <script> classico da' SyntaxError (vedi 07-Trappole-Tecniche.md). Ogni file assegna
// sempre lo stesso valore, e' idempotente.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Virgola in italiano, punto in inglese, come decimaleMeteo (area 3) / formattaEuro
// (sesto lotto). Nome proprio perche' tracking.js non e' in una IIFE. Prima distanza e
// velocita' erano toFixed(2)/toFixed(1) fissi col punto anche in italiano.
function numTracc(n, cifre) {
    const s = n.toFixed(cifre);
    return (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? s : s.replace('.', ',');
}

// Stato dei due badge (sync / qualita' GPS) e ultima sessione del riepilogo: servono
// all'onChange in fondo al file per ridisegnarli nella lingua nuova senza rifare fetch
// (setSyncBadge e renderSummary partono da un argomento).
let ultimoStatoSync = null;
let ultimaSessioneRiepilogo;

const trackingState = {
    sessionId: null,
    hikeId: null,
    startedAtMs: null,
    status: 'idle', // idle | active | paused | ended
    watchId: null,
    flushTimer: null,
    uiTimer: null,
    lastAccuracy: null,
    distanceKm: 0,
    elevationGainM: 0,
    durationSeconds: 0,
    avgSpeedKmh: 0,
    // Tempo gia' maturato (dal server o da un pausa/ripresa precedente) + il momento in cui
    // e' ripartito il conteggio "adesso": separati apposta per poter congelare l'orologio
    // durante una pausa senza perdere il totale precedente.
    baselineSeconds: 0,
    activeResumedAtMs: null
};

let lastLocalPoint = null;
let isFlushInProgress = false;

// Fase G - Sentieri conosciuti vicini alla zona dell'escursione (coordinate complete),
// scaricati UNA VOLTA al primo fix GPS della sessione (non l'intero database regionale:
// il telefono deve restare leggero) e usati solo per un aggancio "veloce e approssimato"
// del puntino mostrato sulla mappa, in attesa della correzione autorevole del server ad
// ogni sincronizzazione (vedi flushPendingPoints). null = non ancora richiesti.
let nearbyTrailSegments = null;

// --- Specchio locale della sessione (sopravvive a un ricaricamento di pagina) ---
//
// Punto 94/passo 6 - trovato il 19/08/2026 con una camminata vera in produzione: la pagina
// dentro l'app puo' ricaricarsi da sola a schermo spento (Android libera memoria del
// WebView senza uccidere ne' l'app ne' il servizio GPS nativo - vedi 07-Trappole-Tecniche
// nel vault), e checkForResumableSession() normalmente si riprende chiedendo al server
// "c'e' una sessione aperta?". Ma se in quel momento non c'e' rete (frequente in montagna,
// non un'eccezione), quella domanda non ha risposta: senza una copia locale, la
// registrazione resterebbe persa fino al ritorno del segnale - proprio il caso per cui
// serve un'app che tracci anche senza campo. Qui si salva SOLO l'identita' della sessione,
// mai i punti (quelli sono gia' in IndexedDB, gia' per sessionId - vedi idb.js).
const CHIAVE_SPECCHIO_LOCALE = 'camoscio.tracciamento';

function salvaSpecchioLocale() {
    try {
        localStorage.setItem(CHIAVE_SPECCHIO_LOCALE, JSON.stringify({
            sessionId: trackingState.sessionId,
            hikeId: trackingState.hikeId,
            startedAtMs: trackingState.startedAtMs,
            status: trackingState.status
        }));
    } catch (e) {
        console.error("Impossibile salvare lo specchio locale del tracciamento:", e);
    }
}

function leggiSpecchioLocale() {
    try {
        const raw = localStorage.getItem(CHIAVE_SPECCHIO_LOCALE);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function pulisciSpecchioLocale() {
    try { localStorage.removeItem(CHIAVE_SPECCHIO_LOCALE); } catch (e) { /* niente da fare */ }
}

// --- Ciclo di vita della sessione ---

function applySessionState(session) {
    trackingState.sessionId = session.id;
    trackingState.hikeId = session.hikeId || null;
    trackingState.startedAtMs = new Date(session.startedAt).getTime();
    trackingState.status = session.status;
    trackingState.distanceKm = session.distanceKm || 0;
    trackingState.elevationGainM = session.elevationGainM || 0;
    trackingState.baselineSeconds = session.durationSeconds || 0;
    trackingState.activeResumedAtMs = session.status === 'active' ? Date.now() : null;
    resetLocalStats();
    nearbyTrailSegments = null; // ogni escursione puo' essere in una zona diversa, si riscarica da capo
    salvaSpecchioLocale();
}

async function startTracking() {
    if (!navigator.geolocation) {
        window.showToast(T('track.noGeoBrowser') || "Il tuo browser non supporta la geolocalizzazione: impossibile registrare il percorso reale.", "error");
        return;
    }

    // Il consenso scelto in registrazione (Fase C) e il suo salvataggio stanno ora in un
    // punto solo, geolocation.js: da quando esiste anche il puntino blu (punto 26) la stessa
    // richiesta parte da due posti diversi, e due copie sarebbero finite per divergere.
    if (window.CamoscioGeo) {
        const ok = await window.CamoscioGeo.assicuraConsenso(
            T('track.consensoTracciamento') || "Per registrare il percorso GPS dell'escursione serve la posizione reale del telefono. Avevi lasciato il consenso alla geolocalizzazione disattivato in registrazione: vuoi attivarlo ora e continuare?"
        );
        if (!ok) return;
    }

    const hikeSelect = document.getElementById('tracking-hike-select');
    const hikeId = hikeSelect && hikeSelect.value ? hikeSelect.value : null;
    const btnStart = document.getElementById('btn-tracking-start');
    if (btnStart) btnStart.disabled = true;

    try {
        const res = await fetch('/api/tracking/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hikeId })
        });
        if (!res.ok) throw new Error('Richiesta fallita');
        const session = await res.json();

        applySessionState(session);
        if (window.resetLiveTrackPolyline) window.resetLiveTrackPolyline();
        // Punto 11: porta la mappa sulla posizione reale a zoom da camminata e falla
        // seguire. Senza questo la mappa resta a zoom 9, dove un'ora di cammino si
        // sposta di pochi pixel e il segnaposto sembra bloccato.
        if (window.beginLiveGpsView) window.beginLiveGpsView();
        // Punto 94/passo 5 - atteso apposta: sul ramo nativo beginWatchingPosition() ora
        // puo' fallire davvero (permesso negato), a differenza del ramo browser che
        // "riesce" sempre a registrarsi qui (l'eventuale rifiuto arriva dopo, in modo
        // asincrono, via onPositionError). Senza questo await il messaggio di successo
        // compariva ANCHE quando il GPS nativo falliva un attimo dopo - bug trovato da
        // Denis provando il passo 5 dal vivo (negava il permesso e vedeva comunque
        // "avviato", col segnaposto fermo sull'ultima posizione nota).
        const gpsAvviato = await beginWatchingPosition();
        if (gpsAvviato === false) {
            // Punto 94/passo 5 - trovato da Denis provando dal vivo: senza questo, la sessione
            // creata pochi istanti prima da /start restava "attiva" sul server (il tasto
            // diceva "Termina registrazione" nonostante il messaggio onesto appena mostrato
            // da beginWatchingPositionNative() dicesse il contrario) - qui si chiude e si
            // cancella subito quella sessione fantasma, invece di lasciarla a zero punti
            // finche' qualcuno non la termina a mano e si ritrova un riepilogo che non
            // riepiloga nulla.
            await annullaTracciamentoNonPartito();
            return;
        }
        startUiTimer();
        startFlushTimer();
        renderTrackingUi();
        updateMapRecordButton();
        avviaPromemoriaTracciamento();
        window.showToast(T('track.avviato') || "Tracciamento GPS avviato: buona escursione! 🥾", "success");
    } catch (e) {
        console.error("Errore avvio tracciamento:", e);
        window.showToast(T('track.erroreAvvio') || "Impossibile avviare il tracciamento GPS. Riprova.", "error");
    } finally {
        if (btnStart) btnStart.disabled = false;
    }
}

// Punto 94/passo 5 - il GPS nativo puo' fallire SUBITO (permesso negato, GPS spento), ma la
// sessione server esiste gia' (creata da /start un attimo prima) e senza mai un punto vero.
// Chiuderla come una fine escursione normale (endTracking) mostrerebbe un riepilogo a zero -
// qui invece si chiude E si cancella subito (sequenza obbligata dal server: DELETE rifiuta
// una sessione non ancora 'ended'), cosi' non resta una traccia fantasma da ripulire a mano,
// e si torna allo stato "pronto per avviare" invece che a un riepilogo che non riepiloga nulla.
async function annullaTracciamentoNonPartito() {
    const sessionId = trackingState.sessionId;
    trackingState.status = 'idle';
    trackingState.sessionId = null;
    pulisciSpecchioLocale();
    if (window.endLiveGpsView) window.endLiveGpsView();
    renderTrackingUi();
    updateMapRecordButton();

    if (!sessionId) return;
    try {
        await fetch(`/api/tracking/${sessionId}/end`, { method: 'POST' });
        await fetch(`/api/tracking/sessions/${sessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error("Errore chiudendo la sessione di tracciamento mai partita davvero:", e);
    }
}

// Punto 94/passo 5 - richiesta di Denis (19/08): senza un avviso attivo, uno "scarpone
// dimenticato" (schermo spento per ore, notifica del plugin GPS eliminabile su MIUI e
// simili - vedi sopra) puo' restare a registrare per sempre senza che nessuno se ne accorga.
// Un ID fisso e riusato SEMPRE per la stessa notifica sfrutta il comportamento standard di
// Android: se l'utente non la tocca, la ricorrenza successiva la aggiorna silenziosamente
// (resta una sola, non si accumula); se la rimuove, alla ricorrenza dopo ne compare una
// fresca - esattamente il "ogni ora se cancellata, altrimenti resta quella" chiesto da
// Denis, senza dover rilevare noi stessi l'evento di cancellazione (fragile/non garantito
// da questo plugin). isExactNotification:false apposta: un promemoria approssimato non ha
// bisogno di un secondo permesso di sistema invasivo (Android 12+ altrimenti aprirebbe le
// impostazioni "Allarmi e promemoria" al primo avvio) - qualche minuto di scarto va bene.
const ID_PROMEMORIA_TRACCIAMENTO = 94001;

function avviaPromemoriaTracciamento() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    const plugin = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (!plugin) return;
    plugin.schedule({
        notifications: [{
            id: ID_PROMEMORIA_TRACCIAMENTO,
            title: 'Camoscio',
            body: T('track.promemoriaBody') || "Il tracciamento GPS è ancora attivo. Se hai finito, apri l'app e premi Termina.",
            schedule: { every: 'hour', allowWhileIdle: true },
            isExactNotification: false
        }]
    }).catch((e) => console.error("Errore programmando il promemoria di tracciamento:", e));
}

function fermaPromemoriaTracciamento() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;
    const plugin = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (!plugin) return;
    // cancel() ferma solo le ricorrenze future ("pending" - verificato nel .d.ts del
    // plugin): senza anche removeDeliveredNotificationsById(), una notifica gia' visibile
    // in quel momento sarebbe rimasta a dire "ancora attivo" anche dopo aver premuto
    // Termina - trovato chiedendolo Denis prima di dare per scontato il comportamento.
    plugin.cancel({ notifications: [{ id: ID_PROMEMORIA_TRACCIAMENTO }] })
        .catch((e) => console.error("Errore fermando il promemoria di tracciamento:", e));
    plugin.removeDeliveredNotificationsById({ ids: [ID_PROMEMORIA_TRACCIAMENTO] })
        .catch((e) => console.error("Errore rimuovendo la notifica di promemoria gia' mostrata:", e));
}

async function pauseTracking() {
    if (trackingState.activeResumedAtMs) {
        trackingState.baselineSeconds += (Date.now() - trackingState.activeResumedAtMs) / 1000;
        trackingState.activeResumedAtMs = null;
    }
    stopWatchingPosition();
    stopUiTimer();
    trackingState.status = 'paused';
    salvaSpecchioLocale();
    updatePanelButtonsForStatus();
    renderTrackingStats();

    // Si svuota la coda PRIMA di avvisare il server della pausa: altrimenti l'ultimo
    // gruppo di punti (gia' in coda da prima del click) arriverebbe dopo e rimetterebbe
    // per errore lo stato lato server su "active".
    await flushPendingPoints();
    stopFlushTimer();

    try {
        await fetch(`/api/tracking/${trackingState.sessionId}/pause`, { method: 'POST' });
    } catch (e) {
        console.error("Errore pausa tracciamento:", e);
    }
}

async function resumeTracking() {
    trackingState.activeResumedAtMs = Date.now();
    trackingState.status = 'active';
    // Solo la DISTANZA si azzera qui, non tutta resetLocalStats(): serve a evitare un salto
    // fasullo fra il punto pre-pausa e il primo dopo. La memoria del dislivello invece NON va
    // azzerata, perche' il server non azzera elevationRefM su una pausa - azzerarla solo qui
    // farebbe divergere i due conti, ed e' proprio il genere di differenza che poi si vede a
    // schermo come un numero che cambia da solo.
    lastLocalPoint = null;
    salvaSpecchioLocale();

    // Punto 94/passo 6 - stesso principio del passo 5 in startTracking(): si aspetta
    // l'esito vero del GPS nativo invece di darlo per scontato, cosi' un permesso revocato
    // durante la pausa (raro ma possibile) produce un avviso invece di un tasto "in
    // registrazione" che non registra piu' niente in silenzio.
    const ripreso = await beginWatchingPosition();
    updatePanelButtonsForStatus();
    renderTrackingUi();
    updateMapRecordButton();
    if (ripreso === false) return; // messaggio d'errore gia' mostrato da beginWatchingPosition/Native

    startUiTimer();
    startFlushTimer();

    try {
        await fetch(`/api/tracking/${trackingState.sessionId}/resume`, { method: 'POST' });
    } catch (e) {
        console.error("Errore ripresa tracciamento:", e);
    }
}

async function endTracking() {
    const confirmed = await window.showConfirmModal(T('track.confermaTermina') || "Vuoi terminare il tracciamento di questa escursione? Il riepilogo finale userà i dati raccolti finora.");
    if (!confirmed) return;

    if (trackingState.activeResumedAtMs) {
        trackingState.baselineSeconds += (Date.now() - trackingState.activeResumedAtMs) / 1000;
        trackingState.activeResumedAtMs = null;
    }

    stopWatchingPosition();
    stopUiTimer();
    await flushPendingPoints();
    stopFlushTimer();

    let finalSession = null;
    try {
        const res = await fetch(`/api/tracking/${trackingState.sessionId}/end`, { method: 'POST' });
        finalSession = await res.json();
    } catch (e) {
        console.error("Errore chiusura tracciamento:", e);
    }

    trackingState.status = 'ended';
    pulisciSpecchioLocale();
    if (window.endLiveGpsView) window.endLiveGpsView();
    updateMapRecordButton();
    fermaPromemoriaTracciamento();
    renderSummary(finalSession);
}

async function completeLinkedHike(durationSeconds) {
    if (!trackingState.hikeId) return;
    const actualTimeHours = Math.round((durationSeconds / 3600) * 100) / 100;

    try {
        const res = await fetch(`/api/hikes/${trackingState.hikeId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actualTimeHours })
        });
        if (res.ok) {
            window.showToast(T('track.completataReale') || "Escursione segnata come completata con i dati reali del tracciamento!", "success");
            await refreshState();
            if (window.renderHikesList) window.renderHikesList();
        } else {
            const body = await res.json().catch(() => ({}));
            window.showToast(body.error || T('track.erroreCompletamento') || "Non è stato possibile segnare l'escursione come completata.", "error");
        }
    } catch (e) {
        console.error("Errore nel completamento automatico:", e);
        window.showToast(T('track.erroreCompletamento') || "Non è stato possibile segnare l'escursione come completata.", "error");
    }

    const btn = document.getElementById('btn-tracking-mark-complete');
    if (btn) btn.classList.add('hidden');
}

// --- Geolocalizzazione ---

function beginWatchingPosition() {
    if (trackingState.watchId !== null) return Promise.resolve(true);

    // Punto 26 - da qui in poi il GPS lo tiene acceso il tracciamento, e il puntino blu si
    // limita a consumare i fix che arrivano di qua (vedi onPositionUpdate). Senza questa
    // riga resterebbero DUE watchPosition accesi insieme per tutta l'escursione: proprio nel
    // momento in cui la batteria conta di piu'.
    if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(true);

    // Punto 94/passo 4 - dentro l'app Android navigator.geolocation si ferma a schermo
    // spento (limite del browser, non del sito): si passa al plugin nativo, un servizio in
    // primo piano indipendente dalla pagina. 'native' fa da segnaposto per watchId, valido
    // quanto un id numerico sia per il controllo qui sopra sia per sapere come fermarsi in
    // stopWatchingPosition() - non serve un secondo flag. Punto 94/passo 5 - si ritorna la
    // promise del plugin cosi' chi chiama (startTracking) puo' sapere se e' partito
    // davvero, invece di dare per scontato il successo come fa gia' il ramo browser sotto.
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        trackingState.watchId = 'native';
        // Rete di sicurezza (19/08, terza prova dal vivo): un'eccezione imprevista uscita da
        // beginWatchingPositionNative() lasciava watchId='native' per sempre (scritto qui
        // sopra, mai riportato a null perche' la funzione non arrivava alle sue righe di
        // pulizia) - il tasto restava bloccato su "in tracciamento" con un riepilogo finale a
        // zero, un vero tracciamento mai iniziato. Qualunque causa futura, non solo quella gia'
        // trovata e corretta oggi, deve comunque riportare lo stato a "non sto tracciando".
        return beginWatchingPositionNative().catch((e) => {
            console.error("Errore imprevisto avviando il GPS nativo:", e);
            window.showToast(T('track.erroreGpsBackground') || "Impossibile avviare il GPS in background. Riprova.", "error");
            trackingState.watchId = null;
            if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(false);
            return false;
        });
    }

    trackingState.watchId = navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
    });
    return Promise.resolve(true);
}

function stopWatchingPosition() {
    if (trackingState.watchId !== null) {
        if (trackingState.watchId === 'native') {
            stopWatchingPositionNative();
        } else {
            navigator.geolocation.clearWatch(trackingState.watchId);
        }
        trackingState.watchId = null;
    }
    // L'altra meta' della transizione: il puntino torna a procurarsi i fix da solo. Va fatto
    // SEMPRE, anche se il watch era gia' chiuso, altrimenti una pausa seguita da uno stop
    // lascerebbe il puntino in attesa di fix da una fonte che non c'e' piu'.
    if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(false);
}

function nativeGeoPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeolocation) || null;
}

// Punto 94/passo 4 - @capgo/background-geolocation e' un servizio globale unico (nessun id
// per fermarlo, a differenza di watchPosition/clearWatch del browser). android.useLegacyBridge
// in capacitor.config.json tiene vivo il canale nativo->JS anche oltre i ~5 minuti in
// background in cui si bloccherebbe di default (vedi 03-Decisioni-Architetturali.md nel
// vault): il suo callback richiama onPositionUpdate esattamente come fa oggi watchPosition
// del browser, quindi coda IndexedDB/flushPendingPoints/formato a tupla restano identici,
// zero duplicazione della logica di tracciamento.
//
// Punto 94/passo 5 - il permesso "sempre" (ACCESS_BACKGROUND_LOCATION) non serve (verificato
// al passo 3 nel sorgente del plugin, e di nuovo qui nel suo AndroidManifest.xml: non lo
// dichiara) - Android offrira' solo "durante l'uso"/nega, mai "sempre", e basta "durante
// l'uso" perche' il servizio in primo piano tiene il GPS acceso a schermo spento. La
// spiegazione sotto compare quindi una volta sola (solo se il permesso non e' gia' concesso),
// PRIMA del popup di sistema - un solo bottone "ho capito", non un blocco si'/no: la scelta
// vera resta al popup Android, questo e' solo onestà preventiva (vincolo hard 7).
//
// CORREZIONE (19/08, dopo una prova dal vivo con Denis seguita in diretta con adb logcat):
// start() e' un metodo Capacitor "a callback continuo" (RETURN_CALLBACK lato plugin) - la sua
// Promise si risolve in 1-2ms, ben PRIMA che il popup di sistema sia anche solo apparso.
// Confermato nel log: "Sending plugin error" per un permesso negato arriva 300-400ms DOPO che
// "await plugin.start()" si era gia' risolto con successo. Un permesso negato quindi NON fa
// mai rigettare quella await (il vecchio try/catch qui sotto non lo intercettava mai): arriva
// sempre come "error" nel PRIMO richiamo del callback stesso, insieme a {message, code} -
// stessa forma gia' prevista, solo agganciata nel posto sbagliato. Bisogna aspettare quel
// primo evento, non la Promise di start(), per sapere se e' andata bene davvero - altrimenti
// (bug trovato da Denis provando dal vivo) il messaggio di successo e il controllo notifiche
// partivano sempre, anche negando, e il permesso negato non produceva mai un avviso visibile.
async function beginWatchingPositionNative() {
    const plugin = nativeGeoPlugin();
    if (!plugin) {
        console.error("Plugin BackgroundGeolocation non trovato in app nativa.");
        window.showToast(T('track.gpsBackgroundNonDisp') || "GPS in background non disponibile su questo dispositivo.", "error");
        trackingState.watchId = null;
        if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(false);
        return false;
    }

    try {
        const statoIniziale = await plugin.checkPermissions();
        if (statoIniziale.location !== 'granted') {
            await showGenericModal(
                T('track.modalePermessoAndroid') || "Per continuare a registrare il percorso anche a schermo spento, Camoscio sta per chiedere ad Android il permesso di posizione. Va bene qualunque opzione proponga Android, anche 'solo durante l'uso': il tracciamento resta attivo a schermo spento grazie al servizio con notifica permanente. Se subito dopo chiede anche il permesso di notifiche, puoi consentirlo o no: il tracciamento parte comunque.",
                { confirmLabel: T('track.hoCapitoContinua') || "Ho capito, continua", showCancel: false }
            );
        }
    } catch (e) {
        console.error("Errore controllo permessi GPS nativo:", e);
    }

    // Punto 94/passo 6 - SEMPRE fermare prima di far ripartire, incondizionatamente. Il
    // plugin rifiuta un secondo start() mentre un servizio precedente risulta ancora in
    // piedi (errore "ALREADY_STARTED", verificato nel sorgente Java del plugin) - capita
    // non solo riavviando a mano, ma OGNI volta che la pagina si ricarica da sola mentre il
    // tracciamento e' attivo: Android puo' scaricare il contenuto del WebView per liberare
    // memoria a schermo spento senza uccidere ne' l'app ne' il servizio GPS gia' avviato
    // (trovato il 19/08/2026 con una camminata vera in produzione, log di sistema alla
    // mano - vedi 07-Trappole-Tecniche nel vault). stop() risolve subito quando non c'e'
    // nulla da fermare (verificato nello stesso sorgente), quindi qui non costa
    // praticamente nulla nel caso normale e risolve quello raro - un solo percorso per
    // avvio, ripresa dopo pausa e recupero dopo ricaricamento, invece di un ramo a parte
    // per il caso che non si riesce a provare a comando.
    await stopWatchingPositionNative();

    let primoEventoGestito = false;
    const esitoPrimoEvento = new Promise((resolve) => {
        // CORREZIONE (19/08, seconda prova dal vivo): la definizione TypeScript del plugin
        // dichiara "start(): Promise<void>", ma a runtime il valore restituito NON e' una
        // vera Promise con .catch - verificato dal vivo (TypeError: plugin.start(...).catch
        // is not a function, propagato fino al messaggio generico di startTracking perche'
        // nessun try/catch lo intercettava). Il valore di ritorno non serve comunque: l'esito
        // vero arriva SEMPRE dal callback, mai da li' - un try/catch sincrono qui basta solo
        // come difesa contro un'eccezione immediata nella chiamata stessa.
        try {
            plugin.start({
                backgroundTitle: 'Camoscio',
                backgroundMessage: "Registrazione GPS dell'escursione in corso",
                requestPermissions: true,
                stale: false,
                distanceFilter: 0
            }, (location, error) => {
                // stop() e' asincrono: un fix puo' arrivare mentre e' gia' partito ma non
                // ancora concluso. trackingState.watchId torna null in stopWatchingPosition()
                // PRIMA di chiamarlo, quindi questo controllo scarta un fix in ritardo
                // esattamente come clearWatch() lo scarterebbe per il ramo browser.
                if (trackingState.watchId !== 'native') return;
                if (!primoEventoGestito) {
                    primoEventoGestito = true;
                    // Il primo errore lo gestisce il blocco sotto con un messaggio specifico -
                    // qui si esce senza passare da onPositionError, altrimenti sarebbe doppio.
                    resolve(error ? { ok: false, error } : { ok: true });
                    if (error) return;
                }
                if (error) {
                    onPositionError(error);
                    return;
                }
                if (location) onPositionUpdate(wrapNativeLocation(location));
            });
        } catch (e) {
            if (!primoEventoGestito) {
                primoEventoGestito = true;
                resolve({ ok: false, error: e });
            }
        }
    });

    const esito = await esitoPrimoEvento;
    if (!esito.ok) {
        // "Location services disabled." e permesso negato condividono lo stesso e.code
        // ("NOT_AUTHORIZED") nel plugin - solo il testo del messaggio li distingue (verificato
        // nel sorgente). Fragile a un cambio di wording del plugin: in quel caso resta il
        // messaggio generico sotto, mai l'inglese del plugin a schermo.
        const e = esito.error || {};
        console.error("Errore avvio GPS nativo in background:", e);
        const msg = e.message || '';
        if (msg.indexOf('Location services disabled') !== -1) {
            window.showToast(T('track.gpsSpento') || "Il GPS del telefono è spento. Accendilo dalle impostazioni rapide di Android e riprova.", "error");
        } else if (e.code === 'NOT_AUTHORIZED') {
            window.showToast(T('track.permessoPosizioneNegatoRiprova') || "Camoscio non può tracciare senza il permesso di posizione. Riprova: te lo richiederà di nuovo.", "error");
        } else if (e.code === 'FOREGROUND_SERVICE_START_NOT_ALLOWED') {
            // Punto 94/passo 6 - Android 12+ rifiuta di (ri)avviare un servizio in primo
            // piano se l'app e' in secondo piano in quel momento: puo' succedere proprio
            // riagganciando dopo un ricaricamento avvenuto a schermo spento. Messaggio
            // diverso apposta dagli altri: qui la soluzione e' riaprire l'app, non
            // riaccendere il GPS o dare di nuovo il permesso.
            window.showToast(T('track.appInBackground') || "Android ha bloccato la ripresa del GPS perché l'app era in secondo piano. Apri Camoscio e riprova.", "error");
        } else {
            window.showToast(T('track.erroreGpsBackground') || "Impossibile avviare il GPS in background. Riprova.", "error");
        }
        trackingState.watchId = null;
        if (window.CamoscioGeo) window.CamoscioGeo.usaFonteEsterna(false);
        return false;
    }

    // Il permesso di notifiche non blocca l'avvio (verificato nel sorgente del plugin: la
    // promozione a servizio in primo piano ignora ogni eccezione li'), quindi un problema qui
    // non deve mai far sembrare fallito un tracciamento gia' partito bene sopra - solo un
    // avviso, mai trackingState toccato. Ora parte solo DOPO il primo fix vero, non piu' 1ms
    // dopo start() come prima della correzione.
    try {
        const statoFinale = await plugin.checkPermissions();
        if (statoFinale.notification && statoFinale.notification !== 'granted') {
            // "Hai negato" (invece di "risulta negato") confondeva Denis provando dal vivo:
            // suonava come un'azione appena fatta, ma Android chiede il permesso una volta
            // sola - qui si legge quasi sempre uno stato deciso prima (spesso ai passi
            // precedenti), non una scelta di questo istante.
            window.showToast(T('track.notificheDisattivate') || "Le notifiche risultano disattivate per Camoscio: il tracciamento funziona lo stesso, ma non vedrai la notifica permanente di Android che lo segnala. Per attivarle: Impostazioni → App → Camoscio → Notifiche.", "info");
        }
    } catch (e) {
        console.error("Errore controllo permesso notifiche dopo l'avvio:", e);
    }
    return true;
}

async function stopWatchingPositionNative() {
    const plugin = nativeGeoPlugin();
    if (!plugin) return;
    try {
        await plugin.stop();
    } catch (e) {
        console.error("Errore fermando il GPS nativo in background:", e);
    }
}

// Il plugin da' un oggetto piatto (latitude/altitude/accuracy...) mentre onPositionUpdate si
// aspetta la forma di GeolocationPosition del browser (pos.coords.*): solo un adattamento di
// forma, nessuna logica duplicata.
function wrapNativeLocation(location) {
    return {
        coords: {
            latitude: location.latitude,
            longitude: location.longitude,
            altitude: location.altitude,
            accuracy: location.accuracy
        }
    };
}

async function onPositionUpdate(pos) {
    if (trackingState.status !== 'active') return; // in pausa: nessun nuovo punto registrato

    const { latitude, longitude, altitude, accuracy } = pos.coords;
    const seconds = Math.round((Date.now() - trackingState.startedAtMs) / 1000);
    const point = [
        Math.round(longitude * 1e5) / 1e5,
        Math.round(latitude * 1e5) / 1e5,
        (typeof altitude === 'number' && !Number.isNaN(altitude)) ? Math.round(altitude) : null,
        seconds,
        Math.round(accuracy || 0)
    ];

    trackingState.lastAccuracy = point[4];

    // Fase G - Al primissimo fix GPS della sessione si scaricano (una volta sola) i
    // sentieri conosciuti nella zona, per un aggancio rapido e approssimato mostrato subito
    // sulla mappa. Il dato definitivo resta comunque quello calcolato dal server (vedi
    // flushPendingPoints): qui e' solo un riscontro visivo immediato, non autorevole.
    if (nearbyTrailSegments === null) {
        nearbyTrailSegments = [];
        loadNearbyTrailSegments(longitude, latitude);
    }
    const quickSnapResult = quickSnapToNearbyTrail(longitude, latitude, point[4]);
    const displayLng = quickSnapResult ? quickSnapResult.point[0] : longitude;
    const displayLat = quickSnapResult ? quickSnapResult.point[1] : latitude;

    // Punto 26 - al puntino blu va la posizione GREZZA con la sua precisione vera, non quella
    // agganciata al sentiero qui sopra: il puntino deve dire dove il telefono crede di essere
    // e quanto poco ne e' sicuro, mentre l'aggancio e' una correzione utile alla traccia ma
    // che darebbe l'impressione di una precisione che il GPS non ha.
    if (window.CamoscioGeo) window.CamoscioGeo.pushPosition(latitude, longitude, accuracy);

    // Riscontro immediato lato client, prima ancora della risposta del server
    accumulateLocalStats([displayLng, displayLat, point[2], point[3], point[4]]);
    if (window.updateLiveGpsPosition) window.updateLiveGpsPosition(displayLat, displayLng);
    if (window.addLiveTrackPoint) window.addLiveTrackPoint(displayLat, displayLng);
    renderTrackingStats();
    renderGpsQuality();

    try {
        // In coda/al server va SEMPRE il punto GPS grezzo, non quello corretto in locale:
        // il server rifa' comunque l'aggancio per conto suo con l'intero database dei
        // sentieri (non solo la zona vicina scaricata qui), e' lui il dato definitivo.
        await idbQueuePoints(trackingState.sessionId, [point]);
    } catch (e) {
        console.error("Impossibile mettere in coda il punto GPS:", e);
    }
}

// Scarica una volta sola (non l'intero database regionale: solo la zona interessata) i
// sentieri noti vicini al punto dato, per il controllo rapido lato telefono.
async function loadNearbyTrailSegments(lng, lat) {
    try {
        const res = await fetch(`/api/tracking/nearby-trails?lng=${lng}&lat=${lat}&radiusKm=5`);
        nearbyTrailSegments = res.ok ? await res.json() : [];
    } catch (e) {
        console.error("Impossibile scaricare i sentieri vicini per l'aggancio rapido:", e);
        nearbyTrailSegments = [];
    }
}

// Punto piu' vicino sul segmento [a,b] a "pt" (tutti [lng,lat]) - stessa identica logica di
// nearestPointOnSegment in lib/geometry.js lato server, duplicata qui perche' il frontend
// non ha un bundler condiviso col backend (stesso criterio gia' in uso per altre piccole
// funzioni geometriche come calculateDistance).
function nearestPointOnSegmentClient(pt, a, b) {
    const mLat = 111320, mLng = 111320 * Math.cos(pt[1] * Math.PI / 180);
    const x0 = pt[0] * mLng, y0 = pt[1] * mLat;
    const x1 = a[0] * mLng, y1 = a[1] * mLat;
    const x2 = b[0] * mLng, y2 = b[1] * mLat;
    const dx = x2 - x1, dy = y2 - y1;

    let t = 0;
    if (dx !== 0 || dy !== 0) {
        t = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)));
    }
    const px = x1 + t * dx, py = y1 + t * dy;
    return { point: [px / mLng, py / mLat], distanceM: Math.hypot(x0 - px, y0 - py) };
}

// Aggancio "veloce e approssimato" lato telefono (Fase G): stessa soglia adattiva usata
// dal server (10m di margine OSM + precisione GPS del momento, tetto 60m), ma solo contro
// i sentieri della zona gia' scaricati - non e' quello autorevole, serve solo a mostrare
// subito un puntino stabile invece che ballerino in attesa della sincronizzazione.
function quickSnapToNearbyTrail(lng, lat, accuracyM) {
    if (!nearbyTrailSegments || nearbyTrailSegments.length === 0) return null;

    const threshold = Math.min(10 + (accuracyM || 20), 60);
    let best = null;

    for (const coords of nearbyTrailSegments) {
        for (let i = 0; i < coords.length - 1; i++) {
            const { point, distanceM } = nearestPointOnSegmentClient([lng, lat], coords[i], coords[i + 1]);
            if (distanceM <= threshold && (!best || distanceM < best.distanceM)) {
                best = { point, distanceM };
            }
        }
    }
    return best;
}

function onPositionError(err) {
    console.warn("Errore geolocalizzazione:", err.message);
    // Punto 94/passo 5 - err.PERMISSION_DENIED e' una costante del browser (GeolocationPositionError),
    // sempre undefined per un errore del plugin nativo: senza il secondo confronto, un permesso
    // revocato a meta' sessione (raro: il primo fix era andato a buon fine) passava in silenzio,
    // zero avviso a schermo.
    if (err.code === err.PERMISSION_DENIED || err.code === 'NOT_AUTHORIZED') {
        window.showToast(T('track.permessoNegato') || "Permesso di geolocalizzazione negato: il tracciamento non può registrare la posizione reale.", "error");
        renderGpsQuality(true);
    }
}

// La soglia del dislivello: la STESSA del server (SOGLIA_DISLIVELLO_M in lib/gpx.js) e la
// stessa dei file .gpx importati. Qui il valore e' scritto perche' il browser non puo'
// leggere un file del server, ma non e' una seconda regola: e' la stessa, e se un giorno la
// si cambia va cambiata in tutti e due i posti.
const SOGLIA_DISLIVELLO_M = 10;

// Quota piu' bassa vista da quando si sta salendo. E' la memoria della regola, la stessa che
// il server tiene in elevationRefM.
let quotaRiferimento = null;

function resetLocalStats() { lastLocalPoint = null; quotaRiferimento = null; }

// Il conto istantaneo mentre si cammina, in attesa che il server risponda coi totali veri
// (flushPendingPoints li riallinea a ogni sincronizzazione).
//
// USA LA STESSA REGOLA DEL SERVER, e deve: prima sommava ogni salto sopra i 3 metri, cioe'
// contava come salita il tremolio della quota GPS - che su un telefono sbaglia molto piu' di
// 3 metri. Il risultato era un numero che saliva da solo stando fermi, e che poi calava di
// colpo alla prima sincronizzazione, quando arrivava il totale del server: due numeri diversi
// sotto gli occhi della stessa persona.
function accumulateLocalStats(point) {
    if (lastLocalPoint) {
        const distKm = calculateDistance(lastLocalPoint[1], lastLocalPoint[0], point[1], point[0]) / 1000;
        trackingState.distanceKm += distKm;
    }
    lastLocalPoint = point;

    const quota = point[2];
    if (typeof quota !== 'number' || !isFinite(quota)) return;
    if (quotaRiferimento === null) { quotaRiferimento = quota; return; }

    if (quota > quotaRiferimento + SOGLIA_DISLIVELLO_M) {
        trackingState.elevationGainM += quota - quotaRiferimento;
        quotaRiferimento = quota;
    } else if (quota < quotaRiferimento) {
        quotaRiferimento = quota;
    }
}

// --- Sincronizzazione con il server (coda IndexedDB -> invio a gruppi) ---

async function flushPendingPoints() {
    if (isFlushInProgress || !trackingState.sessionId) return;
    isFlushInProgress = true;

    try {
        const records = await idbGetQueuedPoints(trackingState.sessionId);
        if (records.length === 0) {
            setSyncBadge('synced');
            return;
        }
        setSyncBadge('syncing');

        const res = await fetch(`/api/tracking/${trackingState.sessionId}/points`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: records.map(r => r.point) })
        });

        if (res.ok) {
            const updated = await res.json();
            // Riconcilia con i totali autorevoli del server: corregge da sola qualunque
            // piccola deriva tra il calcolo lato client (istantaneo) e quello lato server.
            trackingState.distanceKm = updated.distanceKm;
            trackingState.elevationGainM = updated.elevationGainM;
            trackingState.baselineSeconds = updated.durationSeconds;
            if (trackingState.activeResumedAtMs) trackingState.activeResumedAtMs = Date.now();

            await idbDeleteQueuedPoints(records.map(r => r.localId));
            setSyncBadge('synced');
            renderTrackingStats();
        } else if (res.status === 404 || res.status === 409) {
            // Punto 94/passo 6 - la sessione non esiste piu' per noi (404: utente/sessione
            // diversi, es. stantia da un ripristino alla cieca; 409: gia' terminata,
            // probabilmente da un altro dispositivo). Riprovare all'infinito non serve: i
            // punti ancora in coda non hanno piu' una sessione viva a cui appartenere.
            // Si ferma tutto e si dice, invece di continuare a mostrare "in registrazione"
            // su qualcosa che sul server non esiste piu'.
            console.error(`Sessione di tracciamento non piu' valida (HTTP ${res.status}): fermo la registrazione su questo telefono.`);
            stopWatchingPosition();
            stopUiTimer();
            stopFlushTimer();
            fermaPromemoriaTracciamento();
            setSyncBadge('offline');
            resetToIdleUi();
            window.showToast(T('track.sessioneChiusaAltrove') || "Il tracciamento risulta chiuso sul server (forse da un altro dispositivo): la registrazione su questo telefono si è fermata qui.", "error");
        } else {
            setSyncBadge('offline');
        }
    } catch (e) {
        setSyncBadge('offline');
    } finally {
        isFlushInProgress = false;
    }
}

function startFlushTimer() {
    stopFlushTimer();
    trackingState.flushTimer = setInterval(flushPendingPoints, 25000);
}

function stopFlushTimer() {
    if (trackingState.flushTimer) {
        clearInterval(trackingState.flushTimer);
        trackingState.flushTimer = null;
    }
}

// --- Orologio live (esclude il tempo in pausa) ---

function currentDurationSeconds() {
    let secs = trackingState.baselineSeconds;
    if (trackingState.activeResumedAtMs) {
        secs += (Date.now() - trackingState.activeResumedAtMs) / 1000;
    }
    return Math.round(secs);
}

function tickUiTimer() {
    trackingState.durationSeconds = currentDurationSeconds();
    trackingState.avgSpeedKmh = trackingState.durationSeconds > 0
        ? (trackingState.distanceKm / (trackingState.durationSeconds / 3600))
        : 0;
    renderTrackingStats();
}

function startUiTimer() {
    stopUiTimer();
    trackingState.uiTimer = setInterval(tickUiTimer, 1000);
    tickUiTimer();
}

function stopUiTimer() {
    if (trackingState.uiTimer) {
        clearInterval(trackingState.uiTimer);
        trackingState.uiTimer = null;
    }
}

// --- Interfaccia: pulsante flottante + pannello ---

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderTrackingStats() {
    const timeText = formatDuration(trackingState.durationSeconds);
    const distText = `${numTracc(trackingState.distanceKm, 2)} km`;
    const elevText = `${Math.round(trackingState.elevationGainM)} m`;
    const speedText = `${numTracc(trackingState.avgSpeedKmh, 1)} km/h`;

    setText('tracking-stat-time', timeText);
    setText('tracking-stat-distance', distText);
    setText('tracking-stat-elevation', elevText);
    setText('tracking-stat-speed', speedText);

    setText('tracking-mini-time', timeText);
    setText('tracking-mini-distance', distText);
}

function renderGpsQuality(denied = false, interrotto = false) {
    const badge = document.getElementById('tracking-gps-quality');
    if (!badge) return;

    // Punto 94/passo 6 - "interrotto" e' diverso da "in attesa del segnale": il server (o
    // lo specchio locale) dice che la registrazione dovrebbe essere attiva, ma il GPS
    // nativo non e' agganciato - senza questo badge il tasto direbbe "Termina
    // registrazione" mentre in realta' non registra piu' nulla, in silenzio.
    if (interrotto) {
        badge.textContent = T('track.gps.interrotto') || 'GPS: registrazione interrotta — tocca per riprovare';
        badge.className = 'badge badge-red';
        return;
    }
    if (denied) {
        badge.textContent = T('track.gps.permessoNegato') || 'GPS: permesso negato';
        badge.className = 'badge badge-red';
        return;
    }

    const acc = trackingState.lastAccuracy;
    if (acc == null) {
        badge.textContent = T('track.gps.attesa') || 'GPS: in attesa del segnale...';
        badge.className = 'badge badge-primary';
    } else if (acc <= 15) {
        badge.textContent = T('track.gps.ottima', acc) || `GPS: ottima precisione (±${acc}m)`;
        badge.className = 'badge badge-green';
    } else if (acc <= 40) {
        badge.textContent = T('track.gps.buona', acc) || `GPS: buona precisione (±${acc}m)`;
        badge.className = 'badge badge-primary';
    } else {
        badge.textContent = T('track.gps.scarsa', acc) || `GPS: precisione scarsa (±${acc}m)`;
        badge.className = 'badge badge-red';
    }
}

function setSyncBadge(state) {
    ultimoStatoSync = state;
    const badge = document.getElementById('tracking-sync-status');
    if (!badge) return;
    if (state === 'synced') {
        badge.textContent = T('track.sync.sincronizzato') || 'Sincronizzato';
        badge.className = 'badge badge-green';
    } else if (state === 'syncing') {
        badge.textContent = T('track.sync.sincronizzazione') || 'Sincronizzazione...';
        badge.className = 'badge badge-primary';
    } else {
        badge.textContent = T('track.sync.offline') || 'Offline: dati in coda';
        badge.className = 'badge badge-red';
    }
}

function renderMiniBarIcon() {
    const icon = document.getElementById('tracking-mini-icon');
    if (icon) icon.textContent = trackingState.status === 'paused' ? '⏸️' : '🔴';
}

// --- Punto 14: tasto unico "Comincia registrazione" sulla mappa ---
// Il pannello del pulsante a scarpone resta (serve per scegliere l'escursione collegata,
// scaricare la mappa offline, mettere in pausa). Questo invece e' la scorciatoia chiesta
// esplicitamente: sei sulla mappa, premi un tasto, parte la registrazione.

// Una registrazione e' "in corso" sia mentre si cammina sia durante una pausa: in
// entrambi i casi la sessione e' aperta e il tasto sulla mappa deve dire "Termina".
window.CamoscioTrackingIsRecording = function () {
    return trackingState.status === 'active' || trackingState.status === 'paused';
};

function updateMapRecordButton() {
    const btn = document.getElementById('btn-map-quick-record');
    const label = document.getElementById('map-record-label');
    if (!btn || !label) return;

    const recording = window.CamoscioTrackingIsRecording();
    label.textContent = recording
        ? (T('track.terminaRegistrazione') || 'Termina registrazione')
        : (T('track.cominciaRegistrazione') || 'Comincia registrazione');
    btn.classList.toggle('btn-danger', recording);
    btn.classList.toggle('btn-primary', !recording);
    btn.classList.toggle('is-recording', recording);

    // Punto 45: hike-select e download mappa offline, spostati qui dal vecchio pannello a
    // scarpone, si bloccano mentre si registra - l'hikeId si fissa a startTracking() e un
    // select ancora modificabile mentirebbe a schermo su quale escursione si sta registrando.
    const hikeSelect = document.getElementById('tracking-hike-select');
    if (hikeSelect) hikeSelect.disabled = recording;
    const btnDownload = document.getElementById('btn-tracking-download-map');
    if (btnDownload) btnDownload.disabled = recording;

    if (window.updateRecenterButton) window.updateRecenterButton();
}

async function onMapRecordButtonClick() {
    if (window.CamoscioTrackingIsRecording()) {
        await endTracking();
    } else {
        // Si riusa esattamente startTracking(), cosi' questo tasto e quello del pannello
        // non possono divergere nel comportamento (consenso geolocalizzazione, escursione
        // collegata gia' selezionata, gestione errori: tutto in un posto solo).
        await startTracking();
    }
    updateMapRecordButton();
}

function updatePanelButtonsForStatus() {
    const btnPause = document.getElementById('btn-tracking-pause');
    const btnResume = document.getElementById('btn-tracking-resume');
    renderMiniBarIcon();
    if (!btnPause || !btnResume) return;

    if (trackingState.status === 'paused') {
        btnPause.classList.add('hidden');
        btnResume.classList.remove('hidden');
    } else {
        btnPause.classList.remove('hidden');
        btnResume.classList.add('hidden');
    }
}

function renderHikeSelectOptions() {
    const select = document.getElementById('tracking-hike-select');
    if (!select) return;

    const db = window.CamoscioState;
    const hikes = db.hikes || [];
    const currentValue = select.value;

    select.innerHTML = `<option value="">${escapeHtml(T('track.nessunaTracciaLibera') || 'Nessuna - traccia libera')}</option>` +
        hikes.map(h => `<option value="${h.id}">${escapeHtml(h.title)}</option>`).join('');

    if (currentValue && hikes.some(h => h.id === currentValue)) {
        select.value = currentValue;
    } else if (db.activeHikeId && hikes.some(h => h.id === db.activeHikeId)) {
        select.value = db.activeHikeId;
    }
}

function toggleGeoConsentAlert() {
    const alertBox = document.getElementById('tracking-geo-consent-alert');
    if (!alertBox) return;
    const usr = window.CamoscioState.currentUser;
    const needsConsent = !!(usr && !usr.geolocationConsent && !usr.isDemoAccount);
    alertBox.classList.toggle('hidden', !needsConsent);
}

function renderTrackingUi() {
    const idle = document.getElementById('tracking-state-idle');
    const active = document.getElementById('tracking-state-active');
    const summary = document.getElementById('tracking-state-summary');
    const miniBar = document.getElementById('tracking-mini-bar');
    if (!idle || !active || !summary || !miniBar) return;

    if (trackingState.status === 'active' || trackingState.status === 'paused') {
        idle.classList.add('hidden');
        summary.classList.add('hidden');
        active.classList.remove('hidden');
        miniBar.classList.remove('hidden');
        updatePanelButtonsForStatus();
        renderTrackingStats();
        renderGpsQuality(false, trackingState.status === 'active' && trackingState.watchId === null);
    } else if (trackingState.status === 'idle') {
        active.classList.add('hidden');
        summary.classList.add('hidden');
        idle.classList.remove('hidden');
        miniBar.classList.add('hidden');
        renderHikeSelectOptions();
        toggleGeoConsentAlert();
    }
}

function renderSummary(finalSession) {
    ultimaSessioneRiepilogo = finalSession;
    document.getElementById('tracking-state-idle').classList.add('hidden');
    document.getElementById('tracking-state-active').classList.add('hidden');
    document.getElementById('tracking-state-summary').classList.remove('hidden');
    document.getElementById('tracking-mini-bar').classList.add('hidden');

    const distanceKm = finalSession ? finalSession.distanceKm : trackingState.distanceKm;
    const elevationGainM = finalSession ? finalSession.elevationGainM : trackingState.elevationGainM;
    const durationSeconds = finalSession ? finalSession.durationSeconds : trackingState.durationSeconds;
    const avgSpeedKmh = finalSession ? finalSession.avgSpeedKmh : trackingState.avgSpeedKmh;

    setText('tracking-summary-time', formatDuration(durationSeconds));
    setText('tracking-summary-distance', `${numTracc(distanceKm, 2)} km`);
    setText('tracking-summary-elevation', `${Math.round(elevationGainM)} m`);
    setText('tracking-summary-speed', `${numTracc(avgSpeedKmh, 1)} km/h`);

    const btnComplete = document.getElementById('btn-tracking-mark-complete');
    if (btnComplete) {
        if (trackingState.hikeId) {
            btnComplete.classList.remove('hidden');
            btnComplete.onclick = () => completeLinkedHike(durationSeconds);
        } else {
            btnComplete.classList.add('hidden');
        }
    }

    showPanel();
}

function showPanel() {
    const panel = document.getElementById('tracking-panel');
    if (panel) panel.classList.remove('hidden');
}

function hidePanel() {
    const panel = document.getElementById('tracking-panel');
    if (panel) panel.classList.add('hidden');
}

function resetToIdleUi() {
    trackingState.status = 'idle';
    trackingState.sessionId = null;
    pulisciSpecchioLocale();
    trackingState.hikeId = null;
    trackingState.distanceKm = 0;
    trackingState.elevationGainM = 0;
    trackingState.baselineSeconds = 0;
    trackingState.durationSeconds = 0;
    trackingState.avgSpeedKmh = 0;
    trackingState.lastAccuracy = null;
    resetLocalStats();
    nearbyTrailSegments = null;
    if (window.clearLiveTrackPolyline) window.clearLiveTrackPolyline();
    if (window.endLiveGpsView) window.endLiveGpsView();
    hidePanel();
    renderTrackingUi();
    updateMapRecordButton();
}

// --- Mappa offline ---

async function handleDownloadOfflineMap() {
    if (!window.getHikeBounds || !window.estimateOfflineDownloadSize || !window.downloadOfflineMapForBounds) {
        window.showToast(T('track.mappaOfflineNonDisp') || "Funzione mappa offline non disponibile in questo momento.", "error");
        return;
    }

    const select = document.getElementById('tracking-hike-select');
    const hikeId = select ? select.value : null;
    const db = window.CamoscioState;
    const hike = hikeId ? db.hikes.find(h => h.id === hikeId) : null;

    let bounds;
    if (hike) {
        bounds = window.getHikeBounds(hike);
    } else if (window.mapInstance) {
        bounds = window.mapInstance.getBounds();
    } else {
        window.showToast(T('track.apriPrimaMappa') || "Apri prima la sezione Mappa, cosi' posso capire quale area scaricare.", "error");
        return;
    }

    const estimate = window.estimateOfflineDownloadSize(bounds);
    const confirmed = await window.showConfirmModal(
        T('track.confermaDownload', estimate.tileCount, estimate.estimatedMb) ||
        `Verranno scaricate circa ${estimate.tileCount} porzioni di mappa (~${estimate.estimatedMb} MB). Continuare? (consigliato con Wi-Fi o comunque buona connessione)`
    );
    if (!confirmed) return;

    const progressBox = document.getElementById('tracking-download-progress');
    const progressFill = document.getElementById('tracking-download-progress-fill');
    const progressLabel = document.getElementById('tracking-download-progress-label');
    const btn = document.getElementById('btn-tracking-download-map');

    if (progressBox) progressBox.classList.remove('hidden');
    if (btn) btn.disabled = true;

    try {
        const result = await window.downloadOfflineMapForBounds(bounds, (done, total, failed) => {
            const pct = Math.round((done / total) * 100);
            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressLabel) {
                const base = T('track.progressoTile', done, total) || `${done}/${total} tile`;
                const ko = failed ? (T('track.tileNonRiuscite', failed) || ` (${failed} non riuscite)`) : '';
                progressLabel.textContent = base + ko;
            }
        });
        window.showToast(T('track.mappaProntaToast', result.total - result.failed, result.total) || `Mappa offline pronta: ${result.total - result.failed}/${result.total} tile salvate sul dispositivo.`, "success");
    } catch (e) {
        console.error("Errore download mappa offline:", e);
        window.showToast(T('track.erroreDownloadMappa') || "Errore durante il download della mappa offline.", "error");
    } finally {
        if (btn) btn.disabled = false;
        if (progressBox) setTimeout(() => progressBox.classList.add('hidden'), 3000);
    }
}

// --- Ripresa dopo un ricaricamento della pagina ---

// Sotto questa soglia si dice solo "ripreso", sopra si dice per quanti minuti manca un
// pezzo di traccia - proposta dell'agente architect, valore scelto per non trasformare
// ogni micro-ricaricamento in un allarme ne' tacere su un buco vero.
const SOGLIA_AVVISO_BUCO_SEC = 90;

async function checkForResumableSession() {
    let res;
    try {
        res = await fetch('/api/tracking/active');
    } catch (e) {
        // Punto 94/passo 6 - niente rete proprio ora (frequente in montagna): non e' detto
        // che non ci fosse una registrazione in corso, solo che non possiamo chiederlo al
        // server. Si prova a riprendere dallo specchio locale invece di arrendersi.
        console.error("Impossibile verificare un tracciamento GPS in corso (offline):", e);
        await ripristinoAllaCieca();
        return;
    }
    if (!res.ok) {
        await ripristinoAllaCieca();
        return;
    }

    let session;
    try {
        session = await res.json();
    } catch (e) {
        console.error("Risposta non valida controllando un tracciamento in corso:", e);
        return;
    }

    if (!session) {
        // Il server e' stato chiaro: nessuna sessione aperta. Se lo specchio locale diceva
        // il contrario (es. terminata nel frattempo da un altro dispositivo) e' superato.
        pulisciSpecchioLocale();
        return;
    }

    applySessionState(session);

    if (window.resetLiveTrackPolyline) window.resetLiveTrackPolyline();
    (session.points || []).forEach(p => {
        if (window.addLiveTrackPoint) window.addLiveTrackPoint(p[1], p[0]);
    });
    if (session.points && session.points.length > 0 && window.updateLiveGpsPosition) {
        const last = session.points[session.points.length - 1];
        window.updateLiveGpsPosition(last[1], last[0], true);
    }

    if (session.status !== 'active') {
        renderTrackingUi();
        updateMapRecordButton();
        return;
    }

    // Anche riprendendo dopo un ricaricamento della pagina la mappa deve tornare a
    // inseguire la posizione reale (punto 11), non restare sulla panoramica.
    if (window.beginLiveGpsView) {
        const last = (session.points || [])[(session.points || []).length - 1];
        if (last) window.beginLiveGpsView(last[1], last[0]);
        else window.beginLiveGpsView();
    }

    // Punto 94/passo 6 - si aspetta l'esito vero (prima non si aspettava affatto): il
    // server conferma la sessione aperta, ma il GPS nativo potrebbe comunque non
    // riagganciarsi (es. Android rifiuta di riavviare il servizio da app in background).
    // Senza questo await/controllo il tasto tornava a dire "Termina registrazione" anche
    // quando in realta' non stava piu' registrando nulla - lo stesso buco di stanotte, in
    // una forma piu' subdola perche' il server risponde comunque.
    const ripreso = await beginWatchingPosition();
    renderTrackingUi();
    updateMapRecordButton();
    if (ripreso === false) return; // messaggio d'errore gia' mostrato da beginWatchingPosition/Native

    startUiTimer();
    startFlushTimer();
    avviaPromemoriaTracciamento();

    const puntiSessione = session.points || [];
    const ultimoPunto = puntiSessione[puntiSessione.length - 1];
    const gapSec = ultimoPunto
        ? (Date.now() - (trackingState.startedAtMs + ultimoPunto[3] * 1000)) / 1000
        : null;

    if (gapSec !== null && gapSec > SOGLIA_AVVISO_BUCO_SEC) {
        const minuti = Math.max(1, Math.round(gapSec / 60));
        window.showToast(
            T('track.ripresoConBuco', minuti) ||
            `Tracciamento ripreso. Per circa ${minuti} minut${minuti === 1 ? 'o' : 'i'} il percorso non è stato registrato: quel tratto mancherà dalla traccia.`,
            "info"
        );
    } else {
        window.showToast(T('track.ripresoDaDoveEriRimasto') || "Tracciamento GPS ripreso da dove eri rimasto.", "info");
    }
}

// Punto 94/passo 6 - checkForResumableSession() non e' riuscito nemmeno a chiedere al
// server (vedi sopra): l'unica fonte rimasta e' lo specchio locale. Il GPS nativo non ha
// mai avuto bisogno di rete per raccogliere fix, quindi si riparte "alla cieca" - i punti
// si accodano in IndexedDB come sempre con lo stesso sessionId, e la spedizione al server
// (flushPendingPoints, gia' esistente, gia' chiamata dal timer e dall'evento 'online') si
// mette in pari da sola quando torna il segnale. La sola cosa che qui non si puo' fare
// onestamente e' calcolare un buco preciso: senza aver parlato col server non si sa cosa
// sia successo nel frattempo, quindi si dice solo che il recupero non e' confermato, mai
// un numero inventato (vincolo hard: mai promettere a schermo cio' che non si puo' mantenere).
async function ripristinoAllaCieca() {
    const specchio = leggiSpecchioLocale();
    if (!specchio || !specchio.sessionId || specchio.status === 'idle' || specchio.status === 'ended') return;

    trackingState.sessionId = specchio.sessionId;
    trackingState.hikeId = specchio.hikeId || null;
    trackingState.startedAtMs = specchio.startedAtMs;
    trackingState.status = specchio.status;
    // Stima onesta ma imprecisa (non conosce eventuali pause passate): meglio di un
    // cronometro che riparte da zero come se la registrazione fosse appena cominciata. Si
    // corregge da sola al primo invio riuscito (flushPendingPoints riallinea sempre ai
    // totali autorevoli del server).
    trackingState.baselineSeconds = specchio.startedAtMs
        ? Math.max(0, Math.round((Date.now() - specchio.startedAtMs) / 1000))
        : 0;
    trackingState.activeResumedAtMs = specchio.status === 'active' ? Date.now() : null;
    resetLocalStats();
    nearbyTrailSegments = null;

    if (specchio.status !== 'active') {
        // Sessione salvata in pausa: si ridisegna cosi', ma non si riaccende il GPS da
        // soli - una ripresa resta una scelta dell'utente, esattamente come oggi da rete.
        renderTrackingUi();
        updateMapRecordButton();
        return;
    }

    if (window.beginLiveGpsView) window.beginLiveGpsView();

    const ripreso = await beginWatchingPosition();
    renderTrackingUi();
    updateMapRecordButton();
    if (!ripreso) return; // messaggio d'errore gia' mostrato da beginWatchingPosition/Native

    startUiTimer();
    startFlushTimer();
    avviaPromemoriaTracciamento();
    window.showToast(
        T('track.ripresoAllaCieca') ||
        "Tracciamento ripreso senza conferma dal server (nessuna rete in questo momento): continuo a registrare, si mette in pari da solo quando torna la connessione.",
        "info"
    );
}

// Punto 94/passo 6 - stesso riaggancio usato dopo un ricaricamento, richiamabile a mano
// toccando il badge "registrazione interrotta" (vedi renderGpsQuality) o da soli al
// ritorno della rete (vedi l'evento 'online' in initTrackingModule).
async function riprovaRiaggancioGps() {
    if (!window.CamoscioTrackingIsRecording() || trackingState.watchId !== null) return;
    const ripreso = await beginWatchingPosition();
    if (ripreso) {
        startUiTimer();
        startFlushTimer();
        window.showToast(T('track.ripreso') || "Tracciamento GPS ripreso.", "success");
    }
    renderTrackingUi();
    updateMapRecordButton();
}

// --- Inizializzazione modulo ---

function initTrackingModule() {
    const miniBar = document.getElementById('tracking-mini-bar');
    const panelClose = document.getElementById('tracking-panel-close');
    const btnStart = document.getElementById('btn-tracking-start');
    const btnPause = document.getElementById('btn-tracking-pause');
    const btnResume = document.getElementById('btn-tracking-resume');
    const btnEnd = document.getElementById('btn-tracking-end');
    const btnDownload = document.getElementById('btn-tracking-download-map');
    const btnSummaryClose = document.getElementById('btn-tracking-summary-close');

    // Punto 45: il pulsante a scarpone che apriva questo pannello da fermo non c'e' piu' (il
    // suo posto lo prende #report-fab, map.js) - si arriva qui solo mentre si registra
    // (tocco sulla mini-bar) o a fine escursione (riepilogo, vedi renderSummary/showPanel).
    if (miniBar) miniBar.addEventListener('click', () => { renderTrackingUi(); showPanel(); });
    if (panelClose) panelClose.addEventListener('click', hidePanel);
    if (btnStart) btnStart.addEventListener('click', startTracking);
    if (btnPause) btnPause.addEventListener('click', pauseTracking);
    if (btnResume) btnResume.addEventListener('click', resumeTracking);
    if (btnEnd) btnEnd.addEventListener('click', endTracking);
    if (btnDownload) btnDownload.addEventListener('click', handleDownloadOfflineMap);
    if (btnSummaryClose) btnSummaryClose.addEventListener('click', resetToIdleUi);

    // Punto 14: tasto unico sulla mappa + tasto per tornare a farsi seguire (punto 11)
    const btnMapRecord = document.getElementById('btn-map-quick-record');
    const btnMapRecenter = document.getElementById('btn-map-recenter');
    if (btnMapRecord) btnMapRecord.addEventListener('click', onMapRecordButtonClick);
    if (btnMapRecenter) btnMapRecenter.addEventListener('click', () => {
        if (window.recenterOnLiveGps) window.recenterOnLiveGps();
    });
    updateMapRecordButton();

    // Punto 94/passo 6 - il badge diventa un tasto quando dice "registrazione interrotta"
    // (vedi renderGpsQuality/riprovaRiaggancioGps); negli altri stati il tocco non fa
    // nulla di pericoloso, la guardia e' dentro riprovaRiaggancioGps stesso.
    const gpsQualityBadge = document.getElementById('tracking-gps-quality');
    if (gpsQualityBadge) gpsQualityBadge.addEventListener('click', riprovaRiaggancioGps);

    window.addEventListener('online', () => {
        if (!trackingState.sessionId || trackingState.status !== 'active') return;
        flushPendingPoints();
        if (trackingState.watchId === null) riprovaRiaggancioGps();
    });

    checkForResumableSession();
}

window.initTrackingModule = initTrackingModule;
// Punto 45: hike-select e alert di consenso, spostati sulla pagina Mappa vicino al tasto di
// registrazione - prima erano raggiungibili SOLO aprendo il pannello da fermo (il ramo idle
// di renderTrackingUi), che con il vecchio pulsante a scarpone rimosso non si apre piu' da
// soli. Chiamate esplicitamente dal caso "map-section" di triggerSectionRender (app.js).
window.renderHikeSelectOptions = renderHikeSelectOptions;
window.toggleGeoConsentAlert = toggleGeoConsentAlert;

// Rollout traduzione punto 102, lotto Mappa area 4: al cambio lingua i pezzi scritti da
// JS (label del tasto sulla mappa, badge GPS/sync, statistiche col separatore decimale,
// opzione "Nessuna" del <select>, riepilogo) non li tocca applyStaticTranslations. Si
// ridisegnano dallo STATO IN MEMORIA, nessun fetch:
// - updateMapRecordButton sempre (il tasto vive nella barra della Mappa, sempre a video);
// - se si sta registrando: renderTrackingUi (stats/badge/bottoni da trackingState) +
//   setSyncBadge(ultimoStatoSync);
// - il <select> escursione solo se #map-section e' attiva (gate come le aree 1-3);
// - il riepilogo solo se il suo pannello e' gia' aperto (renderSummary rigioca
//   ultimaSessioneRiepilogo; showPanel dentro e' un no-op se il pannello e' gia' visibile).
// Durante una registrazione attiva molti testi si riallineano comunque da soli entro 1s
// (uiTimer) / al fix successivo: questo handler serve alla reattivita' immediata e agli
// stati fermi (pausa, riepilogo).
if (window.CamoscioI18n && window.CamoscioI18n.onChange) {
    window.CamoscioI18n.onChange(function () {
        updateMapRecordButton();
        renderMiniBarIcon();

        const sez = document.getElementById('map-section');
        if (sez && sez.classList.contains('active') && trackingState.status === 'idle') {
            renderHikeSelectOptions();
        }

        if (trackingState.status === 'active' || trackingState.status === 'paused') {
            renderTrackingUi();
            if (ultimoStatoSync) setSyncBadge(ultimoStatoSync);
        }

        const panel = document.getElementById('tracking-panel');
        const summary = document.getElementById('tracking-state-summary');
        if (panel && summary && !panel.classList.contains('hidden') && !summary.classList.contains('hidden')) {
            renderSummary(ultimaSessioneRiepilogo);
        }
    });
}
