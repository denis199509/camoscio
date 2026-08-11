// Estratta da routes/hikes.js (punto 80/A) perche' ora la usa anche routes/completions.js
// (aggiungere un .gpx retroattivo a un'escursione gia' segnata come completata) - un router
// Express esporta solo il router stesso, non le funzioni interne, quindi calcolaDaPercorso
// non poteva restare li' dentro se doveva servire anche altrove. Stessa idea gia' seguita
// per applyHikeCompletionStats (lib/hikeStats.js, punto 64): la logica si scrive una volta
// sola, i chiamanti decidono solo il "chi"/"quando".
const { mongoose } = require('../db/mongo');
const RouteDraft = require('../models/RouteDraft');
const { regionForPoint } = require('./regions');
const { haversineKm } = require('./geometry');
const { parseGpx, statisticheTraccia, ErroreGpx, SOGLIA_DISLIVELLO_M } = require('./gpx');
const { progettaPercorso } = require('./trailGraph');

// --- PUNTO 43: quota massima, dislivello e distanza calcolati da un percorso vero ---
//
// "routeSource" e' facoltativo: assente, tutto resta scritto a mano come sempre. Presente,
// i tre numeri si CALCOLANO invece di fidarsi di un valore mandato dal client - un numero
// mandato dal client non e' un dato, e' un'affermazione (stesso principio gia' applicato ai
// progetti in routes/routing.js). Solleva un Error col messaggio gia' pronto per l'utente.
const MAX_BYTE_GPX_HIKE = 10 * 1024 * 1024; // stesso tetto di routes/tracking.js
const CAMPIONE_REGIONE_HIKE = 40; // stesso campione di routes/tracking.js

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
        if (!esito.dislivelloDisponibile) {
            throw new Error('La fonte delle quote non ha risposto per questo progetto: riprova fra poco.');
        }
        return {
            maxAltitude: Math.round(esito.quotaMaxM),
            elevationGain: Math.round(esito.salitaM),
            distanceKm: Math.round(esito.metriTotali / 100) / 10,
            routeSource: { kind: 'draft', nome: bozza.nome }
        };
    }

    if (routeSource.kind === 'gpx') {
        const testo = routeSource.gpxText;
        if (typeof testo !== 'string' || !testo.trim()) {
            throw new Error('Nessun file .gpx ricevuto.');
        }
        if (Buffer.byteLength(testo, 'utf8') > MAX_BYTE_GPX_HIKE) {
            throw new Error('Il file supera i 10 MB. Una traccia normalmente pesa molto meno.');
        }

        let letto;
        try {
            letto = parseGpx(testo);
        } catch (e) {
            throw new Error((e instanceof ErroreGpx || e.utente) ? e.message : 'File .gpx non leggibile.');
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
            throw new Error('Questo file .gpx non contiene le quote: non è possibile calcolare il dislivello.');
        }
        return {
            maxAltitude: stats.quotaMaxM,
            elevationGain: stats.dislivelloM,
            distanceKm: stats.distanzaKm,
            routeSource: { kind: 'gpx', nome: (letto.nome || 'Traccia importata').slice(0, 80) },
            // Punto 79: il gpx gia' letto, cosi' chi ha bisogno di inizio/fine o dei punti
            // (es. tempiTraccia in complete-group) non deve fare un secondo giro di parseGpx
            // sullo stesso testo - file fino a 10 MB, Render a 512 MB gia' caduto una volta.
            // Aggiunta pura: chi ignora questo campo (creazione/modifica escursione) non cambia.
            gpxLetto: letto
        };
    }

    throw new Error('Percorso non valido.');
}

module.exports = { calcolaDaPercorso, MAX_BYTE_GPX_HIKE, CAMPIONE_REGIONE_HIKE };
