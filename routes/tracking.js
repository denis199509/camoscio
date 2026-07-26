const express = require('express');
const router = express.Router();
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Hike = require('../models/Hike');
const TrailCandidate = require('../models/TrailCandidate');
const { requireAuth } = require('../middleware/auth');
const { isFiniteNum, haversineKm, simplifyTrack } = require('../lib/geometry');
const trailIndex = require('../lib/trailIndex');

const MAX_POINTS_PER_BATCH = 500; // un client onesto ne manda ~60-180 ogni 20-30s, mai a uno a uno
const MIN_ELEVATION_DELTA_M = 3; // sotto questa soglia il "dislivello" e' rumore del GPS, non salita reale
const SIMPLIFY_TOLERANCE_M = 8; // stessa scala dell'errore medio OSM (~10m) citato in tutto il progetto
const MIN_CANDIDATE_POINTS = 5; // sotto questa lunghezza un tratto "fuori sentiero" e' solo rumore GPS, non un percorso da segnalare

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

        let distanzaKm = 0, dislivelloM = 0, secondi = 0;
        for (const s of sessioni) {
            distanzaKm += s.distanceKm || 0;
            dislivelloM += s.elevationGainM || 0;
            secondi += s.durationSeconds || 0;
        }

        // Velocita' media sui TOTALI, non media delle medie: una registrazione di 10 minuti
        // e una di 6 ore non possono pesare uguale. (Media delle medie = errore classico.)
        const ore = secondi / 3600;
        const velocitaMediaKmh = ore > 0 ? Math.round((distanzaKm / ore) * 10) / 10 : 0;

        res.json({
            sessioni: sessioni.length,
            distanzaKm: Math.round(distanzaKm * 10) / 10,
            dislivelloM: Math.round(dislivelloM),
            secondi: Math.round(secondi),
            velocitaMediaKmh
        });
    } catch (e) {
        console.error('Errore nel calcolo dei totali di tracciamento:', e);
        res.status(500).json({ error: 'Impossibile calcolare i totali' });
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
