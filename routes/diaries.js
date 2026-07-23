const express = require('express');
const router = express.Router();
const Diary = require('../models/Diary');

// Ottieni diari
router.get('/', async (req, res) => {
    const diaries = await Diary.find();
    res.json(diaries);
});

// Crea nota diario
router.post('/', async (req, res) => {
    try {
        const diary = await Diary.create(req.body);
        res.json(diary);
    } catch (e) {
        console.error('Errore creazione nota diario:', e);
        res.status(400).json({ error: 'Impossibile creare la nota diario' });
    }
});

module.exports = router;
