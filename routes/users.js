const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Squad = require('../models/Squad');
const { requireAuth } = require('../middleware/auth');
const { exportLimiter, scritturaLimiter, fotoProfiloLimiter, fotoProfiloLetturaLimiter } = require('../middleware/rateLimit');
const { validaFotoProfiloJpeg } = require('../lib/profilePhoto'); // ALTO, follow-up revisione sicurezza (30ª): stesso buco di MEDIO-2/3 su Squad.photo
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
// M-4 (follow-up revisione sicurezza, 31a): proiezione Mongo derivata dallo stesso elenco,
// cosi' i due non possono divergere in silenzio (lezione gia' pagata altrove nel progetto).
// Usata SOLO dalla lista (GET /users, sotto) per non caricare in RAM del server dati di
// TERZE PERSONE (i contatti di emergenza altrui) che tanto serializeUserForViewer avrebbe
// cancellato subito dopo - non e' un rischio OOM come lo era la foto (sono stringhe corte),
// ma minimizzazione: non tirare dentro dati che non serviranno. NON va applicata al proprio
// documento (vedi sotto): cancellerebbe anche i TUOI campi dalla lista, e currentUser
// (app.js) li legge proprio da qui.
const PROIEZIONE_LISTA_ESCLUDE_PRIVATI = Object.fromEntries(ALWAYS_PRIVATE_FIELDS.map(f => [f, 0]));
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

// M-4 (follow-up revisione sicurezza, 31a): usata SOLO da GET /users (lista, sotto) per
// calcolare una volta sola l'insieme dei compagni di squadra di viewerId, invece che con
// una query areSquadmates() per OGNI utente "SoloAmici" incontrato scorrendo la lista (N+1
// - a 50 utenti "SoloAmici" erano 50 query Squad identiche nella parte che conta, ripetute
// ad ogni refreshState). areSquadmates() resta per i chiamanti a bersaglio singolo (GET
// /:id, GET /:id/photo), dove una query sola e' gia' il minimo possibile.
// Il viewerId per cui e' stato calcolato viaggia CON l'insieme (rilievo MEDIO del giro
// agente): senza, un domani un chiamante potesse passare un Set calcolato per un ALTRO
// utente e campiPrivacyVisibiliA lo crederebbe sulla parola - un Set sbagliato non esplode
// come un tipo sbagliato, decide silenziosamente male su un campo di privacy.
async function squadmateSetFor(viewerId) {
    if (!viewerId) return { viewerId: null, ids: new Set() };
    const squadre = await Squad.find({
        $or: [{ creatorId: viewerId }, { members: viewerId }]
    }).select('creatorId members');
    const ids = new Set();
    for (const s of squadre) {
        ids.add(String(s.creatorId));
        for (const m of s.members || []) ids.add(String(m));
    }
    ids.delete(String(viewerId));
    return { viewerId: String(viewerId), ids };
}

// Decide se PRIVACY_GATED_FIELDS (bio/profilePhoto/interessi/livello/...) sono visibili a
// viewerId. Estratta da serializeUserForViewer (MEDIO, follow-up revisione sicurezza) per non
// riscrivere la stessa regola nella nuova GET /:id/photo qui sotto - due copie
// divergerebbero in silenzio, stessa lezione di usciteVisibili/uscitaVisibile.
// CONTRATTO (rilievo M-3 del giro agente): targetUser deve portare ALMENO _id e
// privacySetting. I due chiamanti passano documenti diversi - serializeUserForViewer passa
// il documento INTERO, GET /:id/photo ne passa uno proiettato (.select(...)) - quindi se
// domani questa regola guarda un campo nuovo, va aggiunto anche a QUELLA proiezione, non
// solo qui. L'elenco esplicito 'Pubblico'/undefined (invece del vecchio "tutto cio' che non
// e' Privato/SoloAmici") non cambia il risultato per i tre valori dell'enum ne' per un utente
// pre-esistente senza il campo (undefined resta trattato come il default reale 'Pubblico',
// voluto: non e' distinguibile da "proiezione che l'ha escluso" solo guardando il valore, e
// negarlo rischierebbe di chiudere di colpo il profilo di account vecchi) - ma nega, invece
// di concedere per esclusione, un valore CORROTTO o scritto con un typo (es. "privato"
// minuscolo), che col vecchio confronto a catena sarebbe scivolato nel ramo "tutto il resto
// e' pubblico".
// squadmateInfo (M-4, opzionale): l'oggetto {viewerId, ids} di squadmateSetFor(), per chi
// scorre una lista intera e vuole evitare una query areSquadmates() per ogni utente
// SoloAmici. Omesso (chiamata a bersaglio singolo, GET /:id e /:id/photo), si ripiega sulla
// query. Se viewerId non combacia con quello per cui l'insieme e' stato calcolato, si
// ignora l'insieme e si ripiega comunque sulla query - fail-closed, mai concedere per un
// insieme che potrebbe appartenere a qualcun altro (vedi il commento su squadmateSetFor).
async function campiPrivacyVisibiliA(targetUser, viewerId, squadmateInfo) {
    const isSelf = viewerId && String(viewerId) === String(targetUser._id);
    if (isSelf) return true;
    if (targetUser.privacySetting === 'SoloAmici') {
        if (squadmateInfo && squadmateInfo.viewerId === String(viewerId)) {
            return squadmateInfo.ids.has(String(targetUser._id));
        }
        return areSquadmates(viewerId, targetUser._id);
    }
    return targetUser.privacySetting === 'Pubblico' || targetUser.privacySetting === undefined;
}

// Prepara il profilo di targetUser per gli occhi di viewerId, nascondendo i campi
// sensibili quando chi guarda non e' il proprietario del profilo.
async function serializeUserForViewer(targetUser, viewerId, squadmateInfo) {
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

    if (!(await campiPrivacyVisibiliA(targetUser, viewerId, squadmateInfo))) {
        for (const field of PRIVACY_GATED_FIELDS) delete json[field];
    }

    return json;
}

// Ottieni tutti gli utenti
// M-4 (follow-up revisione sicurezza, 31a): il proprio documento va preso SENZA la
// proiezione (query separata) - serializeUserForViewer gli lascia tutti i campi (isSelf),
// e currentUser (app.js) prende proprio da questa lista i propri emergencyContacts/
// birthDate/homeCity per popolare le schermate di modifica. Applicare la proiezione anche
// a se stessi li svuoterebbe ad ogni refreshState, stesso difetto gia' visto e risolto sulla
// foto (M-1/M-2 dello stesso giro).
// BASSO (giro agente sul fix M-4): questa rotta era l'unica della zona senza try/catch - le
// vicine (GET /:id, GET /:id/photo, qui sotto) ce l'hanno tutte. Express non cattura da solo
// il rifiuto di un handler async: senza rete, un errore qui lascerebbe la richiesta appesa
// (o, da Node 15 in poi, potrebbe abbattere il processo) - non un dettaglio su un'app che
// ospita anche il Dead Man's Switch.
router.get('/users', requireAuth, async (req, res) => {
    try {
        const viewerId = req.session.userId;
        const [altri, self, squadmateInfo] = await Promise.all([
            User.find({ _id: { $ne: viewerId } }).select(PROIEZIONE_LISTA_ESCLUDE_PRIVATI),
            User.findById(viewerId),
            squadmateSetFor(viewerId)
        ]);
        const users = self ? [self, ...altri] : altri;
        const filtered = await Promise.all(users.map(u => serializeUserForViewer(u, viewerId, squadmateInfo)));
        res.json(filtered);
    } catch (e) {
        console.error('Errore caricamento lista utenti:', e);
        res.status(500).json({ error: 'Errore nel caricamento degli utenti' });
    }
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
            invitiSquadraRicevuti, invitiEscursioneRicevuti,
            richiesteSquadraInviate, richiesteEscursioneInviate
        ] = await Promise.all([
            // +profilePhoto (ALTO, giro agente sul fix MEDIO): select:false a schema - senza
            // questo l'export smetteva di contenere la foto profilo pur dichiarando nel
            // _nota sotto di contenere "tutto cio' che il sito conserva collegato al tuo
            // account". Query self-only dietro exportLimiter (3/giorno): nessun rischio RAM.
            User.findById(uid).select('+profilePhoto').lean(),   // passwordHash e' select:false: non esce
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
            Hike.find({ pendingInvites: uid }).select('_id title date').lean(),
            // MEDIO-4 (follow-up revisione sicurezza): il gemello di B-5 mancava - trovarsi
            // ancora in sospeso (pendingRequests di una squadra, pendingApproval di
            // un'escursione) e' comunque un dato personale che il sito conserva su di te,
            // anche se qui il "titolare" e' l'escursione/squadra altrui e non tu. Per le
            // squadre e' sempre una richiesta TUA (pendingRequests si scrive solo da
            // POST /:id/request-join, sul proprio id); per le escursioni pendingApproval e'
            // quasi sempre una tua richiesta ma puo' anche essere il creatore che ti sposta
            // li' da participants (B-3, giro agente) - resta comunque giusto esportarlo, e'
            // vero in entrambi i casi che sei "in attesa" su quell'escursione. Stessa
            // minimizzazione di B-5: solo i campi che identificano la richiesta.
            Squad.find({ pendingRequests: uid }).select('_id name').lean(),
            Hike.find({ pendingApproval: uid }).select('_id title date').lean()
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
            invitiEscursioneRicevuti,
            richiesteSquadraInviate,
            richiesteEscursioneInviate
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
        // User.find carica i documenti interi, profilePhoto base64 compreso (fino a ~800 KB
        // l'uno dopo il tetto abbassato nel follow-up sicurezza, 30ª; foto piu' vecchie
        // possono ancora pesare fino ai 2 MB di prima) su un'istanza Render da 512 MB. Un
        // arretrato oltre 200 lo smaltisce il ping successivo.
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

// La foto profilo di UN utente. Rotta a se' (MEDIO, follow-up revisione sicurezza): ne'
// GET /api/users ne' GET /:id qui sopra la portano piu' (select:false a schema) - stessa
// asimmetria RAM gia' chiusa su Squad.photo (MEDIO-3, 28ª), ma a differenza della foto
// squadra profilePhoto e' un PRIVACY_GATED_FIELDS: si applica la STESSA regola di
// serializeUserForViewer (campiPrivacyVisibiliA), altrimenti questa rotta riaprirebbe di
// nascosto un buco privacy gia' chiuso li' (Privato/SoloAmici scavalcati da chiunque loggato).
// Cache-Control no-cache (non max-age): il proprietario puo' cambiare o togliere la foto in
// qualunque momento (PUT /:id), stesso motivo gia' documentato su GET /squads/:id/photo.
router.get('/users/:id/photo', requireAuth, fotoProfiloLetturaLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('+profilePhoto privacySetting pendingDeletionAt deletedAt');
        if (!user || eliminato(user)) return res.status(404).json({ error: 'Utente non trovato' });
        const visibile = await campiPrivacyVisibiliA(user, req.session.userId);
        if (!visibile) return res.status(403).json({ error: 'Non autorizzato' });
        res.set('Cache-Control', 'private, no-cache');
        res.json({ photo: user.profilePhoto || null });
    } catch (e) {
        console.error('Errore lettura foto profilo:', e);
        res.status(404).json({ error: 'Utente non trovato' });
    }
});

// Aggiorna profilo utente (es. goal, localExpert, bio, interessi...) - SOLO il proprio profilo
// fotoProfiloLimiter: scatta SOLO quando il body tocca profilePhoto (vedi il commento sul
// limiter) - la rotta serve OGNI campo del profilo, non solo la foto.
router.put('/users/:id', requireAuth, fotoProfiloLimiter, async (req, res) => {
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

        // ALTO, follow-up revisione sicurezza (30ª): prima si controllava solo la LUNGHEZZA
        // della stringa, mai i byte veri - stesso buco gia' chiuso su Squad.photo
        // (MEDIO-2/MEDIO-3 residuo). Il client ora comprime sempre in JPEG (profile.js), quindi
        // qui si valida solo quel formato - lib/profilePhoto.js, condivisa con la registrazione.
        // !== undefined/null, non un truthy check (giro agente, BASSO): null resta la
        // richiesta esplicita di RIMOZIONE (btnRemovePhoto in profile.js) e deve continuare a
        // passare senza validazione; una stringa vuota invece andrebbe rifiutata, non scivolare
        // silenziosamente nel documento.
        if (update.profilePhoto !== undefined && update.profilePhoto !== null) {
            const v = validaFotoProfiloJpeg(update.profilePhoto);
            if (!v.ok) return res.status(400).json({ error: v.errore });
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

        // .select('+profilePhoto') (MEDIO, follow-up revisione sicurezza) SOLO quando il
        // salvataggio tocca davvero la foto: findByIdAndUpdate rispetta la proiezione anche
        // sul documento "new" restituito (a differenza di doc.save(), dove un valore assegnato
        // a mano sopravvive comunque - vedi la trappola gia' pagata su Squad.photo), quindi
        // senza questo "if" ogni PUT (anche una sola bio) tornerebbe a pesare fino a ~800 KB -
        // riaprirebbe su questa rotta la stessa asimmetria RAM appena chiusa su GET /api/users
        // (rilievo M-1 del giro agente sul fix MEDIO; questa rotta ha solo apiLimiter quando
        // non tocca la foto, fotoProfiloLimiter scatta solo se la tocca). Il proprietario che
        // rilegge il proprio profilo appena salvato non e' un rischio RAM/privacy in se':
        // e' l'incondizionalita' del select a esserlo.
        const query = User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (update.profilePhoto !== undefined) query.select('+profilePhoto');
        const user = await query;
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
