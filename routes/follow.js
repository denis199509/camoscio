const express = require('express');
const router = express.Router();
const { mongoose } = require('../db/mongo');
const Follow = require('../models/Follow');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { eliminato } = require('../lib/accountDeletion');

// Punto 113 - "Segui" una persona. Unidirezionale e senza conferma (decisione di Denis del
// 29/08/2026): seguire non chiede il permesso a nessuno, come su Instagram/Twitter.
// L'identita' di chi segue e' SEMPRE req.session.userId, mai un id mandato dal client - la
// regola di ogni rotta del progetto (vedi routes/bookmarks.js, routes/tracking.js).
//
// Le liste "chi seguo"/"chi mi segue" sono pubbliche fra utenti loggati: e' la decisione 7
// di Denis (contatore "N seguaci - N seguiti" cliccabile sul profilo di chiunque). Stesso
// trattamento di GET /api/stamps/:userId ("achievement pubblici tra utenti loggati"): solo
// requireAuth, nessun controllo di proprieta' sulle rotte di sola lettura qui sotto.

// --- SEGUI / SMETTI DI SEGUIRE ---

// Segui un utente: followingId sta nell'URL, followerId e' chi ha fatto login.
router.post('/:userId', requireAuth, async (req, res) => {
    const followerId = req.session.userId;
    const followingId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(followingId)) {
        return res.status(400).json({ error: 'Identificativo non valido.' });
    }
    // Non ci si segue da soli: non aggiungerebbe niente e sporcherebbe i conteggi del profilo.
    if (String(followingId) === String(followerId)) {
        return res.status(400).json({ error: 'Non puoi seguire te stesso.' });
    }

    try {
        // Che l'utente da seguire esista davvero: senza, un id a caso creerebbe un follow
        // verso il nulla che poi conterebbe nei "seguiti". Un account eliminato (punto
        // A-3.4) conta come inesistente: seguirlo aprirebbe la via alle sue (ex) tracce
        // via GET /api/tracking/sessions/:id/points, e comunque non c'e' un profilo da
        // seguire.
        const bersaglio = await User.findById(followingId).select('pendingDeletionAt deletedAt');
        if (!bersaglio || eliminato(bersaglio)) {
            return res.status(404).json({ error: 'Questa persona non esiste.' });
        }

        const gia = await Follow.findOne({ followerId, followingId });
        if (!gia) {
            await Follow.create({ followerId, followingId });
        }
        res.json({ success: true });
    } catch (e) {
        // 11000 = indice unico: il follow e' comparso nel frattempo da un'altra richiesta.
        // Non e' un errore, come il POST di routes/bookmarks.js.
        if (e.code === 11000) {
            return res.json({ success: true });
        }
        console.error('Errore creazione follow:', e);
        res.status(400).json({ error: 'Impossibile seguire questa persona.' });
    }
});

// Smetti di seguire. Idempotente come il POST: togliere un follow che non c'e' non e' un
// errore. Sempre e solo il follow di chi ha fatto login.
router.delete('/:userId', requireAuth, async (req, res) => {
    try {
        await Follow.deleteOne({ followerId: req.session.userId, followingId: req.params.userId });
        res.json({ success: true });
    } catch (e) {
        console.error('Errore rimozione follow:', e);
        res.status(400).json({ error: 'Impossibile smettere di seguire questa persona.' });
    }
});

// --- ELENCHI (sola lettura, pubblici fra utenti loggati) ---
// Documenti Follow interi, come routes/bookmarks.js: il client legge followerId/followingId
// e li incrocia con l'elenco utenti gia' in cache (CamoscioState.users), senza una rotta
// che restituisca dati utente qui.

// Chi seguo IO. Serve al tasto "Segui" sui profili, alle liste in Tribu' & Squadre e al Feed.
router.get('/following', requireAuth, async (req, res) => {
    try {
        res.json(await Follow.find({ followerId: req.session.userId }).sort({ createdAt: -1 }));
    } catch (e) {
        console.error('Errore lettura "chi seguo":', e);
        res.status(500).json({ error: 'Impossibile caricare l\'elenco.' });
    }
});

// Chi segue un ALTRO utente (elenco "seguiti" sul suo profilo).
router.get('/following/:userId', requireAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
        return res.status(400).json({ error: 'Identificativo non valido.' });
    }
    try {
        res.json(await Follow.find({ followerId: req.params.userId }).sort({ createdAt: -1 }));
    } catch (e) {
        console.error('Errore lettura "chi segue" altrui:', e);
        res.status(500).json({ error: 'Impossibile caricare l\'elenco.' });
    }
});

// Chi mi segue.
router.get('/followers', requireAuth, async (req, res) => {
    try {
        res.json(await Follow.find({ followingId: req.session.userId }).sort({ createdAt: -1 }));
    } catch (e) {
        console.error('Errore lettura "chi mi segue":', e);
        res.status(500).json({ error: 'Impossibile caricare l\'elenco.' });
    }
});

// Chi segue un ALTRO utente (elenco "seguaci" sul suo profilo).
router.get('/followers/:userId', requireAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
        return res.status(400).json({ error: 'Identificativo non valido.' });
    }
    try {
        res.json(await Follow.find({ followingId: req.params.userId }).sort({ createdAt: -1 }));
    } catch (e) {
        console.error('Errore lettura "seguaci" altrui:', e);
        res.status(500).json({ error: 'Impossibile caricare l\'elenco.' });
    }
});

// Conteggi per il profilo: "N seguaci - N seguiti". Due countDocuments su indice
// ({followingId:1} e il prefisso di {followerId:1, followingId:1}).
router.get('/counts/:userId', requireAuth, async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
        return res.status(400).json({ error: 'Identificativo non valido.' });
    }
    try {
        const [followers, following] = await Promise.all([
            Follow.countDocuments({ followingId: req.params.userId }),
            Follow.countDocuments({ followerId: req.params.userId })
        ]);
        res.json({ followers, following });
    } catch (e) {
        console.error('Errore conteggio follow:', e);
        res.status(500).json({ error: 'Impossibile calcolare i conteggi.' });
    }
});

module.exports = router;
