const fs = require('fs');
const path = require('path');
const { pointInGeojson } = require('./geometry');

// Confini regionali reali (Fase G), scaricati una tantum con scripts/fetch-region-boundaries.js
// e committati come file statico: sono dati pubblici quasi immutabili, non ha senso tenerli
// in MongoDB (vincolo hard di spazio) quando il server puo' caricarli una volta all'avvio.
const BOUNDARIES_PATH = path.join(__dirname, '..', 'data', 'region-boundaries.json');
const boundaries = JSON.parse(fs.readFileSync(BOUNDARIES_PATH, 'utf8'));

// Nome della regione (Marche/Lazio/Abruzzo/Molise) che contiene il punto, o null se il
// punto e' fuori da tutte e 4 - usato sia per validare lato server la creazione di
// un'escursione/segnalazione, sia dallo script di estrazione sentieri per etichettare
// ogni "way" OSM con la sua regione.
function regionForPoint(lng, lat) {
    for (const region of Object.keys(boundaries)) {
        if (pointInGeojson([lng, lat], boundaries[region])) return region;
    }
    return null;
}

module.exports = { boundaries, regionForPoint };
