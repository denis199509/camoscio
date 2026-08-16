// Punto 26 di cose_da_fare.txt - "premo il tasto della posizione e mi dice permesso negato,
// e comunque non vedo nessun puntino blu".
//
// Questo modulo e' l'UNICO proprietario della geolocalizzazione "di visualizzazione" (il
// puntino blu sulla mappa). Il tracciamento vero e proprio di un'escursione resta di
// tracking.js: sono due cose diverse e devono restare separate, ma NON devono tenere acceso
// il GPS due volte - vedi usaFonteEsterna() piu' sotto.
//
// COSA SI E' CAPITO PIANIFICANDO, e che vale la pena non riscoprire da capo:
//  - una volta che il browser ha negato il permesso, una pagina web NON PUO' PIU' chiederlo.
//    Non esiste nessuna funzione per farlo: e' cosi' apposta. L'unica cosa utile e' spiegare
//    all'utente dove si sblocca a mano, ed e' proprio quello che l'app non faceva.
//  - su iPhone la causa piu' frequente non e' il sito bloccato ma Impostazioni iOS ->
//    Privacy -> Localizzazione -> Safari. Dall'interno del browser i due casi sono
//    INDISTINGUIBILI (arriva lo stesso identico errore), quindi la guida deve nominarli
//    entrambi invece di indovinare.
//  - Safari NON implementa 'geolocation' nella Permissions API: navigator.permissions.query
//    solleva un'eccezione invece di rispondere. Va sempre avvolta in try/catch, altrimenti su
//    iPhone si rompe tutto prima ancora di chiedere la posizione.

const geoState = {
    watchId: null,
    ultimaPosizione: null,   // { lat, lng, precisioneM, quando }
    acceso: false,           // l'utente vuole vedere il puntino
    fonteEsterna: false,     // i fix arrivano da tracking.js: non aprire un secondo watch
    guidaGiaMostrata: false, // non ripetere la finestra ad ogni fix fallito
    approssimata: false      // si e' dovuto ripiegare sulla stima wi-fi/celle (vedi sotto)
};

const ascoltatoriPosizione = [];

// Stesse opzioni gia' collaudate dal tracciamento (tracking.js): alta precisione, un fix
// vecchio al massimo 5s va bene, e 20 secondi di pazienza. Il timeout lungo serve davvero:
// un GPS che parte da freddo all'aperto ci mette spesso piu' di 10 secondi al primo fix, e
// col vecchio timeout di 10s l'utente vedeva un errore invece della sua posizione.
const OPZIONI_GPS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };

// RIPIEGO (punto 28): posizione stimata da wi-fi e celle telefoniche, senza satelliti.
// Serve nel caso piu' comune di tutti mentre si prova il sito: dentro casa il GPS non
// vede il cielo e fallisce con codice 2 o 3, mentre la stima di rete arriva quasi
// sempre. Un puntino largo trecento metri, col suo cerchio che lo dichiara, e' comunque
// un'informazione vera; nessun puntino non lo e'.
// Solo per il PUNTINO, mai per il tracciamento: registrare una traccia GPS con fix da
// wi-fi vorrebbe dire scrivere nello storico dei chilometri che non si sono camminati.
// maximumAge piu' alto (1 minuto) perche' una stima di rete di un minuto fa e' comunque
// buona quanto quella nuova: sono entrambe centinaia di metri.
const OPZIONI_GPS_APPROSSIMATE = { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 };

// Indirizzo della pagina di diagnosi (punto 28). Sta in public/ e non richiede accesso:
// deve funzionare anche quando il resto dell'app non funziona.
const PAGINA_DIAGNOSI = '/diagnostica-gps.html';

// --- Permessi ---

// 'concesso' | 'negato' | 'da-chiedere' | 'sconosciuto'
// 'sconosciuto' NON e' un errore: e' la risposta normale su Safari/iOS, dove l'unico modo di
// sapere com'e' messo il permesso e' provare a chiedere la posizione.
async function statoPermesso() {
    if (!navigator.permissions || !navigator.permissions.query) return 'sconosciuto';
    try {
        const esito = await navigator.permissions.query({ name: 'geolocation' });
        if (esito.state === 'granted') return 'concesso';
        if (esito.state === 'denied') return 'negato';
        return 'da-chiedere';
    } catch (e) {
        return 'sconosciuto'; // Safari: 'geolocation' non e' un nome valido per query()
    }
}

// --- Consenso dell'utente (quello scelto in registrazione, non quello del browser) ---
//
// Sono due permessi diversi e vanno tenuti distinti: il browser decide se il SITO puo'
// leggere il GPS, questo campo dice se l'UTENTE ha acconsentito a usarlo (punto 8 della
// prima lista, salvato sul database in Fase C). Accendere un GPS continuo a chi in
// registrazione ha risposto di no sarebbe una contraddizione, per quanto tecnicamente
// possibile.
function serveConsenso() {
    const usr = window.CamoscioState && window.CamoscioState.currentUser;
    return !!(usr && !usr.geolocationConsent && !usr.isDemoAccount);
}

// Chiede all'utente di attivare il consenso e lo salva. Ritorna true se si puo' procedere.
// Vive qui e non in tracking.js perche' ora serve a entrambi: prima era scritto solo la', e
// lasciarne due copie avrebbe voluto dire due volte lo stesso salvataggio da tenere allineato
// a mano. Il messaggio resta un parametro: "ti mostro dove sei" e "registro il tuo percorso"
// sono richieste diverse e vanno spiegate in modo diverso.
const MOTIVO_PREDEFINITO =
    "Per mostrare la tua posizione reale sulla mappa serve il GPS del telefono. Avevi lasciato il consenso alla geolocalizzazione disattivato in registrazione: vuoi attivarlo ora?";

async function assicuraConsenso(motivo = MOTIVO_PREDEFINITO) {
    if (!serveConsenso()) return true;

    const procedi = await window.showConfirmModal(motivo);
    if (!procedi) return false;

    const usr = window.CamoscioState.currentUser;
    try {
        await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geolocationConsent: true })
        });
        usr.geolocationConsent = true;
    } catch (e) {
        // Si prosegue lo stesso: l'utente ha appena detto di si', non ha senso bloccarlo
        // perche' il salvataggio non e' andato a buon fine. Verra' richiesto la volta dopo.
        console.error("Impossibile salvare il consenso alla geolocalizzazione:", e);
    }
    return true;
}

// --- Messaggi di errore ---

// Prima esisteva UN SOLO messaggio per qualunque errore ("Impossibile ottenere la posizione
// GPS reale"), che nascondeva la differenza fra "hai bloccato il permesso" e "il GPS non ha
// ancora agganciato": due situazioni con rimedi opposti.
function descriviErrore(err) {
    if (!err) return { negato: false, testo: "Impossibile ottenere la posizione." };

    if (err.code === 1 /* PERMISSION_DENIED */) {
        return { negato: true, testo: "Permesso di posizione negato." };
    }
    if (err.code === 2 /* POSITION_UNAVAILABLE */) {
        // Punto 28 - questo messaggio prima diceva SOLO "prova all'aperto", e mandava
        // fuori casa per niente chi aveva semplicemente l'interruttore della posizione
        // spento. Le due cause sono diversissime e vanno nominate entrambe, con davanti
        // quella che si risolve senza muoversi.
        return {
            negato: false,
            configurazione: true,
            testo: "Il telefono non dà nessuna posizione. O la localizzazione del dispositivo è spenta, o sei al chiuso e il GPS non vede i satelliti."
        };
    }
    if (err.code === 3 /* TIMEOUT */) {
        return {
            negato: false,
            testo: "Il GPS ci sta mettendo troppo. Al primo aggancio della giornata può volerci qualche minuto all'aperto: riprova fra poco."
        };
    }
    return { negato: false, testo: "Impossibile ottenere la posizione." };
}

// Guida allo sblocco. Nomina ENTRAMBI i casi (sito bloccato / localizzazione spenta per il
// browser) perche' da dentro la pagina non c'e' modo di distinguerli, e mette per primo
// quello del sistema che si sta usando.
//
// PUNTO 28 - DIFETTO VERO TROVATO QUI, segnalato dall'utente provando dal telefono: questa
// guida elencava DUE livelli (il sito e l'app Chrome) e si fermava li'. Su Android i livelli
// sono TRE, e il primo - l'interruttore generale della posizione del telefono - e' proprio
// quello che manca piu' spesso, perche' e' l'unico che non si trova cercando "Chrome" nelle
// impostazioni. L'utente aveva controllato i due elencati qui, li aveva trovati a posto, e la
// guida non aveva altro da dirgli. Il triangolo di avviso che Chrome disegna accanto a un
// permesso "consentito" segnala esattamente questo: sito a posto, livello sotto chiuso.
async function mostraGuidaSblocco() {
    // Il caso dell'indirizzo locale http://192.168... aperto dal telefono in wifi: li' il
    // browser risponde "negato" anche se l'utente non ha mai bloccato niente, ed e' una
    // trappola in cui e' facilissimo cadere provando il sito senza metterlo online.
    if (!window.isSecureContext) {
        window.showAlertModal(
            "La posizione è bloccata perché questa pagina non è su una connessione sicura (https).\n\n" +
            "Non è un blocco che hai messo tu: i browser vietano il GPS a qualunque pagina aperta in http, e rispondono comunque \"permesso negato\".\n\n" +
            "Apri il sito su https://camoscio.onrender.com e la posizione funzionerà."
        );
        return;
    }

    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    const safari =
        "iPhone / iPad (Safari) — tre livelli, servono tutti e tre\n" +
        "1. Impostazioni iOS → Privacy e sicurezza → Localizzazione: accesa\n" +
        "2. Nella stessa schermata, più in basso: Safari → «Durante l'uso dell'app»\n" +
        "   (è il caso più frequente, e dal sito non si può distinguere dal punto 3)\n" +
        "3. Nel sito: «aA» nella barra dell'indirizzo → Impostazioni sito web → Posizione → Consenti";

    const chrome =
        "Android (Chrome) — tre livelli, servono tutti e tre\n" +
        "1. Posizione del TELEFONO: scorri in giù la tendina delle impostazioni rapide e\n" +
        "   controlla che «Posizione» sia accesa (o Impostazioni Android → Posizione).\n" +
        "   È quello che manca più spesso, ed è l'unico che non si trova cercando «Chrome».\n" +
        "2. Permesso dell'APP Chrome: Impostazioni Android → App → Chrome → Autorizzazioni\n" +
        "   → Posizione → consentita, con «posizione precisa» attiva\n" +
        "3. Permesso del SITO: tocca il lucchetto accanto all'indirizzo → Autorizzazioni\n" +
        "   → Posizione → Consenti\n" +
        "Se accanto al permesso vedi un triangolo di avviso, il sito è a posto ed è chiuso\n" +
        "uno dei due livelli sopra: toccando il triangolo Chrome dice quale.";

    const apri = await window.showConfirmModal(
        "La posizione non arriva, e da qui non posso sbloccarla: va riattivata a mano.\n\n" +
        (iOS ? safari + "\n\n" + chrome : chrome + "\n\n" + safari) +
        "\n\nPoi ricarica la pagina.\n\n" +
        "Se dopo questi passaggi non funziona ancora, apri la pagina di diagnosi: prova la " +
        "posizione in tre modi diversi e dice quale dei livelli è chiuso.\n\n" +
        "Vuoi aprirla adesso?"
    );
    if (apri) window.location.href = PAGINA_DIAGNOSI;
}

// Da usare quando l'errore arriva davvero da un tentativo: mostra la guida solo se il
// problema e' il permesso, e una volta sola per non tempestare di finestre chi cammina.
//
// PUNTO 28 - la guida ora si apre anche per il codice 2, ma SOLO se non si e' mai avuta
// una posizione da quando la pagina e' aperta. E' la differenza fra due situazioni che
// arrivano con lo stesso identico codice d'errore:
//  - non e' MAI arrivato niente -> qualcosa e' spento, e serve la guida coi tre livelli;
//  - arrivava e si e' interrotto -> una galleria, un bosco fitto, un tornante in ombra:
//    e' normale, passa da solo, e una finestra da chiudere mentre si cammina sarebbe
//    solo un fastidio (per giunta col telefono in tasca).
function segnalaErrore(err, forzaGuida = false) {
    const { negato, configurazione, testo } = descriviErrore(err);
    const maiAvutaPosizione = !geoState.ultimaPosizione;

    if (negato || (configurazione && maiAvutaPosizione)) {
        if (!geoState.guidaGiaMostrata || forzaGuida) {
            geoState.guidaGiaMostrata = true;
            mostraGuidaSblocco();
            return { negato, testo };
        }
    }
    if (window.showToast) window.showToast(testo, "error");
    return { negato, testo };
}

// --- Puntino: accensione e spegnimento ---

function notificaPosizione(lat, lng, precisioneM) {
    geoState.ultimaPosizione = { lat, lng, precisioneM, quando: Date.now() };
    ascoltatoriPosizione.forEach(cb => {
        try {
            cb(lat, lng, precisioneM);
        } catch (e) {
            console.error("Ascoltatore della posizione in errore:", e);
        }
    });
}

function avviaWatch() {
    if (geoState.watchId !== null || geoState.fonteEsterna) return;
    geoState.watchId = navigator.geolocation.watchPosition(
        pos => notificaPosizione(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        err => {
            // Un errore isolato durante il cammino (una galleria, un bosco fitto) non deve
            // spegnere il puntino: si tiene l'ultima posizione nota e si aspetta il fix dopo.
            console.warn("Errore geolocalizzazione (puntino):", err.message);

            if (err.code === 1) {
                fermaWatch();
                geoState.acceso = false;
                aggiornaTasto();
                segnalaErrore(err);
                return;
            }

            // Punto 28 - il GPS non aggancia e non abbiamo ancora mostrato NIENTE: prima di
            // lasciare la mappa vuota si riprova con la stima da wi-fi e celle. Una volta
            // sola: qui sotto approssimata e' gia' true, quindi questo ramo non si ripete e
            // non c'e' modo di entrare in un giro infinito di riavvii.
            // Non si degrada se una posizione era gia' arrivata: in quel caso il problema e'
            // passeggero e il fix buono torna da solo, mentre passare alla stima di rete
            // farebbe PEGGIORARE il puntino da dieci metri a trecento.
            if (!geoState.approssimata && !geoState.ultimaPosizione) {
                geoState.approssimata = true;
                fermaWatch();
                avviaWatch();
            }
        },
        geoState.approssimata ? OPZIONI_GPS_APPROSSIMATE : OPZIONI_GPS
    );
}

function fermaWatch() {
    if (geoState.watchId !== null) {
        navigator.geolocation.clearWatch(geoState.watchId);
        geoState.watchId = null;
    }
}

// Accende il puntino. Con automatico=true (ingresso nella sezione Mappa) non insiste: se il
// permesso e' negato o il consenso e' spento resta spento in silenzio, senza aprire finestre
// a chi voleva solo guardare la mappa. Con automatico=false (l'utente ha premuto il tasto)
// chiede il permesso e, se e' bloccato, spiega come si sblocca.
async function accendi(automatico = false) {
    if (!navigator.geolocation) {
        if (!automatico && window.showToast) {
            window.showToast("Il tuo browser non supporta la geolocalizzazione.", "error");
        }
        return false;
    }

    if (serveConsenso()) {
        if (automatico) return false;
        if (!(await assicuraConsenso())) return false;
    }

    const stato = await statoPermesso();
    if (stato === 'negato') {
        // Su alcuni browser, con il permesso gia' negato, getCurrentPosition fallisce in
        // silenzio senza chiamare nemmeno la funzione d'errore: chiedere sarebbe inutile.
        if (!automatico) mostraGuidaSblocco();
        return false;
    }
    if (stato === 'da-chiedere' && automatico) {
        // Il riquadro del browser lo si fa comparire quando l'utente ha chiesto qualcosa,
        // non appena apre una schermata: chiedere a freddo si prende quasi sempre un "no",
        // e quel no poi non si puo' piu' correggere da qui.
        return false;
    }

    geoState.acceso = true;
    geoState.guidaGiaMostrata = false;
    avviaWatch();
    aggiornaTasto();

    // Il watch puo' metterci un po' a dare il primo fix; una lettura singola in parallelo
    // fa comparire il puntino subito quando la posizione e' gia' nota al telefono.
    if (!geoState.fonteEsterna) {
        const arrivata = pos =>
            notificaPosizione(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);

        navigator.geolocation.getCurrentPosition(
            arrivata,
            err => {
                // Punto 28 - stesso ripiego del watch: prima di dire all'utente che non si
                // puo', si prova la stima da wi-fi e celle. Il codice 1 (permesso negato) e'
                // escluso di proposito - li' non c'e' niente da riprovare, nessuna opzione
                // cambia un permesso bloccato, e insistere ruberebbe solo qualche secondo
                // prima della spiegazione che serve davvero.
                if (err.code === 2 || err.code === 3) {
                    navigator.geolocation.getCurrentPosition(
                        pos => { geoState.approssimata = true; arrivata(pos); },
                        errRipiego => {
                            // Ne' i satelliti ne' la stima di rete, e niente e' mai arrivato:
                            // qui non c'e' piu' nulla da aspettare. Si spegne tutto invece di
                            // lasciare acceso un watch condannato - che consuma batteria per
                            // niente - e il tasto illuminato come se il puntino fosse sulla
                            // mappa. Il tasto torna a dire "Dove sono", che e' la verita'.
                            if (!geoState.ultimaPosizione) spegni();
                            if (!automatico) segnalaErrore(errRipiego);
                        },
                        OPZIONI_GPS_APPROSSIMATE
                    );
                    return;
                }
                if (!automatico) segnalaErrore(err);
            },
            OPZIONI_GPS
        );
    }
    return true;
}

function spegni() {
    geoState.acceso = false;
    fermaWatch();
    // Il ripiego sulla stima di rete vale per il tentativo appena concluso, non per sempre:
    // uscendo di casa il GPS torna a vedere il cielo, e la riaccensione successiva deve
    // ripartire dall'alta precisione. Si azzera QUI e non in accendi() di proposito: qui il
    // watch e' appena stato fermato, mentre accendi() puo' essere richiamata a puntino gia'
    // acceso (ci passa la navigazione ogni volta che si apre la Mappa) e cambiare la bandiera
    // sotto a un watch in corso vorrebbe dire dichiarare opzioni diverse da quelle in uso.
    geoState.approssimata = false;
    if (window.rimuoviPuntinoPosizione) window.rimuoviPuntinoPosizione();
    aggiornaTasto();
}

// Sospende il NOSTRO watch senza spegnere il puntino: da qui in poi i fix arrivano da
// tracking.js, che ne ha gia' uno acceso per registrare il percorso. Cosi' durante
// un'escursione il GPS resta acceso una volta sola - che e' proprio il momento in cui la
// batteria conta di piu'.
function usaFonteEsterna(attiva) {
    geoState.fonteEsterna = !!attiva;
    if (attiva) {
        fermaWatch();
    } else if (geoState.acceso) {
        avviaWatch();
    }
    aggiornaTasto();
}

// Ingresso pubblico per i fix che arrivano da tracking.js.
function pushPosition(lat, lng, precisioneM) {
    if (!geoState.acceso) return;
    notificaPosizione(lat, lng, precisioneM);
}

function aggiornaTasto() {
    if (window.aggiornaTastoPosizione) window.aggiornaTastoPosizione(geoState.acceso);
}

// --- Punto 45: posizione singola e affidabile per piantare una segnalazione di pericolo ---
//
// ultimaPosizione() da sola non basta: puo' essere vecchia di minuti (utente fermo, il
// puntino non si aggiorna) o arrivata dal ripiego wi-fi/celle (larga centinaia di metri, vedi
// OPZIONI_GPS_APPROSSIMATE sopra) - mai piantare un pericolo dove ci si trovava 40 minuti fa.
// Si accetta la posizione gia' nota solo se fresca E precisa, altrimenti si chiede un fix
// singolo nuovo (non un watch: qui serve un punto solo, non un inseguimento continuo).
const SEGNALAZIONE_MAX_ETA_MS = 60 * 1000;
const SEGNALAZIONE_MAX_PRECISIONE_M = 50;

function posizioneAbbastanzaBuonaPerSegnalazione(p) {
    if (!p) return false;
    const fresca = (Date.now() - p.quando) < SEGNALAZIONE_MAX_ETA_MS;
    const precisa = typeof p.precisioneM !== 'number' || p.precisioneM <= SEGNALAZIONE_MAX_PRECISIONE_M;
    return fresca && precisa;
}

// Promise<{lat,lng}> oppure null se il GPS non risponde. Non chiede da sola il consenso
// dell'utente (Fase C): chi chiama - il pannello "segnala pericolo" - deve gia' aver
// chiamato assicuraConsenso() prima, stesso schema gia' in uso in startTracking().
function posizioneSegnalazione() {
    return new Promise((resolve) => {
        if (posizioneAbbastanzaBuonaPerSegnalazione(geoState.ultimaPosizione)) {
            resolve({ lat: geoState.ultimaPosizione.lat, lng: geoState.ultimaPosizione.lng });
            return;
        }
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null),
            OPZIONI_GPS
        );
    });
}

window.CamoscioGeo = {
    statoPermesso,
    assicuraConsenso,
    serveConsenso,
    posizioneSegnalazione,
    descriviErrore,
    segnalaErrore,
    mostraGuidaSblocco,
    accendi,
    spegni,
    usaFonteEsterna,
    pushPosition,
    isAcceso: () => geoState.acceso,
    ultimaPosizione: () => geoState.ultimaPosizione,
    // Ritorna la funzione per disiscriversi: serve a chi ascolta solo il PRIMO fix (es. il
    // tasto che aspetta la posizione per centrare la mappa), altrimenti ad ogni pressione
    // resterebbe attaccato un ascoltatore in piu' per tutta la durata della pagina.
    //
    // Chi si iscrive quando una posizione e' GIA' nota la riceve subito. Senza questo,
    // l'ordine di partenza dei moduli cambierebbe il risultato: initMapModule aspetta il
    // caricamento dei confini regionali prima di iscriversi, e un fix arrivato in quel
    // frattempo andava perso: il puntino non compariva fino al fix successivo. Misurato dal
    // vivo, e' la stessa classe di problema gia' documentata in cronologia.txt (non collegare
    // mai gli ascoltatori dopo un await che carica dati).
    onPosizione: cb => {
        ascoltatoriPosizione.push(cb);
        const p = geoState.ultimaPosizione;
        if (p && geoState.acceso) {
            try {
                cb(p.lat, p.lng, p.precisioneM);
            } catch (e) {
                console.error("Ascoltatore della posizione in errore:", e);
            }
        }
        return () => {
            const i = ascoltatoriPosizione.indexOf(cb);
            if (i >= 0) ascoltatoriPosizione.splice(i, 1);
        };
    }
};
