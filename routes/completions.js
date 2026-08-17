const express = require('express');
const router = express.Router();
const Completion = require('../models/Completion');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { mongoose } = require('../db/mongo');
const { haversineKm } = require('../lib/geometry');
const { movimentoSecAttendibile } = require('../lib/gpx');
const { calcolaDaPercorso } = require('../lib/percorso');
const { recalculateAndApplyPace } = require('../lib/hikeStats');

// Ottieni le escursioni già segnate come completate da un utente
router.get('/:userId', requireAuth, async (req, res) => {
    try {
        const userCompletions = await Completion.find({ userId: req.params.userId });
        res.json(userCompletions);
    } catch (e) {
        res.json([]);
    }
});

// Punto 80/A: aggiunge un .gpx a un'escursione GIÀ segnata come completata, per avere il
// tempo reale (e il tempo di solo cammino, punto 79) invece di quello scritto a mano o
// assente - "i numeri reali sostituiscono quelli scritti a mano", stessa regola già
// applicata al punto 67. A differenza di /:id/complete-group (routes/hikes.js), che usa lo
// stesso .gpx anche per correggere distanza/dislivello CONDIVISI dell'escursione, qui il
// file riguarda SOLO il proprio Completion: gli altri partecipanti non ne sanno nulla, e i
// dati dell'escursione (comuni a tutti) restano quelli di chi l'ha organizzata.
router.post('/:id/gpx', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const completion = await Completion.findById(req.params.id);
        if (!completion) {
            return res.status(404).json({ error: 'Questo completamento non esiste.' });
        }
        // Il confronto è con req.session.userId, MAI con un id mandato dal client - stessa
        // regola di ogni altra rotta del progetto (vedi routes/tracking.js).
        if (String(completion.userId) !== String(req.session.userId)) {
            return res.status(403).json({ error: 'Puoi aggiungere un file solo alle tue escursioni completate.' });
        }

        let datiReali;
        try {
            datiReali = await calcolaDaPercorso({ kind: 'gpx', gpxText: req.body && req.body.gpxText }, req.session.userId);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }

        const letto = datiReali.gpxLetto;
        // A differenza di complete-group (dove distanza/dislivello restano comunque utili
        // anche senza orari), questa rotta esiste solo per il tempo: senza orari non c'è
        // nulla da scrivere, meglio dirlo chiaro che "riuscire" senza cambiare niente.
        if (letto.durataIgnota || !letto.inizio || !letto.fine) {
            return res.status(400).json({ error: 'Questo file non contiene gli orari dei punti: senza orari non c\'è nessun tempo da ricavare.' });
        }

        const ore = (letto.fine.getTime() - letto.inizio.getTime()) / 3600000;
        if (!(ore > 0)) {
            return res.status(400).json({ error: 'Gli orari di questo file non hanno una durata valida.' });
        }
        const actualTimeHours = ore;

        // Punto 79: separa cammino e pause SOLO se la traccia è abbastanza fitta da
        // fidarsene. Quando non lo è, il tempo totale resta comunque valido (viene da
        // inizio/fine, non dalla separazione) - si scrive quello e si avvisa, invece di
        // rifiutare un file che una risposta parziale la darebbe comunque.
        let movingTimeHours = null;
        const avvisi = [...(letto.avvisi || [])];
        const movimento = movimentoSecAttendibile(letto.punti, haversineKm);
        if (movimento.sec) {
            movingTimeHours = movimento.sec / 3600;
        } else {
            avvisi.push(...movimento.motivi);
        }

        // Questa traccia sostituisce per intero il tempo di questo completamento: i due
        // campi devono sempre venire dallo STESSO file, mai un tempo di cammino di una
        // traccia precedente mescolato al tempo totale di questa - il conto delle pause
        // (actualTimeHours - movingTimeHours, public/js/social.js) mentirebbe altrimenti.
        // $unset invece di assegnare "undefined" e salvare: inequivocabile, non dipende da
        // come Mongoose tratta un campo assegnato a undefined.
        const mongoUpdate = movingTimeHours
            ? { $set: { actualTimeHours, movingTimeHours } }
            : { $set: { actualTimeHours }, $unset: { movingTimeHours: '' } };
        await Completion.updateOne({ _id: completion._id }, mongoUpdate);

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        // Punto 80/A: passo ricostruito da zero sulle osservazioni oggi presenti (mai in
        // modo incrementale - lib/hikeStats.js) - questa rotta cambia le osservazioni
        // disponibili per QUESTO completamento, quindi il passo va sempre riallineato,
        // anche quando non resta nessuna osservazione valida (in quel caso applyPersonalPace
        // toglie il campo: "non misurato", non 350).
        await recalculateAndApplyPace(user);

        const completionAggiornato = await Completion.findById(completion._id);
        res.json({ completion: completionAggiornato, user, avvisi });
    } catch (e) {
        console.error('Errore aggiunta gpx al completamento:', e);
        res.status(400).json({ error: 'Impossibile aggiungere il file a questa escursione.' });
    }
});

// Punto 80/A: cancella un'escursione dalla lista "Già fatte" - stesso principio del
// cestino già esistente per le uscite registrate (routes/tracking.js, punto 15): i badge
// già conquistati NON vengono revocati (non è registrato PERCHÉ un timbro è stato preso,
// potrebbe venire da questa escursione o da un'altra - revocarlo rischierebbe di togliere
// un badge vero, l'errore peggiore fra i due).
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const completion = await Completion.findById(req.params.id);
        if (!completion) {
            return res.status(404).json({ error: 'Questo completamento non esiste (forse è già stato cancellato).' });
        }
        if (String(completion.userId) !== String(req.session.userId)) {
            return res.status(403).json({ error: 'Puoi cancellare solo le tue escursioni completate.' });
        }

        await Completion.deleteOne({ _id: completion._id });

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        user.completedHikes = Math.max(0, (user.completedHikes || 0) - 1);

        // Passo ricostruito da zero SENZA questo completamento - se era l'unica prova sul
        // passo personale il campo sparisce (dal 16/08/2026 non torna piu' al default 350/
        // 500, che era anch'esso un numero senza niente dietro): un valore ormai orfano di
        // qualunque osservazione mentirebbe sia restando fermo dov'era sia tornando a un
        // default (vedi applyPersonalPace in lib/hikeStats.js).
        await recalculateAndApplyPace(user);

        res.json({ success: true, user });
    } catch (e) {
        console.error('Errore cancellazione completamento:', e);
        res.status(400).json({ error: 'Impossibile cancellare questa escursione.' });
    }
});

module.exports = router;
