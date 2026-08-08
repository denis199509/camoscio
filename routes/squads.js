const express = require('express');
const router = express.Router();
const Squad = require('../models/Squad');
const SquadMessage = require('../models/SquadMessage');
const { requireAuth } = require('../middleware/auth');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;
const MAX_MESSAGES = 50;

// Punto 48: il creatore e' admin per calcolo (creatorId), mai duplicato dentro admins[].
function isSquadAdmin(squad, userId) {
    return squad.creatorId.equals(userId) || squad.admins.some(a => a.equals(userId));
}

function isSquadMember(squad, userId) {
    return squad.creatorId.equals(userId) || squad.members.some(m => m.equals(userId));
}

// Ottieni squadre ricorrenti
router.get('/', requireAuth, async (req, res) => {
    const squads = await Squad.find();
    res.json(squads);
});

// Crea squadra - il creatore e' sempre chi ha fatto login
router.post('/', requireAuth, async (req, res) => {
    try {
        // Whitelist esplicita invece di spargere req.body per intero: da quando esistono
        // admins/photo (punto 48), spargerlo avrebbe permesso di auto-assegnarsi admin o
        // di piazzare una foto fuori dal tetto MAX_PHOTO_LENGTH gia' in fase di creazione.
        const squad = await Squad.create({
            name: req.body.name,
            members: req.body.members,
            creatorId: req.session.userId
        });
        res.json(squad);
    } catch (e) {
        console.error('Errore creazione squadra:', e);
        res.status(400).json({ error: 'Impossibile creare la squadra' });
    }
});

// Cambia la foto della squadra - solo amministratori (punto 48)
router.put('/:id/photo', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può cambiare la foto' });
        }
        const { photo } = req.body;
        if (photo && String(photo).length > MAX_PHOTO_LENGTH) {
            return res.status(400).json({ error: 'Foto troppo grande, scegline una più piccola' });
        }
        squad.photo = photo || null;
        await squad.save();
        res.json(squad);
    } catch (e) {
        console.error('Errore cambio foto squadra:', e);
        res.status(400).json({ error: 'Impossibile cambiare la foto della squadra' });
    }
});

// Promuovi un membro ad amministratore - solo amministratori (punto 48)
router.post('/:id/admins/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può promuovere altri membri' });
        }
        const targetId = req.params.userId;
        if (!isSquadMember(squad, targetId)) {
            return res.status(400).json({ error: 'Solo un membro della squadra può diventare amministratore' });
        }
        if (!squad.admins.some(a => a.equals(targetId))) {
            squad.admins.push(targetId);
            await squad.save();
        }
        res.json(squad);
    } catch (e) {
        console.error('Errore promozione admin squadra:', e);
        res.status(400).json({ error: 'Impossibile promuovere il membro' });
    }
});

// Togli lo stato di amministratore a un membro - solo amministratori, mai al creatore
// (punto 48; simmetrico alla promozione, non richiesto esplicitamente ma a rischio nullo)
router.delete('/:id/admins/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può rimuovere altri amministratori' });
        }
        const targetId = req.params.userId;
        if (squad.creatorId.equals(targetId)) {
            return res.status(400).json({ error: 'Chi ha creato la squadra è sempre amministratore' });
        }
        squad.admins = squad.admins.filter(a => !a.equals(targetId));
        await squad.save();
        res.json(squad);
    } catch (e) {
        console.error('Errore rimozione admin squadra:', e);
        res.status(400).json({ error: "Impossibile rimuovere l'amministratore" });
    }
});

// Ultimi messaggi della chat di squadra - solo membri (punto 48)
router.get('/:id/messages', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadMember(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo i membri della squadra possono vedere questa chat' });
        }
        const messages = await SquadMessage.find({ squadId: squad._id })
            .sort({ createdAt: -1 })
            .limit(MAX_MESSAGES);
        res.json(messages.reverse());
    } catch (e) {
        console.error('Errore lettura messaggi squadra:', e);
        res.status(400).json({ error: 'Impossibile leggere i messaggi' });
    }
});

// Invia un messaggio nella chat di squadra - solo membri (punto 48)
router.post('/:id/messages', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadMember(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo i membri della squadra possono scrivere in questa chat' });
        }
        const text = String(req.body.text || '').trim();
        if (!text) {
            return res.status(400).json({ error: 'Il messaggio non può essere vuoto' });
        }
        if (text.length > 1000) {
            return res.status(400).json({ error: 'Messaggio troppo lungo (massimo 1000 caratteri)' });
        }
        const message = await SquadMessage.create({
            squadId: squad._id,
            senderId: req.session.userId,
            text
        });
        res.json(message);
    } catch (e) {
        console.error('Errore invio messaggio squadra:', e);
        res.status(400).json({ error: 'Impossibile inviare il messaggio' });
    }
});

module.exports = router;
