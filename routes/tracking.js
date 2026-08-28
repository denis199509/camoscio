const express = require('express');
const router = express.Router();
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Hike = require('../models/Hike');
const TrailCandidate = require('../models/TrailCandidate');
const Stamp = require('../models/Stamp'); // timbri assegnati dalle tracce .gpx importate
const User = require('../models/User'); // punto 42b: recognizedAscents
const { requireAuth } = require('../middleware/auth');
const { isFiniteNum, haversineKm, simplifyTrack } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');
const { parseGpx, statisticheTraccia, ErroreGpx, SOGLIA_DISLIVELLO_M, movimentoSecAttendibile } = require('../lib/gpx');
const trailIndex = require('../lib/trailIndex');
const { mongoose } = require('../db/mongo');
const { recalculateAndApplyPace } = require('../lib/hikeStats');
// Soglia + catalogo + scansione di una traccia: una copia sola, condivisa con la verifica
// di un timbro da mappa (routes/stamps.js) e col conteggio salite (/peak-ascents qui sotto).
const { SOGLIA_TIMBRO_M, puntiTimbrabili, distanzaMinimaDaTraccia, tracciaToccaPunto } = require('../lib/geofenceTimbri');

const MAX_POINTS_PER_BATCH = 500; // un client onesto ne manda ~60-180 ogni 20-30s, mai a uno a uno
// LA SOGLIA DEL DISLIVELLO DAL VIVO NON ESISTE PIU' COME NUMERO A PARTE. Fino al 2026-07-28
// c'era MIN_ELEVATION_DELTA_M = 3, applicata al salto fra due punti consecutivi, ed e' stata
// tolta: si usa SOGLIA_DISLIVELLO_M di lib/gpx.js, la stessa dei file importati. Il perche'
// e' scritto per esteso dove si calcola, nella rotta /:id/points.
const SIMPLIFY_TOLERANCE_M = 8; // stessa scala dell'errore medio OSM (~10m) citato in tutto il progetto
const MIN_CANDIDATE_POINTS = 5; // sotto questa lunghezza un tratto "fuori sentiero" e' solo rumore GPS, non un percorso da segnalare

// --- Punto 15: caricamento di file .gpx ---
// Cinque al mese per utente, come proposto dall'utente stesso. La stima dello spazio
// fatta il 2026-07-27 dice che si potrebbe alzare parecchio (4 utenti x 5 file al mese
// fanno 7,2 MB all'anno sui 478 liberi, cioe' l'1,5%), ma un tetto serve comunque:
// senza, un solo caricamento automatico impazzito riempirebbe il database prima che
// qualcuno se ne accorga. E' una valvola di sicurezza, non un razionamento.
const MAX_GPX_AL_MESE = 5;

// Eccezione UNA TANTUM per il solo account di Denis, per ricaricare le 7 tracce del punto
// 92 (serve il vero movingTimeSec, mai misurato finora - vedi cose_da_fare.txt punto 92).
// SOLO agosto 2026, poi torna il tetto normale da sola: niente da disattivare a mano a
// settembre. Non e' una regola del sito, e' hardcoded apposta per restare visibile e
// temporanea - da togliere quando non serve piu' (id invece di username: stabile anche se
// lo username cambiasse).
const ECCEZIONE_TETTO_GPX_DENIS = {
    userId: '6a62e398a1e019a3d635817d',
    finoA: new Date('2026-09-01T00:00:00Z'),
    tetto: 10
};
// Il corpo della richiesta e' gia' limitato a 10 MB da express.json in server.js; qui
// si ricontrolla sul TESTO del file perche' quel limite vale per l'intera richiesta e
// perche' un rifiuto con un messaggio comprensibile e' meglio di un 413 muto.
const MAX_BYTE_GPX = 10 * 1024 * 1024;
// Quanti punti si guardano per decidere se la traccia sta nelle quattro regioni del
// progetto: controllarli tutti su una traccia da 30.000 punti sarebbe sprecato, il
// campione dice la stessa cosa.
const CAMPIONE_REGIONE = 40;
// Soglia del dislivello per le tracce IMPORTATE. LA DEFINIZIONE E IL PERCHE' STANNO ORA IN
// lib/gpx.js (spostati col punto 33): da quel giorno la usano in due, il caricamento .gpx e
// il dislivello dei percorsi progettati, e deve restare un valore solo. Il nome locale resta
// per non toccare i punti in cui e' gia' usata.
const SOGLIA_DISLIVELLO_IMPORT_M = SOGLIA_DISLIVELLO_M;

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

// Punto 74: le stesse uscite (gpx importati e registrati dal vivo), ma di UN ALTRO utente -
// per il profilo pubblico. Stessa esclusione dei punti GPS della rotta gemella sopra, stesso
// principio gia' in uso per /api/completions/:userId e /api/stamps/:userId ("achievement
// pubblici tra utenti loggati", vedi routes/stamps.js): nessun controllo di proprieta', solo
// la sessione. Se domani servisse rispettare privacySetting come fa GET /api/users/:id, va
// deciso apposta - oggi non esiste ancora una convenzione per questo tipo di dato.
router.get('/sessions/:userId', requireAuth, async (req, res) => {
    try {
        const sessioni = await ActiveHikeSession
            .find({ userId: req.params.userId, status: 'ended' })
            .select('-points -offTrailBuffer')
            .sort({ startedAt: -1 })
            .limit(200);
        res.json(sessioni);
    } catch (e) {
        console.error('Errore lettura storico uscite altrui:', e);
        res.status(500).json({ error: 'Impossibile caricare lo storico' });
    }
});

// Cancellare un'uscita dallo storico (richiesta dell'utente, 2026-07-27).
//
// PERCHE' SERVE: da quando si accettano anche i file .gpx senza orari e gli itinerari
// progettati (punto 29) e' molto piu' facile importare il file sbagliato. Senza questa
// rotta quell'uscita restava nei totali PER SEMPRE e continuava a occupare uno dei cinque
// caricamenti del mese: un errore di un secondo senza rimedio.
//
// DUE COSE DA SAPERE, entrambe volute:
//
// 1) IL POSTO NEL MESE SI RIPRENDE DA SOLO. Il tetto mensile conta i documenti con
//    importedFrom='gpx' creati questo mese (vedi /import-gpx): cancellandone uno il conto
//    scende e il caricamento torna disponibile. Non serve nessun contatore a parte - ed e'
//    giusto cosi', perche' un file caricato per errore non deve costare un posto.
//
// 2) I TIMBRI GIA' CONQUISTATI NON VENGONO REVOCATI, e non e' una dimenticanza. Sul
//    database non e' registrato PERCHE' un timbro e' stato preso: potrebbe venire da questa
//    traccia, da un'altra, o dal geofencing sulla Mappa mentre si camminava. Revocarlo
//    rischierebbe di togliere un badge guadagnato davvero, che e' l'errore peggiore fra i
//    due. La finestra di conferma lo dice per esteso, cosi' non e' una sorpresa.
router.delete('/sessions/:id', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const sessione = await ActiveHikeSession.findById(req.params.id).select('userId status importedFrom movingTimeSec');
        if (!sessione) return res.status(404).json({ error: 'Questa uscita non esiste (forse e\' gia\' stata cancellata).' });

        // Il confronto e' con req.session.userId, MAI con un id mandato dal client: e' la
        // regola presa in Fase C per tutte le rotte del progetto.
        if (String(sessione.userId) !== String(req.session.userId)) {
            return res.status(403).json({ error: 'Puoi cancellare solo le tue uscite.' });
        }
        // Una registrazione ancora aperta non si cancella da qui: va prima terminata, e il
        // pulsante per farlo e' quello della Mappa. Cancellarla mentre il telefono le sta
        // ancora mandando punti lascerebbe il tracciamento a scrivere su una cosa che non
        // c'e' piu'.
        if (sessione.status !== 'ended') {
            return res.status(409).json({ error: 'Questa registrazione e\' ancora in corso: terminala prima di cancellarla.' });
        }

        await ActiveHikeSession.deleteOne({ _id: sessione._id, userId: req.session.userId });

        // Punto 92: una traccia in meno cambia le osservazioni disponibili per il passo
        // personale allo stesso modo di una in piu' - senza, cancellare l'unica traccia
        // misurata lascerebbe un passo orfano di qualunque osservazione (stesso difetto gia'
        // chiuso per i Completion al punto 80/A). Solo se la traccia cancellata aveva
        // davvero un tempo di cammino, per non fare lavoro inutile ad ogni cancellazione.
        if (sessione.movingTimeSec) {
            try {
                const utente = await User.findById(req.session.userId);
                if (utente) await recalculateAndApplyPace(utente);
            } catch (e) {
                console.error('Errore ricalcolo passo personale dopo cancellazione traccia:', e);
            }
        }

        res.json({ success: true, eraImportata: sessione.importedFrom === 'gpx' });
    } catch (e) {
        console.error('Cancellazione uscita fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile cancellare l\'uscita. Riprova.' });
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
// La soglia (SOGLIA_TIMBRO_M), il catalogo dei punti (puntiTimbrabili) e la scansione di
// una traccia stanno in lib/geofenceTimbri.js: la stessa regola serve qui, alla rotta
// /peak-ascents piu' sotto e alla verifica di un timbro da mappa (routes/stamps.js, punto
// 108). Prima del 2026-08-28 erano due copie a mano dentro questo file.

// Restituisce i badge NUOVI conquistati dalla traccia, gia' salvati sul database.
// Non solleva mai: un badge non assegnato e' un dispiacere, un'importazione fallita dopo
// che la traccia e' gia' salvata sarebbe un guaio (l'utente ha consumato uno dei 5
// caricamenti del mese e vede un errore).
async function assegnaTimbriDallaTraccia(userId, punti, dataUscita) {
    try {
        const candidati = await puntiTimbrabili();
        if (!candidati.length || !punti.length) return [];

        // distanzaMinimaDaTraccia (lib/geofenceTimbri.js) fa una passata sola sui punti con
        // una finestra in gradi larga quanto la soglia, cosi' anche una traccia da decine di
        // migliaia di punti non diventa un calcolo pesante. Qui serve il minimo e non solo
        // il si'/no: la distanza si mostra a schermo ("sei arrivato a Xm dalla cima").
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

// --- PUNTO 42b: quante volte, non solo "se" ---
//
// Il sito registra CHE una vetta e' stata raggiunta (collezione Stamp, indice unico
// userId+stampId), mai QUANTE VOLTE: dalla seconda salita in poi il timbro esiste gia' e
// non viene creato di nuovo. Il numero "quante volte" non va su Stamp, si ricava dalle
// USCITE gia' salvate (ActiveHikeSession), con la STESSA soglia e lo STESSO catalogo del
// geofencing (150 m, vedi assegnaTimbriDallaTraccia qui sopra) - la regola gia' presa al
// punto 30 per non avere due conti diversi della stessa cosa.
//
// Il numero "riconosciuto" (User.recognizedAscents) e' facoltativo e si somma sopra: un
// PAVIMENTO scritto a mano da Denis per una persona di cui conosce lo storico precedente
// al sito, non un totale. Decisione completa in 03-Decisioni-Architetturali.md del vault
// (punto 42, meta' "vetta").
//
// Calcolato solo per le vette GIA' CONQUISTATE (chi ha un timbro): un numero fluttuante su
// una vetta mai raggiunta sul sito sarebbe uno stato che non deve poter esistere a schermo.
router.get('/peak-ascents/:userId', requireAuth, async (req, res) => {
    try {
        const userId = req.params.userId;

        const [timbri, utente, sessioni, candidatiTutti] = await Promise.all([
            Stamp.find({ userId }).select('stampId').lean(),
            User.findById(userId).select('recognizedAscents').lean(),
            ActiveHikeSession.find({ userId, status: 'ended' }).select('points').lean(),
            puntiTimbrabili()
        ]);
        if (!timbri.length) return res.json([]);

        const stampIdConquistati = new Set(timbri.map(t => t.stampId));
        const candidati = candidatiTutti.filter(p => stampIdConquistati.has(p.stampId));
        if (!candidati.length) return res.json([]);

        const pavimenti = new Map(
            ((utente && utente.recognizedAscents) || []).map(r => [r.stampId, r.count])
        );

        const risultato = candidati.map(c => {
            let siteCount = 0;
            for (const s of sessioni) {
                if (tracciaToccaPunto(s.points, c.lat, c.lng)) siteCount++;
            }
            const recognizedCount = pavimenti.get(c.stampId) || 0;
            return { stampId: c.stampId, recognizedCount, siteCount, total: recognizedCount + siteCount };
        });

        res.json(risultato);
    } catch (e) {
        console.error('Errore nel calcolo delle salite riconosciute:', e);
        res.json([]);
    }
});

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

        const tetto = (req.session.userId === ECCEZIONE_TETTO_GPX_DENIS.userId && Date.now() < ECCEZIONE_TETTO_GPX_DENIS.finoA.getTime())
            ? ECCEZIONE_TETTO_GPX_DENIS.tetto
            : MAX_GPX_AL_MESE;

        if (giaCaricati >= tetto) {
            const prossimo = new Date(inizioMese);
            prossimo.setMonth(prossimo.getMonth() + 1);
            return res.status(429).json({
                error: `Hai gia' caricato ${giaCaricati} file questo mese (il massimo e' ${tetto}). Potrai caricarne altri dal ${prossimo.toLocaleDateString('it-IT')}.`
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

        // PUNTO 32: se il file non ha gli orari, LA DATA LA DICE L'UTENTE.
        //
        // Nato da un caso vero (2026-07-27): un file dell'utente senza orari e' entrato con
        // la data del 10 luglio, mentre l'escursione era del 14 giugno. La data veniva
        // dall'intestazione del file (<metadata><time>), che in quel file - come in molti -
        // non e' il giorno della camminata ma IL MOMENTO IN CUI IL FILE E' STATO ESPORTATO.
        // Il sito non puo' saperlo: le due date sono indistinguibili guardando il file.
        // Quindi non si indovina. Si risponde 422 SENZA salvare niente, si propone la data
        // trovata e si aspetta che l'utente confermi o la corregga.
        // NON consuma un posto del tetto mensile, proprio perche' non salva niente.
        if (letto.durataIgnota && !req.body.dataUscita) {
            const { distanzaKm, dislivelloM } = statisticheTraccia(letto.punti, SOGLIA_DISLIVELLO_IMPORT_M, haversineKm);
            return res.status(422).json({
                richiedeData: true,
                dataProposta: letto.inizio ? letto.inizio.toISOString().split('T')[0] : null,
                nome: letto.nome || null,
                distanzaKm, dislivelloM,
                puntiLetti: letto.punti.length
            });
        }

        // La data scelta dall'utente vince su quella del file, MA SOLO quando il file non
        // aveva gia' i suoi orari veri: la richiesta 422 sopra la chiede solo per i file
        // senza orari, ma senza questo controllo un dataUscita mandato "a mano" (richiesta
        // costruita apposta, non raggiungibile dall'interfaccia oggi) sovrascriverebbe
        // inizio/fine anche su un file CON orari, azzerando la durata (startedAt===endedAt)
        // senza pero' impostare durationUnknown - una traccia con un movingTimeSec (punto
        // 92) misurato ma una durata totale pari a zero, due numeri che si contraddicono
        // sullo stesso documento. Trovato dall'agente architect progettando il punto 92.
        if (req.body.dataUscita && letto.durataIgnota) {
            const scelta = String(req.body.dataUscita).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(scelta)) {
                return res.status(400).json({ error: 'La data non e\' in un formato valido.' });
            }
            // Mezzogiorno e non mezzanotte: una data "YYYY-MM-DD" letta come mezzanotte UTC,
            // riletta in un fuso dietro Greenwich, mostrerebbe il giorno PRIMA. E' la stessa
            // trappola gia' scritta per le date dei timbri in public/js/badges.js.
            const d = new Date(`${scelta}T12:00:00Z`);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ error: 'La data non e\' valida.' });
            }
            if (d.getTime() > Date.now()) {
                return res.status(400).json({ error: 'La data e\' nel futuro: un\'escursione gia\' fatta non puo\' essere domani.' });
            }
            if (d.getFullYear() < 1990) {
                return res.status(400).json({ error: 'La data e\' troppo indietro nel tempo per essere una traccia GPS.' });
            }
            letto.inizio = d;
            letto.fine = d;
            // L'avviso sulla data mancante non ha piu' senso: la data ora c'e' ed e' sua.
            letto.avvisi = (letto.avvisi || []).filter(a => !/nessuna data/i.test(a));
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

        // Punto 92: il tempo di SOLO CAMMINO si calcola QUI, sui punti completi, PRIMA che
        // simplifyTrack li riduca (~8m, campionamento troppo rado per tempiTraccia dopo la
        // semplificazione - misurato su tutte e 7 le tracce vere di Denis: zero
        // osservazioni). Solo se il file ha gli orari: senza, non c'e' niente da separare.
        let movingTimeSec = null;
        if (!letto.durataIgnota) {
            const movimento = movimentoSecAttendibile(letto.punti, haversineKm);
            movingTimeSec = movimento.sec;
            if (movingTimeSec == null && movimento.motivi.length) {
                letto.avvisi = [...(letto.avvisi || []), ...movimento.motivi];
            }
        }

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
            durationUnknown: letto.durataIgnota ? true : undefined,
            // Punto 92: assente se non misurabile, mai zero (vedi models/ActiveHikeSession.js).
            ...(movingTimeSec ? { movingTimeSec } : {})
            // openSession NON impostato di proposito: una traccia importata e' gia' conclusa,
            // e l'indice unico parziale su openSession impedirebbe di caricarne una seconda
            // mentre una registrazione dal vivo e' in corso.
        });

        // Timbri conquistati da questa traccia: chi e' passato su una vetta ce l'ha
        // raggiunta, e il badge glielo si deve. Vedi assegnaTimbriDallaTraccia.
        // Si guardano i punti COMPLETI, non quelli semplificati: la semplificazione puo'
        // spostare la linea fino a 8 metri e su una vetta contano i metri.
        const timbri = await assegnaTimbriDallaTraccia(req.session.userId, letto.punti, inizio);

        // Punto 92: una traccia in piu' cambia le osservazioni disponibili per il passo
        // personale - stesso principio gia' in uso per un .gpx aggiunto a un Completion
        // (routes/completions.js). Mai bloccante: importare la traccia e' cio' che conta,
        // il passo e' un derivato che si puo' sempre ricalcolare in un secondo momento.
        //
        // SOLO SE movingTimeSec e' stato misurato, come in /:id/end e DELETE /sessions/:id -
        // senza questa guardia, importare un file SENZA orari (nessuna osservazione aggiunta)
        // ricalcolerebbe comunque da zero e cancellerebbe il passo di un account che l'aveva
        // assegnato a mano senza prove dietro (i quattro account demo del seed), come effetto
        // collaterale di un'importazione che non ha cambiato nulla di rilevante. Trovato dal
        // test-engineer verificando il punto 92, prima di qualunque uso in produzione.
        let utenteAggiornato = null;
        if (movingTimeSec) {
            try {
                const utente = await User.findById(req.session.userId);
                if (utente) {
                    await recalculateAndApplyPace(utente);
                    utenteAggiornato = utente;
                }
            } catch (e) {
                console.error('Errore ricalcolo passo personale dopo import gpx:', e);
            }
        }

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
            massimoAlMese: tetto,
            // Cosi' la Dashboard puo' aggiornare subito il passo mostrato senza dover
            // ricaricare la pagina - stesso motivo per cui le rotte di completions.js
            // rimandano "user" nella risposta.
            ...(utenteAggiornato ? { user: utenteAggiornato } : {})
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
            offTrailBuffer: 1,
            elevationRefM: 1   // la memoria della regola del dislivello, vedi sotto
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
        for (const p of newPoints) {
            if (lastPoint) addedDistanceKm += haversineKm(lastPoint[1], lastPoint[0], p[1], p[0]);
            lastPoint = p;
        }

        // IL DISLIVELLO, con la STESSA regola dei file .gpx importati (vedi
        // statisticheTraccia in lib/gpx.js): si conta quanto si e' saliti in tutto sopra
        // l'ultimo avvallamento, non il salto fra due punti consecutivi.
        //
        // PRIMA DI QUESTO si sommava ogni salto sopra i 3 metri, e su un GPS da telefono -
        // che sulla quota sbaglia molto piu' di 3 metri - quel tremolio diventava salita
        // vera. Misurato sui dati veri dell'utente: una camminata di 137 metri in piano,
        // con la quota fra 112 e 120 m e il GPS che dichiarava +-12/+-20 m di precisione,
        // risultava con 21 METRI DI DISLIVELLO. Con questa regola da' zero, che e' la
        // risposta giusta.
        //
        // SEMBRAVA IMPOSSIBILE FARLO QUI, ed e' il motivo per cui le due regole erano
        // diverse: dal vivo i punti arrivano a gruppi e il totale si aggiorna man mano,
        // quindi non si puo' guardare tutta la traccia insieme. Ma alla regola non serve
        // tutta la traccia: le bastano il totale e la quota piu' bassa vista da quando si
        // sta salendo. Tenendo quel secondo numero sulla sessione (elevationRefM), il conto
        // fatto gruppo per gruppo e' IDENTICO a quello fatto in una passata sola.
        let addedElevationM = 0;
        let riferimento = isFiniteNum(session.elevationRefM) ? session.elevationRefM : null;
        for (const p of newPoints) {
            const quota = p[2];
            if (riferimento === null) { riferimento = quota; continue; }   // primo punto: da' il via, non conta
            if (quota > riferimento + SOGLIA_DISLIVELLO_M) {
                addedElevationM += quota - riferimento;
                riferimento = quota;
            } else if (quota < riferimento) {
                riferimento = quota;
            }
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
                // elevationRefM va salvato INSIEME al totale, nella stessa scrittura: se si
                // salvasse il totale e non il riferimento, il gruppo successivo ripartirebbe
                // da capo e conterebbe due volte la stessa salita.
                $set: {
                    lastPointAt: new Date(), status: 'active', offTrailBuffer: newBuffer,
                    ...(riferimento !== null ? { elevationRefM: riferimento } : {})
                }
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

            // Punto 92: il tempo di SOLO CAMMINO si calcola QUI, su session.points COMPLETI,
            // PRIMA che simplifyTrack li riduca - stessa ragione del gemello in /import-gpx.
            const movimentoFineTracciamento = movimentoSecAttendibile(session.points, haversineKm);
            const movingTimeSec = movimentoFineTracciamento.sec;

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
                        points: simplifiedPoints,
                        // Punto 92: assente se non misurabile, mai zero.
                        ...(movingTimeSec ? { movingTimeSec } : {})
                    },
                    $unset: { openSession: 1, offTrailBuffer: 1 }
                },
                { new: true }
            );

            // Punto 92: una traccia in piu' cambia le osservazioni disponibili per il passo
            // personale - solo se questa ne ha aggiunta una davvero (movingTimeSec), per non
            // fare una query e un salvataggio di utente inutili ad ogni fine tracciamento.
            if (movingTimeSec) {
                try {
                    const utente = await User.findById(session.userId);
                    if (utente) await recalculateAndApplyPace(utente);
                } catch (e) {
                    console.error('Errore ricalcolo passo personale a fine tracciamento:', e);
                }
            }
        }

        res.json(result);
    } catch (e) {
        console.error('Errore chiusura tracciamento GPS:', e);
        res.status(400).json({ error: 'Impossibile terminare il tracciamento' });
    }
});

module.exports = router;
