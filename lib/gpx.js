// ==========================================================================
// LETTURA FILE .GPX — punto 15 di cose_da_fare.txt
// "Caricare file .gpx come escursioni gia' fatte, per costruirsi uno storico
//  anche delle uscite fatte prima di usare il sito."
//
// NIENTE LIBRERIE XML, ed e' una scelta di sicurezza oltre che di peso. In Fase G
// era gia' stato scartato osmtogeojson perche' ogni sua versione su npm si porta
// dietro xmldom, con vulnerabilita' critiche irrisolte. Qui il problema si evita
// alla radice: non si costruisce nessun albero XML e soprattutto NON SI RISOLVE
// NESSUNA ENTITA'. E' proprio la risoluzione delle entita' a rendere possibili i
// due attacchi classici dei lettori XML - XXE (far leggere al server un file suo,
// tipo .env, e rimandarlo indietro) e "billion laughs" (poche righe di file che
// si espandono in gigabyte e fanno finire la memoria). Un .gpx qui e' solo testo
// da cui si estraggono numeri.
//
// Il formato e' semplice: <trkpt lat=".." lon=".."> con dentro <ele> e <time>.
// ==========================================================================

const { isFiniteNum } = require('./geometry');

// Tetto al numero di punti letti. Una registrazione di 10 ore a un punto al secondo
// fa 36.000 punti: 200.000 e' fuori da qualunque uso reale ed e' li' per fermare un
// file costruito apposta, non un escursionista. Senza un tetto, un file grande basta
// a far finire la memoria del server - su Render ce ne sono 512 MB in tutto e in Fase
// G il sito e' gia' andato in 502 proprio per questo.
const MAX_PUNTI = 200000;

// Un <trkpt> puo' essere scritto in tre modi diversi e li accettiamo tutti:
// con contenuto, vuoto (<trkpt ...></trkpt>) o autochiuso (<trkpt ... />).
// Il prefisso opzionale (\w+:) copre i file con namespace esplicito (<gpx:trkpt>),
// che alcuni programmi producono.
function regexPunti(tag) {
    return new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'gi');
}

function attributo(testoAttributi, nome) {
    const m = new RegExp(`\\b${nome}\\s*=\\s*["']([^"']*)["']`, 'i').exec(testoAttributi);
    return m ? m[1] : null;
}

function elemento(contenuto, nome) {
    if (!contenuto) return null;
    const m = new RegExp(`<(?:\\w+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'i').exec(contenuto);
    return m ? m[1].trim() : null;
}

// Errore con un messaggio gia' scritto per l'utente: chi carica un file e si sente
// dire "errore di analisi" non sa che farsene. Ogni motivo di rifiuto dice cosa e'
// successo e, quando si puo', cosa fare.
class ErroreGpx extends Error {
    constructor(messaggio) {
        super(messaggio);
        this.name = 'ErroreGpx';
        this.utente = true; // distingue "file sbagliato" da "il server ha un problema"
    }
}

// Legge il testo di un .gpx e restituisce i punti nel formato compatto della Fase F:
// [lng, lat, altitudine, secondi-da-inizio, precisione].
//
// La PRECISIONE resta 0 per i punti importati, e non e' una dimenticanza: il formato
// .gpx non la contiene affatto. Zero qui non vuol dire "precisione perfetta" - quel
// valore viene letto solo durante una registrazione dal vivo (public/js/tracking.js,
// per decidere quanto essere tolleranti nell'agganciare il punto a un sentiero), cosa
// che su una traccia gia' conclusa non succede mai.
function parseGpx(testo) {
    if (typeof testo !== 'string' || !testo.trim()) {
        throw new ErroreGpx('Il file e\' vuoto.');
    }
    if (!/<gpx[\s>]/i.test(testo)) {
        throw new ErroreGpx('Questo non sembra un file .gpx: manca l\'elemento <gpx> di apertura.');
    }

    // I <trkpt> sono i punti di una traccia REGISTRATA, cioe' quello che serve al punto
    // 15 ("uscite gia' fatte"). I <rtept> sono un itinerario PROGETTATO, senza orari:
    // si accettano solo se non c'e' nessuna traccia, e piu' sotto verranno comunque
    // rifiutati per mancanza di orari, con un messaggio che spiega la differenza.
    let grezzi = [...testo.matchAll(regexPunti('trkpt'))];
    let tipo = 'traccia';
    if (grezzi.length === 0) {
        grezzi = [...testo.matchAll(regexPunti('rtept'))];
        tipo = 'itinerario';
    }
    if (grezzi.length === 0) {
        throw new ErroreGpx('Nel file non c\'e\' nessun punto GPS (<trkpt>). Se e\' un file di soli waypoint non contiene un percorso da importare.');
    }
    if (grezzi.length > MAX_PUNTI) {
        throw new ErroreGpx(`Il file contiene ${grezzi.length.toLocaleString('it-IT')} punti, troppi per essere una registrazione reale (limite ${MAX_PUNTI.toLocaleString('it-IT')}).`);
    }

    const letti = [];
    let ultimaQuota = null;
    let scartatiCoordinate = 0;

    for (const m of grezzi) {
        const attributi = m[1] || '';
        const contenuto = m[2] || '';

        const lat = parseFloat(attributo(attributi, 'lat'));
        const lng = parseFloat(attributo(attributi, 'lon'));
        if (!isFiniteNum(lat) || !isFiniteNum(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            scartatiCoordinate++;
            continue;
        }

        // Quota mancante su un punto: si eredita l'ultima nota invece di buttare via il
        // punto, stesso criterio di sanitizePoints in routes/tracking.js (i telefoni senza
        // barometro la omettono spesso).
        const eleTesto = elemento(contenuto, 'ele');
        const ele = eleTesto !== null ? parseFloat(eleTesto) : NaN;
        const quota = isFiniteNum(ele) ? ele : ultimaQuota;
        if (isFiniteNum(quota)) ultimaQuota = quota;

        const timeTesto = elemento(contenuto, 'time');
        const ms = timeTesto ? Date.parse(timeTesto) : NaN;

        letti.push({ lat, lng, quota, ms: Number.isFinite(ms) ? ms : null });
    }

    if (letti.length < 2) {
        // Il messaggio dice i NUMERI e non solo "non bastano": e' la differenza fra una
        // segnalazione su cui si puo' indagare e un rifiuto muto. Se un giorno un file
        // vero venisse respinto qui, questi due numeri dicono da soli se il problema e'
        // nel file o nel lettore.
        throw new ErroreGpx(
            `Nel file ci sono ${grezzi.length.toLocaleString('it-IT')} punti, ma solo ${letti.length} con coordinate valide: non bastano per ricostruire un percorso.`
        );
    }

    const conOrario = letti.filter(p => p.ms !== null);

    // DUE STRADE. La seconda esiste per una decisione presa dall'utente il 2026-07-27,
    // dopo che un suo file vero e' stato rifiutato.
    //
    // Prima un file senza orari veniva RESPINTO, e il motivo era buono: la durata non si
    // puo' inventare, e una durata pari a zero finita nei totali della Dashboard
    // gonfierebbe la velocita' media di TUTTO lo storico. Solo che il punto 15 serve a
    // "costruirsi uno storico": rifiutare un'escursione davvero fatta perche' il file non
    // porta gli orari va esattamente contro il suo scopo.
    // Ora si accetta e si MARCA. Distanza e dislivello stanno nel file e sono veri; la
    // durata resta ignota, e chi somma i totali salta queste uscite nel tempo e nella
    // velocita' (vedi /totals in routes/tracking.js). Cosi' l'uscita entra nello storico
    // senza che nessun numero diventi falso - che era la ragione del divieto.
    const durataIgnota = conOrario.length < 2;
    const avvisi = [];
    let punti = [];
    let inizioMs = null;
    let fineMs = null;

    if (!durataIgnota) {
        // In ordine di tempo: un .gpx puo' avere piu' <trkseg> (uno per ogni pausa) o piu'
        // <trk>, e niente garantisce che siano scritti in ordine. Poi si tengono solo i punti
        // con orario STRETTAMENTE crescente, come fa gia' il tracciamento dal vivo.
        conOrario.sort((a, b) => a.ms - b.ms);
        inizioMs = conOrario[0].ms;

        let ultimoMs = -Infinity;
        let ultimaQuotaValida = 0;
        for (const p of conOrario) {
            if (p.ms <= ultimoMs) continue;
            ultimoMs = p.ms;
            const quota = isFiniteNum(p.quota) ? p.quota : ultimaQuotaValida;
            ultimaQuotaValida = quota;
            punti.push([
                +p.lng.toFixed(7),
                +p.lat.toFixed(7),
                Math.round(quota),
                Math.round((p.ms - inizioMs) / 1000),
                0
            ]);
        }
        fineMs = ultimoMs;

        if (punti.length < 2) {
            throw new ErroreGpx('Tutti i punti del file hanno lo stesso orario: non e\' una registrazione utilizzabile.');
        }

        const senzaOrario = letti.length - conOrario.length;
        if (senzaOrario > 0) {
            avvisi.push(`${senzaOrario} punti erano senza orario e sono stati saltati.`);
        }
    } else {
        // Senza orari non c'e' niente su cui ordinare: si tiene l'ordine del file, che e'
        // l'ordine di percorrenza in qualunque .gpx (i punti di un <trkseg> sono in
        // sequenza per definizione del formato).
        // Il quarto valore della tupla resta 0 per ogni punto: e' il "secondi da inizio",
        // e qui non si sa. Zero non vuol dire "istante zero" - vuol dire che quel campo
        // non e' usato, ed e' coerente col fatto che la durata sia dichiarata ignota.
        let ultimaQuotaValida = 0;
        let precedente = null;
        for (const p of letti) {
            // Punti consecutivi identici: senza orari non c'e' modo di distinguere una
            // sosta da un doppione, e in un percorso non aggiungono niente.
            if (precedente && p.lat === precedente.lat && p.lng === precedente.lng) continue;
            precedente = p;
            const quota = isFiniteNum(p.quota) ? p.quota : ultimaQuotaValida;
            ultimaQuotaValida = quota;
            punti.push([+p.lng.toFixed(7), +p.lat.toFixed(7), Math.round(quota), 0, 0]);
        }

        if (punti.length < 2) {
            throw new ErroreGpx('Tutti i punti del file hanno le stesse coordinate: non c\'e\' nessun percorso da importare.');
        }

        // La DATA si sa quasi sempre anche quando la durata no: sta nell'intestazione del
        // file (<metadata><time> o <trk><time>), oppure in quell'unico punto che aveva un
        // orario. Serve perche' nello storico un'uscita senza data non si colloca nel tempo.
        const soloUno = conOrario.length === 1 ? conOrario[0].ms : null;
        const dallIntestazione = orarioIntestazione(testo, grezzi[0] ? grezzi[0].index : testo.length);
        inizioMs = soloUno !== null ? soloUno : dallIntestazione;
        fineMs = inizioMs;

        avvisi.push(tipo === 'itinerario'
            ? 'Il file e\' un itinerario progettato (<rtept>), non una registrazione: non ha gli orari. L\'uscita entra nello storico con distanza e dislivello, senza durata.'
            : 'Il file non contiene gli orari dei punti (<time>): l\'uscita entra nello storico con distanza e dislivello veri, ma senza durata. Non viene conteggiata nel tempo totale ne\' nella velocita\' media, che restano cosi\' corretti.');

        if (inizioMs === null) {
            avvisi.push('Nel file non c\'e\' nessuna data: viene usata quella di oggi come giorno dell\'uscita.');
        }
    }

    if (scartatiCoordinate > 0) {
        avvisi.push(`${scartatiCoordinate} punti avevano coordinate non valide e sono stati saltati.`);
    }
    if (ultimaQuota === null) {
        avvisi.push('Il file non contiene le altitudini: il dislivello risultera\' zero.');
    }

    return {
        punti,
        nome: elemento(testo, 'name') || null,
        inizio: inizioMs !== null ? new Date(inizioMs) : null,
        fine: fineMs !== null ? new Date(fineMs) : null,
        durataIgnota,
        tipo,
        avvisi
    };
}

// La data scritta nell'INTESTAZIONE del file, cioe' prima del primo punto: e' li' che
// stanno <metadata><time> e <trk><time>, che moltissimi programmi scrivono anche quando
// non mettono l'orario sui singoli punti.
// Si guarda solo la parte di testo che precede il primo punto proprio per non ripescare
// per sbaglio il <time> di un <trkpt>: se ce ne fossero due leggibili non saremmo qui.
function orarioIntestazione(testo, indiceprimoPunto) {
    const intestazione = testo.slice(0, indiceprimoPunto);
    const m = /<(?:\w+:)?time\b[^>]*>([\s\S]*?)<\/(?:\w+:)?time>/i.exec(intestazione);
    if (!m) return null;
    const ms = Date.parse(m[1].trim());
    return Number.isFinite(ms) ? ms : null;
}

// Distanza e dislivello di una traccia.
//
// IL DISLIVELLO NON SI CALCOLA COME NEL TRACCIAMENTO DAL VIVO, e la differenza e'
// necessaria. Dal vivo (routes/tracking.js) si somma il salto di quota fra due punti
// consecutivi solo se supera la soglia: funziona perche' il GPS di un telefono ballonzola
// di parecchi metri fra un fix e l'altro, quindi la soglia serve proprio a togliere quel
// tremolio.
// Un file .gpx pero' puo' arrivare da un orologio con ALTIMETRO BAROMETRICO, che produce
// una quota liscia e precisa: su una salita costante ogni singolo passo sale di pochi
// centimetri, NESSUN salto supera la soglia, e il dislivello totale verrebbe ZERO. Su
// un'escursione da 600 metri di dislivello e' un numero visibilmente falso.
// Qui la soglia si applica quindi al DISLIVELLO ACCUMULATO da un minimo locale, non al
// singolo passo: si tiene la quota piu' bassa vista di recente e si registra la salita
// solo quando ci si e' alzati di piu' della soglia sopra di essa. Cosi' una salita
// regolare viene contata tutta, e un tremolio di pochi metri attorno allo stesso valore
// continua a non contare - che era lo scopo della soglia.
// SOGLIA DEL DISLIVELLO: quanto bisogna essere saliti in tutto sopra l'ultimo avvallamento
// perche' la salita venga contata.
// STAVA IN routes/tracking.js ed e' stata spostata qui col punto 33, perche' ora la usano in
// due: il caricamento dei file .gpx e il dislivello dei percorsi progettati
// (lib/elevation.js). DEVE restare un valore solo - due soglie diverse vorrebbero dire che lo
// stesso percorso, progettato oppure camminato e poi importato, da' due numeri diversi.
//
// FINO AL 2026-07-28 IL TRACCIAMENTO DAL VIVO AVEVA UNA REGOLA SUA (MIN_ELEVATION_DELTA_M =
// 3 m applicati al salto fra DUE PUNTI CONSECUTIVI), perche' sembrava che qui non si potesse
// fare altrimenti: dal vivo i punti arrivano a gruppi e il totale si aggiorna man mano,
// quindi non si puo' guardare tutta la traccia insieme.
// SI PUO': a questa regola non serve tutta la traccia, le bastano il totale e la quota piu'
// bassa vista da quando si sta salendo. Tenendo quel secondo numero sulla sessione
// (elevationRefM), il conto fatto gruppo per gruppo e' identico a quello fatto in una
// passata sola. Ora la regola e' UNA per tutto il sito.
// Perche' e' stato necessario: sul GPS di un telefono, che sulla quota sbaglia molto piu' di
// 3 metri, la vecchia regola contava il tremolio come salita - 21 m di dislivello su una
// camminata di 137 metri in piano, misurati sui dati veri dell'utente.
// Misurato: con la regola del singolo passo un tremolio di +-2 m su un percorso PIATTO
// produceva 800 m di dislivello inventato; con questa produce zero, e una salita regolare da
// 598 m ne conta 596.
const SOGLIA_DISLIVELLO_M = 10;

// LA DISCESA, LA QUOTA MINIMA E LA MASSIMA sono state aggiunte col punto 33 (dislivello dei
// percorsi progettati). Sono un'AGGIUNTA PURA: chi chiamava questa funzione prima continua a
// leggere distanzaKm e dislivelloM e ignora il resto.
// NON si e' scritta una seconda funzione per i percorsi progettati, ed e' una scelta: e' la
// lezione del punto 18 ("quando lo stesso blocco compare due volte, la differenza fra le copie
// e' quasi sempre un difetto rimasto aperto in una sola"). Qui divergere vorrebbe dire una cosa
// precisa e brutta - lo stesso percorso, progettato o camminato e poi importato, darebbe due
// dislivelli diversi.
function statisticheTraccia(punti, sogliaDislivelloM, haversineKm) {
    let distanzaKm = 0;
    for (let i = 1; i < punti.length; i++) {
        const a = punti[i - 1], b = punti[i];
        distanzaKm += haversineKm(a[1], a[0], b[1], b[0]);
    }

    let dislivelloM = 0;
    let riferimento = punti[0][2]; // quota piu' bassa vista da quando si sta salendo
    for (let i = 1; i < punti.length; i++) {
        const quota = punti[i][2];
        if (quota > riferimento + sogliaDislivelloM) {
            dislivelloM += quota - riferimento;
            riferimento = quota;
        } else if (quota < riferimento) {
            // Si scende: il fondo di questa discesa diventa il nuovo punto di partenza
            // per misurare la prossima salita.
            riferimento = quota;
        }
    }

    // Regola speculare per la discesa: si tiene la quota piu' ALTA vista di recente e si
    // registra la discesa solo quando si e' scesi di piu' della soglia sotto di essa. Serve
    // la stessa soglia, e per lo stesso motivo: senza, il tremolio attorno a un valore
    // costante verrebbe contato come discesa.
    let discesaM = 0;
    let cima = punti[0][2];
    for (let i = 1; i < punti.length; i++) {
        const quota = punti[i][2];
        if (quota < cima - sogliaDislivelloM) {
            discesaM += cima - quota;
            cima = quota;
        } else if (quota > cima) {
            cima = quota;
        }
    }

    // Solo sulle quote che ci sono davvero: una traccia senza altitudine non deve produrre
    // una fascia di quota fatta di NaN.
    const quote = punti.map(p => p[2]).filter(q => typeof q === 'number' && Number.isFinite(q));

    return {
        distanzaKm: Math.round(distanzaKm * 1000) / 1000,
        dislivelloM: Math.round(dislivelloM),
        discesaM: Math.round(discesaM),
        quotaMinM: quote.length ? Math.round(Math.min(...quote)) : null,
        quotaMaxM: quote.length ? Math.round(Math.max(...quote)) : null
    };
}

// ==========================================================================
// TEMPO DI CAMMINO E PAUSE — punto 79 di cose_da_fare.txt
// "Il tempo invece no. Ha considerato 4h 53 min come tempo previsto. Invece
//  io ci ho messo 4h 53 min compreso tutte le pause. Si puo' estrarre dal
//  file gpx pure il tempo in movimento e le pause?"
//
// Progettato con l'agente architect prima di scrivere codice (tocca la stessa
// famiglia di calcoli del tempo di rientro). Decisioni di Denis: una sosta
// conta come pausa da 60s continuativi in poi; quando il file e' troppo rado
// per distinguere le pause in modo affidabile si dichiara "non disponibile",
// mai una stima spacciata per misura (stessa regola gia' presa ai punti 33 e
// 44 - "meglio nessun numero che un numero che sembra una misura e non lo e'").
// ==========================================================================

// Finestra minima (secondi) su cui si misura lo spostamento NETTO per giudicare se un
// punto e' dentro un tratto di cammino o di sosta. NETTO, non percorso cumulativo: un GPS
// fermo che deriva produce comunque un percorso cumulativo di decine di metri in 60s (letto
// come "sta camminando piano" se si guardasse solo la distanza percorsa), ma lo spostamento
// diretto inizio-fine della finestra resta quasi zero. Un camminatore vero, muovendosi in
// modo direzionale, ha spostamento netto vicino al percorso reale. La stessa finestra
// neutralizza anche il salto di GPS (un balzo di qualche decina di metri e ritorno: andata
// e ritorno si annullano nel netto).
const FINESTRA_SEC = 60;

// Velocita' sotto la quale un tratto e' "fermo". 0,28 m/s (~1 km/h) sta sotto qualunque
// cammino reale (CAI in piano = 4 km/h = 1,11 m/s; CAI in salita ripida, 400 m D+/h su una
// pendenza del 25%, e' circa 0,45 m/s al suolo) e sopra la deriva di un GPS fermo misurata
// su una finestra di 60s. E' una soglia stretta apposta: serve la finestra sopra per
// separare davvero le due popolazioni, non basterebbe restringerla o allargarla da sola.
const V_PAUSA_MS = 0.28;

// Quanto deve durare un tratto sotto soglia PRIMA di contare come pausa - scelta di Denis
// (60s): una sosta-foto di pochi secondi resta cammino, una sosta per bere/riposare diventa
// pausa.
const PAUSA_MIN_SEC = 60;

// Una breve ripartenza (sopra soglia ma per poco, e senza essersi spostati molto) non chiude
// davvero una pausa: e' piu' probabile un sobbalzo del GPS durante la sosta stessa che una
// vera ripartenza. Serve stare sopra soglia per ALMENO ripartenzaSec E aver percorso ALMENO
// ripartenzaMinM in linea d'aria perche' la pausa si consideri davvero finita.
const RIPARTENZA_SEC = 30;
const RIPARTENZA_MIN_M = 25;

// Un buco fra due punti CONSECUTIVI piu' lungo di questo (5 minuti) non e' un tratto lento:
// e' un pezzo di traccia che manca del tutto - tipico dell'auto-pause di molti orologi
// (smettono di registrare da fermi) o di un segnale perso. Sullo spostamento netto fra i due
// estremi si decide se e' una pausa quasi certa (poco spostamento: l'auto-pause ha funzionato
// esattamente per questo) o un buco che non si puo' interpretare (spostamento grande: il
// segnale e' stato perso mentre si continuava a camminare, es. in un canalone).
const BUCO_SEC = 300;
const BUCO_NETTO_MAX_M = 100;

// Sotto queste condizioni la traccia non basta a distinguere cammino da pausa in modo
// onesto: si dichiara "non disponibile" invece di inventare un numero che sembra una misura.
const CAMPIONAMENTO_MEDIO_MAX_SEC = 60; // oltre, un punto ogni tanto non racconta cosa succede fra due punti
const INCERTO_MAX_FRAZIONE = 0.10;      // troppa traccia "buchi grandi" per fidarsi del resto
const DURATA_MIN_SEC = 600;             // sotto 10 minuti la separazione non ha senso pratico
const PUNTI_MIN = 30;

// Separa cammino e pause da una traccia GIA' CON ORARI (punti nel formato compatto di
// parseGpx, [lng, lat, quota, secondiDaInizio, precisione], strettamente crescenti - non ha
// senso chiamarla su una traccia con durataIgnota, il chiamante non deve farlo).
//
// haversineKm iniettata come in statisticheTraccia sopra: stesso principio, nessuna
// dipendenza nascosta su lib/geometry dentro questo file.
function tempiTraccia(punti, haversineKm) {
    const n = punti.length;
    const totaleSec = n >= 2 ? punti[n - 1][3] - punti[0][3] : 0;
    const distM = (a, b) => haversineKm(a[1], a[0], b[1], b[0]) * 1000;

    const motivi = [];
    if (n < PUNTI_MIN) motivi.push(`La traccia ha solo ${n} punti: troppo pochi per distinguere cammino e pause.`);
    if (totaleSec < DURATA_MIN_SEC) motivi.push('La traccia dura meno di 10 minuti: la separazione non avrebbe senso pratico.');
    if (totaleSec <= 0 || n < 2) {
        return { totaleSec: Math.max(0, totaleSec), movimentoSec: 0, pausaSec: 0, incertoSec: Math.max(0, totaleSec), pause: [], attendibile: false, motivi };
    }

    const campionamentoMedioSec = totaleSec / (n - 1);
    if (campionamentoMedioSec > CAMPIONAMENTO_MEDIO_MAX_SEC) {
        motivi.push(`Il file registra un punto ogni ${Math.round(campionamentoMedioSec)} secondi in media: troppo rado per distinguere le soste dal cammino.`);
    }

    // --- 1. buchi: intervalli fra due punti consecutivi piu' lunghi di BUCO_SEC ---
    // Decisi subito, prima di tutto il resto: sui buchi non si puo' applicare la finestra
    // (non ci sono punti dentro su cui farla scorrere), e la finestra dei tratti "normali"
    // intorno a un buco non deve guardarci attraverso (vedi sotto, azzeramento di j).
    let pausaSec = 0, incertoSec = 0;
    const buco = new Array(n).fill(false); // buco[i] = true se l'intervallo (i-1,i) e' un buco
    const pause = [];

    for (let i = 1; i < n; i++) {
        const gap = punti[i][3] - punti[i - 1][3];
        if (gap > BUCO_SEC) {
            buco[i] = true;
            const netto = distM(punti[i - 1], punti[i]);
            if (netto < BUCO_NETTO_MAX_M) {
                pausaSec += gap;
                pause.push({ inizioSec: punti[i - 1][3], durataSec: gap });
            } else {
                incertoSec += gap;
            }
        }
    }

    // --- 2. classificazione grezza dei tratti "normali" (non buchi), su finestra ---
    // Per ogni punto i si fa scorrere all'indietro il puntatore j (mai oltre l'ultimo buco
    // attraversato: la finestra non guarda oltre un salto di 5+ minuti) finche' la finestra
    // [j, i] copre almeno FINESTRA_SEC. j si muove solo in avanti nel ciclo, quindi il costo
    // resta lineare nel numero di punti nonostante il ciclo annidato.
    // L'esito (sotto/sopra soglia) viene assegnato all'intervallo (i-1, i): la finestra
    // guarda indietro, quindi e' quell'intervallo il piu' rappresentato al suo interno.
    const rawSottoSoglia = new Array(n).fill(false); // indicizzato come buco[]: intervallo (i-1,i)
    let j = 0;
    for (let i = 1; i < n; i++) {
        if (buco[i]) { j = i; continue; }
        if (j < i && buco[j]) j = i; // il buco precedente ha gia' spostato j qui sopra: difesa in piu', non dovrebbe mai servire
        while (j < i - 1 && !buco[j + 1] && punti[i][3] - punti[j + 1][3] >= FINESTRA_SEC) j++;

        const windowSec = punti[i][3] - punti[j][3];
        if (windowSec <= 0) continue; // finestra vuota (subito dopo un buco): lascia l'intervallo come "sopra soglia" di default
        const velocita = distM(punti[j], punti[i]) / windowSec;
        rawSottoSoglia[i] = velocita < V_PAUSA_MS;
    }

    // --- 3. raggruppa i tratti normali in "run" consecutivi con la stessa classificazione grezza ---
    // Un run e' una sequenza di intervalli confinanti, tutti sotto soglia o tutti sopra,
    // delimitata anche dai buchi (un buco chiude sempre il run precedente).
    const run = []; // { sottoSoglia, iniziaA (indice punto), finisceA (indice punto), durataSec, spostamentoNettoM }
    let correnteInizio = null, correnteSotto = null;
    for (let i = 1; i <= n; i++) {
        const chiude = i === n || buco[i] || rawSottoSoglia[i] !== correnteSotto;
        if (correnteInizio !== null && chiude) {
            run.push({
                sottoSoglia: correnteSotto,
                iniziaA: correnteInizio,
                finisceA: i - 1,
                durataSec: punti[i - 1][3] - punti[correnteInizio][3],
                spostamentoNettoM: distM(punti[correnteInizio], punti[i - 1])
            });
            correnteInizio = null;
        }
        if (i < n && !buco[i]) {
            if (correnteInizio === null) { correnteInizio = i - 1; correnteSotto = rawSottoSoglia[i]; }
        }
    }

    // --- 4. isteresi, in due passate sui run (non un automa a stati: piu' semplice da
    // verificare, stesso comportamento perche' agisce sugli stessi run gia' delimitati) ---
    //
    // 4a. Un run "sotto soglia" troppo corto (< PAUSA_MIN_SEC) non e' una pausa vera: resta
    // cammino. Implementa direttamente la scelta di Denis (60s continuativi).
    for (const r of run) {
        if (r.sottoSoglia && r.durataSec < PAUSA_MIN_SEC) r.sottoSoglia = false;
    }
    // 4b. Un run "sopra soglia" incastrato fra due pause confermate, troppo breve o con
    // spostamento netto insufficiente, e' una ripartenza che non regge: e' piu' probabile un
    // sobbalzo del GPS durante la sosta stessa. Viene riassorbito nella pausa.
    for (let k = 1; k < run.length - 1; k++) {
        const r = run[k];
        if (!r.sottoSoglia && run[k - 1].sottoSoglia && run[k + 1].sottoSoglia &&
            (r.durataSec < RIPARTENZA_SEC || r.spostamentoNettoM < RIPARTENZA_MIN_M)) {
            r.sottoSoglia = true;
        }
    }

    // 4c. Dopo 4a/4b, due run adiacenti possono essere finite con la stessa classificazione
    // (es. pausa - brevissima ripartenza riassorbita in 4b - pausa: sono di fatto un'unica
    // sosta continuativa). Si fondono qui, invece che nel passo 3, perche' prima di 4a/4b non
    // si sa ancora quali run confineranno davvero.
    const runFusi = [];
    for (const r of run) {
        const precedente = runFusi[runFusi.length - 1];
        if (precedente && precedente.sottoSoglia === r.sottoSoglia && precedente.finisceA === r.iniziaA) {
            precedente.finisceA = r.finisceA;
            precedente.durataSec += r.durataSec;
        } else {
            runFusi.push({ ...r });
        }
    }

    // --- 5. somma finale ---
    let movimentoSec = 0;
    for (const r of runFusi) {
        if (r.sottoSoglia) {
            pausaSec += r.durataSec;
            pause.push({ inizioSec: punti[r.iniziaA][3], durataSec: r.durataSec });
        } else {
            movimentoSec += r.durataSec;
        }
    }
    pause.sort((a, b) => a.inizioSec - b.inizioSec);

    if (incertoSec > totaleSec * INCERTO_MAX_FRAZIONE) {
        motivi.push('Una parte troppo grande della traccia ha buchi non interpretabili: non e\' possibile fidarsi della separazione cammino/pause.');
    }

    return {
        totaleSec,
        movimentoSec,
        pausaSec,
        incertoSec,
        pause,
        attendibile: motivi.length === 0,
        motivi
    };
}

module.exports = { parseGpx, statisticheTraccia, tempiTraccia, ErroreGpx, MAX_PUNTI, SOGLIA_DISLIVELLO_M };
