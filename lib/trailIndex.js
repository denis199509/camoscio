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

let tree = null;
let waySegmentCount = 0;
let allCoords = null; // Float32Array piatto: [lng0,lat0, lng1,lat1, ...] di TUTTI i sentieri in fila
let wayRanges = null; // wayId -> [indicePrimoPunto, indiceUltimoPuntoEscluso) dentro allCoords

function pointAt(i) {
    return [allCoords[i * 2], allCoords[i * 2 + 1]];
}

// Chiamata una volta all'avvio (e disponibile per essere rilanciata a mano via script se
// in futuro si aggiungono sentieri senza riavviare il server).
async function loadTrailIndex() {
    const trails = await Trail.find({}, { wayId: 1, coordinates: 1, _id: 0 }).lean();

    let totalPoints = 0;
    for (const trail of trails) totalPoints += trail.coordinates.length;

    const coords = new Float32Array(totalPoints * 2);
    const ranges = new Map();
    const items = [];

    let offset = 0;
    for (const trail of trails) {
        const start = offset;
        for (const [lng, lat] of trail.coordinates) {
            coords[offset * 2] = lng;
            coords[offset * 2 + 1] = lat;
            offset++;
        }
        ranges.set(trail.wayId, [start, offset]);

        for (let i = start; i < offset - 1; i++) {
            const x1 = coords[i * 2], y1 = coords[i * 2 + 1];
            const x2 = coords[(i + 1) * 2], y2 = coords[(i + 1) * 2 + 1];
            items.push({
                minX: Math.min(x1, x2), minY: Math.min(y1, y2),
                maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
                i, wayId: trail.wayId
            });
        }
    }

    const newTree = new RBush();
    newTree.load(items);

    allCoords = coords;
    wayRanges = ranges;
    tree = newTree;
    waySegmentCount = items.length;

    console.log(`Indice sentieri (Fase G) caricato: ${trails.length} sentieri, ${items.length} segmenti`);
    return { trailCount: trails.length, segmentCount: items.length };
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
