const express = require('express');
const router = express.Router();
const RouteBookmark = require('../models/RouteBookmark');
const { requireAuth } = require('../middleware/auth');

// Ottieni preferiti / rotte desiderate
router.get('/', requireAuth, async (req, res) => {
    const bookmarks = await RouteBookmark.find();
    res.json(bookmarks);
});

// Aggiungi preferito sentiero - sempre per l'utente che ha fatto login
router.post('/', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { hikeId } = req.body;
    try {
        const exists = await RouteBookmark.findOne({ userId, hikeId });
        if (!exists) {
            await RouteBookmark.create({ userId, hikeId });
        }
        res.json({ success: true });
    } catch (e) {
        if (e.code === 11000) {
            return res.json({ success: true }); // gia' creato nel frattempo da un'altra richiesta
        }
        console.error('Errore creazione preferito:', e);
        res.status(400).json({ error: 'Impossibile salvare il preferito' });
    }
});

// Rimuovi preferito sentiero - punto 80/G. Sempre per l'utente che ha fatto login: il
// confronto e' con req.session.userId, mai con un id mandato dal client (stessa regola di
// tutte le altre rotte DELETE del progetto, vedi routes/tracking.js). Idempotente come il
// POST: cancellare un preferito gia' non presente non e' un errore.
router.delete('/:hikeId', requireAuth, async (req, res) => {
    try {
        await RouteBookmark.deleteOne({ userId: req.session.userId, hikeId: req.params.hikeId });
        res.json({ success: true });
    } catch (e) {
        console.error('Errore rimozione preferito:', e);
        res.status(400).json({ error: 'Impossibile rimuovere il preferito' });
    }
});

module.exports = router;
