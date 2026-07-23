const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');

// Ottieni le notifiche di un utente (più recenti prima)
router.get('/:userId', async (req, res) => {
    try {
        const userNotifications = await Notification.find({ userId: req.params.userId }).sort({ createdAt: -1 });
        res.json(userNotifications);
    } catch (e) {
        res.json([]);
    }
});

// Crea una notifica (usato lato client per gli esiti di approvazione/rifiuto iscrizione)
router.post('/', async (req, res) => {
    try {
        const notification = await Notification.create({ read: false, ...req.body });
        res.json(notification);
    } catch (e) {
        console.error('Errore creazione notifica:', e);
        res.status(400).json({ error: 'Impossibile creare la notifica' });
    }
});

// Segna una notifica come letta
router.put('/:id/read', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
        if (!notification) {
            return res.status(404).json({ error: 'Notifica non trovata' });
        }
        res.json(notification);
    } catch (e) {
        res.status(404).json({ error: 'Notifica non trovata' });
    }
});

module.exports = router;
