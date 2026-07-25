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

// Segna una segnalazione come risolta (es. ghiaccio sciolto, frana rimossa) - qualunque utente
// loggato puo' confermarlo, stesso spirito crowdsourcing di Waze gia' usato per crearle. Aggiorna
// il documento esistente invece di crearne uno nuovo (vedi bug noto in leggimi.txt: la vecchia
// resolveReportDirectly() in map.js POSTava di nuovo su questa rotta, creando un duplicato invece
// di risolvere l'originale, che restava per sempre "attivo").
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const report = await Report.findByIdAndUpdate(req.params.id, { status: 'resolved' }, { new: true });
        if (!report) {
            return res.status(404).json({ error: 'Segnalazione non trovata' });
        }
        res.json(report);
    } catch (e) {
        res.status(400).json({ error: 'Impossibile aggiornare la segnalazione' });
    }
});

module.exports = router;
