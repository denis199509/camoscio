const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const { requireAuth } = require('../middleware/auth');

// Ottieni report di crowdsourcing (Waze)
router.get('/', requireAuth, async (req, res) => {
    const reports = await Report.find();
    res.json(reports);
});

// Crea report di crowdsourcing (Waze) - chi segnala e' sempre chi ha fatto login
router.post('/', requireAuth, async (req, res) => {
    try {
        const report = await Report.create({ ...req.body, status: 'active', reporterId: req.session.userId });
        res.json(report);
    } catch (e) {
        console.error('Errore creazione segnalazione:', e);
        res.status(400).json({ error: 'Impossibile creare la segnalazione' });
    }
});

module.exports = router;
