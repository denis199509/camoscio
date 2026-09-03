const express = require('express');
const router = express.Router();
const Squad = require('../models/Squad');
const SquadMessage = require('../models/SquadMessage');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { nomeVisibile } = require('../lib/accountDeletion'); // A-3.4: nome pseudonimizzato per gli account eliminati
// Punto 48: il creatore e' admin/membro per calcolo (creatorId), mai duplicato dentro
// admins[]/members[]. Estratti in lib/squad.js perche' ora li usa anche routes/hikes.js
// (invito squadra direzionale) - una definizione sola.
const { isSquadMember, isSquadAdmin } = require('../lib/squad');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;
const MAX_MESSAGES = 50;

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

// Punto 75: chiedere di entrare in una squadra gia' esistente - chiunque sia loggato e non
// sia gia' membro. Idempotente: rifarla non duplica nulla in pendingRequests ne' manda una
// seconda notifica agli admin.
router.post('/:id/request-join', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        const userId = req.session.userId;
        if (isSquadMember(squad, userId)) {
            return res.status(400).json({ error: 'Fai già parte di questa squadra' });
        }
        if (squad.pendingRequests.some(p => p.equals(userId))) {
            return res.status(409).json({ error: 'Hai già una richiesta in attesa per questa squadra' });
        }
        squad.pendingRequests.push(userId);
        await squad.save();

        const richiedente = await User.findById(userId).select('username pendingDeletionAt deletedAt');
        // Tutti gli amministratori, creatore compreso ("richiesta inviata all'admin, a tutti
        // gli admin se più di uno", parole di Denis) - stesso schema di notifica a più
        // persone già in uso in routes/hikes.js per l'invito automatico di una squadra.
        const destinatari = [squad.creatorId, ...squad.admins];
        for (const adminId of destinatari) {
            await Notification.create({
                userId: adminId,
                text: `${nomeVisibile(richiedente) || 'Qualcuno'} ha chiesto di entrare nella squadra "${squad.name}"`,
                read: false
            });
        }

        res.json(squad);
    } catch (e) {
        console.error('Errore richiesta di partecipazione squadra:', e);
        res.status(400).json({ error: 'Impossibile inviare la richiesta' });
    }
});

// Approva una richiesta - un amministratore qualunque basta. Aggiornamento atomico ($pull +
// $addToSet in un solo giro, non una lettura-e-riscrittura) cosi' due admin che approvano
// quasi insieme non si pestano i piedi: il controllo sopra intercetta il secondo prima, e
// anche se non lo intercettasse l'operazione atomica non produrrebbe comunque un doppione
// ($addToSet) ne' un errore.
router.post('/:id/approve/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può approvare le richieste' });
        }
        const targetId = req.params.userId;
        if (!squad.pendingRequests.some(p => p.equals(targetId))) {
            return res.status(409).json({ error: 'Questa richiesta non è più in attesa (forse già gestita da un altro amministratore)' });
        }
        const aggiornata = await Squad.findByIdAndUpdate(
            req.params.id,
            { $pull: { pendingRequests: targetId }, $addToSet: { members: targetId } },
            { new: true }
        );
        await Notification.create({
            userId: targetId,
            text: `La tua richiesta per entrare in "${squad.name}" è stata accettata!`,
            read: false
        });
        res.json(aggiornata);
    } catch (e) {
        console.error('Errore approvazione richiesta squadra:', e);
        res.status(400).json({ error: 'Impossibile approvare la richiesta' });
    }
});

// Rifiuta una richiesta - simmetrico all'approvazione (non chiesto esplicitamente, ma senza
// non ci sarebbe alcun modo di togliere una richiesta indesiderata: resterebbe in coda per
// sempre). Mai un blocco permanente: chi viene rifiutato puo' rimandare la richiesta.
router.delete('/:id/pending/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) {
            return res.status(404).json({ error: 'Squadra non trovata' });
        }
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può rifiutare le richieste' });
        }
        const targetId = req.params.userId;
        if (!squad.pendingRequests.some(p => p.equals(targetId))) {
            return res.status(409).json({ error: 'Questa richiesta non è più in attesa (forse già gestita da un altro amministratore)' });
        }
        const aggiornata = await Squad.findByIdAndUpdate(
            req.params.id,
            { $pull: { pendingRequests: targetId } },
            { new: true }
        );
        await Notification.create({
            userId: targetId,
            text: `La tua richiesta per entrare in "${squad.name}" non è stata accettata.`,
            read: false
        });
        res.json(aggiornata);
    } catch (e) {
        console.error('Errore rifiuto richiesta squadra:', e);
        res.status(400).json({ error: 'Impossibile rifiutare la richiesta' });
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
