const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

// Punto 45 (foto): margine sopra il tetto lato browser (~300-400 KB dopo compressione in
// imagecompress.js) - il controllo vero e' li', questo e' solo il paracadute lato server
// contro un client che non passa dal compressore (chiamata diretta all'API, browser vecchio).
const MAX_PHOTO_BYTES = 600 * 1024;

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
//
// Punto 45 (foto): campo "photo" facoltativo nello stesso JSON, data URL base64 (stesso
// formato gia' in uso per profilePhoto in routes/users.js) - il browser l'ha gia'
// ridimensionata e compressa (public/js/imagecompress.js) prima di arrivare qui.
router.post('/', requireAuth, async (req, res) => {
    try {
        const { type, lat, lng, description, photo } = req.body;
        const data = { type, lat, lng, description, status: 'pending', reporterId: req.session.userId };

        if (photo) {
            const buffer = Buffer.from(String(photo).replace(/^data:image\/\w+;base64,/, ''), 'base64');
            if (buffer.length > MAX_PHOTO_BYTES) {
                return res.status(400).json({ error: 'Foto troppo grande, riprova (dovrebbe essere gia\' compressa dal browser)' });
            }
            // Controllo dei magic bytes JPEG (FF D8 FF): il compressore manda sempre e solo
            // JPEG, un controllo sul contenuto vero e non solo sul Content-Type dichiarato -
            // stesso spirito del vincolo hard 7, non fidarsi di un'etichetta che il client
            // potrebbe non rispettare.
            if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
                return res.status(400).json({ error: 'Formato foto non valido' });
            }
            data.photo = buffer;
            data.hasPhoto = true;
        }

        const report = await Report.create(data);
        // select:false non vale per il documento appena creato (resta in memoria per
        // intero): va tolta a mano prima di rispondere, altrimenti la foto - anche se mai
        // richiesta da nessuna lista - uscirebbe comunque qui.
        const json = report.toJSON();
        delete json.photo;
        res.json(json);
    } catch (e) {
        console.error('Errore creazione segnalazione:', e);
        res.status(400).json({ error: 'Impossibile creare la segnalazione' });
    }
});

// Punto 45 (foto): la foto vera, solo su richiesta esplicita - mai dentro le liste (GET /,
// GET /pending), che restano leggere. requireAuth e basta, non gated moderatore: non piu'
// sensibile degli altri campi del report (lat/lng/descrizione), gia' visibili a chiunque sia
// loggato una volta che il report e' 'active'; per un report ancora 'pending' l'id non e'
// scopribile da nessuna lista prima della conferma, quindi in pratica solo chi l'ha creata
// (che gia' la conosce) o un moderatore possono arrivarci.
router.get('/:id/photo', requireAuth, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id).select('+photo');
        if (!report || !report.photo) {
            return res.status(404).json({ error: 'Foto non trovata' });
        }
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'private, max-age=86400');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(report.photo);
    } catch (e) {
        res.status(400).json({ error: 'Impossibile recuperare la foto' });
    }
});

// Punto 45: conferma una segnalazione pendente - diventa pubblica esattamente come un report
// 'active' di sempre (marker in mappa, lista sidebar). Rotta separata da DELETE /:id/resolve
// piu' sotto (che resta aperta a chiunque, per il flusso crowdsourced "risolvi"): mescolare
// un'azione gated dal permesso con una aperta a tutti nello stesso handler avrebbe reso
// quest'ultimo piu' fragile.
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

// Punto 45: "risolvi" ora CANCELLA per intero (foto compresa), non imposta piu' uno stato
// 'resolved' persistente - decisione di Denis ("cancelliamo la foto e la segnalazione una
// volta che il pericolo non c'e' piu'"), con conferma obbligatoria lato client prima di
// arrivare qui (un tocco sbagliato ora distrugge l'avviso per sempre, non lo nasconde).
// Resta crowdsourced (qualunque utente loggato, non gated moderatore), stesso spirito di
// sempre. Verbo/percorso diversi da DELETE /:id sopra apposta: quella e' il rifiuto di un
// pending (solo moderatore, guard 'pending') - mescolarle romperebbe la separazione voluta.
// Idempotente: un documento gia' assente risponde comunque 200, non 404, perche' due persone
// possono segnalare risolto lo stesso pericolo quasi insieme.
router.delete('/:id/resolve', requireAuth, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.json({ success: true });
        }
        if (report.status !== 'active') {
            return res.status(400).json({ error: 'Puoi segnare come risolta solo una segnalazione attiva' });
        }
        await Report.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Impossibile segnare la segnalazione come risolta' });
    }
});

module.exports = router;
