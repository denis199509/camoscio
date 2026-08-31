const express = require('express');
const router = express.Router();
const Completion = require('../models/Completion');
const User = require('../models/User');
const Hike = require('../models/Hike'); // punto 115: nome di default della traccia = titolo dell'escursione
const ActiveHikeSession = require('../models/ActiveHikeSession'); // punto 113 fix: la traccia diventa una sessione collegata all'escursione
const { requireAuth } = require('../middleware/auth');
const { mongoose } = require('../db/mongo');
const { haversineKm, simplifyTrack } = require('../lib/geometry');
const { movimentoSecAttendibile } = require('../lib/gpx');
const { calcolaDaPercorso } = require('../lib/percorso');
const { recalculateAndApplyPace } = require('../lib/hikeStats');
const { assegnaTimbriDallaTraccia } = require('../lib/geofenceTimbri'); // coda punto 113: il ⬆ assegna i badge di vetta come /import-gpx

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

        // Punto 114: il tasto ⬆ accetta ora anche un .fit (mandato in base64 nel campo
        // `fit`). calcolaDaPercorso normalizza gpx e fit alla stessa forma, tutto il
        // resto di questa rotta non cambia.
        const routeSource = (req.body && typeof req.body.fit === 'string' && req.body.fit.trim())
            ? { kind: 'fit', fitBase64: req.body.fit }
            : { kind: 'gpx', gpxText: req.body && req.body.gpxText };

        let datiReali;
        try {
            datiReali = await calcolaDaPercorso(routeSource, req.session.userId);
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

        // Punto 113 (fix 30/08/2026): oltre agli orari, si salva anche la TRACCIA come
        // ActiveHikeSession collegata all'escursione (hikeId impostato). Cosi' l'escursione
        // completata diventa pubblicabile nel feed - prima serviva averla registrata dal
        // vivo, e chi aveva aggiunto il .gpx qui vedeva "serve una traccia" pur avendolo
        // caricato. La sessione ha hikeId != null quindi NON conta nel tetto mensile delle
        // importazioni (quello e' per le uscite a se', vedi routes/tracking.js /import-gpx).
        // Non blocca: se questo fallisce, gli orari sono comunque stati aggiornati.
        try {
            const puntiSemplificati = simplifyTrack(letto.punti, 8); // ~8 m, come /import-gpx e fine tracciamento
            const campiTraccia = {
                status: 'ended',
                startedAt: letto.inizio,
                endedAt: letto.fine,
                lastPointAt: letto.fine,
                distanceKm: datiReali.distanceKm,
                elevationGainM: datiReali.elevationGain,
                points: puntiSemplificati,
                importedFrom: 'gpx'
                // importedName gestito a parte qui sotto (punto 115): la creazione e il
                // ricaricamento hanno regole diverse.
            };
            // Punto 115: nome dell'uscita. Il <name> del file quando c'e'; il .fit non ne
            // ha uno, allora si ripiega sul TITOLO dell'escursione, cosi' nel feed non
            // compare una data nuda al posto di "Ascesa al Corno Grande".
            const nomeFile = (letto.nome || '').slice(0, 120) || null;
            const hike = await Hike.findById(completion.hikeId).select('title').lean();
            const nomeDefault = nomeFile || ((hike && hike.title) ? hike.title.slice(0, 120) : null);

            const esistente = await ActiveHikeSession.findOne({ userId: completion.userId, hikeId: completion.hikeId });
            if (!esistente) {
                // openSession NON impostato: la traccia e' gia' conclusa (stesso motivo di /import-gpx).
                await ActiveHikeSession.create({
                    userId: completion.userId,
                    hikeId: completion.hikeId,
                    ...campiTraccia,
                    ...(nomeDefault ? { importedName: nomeDefault } : {}),
                    ...(movimento.sec ? { movingTimeSec: movimento.sec } : {})
                });
            } else if (esistente.importedFrom === 'gpx') {
                // Ricaricamento: si sostituisce geometria/misure, si lasciano stare
                // publishedAt/caption (e' la stessa uscita, traccia aggiornata).
                const set = { ...campiTraccia };
                const unset = {};
                if (movimento.sec) set.movingTimeSec = movimento.sec; else unset.movingTimeSec = '';
                // Il nome: se il nuovo file ne porta uno, quello vince (l'utente sta
                // ricaricando quella traccia). Se non ne porta (es. .fit) NON si tocca:
                // un nome messo a mano con la matita (punto 115) o quello vecchio restano.
                // Solo se non c'era proprio niente si mette il titolo dell'escursione.
                if (nomeFile) set.importedName = nomeFile;
                else if (!esistente.importedName && hike && hike.title) set.importedName = hike.title.slice(0, 120);
                const upd = { $set: set };
                if (Object.keys(unset).length) upd.$unset = unset;
                await ActiveHikeSession.updateOne({ _id: esistente._id }, upd);
            }
            // Se esiste ma NON e' importedFrom:'gpx' (registrata dal vivo): non si tocca -
            // i suoi dati sono migliori di un file caricato dopo, e l'escursione e' gia'
            // pubblicabile.
        } catch (e) {
            console.error('Traccia non salvata come sessione (gli orari sono comunque stati aggiornati):', e);
        }

        // Coda punto 113 (2026-08-31): come /import-gpx, la traccia caricata col ⬆ assegna i
        // badge di vetta se e' passata entro SOGLIA_TIMBRO_M da un punto del catalogo. Si
        // guardano i punti COMPLETI (letto.punti), non quelli semplificati - su una vetta
        // contano i metri. Indipendente dal ramo qui sopra: il badge e' dovuto anche se la
        // sessione collegata era gia' registrata dal vivo e non si e' toccata.
        // assegnaTimbriDallaTraccia non solleva mai; il try qui e' solo cintura in piu'.
        let timbri = [];
        try {
            timbri = await assegnaTimbriDallaTraccia(completion.userId, letto.punti, letto.inizio);
        } catch (e) {
            console.error('Assegnazione badge dal .gpx del completamento fallita (il tempo e\' comunque salvato):', e);
        }

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
        res.json({ completion: completionAggiornato, user, avvisi, badge: timbri });
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
