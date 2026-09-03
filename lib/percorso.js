// Estratta da routes/hikes.js (punto 80/A) perche' ora la usa anche routes/completions.js
// (aggiungere un .gpx retroattivo a un'escursione gia' segnata come completata) - un router
// Express esporta solo il router stesso, non le funzioni interne, quindi calcolaDaPercorso
// non poteva restare li' dentro se doveva servire anche altrove. Stessa idea gia' seguita
// per applyHikeCompletionStats (lib/hikeStats.js, punto 64): la logica si scrive una volta
// sola, i chiamanti decidono solo il "chi"/"quando".
const { mongoose } = require('../db/mongo');
const RouteDraft = require('../models/RouteDraft');
const SavedRoute = require('../models/SavedRoute'); // punto 113 passo 9: percorso copiato da una traccia
const { regionForPoint } = require('./regions');
const { haversineKm, simplifyTrack } = require('./geometry');
const { parseGpx, statisticheTraccia, ErroreGpx, SOGLIA_DISLIVELLO_M } = require('./gpx');
const { parseFit, ErroreFit } = require('./fit'); // punto 114: stessa idraulica, sorgente binaria
const { progettaPercorso } = require('./trailGraph');

// --- PUNTO 43: quota massima, dislivello e distanza calcolati da un percorso vero ---
//
// "routeSource" e' facoltativo: assente, tutto resta scritto a mano come sempre. Presente,
// i tre numeri si CALCOLANO invece di fidarsi di un valore mandato dal client - un numero
// mandato dal client non e' un dato, e' un'affermazione (stesso principio gia' applicato ai
// progetti in routes/routing.js). Solleva un Error col messaggio gia' pronto per l'utente.
const MAX_BYTE_GPX_HIKE = 10 * 1024 * 1024; // stesso tetto di routes/tracking.js
const CAMPIONE_REGIONE_HIKE = 40; // stesso campione di routes/tracking.js

// Punto 116 - la traccia importata (.gpx/.fit) si salva anche come polyline sull'Hike
// (routePath in models/Hike.js), per disegnarla come linea sulla mappa. Stessa disciplina
// di models/SavedRoute.js (l'unico altro posto dove il progetto persiste una linea vera):
// Douglas-Peucker piu' grezzo dell'archivio - una linea DA VEDERE, non un dato topografico
// - e ridotta a [lng,lat]. routes/routing.js li importa da qui (prima li ridefiniva).
const SEMPLIFICA_PERCORSO_M = 18;
const MAX_PUNTI_PERCORSO = 400;

// Punto 93 - un numero mandato dal client per il ripiego "quote a mano" resta
// un'affermazione come ogni altro: si convalida qui, non ci si fida e basta. Range larghi
// ma non infiniti (stessi ordini di grandezza gia' in uso altrove nel progetto per lo
// stesso tipo di dato - vedi PACE_UP_MAX/ORE_MAX in lib/hikeStats.js per lo stile).
function quoteManualiValide(q) {
    if (!q || typeof q !== 'object') return null;
    const maxAltitude = Number(q.maxAltitude);
    const elevationGain = Number(q.elevationGain);
    if (!Number.isFinite(maxAltitude) || maxAltitude < -100 || maxAltitude > 5000) return null;
    if (!Number.isFinite(elevationGain) || elevationGain < 0 || elevationGain > 5000) return null;
    return { maxAltitude: Math.round(maxAltitude), elevationGain: Math.round(elevationGain) };
}

async function calcolaDaPercorso(routeSource, userId) {
    if (!routeSource || typeof routeSource !== 'object') {
        throw new Error('Percorso non valido.');
    }

    if (routeSource.kind === 'draft') {
        if (typeof routeSource.draftId !== 'string' || !mongoose.isValidObjectId(routeSource.draftId)) {
            throw new Error('Percorso non valido.');
        }
        // SOLO le PROPRIE bozze, stessa regola di ogni altra rotta su RouteDraft.
        const bozza = await RouteDraft.findOne({ _id: routeSource.draftId, userId });
        if (!bozza) throw new Error('Questo progetto non esiste o non è tuo.');

        // Stesso calcolo di quando si riapre la bozza (punto 13): non si salva mai il
        // percorso, si ricalcola - se un domani i sentieri migliorano, l'escursione
        // collegata trova i numeri nuovi la prossima volta che viene ricollegata.
        const punti = bozza.anello ? [...bozza.punti, bozza.punti[0]] : bozza.punti;
        const esito = await progettaPercorso(punti, { agganciaAiSentieri: bozza.agganciaAiSentieri });

        // Punto 93: la fonte delle quote (Open-Meteo) e' un servizio esterno gratuito, e ha
        // ricominciato a fallire in modo persistente (non solo occasionale) - probabile un
        // limite condiviso sull'indirizzo di uscita di Render, fuori dal nostro controllo.
        // Bloccare del tutto la pubblicazione quando l'utente conoscerebbe benissimo lui i
        // due numeri e' esattamente il tipo di dipendenza da un servizio esterno che il
        // progetto ha gia' scelto di non accettare altrove (punto 34: "un errore di invio
        // non puo' far fallire una registrazione"). Qui pero' NON si inventa un numero: si
        // chiede all'utente di scriverlo lui, o si torna a dire che manca (quoteMancanti).
        //
        // La distanza invece NON si chiede mai: e' gia' calcolata (progettaPercorso la
        // ricava dalle tappe indipendentemente dalle quote, vedi lib/trailGraph.js) ed e'
        // un dato migliore di qualunque stima dell'utente - anzi e' proprio il numero che
        // gli serve per rispondere con cognizione di causa sul dislivello.
        if (!esito.dislivelloDisponibile) {
            const distanceKm = Math.round(esito.metriTotali / 100) / 10;
            const validi = quoteManualiValide(routeSource.quoteManuali);
            if (!validi) {
                return {
                    quoteMancanti: true,
                    motivo: esito.motivoDislivello, // 'fonte' | 'troppo lungo' - punto 38, mai lo stesso messaggio per due cause diverse
                    distanceKm,
                    nomePercorso: bozza.nome
                };
            }
            return {
                maxAltitude: validi.maxAltitude,
                elevationGain: validi.elevationGain,
                distanceKm,
                // dislivelloManuale: la PROVA che questi due numeri sono stati dichiarati,
                // non calcolati - vedi il commento su routeSource in models/Hike.js.
                routeSource: { kind: 'draft', nome: bozza.nome, dislivelloManuale: true }
            };
        }

        return {
            maxAltitude: Math.round(esito.quotaMaxM),
            elevationGain: Math.round(esito.salitaM),
            distanceKm: Math.round(esito.metriTotali / 100) / 10,
            routeSource: { kind: 'draft', nome: bozza.nome }
        };
    }

    if (routeSource.kind === 'saved') {
        if (typeof routeSource.savedRouteId !== 'string' || !mongoose.isValidObjectId(routeSource.savedRouteId)) {
            throw new Error('Percorso non valido.');
        }
        // SOLO i propri percorsi salvati, come per le bozze.
        const percorso = await SavedRoute.findOne({ _id: routeSource.savedRouteId, userId });
        if (!percorso) throw new Error('Questo percorso non esiste o non è tuo.');

        // Punto 116: la geometria per la linea sulla mappa. Il SavedRoute la conserva gia'
        // nel formato giusto - [[lng,lat]], semplificata (~18 m) e capata a MAX_PUNTI_PERCORSO
        // alla sua creazione (routes/routing.js) - quindi si passa cosi' com'e'. Il ramo
        // quoteMancanti qui sotto resta senza: e' un 422, non scrive mai l'escursione.
        const routePathSalvato = (Array.isArray(percorso.punti) && percorso.punti.length >= 2)
            ? percorso.punti.map(p => [p[0], p[1]])
            : undefined;

        // La geometria e i totali sono gia' stati copiati alla creazione (models/SavedRoute.js)
        // dalla traccia GPS reale dell'uscita: sono misure, non stime DEM, e non c'e' nessun
        // servizio esterno da interrogare. La distanza si ricava dai punti se il campo copiato
        // manca (una traccia ce l'ha sempre); dislivello e quota max NON sono ricostruibili
        // (i punti salvati sono solo [lng,lat], la quota e' stata scartata - vincolo spazio).
        let distanceKm = percorso.distanzaKm;
        if (typeof distanceKm !== 'number') {
            let m = 0;
            for (let i = 1; i < percorso.punti.length; i++) {
                m += haversineKm(
                    percorso.punti[i - 1][1], percorso.punti[i - 1][0],
                    percorso.punti[i][1], percorso.punti[i][0]
                ) * 1000;
            }
            distanceKm = Math.round(m / 100) / 10;
        }

        // Quota max / dislivello assenti = la traccia originale non aveva le quote (es. un
        // .gpx importato senza elevazione). Stesso ripiego "quote a mano" del punto 93 usato
        // per le bozze qui sotto - motivo 'fonte' cosi' risolviPercorso resta invariato.
        if (typeof percorso.dislivelloM !== 'number' || typeof percorso.quotaMaxM !== 'number') {
            const validi = quoteManualiValide(routeSource.quoteManuali);
            if (!validi) {
                return {
                    quoteMancanti: true,
                    motivo: 'fonte',
                    distanceKm,
                    nomePercorso: percorso.nome
                };
            }
            return {
                maxAltitude: validi.maxAltitude,
                elevationGain: validi.elevationGain,
                distanceKm,
                routeSource: { kind: 'saved', nome: percorso.nome, dislivelloManuale: true },
                ...(routePathSalvato ? { routePath: routePathSalvato } : {})
            };
        }

        return {
            maxAltitude: Math.round(percorso.quotaMaxM),
            elevationGain: Math.round(percorso.dislivelloM),
            distanceKm,
            routeSource: { kind: 'saved', nome: percorso.nome },
            ...(routePathSalvato ? { routePath: routePathSalvato } : {})
        };
    }

    // Punto 114: 'gpx' e 'fit' condividono tutto tranne come si arriva a `letto` (parser
    // di testo vs parser binario). Il resto - controllo regioni, statisticheTraccia,
    // forma della risposta con gpxLetto - e' identico per costruzione: un ramo solo, cosi'
    // non ci sono due code che possono divergere (lezione del punto 18).
    if (routeSource.kind === 'gpx' || routeSource.kind === 'fit') {
        let letto;
        if (routeSource.kind === 'fit') {
            const b64 = routeSource.fitBase64;
            if (typeof b64 !== 'string' || !b64.trim()) {
                throw new Error('Nessun file .fit ricevuto.');
            }
            let buf = null;
            try { buf = Buffer.from(b64, 'base64'); } catch (e) { buf = null; }
            if (!buf || buf.length === 0) {
                throw new Error('Nessun file .fit ricevuto.');
            }
            if (buf.length > MAX_BYTE_GPX_HIKE) {
                throw new Error('Il file supera i 10 MB. Una traccia normalmente pesa molto meno.');
            }
            try {
                letto = await parseFit(buf);
            } catch (e) {
                throw new Error((e instanceof ErroreFit || e.utente) ? e.message : 'File .fit non leggibile.');
            }
        } else {
            const testo = routeSource.gpxText;
            if (typeof testo !== 'string' || !testo.trim()) {
                throw new Error('Nessun file .gpx ricevuto.');
            }
            if (Buffer.byteLength(testo, 'utf8') > MAX_BYTE_GPX_HIKE) {
                throw new Error('Il file supera i 10 MB. Una traccia normalmente pesa molto meno.');
            }
            try {
                letto = parseGpx(testo);
            } catch (e) {
                throw new Error((e instanceof ErroreGpx || e.utente) ? e.message : 'File .gpx non leggibile.');
            }
        }

        // Stesso controllo "la maggioranza dei punti dentro le 4 regioni" gia' usato per le
        // tracce importate come uscite (routes/tracking.js): un sentiero di crinale entra ed
        // esce dai confini di continuo, bocciarlo per un punto solo sarebbe un rifiuto a caso.
        const passo = Math.max(1, Math.floor(letto.punti.length / CAMPIONE_REGIONE_HIKE));
        let dentro = 0, esaminati = 0;
        for (let i = 0; i < letto.punti.length; i += passo) {
            esaminati++;
            if (regionForPoint(letto.punti[i][0], letto.punti[i][1])) dentro++;
        }
        if (dentro * 2 <= esaminati) {
            throw new Error('Questa traccia si svolge fuori dalle quattro regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise).');
        }

        const stats = statisticheTraccia(letto.punti, SOGLIA_DISLIVELLO_M, haversineKm);
        if (stats.quotaMaxM === null) {
            throw new Error(`Questo file .${routeSource.kind} non contiene le quote: non è possibile calcolare il dislivello.`);
        }

        // Punto 116: la geometria per disegnare la traccia sulla mappa (routePath sull'Hike).
        // Stesso trattamento che routes/routing.js fa per un SavedRoute: semplifica (~18 m),
        // poi tieni solo [lng,lat]; se restano troppi punti, campiona a passo fisso tenendo
        // sempre l'ultimo. La quota e' gia' stata usata sopra (quotaMaxM/dislivelloM).
        let routePath = simplifyTrack(letto.punti, SEMPLIFICA_PERCORSO_M).map(p => [p[0], p[1]]);
        if (routePath.length > MAX_PUNTI_PERCORSO) {
            const q = Math.ceil(routePath.length / MAX_PUNTI_PERCORSO);
            routePath = routePath.filter((_, i) => i % q === 0 || i === routePath.length - 1);
        }

        return {
            maxAltitude: stats.quotaMaxM,
            elevationGain: stats.dislivelloM,
            distanceKm: stats.distanzaKm,
            routeSource: { kind: routeSource.kind, nome: (letto.nome || 'Traccia importata').slice(0, 80) },
            // Punto 116: la linea da disegnare sulla mappa. Anche il ramo 'saved' la
            // restituisce (copiata dal SavedRoute); solo 'draft' no - li' si ricalcola.
            ...(routePath.length >= 2 ? { routePath } : {}),
            // Punto 79: la traccia gia' letta, cosi' chi ha bisogno di inizio/fine o dei punti
            // (es. tempiTraccia in complete-group, o il salvataggio della sessione in
            // completions.js) non deve rifare un secondo giro di parsing sullo stesso file -
            // fino a 10 MB, Render a 512 MB gia' caduto una volta. Il nome del campo resta
            // gpxLetto anche per un .fit: e' un contratto interno e vuol dire "la traccia
            // letta", non "il .gpx". Aggiunta pura: chi lo ignora non cambia.
            gpxLetto: letto
        };
    }

    throw new Error('Percorso non valido.');
}

// Punto 93 - traduce l'esito di calcolaDaPercorso in una risposta HTTP gia' pronta, cosi'
// i DUE punti di routes/hikes.js che collegano un progetto (creazione e modifica) non
// devono ciascuno reinventare "quoteMancanti -> 422 con questo corpo esatto" - la lezione
// del punto 18 al contrario: qui il rischio non e' una copia che diverge, e' dimenticare
// di aggiornarne una delle due quando questa logica cambiera' di nuovo.
// Usata SOLO da routes/hikes.js: routes/completions.js chiama ancora calcolaDaPercorso
// direttamente (kind:'gpx', che non puo' mai tornare quoteMancanti).
async function risolviPercorso(routeSource, userId) {
    let dati;
    try {
        dati = await calcolaDaPercorso(routeSource, userId);
    } catch (e) {
        return { ok: false, status: 400, corpo: { error: e.message } };
    }

    if (dati.quoteMancanti) {
        const nota = dati.motivo === 'troppo lungo'
            ? `Il percorso "${dati.nomePercorso}" supera i 25 km: su questa distanza le quote non si possono stimare con abbastanza precisione, e riprovare non cambierà niente. Scrivi tu quota massima e dislivello.`
            : `Il percorso "${dati.nomePercorso}" è di ${dati.distanceKm} km, ma la fonte delle quote non ha risposto: il dislivello non si può calcolare adesso. Scrivilo tu e il progetto resta collegato - oppure riprova fra poco.`;
        return {
            ok: false,
            status: 422,
            corpo: {
                richiedeQuote: true,
                motivo: dati.motivo,
                nomePercorso: dati.nomePercorso,
                distanceKm: dati.distanceKm,
                error: nota
            }
        };
    }

    // Le chiavi che finiscono davvero sull'escursione: niente gpxLetto di passaggio verso
    // Hike.create/update. routePath (punto 116) c'e' solo per i rami 'gpx'/'fit'; per
    // 'draft'/'saved' resta assente e routes/hikes.js fa $unset di quello vecchio.
    const { maxAltitude, elevationGain, distanceKm, routeSource: rs, routePath } = dati;
    const out = { maxAltitude, elevationGain, distanceKm, routeSource: rs };
    if (routePath) out.routePath = routePath;
    return { ok: true, dati: out };
}

module.exports = { calcolaDaPercorso, risolviPercorso, MAX_BYTE_GPX_HIKE, CAMPIONE_REGIONE_HIKE, SEMPLIFICA_PERCORSO_M, MAX_PUNTI_PERCORSO };
