// Funzioni geometriche condivise tra routes/tracking.js (semplificazione traccia GPS,
// Fase F), lib/trailIndex.js (aggancio al sentiero, Fase G) e scripts/fetch-region-boundaries.js
// (semplificazione confini regionali, Fase G) - spostate qui per non duplicare la stessa
// logica in tre punti diversi.

function isFiniteNum(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

// Haversine in km.
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metersPerDegree(lat) {
    const mLat = 111320;
    const mLng = 111320 * Math.cos(lat * Math.PI / 180);
    return { mLat, mLng };
}

// Punto piu' vicino sul segmento [a,b] a "pt" (tutti [lng,lat]), con una proiezione piana
// approssimata (equirettangolare): a scala di un singolo punto GPS o di un singolo segmento
// di sentiero l'approssimazione e' ampiamente sufficiente, molto piu' leggera di un calcolo
// sferico esatto - usata potenzialmente migliaia di volte da un indice spaziale (Fase G).
function nearestPointOnSegment(pt, a, b, mLat, mLng) {
    const x0 = pt[0] * mLng, y0 = pt[1] * mLat;
    const x1 = a[0] * mLng, y1 = a[1] * mLat;
    const x2 = b[0] * mLng, y2 = b[1] * mLat;
    const dx = x2 - x1, dy = y2 - y1;

    let t = 0;
    if (dx !== 0 || dy !== 0) {
        t = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)));
    }
    const px = x1 + t * dx, py = y1 + t * dy;
    return { point: [px / mLng, py / mLat], distanceM: Math.hypot(x0 - px, y0 - py), t };
}

function perpendicularDistanceMeters(pt, a, b, mLat, mLng) {
    return nearestPointOnSegment(pt, a, b, mLat, mLng).distanceM;
}

// Tetto al LAVORO totale (somma delle ampiezze [start,end] scandite a ogni livello, non
// solo al primo), non al numero di punti in ingresso: su una traccia GPS vera la
// suddivisione dimezza grosso modo l'intervallo a ogni livello (totale ~N*log2(N), una
// traccia REALE da 200.000 punti misura ~3,5M e gira in 518ms) - e' un input costruito
// APPOSTA (mai una traccia vera) a poter degenerare a un punto tenuto per livello, cioe'
// vicino a N²/2. Misurato: ~19-20M "punti scanditi" al secondo su questa macchina: 30M
// tiene il caso peggiore sotto i 2 secondi qualunque sia N, restando ~8x sopra il costo di
// una traccia reale anche al tetto massimo di punti oggi possibile (200.000, vedi
// MAX_PUNTI_SESSIONE in routes/tracking.js).
const MAX_LAVORO_SEMPLIFICAZIONE = 30_000_000;

// ALTO (verifica generale, blocco 2, 44a sessione) e corretto qui (46a): la versione
// ricorsiva andava in RangeError (stack di chiamata esaurito) su una traccia costruita
// apposta - misurato 59s di blocco poi RangeError a 200.000 punti, un file di ~120KB gia'
// sufficiente a partire da 4.000. Stessa famiglia del Math.max(...array) gia' corretto
// altrove (vedi 07-Trappole-Tecniche nel vault). Due correzioni distinte, non una sola:
// (1) stack ESPLICITO (array) al posto dello stack di chiamata di JS - stessa identica
// logica di suddivisione (l'insieme finale di indici tenuti in `keep` non dipende
// dall'ordine in cui le coppie [start,end] vengono processate, solo da quali lo vengono),
// ma la profondita' non e' piu' limitata a qualche migliaio di livelli; (2) il tetto di
// lavoro qui sotto, perche' la sola conversione a iterativo toglie il RangeError ma NON il
// costo quadratico sull'input avversario - misurato separatamente: la stessa traccia
// costruita apposta, gia' iterativa, impiega 412ms/4.000 punti e 56,6s/50.000 (~x137 per
// un input x12,5 - quadratico confermato, non solo teorico).
function douglasPeucker(points, startIdx, endIdx, toleranceM, mLat, mLng, keep) {
    const pile = [[startIdx, endIdx]];
    let lavoroFatto = 0;
    while (pile.length > 0) {
        const [start, end] = pile.pop();
        if (end <= start + 1) continue;

        lavoroFatto += end - start;
        if (lavoroFatto > MAX_LAVORO_SEMPLIFICAZIONE) {
            // Rinuncia a semplificare oltre questo intervallo invece di continuare a
            // spendere tempo: si tengono TUTTI i punti rimasti (mai scartati - una traccia
            // meno compressa del possibile, mai un dato perso ne' un blocco lungo). Su una
            // traccia vera questo tetto non si raggiunge mai (misurato sopra).
            for (let i = start + 1; i < end; i++) keep.add(i);
            continue;
        }

        let maxDist = 0, maxIdx = -1;
        for (let i = start + 1; i < end; i++) {
            const d = perpendicularDistanceMeters(points[i], points[start], points[end], mLat, mLng);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }

        if (maxDist > toleranceM) {
            keep.add(maxIdx);
            pile.push([start, maxIdx]);
            pile.push([maxIdx, end]);
        }
    }
}

// Riduce il numero di punti di una linea aperta (traccia GPS) mantenendone la forma.
function simplifyTrack(points, toleranceM) {
    if (points.length <= 2) return points;

    const midLat = points[Math.floor(points.length / 2)][1];
    const { mLat, mLng } = metersPerDegree(midLat);

    const keep = new Set([0, points.length - 1]);
    douglasPeucker(points, 0, points.length - 1, toleranceM, mLat, mLng, keep);

    return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

// Come simplifyTrack ma per un anello CHIUSO (poligono di confine regionale): un solo asse
// primo/ultimo punto non basta perche' primo e ultimo punto di un anello chiuso coincidono
// (Douglas-Peucker su due punti identici come "corda" cancellerebbe tutto in mezzo). Si
// aggiunge un terzo ancoraggio a meta' anello, si semplificano le due meta' separatamente
// e si ricompongono, cosi' la forma del confine resta riconoscibile su entrambi i lati.
function simplifyRing(ring, toleranceM) {
    if (ring.length <= 4) return ring;

    const midLat = ring[Math.floor(ring.length / 2)][1];
    const { mLat, mLng } = metersPerDegree(midLat);
    const midIdx = Math.floor(ring.length / 2);

    const keep = new Set([0, midIdx, ring.length - 1]);
    douglasPeucker(ring, 0, midIdx, toleranceM, mLat, mLng, keep);
    douglasPeucker(ring, midIdx, ring.length - 1, toleranceM, mLat, mLng, keep);

    return [...keep].sort((a, b) => a - b).map(i => ring[i]);
}

// Ray-casting su un singolo anello [[lng,lat],...]. Funziona per anelli sia esterni che
// "buchi" (holes) di un poligono GeoJSON: vedi pointInPolygonRings sotto per come si combinano.
function pointInRing(pt, ring) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Un poligono GeoJSON e' un array di anelli: il primo e' il confine esterno, gli altri
// (se presenti) sono "buchi" da escludere. Invertire lo stato "dentro" ad ogni anello in cui
// il punto ricade gestisce correttamente i buchi senza dover distinguere esplicitamente
// esterno/interno (un punto dentro un buco risulta dentro l'anello esterno E dentro il
// buco: le due inversioni si annullano, tornando "fuori" come deve essere).
function pointInPolygonRings(pt, rings) {
    let inside = false;
    for (const ring of rings) {
        if (pointInRing(pt, ring)) inside = !inside;
    }
    return inside;
}

// Punto [lng,lat] dentro una geometria GeoJSON Polygon o MultiPolygon (es. un confine
// regionale scaricato da scripts/fetch-region-boundaries.js).
function pointInGeojson(pt, geojson) {
    if (!geojson) return false;
    if (geojson.type === 'Polygon') return pointInPolygonRings(pt, geojson.coordinates);
    if (geojson.type === 'MultiPolygon') return geojson.coordinates.some(polygon => pointInPolygonRings(pt, polygon));
    return false;
}

module.exports = {
    isFiniteNum,
    haversineKm,
    metersPerDegree,
    nearestPointOnSegment,
    perpendicularDistanceMeters,
    douglasPeucker,
    simplifyTrack,
    simplifyRing,
    pointInGeojson
};
