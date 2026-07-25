const express = require('express');
const router = express.Router();
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Hike = require('../models/Hike');
const { requireAuth } = require('../middleware/auth');

const MAX_POINTS_PER_BATCH = 500; // un client onesto ne manda ~60-180 ogni 20-30s, mai a uno a uno
const MIN_ELEVATION_DELTA_M = 3; // sotto questa soglia il "dislivello" e' rumore del GPS, non salita reale
const SIMPLIFY_TOLERANCE_M = 8; // stessa scala dell'errore medio OSM (~10m) citato in tutto il progetto

function isFiniteNum(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

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

// Haversine in km (stessa formula di calculateDistance in public/js/map.js, qui in km non metri)
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distanza perpendicolare punto-segmento in metri, con una proiezione piana approssimata
// (equirettangolare): a scala di una singola escursione l'approssimazione e' ampiamente
// sufficiente per decidere quali punti scartare, e molto piu' leggera di un calcolo sferico esatto.
function perpendicularDistanceMeters(pt, a, b, mLat, mLng) {
    const x0 = pt[0] * mLng, y0 = pt[1] * mLat;
    const x1 = a[0] * mLng, y1 = a[1] * mLat;
    const x2 = b[0] * mLng, y2 = b[1] * mLat;
    const dx = x2 - x1, dy = y2 - y1;

    if (dx === 0 && dy === 0) return Math.hypot(x0 - x1, y0 - y1);

    const t = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x0 - (x1 + t * dx), y0 - (y1 + t * dy));
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

// Riduce il numero di punti salvati mantenendo la forma del percorso (Douglas-Peucker),
// usata SOLO quando una sessione si chiude (i totali distanza/dislivello sono gia' stati
// calcolati prima, sui dati completi: qui si riduce solo il dettaglio della traccia salvata).
function simplifyTrack(points, toleranceM = SIMPLIFY_TOLERANCE_M) {
    if (points.length <= 2) return points;

    const midLat = points[Math.floor(points.length / 2)][1];
    const mLat = 111320;
    const mLng = 111320 * Math.cos(midLat * Math.PI / 180);

    const keep = new Set([0, points.length - 1]);
    douglasPeucker(points, 0, points.length - 1, toleranceM, mLat, mLng, keep);

    return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

// Sessione di tracciamento attualmente aperta (active/paused) dell'utente loggato, se esiste.
// Usata sia per "riprendi dopo un ricaricamento" sia da /start per non crearne una seconda.
router.get('/active', requireAuth, async (req, res) => {
    const session = await ActiveHikeSession.findOne({ userId: req.session.userId, openSession: true });
    res.json(session || null);
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
        // Solo userId/status/ultimo punto: non serve leggere l'intera traccia (potenzialmente
        // lunga ore) solo per aggiungere un piccolo gruppo di punti nuovi.
        const session = await ActiveHikeSession.findById(req.params.id, {
            userId: 1,
            status: 1,
            points: { $slice: -1 }
        });

        if (!session || String(session.userId) !== req.session.userId) {
            return res.status(404).json({ error: 'Sessione di tracciamento non trovata' });
        }
        if (session.status === 'ended') {
            return res.status(409).json({ error: 'Questo tracciamento e\' gia\' terminato' });
        }

        let lastPoint = session.points.length > 0 ? session.points[0] : null;
        const newPoints = sanitizePoints(req.body.points, lastPoint ? lastPoint[2] : 0);
        if (newPoints.length === 0) {
            return res.status(400).json({ error: 'Nessun punto GPS valido ricevuto' });
        }

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
                $set: { lastPointAt: new Date(), status: 'active' }
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
            const simplifiedPoints = simplifyTrack(session.points);

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
                    $unset: { openSession: 1 }
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
