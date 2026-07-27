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
