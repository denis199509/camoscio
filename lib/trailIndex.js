// Fase G - Indice spaziale in memoria di tutti i sentieri OSM scaricati con
// scripts/fetch-trails.js, usato da routes/tracking.js per "agganciare" ogni punto GPS
// ricevuto durante un'escursione al sentiero conosciuto piu' vicino.
//
// Costruito una volta all'avvio del server (vedi server.js) e tenuto in RAM: i sentieri
// cambiano solo quando si rilancia a mano lo script di estrazione, ricaricarlo ad ogni
// singola richiesta sarebbe inutile e lento (migliaia di segmenti ad ogni punto GPS).
//
// Le ~870.000 coppie di punti consecutivi (segmenti) delle 4 regioni, con la prima verisone
// scritta come tanti piccoli oggetti {a:[lng,lat], b:[lng,lat], ...}, occupavano quasi
// 450MB di RAM (misurato dal vivo): troppo per il piano gratuito di Render (512MB in
// tutto). Qui le coordinate stanno invece in UN SOLO Float32Array condiviso (le coppie
// [lng,lat] si ricostruiscono al volo solo per i pochi candidati trovati ad ogni ricerca,
// mai per tutti i segmenti insieme) - stessa idea del formato compatto gia' scelto per la
// traccia GPS (Fase F) e per i sentieri su MongoDB: un numero anziche' un oggetto ovunque
// possibile. Float32 invece di Float64: ~7 cifre decimali di precisione, piu' che
// sufficienti dato che si lavora comunque con un margine di errore OSM di ~10m.
const RBush = require('rbush').default;
const Trail = require('../models/Trail');
const { nearestPointOnSegment, metersPerDegree } = require('./geometry');

const OSM_MARGIN_M = 10;
const MAX_SNAP_DISTANCE_M = 60; // oltre questa distanza non e' un errore GPS: e' un altro sentiero, o davvero fuori sentiero
const DEFAULT_ACCURACY_M = 20; // usato solo se il telefono non manda affatto una precisione

// Il primo tentativo di mettere online tutte e 4 le regioni insieme ha fatto superare il
// limite di memoria del piano gratuito di Render (sito diventato instabile, corretto con un
// rollback). Per procedere con calma si riparte solo con Lazio e Abruzzo (gia' scaricati e
// salvati su MongoDB insieme alle altre due, vedi scripts/fetch-trails.js: NON servono
// nuovi download) - Marche e Molise restano pronti sul database, si riattivano aggiungendoli
// qui una volta confermato che il consumo di memoria resta sicuro anche con tutte e 4.
const ACTIVE_REGIONS = ['Lazio', 'Abruzzo'];

let tree = null;
let waySegmentCount = 0;
let allCoords = null; // Float32Array piatto: [lng0,lat0, lng1,lat1, ...] di TUTTI i sentieri in fila
let wayRanges = null; // wayId -> [indicePrimoPunto, indiceUltimoPuntoEscluso) dentro allCoords

function pointAt(i) {
    return [allCoords[i * 2], allCoords[i * 2 + 1]];
}

// Chiamata una volta all'avvio (e disponibile per essere rilanciata a mano via script se
// in futuro si aggiungono sentieri senza riavviare il server).
//
// Usa un cursore invece di un unico find().lean() che carica tutti i documenti insieme: il
// primo tentativo di questa fase (poi corretto con un rollback) molto probabilmente e'
// andato in crash su Render non per la dimensione finale dell'indice (misurata dal vivo
// come sicura) ma per il PICCO temporaneo di memoria mentre migliaia di documenti Mongoose
// stavano tutti insieme in RAM prima di essere compattati - un cursore legge un documento
// alla volta (a piccoli gruppi dietro le quinte), tenendo il picco molto piu' vicino al
// consumo finale a regime.
async function loadTrailIndex() {
    const cursor = Trail.find({ region: { $in: ACTIVE_REGIONS } }, { wayId: 1, coordinates: 1, _id: 0 }).lean().cursor();

    const flatCoords = []; // array piatto di numeri (lng,lat,lng,lat,...): convertito in Float32Array solo alla fine
    const ranges = new Map();
    const items = [];
    let trailCount = 0;
    let offset = 0;

    for await (const trail of cursor) {
        trailCount++;

        // Ogni 2000 sentieri si cede il controllo all'event loop per un istante: misurato
        // dal vivo che senza questa pausa il consumo di memoria sale con un picco quasi
        // doppio rispetto al valore finale a regime (il "raccoglitore di spazzatura" di
        // Node non riesce a stare al passo con un ciclo così intenso e ininterrotto). Con
        // la pausa il picco resta molto più vicino al consumo finale.
        if (trailCount % 500 === 0) await new Promise(resolve => setImmediate(resolve));

        const start = offset;
        for (const [lng, lat] of trail.coordinates) {
            flatCoords.push(lng, lat);
            offset++;
        }
        ranges.set(trail.wayId, [start, offset]);

        for (let i = start; i < offset - 1; i++) {
            const x1 = flatCoords[i * 2], y1 = flatCoords[i * 2 + 1];
            const x2 = flatCoords[(i + 1) * 2], y2 = flatCoords[(i + 1) * 2 + 1];
            items.push({
                minX: Math.min(x1, x2), minY: Math.min(y1, y2),
                maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
                i, wayId: trail.wayId
            });
        }
    }

    const coords = Float32Array.from(flatCoords);
    const newTree = new RBush();
    newTree.load(items);

    allCoords = coords;
    wayRanges = ranges;
    tree = newTree;
    waySegmentCount = items.length;

    console.log(`Indice sentieri (Fase G, regioni attive: ${ACTIVE_REGIONS.join('/')}) caricato: ${trailCount} sentieri, ${items.length} segmenti`);
    return { trailCount, segmentCount: items.length };
}

function adaptiveThreshold(accuracyM) {
    const acc = (typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM > 0)
        ? accuracyM : DEFAULT_ACCURACY_M;
    return Math.min(OSM_MARGIN_M + acc, MAX_SNAP_DISTANCE_M);
}

// Cerca il sentiero conosciuto piu' vicino a [lng,lat] entro la soglia adattiva.
// Ritorna { point:[lng,lat] (corretto), distanceM, wayId } oppure null se nessun sentiero
// e' abbastanza vicino (il chiamante lo tratta come possibile tratto da mappare in futuro).
function snapPoint(lng, lat, accuracyM) {
    if (!tree) return null; // indice non ancora pronto: meglio non agganciare che agganciare a caso

    const threshold = adaptiveThreshold(accuracyM);
    const { mLat, mLng } = metersPerDegree(lat);
    const marginLatDeg = threshold / mLat;
    const marginLngDeg = threshold / mLng;

    const candidates = tree.search({
        minX: lng - marginLngDeg, minY: lat - marginLatDeg,
        maxX: lng + marginLngDeg, maxY: lat + marginLatDeg
    });

    let best = null;
    for (const seg of candidates) {
        const a = pointAt(seg.i), b = pointAt(seg.i + 1);
        const { point, distanceM } = nearestPointOnSegment([lng, lat], a, b, mLat, mLng);
        if (distanceM <= threshold && (!best || distanceM < best.distanceM)) {
            best = { point, distanceM, wayId: seg.wayId };
        }
    }
    return best;
}

// Sentieri interi (coordinate complete, non solo i segmenti) entro un raggio da un punto -
// usata dal telefono UNA VOLTA all'inizio di un tracciamento (vedi GET /api/tracking/nearby-trails)
// per fare un controllo rapido e approssimato in locale, senza dover scaricare l'intero
// database regionale dei sentieri (vincolo hard di risparmio, questa volta di banda/spazio
// sul telefono invece che su MongoDB). Ricostruisce array [lng,lat] "normali" solo per i
// pochi sentieri vicini trovati: va bene spendere un po' di memoria qui, e' una manciata
// di sentieri per una manciata di richieste, non l'intero indice.
function getNearbyTrails(lng, lat, radiusM) {
    if (!tree) return [];

    const { mLat, mLng } = metersPerDegree(lat);
    const marginLatDeg = radiusM / mLat;
    const marginLngDeg = radiusM / mLng;

    const segments = tree.search({
        minX: lng - marginLngDeg, minY: lat - marginLatDeg,
        maxX: lng + marginLngDeg, maxY: lat + marginLatDeg
    });

    const wayIds = new Set(segments.map(s => s.wayId));
    const result = [];
    for (const wayId of wayIds) {
        const range = wayRanges.get(wayId);
        if (!range) continue;
        const [start, end] = range;
        const coords = [];
        for (let i = start; i < end; i++) coords.push(pointAt(i));
        result.push(coords);
    }
    return result;
}

function isIndexReady() {
    return tree !== null;
}

function getStats() {
    return { ready: tree !== null, segmentCount: waySegmentCount };
}

module.exports = { loadTrailIndex, snapPoint, getNearbyTrails, isIndexReady, getStats };
