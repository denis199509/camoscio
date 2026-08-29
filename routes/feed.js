const express = require('express');
const router = express.Router();
const Follow = require('../models/Follow');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const { requireAuth } = require('../middleware/auth');

// Punto 113 - Il feed: le uscite pubblicate dalle persone che l'utente segue, più recenti
// prima. Solo-follower per costruzione (si vede solo chi si segue). Le tue uscite NON
// compaiono nel tuo feed - le rivedi in "Le mie escursioni".
//
// Paginazione A CURSORE su publishedAt (?before=<ISO>), non skip: skip rallenta con l'offset
// e può mostrare doppioni quando arrivano pubblicazioni nuove fra una pagina e l'altra.
//
// I PUNTI GPS DELLA TRACCIA NON ESCONO DA QUI: sono il campo più pesante del database, e in
// un elenco non servono. Chi apre la singola uscita li chiede per quella sola (passo 6).

const PAGINA = 15;

router.get('/', requireAuth, async (req, res) => {
    try {
        // Indice { followerId, followingId }: prefisso su followerId.
        const seguiti = await Follow.find({ followerId: req.session.userId }).select('followingId').lean();
        if (!seguiti.length) return res.json({ items: [], nextBefore: null });

        const q = {
            userId: { $in: seguiti.map(f => f.followingId) },
            publishedAt: { $exists: true }
        };
        if (req.query.before) {
            const d = new Date(req.query.before);
            if (!isNaN(d.getTime())) q.publishedAt = { $exists: true, $lt: d };
        }

        // limit PAGINA+1: se torna un elemento in più, c'è un'altra pagina.
        // NIENTE .lean(): durationSeconds/avgSpeedKmh sono virtuali dello schema, servono
        // alle card (le stesse di "Le mie escursioni" e del profilo).
        // .select('-points -offTrailBuffer'): è la riga che tiene la RAM al sicuro.
        const trovate = await ActiveHikeSession.find(q)
            .select('-points -offTrailBuffer')
            .sort({ publishedAt: -1 })
            .limit(PAGINA + 1);

        const cePiu = trovate.length > PAGINA;
        const items = cePiu ? trovate.slice(0, PAGINA) : trovate;
        const nextBefore = cePiu ? items[items.length - 1].publishedAt.toISOString() : null;

        res.json({ items, nextBefore });
    } catch (e) {
        console.error('Errore feed:', e);
        res.status(500).json({ error: 'Impossibile caricare il feed.' });
    }
});

module.exports = router;
