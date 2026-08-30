const express = require('express');
const router = express.Router();
const Follow = require('../models/Follow');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Like = require('../models/Like'); // punto 113: "mi piace" per card, in batch
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

        // Punto 113: i "mi piace" in DUE query per l'intera pagina, mai una per card - il
        // totale per uscita (aggregate raggruppato) e quali ha messo l'utente corrente (una
        // find sui soli id di pagina). A feed vuoto si salta tutto.
        const ids = items.map(s => s._id);
        let mappaConteggi = new Map();
        let mieiSet = new Set();
        if (ids.length) {
            const [conteggi, miei] = await Promise.all([
                Like.aggregate([
                    { $match: { sessionId: { $in: ids } } },
                    { $group: { _id: '$sessionId', n: { $sum: 1 } } }
                ]),
                Like.find({ sessionId: { $in: ids }, userId: req.session.userId }).select('sessionId').lean()
            ]);
            mappaConteggi = new Map(conteggi.map(c => [String(c._id), c.n]));
            mieiSet = new Set(miei.map(m => String(m.sessionId)));
        }
        const itemsJson = items.map(s => {
            const o = s.toJSON();
            o.likeCount = mappaConteggi.get(String(s._id)) || 0;
            o.likedByMe = mieiSet.has(String(s._id));
            return o;
        });

        res.json({ items: itemsJson, nextBefore });
    } catch (e) {
        console.error('Errore feed:', e);
        res.status(500).json({ error: 'Impossibile caricare il feed.' });
    }
});

module.exports = router;
