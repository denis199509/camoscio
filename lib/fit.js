// ==========================================================================
// LETTURA FILE .FIT — punto 114 di cose_da_fare.txt
// "allora proviamo con il file .fit"
//
// PERCHE' UNA LIBRERIA QUI E NON A MANO COME PER IL .GPX (lib/gpx.js):
// il .gpx e' testo, e il parser scritto a mano serve a NON risolvere entita'
// XML (XXE, billion-laughs). Il .fit e' BINARIO: non ha entita', non ha
// ricorsione, nessuno di quei due attacchi esiste per lui. Decodificarlo a
// mano invece sono ~400 righe delicate (definition message, endianness,
// header compressi, CRC, coordinate in semicirconferenze): fit-file-parser
// (MIT, JS puro, unica dipendenza `buffer`) lo fa gia' e bene su file
// Garmin/Suunto/Polar. Denis ha approvato la dipendenza il 30/08/2026.
//
// NON ci si fida dell'output della libreria piu' di quanto ci si fidi di un
// .gpx: stesso tetto (MAX_PUNTI di lib/gpx.js), stessi controlli di range
// sulle coordinate, e il controllo "dentro le 4 regioni" lo applica il
// chiamante esattamente come per il .gpx. parseFit restituisce ESATTAMENTE
// la stessa forma di parseGpx, cosi' tutto il codice a valle (Douglas-Peucker,
// statisticheTraccia, tempiTraccia, assegnazione badge) non sa nemmeno da che
// formato viene la traccia.
//
// COSA NON FA, di proposito: non c'e' la strada "durata ignota" del .gpx. Quella
// esiste perche' un .gpx puo' essere un itinerario PROGETTATO senza orari
// (<rtept>). Un .fit e' sempre una registrazione: se non ha orari e' rotto, e
// si rifiuta invece di inventare.
// ==========================================================================

const FitParser = require('fit-file-parser').default;
const { isFiniteNum } = require('./geometry');
// Stesso tetto del .gpx: 200.000 punti sono fuori da qualunque registrazione reale
// (10 ore a un punto al secondo fanno 36.000) e sono li' per fermare un file
// costruito apposta prima che faccia finire la memoria di Render.
const { MAX_PUNTI } = require('./gpx');

// Errore con un messaggio gia' scritto per l'utente, come ErroreGpx. Il flag .utente
// distingue "il file e' sbagliato" da "il server ha un problema": le rotte lo leggono
// per decidere se rispondere 400 col messaggio o rilanciare.
class ErroreFit extends Error {
    constructor(messaggio) {
        super(messaggio);
        this.name = 'ErroreFit';
        this.utente = true;
    }
}

// Legge un Buffer .fit e restituisce i punti nel formato compatto della Fase F:
// [lng, lat, altitudine, secondi-da-inizio, precisione].
//
// La PRECISIONE resta 0 per ogni punto, come per il .gpx: il formato .fit la
// porterebbe anche (gps_accuracy), ma quel valore viene letto solo durante una
// registrazione dal vivo (public/js/tracking.js) per decidere quanto agganciare il
// punto a un sentiero - su una traccia gia' conclusa non serve.
async function parseFit(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ErroreFit('Il file e\' vuoto.');
    }

    const parser = new FitParser({
        mode: 'list',
        lengthUnit: 'm',        // altitude/enhanced_altitude in metri
        speedUnit: 'm/s',
        temperatureUnit: 'celsius',
        // force: best-effort. Un .fit troncato a fine registrazione (batteria finita,
        // app uccisa) ha il CRC finale sbagliato ma i record dentro sono buoni: si
        // legge quello che c'e' invece di buttare via tutto.
        force: true
    });

    let data;
    try {
        data = await new Promise((resolve, reject) => {
            parser.parse(buffer, (err, d) => (err ? reject(err) : resolve(d)));
        });
    } catch (err) {
        // La libreria rifiuta con una STRINGA ("Incorrect header size", ...): non e'
        // un messaggio per l'utente, ma dice comunque che il file non e' un .fit.
        throw new ErroreFit(`Questo non sembra un file .fit valido (${String(err)}).`);
    }

    const records = Array.isArray(data && data.records) ? data.records : [];
    if (records.length === 0) {
        throw new ErroreFit('Nel file non c\'e\' nessun punto di registrazione (record): non e\' una traccia da importare.');
    }
    if (records.length > MAX_PUNTI) {
        throw new ErroreFit(`Il file contiene ${records.length.toLocaleString('it-IT')} punti, troppi per essere una registrazione reale (limite ${MAX_PUNTI.toLocaleString('it-IT')}).`);
    }

    const letti = [];
    let ultimaQuota = null;      // per ereditare la quota su un punto che non ce l'ha
    let quotaVistaAlmenoUnaVolta = false;
    let senzaPosizione = 0;

    for (const r of records) {
        const lat = Number(r.position_lat);
        const lng = Number(r.position_long);
        // Un record senza posizione e' NORMALE: a inizio traccia (GPS non ancora
        // agganciato) o durante una pausa con auto-stop. Si salta senza contarlo un
        // errore - a differenza di un <trkpt> .gpx con lat/lon illeggibili, che e'
        // un file malformato.
        if (!isFiniteNum(lat) || !isFiniteNum(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            senzaPosizione++;
            continue;
        }

        // enhanced_altitude quando c'e': l'altitude "classico" del profilo FIT storico
        // satura a 5120 m e ha meno risoluzione. Quota mancante: si eredita l'ultima
        // nota, stesso criterio di parseGpx e di sanitizePoints in routes/tracking.js.
        let ele = Number(r.enhanced_altitude);
        if (!isFiniteNum(ele)) ele = Number(r.altitude);
        const quota = isFiniteNum(ele) ? ele : ultimaQuota;
        if (isFiniteNum(quota)) { ultimaQuota = quota; quotaVistaAlmenoUnaVolta = true; }

        const ms = r.timestamp instanceof Date ? r.timestamp.getTime()
            : (r.timestamp != null ? Date.parse(r.timestamp) : NaN);

        letti.push({ lat, lng, quota, ms: Number.isFinite(ms) ? ms : null });
    }

    if (letti.length < 2) {
        // Come in parseGpx: il messaggio dice i NUMERI, cosi' se un file vero venisse
        // respinto qui si capisce subito se il problema e' nel file o nel lettore.
        throw new ErroreFit(
            `Nel file ci sono ${records.length.toLocaleString('it-IT')} record, ma solo ${letti.length} con una posizione GPS valida: non bastano per ricostruire un percorso.`
        );
    }

    // Un .fit e' per definizione una serie temporale. Se meno di due punti hanno un
    // orario leggibile il file e' corrotto: non si apre la strada "durata ignota"
    // (vedi intestazione), si rifiuta.
    const conOrario = letti.filter(p => p.ms !== null);
    if (conOrario.length < 2) {
        throw new ErroreFit('I record del file non hanno un orario leggibile: la traccia non e\' utilizzabile.');
    }

    // In ordine di tempo e solo orari STRETTAMENTE crescenti, come fa parseGpx e come
    // fa il tracciamento dal vivo.
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
    const fineMs = ultimoMs;

    if (punti.length < 2) {
        throw new ErroreFit('Tutti i record del file hanno lo stesso orario: non e\' una registrazione utilizzabile.');
    }

    // Avvisi mostrati a schermo, stesso stile di parseGpx. I record senza posizione
    // non generano un avviso (sono strutturalmente normali nel .fit); i punti scartati
    // per orario non crescente si', se sono tanti.
    const avvisi = [];
    const senzaOrario = letti.length - conOrario.length;
    if (senzaOrario > 0) {
        avvisi.push(`${senzaOrario} punti erano senza orario e sono stati saltati.`);
    }
    const scartatiTempo = conOrario.length - punti.length;
    if (scartatiTempo > 0) {
        avvisi.push(`${scartatiTempo} punti avevano un orario non crescente e sono stati saltati.`);
    }
    if (!quotaVistaAlmenoUnaVolta) {
        avvisi.push('Il file non contiene le altitudini: il dislivello risultera\' zero.');
    }

    return {
        punti,
        // Il .fit non ha un campo "nome traccia" come <name> nel .gpx: il chiamante
        // mette il suo default ("Traccia importata"), esattamente come fa gia' con un
        // .gpx senza <name>.
        nome: null,
        inizio: new Date(inizioMs),
        fine: new Date(fineMs),
        durataIgnota: false,   // un .fit ha sempre gli orari (controllato sopra)
        tipo: 'traccia',
        avvisi
    };
}

module.exports = { parseFit, ErroreFit };
