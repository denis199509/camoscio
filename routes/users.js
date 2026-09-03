const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Squad = require('../models/Squad');
const { requireAuth } = require('../middleware/auth');
const { exportLimiter, scritturaLimiter } = require('../middleware/rateLimit');
const { chiudiTutteLeSessioni } = require('../db/sessionStore');
// Punto A-3.4: eliminazione account. La logica sta in lib/accountDeletion.js (serve
// anche al trigger esterno dello scrub, e non va duplicata).
const {
    escursioniFutureDaCreatore, avviaEliminazione, scrubAccount,
    serializzaUtentePubblico, eliminato
} = require('../lib/accountDeletion');
const { segretoCronValido } = require('../lib/cronSecret');
// A-3.3 (revisione sicurezza 21a): export dei propri dati - servono tutte le collezioni
// che portano un riferimento all'utente.
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Completion = require('../models/Completion');
const Hike = require('../models/Hike');
const Follow = require('../models/Follow');
const Like = require('../models/Like');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const Review = require('../models/Review');
const RouteBookmark = require('../models/RouteBookmark');
const RouteDraft = require('../models/RouteDraft');
const SavedRoute = require('../models/SavedRoute');
const Stamp = require('../models/Stamp');
const HikeMessage = require('../models/HikeMessage');
const SquadMessage = require('../models/SquadMessage');
const TrailCandidate = require('../models/TrailCandidate');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;

// Router montato direttamente su /api (non /api/users): storicamente /api/login
// era un percorso "fratello", non annidato sotto /users (login vero e proprio e'
// comunque su /api/auth/login dalla Fase C, questo resta solo per i campi utente).

// Campi mai visibili a nessuno tranne il proprietario del profilo. Nome/cognome inclusi
// perche' esistono solo per identificazione reale (es. contatti di emergenza) e non devono
// mai essere mostrati al posto dello username (vedi cronologia.txt) - mancavano qui (bug trovato
// in Fase H), quindi trapelavano a chiunque tramite GET /api/users.
// "emailVerified" sta qui in coppia con "email": se un indirizzo non e' visibile agli
// altri, non deve esserlo nemmeno il suo stato. Sapere chi non ha ancora confermato
// indicherebbe a un estraneo quali account sono piu' facili da contestare.
// Punto 37: deadManActive/deadManExpiresAt rivelano quando qualcuno e' atteso di rientro (e se
// il timer sta correndo adesso) - la stessa categoria di dato sensibile di emergencyContacts,
// mai da mostrare a chi non e' il proprietario. (A-3.2: deadManContactIndex non esiste piu' -
// l'allarme va a tutti i contatti con email, vedi models/User.js e routes/safety.js.)
// Punto 45: canModerateReports non e' un dato sensibile come i contatti di emergenza, ma non
// c'e' motivo che GET /api/users riveli a chiunque chi sono i moderatori delle segnalazioni.
// Punto 111: stesso ragionamento per receivesReportAlerts (chi riceve gli avvisi).
// C-1 (revisione sicurezza 21a): homeCity ("comune / zona di partenza da casa" per il
// carpooling) trapelava a ogni utente loggato via GET /api/users, ignorando privacySetting,
// mentre l'interfaccia prometteva il contrario. Ora esce solo al proprietario; il match coi
// co-partecipanti lo calcola il server (GET /api/hikes/:id/home-match), che risponde solo
// coi nomi di chi combacia, mai con la zona altrui.
const ALWAYS_PRIVATE_FIELDS = [
    'email', 'emailVerified', 'emergencyContacts', 'birthDate', 'ageRange',
    'geolocationConsent', 'termsAcceptedAt', 'nome', 'cognome', 'homeCity',
    'deadManActive', 'deadManExpiresAt', 'canModerateReports',
    'receivesReportAlerts'
];
// Campi del "profilo pubblico" (sezione 6/9 della registrazione) governati da privacySetting
const PRIVACY_GATED_FIELDS = ['bio', 'profilePhoto', 'interests', 'hikingLevel', 'preferredDifficulty', 'geoPreferences'];

// Campi che il proprietario del profilo puo' modificare da solo tramite PUT /users/:id.
// Whitelist (non blacklist): qualunque campo NON elencato qui viene ignorato, cosi' un campo
// nuovo aggiunto in futuro a models/User.js e' escluso di default finche' qualcuno non decide
// esplicitamente di renderlo modificabile - vedi bug trovato in Fase H sotto per il motivo.
// "avatar" volutamente escluso: e' testo libero senza formato imposto (a differenza di bio/
// interessi) e nessuna schermata attuale lo rende modificabile, quindi tenerlo fuori dalla
// whitelist chiude la via piu' semplice per intestare a se' stessi un valore malevolo, senza
// dover rincorrere ogni punto dell'interfaccia dove un avatar altrui viene mostrato.
const SELF_EDITABLE_FIELDS = [
    'nome', 'cognome', 'username', 'trainingGoal', 'localExpert', 'homeCity',
    'hikingLevel', 'interests', 'preferredDifficulty', 'geoPreferences',
    'profilePhoto', 'bio', 'emergencyContacts', 'geolocationConsent', 'privacySetting',
    'birthDate', 'ageRange'
];

async function areSquadmates(userIdA, userIdB) {
    if (!userIdA || !userIdB) return false;
    const shared = await Squad.findOne({
        $and: [
            { $or: [{ creatorId: userIdA }, { members: userIdA }] },
            { $or: [{ creatorId: userIdB }, { members: userIdB }] }
        ]
    });
    return !!shared;
}

// Prepara il profilo di targetUser per gli occhi di viewerId, nascondendo i campi
// sensibili quando chi guarda non e' il proprietario del profilo.
async function serializeUserForViewer(targetUser, viewerId) {
    // Punto A-3.4: account eliminato (in grazia o gia' scrubato) -> nessun dato personale
    // a nessuno, nome fisso "Account eliminato". Vale anche per il "se stesso" nominale:
    // durante la grazia non esistono sessioni attive di quell'utente (chiuse alla
    // richiesta) e un login le annullerebbe comunque l'eliminazione.
    if (eliminato(targetUser)) {
        return serializzaUtentePubblico(targetUser);
    }

    const json = targetUser.toJSON();
    const isSelf = viewerId && String(viewerId) === String(targetUser._id);
    if (isSelf) return json;

    for (const field of ALWAYS_PRIVATE_FIELDS) delete json[field];

    if (targetUser.privacySetting === 'Privato') {
        for (const field of PRIVACY_GATED_FIELDS) delete json[field];
    } else if (targetUser.privacySetting === 'SoloAmici') {
        const friends = await areSquadmates(viewerId, targetUser._id);
        if (!friends) {
            for (const field of PRIVACY_GATED_FIELDS) delete json[field];
        }
    }

    return json;
}

// Ottieni tutti gli utenti
router.get('/users', requireAuth, async (req, res) => {
    const users = await User.find();
    const filtered = await Promise.all(users.map(u => serializeUserForViewer(u, req.session.userId)));
    res.json(filtered);
});

// A-3.3 (revisione sicurezza 21a): export dei propri dati (GDPR - diritto di accesso e
// portabilita'). Un unico JSON scaricabile con tutto quello che il sito conserva collegato
// all'account. SOLO il proprio (req.session.userId, mai un id dal client). Percorso a 3
// segmenti apposta: non viene intercettato da /users/:id qui sotto.
// A-NUOVO-3 (ri-review sicurezza, 2° giro + residuo chiuso al 3°): exportLimiter (3/giorno) +
// NON si caricano gli array di punti - ne' i punti GPS grezzi delle tracce (.select('-points
// -offTrailBuffer')), ne' la geometria di percorsi salvati/progetti/tracce candidate
// (RouteDraft.punti, SavedRoute.punti, TrailCandidate.points, tutti [[Number]]) - + JSON senza
// indentazione: con `null, 2` ogni numero va su una riga sua, decine di MB in RAM su Render
// 512 MB. I punti GPS restano scaricabili traccia per traccia da
// GET /api/tracking/sessions/:id/points; i percorsi si riaprono dai rispettivi pannelli.
router.get('/users/me/export', requireAuth, exportLimiter, async (req, res) => {
    try {
        const uid = req.session.userId;
        const me = String(uid);

        // Punto A-3.4, difesa in profondita': un account in eliminazione non deve avere
        // sessioni attive (le chiude la richiesta), e il ripristino via login/reset annulla
        // subito lo stato. Se pero' una sessione arrivasse qui, questa e' la rotta che
        // concentra TUTTO (email, nome, homeCity, contatti di emergenza): non serve.
        const statoMe = await User.findById(uid).select('pendingDeletionAt deletedAt');
        if (eliminato(statoMe)) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        const [
            profilo, tracce, completamenti, hikeCreate, hikePartecipate,
            timbri, followCheFai, followCheRicevi, likeMessi, notifiche,
            segnalazioni, squadreGrezze, msgEscursioni, msgSquadre,
            sentieriPreferiti, progetti, percorsiSalvati, recensioniRicevute, tracceCandidate,
            invitiSquadraRicevuti, invitiEscursioneRicevuti
        ] = await Promise.all([
            User.findById(uid).lean(),                  // passwordHash e' select:false: non esce
            ActiveHikeSession.find({ userId: uid }).select('-points -offTrailBuffer').lean(),
            Completion.find({ userId: uid }).lean(),
            Hike.find({ creatorId: uid }).lean(),
            Hike.find({ participants: uid, creatorId: { $ne: uid } }).lean(),
            Stamp.find({ userId: uid }).lean(),
            Follow.find({ followerId: uid }).lean(),
            Follow.find({ followingId: uid }).lean(),
            Like.find({ userId: uid }).lean(),
            Notification.find({ userId: uid }).lean(),
            Report.find({ reporterId: uid }).lean(),    // photo e' select:false: non esce
            Squad.find({ $or: [{ creatorId: uid }, { members: uid }] }).lean(),
            HikeMessage.find({ senderId: uid }).lean(),
            SquadMessage.find({ senderId: uid }).lean(),
            RouteBookmark.find({ userId: uid }).lean(),
            RouteDraft.find({ userId: uid }).select('-punti').lean(),
            SavedRoute.find({ userId: uid }).select('-punti').lean(),
            Review.find({ targetUserId: uid }).lean(),  // anonime per design: nessun reviewerId
            TrailCandidate.find({ userId: uid }).select('-points').lean(),
            // B-5 (revisione sicurezza 28ª): un invito RICEVUTO e non ancora accettato e' un
            // dato personale che il titolare detiene sull'interessato - va nell'export come le
            // squadre/escursioni di cui si fa parte. Solo i campi che identificano l'invito.
            Squad.find({ pendingInvites: uid }).select('_id name').lean(),
            Hike.find({ pendingInvites: uid }).select('_id title date').lean()
        ]);

        // Le escursioni a cui SOLO partecipi contengono anche dati di gruppo (carpooling e
        // zaino condivisibile degli altri): si esporta la parte comune dell'escursione + SOLO
        // la tua riga carpool e i tuoi oggetti dello zaino, non quelli altrui.
        const escursioniACuiPartecipi = (hikePartecipate || []).map(h => ({
            _id: h._id, title: h.title, description: h.description, date: h.date,
            difficulty: h.difficulty, maxAltitude: h.maxAltitude, distanceKm: h.distanceKm,
            elevationGain: h.elevationGain, trailhead: h.trailhead, creatorId: h.creatorId,
            groupCompletedAt: h.groupCompletedAt,
            mioCarpool: (((h.carpool || {}).drivers) || []).filter(d => String(d.userId) === me),
            mioZaino: (h.backpackTemplate || []).filter(i => String(i.assignedTo || '') === me)
        }));

        // Squadre: la lista membri e' gia' visibile a chi ne fa parte, ma pendingRequests
        // (chi ha chiesto di entrare) la vede solo creatore/admin - si toglie dall'export.
        const squadre = (squadreGrezze || []).map(s => {
            const { pendingRequests, ...resto } = s;
            return resto;
        });

        // M-3 (ri-review sicurezza, 2° giro): anche sulle PROPRIE escursioni si minimizza -
        // il file lo scarica l'utente e potrebbe girarlo. Fuori la zona di partenza da casa
        // degli altri autisti e la lista di chi ha chiesto di partecipare.
        const escursioniCreateDaTe = (hikeCreate || []).map(h => ({
            ...h,
            carpool: h.carpool ? {
                ...h.carpool,
                drivers: (h.carpool.drivers || []).map(d => {
                    const { departureCity, ...restoD } = d || {};
                    return restoD;
                })
            } : h.carpool,
            pendingApproval: undefined
        }));

        const bundle = {
            _nota: "Export dei tuoi dati da Camoscio (app di escursionismo). Formato JSON. Contiene tutto cio' che il sito conserva collegato al tuo account. Gli identificativi lunghi sono i riferimenti interni del database. Non sono inclusi gli elenchi di punti: i punti GPS grezzi di ogni traccia si scaricano traccia per traccia dalla pagina dell'uscita, e la geometria dei percorsi salvati, dei progetti percorso e delle tracce candidate si rivede riaprendoli dai rispettivi pannelli. Qui restano i dati descrittivi (nome, totali, date).",
            generatoIl: new Date().toISOString(),
            profilo,
            tracceGps: tracce,
            escursioniCompletate: completamenti,
            escursioniCreateDaTe,
            escursioniACuiPartecipi,
            badgeConquistati: timbri,
            followCheFai,
            followCheRicevi,
            likeMessi,
            notifiche,
            segnalazioniSentieroTue: segnalazioni,
            squadre,
            messaggiChatEscursioni: msgEscursioni,
            messaggiChatSquadre: msgSquadre,
            sentieriPreferiti,
            progettiPercorso: progetti,
            percorsiSalvati,
            recensioniRicevute,
            tracceCandidateSentiero: tracceCandidate,
            invitiSquadraRicevuti,
            invitiEscursioneRicevuti
        };

        const base = String((profilo && profilo.username) || 'utente').replace(/[^\w-]+/g, '_');
        const nomeFile = `camoscio-dati-${base}-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeFile}"`);
        res.send(JSON.stringify(bundle)); // niente `null, 2`: il file e' per una macchina, non da leggere a mano
    } catch (e) {
        console.error('Errore export dati utente:', e);
        res.status(500).json({ error: "Impossibile generare l'export dei dati" });
    }
});

// Punto A-3.4: eliminazione del PROPRIO account. Soft-delete in due tempi - qui parte
// solo la RICHIESTA: pseudonimizzazione immediata ("Account eliminato" ovunque) + 30
// giorni per annullare rientrando col login. Lo scrub definitivo dei dati personali lo
// fa POST /users/scrub-eliminati (trigger esterno). SOLO req.session.userId, mai un id
// dal client. Percorso a 3 segmenti come /users/me/export: non lo intercetta /users/:id.
router.delete('/users/me', requireAuth, scritturaLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('+passwordHash');
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });

        // Gli account demo sono condivisi e si usano senza password: non si eliminano.
        if (user.isDemoAccount) {
            return res.status(403).json({ error: 'Gli account demo non si possono eliminare' });
        }
        if (user.pendingDeletionAt) {
            return res.status(409).json({ error: "L'eliminazione di questo account è già in corso" });
        }

        // Ri-autenticazione, come il cambio password (routes/auth.js): ferma chi trovasse
        // una sessione aperta su un dispositivo altrui.
        const password = String((req.body && req.body.password) || '');
        if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Password non corretta' });
        }

        // Blocco (decisione di Denis): le escursioni in programma organizzate da lui vanno
        // annullate o passate a un altro organizzatore prima - senza un organizzatore non
        // possono funzionare.
        const future = await escursioniFutureDaCreatore(user._id);
        if (future.length) {
            return res.status(409).json({
                error: "Hai escursioni in programma organizzate da te. Annullale o passale a un altro organizzatore prima di eliminare l'account.",
                escursioni: future.map(h => ({ id: String(h._id), title: h.title, date: h.date }))
            });
        }

        await avviaEliminazione(user);

        // Tutte le sessioni dell'utente, su ogni dispositivo (come dopo il reset password).
        await chiudiTutteLeSessioni(user._id);
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ ok: true });
        });
    } catch (e) {
        console.error('Errore richiesta eliminazione account:', e);
        res.status(500).json({ error: "Impossibile eliminare l'account" });
    }
});

// Punto A-3.4: scrub definitivo degli account la cui grazia di 30 giorni e' scaduta.
// Chiamata da un trigger ESTERNO (cron-job.org), come /api/safety/controlla-scadenze:
// nessuna sessione, segreto condiviso (ACCOUNT_SCRUB_SECRET, fail-closed in produzione -
// vedi lib/cronSecret.js). Idempotente: uno scrub gia' fatto (deletedAt) viene saltato.
// GET e POST: non tutti i servizi di ping permettono di scegliere il metodo, e non c'e'
// nessun corpo da leggere. VA REGISTRATA PRIMA di GET /users/:id (2 segmenti: senza
// questo ordine ':id' catturerebbe "scrub-eliminati").
async function scrubEliminatiHandler(req, res) {
    if (!segretoCronValido(req, 'ACCOUNT_SCRUB_SECRET')) {
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    try {
        // .select minimale (scrubAccount usa solo _id e deletedAt) + tetto: senza,
        // User.find carica i documenti interi, profilePhoto base64 compreso (fino a 2 MB
        // l'uno) su un'istanza Render da 512 MB. Un arretrato oltre 200 lo smaltisce il
        // ping successivo.
        const daScrubare = await User.find({
            deletionScrubAt: { $lte: new Date() },
            deletedAt: { $exists: false }
        }).select('_id deletedAt').limit(200);
        let scrubati = 0;
        for (const user of daScrubare) {
            if (await scrubAccount(user)) scrubati++;
        }
        res.json({ scrubati });
    } catch (e) {
        console.error('Errore scrub account eliminati:', e);
        res.status(500).json({ error: 'Errore nello scrub degli account eliminati' });
    }
}
// scritturaLimiter: la rotta e' senza sessione e ogni colpo fa una scansione su
// deletionScrubAt. Gated su NODE_ENV=production (skip in dev/test). NB: dalla 28ª
// (MEDIO-1) POST /api/safety/activate ha un secchio suo (sicurezzaLimiter), non piu' questo.
router.get('/users/scrub-eliminati', scritturaLimiter, scrubEliminatiHandler);
router.post('/users/scrub-eliminati', scritturaLimiter, scrubEliminatiHandler);

// Ottieni dettagli utente
router.get('/users/:id', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        res.json(await serializeUserForViewer(user, req.session.userId));
    } catch (e) {
        res.status(404).json({ error: 'Utente non trovato' });
    }
});

// Aggiorna profilo utente (es. goal, localExpert, bio, interessi...) - SOLO il proprio profilo
router.put('/users/:id', requireAuth, async (req, res) => {
    if (req.params.id !== req.session.userId) {
        return res.status(403).json({ error: 'Puoi modificare solo il tuo profilo' });
    }
    try {
        const existing = await User.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        // Whitelist esplicita (vedi SELF_EDITABLE_FIELDS sopra) invece della vecchia blacklist:
        // quella lasciava passare senza accorgersene campi come reputation/completedHikes/
        // experienceLevel/averagePaceUp/averagePaceDown, tutti calcolati SOLO dal server dallo
        // storico escursioni reale (vedi routes/hikes.js e routes/reviews.js) - chiunque poteva
        // auto-assegnarsi una reputazione/livello a piacere chiamando questa rotta (bug trovato
        // in Fase H, caccia ai bug generale).
        const update = {};
        for (const field of SELF_EDITABLE_FIELDS) {
            if (req.body[field] !== undefined) update[field] = req.body[field];
        }

        // I 4 account demo storici devono "rimanere" con questi nomi (richiesta esplicita in
        // cose_da_fare.txt) e sono raggiungibili senza password da chiunque: permettere di
        // rinominarli farebbe sparire l'account "Marco Alpinista" ecc. dalla pagina /demo (bug
        // trovato in Fase H, insieme all'XSS via username corretto in public/demo.html).
        if (existing.isDemoAccount) {
            delete update.username;
        }

        if (update.profilePhoto && String(update.profilePhoto).length > MAX_PHOTO_LENGTH) {
            return res.status(400).json({ error: 'Foto profilo troppo grande, scegline una più piccola' });
        }

        // A-NUOVO-1 (ri-review sicurezza, 2° giro): il vero controllo su emergencyContacts va
        // QUI - Mongoose non valida in modo affidabile i sotto-documenti degli array su
        // findByIdAndUpdate. Senza, un array gigante o campi enormi passano, e alla scadenza
        // del Dead Man's Switch il server manda un'email per ogni voce (relay verso terzi).
        // R-3 (3° giro): le stesse regole servono anche in POST /api/auth/register - helper
        // condiviso in models/User.js per non tenerne due copie.
        if (update.emergencyContacts !== undefined) {
            const errore = User.validaContattiEmergenza(update.emergencyContacts);
            if (errore) return res.status(400).json({ error: errore });
        }

        const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'Utente non trovato' });
        }
    } catch (e) {
        console.error('Errore aggiornamento profilo:', e);
        res.status(400).json({ error: 'Impossibile aggiornare il profilo' });
    }
});

module.exports = router;
