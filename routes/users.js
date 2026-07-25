const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Squad = require('../models/Squad');
const { requireAuth } = require('../middleware/auth');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;

// Router montato direttamente su /api (non /api/users): storicamente /api/login
// era un percorso "fratello", non annidato sotto /users (login vero e proprio e'
// comunque su /api/auth/login dalla Fase C, questo resta solo per i campi utente).

// Campi mai visibili a nessuno tranne il proprietario del profilo. Nome/cognome inclusi
// perche' esistono solo per identificazione reale (es. contatti di emergenza) e non devono
// mai essere mostrati al posto dello username (vedi leggimi.txt) - mancavano qui (bug trovato
// in Fase H), quindi trapelavano a chiunque tramite GET /api/users.
const ALWAYS_PRIVATE_FIELDS = ['email', 'emergencyContacts', 'birthDate', 'ageRange', 'geolocationConsent', 'termsAcceptedAt', 'nome', 'cognome'];
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
    'kycVerified', 'hikingLevel', 'interests', 'preferredDifficulty', 'geoPreferences',
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

// Aggiorna profilo utente (es. KYC, goal, localExpert, bio, interessi...) - SOLO il proprio profilo
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
