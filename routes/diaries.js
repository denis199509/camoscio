const express = require('express');
const router = express.Router();
const Diary = require('../models/Diary');
const { requireAuth } = require('../middleware/auth');

// Ottieni diari
router.get('/', requireAuth, async (req, res) => {
    const diaries = await Diary.find();
    res.json(diaries);
});

// Crea nota diario - l'autore e' sempre chi ha fatto login, non un valore mandato dal client
router.post('/', requireAuth, async (req, res) => {
    try {
        const diary = await Diary.create({ ...req.body, userId: req.session.userId });
        res.json(diary);
    } catch (e) {
        console.error('Errore creazione nota diario:', e);
        res.status(400).json({ error: 'Impossibile creare la nota diario' });
    }
});

module.exports = router;
