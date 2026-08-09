const express = require('express');
const router = express.Router();
const Hike = require('../models/Hike');
const User = require('../models/User');
const Squad = require('../models/Squad');
const Notification = require('../models/Notification');
const Completion = require('../models/Completion');
const HikeMessage = require('../models/HikeMessage'); // punto 55: chat tra partecipanti
const RouteDraft = require('../models/RouteDraft'); // punto 43: percorso da un progetto gia' fatto
const { applyHikeCompletionStats } = require('../lib/hikeStats'); // punto 64: condivisa con /:id/complete-group
const { requireAuth } = require('../middleware/auth');
const { regionForPoint } = require('../lib/regions');
const { mongoose } = require('../db/mongo');
const { haversineKm } = require('../lib/geometry');
const { parseGpx, statisticheTraccia, ErroreGpx, SOGLIA_DISLIVELLO_M } = require('../lib/gpx');
const { progettaPercorso } = require('../lib/trailGraph');

// Punto 55: usato da /:id/complete (gia' esistente, riscritto per riusare questa) e dalle
// nuove rotte di chat. Non ci si fida al 100% che il creatore sia sempre dentro
// "participants" (vero alla creazione, ma /:id/complete-group puo' sovrascrivere l'intero
// elenco da una selezione libera) - controllo OR, stesso stile di isSquadMember in
// routes/squads.js.
function isHikeParticipant(hike, userId) {
    return hike.creatorId.equals(userId) || hike.participants.some(p => p.equals(userId));
}

// --- Autorizzazione fine-grained per PUT /:id (vedi sotto) ---
// Bug trovato in Fase H (caccia ai bug generale): questa rotta accettava QUALUNQUE modifica da
// QUALUNQUE utente loggato, senza controllare che fosse il creatore dell'escursione - usata pero'
// da tante funzionalita' diverse (carpool.js, backpack.js, social.js) dove un partecipante DEVE
// poter cambiare alcune cose (la propria offerta di carpooling, la propria iscrizione...) senza
// essere il creatore. Le funzioni sotto permettono solo le modifiche che un normale partecipante
// dovrebbe davvero poter fare da solo; tutto il resto resta riservato al creatore.

function diffIdLists(oldList, newList) {
    const oldSet = new Set((oldList || []).map(String));
    const newSet = new Set((Array.isArray(newList) ? newList : []).map(String));
    return {
        added: [...newSet].filter(id => !oldSet.has(id)),
        removed: [...oldSet].filter(id => !newSet.has(id))
    };
}

// Un utente normale puo': iscriversi/ritirarsi da solo (rispettando manualApproval), ritirare una
// propria richiesta in sospeso, o invitare altri (es. la propria squadra) SOLO se e' gia' lui
// stesso un partecipante. Spostare/rimuovere l'ID di un ALTRO (approvare o rifiutare una
// richiesta, "Veto Capogruppo") resta riservato al creatore.
function canNonCreatorEditParticipation(hike, userId, body) {
    const userIdStr = String(userId);
    const pDiff = diffIdLists(hike.participants, body.participants !== undefined ? body.participants : hike.participants);
    const pendDiff = diffIdLists(hike.pendingApproval, body.pendingApproval !== undefined ? body.pendingApproval : hike.pendingApproval);
    const wasParticipant = (hike.participants || []).some(id => String(id) === userIdStr);

    const onlySelfOrEmpty = ids => ids.length === 0 || (ids.length === 1 && ids[0] === userIdStr);

    const touchesOnlySelf = onlySelfOrEmpty(pDiff.added) && onlySelfOrEmpty(pDiff.removed) &&
        onlySelfOrEmpty(pendDiff.added) && onlySelfOrEmpty(pendDiff.removed);
    if (touchesOnlySelf) return true;

    // Invito di altri (es. "invita la mia squadra"): solo aggiunte a participants, mai rimozioni
    // ne' tocchi alle richieste in sospeso, e solo da parte di chi e' gia' un partecipante.
    return wasParticipant && pDiff.removed.length === 0 && pendDiff.added.length === 0 && pendDiff.removed.length === 0;
}

// Un utente normale puo' creare/modificare/rimuovere SOLO la propria offerta come autista, e
// salire/scendere SOLO se stesso dall'auto di un altro. Le impostazioni di viaggio (prezzo
// benzina, consumo, pedaggio) e le offerte altrui restano del creatore.
function canNonCreatorEditCarpool(hike, userId, newCarpool) {
    if (!newCarpool || typeof newCarpool !== 'object' || !Array.isArray(newCarpool.drivers)) return false;
    const userIdStr = String(userId);
    const oldCarpool = hike.carpool || {};

    for (const key of ['fuelPrice', 'fuelConsumption', 'tollCost']) {
        if (newCarpool[key] !== undefined && newCarpool[key] !== oldCarpool[key]) return false;
    }

    const oldByUser = new Map((oldCarpool.drivers || []).map(d => [String(d.userId), d]));
    const newByUser = new Map(newCarpool.drivers.map(d => [String(d.userId), d]));

    for (const uid of oldByUser.keys()) {
        if (uid !== userIdStr && !newByUser.has(uid)) return false; // rimossa un'offerta altrui
    }

    for (const [uid, newDriver] of newByUser) {
        if (uid === userIdStr) continue; // la propria offerta: libera

        const oldDriver = oldByUser.get(uid);
        if (!oldDriver) return false; // creata un'offerta per conto di un altro

        for (const key of Object.keys(newDriver)) {
            if (key === 'passengers') continue;
            if (JSON.stringify(newDriver[key]) !== JSON.stringify(oldDriver[key])) return false;
        }

        const pDiff = diffIdLists(oldDriver.passengers, newDriver.passengers);
        const onlySelf = ids => ids.every(id => id === userIdStr);
        if (!onlySelf(pDiff.added) || !onlySelf(pDiff.removed)) return false;
    }

    return true;
}

// Campi di un oggetto della lista zaino che un partecipante NON puo' toccare su articoli
// gia' esistenti. "shareable" e "covers" sono qui dal punto 24/25 e non sono un dettaglio:
// senza, chiunque potrebbe dichiarare personale la tenda del gruppo, o gonfiarne la portata
// da 2 a 10 posti facendo sparire l'avviso "non basta per tutti" - cioe' proprio il
// controllo che quel campo esiste per fare.
const CAMPI_ZAINO_IMMUTABILI = ['name', 'category', 'mandatory', 'weight', 'shareable', 'covers'];

// Un partecipante che non ha creato l'escursione puo' fare due cose sulla lista zaino:
//  1) riassegnare "a chi tocca portarlo" (assignedTo) sugli articoli gia' esistenti;
//  2) AGGIUNGERE IN FONDO articoli che porta LUI - punto 25, "porto io una tenda da 3
//     posti". Senza questo la richiesta non starebbe in piedi: la portata della tenda non
//     si potrebbe mai dichiarare, perche' prima dell'aggiunta esisteva solo il creatore a
//     poter modificare la lista, e nessuna schermata per farlo.
// Quello che resta vietato: cambiare o cancellare gli articoli degli altri, e aggiungere
// roba a carico di qualcun altro.
function canNonCreatorEditBackpack(hike, newTemplate, userIdStr) {
    const oldTemplate = hike.backpackTemplate || [];
    if (!Array.isArray(newTemplate)) return false;

    // Non si tolgono articoli: la lista puo' solo restare uguale o allungarsi in fondo.
    if (newTemplate.length < oldTemplate.length) return false;

    const vecchiIntatti = oldTemplate.every((oldItem, i) => {
        const newItem = newTemplate[i];
        if (!newItem) return false;
        return CAMPI_ZAINO_IMMUTABILI.every(
            key => JSON.stringify(newItem[key]) === JSON.stringify(oldItem[key])
        );
    });
    if (!vecchiIntatti) return false;

    // Gli articoli aggiunti devono essere a carico di chi li aggiunge: e' una dichiarazione
    // di cosa porti tu, non un modo per caricare lo zaino di un altro.
    return newTemplate.slice(oldTemplate.length).every(
        nuovo => nuovo && String(nuovo.assignedTo || '') === userIdStr
    );
}

// --- PUNTO 43: quota massima, dislivello e distanza calcolati da un percorso vero ---
//
// "routeSource" e' facoltativo: assente, tutto resta scritto a mano come sempre. Presente,
// i tre numeri si CALCOLANO invece di fidarsi di un valore mandato dal client - un numero
// mandato dal client non e' un dato, e' un'affermazione (stesso principio gia' applicato ai
// progetti in routes/routing.js). Solleva un Error col messaggio gia' pronto per l'utente.
const MAX_BYTE_GPX_HIKE = 10 * 1024 * 1024; // stesso tetto di routes/tracking.js
const CAMPIONE_REGIONE_HIKE = 40; // stesso campione di routes/tracking.js
async function calcolaDaPercorso(routeSource, userId) {
    if (!routeSource || typeof routeSource !== 'object') {
        throw new Error('Percorso non valido.');
    }

    if (routeSource.kind === 'draft') {
        if (typeof routeSource.draftId !== 'string' || !mongoose.isValidObjectId(routeSource.draftId)) {
            throw new Error('Percorso non valido.');
        }
        // SOLO le PROPRIE bozze, stessa regola di ogni altra rotta su RouteDraft.
        const bozza = await RouteDraft.findOne({ _id: routeSource.draftId, userId });
        if (!bozza) throw new Error('Questo progetto non esiste o non è tuo.');

        // Stesso calcolo di quando si riapre la bozza (punto 13): non si salva mai il
        // percorso, si ricalcola - se un domani i sentieri migliorano, l'escursione
        // collegata trova i numeri nuovi la prossima volta che viene ricollegata.
        const punti = bozza.anello ? [...bozza.punti, bozza.punti[0]] : bozza.punti;
        const esito = await progettaPercorso(punti, { agganciaAiSentieri: bozza.agganciaAiSentieri });
        if (!esito.dislivelloDisponibile) {
            throw new Error('La fonte delle quote non ha risposto per questo progetto: riprova fra poco.');
        }
        return {
            maxAltitude: Math.round(esito.quotaMaxM),
            elevationGain: Math.round(esito.salitaM),
            distanceKm: Math.round(esito.metriTotali / 100) / 10,
            routeSource: { kind: 'draft', nome: bozza.nome }
        };
    }

    if (routeSource.kind === 'gpx') {
        const testo = routeSource.gpxText;
        if (typeof testo !== 'string' || !testo.trim()) {
            throw new Error('Nessun file .gpx ricevuto.');
        }
        if (Buffer.byteLength(testo, 'utf8') > MAX_BYTE_GPX_HIKE) {
            throw new Error('Il file supera i 10 MB. Una traccia normalmente pesa molto meno.');
        }

        let letto;
        try {
            letto = parseGpx(testo);
        } catch (e) {
            throw new Error((e instanceof ErroreGpx || e.utente) ? e.message : 'File .gpx non leggibile.');
        }

        // Stesso controllo "la maggioranza dei punti dentro le 4 regioni" gia' usato per le
        // tracce importate come uscite (routes/tracking.js): un sentiero di crinale entra ed
        // esce dai confini di continuo, bocciarlo per un punto solo sarebbe un rifiuto a caso.
        const passo = Math.max(1, Math.floor(letto.punti.length / CAMPIONE_REGIONE_HIKE));
        let dentro = 0, esaminati = 0;
        for (let i = 0; i < letto.punti.length; i += passo) {
            esaminati++;
            if (regionForPoint(letto.punti[i][0], letto.punti[i][1])) dentro++;
        }
        if (dentro * 2 <= esaminati) {
            throw new Error('Questa traccia si svolge fuori dalle quattro regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise).');
        }

        const stats = statisticheTraccia(letto.punti, SOGLIA_DISLIVELLO_M, haversineKm);
        if (stats.quotaMaxM === null) {
            throw new Error('Questo file .gpx non contiene le quote: non è possibile calcolare il dislivello.');
        }
        return {
            maxAltitude: stats.quotaMaxM,
            elevationGain: stats.dislivelloM,
            distanceKm: stats.distanzaKm,
            routeSource: { kind: 'gpx', nome: (letto.nome || 'Traccia importata').slice(0, 80) }
        };
    }

    throw new Error('Percorso non valido.');
}

// Ottieni escursioni - punto 77: una volta conclusa (hike.groupCompletedAt, stesso
// segnale gia' usato dal punto 76 per bloccare le modifiche - non un confronto con la
// data, stessa trappola gia' pagata al punto 58), un'escursione resta visibile SOLO a chi
// vi ha partecipato (isHikeParticipant: creatore o in participants). Le programmate
// restano visibili a chiunque, come sempre. E' l'unica fonte di window.CamoscioState.hikes
// per tutto il frontend (mappa, Escursioni, Le mie escursioni, profilo...), quindi filtrare
// qui basta a rendere privati anche i "dettagli" di cui parla Denis: chi non e' partecipante
// non riceve piu' il documento, non solo non lo vede in lista.
router.get('/', requireAuth, async (req, res) => {
    const hikes = await Hike.find();
    const userId = req.session.userId;
    const visibili = hikes.filter(h => !h.groupCompletedAt || isHikeParticipant(h, userId));
    res.json(visibili);
});

// Crea escursione - il creatore e' SEMPRE chi ha fatto login, mai un valore mandato dal client
router.post('/', requireAuth, async (req, res) => {
    try {
        // Vincolo hard di cose_da_fare.txt (solo Marche/Lazio/Abruzzo/Molise): finora
        // controllato SOLO lato client con un rettangolo approssimativo (bypassabile da
        // chiunque chiami questa rotta direttamente) - Fase G aggiunge lo stesso controllo,
        // ma reale (poligoni dei confini) e qui, lato server, dove conta davvero.
        const trailhead = req.body.trailhead;
        if (!trailhead || !regionForPoint(trailhead.lng, trailhead.lat)) {
            return res.status(400).json({ error: "Il punto di ritrovo deve trovarsi in Marche, Lazio, Abruzzo o Molise" });
        }

        // Punto 43: se e' stato scelto un progetto o una traccia, i tre numeri si calcolano
        // qui e sovrascrivono quelli eventualmente scritti a mano nel form (che il client, in
        // quella modalita', non manda nemmeno piu').
        let datiPercorso = {};
        if (req.body.routeSource) {
            try {
                datiPercorso = await calcolaDaPercorso(req.body.routeSource, req.session.userId);
            } catch (e) {
                return res.status(400).json({ error: e.message });
            }
        }

        const creatorId = req.session.userId;
        const hike = await Hike.create({
            ...req.body,
            ...datiPercorso,
            creatorId,
            participants: [creatorId],
            pendingApproval: [],
            backpackTemplate: [],
            peaks: [],
            carpool: { fuelPrice: 1.85, fuelConsumption: 7.0, tollCost: 0, drivers: [] },
            // BUG preesistente scoperto testando la Fase G (mai passato inosservato prima
            // perche' nessuno aveva ancora provato a creare un'escursione da quando esiste
            // l'indice 2dsphere): il form di creazione manda solo "trailhead", mai
            // "location". Senza queste coordinate l'indice geografico rifiutava OGNI nuova
            // escursione con un errore MongoDB ("Can't extract geo keys"). Si deriva qui,
            // una volta per tutte, dalla stessa posizione del trailhead - esattamente lo
            // scopo per cui il campo "location" esiste (vedi models/Hike.js).
            location: { type: 'Point', coordinates: [trailhead.lng, trailhead.lat] }
        });

        // Notifica automatica ai membri delle squadre ricorrenti del creatore (funzionalità 17b)
        const creatorSquads = await Squad.find({ creatorId: hike.creatorId });
        for (const squad of creatorSquads) {
            for (const memberId of squad.members) {
                if (memberId.equals(hike.creatorId)) continue;
                await Notification.create({
                    userId: memberId,
                    text: `La tua squadra "${squad.name}" ha una nuova escursione: "${hike.title}"`,
                    read: false
                });
            }
        }

        res.json(hike);
    } catch (e) {
        console.error('Errore creazione escursione:', e);
        res.status(400).json({ error: "Impossibile creare l'escursione" });
    }
});

// Aggiorna escursione (es. partecipanti, lista zaino, carpooling) - le modifiche permesse
// dipendono da chi chiama: vedi le funzioni canNonCreatorEdit* sopra per i dettagli. Bug
// trovato in Fase H (caccia ai bug generale): prima chiunque fosse loggato poteva riscrivere
// QUALUNQUE campo di QUALUNQUE escursione (titolo, ritrovo, partecipanti, carpooling...),
// bypassando anche l'approvazione manuale del capogruppo.
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }

        const userId = req.session.userId;
        const isCreator = hike.creatorId.equals(userId);
        const body = req.body;
        const update = {};

        const CREATOR_ONLY_FIELDS = [
            'title', 'description', 'difficulty', 'maxAltitude', 'distanceKm', 'elevationGain',
            'date', 'tribeTags', 'manualApproval', 'peaks'
        ];

        // Punto 76: un'escursione completata in gruppo non si modifica piu'. Stesso segnale
        // gia' usato per nascondere "Completa escursione" (punto 64, hike.groupCompletedAt),
        // mai la sola data prevista - confrontare con "adesso" avrebbe la stessa trappola gia'
        // pagata al punto 58 (una data senza ora mente sempre a favore del passato). Non blocca
        // partecipanti/carpooling/zaino: quelli restano un'altra cosa, non richiesta qui.
        const EDIT_LOCKED_FIELDS = [...CREATOR_ONLY_FIELDS, 'trailhead', 'routeSource'];
        if (hike.groupCompletedAt && EDIT_LOCKED_FIELDS.some(field => body[field] !== undefined)) {
            return res.status(409).json({ error: 'Un\'escursione già completata non può più essere modificata' });
        }

        for (const field of CREATOR_ONLY_FIELDS) {
            if (body[field] !== undefined) {
                if (!isCreator) {
                    return res.status(403).json({ error: "Solo chi ha creato l'escursione può modificare questo campo" });
                }
                update[field] = body[field];
            }
        }

        // Punto 54 (modifica escursione): trailhead e location vanno gestiti insieme, non nel
        // ciclo generico sopra - altrimenti un client potrebbe mandare l'uno senza l'altro e i
        // due finirebbero scollegati. Stessa validazione della regione gia' fatta in POST /
        // (Fase G), qui mancava perche' prima nessuno modificava mai il ritrovo dopo la creazione.
        if (body.trailhead !== undefined) {
            if (!isCreator) {
                return res.status(403).json({ error: "Solo chi ha creato l'escursione può modificare questo campo" });
            }
            const trailhead = body.trailhead;
            if (!trailhead || !regionForPoint(trailhead.lng, trailhead.lat)) {
                return res.status(400).json({ error: "Il punto di ritrovo deve trovarsi in Marche, Lazio, Abruzzo o Molise" });
            }
            update.trailhead = trailhead;
            update.location = { type: 'Point', coordinates: [trailhead.lng, trailhead.lat] };
        }

        // Punto 43: come in POST /, ricalcola i tre numeri da un progetto o da una traccia
        // e sovrascrive quelli scritti a mano nel ciclo CREATOR_ONLY_FIELDS sopra.
        // routeSource:null e' la scelta esplicita di tornare all'inserimento manuale.
        if (body.routeSource !== undefined) {
            if (!isCreator) {
                return res.status(403).json({ error: "Solo chi ha creato l'escursione può modificare questo campo" });
            }
            if (body.routeSource === null) {
                update.routeSource = null;
            } else {
                try {
                    const calcolato = await calcolaDaPercorso(body.routeSource, userId);
                    update.maxAltitude = calcolato.maxAltitude;
                    update.elevationGain = calcolato.elevationGain;
                    update.distanceKm = calcolato.distanceKm;
                    update.routeSource = calcolato.routeSource;
                } catch (e) {
                    return res.status(400).json({ error: e.message });
                }
            }
        } else if (isCreator && hike.routeSource &&
            (body.maxAltitude !== undefined || body.elevationGain !== undefined || body.distanceKm !== undefined)) {
            // Numeri scritti a mano SENZA dire da quale percorso vengono: l'etichetta
            // "percorso collegato" non varrebbe piu' niente se questi numeri divergono da
            // quelli del percorso originale, quindi si toglie invece di lasciarla a mentire.
            update.routeSource = null;
        }

        // Punto 61: chi chiede di partecipare finisce in pendingApproval, ma finora nessuno
        // avvisava il creatore - doveva andare a controllare da solo. Il diff va calcolato qui
        // (diffIdLists esiste gia' per l'autorizzazione sopra) cosi' la notifica parte per
        // qualunque richiesta nuova, non solo dal tasto di oggi (joinHikeRequest in social.js).
        let newPendingRequesterIds = [];
        if (body.participants !== undefined || body.pendingApproval !== undefined) {
            if (!isCreator && !canNonCreatorEditParticipation(hike, userId, body)) {
                return res.status(403).json({ error: 'Non puoi modificare così la lista partecipanti' });
            }
            if (body.participants !== undefined) update.participants = body.participants;
            if (body.pendingApproval !== undefined) {
                update.pendingApproval = body.pendingApproval;
                newPendingRequesterIds = diffIdLists(hike.pendingApproval, body.pendingApproval).added
                    .filter(id => id !== String(hike.creatorId));
            }
        }

        if (body.carpool !== undefined) {
            if (!isCreator && !canNonCreatorEditCarpool(hike, userId, body.carpool)) {
                return res.status(403).json({ error: 'Non puoi modificare così il carpooling' });
            }
            update.carpool = body.carpool;
        }

        if (body.backpackTemplate !== undefined) {
            if (!isCreator && !canNonCreatorEditBackpack(hike, body.backpackTemplate, String(userId))) {
                return res.status(403).json({ error: 'Non puoi modificare così la lista zaino' });
            }
            update.backpackTemplate = body.backpackTemplate;
        }

        const updated = await Hike.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });

        for (const requesterId of newPendingRequesterIds) {
            const requester = await User.findById(requesterId);
            await Notification.create({
                userId: hike.creatorId,
                text: `${requester ? requester.username : 'Un utente'} ha chiesto di partecipare alla tua escursione "${hike.title}"`,
                read: false
            });
        }

        res.json(updated);
    } catch (e) {
        console.error('Errore aggiornamento escursione:', e);
        res.status(400).json({ error: "Impossibile aggiornare l'escursione" });
    }
});

// Segna un'escursione come completata: aggiorna cronologia, passo personale e livello esperienza.
// L'utente che completa e' SEMPRE chi ha fatto login (prima si fidava di userId nel body:
// chiunque poteva segnare escursioni come completate per conto di un altro utente).
router.post('/:id/complete', requireAuth, async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }

        const { actualTimeHours } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        if (!isHikeParticipant(hike, user._id)) {
            return res.status(403).json({ error: "Solo i partecipanti dell'escursione possono segnarla come completata" });
        }

        // Punto 64: la matematica (Completion, passo personale, livello esperienza) e'
        // stata estratta in lib/hikeStats.js perche' ora serve anche al completamento di
        // gruppo qui sotto. Il 409 resta specifico di QUESTA rotta (l'auto-dichiarazione
        // individuale non puo' ripetersi): nel completamento di gruppo lo stesso caso non
        // e' un errore, e' il normale "questa persona si era gia' completata da sola".
        const applicato = await applyHikeCompletionStats(user, hike, actualTimeHours);
        if (!applicato) {
            return res.status(409).json({ error: 'Escursione già segnata come completata', user });
        }

        await user.save();
        res.json(user);
    } catch (e) {
        console.error('Errore completamento escursione:', e);
        res.status(400).json({ error: 'Impossibile completare la richiesta' });
    }
});

// Punto 64: il creatore conferma IN BLOCCO chi ha partecipato davvero, invece che aspettare
// l'auto-dichiarazione di ognuno. "confirmedUserIds" e' la lista FINALE: sovrascrive
// hike.participants (chi viene tolto dalla spunta esce, chi viene aggiunto via ricerca
// entra) - e' obbligatorio, non facoltativo, perche' il gate recensioni (punto 58) e altre
// viste (avatar sulla scheda, zaino di gruppo) presumono gia' che "condiviso l'escursione"
// equivalga a stare in participants: un Completion senza participants aggiornato
// romperebbe silenziosamente quelle funzionalita'.
router.post('/:id/complete-group', requireAuth, async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }
        if (!hike.creatorId.equals(req.session.userId)) {
            return res.status(403).json({ error: "Solo chi ha creato l'escursione può confermare il completamento di gruppo" });
        }
        if (hike.groupCompletedAt) {
            return res.status(409).json({ error: 'Questa escursione è già stata completata in gruppo' });
        }

        const confirmedUserIds = req.body && req.body.confirmedUserIds;
        if (!Array.isArray(confirmedUserIds) || confirmedUserIds.length === 0) {
            return res.status(400).json({ error: 'Conferma almeno una persona presente.' });
        }

        // Ogni ID deve corrispondere a un utente vero: evita di infilare in participants ID
        // inventati mandati a mano (la lista qui non passa da nessun'altra convalida).
        const utentiConfermati = await User.find({ _id: { $in: confirmedUserIds } }).select('_id');
        if (utentiConfermati.length !== confirmedUserIds.length) {
            return res.status(400).json({ error: 'Uno degli utenti confermati non esiste.' });
        }

        // Punto 67: un file .gpx facoltativo, "per avere i dati veri dell'escursione" (parole
        // di Denis) - non chiede mai le ore a mano, quelle il file le porta gia' con se'.
        // Stessa validazione di regione/dimensione di calcolaDaPercorso (sopra, punto 43): un
        // secondo giro di parseGpx qui serve solo a leggere inizio/fine, che quella funzione
        // condivisa non restituisce - non vale la pena cambiarne il contratto (la usano anche
        // la creazione e la modifica) per un dato che a loro non serve.
        let actualTimeHours = null;
        if (req.body && typeof req.body.gpxText === 'string' && req.body.gpxText.trim()) {
            let datiReali;
            try {
                datiReali = await calcolaDaPercorso({ kind: 'gpx', gpxText: req.body.gpxText }, req.session.userId);
            } catch (e) {
                return res.status(400).json({ error: e.message });
            }
            hike.maxAltitude = datiReali.maxAltitude;
            hike.elevationGain = datiReali.elevationGain;
            hike.distanceKm = datiReali.distanceKm;
            hike.routeSource = datiReali.routeSource;

            const letto = parseGpx(req.body.gpxText);
            if (!letto.durataIgnota && letto.inizio && letto.fine) {
                const ore = (letto.fine.getTime() - letto.inizio.getTime()) / 3600000;
                if (ore > 0) actualTimeHours = ore;
            }
        }

        // Senza un file .gpx, il tempo reale non c'entra in questo flusso: Denis non ne ha
        // mai parlato per il completamento di gruppo "a mano", riguarda solo "chi c'era" -
        // actualTimeHours resta null, esattamente come prima di questo punto.
        for (const u of utentiConfermati) {
            const persona = await User.findById(u._id);
            if (!persona) continue; // sparito fra la query sopra e questa, caso limite innocuo
            const cambiato = await applyHikeCompletionStats(persona, hike, actualTimeHours);
            if (cambiato) await persona.save();
        }

        hike.participants = confirmedUserIds;
        hike.groupCompletedAt = new Date();
        await hike.save();

        res.json(hike);
    } catch (e) {
        console.error('Errore completamento di gruppo:', e);
        res.status(400).json({ error: 'Impossibile completare la richiesta' });
    }
});

// Ultimi messaggi della chat tra i partecipanti dell'escursione - solo partecipanti (punto 55)
router.get('/:id/messages', requireAuth, async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }
        if (!isHikeParticipant(hike, req.session.userId)) {
            return res.status(403).json({ error: "Solo i partecipanti dell'escursione possono vedere questa chat" });
        }
        const messages = await HikeMessage.find({ hikeId: hike._id })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(messages.reverse());
    } catch (e) {
        console.error('Errore lettura messaggi escursione:', e);
        res.status(400).json({ error: 'Impossibile leggere i messaggi' });
    }
});

// Invia un messaggio nella chat tra i partecipanti dell'escursione - solo partecipanti (punto 55)
router.post('/:id/messages', requireAuth, async (req, res) => {
    try {
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }
        if (!isHikeParticipant(hike, req.session.userId)) {
            return res.status(403).json({ error: "Solo i partecipanti dell'escursione possono scrivere in questa chat" });
        }
        const text = String(req.body.text || '').trim();
        if (!text) {
            return res.status(400).json({ error: 'Il messaggio non può essere vuoto' });
        }
        if (text.length > 1000) {
            return res.status(400).json({ error: 'Messaggio troppo lungo (massimo 1000 caratteri)' });
        }
        const message = await HikeMessage.create({
            hikeId: hike._id,
            senderId: req.session.userId,
            text
        });
        res.json(message);
    } catch (e) {
        console.error('Errore invio messaggio escursione:', e);
        res.status(400).json({ error: 'Impossibile inviare il messaggio' });
    }
});

module.exports = router;
