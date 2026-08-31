const express = require('express');
const router = express.Router();
const Stamp = require('../models/Stamp');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const { requireAuth } = require('../middleware/auth');
// Stessa soglia e stesso catalogo dell'import .gpx e del conteggio salite (punto 108).
const { puntiTimbrabili, tracciaToccaPunto } = require('../lib/geofenceTimbri');

// Ottieni timbri di un utente (achievement pubblici tra utenti loggati)
router.get('/:userId', requireAuth, async (req, res) => {
    try {
        const userStamps = await Stamp.find({ userId: req.params.userId });
        res.json(userStamps);
    } catch (e) {
        res.json([]);
    }
});

// Aggiungi timbro - sempre per l'utente che ha fatto login.
//
// PUNTO 108: prima bastava un POST con lo stampId e il timbro veniva creato senza nessun
// controllo di posizione (il geofencing dei 150 m viveva solo nel browser, in
// checkGeofencing). Col tasto "teletrasporta GPS" sulla mappa - o con un fetch dalla
// console - si sbloccavano tutti i badge da fermi. Ora il timbro si crea SOLO se una
// traccia reale dell'utente (registrazione in corso, registrazione conclusa o file .gpx
// importato) e' passata entro SOGLIA_TIMBRO_M dalla vetta: la stessa regola gia' usata
// per i badge assegnati da un .gpx importato (lib/geofenceTimbri.js).
router.post('/', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { stampId } = req.body;

    if (!stampId || typeof stampId !== 'string') {
        return res.status(400).json({ error: 'Timbro non valido.' });
    }

    try {
        // Gia' conquistato: rispondi come prima, senza rifare la verifica.
        const alreadyExists = await Stamp.findOne({ userId, stampId }).lean();
        if (alreadyExists) return res.json({ success: true });

        // Il punto deve esistere nel catalogo (fisso + vette delle escursioni). Chiude
        // anche il caso "crea un timbro con uno stampId qualsiasi".
        const punto = (await puntiTimbrabili()).find(p => p.stampId === stampId);
        if (!punto) {
            return res.status(400).json({ error: 'Questo timbro non esiste nel catalogo delle vette.' });
        }

        // Tutte le sessioni dell'utente: quella aperta (i punti si accumulano mentre
        // cammina) e quelle concluse (registrazioni finite + .gpx importati).
        const sessioni = await ActiveHikeSession.find({ userId }).select('points').lean();
        const raggiunta = sessioni.some(s => tracciaToccaPunto(s.points, punto));
        if (!raggiunta) {
            return res.status(403).json({
                error: 'Il timbro si sblocca solo con una traccia reale che passa dalla vetta: cammina fin qui con una registrazione attiva, oppure importa il file .gpx della salita.'
            });
        }

        await Stamp.create({ userId, stampId, dateUnlocked: new Date().toISOString().split('T')[0] });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 11000) {
            return res.json({ success: true }); // gia' creato nel frattempo da un'altra richiesta
        }
        console.error('Errore creazione timbro:', e);
        res.status(400).json({ error: 'Impossibile registrare il timbro' });
    }
});

module.exports = router;
