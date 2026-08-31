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
const Stamp = require('../models/Stamp'); // assegnaTimbriDallaTraccia (spostata qui il 2026-08-31)
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

// --- Badge conquistati da una traccia importata (richiesta dell'utente, 2026-07-27) ---
//
// "Importando la traccia dimostri di averlo gia' conquistato": e' vero, ed era un buco -
// i timbri si sbloccavano SOLO col geofencing della Mappa (checkGeofencing in
// public/js/map.js), che gira nel browser mentre si cammina, e una traccia importata non
// passava da nessuna parte. La chiamano /import-gpx (routes/tracking.js) e il tasto ⬆ su
// un'escursione gia' completata (routes/completions.js) - spostata qui il 2026-08-31
// (coda punto 113) perche' serviva a entrambi ma viveva dentro tracking.js senza export.
//
// Restituisce i badge NUOVI conquistati dalla traccia, gia' salvati sul database.
// Non solleva mai: un badge non assegnato e' un dispiacere, un'importazione fallita dopo
// che la traccia e' gia' salvata sarebbe un guaio (l'utente ha consumato uno dei 5
// caricamenti del mese e vede un errore).
async function assegnaTimbriDallaTraccia(userId, punti, dataUscita) {
    try {
        const candidati = await puntiTimbrabili();
        if (!candidati.length || !punti.length) return [];

        // distanzaMinimaDaTraccia fa una passata sola sui punti con una finestra in gradi
        // larga quanto la soglia, cosi' anche una traccia da decine di migliaia di punti
        // non diventa un calcolo pesante. Qui serve il minimo e non solo il si'/no: la
        // distanza si mostra a schermo ("sei arrivato a Xm dalla cima").
        const raggiunti = new Map();
        for (const c of candidati) {
            const minimo = distanzaMinimaDaTraccia(punti, c.lat, c.lng);
            if (minimo <= SOGLIA_TIMBRO_M) raggiunti.set(c.stampId, { punto: c, distanzaM: Math.round(minimo) });
        }
        if (!raggiunti.size) return [];

        // La DATA del timbro e' quella dell'ESCURSIONE, non quella del caricamento: chi
        // importa nel 2026 una salita del 2024 l'ha conquistata nel 2024, e il passaporto
        // ordina i timbri per data. Stesso formato "YYYY-MM-DD" usato da routes/stamps.js.
        const giorno = dataUscita.toISOString().split('T')[0];

        const gia = await Stamp.find({ userId, stampId: { $in: [...raggiunti.keys()] } }).select('stampId').lean();
        const giaPresi = new Set(gia.map(s => s.stampId));

        const nuovi = [];
        for (const [stampId, info] of raggiunti) {
            if (giaPresi.has(stampId)) continue;
            try {
                await Stamp.create({ userId, stampId, dateUnlocked: giorno });
                nuovi.push({ stampId, nome: info.punto.nome, emoji: info.punto.emoji || '⛰️', distanzaM: info.distanzaM });
            } catch (e) {
                // 11000 = indice unico: il timbro e' comparso nel frattempo. Non e' un errore.
                if (e.code !== 11000) throw e;
            }
        }
        return nuovi;
    } catch (e) {
        console.error('Assegnazione timbri dalla traccia importata fallita:', e);
        return [];
    }
}

module.exports = {
    SOGLIA_TIMBRO_M,
    puntiTimbrabili,
    distanzaMinimaDaTraccia,
    tracciaToccaPunto,
    assegnaTimbriDallaTraccia
};
