const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const { requireAuth } = require('../middleware/auth');
const { ensureCompletionReminders } = require('../lib/hikeStats'); // punto 64
const { controllaScadenze } = require('../lib/reportAlerts'); // punto 111

// Ottieni le notifiche di un utente (più recenti prima) - SOLO le proprie, mai quelle di un altro
router.get('/:userId', requireAuth, async (req, res) => {
    if (req.params.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Puoi vedere solo le tue notifiche' });
    }
    try {
        // Punto 64: qui e non in GET /api/hikes (molto piu' chiamata) - il confine
        // "userId === req.session.userId" gia' verificato sopra basta a delimitare la
        // query senza introdurne uno nuovo, e non scrive sul database per chi non ha mai
        // creato un'escursione. Non esistendo scheduler ne' push in questo progetto, e'
        // anche l'unico momento in cui "il promemoria compare" puo' succedere davvero.
        await ensureCompletionReminders(req.params.userId);

        // Punto 111: controllo scadenze delle segnalazioni sentiero, PIGRO come il
        // promemoria del punto 64 qui sopra - non esistendo scheduler, il fetch delle
        // notifiche e' l'unico momento in cui una segnalazione scaduta puo' diventare un
        // avviso per Denis. Pre-controllo sull'indice expiresAt_1: nel caso normale
        // (niente di scaduto) esce 0 e ci si ferma. NON gated sul destinatario: se
        // qualcosa e' scaduto, il primo fetch di CHIUNQUE lo fa notificare a chi ha
        // receivesReportAlerts e "timbra" expiryNotifiedAt, cosi' i fetch successivi
        // ritrovano 0. try suo: un errore qui non deve svuotare la lista notifiche di un
        // utente che non c'entra (il catch esterno risponde []).
        try {
            const daNotificare = await Report.countDocuments({
                expiresAt: { $lte: new Date() },
                expiryNotifiedAt: { $exists: false }
            });
            if (daNotificare > 0) await controllaScadenze();
        } catch (e) {
            console.error('Controllo scadenze segnalazioni fallito:', e.message);
        }

        const userNotifications = await Notification.find({ userId: req.params.userId }).sort({ createdAt: -1 });
        res.json(userNotifications);
    } catch (e) {
        res.json([]);
    }
});

// Crea una notifica (usato lato client per gli esiti di approvazione/rifiuto iscrizione).
// Il destinatario (userId) puo' essere un altro utente: e' cosi' per design (es. il
// capogruppo notifica chi ha accettato/rifiutato), va bene finche' chi chiama e' loggato.
router.post('/', requireAuth, async (req, res) => {
    try {
        const notification = await Notification.create({ read: false, ...req.body });
        res.json(notification);
    } catch (e) {
        console.error('Errore creazione notifica:', e);
        res.status(400).json({ error: 'Impossibile creare la notifica' });
    }
});

// Punto 81: segna TUTTE le proprie notifiche come lette in un colpo solo - aprire il
// pannello del campanello basta a considerarle lette, senza cliccarle una per una. Sempre
// req.session.userId, mai un id mandato dal client - stessa regola di ogni altra rotta.
router.put('/read-all', requireAuth, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.session.userId, read: false }, { read: true });
        res.json({ success: true });
    } catch (e) {
        console.error('Errore nel segnare tutte le notifiche come lette:', e);
        res.status(400).json({ error: 'Impossibile segnare le notifiche come lette' });
    }
});

// Segna una notifica come letta - SOLO se e' la propria
router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ error: 'Notifica non trovata' });
        }
        if (!notification.userId.equals(req.session.userId)) {
            return res.status(403).json({ error: 'Puoi segnare come lette solo le tue notifiche' });
        }
        notification.read = true;
        await notification.save();
        res.json(notification);
    } catch (e) {
        res.status(404).json({ error: 'Notifica non trovata' });
    }
});

module.exports = router;
