const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Review = require('../models/Review');
const ReviewLock = require('../models/ReviewLock');
const User = require('../models/User');

// Ottieni recensioni aggregate per un utente
router.get('/:userId', async (req, res) => {
    try {
        const userReviews = await Review.find({ targetUserId: req.params.userId });
        res.json(userReviews);
    } catch (e) {
        res.json([]);
    }
});

// Inserisci recensione (Rigorosamente anonima!)
router.post('/', async (req, res) => {
    try {
        const { targetUserId, punctuality, equipment, respect, comment, reviewerId, hikeId } = req.body;

        // Anti-spam: un hash one-way (mai reviewerId in chiaro) impedisce a chi ha già recensito
        // questa persona per questa escursione di rifarlo. L'indice unico su ReviewLock (non solo
        // un controllo prima di scrivere) impedisce la doppia recensione anche in caso di due
        // richieste arrivate nello stesso istante. Se reviewerId/hikeId non vengono forniti
        // (client più vecchio) la recensione procede comunque, senza protezione anti-duplicati.
        if (reviewerId && hikeId) {
            const lockHash = crypto.createHash('sha256').update(`${reviewerId}|${targetUserId}|${hikeId}`).digest('hex');
            try {
                await ReviewLock.create({ lockHash });
            } catch (lockErr) {
                if (lockErr.code === 11000) {
                    return res.status(409).json({ error: 'Hai già recensito questa persona per questa escursione.' });
                }
                throw lockErr;
            }
        }

        await Review.create({
            targetUserId,
            punctuality: Number(punctuality),
            equipment: Number(equipment),
            respect: Number(respect),
            comment: comment || ''
        });

        // Aggiorna reputazione dell'utente recensito in base al feedback e all'esperienza
        const user = await User.findById(targetUserId);
        if (user) {
            const allTargetReviews = await Review.find({ targetUserId });
            const avgScore = allTargetReviews.reduce((sum, r) => sum + (r.punctuality + r.equipment + r.respect) / 3, 0) / allTargetReviews.length;
            user.reputation = Math.min(100, Math.max(10, Math.round((avgScore / 5) * 80 + (user.completedHikes * 1.5))));
            await user.save();
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Errore creazione recensione:', e);
        res.status(400).json({ error: 'Impossibile creare la recensione' });
    }
});

module.exports = router;
