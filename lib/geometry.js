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

function douglasPeucker(points, startIdx, endIdx, toleranceM, mLat, mLng, keep) {
    if (endIdx <= startIdx + 1) return;

    let maxDist = 0, maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
        const d = perpendicularDistanceMeters(points[i], points[startIdx], points[endIdx], mLat, mLng);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
    }

    if (maxDist > toleranceM) {
        keep.add(maxIdx);
        douglasPeucker(points, startIdx, maxIdx, toleranceM, mLat, mLng, keep);
        douglasPeucker(points, maxIdx, endIdx, toleranceM, mLat, mLng, keep);
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
