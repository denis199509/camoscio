// PUNTO 13 - Progettazione di un percorso su piu' punti, seguendo i sentieri conosciuti.
//
// La ricerca vera sta in lib/trailGraph.js: qui c'e' solo il contorno, cioe' controllare
// che la richiesta abbia senso prima di far lavorare il server.
//
// COSA NON FA QUESTA ROTTA, di proposito: non rifiuta MAI un percorso perche' i sentieri
// non bastano. E' la decisione presa dall'utente il 2026-07-27 - dove un percorso sui
// sentieri non esiste si tira una retta ben dichiarata, e il percorso si completa sempre.
// Il campo "tipo" di ogni tappa ('sentiero' oppure 'retta') e' cio' che permette
// all'interfaccia di segnalare i tratti in linea d'aria, che e' la meta' della richiesta.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { isFiniteNum, simplifyTrack } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');
const { progettaPercorso } = require('../lib/trailGraph');
const RouteDraft = require('../models/RouteDraft');
const SavedRoute = require('../models/SavedRoute'); // punto 113, passo 8: percorso copiato da una traccia
const User = require('../models/User');
const { guardiaUscitaVisibile } = require('../lib/uscitaVisibile'); // punto 113: guardia autore-o-follower
const { nomeVisibile } = require('../lib/accountDeletion'); // A-3.4: nome pseudonimizzato per gli account eliminati
const { mongoose } = require('../db/mongo');
// Punto 116: SEMPLIFICA_PERCORSO_M / MAX_PUNTI_PERCORSO vivono in lib/percorso.js (le usa
// anche il ramo .gpx/.fit della creazione escursione) - una definizione sola, importata qui.
const { SEMPLIFICA_PERCORSO_M, MAX_PUNTI_PERCORSO } = require('../lib/percorso');

// Campione per il controllo delle quattro regioni su una traccia: mirror di CAMPIONE_REGIONE
// in routes/tracking.js (una traccia di crinale entra ed esce dai confini, si guarda la
// maggioranza di un campione invece del solo primo punto). Costante di tuning, non logica -
// come MAX_PUNTI, gia' duplicato fra questo file e public/js/routeplanner.js.
const CAMPIONE_REGIONE = 40;

// Un progetto di escursione ha una manciata di tappe. Il tetto non serve contro l'utente
// ma contro una richiesta costruita apposta: ogni tappa e' una ricerca su un grafo.
const MAX_PUNTI = 25;

router.post('/plan', requireAuth, async (req, res) => {
    try {
        const punti = req.body && req.body.punti;
        if (!Array.isArray(punti) || punti.length < 2) {
            return res.status(400).json({ error: 'Servono almeno due punti per progettare un percorso.' });
        }
        if (punti.length > MAX_PUNTI) {
            return res.status(400).json({ error: `Troppi punti: il massimo e' ${MAX_PUNTI}.` });
        }

        for (const p of punti) {
            if (!Array.isArray(p) || p.length < 2 || !isFiniteNum(p[0]) || !isFiniteNum(p[1])) {
                return res.status(400).json({ error: 'Uno dei punti non ha coordinate valide.' });
            }
            if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) {
                return res.status(400).json({ error: 'Uno dei punti ha coordinate fuori dal mondo.' });
            }
        }

        // Vincolo delle quattro regioni, come per la creazione di un'escursione.
        // Qui si pretende che TUTTI i punti siano dentro, non la maggioranza come per un
        // file .gpx importato: li' la traccia e' un dato registrato che puo' sconfinare da
        // solo su un crinale, qui ogni punto lo sceglie una persona apposta.
        const fuori = punti.findIndex(p => !regionForPoint(p[0], p[1]));
        if (fuori >= 0) {
            return res.status(400).json({
                error: `Il punto numero ${fuori + 1} e' fuori dalle quattro regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise).`
            });
        }

        const esito = await progettaPercorso(punti, {
            agganciaAiSentieri: req.body.agganciaAiSentieri !== false
        });

        res.json(esito);
    } catch (e) {
        console.error('Progettazione percorso fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile calcolare il percorso. Riprova.' });
    }
});

// --- BOZZE: un percorso progettato e messo da parte (decisione 2 dell'utente) ---
//
// Personali e basta: si vedono, si aprono e si cancellano solo le proprie. Il confronto e'
// sempre con req.session.userId, mai con un id mandato dal client - la regola presa in
// Fase C per tutte le rotte del progetto.

const MAX_BOZZE = 50; // un tetto, non un razionamento: una bozza pesa pochissimo

router.get('/drafts', requireAuth, async (req, res) => {
    try {
        const bozze = await RouteDraft.find({ userId: req.session.userId }).sort({ creataIl: -1 }).limit(MAX_BOZZE);
        res.json(bozze);
    } catch (e) {
        console.error('Lettura bozze percorso fallita:', e);
        res.status(500).json({ error: 'Impossibile caricare i percorsi salvati.' });
    }
});

router.post('/drafts', requireAuth, async (req, res) => {
    try {
        const nome = String((req.body && req.body.nome) || '').trim().slice(0, 80);
        const punti = req.body && req.body.punti;
        // PUNTO 38 - si riceve l'INTENZIONE ("torna al punto 1"), non il ritorno gia' scritto
        // come punto in piu': i punti salvati devono restare quelli che l'utente ha toccato.
        const anello = !!(req.body && req.body.anello === true);
        if (!nome) return res.status(400).json({ error: 'Dai un nome al percorso.' });
        // Il tetto vale sulle tappe DA PERCORRERE, quindi con l'anello il ritorno ne occupa
        // una: e' lo stesso conto che fa /plan, dove l'array arriva gia' chiuso.
        if (!Array.isArray(punti) || punti.length < 2 || punti.length + (anello ? 1 : 0) > MAX_PUNTI) {
            return res.status(400).json({
                error: anello
                    ? `Con il ritorno alla partenza il percorso puo' avere al massimo ${MAX_PUNTI - 1} tappe.`
                    : 'Il percorso deve avere fra due e ' + MAX_PUNTI + ' punti.'
            });
        }
        for (const p of punti) {
            if (!Array.isArray(p) || !isFiniteNum(p[0]) || !isFiniteNum(p[1]) || !regionForPoint(p[0], p[1])) {
                return res.status(400).json({ error: 'Uno dei punti non e\' valido o e\' fuori dalle quattro regioni.' });
            }
        }
        if (await RouteDraft.countDocuments({ userId: req.session.userId }) >= MAX_BOZZE) {
            return res.status(429).json({ error: `Hai gia' ${MAX_BOZZE} percorsi salvati: cancellane uno per farne spazio.` });
        }

        // I totali si calcolano QUI e non si prendono dal client: un numero mandato dal
        // browser non e' un dato, e' un'affermazione. Stesso criterio gia' usato per
        // distanza e dislivello del tracciamento (Fase F).
        // I totali si calcolano sul percorso CHIUSO quando e' un anello, altrimenti l'elenco
        // dei progetti mostrerebbe la meta' dei chilometri veri - cioe' proprio la bugia che
        // il punto 38 e' venuto a togliere.
        const esito = await progettaPercorso(
            anello ? [...punti, punti[0]] : punti,
            { agganciaAiSentieri: req.body.agganciaAiSentieri !== false }
        );

        const bozza = await RouteDraft.create({
            userId: req.session.userId,
            nome,
            punti,
            // Scritto solo quando e' vero: e' un campo con default undefined (vincolo spazio).
            ...(anello ? { anello: true } : {}),
            agganciaAiSentieri: req.body.agganciaAiSentieri !== false,
            metriTotali: esito.metriTotali,
            metriRetta: esito.metriRetta,
            // Scritti solo se le quote sono davvero arrivate (punto 33): se la fonte non ha
            // risposto i campi restano assenti, che vuol dire "non si sa" - e riaprendo la
            // bozza il dislivello si ricalcola comunque da capo, quindi non si perde niente.
            ...(esito.dislivelloDisponibile ? { salitaM: esito.salitaM, discesaM: esito.discesaM } : {})
        });
        res.json(bozza);
    } catch (e) {
        console.error('Salvataggio bozza percorso fallito:', e);
        res.status(500).json({ error: 'Non e\' stato possibile salvare il percorso.' });
    }
});

router.delete('/drafts/:id', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const esito = await RouteDraft.deleteOne({ _id: req.params.id, userId: req.session.userId });
        if (!esito.deletedCount) {
            // Stessa risposta sia se non esiste sia se e' di un altro: non c'e' motivo di
            // far sapere a nessuno che una bozza altrui esiste.
            return res.status(404).json({ error: 'Questo percorso non esiste.' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('Cancellazione bozza percorso fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile cancellare il percorso.' });
    }
});

// --- PUNTO 113, passo 8: percorsi COPIATI dalla traccia di un'uscita ("Crea percorso") ---
//
// Personali come le bozze: si vedono/aprono/cancellano solo i propri, sempre
// req.session.userId. LA DIFFERENZA con /drafts: qui si persiste la polyline vera (copiata
// dalla traccia dell'uscita), non i punti scelti - vedi models/SavedRoute.js per il perche'
// e per la disciplina di spazio.

const MAX_PERCORSI_SALVATI = 50;    // specchio di MAX_BOZZE
// MAX_PUNTI_PERCORSO / SEMPLIFICA_PERCORSO_M: importati da lib/percorso.js (vedi in cima) -
// li usa anche la creazione escursione col ramo .gpx/.fit (punto 116).

router.get('/saved-routes', requireAuth, async (req, res) => {
    try {
        const percorsi = await SavedRoute.find({ userId: req.session.userId })
            .sort({ creatoIl: -1 }).limit(MAX_PERCORSI_SALVATI);
        res.json(percorsi);
    } catch (e) {
        console.error('Lettura percorsi salvati fallita:', e);
        res.status(500).json({ error: 'Impossibile caricare i percorsi salvati.' });
    }
});

router.post('/saved-routes', requireAuth, async (req, res) => {
    try {
        const nome = String((req.body && req.body.nome) || '').trim().slice(0, 80);
        const sessionId = req.body && req.body.sessionId;
        if (!nome) return res.status(400).json({ error: 'Dai un nome al percorso.' });

        // Stessa guardia di GET /sessions/:id/meta|points: l'autore sempre, gli altri solo se
        // seguono un'uscita pubblicata. E' la protezione server-side che la decisione 6 di
        // Denis richiede - non ci si copia la traccia di chi non si potrebbe nemmeno vedere.
        const g = await guardiaUscitaVisibile(
            sessionId, req.session.userId,
            'userId publishedAt points distanceKm elevationGainM importedName startedAt'
        );
        if (g.errore) return res.status(g.errore.status).json(g.errore.body);
        const sessione = g.sessione;

        const grezzi = Array.isArray(sessione.points) ? sessione.points : [];
        if (grezzi.length < 2) {
            return res.status(400).json({ error: 'Questa uscita non ha una traccia da cui creare un percorso.' });
        }

        // Vincolo delle quattro regioni col campione-e-maggioranza gia' usato per i .gpx
        // importati (routes/tracking.js): una traccia di crinale entra ed esce dai confini,
        // bocciarla per un punto singolo sarebbe un rifiuto a caso.
        const passo = Math.max(1, Math.floor(grezzi.length / CAMPIONE_REGIONE));
        let dentro = 0, esaminati = 0;
        for (let i = 0; i < grezzi.length; i += passo) {
            esaminati++;
            if (regionForPoint(grezzi[i][0], grezzi[i][1])) dentro++;
        }
        if (dentro * 2 <= esaminati) {
            return res.status(400).json({ error: 'Questa traccia si svolge fuori dalle quattro regioni coperte dal sito.' });
        }

        if (await SavedRoute.countDocuments({ userId: req.session.userId }) >= MAX_PERCORSI_SALVATI) {
            return res.status(429).json({ error: `Hai gia' ${MAX_PERCORSI_SALVATI} percorsi salvati: cancellane uno per farne spazio.` });
        }

        // Quota massima dai punti COMPLETI, prima di scartare la terza colonna: serve
        // all'elenco e (passo 9) al ramo "quote a mano" del punto 93 quando manca.
        let quotaMaxM;
        for (const p of grezzi) {
            if (typeof p[2] === 'number' && Number.isFinite(p[2])) {
                quotaMaxM = quotaMaxM === undefined ? p[2] : Math.max(quotaMaxM, p[2]);
            }
        }

        // Semplifica (~18 m), poi tieni solo [lng, lat]; se restano troppi punti, campiona
        // a passo fisso tenendo sempre l'ultimo.
        let punti = simplifyTrack(grezzi, SEMPLIFICA_PERCORSO_M).map(p => [p[0], p[1]]);
        if (punti.length > MAX_PUNTI_PERCORSO) {
            const q = Math.ceil(punti.length / MAX_PUNTI_PERCORSO);
            punti = punti.filter((_, i) => i % q === 0 || i === punti.length - 1);
        }
        if (punti.length < 2) {
            return res.status(400).json({ error: 'La traccia di questa uscita e\' troppo corta per un percorso.' });
        }

        const autore = sessione.userId ? await User.findById(sessione.userId).select('username pendingDeletionAt deletedAt') : null;
        // A-3.4: origineUsername viene COPIATO dentro la SavedRoute e da li' esce a ogni
        // GET /api/routing/saved-routes - nessuno scrub futuro lo toccherebbe. Se l'autore
        // della traccia e' un account eliminato, si salva "Account eliminato".
        const nomeAutore = nomeVisibile(autore);

        const percorso = await SavedRoute.create({
            userId: req.session.userId,
            nome,
            punti,
            ...(sessione.userId ? { origineUserId: sessione.userId } : {}),
            ...(nomeAutore ? { origineUsername: nomeAutore } : {}),
            ...(typeof sessione.distanceKm === 'number' ? { distanzaKm: sessione.distanceKm } : {}),
            ...(typeof sessione.elevationGainM === 'number' ? { dislivelloM: Math.round(sessione.elevationGainM) } : {}),
            ...(quotaMaxM !== undefined ? { quotaMaxM: Math.round(quotaMaxM) } : {})
        });
        res.json(percorso);
    } catch (e) {
        console.error('Creazione percorso da traccia fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile creare il percorso.' });
    }
});

router.delete('/saved-routes/:id', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const esito = await SavedRoute.deleteOne({ _id: req.params.id, userId: req.session.userId });
        if (!esito.deletedCount) {
            // Stessa risposta sia se non esiste sia se e' di un altro (come /drafts/:id).
            return res.status(404).json({ error: 'Questo percorso non esiste.' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('Cancellazione percorso salvato fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile cancellare il percorso.' });
    }
});

module.exports = router;
