const express = require('express');
const router = express.Router();
const Squad = require('../models/Squad');
const { requireAuth } = require('../middleware/auth');

// Ottieni squadre ricorrenti
router.get('/', requireAuth, async (req, res) => {
    const squads = await Squad.find();
    res.json(squads);
});

// Crea squadra - il creatore e' sempre chi ha fatto login
router.post('/', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.create({ ...req.body, creatorId: req.session.userId });
        res.json(squad);
    } catch (e) {
        console.error('Errore creazione squadra:', e);
        res.status(400).json({ error: 'Impossibile creare la squadra' });
    }
});

module.exports = router;
