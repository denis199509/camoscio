// --- Geofencing dei timbri: soglia, catalogo dei punti, scansione di una traccia ---
//
// Estratto da routes/tracking.js il 2026-08-28 (punto 108). Fino a quel giorno la stessa
// scansione "un punto della traccia entro SOGLIA_TIMBRO_M da una vetta" era scritta DUE
// volte dentro tracking.js (assegnaTimbriDallaTraccia e la rotta /peak-ascents), con la
// stessa finestra in gradi e la stessa haversine copiate a mano. Il punto 108 ne aggiunge
// una terza (routes/stamps.js: un timbro da mappa si crea solo se una traccia reale e'
// passata dalla vetta) - tre copie della stessa regola che possono divergere in silenzio
// sono esattamente il difetto gia' pagato piu' volte nel progetto (vedi
// 07-Trappole-Tecniche.md). Da qui in poi la regola vive in un posto solo.
//
// STESSA REGOLA DELLA MAPPA, di proposito: gli stessi 150 metri e lo stesso catalogo di
// punti (public/js/badge-points.js, letto da qui e dal browser). Due soglie diverse
// vorrebbero dire che camminare con il sito aperto, importare un .gpx e contare le salite
// danno risultati diversi - cioe' che uno dei tre sta sbagliando, senza poter dire quale.

const { isFiniteNum, haversineKm } = require('./geometry');
const Hike = require('../models/Hike');
const CATALOGO_BADGE = require('../public/js/badge-points.js');

const SOGLIA_TIMBRO_M = 150;

// Il catalogo fisso PIU' le vette delle escursioni sul database, come fa catalogo() in
// public/js/badges.js: chi crea un'escursione con una vetta nuova si ritrova il badge
// senza che nessuno tocchi il codice, e la pagina Badge, l'importazione e la verifica di
// un timbro da mappa mostrano lo stesso elenco.
async function puntiTimbrabili() {
    const perCodice = new Map();
    for (const b of CATALOGO_BADGE) {
        if (isFiniteNum(b.lat) && isFiniteNum(b.lng)) perCodice.set(b.stampId, b);
    }

    const escursioni = await Hike.find({}).select('peaks').lean();
    for (const h of escursioni) {
        for (const p of (h.peaks || [])) {
            if (!p || !p.stampId || perCodice.has(p.stampId)) continue;
            if (!isFiniteNum(p.lat) || !isFiniteNum(p.lng)) continue;
            perCodice.set(p.stampId, { stampId: p.stampId, nome: p.name || 'Punto senza nome', emoji: '⛰️' });
            // Le coordinate arrivano dal documento, non dal catalogo: si riscrivono qui
            // per non dipendere dall'ordine dei campi.
            perCodice.get(p.stampId).lat = p.lat;
            perCodice.get(p.stampId).lng = p.lng;
        }
    }
    return Array.from(perCodice.values());
}

// Mezza finestra in gradi, larga quanto la soglia: prima di pagare una haversine si
// scartano con due sottrazioni la quasi totalita' dei punti, cosi' anche una traccia da
// decine di migliaia di punti non diventa un calcolo pesante sul server. gradiLat e'
// costante; gradiLng dipende dalla latitudine di riferimento (i meridiani si stringono
// salendo verso i poli).
function finestraGradi(latRif) {
    return {
        gradiLat: SOGLIA_TIMBRO_M / 111320,
        gradiLng: SOGLIA_TIMBRO_M / (111320 * Math.max(0.1, Math.cos(latRif * Math.PI / 180)))
    };
}

// Distanza minima in metri fra un punto {lat,lng} e una traccia (array di tuple compatte
// [lng, lat, ...] come le salva ActiveHikeSession). Infinity se nessun punto della traccia
// entra nella finestra. Una passata sola sui punti.
// Serve quando oltre al si'/no interessa QUANTO vicino si e' passati (assegnaTimbriDallaTraccia
// lo mostra a schermo: "sei arrivato a Xm dalla cima").
function distanzaMinimaDaTraccia(punti, lat, lng) {
    const { gradiLat, gradiLng } = finestraGradi(lat);
    let minimo = Infinity;
    for (const p of (punti || [])) {
        if (Math.abs(p[1] - lat) > gradiLat) continue;
        if (Math.abs(p[0] - lng) > gradiLng) continue;
        const d = haversineKm(p[1], p[0], lat, lng) * 1000;
        if (d < minimo) minimo = d;
    }
    return minimo;
}

// Vero se almeno un punto della traccia sta entro SOGLIA_TIMBRO_M dal punto {lat,lng}.
// Non calcola il minimo: si ferma al primo punto dentro soglia. Da preferire quando serve
// solo il si'/no (contare quante sessioni distinte toccano una vetta; decidere se un
// timbro da mappa e' legittimo).
function tracciaToccaPunto(punti, lat, lng) {
    const { gradiLat, gradiLng } = finestraGradi(lat);
    return (punti || []).some(p =>
        Math.abs(p[1] - lat) <= gradiLat &&
        Math.abs(p[0] - lng) <= gradiLng &&
        haversineKm(p[1], p[0], lat, lng) * 1000 <= SOGLIA_TIMBRO_M
    );
}

module.exports = {
    SOGLIA_TIMBRO_M,
    puntiTimbrabili,
    distanzaMinimaDaTraccia,
    tracciaToccaPunto
};
