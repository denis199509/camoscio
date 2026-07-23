const express = require('express');
const router = express.Router();
const Stamp = require('../models/Stamp');

// Ottieni timbri di un utente
router.get('/:userId', async (req, res) => {
    try {
        const userStamps = await Stamp.find({ userId: req.params.userId });
        res.json(userStamps);
    } catch (e) {
        res.json([]);
    }
});

// Aggiungi timbro (sbloccato con geofencing)
router.post('/', async (req, res) => {
    const { userId, stampId } = req.body;
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
