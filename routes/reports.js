const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

// Punto 45: chi puo' moderare le segnalazioni sentiero (confermarle/rifiutarle prima che
// diventino pubbliche). Middleware e non un check inline come isSquadAdmin in squads.js:
// dipende solo da chi ha fatto login, non da una risorsa da caricare prima, quindi puo'
// girare come secondo middleware sulle rotte protette senza ripetere la stessa query tre volte.
async function requireReportModerator(req, res, next) {
    const user = await User.findById(req.session.userId);
    if (!user || !user.canModerateReports) {
        return res.status(403).json({ error: 'Non hai il permesso di moderare le segnalazioni' });
    }
    next();
}

// Ottieni report di crowdsourcing (Waze) - SOLO quelli gia' pubblici. Prima non filtrava per
// niente (bug di sicurezza trovato introducendo lo stato 'pending', punto 45): un report in
// attesa di verifica sarebbe stato comunque leggibile via rete da chiunque loggato, anche se
// il frontend lo nasconde (map.js filtra gia' su status==='active' lato client).
router.get('/', requireAuth, async (req, res) => {
    const reports = await Report.find({ status: 'active' });
    res.json(reports);
});

// Punto 45: elenco delle segnalazioni in attesa di verifica - solo per chi modera. Registrata
// prima di qualunque eventuale futura GET /:id (che oggi non esiste): un path letterale va
// sempre dichiarato prima di un param altrimenti "pending" verrebbe interpretato come :id.
router.get('/pending', requireAuth, requireReportModerator, async (req, res) => {
    const reports = await Report.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(reports);
});

// Crea report di crowdsourcing (Waze) - chi segnala e' sempre chi ha fatto login. Punto 45:
// non e' piu' visibile subito (status 'pending'), va confermata da un moderatore prima di
// comparire in mappa/sidebar (vedi PATCH /:id/confirm sotto).
router.post('/', requireAuth, async (req, res) => {
    try {
        const report = await Report.create({ ...req.body, status: 'pending', reporterId: req.session.userId });
        res.json(report);
    } catch (e) {
        console.error('Errore creazione segnalazione:', e);
        res.status(400).json({ error: 'Impossibile creare la segnalazione' });
    }
});

// Punto 45: conferma una segnalazione pendente - diventa pubblica esattamente come un report
// 'active' di sempre (marker in mappa, lista sidebar). Rotta separata dalla PATCH /:id sotto
// (che resta aperta a chiunque, per il flusso crowdsourced "risolvi"): mescolare un'azione
// gated dal permesso con una aperta a tutti nello stesso handler avrebbe reso quest'ultimo
// piu' fragile.
router.patch('/:id/confirm', requireAuth, requireReportModerator, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Segnalazione non trovata' });
        }
        if (report.status !== 'pending') {
            return res.status(400).json({ error: 'La segnalazione non e\' piu\' in attesa di verifica' });
        }
        report.status = 'active';
        await report.save();
        res.json(report);
    } catch (e) {
        res.status(400).json({ error: 'Impossibile confermare la segnalazione' });
    }
});

// Punto 45: rifiuta una segnalazione pendente - eliminazione vera, nessuno stato "rifiutato"
// persistente (deciso da Denis: "se respinta viene eliminata"). Verbo DELETE, non PATCH, per
// coerenza con lo stile REST gia' in uso nel progetto per le cancellazioni reali (vedi
// routes/tracking.js "/sessions/:id", routes/squads.js "/:id/admins/:userId", routes/routing.js
// "/drafts/:id"). Il controllo status==='pending' protegge da cancellazioni accidentali di
// segnalazioni gia' attive o risolte.
router.delete('/:id', requireAuth, requireReportModerator, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Segnalazione non trovata' });
        }
        if (report.status !== 'pending') {
            return res.status(400).json({ error: 'Puoi rifiutare solo segnalazioni in attesa di verifica' });
        }
        await Report.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Impossibile rifiutare la segnalazione' });
    }
});

// Segna una segnalazione come risolta (es. ghiaccio sciolto, frana rimossa) - qualunque utente
// loggato puo' confermarlo, stesso spirito crowdsourcing di Waze gia' usato per crearle. Aggiorna
// il documento esistente invece di crearne uno nuovo (vedi bug noto in cronologia.txt: la vecchia
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
