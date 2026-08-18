const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Review = require('../models/Review');
const ReviewLock = require('../models/ReviewLock');
const User = require('../models/User');
const Hike = require('../models/Hike');
const Completion = require('../models/Completion');
const { requireAuth } = require('../middleware/auth');
const { calcolaLockHash } = require('../lib/reviewLock');

// Tetto alle coppie che si possono controllare in un colpo solo - stessa logica del
// MAX_PUNTI di routes/routing.js: non contro un utente vero (nessuno ha centinaia di
// escursioni condivise con la stessa persona), solo contro una richiesta costruita
// apposta per forzare una query $in enorme.
const MAX_COPPIE_VERIFICA = 1000;

// Quali delle proprie coppie escursione+persona candidate sono gia' state recensite -
// serve al menu del frontend per non riproporre un'opzione che il server rifiuterebbe
// comunque (punto 98/B). POST e non GET perche' con molte escursioni condivise (il caso
// che motiva la correzione) la query string di una GET sforerebbe. Calcola l'hash SEMPRE
// con reviewerId = req.session.userId (mai un valore mandato dal client, stessa regola
// di POST / qui sotto): risponde solo per se stesso, non rivela mai chi altro ha
// recensito chi - rispetta l'anonimato di Review.js. Sola lettura, non scrive nulla.
router.post('/gia-recensite', requireAuth, async (req, res) => {
    try {
        const { coppie } = req.body;
        if (!Array.isArray(coppie) || coppie.length === 0) {
            return res.json({ gia: [] });
        }
        if (coppie.length > MAX_COPPIE_VERIFICA) {
            return res.status(400).json({ error: 'Troppe coppie da verificare in una volta sola' });
        }

        const reviewerId = req.session.userId;
        // Coppie malformate scartate in silenzio (non 400 per una voce sporca sola):
        // il menu deve continuare a funzionare per le altre.
        const valide = coppie.filter(c =>
            c && mongoose.Types.ObjectId.isValid(c.hikeId) && mongoose.Types.ObjectId.isValid(c.targetUserId)
        );
        if (valide.length === 0) {
            return res.json({ gia: [] });
        }

        const hashes = valide.map(c => calcolaLockHash(reviewerId, c.targetUserId, c.hikeId));
        const trovati = await ReviewLock.find({ lockHash: { $in: hashes } }).select('lockHash -_id').lean();
        const trovatiSet = new Set(trovati.map(l => l.lockHash));

        // Stesso formato di chiave gia' usato da option.value in social.js
        // ("hikeId::targetUserId"): il frontend filtra con un Set.has(), senza bisogno
        // di un secondo formato.
        const gia = valide
            .filter((c, i) => trovatiSet.has(hashes[i]))
            .map(c => `${c.hikeId}::${c.targetUserId}`);
        res.json({ gia });
    } catch (e) {
        console.error('Errore verifica recensioni già fatte:', e);
        res.status(400).json({ error: 'Impossibile verificare le recensioni già fatte' });
    }
});

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
        const { targetUserId, punctuality, equipment, respect, hikeId } = req.body;
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
        const lockHash = calcolaLockHash(reviewerId, targetUserId, hikeId);
        try {
            await ReviewLock.create({ lockHash });
        } catch (lockErr) {
            if (lockErr.code === 11000) {
                return res.status(409).json({ error: 'Hai già recensito questa persona per questa escursione.' });
            }
            throw lockErr;
        }

        try {
            await Review.create({
                targetUserId,
                punctuality: Number(punctuality),
                equipment: Number(equipment),
                respect: Number(respect)
            });
        } catch (reviewErr) {
            // Il lock e' gia' scritto: se la recensione fallisce (validazione, rete verso
            // Atlas) senza disfare il lock la coppia risulterebbe "gia' recensita" per
            // sempre nel menu, pur non esistendo nessuna recensione vera. Si toglie il
            // lock appena creato per lasciare la coppia riprovabile.
            await ReviewLock.deleteOne({ lockHash });
            throw reviewErr;
        }

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
