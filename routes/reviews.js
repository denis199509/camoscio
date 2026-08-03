const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Review = require('../models/Review');
const ReviewLock = require('../models/ReviewLock');
const User = require('../models/User');
const Hike = require('../models/Hike');
const Completion = require('../models/Completion');
const { requireAuth } = require('../middleware/auth');

// Ottieni recensioni aggregate per un utente
router.get('/:userId', requireAuth, async (req, res) => {
    try {
        const userReviews = await Review.find({ targetUserId: req.params.userId });
        res.json(userReviews);
    } catch (e) {
        res.json([]);
    }
});

// Inserisci recensione (Rigorosamente anonima verso l'ESTERNO: il DB sa chi recensisce,
// solo per il blocco anti-duplicati, ma quel dato non esce mai in nessuna risposta API)
router.post('/', requireAuth, async (req, res) => {
    try {
        const { targetUserId, punctuality, equipment, respect, comment, hikeId } = req.body;
        const reviewerId = req.session.userId;

        // hikeId ora obbligatorio (bug trovato in Fase H): prima bastava ometterlo per aggirare
        // del tutto il blocco anti-spam sotto e recensire la stessa persona un numero illimitato
        // di volte, falsandone la reputazione. Verifica anche che le due persone abbiano
        // DAVVERO condiviso quell'escursione (mai fidarsi solo dell'accoppiata di ID mandata dal
        // client) e che non ci si stia autorecensendo.
        if (!targetUserId || !hikeId) {
            return res.status(400).json({ error: "Manca il destinatario o l'escursione condivisa" });
        }
        if (String(targetUserId) === String(reviewerId)) {
            return res.status(400).json({ error: 'Non puoi recensire te stesso' });
        }
        const sharedHike = await Hike.findOne({
            _id: hikeId,
            participants: { $all: [reviewerId, targetUserId] }
        });
        if (!sharedHike) {
            return res.status(403).json({ error: 'Puoi recensire solo chi ha condiviso con te questa escursione' });
        }

        // Essere entrambi iscritti non basta (bug segnalato da Denis 03/08/2026): l'iscrizione
        // esiste anche prima che l'escursione si sia svolta. Il segnale che e' finita davvero e'
        // lo stesso gia' usato per lo storico, un Completion per utente (POST /:id/complete):
        // richiederne uno per ciascuna delle due persone equivale a "l'abbiamo fatta insieme".
        const [reviewerCompletion, targetCompletion] = await Promise.all([
            Completion.findOne({ hikeId, userId: reviewerId }),
            Completion.findOne({ hikeId, userId: targetUserId })
        ]);
        if (!reviewerCompletion || !targetCompletion) {
            return res.status(403).json({ error: "Potrete recensirvi solo dopo aver segnato entrambi l'escursione come completata" });
        }

        // Anti-spam: un hash one-way (mai reviewerId in chiaro) impedisce a chi ha già recensito
        // questa persona per questa escursione di rifarlo. L'indice unico su ReviewLock (non solo
        // un controllo prima di scrivere) impedisce la doppia recensione anche in caso di due
        // richieste arrivate nello stesso istante.
        const lockHash = crypto.createHash('sha256').update(`${reviewerId}|${targetUserId}|${hikeId}`).digest('hex');
        try {
            await ReviewLock.create({ lockHash });
        } catch (lockErr) {
            if (lockErr.code === 11000) {
                return res.status(409).json({ error: 'Hai già recensito questa persona per questa escursione.' });
            }
            throw lockErr;
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
