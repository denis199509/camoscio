const express = require('express');
const router = express.Router();
const Squad = require('../models/Squad');

// Ottieni squadre ricorrenti
router.get('/', async (req, res) => {
    const squads = await Squad.find();
    res.json(squads);
});

// Crea squadra
router.post('/', async (req, res) => {
    try {
        const squad = await Squad.create(req.body);
        res.json(squad);
    } catch (e) {
        console.error('Errore creazione squadra:', e);
        res.status(400).json({ error: 'Impossibile creare la squadra' });
    }
});

module.exports = router;
