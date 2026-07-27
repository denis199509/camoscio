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
        throw new ErroreGpx('Il file non contiene abbastanza punti validi per ricostruire un percorso.');
    }

    const conOrario = letti.filter(p => p.ms !== null);
    if (conOrario.length < 2) {
        // NON si inventa una durata. Distanza e dislivello si potrebbero calcolare
        // comunque, ma finirebbero nei totali della Dashboard insieme a un tempo pari a
        // zero, e la velocita' media di tutto lo storico risulterebbe sbagliata verso
        // l'alto. Meglio rifiutare e dirlo che accettare e falsare i numeri.
        throw new ErroreGpx(
            tipo === 'itinerario'
                ? 'Questo file contiene un itinerario progettato (<rtept>), non una registrazione: non ha gli orari, quindi non si puo\' sapere quanto sia durata l\'escursione.'
                : 'Nel file mancano gli orari dei punti (<time>), quindi non si puo\' sapere quanto sia durata l\'escursione ne\' a che velocita\'. Serve un file registrato da un GPS o da un\'app di tracciamento.'
        );
    }

    // In ordine di tempo: un .gpx puo' avere piu' <trkseg> (uno per ogni pausa) o piu'
    // <trk>, e niente garantisce che siano scritti in ordine. Poi si tengono solo i punti
    // con orario STRETTAMENTE crescente, come fa gia' il tracciamento dal vivo.
    conOrario.sort((a, b) => a.ms - b.ms);
    const inizioMs = conOrario[0].ms;

    const punti = [];
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

    if (punti.length < 2) {
        throw new ErroreGpx('Tutti i punti del file hanno lo stesso orario: non e\' una registrazione utilizzabile.');
    }

    const avvisi = [];
    if (scartatiCoordinate > 0) {
        avvisi.push(`${scartatiCoordinate} punti avevano coordinate non valide e sono stati saltati.`);
    }
    const senzaOrario = letti.length - conOrario.length;
    if (senzaOrario > 0) {
        avvisi.push(`${senzaOrario} punti erano senza orario e sono stati saltati.`);
    }
    if (ultimaQuota === null) {
        avvisi.push('Il file non contiene le altitudini: il dislivello risultera\' zero.');
    }

    return {
        punti,
        nome: elemento(testo, 'name') || null,
        inizio: new Date(inizioMs),
        fine: new Date(ultimoMs),
        avvisi
    };
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

    return {
        distanzaKm: Math.round(distanzaKm * 1000) / 1000,
        dislivelloM: Math.round(dislivelloM)
    };
}

module.exports = { parseGpx, statisticheTraccia, ErroreGpx, MAX_PUNTI };
