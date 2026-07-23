const express = require('express');
const router = express.Router();
const Report = require('../models/Report');

// Ottieni report di crowdsourcing (Waze)
router.get('/', async (req, res) => {
    const reports = await Report.find();
    res.json(reports);
});

// Crea report di crowdsourcing (Waze)
router.post('/', async (req, res) => {
    try {
        const report = await Report.create({ status: 'active', ...req.body });
        res.json(report);
    } catch (e) {
        console.error('Errore creazione segnalazione:', e);
        res.status(400).json({ error: 'Impossibile creare la segnalazione' });
    }
});

module.exports = router;
