const express = require('express');
const router = express.Router();
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Hike = require('../models/Hike');
const TrailCandidate = require('../models/TrailCandidate');
const Stamp = require('../models/Stamp'); // timbri assegnati dalle tracce .gpx importate
const { requireAuth } = require('../middleware/auth');
const { isFiniteNum, haversineKm, simplifyTrack } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');
const { parseGpx, statisticheTraccia, ErroreGpx } = require('../lib/gpx');
const trailIndex = require('../lib/trailIndex');
const { mongoose } = require('../db/mongo');

const MAX_POINTS_PER_BATCH = 500; // un client onesto ne manda ~60-180 ogni 20-30s, mai a uno a uno
const MIN_ELEVATION_DELTA_M = 3; // sotto questa soglia il "dislivello" e' rumore del GPS, non salita reale
const SIMPLIFY_TOLERANCE_M = 8; // stessa scala dell'errore medio OSM (~10m) citato in tutto il progetto
const MIN_CANDIDATE_POINTS = 5; // sotto questa lunghezza un tratto "fuori sentiero" e' solo rumore GPS, non un percorso da segnalare

// --- Punto 15: caricamento di file .gpx ---
// Cinque al mese per utente, come proposto dall'utente stesso. La stima dello spazio
// fatta il 2026-07-27 dice che si potrebbe alzare parecchio (4 utenti x 5 file al mese
// fanno 7,2 MB all'anno sui 478 liberi, cioe' l'1,5%), ma un tetto serve comunque:
// senza, un solo caricamento automatico impazzito riempirebbe il database prima che
// qualcuno se ne accorga. E' una valvola di sicurezza, non un razionamento.
const MAX_GPX_AL_MESE = 5;
// Il corpo della richiesta e' gia' limitato a 10 MB da express.json in server.js; qui
// si ricontrolla sul TESTO del file perche' quel limite vale per l'intera richiesta e
// perche' un rifiuto con un messaggio comprensibile e' meglio di un 413 muto.
const MAX_BYTE_GPX = 10 * 1024 * 1024;
// Quanti punti si guardano per decidere se la traccia sta nelle quattro regioni del
// progetto: controllarli tutti su una traccia da 30.000 punti sarebbe sprecato, il
// campione dice la stessa cosa.
const CAMPIONE_REGIONE = 40;
// Soglia del dislivello per le tracce IMPORTATE. E' 10 e non 3 come MIN_ELEVATION_DELTA_M
// perche' i due numeri non misurano la stessa cosa: dal vivo i 3 metri sono il salto fra
// DUE PUNTI CONSECUTIVI, qui i 10 metri sono quanto bisogna essere SALITI in tutto sopra
// l'ultimo avvallamento perche' la salita venga contata (vedi statisticheTraccia).
// Servono due regole diverse perche' i dati sono diversi: dal vivo i punti arrivano a
// gruppi e il totale si aggiorna man mano, quindi non si puo' guardare tutta la traccia
// insieme; qui il file c'e' tutto e si puo' fare il conto giusto.
// Misurato: con la regola del singolo passo un tremolio di +-2 m su un percorso PIATTO
// produceva 800 m di dislivello inventato; con questa produce zero, e una salita regolare
// da 598 m ne conta 596.
const SOGLIA_DISLIVELLO_IMPORT_M = 10;

// Ripulisce un gruppo di punti mandati dal client: scarta tuple malformate o fuori dai
// range possibili (lat/lng invalide), tollera l'altitudine mancante (frequente sui telefoni
// senza barometro) sostituendola con l'ultima nota invece di buttare via l'intero punto.
function sanitizePoints(raw, fallbackAlt) {
    if (!Array.isArray(raw)) return [];
    let lastAlt = isFiniteNum(fallbackAlt) ? fallbackAlt : 0;
    const cleaned = [];

    for (const p of raw.slice(0, MAX_POINTS_PER_BATCH)) {
        if (!Array.isArray(p) || p.length < 5) continue;
        const [lng, lat, altRaw, t, acc] = p;
        if (!isFiniteNum(lng) || !isFiniteNum(lat) || !isFiniteNum(t) || !isFiniteNum(acc)) continue;
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

        const alt = isFiniteNum(altRaw) ? altRaw : lastAlt;
        lastAlt = alt;
        cleaned.push([lng, lat, alt, t, acc]);
    }
    return cleaned;
}

// Fase G - Prova ad agganciare ogni punto al sentiero conosciuto piu' vicino (entro una
// soglia che si adatta alla precisione GPS del momento). I punti che restano "fuori
// sentiero" per un tratto consistente vengono accumulati in un buffer sulla sessione
// stessa (dura tra piu' gruppi di punti, un tratto fuori sentiero puo' durare piu' di un
// invio) e, appena si ritorna su un sentiero noto, salvati come TrailCandidate per una
// futura mappatura manuale - esattamente come richiesto in cose_da_fare.txt.
async function snapAndBufferPoints(newPoints, existingBuffer, context) {
    const finalPoints = [];
    let buffer = existingBuffer.slice();
    const candidatesToCreate = [];

    for (const p of newPoints) {
        const [lng, lat, alt, t, acc] = p;
        const snap = trailIndex.snapPoint(lng, lat, acc);

        if (snap) {
            finalPoints.push([snap.point[0], snap.point[1], alt, t, acc]);
            if (buffer.length >= MIN_CANDIDATE_POINTS) {
                candidatesToCreate.push(buffer);
            }
            buffer = [];
        } else {
            const rawPoint = [lng, lat, alt, t, acc];
            finalPoints.push(rawPoint);
            buffer.push(rawPoint);
        }
    }

    for (const points of candidatesToCreate) {
        await TrailCandidate.create({ ...context, points });
    }

    return { finalPoints, buffer };
}

const MAX_NEARBY_RADIUS_KM = 15; // tetto massimo: il telefono deve scaricare solo i sentieri di una zona, non l'intero database regionale

// Fase G - Sentieri conosciuti vicini a un punto (coordinate complete), usata dal telefono
// UNA VOLTA all'avvio di un tracciamento per un aggancio "veloce e approssimato" in locale,
// mostrato subito mentre si aspetta la correzione autorevole del server ad ogni sincronizzazione.
router.get('/nearby-trails', requireAuth, (req, res) => {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    const radiusKm = Math.min(parseFloat(req.query.radiusKm) || 5, MAX_NEARBY_RADIUS_KM);

    if (!isFiniteNum(lng) || !isFiniteNum(lat)) {
        return res.status(400).json({ error: 'Coordinate mancanti o non valide' });
    }

    const trails = trailIndex.getNearbyTrails(lng, lat, radiusKm * 1000);
    res.json(trails);
});

// Sessione di tracciamento attualmente aperta (active/paused) dell'utente loggato, se esiste.
// Usata sia per "riprendi dopo un ricaricamento" sia da /start per non crearne una seconda.
router.get('/active', requireAuth, async (req, res) => {
    const session = await ActiveHikeSession.findOne({ userId: req.session.userId, openSession: true });
    res.json(session || null);
});

// Punto 16 di cose_da_fare.txt - i TOTALI reali dell'utente per la Dashboard.
//
// I dati esistevano gia' dalla Fase F (ogni sessione salva distanza e dislivello davvero
// percorsi): mancava solo sommarli. Il conto si fa QUI e non nel browser perche' altrimenti
// bisognerebbe spedire al telefono l'elenco di tutte le sessioni per poi ridurlo a tre
// numeri - e le sessioni contengono le tracce GPS, che sono la cosa piu' pesante del
// database. Cosi' invece viaggiano solo i tre numeri.
//
// Si escludono i punti dalla query (.select) proprio per questo: sono migliaia di coordinate
// per escursione e qui non servono. NON si usa .lean() di proposito - durationSeconds e'
// una proprieta' calcolata dello schema (vedi models/ActiveHikeSession.js), e ricalcolarne
// la formula a mano dentro una aggregazione vorrebbe dire tenerne due copie allineate.
router.get('/totals', requireAuth, async (req, res) => {
    try {
        // Solo le sessioni CONCLUSE: una registrazione ancora aperta e' un'escursione in
        // corso, e farla entrare nei totali li farebbe crescere sotto gli occhi dell'utente
        // mentre cammina, senza che sia ancora "fatta".
        const sessioni = await ActiveHikeSession
            .find({ userId: req.session.userId, status: 'ended' })
            .select('-points -offTrailBuffer');

        // DUE COPPIE DI SOMME, e la distinzione e' il punto delicato di tutta questa rotta.
        //
        // Da quando si accettano i file .gpx senza orari (decisione dell'utente del
        // 2026-07-27) esistono uscite di cui si sanno i chilometri ma NON il tempo. Quei
        // chilometri sono stati camminati davvero e devono comparire nel totale.
        // Ma la velocita' media e' distanza diviso tempo: mettere quei chilometri al
        // numeratore SENZA il tempo corrispondente al denominatore la gonfierebbe - ed e'
        // esattamente il numero falso per cui prima questi file venivano respinti. Il
        // divieto e' stato tolto, il motivo del divieto no.
        // Quindi: distanza e dislivello si sommano su TUTTE le uscite; la velocita' media
        // si calcola SOLO su quelle di cui si conoscono entrambi i termini.
        let distanzaKm = 0, dislivelloM = 0;
        let distanzaConTempoKm = 0, secondi = 0, senzaDurata = 0;
        for (const s of sessioni) {
            distanzaKm += s.distanceKm || 0;
            dislivelloM += s.elevationGainM || 0;

            if (s.durationUnknown) {
                senzaDurata++;
                continue;
            }
            distanzaConTempoKm += s.distanceKm || 0;
            secondi += s.durationSeconds || 0;
        }

        // Velocita' media sui TOTALI, non media delle medie: una registrazione di 10 minuti
        // e una di 6 ore non possono pesare uguale. (Media delle medie = errore classico.)
        const ore = secondi / 3600;
        const velocitaMediaKmh = ore > 0 ? Math.round((distanzaConTempoKm / ore) * 10) / 10 : 0;

        res.json({
            sessioni: sessioni.length,
            distanzaKm: Math.round(distanzaKm * 10) / 10,
            dislivelloM: Math.round(dislivelloM),
            secondi: Math.round(secondi),
            velocitaMediaKmh,
            // Quante uscite non hanno potuto entrare nel tempo e nella velocita'. Serve a
            // schermo: una velocita' media calcolata su una parte delle uscite va detto che
            // e' calcolata su una parte, altrimenti sembra semplicemente sbagliata a chi
            // conosce i propri numeri.
            sessioniSenzaDurata: senzaDurata
        });
    } catch (e) {
        console.error('Errore nel calcolo dei totali di tracciamento:', e);
        res.status(500).json({ error: 'Impossibile calcolare i totali' });
    }
});

// Elenco delle uscite gia' concluse dell'utente: lo storico.
//
// SERVIVA AL PUNTO 15 E NON ESISTEVA. Prima di oggi nessuna rotta e nessuna schermata
// mostrava le sessioni passate: l'unica cosa che le leggeva era /totals, che ne ricava
// tre numeri. Quindi ogni uscita registrata spariva dentro un totale, e un file .gpx
// importato avrebbe fatto la stessa fine - l'utente avrebbe visto i chilometri salire
// senza poter vedere l'uscita. Ma la richiesta e' esattamente "costruirsi uno storico".
//
// I punti GPS sono esclusi dalla risposta: sono la cosa piu' pesante del database e in
// un elenco non servono. Chi vorra' rivedere il percorso sulla mappa lo chiedera' per
// una traccia sola.
router.get('/sessions', requireAuth, async (req, res) => {
    try {
        const sessioni = await ActiveHikeSession
            .find({ userId: req.session.userId, status: 'ended' })
            .select('-points -offTrailBuffer')
            .sort({ startedAt: -1 })
            .limit(200); // niente .lean(): durationSeconds e avgSpeedKmh sono virtuali dello schema
        res.json(sessioni);
    } catch (e) {
        console.error('Errore lettura storico uscite:', e);
        res.status(500).json({ error: 'Impossibile caricare lo storico' });
    }
});

// --- Badge conquistati da una traccia importata (richiesta dell'utente, 2026-07-27) ---
//
// "Importando la traccia dimostri di averlo gia' conquistato": e' vero, ed era un buco.
// L'utente ha importato la sua salita al Corno Grande e il badge e' rimasto da conquistare,
// perche' i timbri si sbloccavano SOLO col geofencing della Mappa (checkGeofencing in
// public/js/map.js), che gira nel browser mentre si cammina. Una traccia importata non
// passava da nessuna parte.
//
// STESSA REGOLA DELLA MAPPA, di proposito: gli stessi 150 metri e lo stesso catalogo di
// punti (public/js/badge-points.js, letto da qui e dal browser). Due soglie diverse
// vorrebbero dire che camminare con il sito aperto e importare la stessa traccia danno
// risultati diversi - cioe' che uno dei due sta sbagliando, senza poter dire quale.
const SOGLIA_TIMBRO_M = 150;
const CATALOGO_BADGE = require('../public/js/badge-points.js');

// Il catalogo fisso PIU' le vette delle escursioni sul database, come fa catalogo() in
// public/js/badges.js: chi crea un'escursione con una vetta nuova si ritrova il badge
// senza che nessuno tocchi il codice, e la pagina Badge e l'importazione mostrano lo
// stesso elenco.
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

// Restituisce i badge NUOVI conquistati dalla traccia, gia' salvati sul database.
// Non solleva mai: un badge non assegnato e' un dispiacere, un'importazione fallita dopo
// che la traccia e' gia' salvata sarebbe un guaio (l'utente ha consumato uno dei 5
// caricamenti del mese e vede un errore).
async function assegnaTimbriDallaTraccia(userId, punti, dataUscita) {
    try {
        const candidati = await puntiTimbrabili();
        if (!candidati.length || !punti.length) return [];

        // Una passata sola sui punti. Per ogni candidato si tiene una finestra in gradi
        // larga quanto la soglia: il confronto costa due sottrazioni e scarta subito la
        // quasi totalita' dei punti, cosi' anche una traccia da decine di migliaia di
        // punti non diventa un calcolo pesante sul server.
        const gradiLat = SOGLIA_TIMBRO_M / 111320;
        const raggiunti = new Map();

        for (const c of candidati) {
            const gradiLng = SOGLIA_TIMBRO_M / (111320 * Math.max(0.1, Math.cos(c.lat * Math.PI / 180)));
            let minimo = Infinity;
            for (const p of punti) {
                if (Math.abs(p[1] - c.lat) > gradiLat) continue;
                if (Math.abs(p[0] - c.lng) > gradiLng) continue;
                const d = haversineKm(p[1], p[0], c.lat, c.lng) * 1000;
                if (d < minimo) minimo = d;
            }
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

// --- PUNTO 15: importazione di una traccia .gpx come escursione gia' fatta ---
//
// Sta insieme al tracciamento e non in una rotta a parte perche' il risultato e'
// esattamente lo stesso oggetto: una ActiveHikeSession conclusa. Cosi' una traccia
// importata entra da sola nei totali della Dashboard ("Quanto hai camminato", punto 16)
// senza aggiungere nessun collegamento nuovo - che e' poi il senso della richiesta,
// "costruirsi uno storico anche delle uscite fatte prima di usare il sito".
router.post('/import-gpx', requireAuth, async (req, res) => {
    try {
        const testo = req.body && req.body.gpx;
        if (typeof testo !== 'string' || !testo.trim()) {
            return res.status(400).json({ error: 'Nessun file .gpx ricevuto.' });
        }
        if (Buffer.byteLength(testo, 'utf8') > MAX_BYTE_GPX) {
            return res.status(413).json({ error: 'Il file supera i 10 MB. Un\'escursione registrata normalmente pesa meno di 1 MB.' });
        }

        // Il tetto si conta sui caricamenti fatti QUESTO MESE, non sulle date delle
        // escursioni: chi importa dieci uscite del 2019 le sta comunque caricando adesso.
        // Il momento del caricamento e' gia' dentro l'_id del documento (ObjectId), quindi
        // non serve un campo in piu' su ogni traccia - c'e' il vincolo hard sullo spazio.
        const inizioMese = new Date();
        inizioMese.setDate(1);
        inizioMese.setHours(0, 0, 0, 0);
        const sogliaId = mongoose.Types.ObjectId.createFromTime(Math.floor(inizioMese.getTime() / 1000));

        const giaCaricati = await ActiveHikeSession.countDocuments({
            userId: req.session.userId,
            importedFrom: 'gpx',
            _id: { $gte: sogliaId }
        });
        if (giaCaricati >= MAX_GPX_AL_MESE) {
            const prossimo = new Date(inizioMese);
            prossimo.setMonth(prossimo.getMonth() + 1);
            return res.status(429).json({
                error: `Hai gia' caricato ${giaCaricati} file questo mese (il massimo e' ${MAX_GPX_AL_MESE}). Potrai caricarne altri dal ${prossimo.toLocaleDateString('it-IT')}.`
            });
        }

        // Lettura del file. Gli errori di parseGpx hanno gia' un messaggio scritto per
        // l'utente (flag .utente): si rimanda quello invece di un generico "file non valido",
        // perche' i motivi sono diversi fra loro e alcuni si risolvono (usare l'esportazione
        // giusta dell'app, non un itinerario progettato).
        let letto;
        try {
            letto = parseGpx(testo);
        } catch (e) {
            if (e instanceof ErroreGpx || e.utente) return res.status(400).json({ error: e.message });
            throw e;
        }

        // Vincolo geografico del progetto: Marche, Lazio, Abruzzo, Molise. Si guarda un
        // campione di punti e si chiede che la MAGGIORANZA sia dentro, invece del solo punto
        // di partenza come fa la creazione di un'escursione: un sentiero di crinale entra ed
        // esce dai confini di continuo, e bocciare una traccia per il punto in cui si e'
        // premuto "avvia" sarebbe un rifiuto a caso.
        const passo = Math.max(1, Math.floor(letto.punti.length / CAMPIONE_REGIONE));
        let dentro = 0, esaminati = 0;
        for (let i = 0; i < letto.punti.length; i += passo) {
            esaminati++;
            if (regionForPoint(letto.punti[i][0], letto.punti[i][1])) dentro++;
        }
        if (dentro * 2 <= esaminati) {
            return res.status(400).json({
                error: 'Questa traccia si svolge fuori dalle quattro regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise).'
            });
        }

        // Statistiche PRIMA di semplificare, sui dati completi: e' la stessa regola gia'
        // seguita a fine registrazione in Fase F. Semplificare serve a risparmiare spazio
        // sul disegno della linea, non a cambiare quanti chilometri hai camminato.
        const { distanzaKm, dislivelloM } = statisticheTraccia(letto.punti, SOGLIA_DISLIVELLO_IMPORT_M, haversineKm);
        const puntiSemplificati = simplifyTrack(letto.punti, SIMPLIFY_TOLERANCE_M);

        // Quando il file non porta nessuna data (ne' sui punti ne' nell'intestazione) si usa
        // il momento del caricamento, perche' startedAt e' obbligatorio nello schema e senza
        // una data l'uscita non si collocherebbe nello storico. NON si finge che sia un dato
        // del file: parseGpx ha gia' aggiunto l'avviso che lo dice a schermo.
        const inizio = letto.inizio || new Date();
        const fine = letto.fine || inizio;

        const sessione = await ActiveHikeSession.create({
            userId: req.session.userId,
            hikeId: null,
            status: 'ended',
            startedAt: inizio,
            lastPointAt: fine,
            endedAt: fine,
            distanceKm: distanzaKm,
            elevationGainM: dislivelloM,
            points: puntiSemplificati,
            importedFrom: 'gpx',
            importedName: (letto.nome || '').slice(0, 120) || undefined,
            // Solo dove serve: su una traccia con gli orari il campo non viene scritto affatto.
            durationUnknown: letto.durataIgnota ? true : undefined
            // openSession NON impostato di proposito: una traccia importata e' gia' conclusa,
            // e l'indice unico parziale su openSession impedirebbe di caricarne una seconda
            // mentre una registrazione dal vivo e' in corso.
        });

        // Timbri conquistati da questa traccia: chi e' passato su una vetta ce l'ha
        // raggiunta, e il badge glielo si deve. Vedi assegnaTimbriDallaTraccia.
        // Si guardano i punti COMPLETI, non quelli semplificati: la semplificazione puo'
        // spostare la linea fino a 8 metri e su una vetta contano i metri.
        const timbri = await assegnaTimbriDallaTraccia(req.session.userId, letto.punti, inizio);

        res.json({
            id: sessione._id,
            nome: sessione.importedName || null,
            distanzaKm,
            dislivelloM,
            durataSecondi: letto.durataIgnota ? null : sessione.durationSeconds,
            durataIgnota: !!letto.durataIgnota,
            puntiLetti: letto.punti.length,
            puntiSalvati: puntiSemplificati.length,
            inizio,
            avvisi: letto.avvisi,
            badge: timbri,
            caricatiQuestoMese: giaCaricati + 1,
            massimoAlMese: MAX_GPX_AL_MESE
        });
    } catch (e) {
        console.error('Errore importazione .gpx:', e);
        res.status(500).json({ error: 'Non e\' stato possibile importare il file. Riprova.' });
    }
});

router.post('/start', requireAuth, async (req, res) => {
    try {
        const existing = await ActiveHikeSession.findOne({ userId: req.session.userId, openSession: true });
        if (existing) {
            return res.json(existing); // idempotente: se ce n'e' gia' una aperta, la riusa
        }

        let hikeId = null;
        if (req.body.hikeId) {
            const hike = await Hike.findById(req.body.hikeId);
            if (hike) hikeId = hike._id;
        }

        const session = await ActiveHikeSession.create({
            userId: req.session.userId,
            hikeId,
            status: 'active',
            startedAt: new Date(),
            openSession: true
        });
        res.json(session);
    } catch (e) {
        console.error('Errore avvio tracciamento GPS:', e);
        res.status(400).json({ error: 'Impossibile avviare il tracciamento' });
    }
});

// Aggiunge un GRUPPO di punti (mai un punto alla volta: troppo dispendioso in montagna
// con poco campo). L'identita' di chi possiede la sessione e' sempre quella della sessione
// di login, mai un valore mandato dal client, stesso criterio gia' usato in tutto il resto dell'app.
router.post('/:id/points', requireAuth, async (req, res) => {
    try {
        // Solo i campi che servono davvero: non serve leggere l'intera traccia
        // (potenzialmente lunga ore) solo per aggiungere un piccolo gruppo di punti nuovi.
        const session = await ActiveHikeSession.findById(req.params.id, {
            userId: 1,
            hikeId: 1,
            status: 1,
            points: { $slice: -1 },
            offTrailBuffer: 1
        });

        if (!session || String(session.userId) !== req.session.userId) {
            return res.status(404).json({ error: 'Sessione di tracciamento non trovata' });
        }
        if (session.status === 'ended') {
            return res.status(409).json({ error: 'Questo tracciamento e\' gia\' terminato' });
        }

        let lastPoint = session.points.length > 0 ? session.points[0] : null;
        let sanitized = sanitizePoints(req.body.points, lastPoint ? lastPoint[2] : 0);

        // Idempotenza: se il telefono rimanda un gruppo di punti gia' ricevuto (es. la
        // richiesta precedente e' andata a buon fine sul server ma la risposta si e' persa per
        // strada, proprio il caso "poco campo" per cui esiste questa funzionalita' - il client
        // allora la considera fallita e la rimette in coda), scarta i punti non piu' nuovi del
        // l'ultimo gia' salvato invece di risommarne distanza/dislivello e duplicarli in coda.
        if (lastPoint) {
            sanitized = sanitized.filter(p => p[3] > lastPoint[3]);
        }
        if (sanitized.length === 0) {
            return res.status(400).json({ error: 'Nessun punto GPS valido ricevuto' });
        }

        // Fase G: prova ad agganciare ogni punto al sentiero noto piu' vicino prima di
        // calcolare distanza/dislivello, cosi' un piccolo sbandamento del GPS non si
        // traduce in metri di percorso o dislivello inventati (vedi snapAndBufferPoints).
        const { finalPoints: newPoints, buffer: newBuffer } = await snapAndBufferPoints(
            sanitized,
            session.offTrailBuffer || [],
            { userId: session.userId, hikeId: session.hikeId, sessionId: session._id }
        );

        let addedDistanceKm = 0;
        let addedElevationM = 0;
        for (const p of newPoints) {
            if (lastPoint) {
                addedDistanceKm += haversineKm(lastPoint[1], lastPoint[0], p[1], p[0]);
                const deltaAlt = p[2] - lastPoint[2];
                if (deltaAlt > MIN_ELEVATION_DELTA_M) addedElevationM += deltaAlt;
            }
            lastPoint = p;
        }

        // Risposta senza l'array "points": il client ha gia' tutti i punti (li ha mandati lui),
        // rispedire indietro l'intera traccia crescente ad ogni gruppo sprecherebbe banda
        // sempre di piu' man mano che l'escursione si allunga.
        const updated = await ActiveHikeSession.findByIdAndUpdate(
            session._id,
            {
                $push: { points: { $each: newPoints } },
                $inc: {
                    distanceKm: Math.round(addedDistanceKm * 1000) / 1000,
                    elevationGainM: Math.round(addedElevationM)
                },
                $set: { lastPointAt: new Date(), status: 'active', offTrailBuffer: newBuffer }
            },
            { new: true, select: '-points' }
        );

        res.json(updated);
    } catch (e) {
        console.error('Errore salvataggio punti GPS:', e);
        res.status(400).json({ error: 'Impossibile salvare i punti GPS' });
    }
});

router.post('/:id/pause', requireAuth, async (req, res) => {
    try {
        const session = await ActiveHikeSession.findById(req.params.id);
        if (!session || String(session.userId) !== req.session.userId) {
            return res.status(404).json({ error: 'Sessione di tracciamento non trovata' });
        }
        if (session.status === 'active') {
            session.status = 'paused';
            session.pausedAt = new Date();
            await session.save();
        }
        res.json(session);
    } catch (e) {
        res.status(400).json({ error: 'Impossibile mettere in pausa il tracciamento' });
    }
});

router.post('/:id/resume', requireAuth, async (req, res) => {
    try {
        const session = await ActiveHikeSession.findById(req.params.id);
        if (!session || String(session.userId) !== req.session.userId) {
            return res.status(404).json({ error: 'Sessione di tracciamento non trovata' });
        }
        if (session.status === 'paused') {
            // Il tempo appena passato in pausa si somma al totale escluso dalla durata,
            // cosi' il passo medio finale non viene falsato da una sosta lunga.
            if (session.pausedAt) {
                session.pausedMs = (session.pausedMs || 0) + (Date.now() - session.pausedAt.getTime());
                session.pausedAt = null;
            }
            session.status = 'active';
            await session.save();
        }
        res.json(session);
    } catch (e) {
        res.status(400).json({ error: 'Impossibile riprendere il tracciamento' });
    }
});

router.post('/:id/end', requireAuth, async (req, res) => {
    try {
        const session = await ActiveHikeSession.findById(req.params.id);
        if (!session || String(session.userId) !== req.session.userId) {
            return res.status(404).json({ error: 'Sessione di tracciamento non trovata' });
        }

        let result = session;
        if (session.status !== 'ended') {
            // Se si termina mentre la sessione era in pausa, l'ultimo intervallo di pausa
            // (mai chiuso da un /resume) va comunque escluso dalla durata finale.
            let pausedMs = session.pausedMs || 0;
            if (session.pausedAt) {
                pausedMs += (Date.now() - session.pausedAt.getTime());
            }

            // Una volta archiviata la traccia dettagliata non serve piu' punto per punto:
            // viene semplificata per risparmiare spazio (vincolo hard di cose_da_fare.txt),
            // le statistiche sopra sono gia' state calcolate sui dati completi prima d'ora.
            const simplifiedPoints = simplifyTrack(session.points, SIMPLIFY_TOLERANCE_M);

            // Fase G: se l'escursione finisce mentre si e' ancora su un tratto "fuori
            // sentiero" (mai tornato su un sentiero noto per triggerare il flush in
            // routes/tracking.js snapAndBufferPoints), quel tratto va comunque salvato ora,
            // altrimenti andrebbe perso insieme al buffer temporaneo qui sotto.
            if ((session.offTrailBuffer || []).length >= MIN_CANDIDATE_POINTS) {
                await TrailCandidate.create({
                    userId: session.userId,
                    hikeId: session.hikeId,
                    sessionId: session._id,
                    points: session.offTrailBuffer
                });
            }

            // $unset esplicito invece di assegnare "undefined" + save(): con un campo che ha
            // un default nello schema, Mongoose lo ripristina invece di toglierlo davvero,
            // lasciando "openSession" a true per sempre (bug scoperto durante la verifica dal
            // vivo: una sessione conclusa restava comunque "quella aperta" per l'utente,
            // impedendo di avviarne mai una nuova).
            result = await ActiveHikeSession.findByIdAndUpdate(
                session._id,
                {
                    $set: {
                        status: 'ended',
                        endedAt: new Date(),
                        pausedMs,
                        pausedAt: null,
                        points: simplifiedPoints
                    },
                    $unset: { openSession: 1, offTrailBuffer: 1 }
                },
                { new: true }
            );
        }

        res.json(result);
    } catch (e) {
        console.error('Errore chiusura tracciamento GPS:', e);
        res.status(400).json({ error: 'Impossibile terminare il tracciamento' });
    }
});

module.exports = router;
