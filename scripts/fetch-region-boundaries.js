// Fase G - Scarica UNA TANTUM i confini amministrativi REALI di Marche/Lazio/Abruzzo/Molise
// (finora solo un rettangolo approssimativo in public/js/map.js) da Nominatim, il servizio
// pubblico e gratuito di geocoding di OpenStreetMap che sa gia' unire le decine di segmenti
// di un confine regionale in un unico poligono pronto all'uso (evita di dover riscrivere a
// mano la logica di "cucitura" dei confini da Overpass, che serve invece per i sentieri
// nella Fase G vera e propria, scripts/fetch-trails.js).
//
// Salvato come file statico committato in git (data/region-boundaries.json), NON in
// MongoDB: sono dati pubblici che cambiano si' e no una volta ogni molti anni, non ha senso
// occupare spazio nel database (vincolo hard di cose_da_fare.txt) per qualcosa di cosi'
// stabile che il server puo' tenere in memoria dall'avvio.
//
// Uso: node scripts/fetch-region-boundaries.js
const fs = require('fs');
const path = require('path');
const { simplifyRing } = require('../lib/geometry');

const REGIONS = ['Marche', 'Lazio', 'Abruzzo', 'Molise'];
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'region-boundaries.json');

// Il confine serve solo per un controllo geografico approssimato ("questo punto e' dentro
// una delle 4 regioni?"), non per calcoli di precisione: una tolleranza di 150m riduce
// drasticamente il numero di punti (i confini OSM completi arrivano a decine di migliaia
// di vertici, soprattutto lungo le coste) senza cambiare l'esito di quel controllo.
const SIMPLIFY_TOLERANCE_M = 150;

// Policy di uso di Nominatim (nominatim.org/release-docs/latest/api/Search/): niente
// registrazione ne' chiave, ma obbligatorio uno User-Agent che identifichi l'app e
// massimo 1 richiesta al secondo - rispettata qui con una pausa tra le 4 chiamate.
const NOMINATIM_USER_AGENT = 'Camoscio-App/1.0 (sito escursionismo Marche-Lazio-Abruzzo-Molise; contatto: denis1995.09@gmail.com)';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRegionBoundary(name) {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: `${name}, Italia`,
        format: 'jsonv2',
        polygon_geojson: '1',
        limit: '5'
    });

    const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim ha risposto ${res.status} per "${name}"`);

    const results = await res.json();
    // Tra i risultati si sceglie il primo che e' davvero un confine amministrativo di
    // regione (type/class "administrative"), non un paese/via omonimo.
    const match = results.find(r =>
        r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon') &&
        (r.type === 'administrative' || r.class === 'boundary')
    ) || results.find(r => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon'));

    if (!match) throw new Error(`Nessun confine poligonale trovato per "${name}"`);
    return match.geojson;
}

function countPoints(geojson) {
    const rings = geojson.type === 'Polygon' ? geojson.coordinates : geojson.coordinates.flat();
    return rings.reduce((sum, ring) => sum + ring.length, 0);
}

function simplifyGeojson(geojson, toleranceM) {
    if (geojson.type === 'Polygon') {
        return { type: 'Polygon', coordinates: geojson.coordinates.map(ring => simplifyRing(ring, toleranceM)) };
    }
    return {
        type: 'MultiPolygon',
        coordinates: geojson.coordinates.map(polygon => polygon.map(ring => simplifyRing(ring, toleranceM)))
    };
}

(async () => {
    const output = {};

    for (const region of REGIONS) {
        console.log(`Scarico confine di ${region} da Nominatim...`);
        const geojson = await fetchRegionBoundary(region);
        const before = countPoints(geojson);
        const simplified = simplifyGeojson(geojson, SIMPLIFY_TOLERANCE_M);
        const after = countPoints(simplified);
        console.log(`  ${region}: ${before} -> ${after} punti dopo la semplificazione (tolleranza ${SIMPLIFY_TOLERANCE_M}m)`);
        output[region] = simplified;

        await sleep(1100);
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
    console.log(`Salvato in ${OUTPUT_PATH}`);
})().catch(err => {
    console.error('Errore:', err.message);
    process.exit(1);
});
