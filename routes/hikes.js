const express = require('express');
const router = express.Router();
const Hike = require('../models/Hike');
const User = require('../models/User');
const Squad = require('../models/Squad');
const Notification = require('../models/Notification');
const Completion = require('../models/Completion');

// Ottieni escursioni
router.get('/', async (req, res) => {
    const hikes = await Hike.find();
    res.json(hikes);
});

// Crea escursione
router.post('/', async (req, res) => {
    try {
        const hike = await Hike.create({
            participants: [req.body.creatorId],
            pendingApproval: [],
            backpackTemplate: [],
            peaks: [],
            carpool: { fuelPrice: 1.85, fuelConsumption: 7.0, tollCost: 0, drivers: [] },
            ...req.body
        });

        // Notifica automatica ai membri delle squadre ricorrenti del creatore (funzionalità 17b)
        const creatorSquads = await Squad.find({ creatorId: hike.creatorId });
        for (const squad of creatorSquads) {
            for (const memberId of squad.members) {
                if (memberId.equals(hike.creatorId)) continue;
                await Notification.create({
                    userId: memberId,
                    text: `La tua squadra "${squad.name}" ha una nuova escursione: "${hike.title}"`,
                    read: false
                });
            }
        }

        res.json(hike);
    } catch (e) {
        console.error('Errore creazione escursione:', e);
        res.status(400).json({ error: "Impossibile creare l'escursione" });
    }
});

// Aggiorna escursione (es. partecipanti, lista zaino, carpooling)
router.put('/:id', async (req, res) => {
    try {
        const hike = await Hike.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (hike) {
            res.json(hike);
        } else {
            res.status(404).json({ error: 'Escursione non trovata' });
        }
    } catch (e) {
        res.status(404).json({ error: 'Escursione non trovata' });
    }
});

// Segna un'escursione come completata: aggiorna cronologia, passo personale e livello esperienza
router.post('/:id/complete', async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }

        const { userId, actualTimeHours } = req.body;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        if (!hike.participants.some(p => p.equals(user._id))) {
            return res.status(403).json({ error: "Solo i partecipanti dell'escursione possono segnarla come completata" });
        }

        const alreadyCompleted = await Completion.findOne({ userId: user._id, hikeId: hike._id });
        if (alreadyCompleted) {
            return res.status(409).json({ error: 'Escursione già segnata come completata', user });
        }

        await Completion.create({
            userId: user._id,
            hikeId: hike._id,
            dateCompleted: new Date(),
            actualTimeHours: actualTimeHours ? Number(actualTimeHours) : null
        });

        // Aggiorna il passo personale (media incrementale) solo se è stato dichiarato un tempo reale
        if (actualTimeHours && Number(actualTimeHours) > 0) {
            const priorSamples = user.completedHikes || 0;
            const observedPaceUp = hike.elevationGain / Number(actualTimeHours);

            const newPaceUp = ((user.averagePaceUp * priorSamples) + observedPaceUp) / (priorSamples + 1);
            const paceRatio = newPaceUp / user.averagePaceUp;

            user.averagePaceUp = Math.round(newPaceUp);
            user.averagePaceDown = Math.round(user.averagePaceDown * paceRatio);
        }

        user.completedHikes = (user.completedHikes || 0) + 1;

        // Ricalcola il livello di esperienza dalla cronologia reale, mai autodichiarato
        if (user.completedHikes >= 10 || user.averagePaceUp >= 500) {
            user.experienceLevel = 'Esperto';
        } else if (user.completedHikes >= 4 || user.averagePaceUp >= 350) {
            user.experienceLevel = 'Intermedio';
        } else {
            user.experienceLevel = 'Principiante';
        }

        await user.save();
        res.json(user);
    } catch (e) {
        console.error('Errore completamento escursione:', e);
        res.status(400).json({ error: 'Impossibile completare la richiesta' });
    }
});

module.exports = router;
