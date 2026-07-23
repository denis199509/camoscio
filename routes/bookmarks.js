const express = require('express');
const router = express.Router();
const RouteBookmark = require('../models/RouteBookmark');

// Ottieni preferiti / rotte desiderate
router.get('/', async (req, res) => {
    const bookmarks = await RouteBookmark.find();
    res.json(bookmarks);
});

// Aggiungi preferito sentiero
router.post('/', async (req, res) => {
    const { userId, hikeId } = req.body;
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

module.exports = router;
