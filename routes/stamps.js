const express = require('express');
const router = express.Router();
const Stamp = require('../models/Stamp');
const { requireAuth } = require('../middleware/auth');

// Ottieni timbri di un utente (achievement pubblici tra utenti loggati)
router.get('/:userId', requireAuth, async (req, res) => {
    try {
        const userStamps = await Stamp.find({ userId: req.params.userId });
        res.json(userStamps);
    } catch (e) {
        res.json([]);
    }
});

// Aggiungi timbro (sbloccato con geofencing) - sempre per l'utente che ha fatto login
router.post('/', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { stampId } = req.body;
    try {
        const alreadyExists = await Stamp.findOne({ userId, stampId });
        if (!alreadyExists) {
            await Stamp.create({ userId, stampId, dateUnlocked: new Date().toISOString().split('T')[0] });
        }
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
