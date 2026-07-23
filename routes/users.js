const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Router montato direttamente su /api (non /api/users) perche' /api/login
// e' storicamente un percorso "fratello", non annidato sotto /users.

// Login simulato (ritorna l'utente) - verra' sostituito da autenticazione reale nella Fase C
router.post('/login', async (req, res) => {
    try {
        const users = await User.find();
        const username = String(req.body.username || '');
        let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

        if (!user) {
            user = await User.create({ username });
        }
        res.json(user);
    } catch (e) {
        console.error('Errore login:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Ottieni tutti gli utenti
router.get('/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
});

// Ottieni dettagli utente
router.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'Utente non trovato' });
        }
    } catch (e) {
        res.status(404).json({ error: 'Utente non trovato' });
    }
});

// Aggiorna profilo utente (es. KYC, goal, localExpert)
router.put('/users/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'Utente non trovato' });
        }
    } catch (e) {
        res.status(404).json({ error: 'Utente non trovato' });
    }
});

module.exports = router;
