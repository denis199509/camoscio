const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const router = express.Router();
const User = require('../models/User');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024; // ~1.5MB decodificati: "piccola immagine", non un file pesante

function calculateAge(birthDate) {
    const ms = Date.now() - new Date(birthDate).getTime();
    return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

// Registrazione utente reale (Fase C)
router.post('/register', async (req, res) => {
    try {
        const {
            nome, cognome, email, password, birthDate, ageRange, termsAccepted,
            username, hikingLevel, interests, preferredDifficulty,
            geoPreferences, bio, profilePhoto,
            emergencyContacts, geolocationConsent, privacySetting
        } = req.body;

        // --- 1. Dati base (obbligatori) ---
        if (!nome || !cognome || !email || !password || !username) {
            return res.status(400).json({ error: 'Nome, cognome, email, password e username sono obbligatori' });
        }
        if (!validator.isEmail(String(email))) {
            return res.status(400).json({ error: 'Email non valida' });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
        }
        if (!termsAccepted) {
            return res.status(400).json({ error: 'Devi accettare i Termini e la Privacy' });
        }
        if (!birthDate && !ageRange) {
            return res.status(400).json({ error: "Indica la data di nascita oppure una fascia d'età" });
        }
        if (birthDate && calculateAge(birthDate) < 18) {
            return res.status(400).json({ error: 'Devi avere almeno 18 anni per registrarti' });
        }

        // --- 7. Contatti di emergenza (obbligatorio, almeno 1) ---
        if (!Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
            return res.status(400).json({ error: 'Serve almeno un contatto di emergenza' });
        }
        for (const c of emergencyContacts) {
            if (!c || !c.name || !c.phone || !c.relationship) {
                return res.status(400).json({ error: 'Ogni contatto di emergenza richiede nome, telefono e relazione' });
            }
        }

        if (profilePhoto && String(profilePhoto).length > MAX_PHOTO_LENGTH) {
            return res.status(400).json({ error: 'Foto profilo troppo grande, scegline una più piccola' });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const normalizedUsername = String(username).trim();

        const emailTaken = await User.findOne({ email: normalizedEmail });
        if (emailTaken) {
            return res.status(409).json({ error: 'Email già registrata' });
        }
        const usernameTaken = await User.findOne({ username: normalizedUsername });
        if (usernameTaken) {
            return res.status(409).json({ error: 'Username già in uso' });
        }

        const passwordHash = await bcrypt.hash(String(password), 10);

        const user = await User.create({
            nome: String(nome).trim(),
            cognome: String(cognome).trim(),
            email: normalizedEmail,
            passwordHash,
            birthDate: birthDate || null,
            ageRange: birthDate ? null : ageRange,
            termsAcceptedAt: new Date(),
            username: normalizedUsername,
            hikingLevel: hikingLevel || null,
            interests: Array.isArray(interests) ? interests : [],
            preferredDifficulty: preferredDifficulty || null,
            geoPreferences: geoPreferences || {},
            bio: bio ? String(bio).slice(0, 250) : '',
            profilePhoto: profilePhoto || null,
            emergencyContacts,
            geolocationConsent: !!geolocationConsent,
            privacySetting: privacySetting || 'Pubblico',
            isDemoAccount: false
        });

        req.session.userId = user._id.toString();
        res.json(user);
    } catch (e) {
        console.error('Errore registrazione:', e);
        if (e.code === 11000) {
            return res.status(409).json({ error: 'Email o username già in uso' });
        }
        if (e.name === 'ValidationError') {
            return res.status(400).json({ error: e.message });
        }
        res.status(500).json({ error: 'Errore interno durante la registrazione' });
    }
});

// Login reale (email + password)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').toLowerCase().trim();

        const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Email o password non corretti' });
        }

        const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Email o password non corretti' });
        }

        req.session.userId = user._id.toString();
        res.json(user);
    } catch (e) {
        console.error('Errore login:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Elenco pubblico dei soli account demo (nessun login richiesto): usato dalla pagina /demo
// per disegnare i 4 pulsanti. Espone solo i campi innocui, mai email/contatti/ecc.
router.get('/demo-accounts', async (req, res) => {
    const demoUsers = await User.find({ isDemoAccount: true }).select('username avatar experienceLevel trainingGoal');
    res.json(demoUsers);
});

// Login demo: nessuna password, funziona SOLO per i 4 account storici isDemoAccount:true
router.post('/demo-login', async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.body.userId, isDemoAccount: true });
        if (!user) {
            return res.status(404).json({ error: 'Account demo non trovato' });
        }
        req.session.userId = user._id.toString();
        res.json(user);
    } catch (e) {
        res.status(400).json({ error: 'Richiesta non valida' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Errore durante il logout:', err);
            return res.status(500).json({ error: 'Errore durante il logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Chi sono (usato dal frontend all'avvio per sapere se c'e' gia' una sessione valida)
router.get('/me', async (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Non autenticato' });
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
        return req.session.destroy(() => res.status(401).json({ error: 'Non autenticato' }));
    }
    res.json(user);
});

module.exports = router;
