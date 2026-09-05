const express = require('express');
const router = express.Router();
const Hike = require('../models/Hike');
const User = require('../models/User');
const Squad = require('../models/Squad');
const Notification = require('../models/Notification');
const HikeMessage = require('../models/HikeMessage'); // punto 55: chat tra partecipanti
const Completion = require('../models/Completion');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const RouteBookmark = require('../models/RouteBookmark');
const Like = require('../models/Like');
const TrailCandidate = require('../models/TrailCandidate');
const { applyHikeCompletionStats, recalculateAndApplyPace } = require('../lib/hikeStats'); // punto 64: condivisa con /:id/complete-group; recalc: cancellazione escursione
const { requireAuth } = require('../middleware/auth');
const { regionForPoint } = require('../lib/regions');
const { haversineKm } = require('../lib/geometry');
const { movimentoSecAttendibile } = require('../lib/gpx');
// Punto 80/A: calcolaDaPercorso e' stata estratta in lib/percorso.js perche' ora la usa
// anche routes/completions.js (aggiungere un .gpx retroattivo a un completamento).
const { calcolaDaPercorso, risolviPercorso } = require('../lib/percorso');
const { mongoose } = require('../db/mongo');
// Ri-review sicurezza (2° giro): limiter mirati su una rotta di campionamento e su due scritture.
// invitoLimiter (M-5, revisione 27ª): il ciclo invita/annulla non e' coperto da tetto+idempotenza.
const { matchLimiter, scritturaLimiter, cancellazioneLimiter, invitoLimiter } = require('../middleware/rateLimit');
const { nomeVisibile, oggiRomaISO } = require('../lib/accountDeletion'); // A-3.4: nome pseudonimizzato; oggiRomaISO: blocco iscrizioni oltre il giorno previsto
const { isSquadMember } = require('../lib/squad'); // invito squadra direzionale: chi invita deve far parte della squadra

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

// Un utente normale puo': iscriversi/ritirarsi da solo (RISPETTANDO manualApproval, vedi
// sotto), ritirare una propria richiesta in sospeso, o invitare altri (es. la propria
// squadra) SOLO se e' gia' lui stesso un partecipante. Spostare/rimuovere l'ID di un ALTRO
// (approvare o rifiutare una richiesta, "Veto Capogruppo") resta riservato al creatore.
//
// manualApproval non era MAI stato controllato qui: la regola viveva solo nel client
// (joinHikeRequest, public/js/social.js) e bastava una chiamata diretta a questa rotta per
// scavalcarla - sia iscrivendo altri (successo davvero: invito squadra su un'escursione
// altrui con manualApproval a vero), sia iscrivendo se stessi, sia approvandosi da soli
// spostandosi da pendingApproval a participants.
function canNonCreatorEditParticipation(hike, userId, body) {
    const userIdStr = String(userId);
    const pDiff = diffIdLists(hike.participants, body.participants !== undefined ? body.participants : hike.participants);
    const pendDiff = diffIdLists(hike.pendingApproval, body.pendingApproval !== undefined ? body.pendingApproval : hike.pendingApproval);

    const onlySelfOrEmpty = ids => ids.length === 0 || (ids.length === 1 && ids[0] === userIdStr);

    const touchesOnlySelf = onlySelfOrEmpty(pDiff.added) && onlySelfOrEmpty(pDiff.removed) &&
        onlySelfOrEmpty(pendDiff.added) && onlySelfOrEmpty(pendDiff.removed);
    if (touchesOnlySelf) {
        // Dentro questo ramo l'unico id in pDiff.added puo' essere solo il proprio (lo
        // garantisce onlySelfOrEmpty qui sopra): se l'escursione richiede l'approvazione,
        // iscriversi vuol dire CHIEDERE, mai entrare direttamente. Blocca anche
        // l'auto-approvazione di chi e' gia' in pendingApproval e si sposta da solo fra i
        // partecipanti. Restano liberi: chiedere (pendDiff.added), ritirarsi (pDiff.removed)
        // e ritirare la propria richiesta (pendDiff.removed) - nessuno dei tre scavalca niente.
        if (hike.manualApproval && pDiff.added.length > 0) return false;
        return true;
    }

    // --- Coinvolgere altri: MAI, in nessun campo (C-1, revisione sicurezza 27ª) ---
    // Un partecipante non-creatore non iscrive e non "propone" nessuno per conto di altri.
    // La vecchia corsia "proposta" scriveva in pendingApproval e la finalizzava il creatore:
    // ma quella decisione del creatore non e' MAI stata il consenso della persona proposta -
    // e' lo stesso difetto della 26ª sopravvissuto sotto l'altro campo (bastano due account:
    // B propone V su una hike ad approvazione manuale, A la approva, V finisce nel gruppo
    // mesh/SOS senza aver detto si'). Per coinvolgere un terzo esiste invite-squad
    // (POST /api/hikes/:id/invite-squad -> pendingInvites), che richiede il si' dell'invitato;
    // chi non e' in una squadra usa "Richiesta Partecipazione". Restano liberi (ramo
    // touchesOnlySelf qui sopra): iscriversi/ritirarsi da soli, chiedere e ritirare la
    // propria richiesta.
    return false;
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
        if (uid === userIdStr) {
            // La propria offerta e' libera su prezzo/posti/citta', ma NON sui passeggeri:
            // ci si sale a bordo da soli con joinCarpoolGroup, che passa dal ramo gia'
            // validato piu' sotto (uid !== userIdStr, "solo se stesso"). Sulla propria voce
            // driver i passeggeri possono solo CALARE (l'autista scarica qualcuno), mai
            // crescere. Il vecchio 'continue' saltava OGNI controllo qui, passengers
            // compreso: si scrivevano id arbitrari come "a bordo" (security review 21a).
            const oldMine = oldByUser.get(uid);
            const pDiff = diffIdLists(oldMine ? oldMine.passengers : [], newDriver.passengers);
            if (pDiff.added.length) return false;
            continue;
        }

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

// calcolaDaPercorso (quota massima, dislivello e distanza da un progetto o da un .gpx,
// punto 43) vive in lib/percorso.js dal punto 80/A - importata sopra.

// C-NUOVO-1 (ri-review sicurezza, 2° giro): carpool (con la citta' di partenza degli autisti,
// il dato di C-1) e backpackTemplate sono roba di gruppo. TUTTE le uscite di un Hike verso il
// client devono passare da qui - non solo GET /, ma anche la risposta di PUT /:id, che
// altrimenti restituiva il documento intero a chiunque facesse una modifica qualsiasi (o
// nessuna: un update vuoto in Mongoose degrada a una lettura, vedi PUT /:id).
function hikeVisibileA(hike, userId) {
    if (isHikeParticipant(hike, userId)) {
        // B-6 (revisione sicurezza 28ª): SOLO il creatore vede la lista intera degli invitati
        // in attesa (i loro id). Un partecipante qualunque che chiama GET /api/hikes/ non deve
        // leggere CHI altro e' stato invitato e non ha ancora risposto: e' lo stesso grafo
        // sociale su una relazione non accettata che il ramo non-partecipante qui sotto gia'
        // protegge. Il CONTEGGIO invece serve a due punti del client (public/js/social.js: la
        // nota "N invitati non hanno risposto" al creatore, e rigaInvitoSquadra che calcola
        // quanti membri di una squadra restano da invitare a una gita a cui si partecipa) -
        // quindi si tiene, non nominativo, in pendingInvitesCount. carpool/backpackTemplate
        // restano (e' comunque un partecipante).
        if (hike.creatorId.equals(userId) || !Array.isArray(hike.pendingInvites) || !hike.pendingInvites.length) {
            return hike;
        }
        const perPartecipante = hike.toJSON ? hike.toJSON() : { ...hike };
        perPartecipante.pendingInvitesCount = perPartecipante.pendingInvites.length;
        const soloMio = perPartecipante.pendingInvites.filter(id => String(id) === String(userId));
        if (soloMio.length) perPartecipante.pendingInvites = soloMio;
        else delete perPartecipante.pendingInvites;
        return perPartecipante;
    }
    // toJSON, NON toObject: le opzioni globali (virtuals:true, delete _id) sono su toJSON
    // (db/mongo.js), da cui tutto il frontend riceve `.id`. Con toObject il documento
    // strippato usciva con `_id`/`__v` e senza `id` - GET /api/hikes/ restituiva un array
    // misto (le tue con `id`, le altrui con `_id`) e il client non agganciava piu' schede,
    // marker e "Partecipa" sulle escursioni altrui. Ri-review sicurezza, 3° giro.
    const pubblico = hike.toJSON ? hike.toJSON() : { ...hike };
    delete pubblico.carpool;
    delete pubblico.backpackTemplate;
    // Invito squadra direzionale: un non-partecipante vede SOLO il proprio invito, mai la
    // lista intera (che direbbe a chiunque "Tizio e' invitato alla gita di Caio e non ha
    // ancora risposto"). I partecipanti veri ricevono `hike` intero col return anticipato
    // qui sopra, quindi l'invitante puo' contare quanti membri restano da invitare.
    if (Array.isArray(pubblico.pendingInvites)) {
        const soloMio = pubblico.pendingInvites.filter(id => String(id) === String(userId));
        if (soloMio.length) pubblico.pendingInvites = soloMio;
        else delete pubblico.pendingInvites;
    }
    return pubblico;
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
    // C-2 / security review: carpooling e "zaino condivisibile" sono roba di gruppo - chi non
    // e' partecipante li riceve strippati (hikeVisibileA). Le concluse sono gia' solo-partecipanti.
    res.json(visibili.map(h => hikeVisibileA(h, userId)));
});

// Crea escursione - il creatore e' SEMPRE chi ha fatto login, mai un valore mandato dal client
router.post('/', requireAuth, scritturaLimiter, async (req, res) => {
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
        // quella modalita', non manda nemmeno piu'). Punto 93: se la fonte delle quote non
        // risponde, risolviPercorso puo' rispondere 422 invece di 400 - vedi lib/percorso.js.
        let datiPercorso = {};
        if (req.body.routeSource) {
            const r = await risolviPercorso(req.body.routeSource, req.session.userId);
            if (!r.ok) return res.status(r.status).json(r.corpo);
            datiPercorso = r.dati;
        }

        const creatorId = req.session.userId;
        // Whitelist esplicita invece di `...req.body` (ri-review sicurezza, 2° giro): senza,
        // il client poteva infilare alla creazione campi come `groupCompletedAt` (un'escursione
        // che nasce gia' "conclusa"). Stesso principio di SELF_EDITABLE_FIELDS in routes/users.js
        // e del ciclo whitelist nel PUT qui sotto. multiDay resta creator-set alla creazione.
        const b = req.body || {};
        const hike = await Hike.create({
            title: b.title,
            description: b.description,
            difficulty: b.difficulty,
            maxAltitude: b.maxAltitude,
            distanceKm: b.distanceKm,
            elevationGain: b.elevationGain,
            date: b.date,
            tribeTags: b.tribeTags,
            manualApproval: b.manualApproval,
            multiDay: b.multiDay === true ? true : undefined,
            trailhead: b.trailhead,
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
                    read: false,
                    // relatedHikeId: cosi' DELETE /api/hikes/:id la porta via con l'escursione,
                    // invece di lasciare in giro il titolo di una hike cancellata.
                    relatedHikeId: hike._id
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

        // C-NUOVO-1 / punto 77 (ri-review sicurezza, 2° giro): un'escursione conclusa e' roba
        // solo dei suoi partecipanti - un non-partecipante non deve poterne leggere i dati
        // nemmeno passando da una PUT (che sotto risponde col documento).
        if (hike.groupCompletedAt && !isHikeParticipant(hike, userId)) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }

        const CREATOR_ONLY_FIELDS = [
            'title', 'description', 'difficulty', 'maxAltitude', 'distanceKm', 'elevationGain',
            'date', 'tribeTags', 'manualApproval', 'peaks'
        ];

        // Punto 76: un'escursione completata in gruppo non si modifica piu'. Stesso segnale
        // gia' usato per nascondere "Completa escursione" (punto 64, hike.groupCompletedAt),
        // mai la sola data prevista - confrontare con "adesso" avrebbe la stessa trappola gia'
        // pagata al punto 58 (una data senza ora mente sempre a favore del passato).
        // 'participants' e' entrato nell'elenco dopo un bug reale (invito squadra finito su
        // un'escursione gia' chiusa, mai richiesto e privo di senso): carpooling/zaino restano
        // fuori, quelli sono un'altra cosa. 'pendingApproval' e' entrato insieme: complete-group
        // lo azzera gia' alla chiusura (scrivendo sul documento, non via questa PUT - non e'
        // quello il caso da bloccare), ma senza il blocco esplicito qui si poteva ancora
        // PROPORRE un nome nuovo su un'escursione chiusa (canNonCreatorEditParticipation non
        // guarda groupCompletedAt) - una richiesta che poi non si puo' ne' accettare ne'
        // rifiutare, perche' il pannello Veto e' nascosto e participants e' gia' bloccato sopra.
        // Trovato dal test-engineer, non a mano.
        const EDIT_LOCKED_FIELDS = [...CREATOR_ONLY_FIELDS, 'trailhead', 'routeSource', 'participants', 'pendingApproval', 'multiDay'];
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
                // Punto 116: si torna manuale -> via anche la linea della vecchia traccia importata.
                update.$unset = { ...(update.$unset || {}), routePath: 1 };
            } else {
                // Punto 93: risolviPercorso puo' rispondere 422 se la fonte delle quote non
                // risponde - vedi lib/percorso.js e il gemello in POST / qui sopra.
                const r = await risolviPercorso(body.routeSource, userId);
                if (!r.ok) return res.status(r.status).json(r.corpo);
                Object.assign(update, r.dati);
                // Punto 116: se il percorso nuovo non porta una linea ('draft', o un
                // 'saved'/'gpx'/'fit' degenere sotto i 2 punti), quella vecchia va tolta -
                // lasciarla contraddirebbe il percorso appena collegato. r.dati.routePath e
                // questo $unset restano mutuamente esclusivi (mai lo stesso campo in $set e $unset).
                if (!r.dati.routePath) {
                    update.$unset = { ...(update.$unset || {}), routePath: 1 };
                }
            }
        } else if (isCreator && hike.routeSource &&
            (body.maxAltitude !== undefined || body.elevationGain !== undefined || body.distanceKm !== undefined)) {
            // Numeri scritti a mano SENZA dire da quale percorso vengono: l'etichetta
            // "percorso collegato" non varrebbe piu' niente se questi numeri divergono da
            // quelli del percorso originale, quindi si toglie invece di lasciarla a mentire.
            update.routeSource = null;
            update.$unset = { ...(update.$unset || {}), routePath: 1 }; // punto 116: e con lei la linea
        }

        // Blocco "zaino/carpooling per-partecipanti": "escursione di piu' giorni" la decide
        // il CREATORE, in creazione o in modifica. multiDay:true sblocca la sezione "Zaino
        // condivisibile" nel tab Zaino. Si torna "in giornata" con $unset, non scrivendo
        // false (default: undefined nello schema, vincolo spazio) - stesso principio di
        // routeSource:null qui sopra. Il client manda true con la spunta attiva, false per
        // toglierla.
        if (body.multiDay !== undefined) {
            if (!isCreator) {
                return res.status(403).json({ error: "Solo chi ha creato l'escursione può modificare questo campo" });
            }
            if (body.multiDay === true) {
                update.multiDay = true;
            } else {
                update.$unset = { ...(update.$unset || {}), multiDay: 1 };
            }
        }

        // Punto 61: chi chiede di partecipare finisce in pendingApproval, ma finora nessuno
        // avvisava il creatore - doveva andare a controllare da solo. Il diff va calcolato qui
        // (diffIdLists esiste gia' per l'autorizzazione sopra) cosi' la notifica parte per
        // qualunque richiesta nuova, non solo dal tasto di oggi (joinHikeRequest in social.js).
        let newPendingRequesterIds = [];
        let esitiPartecipazione = []; // ALTO-1: {userId, approvato} decisi dal creatore, testo mai dal client
        if (body.participants !== undefined || body.pendingApproval !== undefined) {
            // M-2 (revisione sicurezza 27ª): PRIMA di ogni altra cosa - i due array si scrivono
            // verbatim (piu' sotto), ma ogni guardia a monte ragiona su INSIEMI (diffIdLists):
            // un array di 300.000 ripetizioni degli id gia' presenti ha diff nullo, supera
            // "touchesOnlySelf" e viene salvato cosi'. Il tetto sul NUMERO va qui: lo schema
            // non lo applica sui findByIdAndUpdate. 200 come complete-group e pendingInvites.
            // La dedup rende innocuo anche un array di soli doppioni sotto quota. Gli altri
            // array della rotta (drivers > 50, backpackTemplate > 100) hanno gia' il loro tetto.
            for (const campo of ['participants', 'pendingApproval']) {
                if (body[campo] === undefined) continue;
                if (!Array.isArray(body[campo]) || body[campo].length > 200) {
                    return res.status(400).json({ error: 'Lista partecipanti non valida o troppo lunga (massimo 200).' });
                }
                body[campo] = [...new Set(body[campo].map(String))];
            }

            if (!isCreator && !canNonCreatorEditParticipation(hike, userId, body)) {
                return res.status(403).json({ error: 'Non puoi modificare così la lista partecipanti' });
            }

            // Il CREATORE non aveva nessun filtro qui: un semplice PUT {participants:[<id>]}
            // bastava per infilare un id qualsiasi nel gruppo mesh/SOS di un'escursione non
            // ancora conclusa, e da lì ricevere le coordinate GPS reali di quella persona
            // quando manda un pacchetto mesh (server.js).
            // Ora il creatore puo' aggiungere a participants/pendingApproval SOLO chi e' gia'
            // in relazione con l'escursione: chi ha gia' chiesto (in pendingApproval -> lo
            // sposta in participants = "accetta la richiesta") o chi e' gia' dentro. NON puo'
            // piu' aggiungere un compagno di squadra "a mano": i compagni di squadra si
            // INVITANO (POST /:id/invite-squad -> pendingInvites) ed entrano solo se accettano
            // (decisione della 27ª - "decide l'invitato"). Le RIMOZIONI restano libere.
            //
            // pendingInvites NON entra in `giaInRelazione`, ed e' deliberato: se il creatore
            // potesse "finalizzare" un invitato spostandolo lui in participants avremmo
            // riscritto lo stesso difetto con un nome nuovo. Un invitato entra SOLO da
            // POST /:id/invite-response.
            if (isCreator) {
                const aggiuntiDalCreatore = [...new Set([
                    ...(body.participants !== undefined ? diffIdLists(hike.participants, body.participants).added : []),
                    ...(body.pendingApproval !== undefined ? diffIdLists(hike.pendingApproval, body.pendingApproval).added : [])
                ])].map(String);
                const giaInRelazione = new Set([
                    ...(hike.participants || []).map(String),
                    ...(hike.pendingApproval || []).map(String),
                    String(hike.creatorId)
                ]);
                if (aggiuntiDalCreatore.some(id => !giaInRelazione.has(id))) {
                    return res.status(403).json({
                        error: 'I compagni di squadra si invitano: entrano solo se accettano. Puoi aggiungere solo chi ha già chiesto di partecipare.',
                        code: 'HIKE_AGGIUNTA_NON_CONSENTITA'
                    });
                }
            }

            // Decisione di Denis (02/09/2026): passato il giorno previsto, l'escursione
            // non accetta più NESSUNO - né auto-iscrizioni, né richieste, né inviti
            // squadra, né aggiunte a mano del creatore. Vale solo per le AGGIUNTE:
            // ritirarsi, ritirare una richiesta o rifiutare un pendente resta sempre
            // possibile. Il creatore che deve davvero aggiungere qualcuno sposta prima
            // la data (campo `date`, poche righe sopra). Il completamento di gruppo passa
            // da POST /:id/complete-group, non da qui, quindi non è toccato.
            // Confronto fra stringhe "YYYY-MM-DD" nel fuso Europe/Rome: MAI
            // new Date(hike.date) < new Date(), che segnerebbe "passato" dalla mezzanotte
            // del giorno stesso (trappola del punto 58). `<` e non `<=`: il giorno
            // previsto è ancora buono, si chiude da quello dopo.
            const aggiungeQualcuno =
                (body.participants !== undefined && diffIdLists(hike.participants, body.participants).added.length > 0) ||
                (body.pendingApproval !== undefined && diffIdLists(hike.pendingApproval, body.pendingApproval).added.length > 0);
            if (aggiungeQualcuno && hike.date && hike.date < oggiRomaISO()) {
                return res.status(409).json({
                    error: `Questa escursione era prevista per il ${hike.date}: da quel giorno in poi non accetta più iscrizioni.`,
                    code: 'HIKE_DATE_PASSED',
                    hikeDate: hike.date
                });
            }

            if (body.participants !== undefined) update.participants = body.participants;
            if (body.pendingApproval !== undefined) {
                update.pendingApproval = body.pendingApproval;
                newPendingRequesterIds = diffIdLists(hike.pendingApproval, body.pendingApproval).added
                    .filter(id => id !== String(hike.creatorId));

                // ALTO-1 (revisione sicurezza, 29ª/30ª): l'esito "sei/non sei tra i
                // partecipanti" veniva prima notificato da una POST /api/notifications
                // separata, col testo E il destinatario scelti dal CLIENT - chiunque loggato
                // poteva forgiare quella rotta per QUALUNQUE userId e QUALUNQUE testo (anche
                // un falso esito del Dead Man's Switch). L'unico uso legittimo era proprio
                // questo "Veto Capogruppo" (social.js approveParticipant/declineParticipant),
                // quindi la notifica si genera qui - stesso giro gia' fatto, stesso hike.title
                // gia' in mano, MAI un testo che arriva dal client. Solo il creatore decide
                // (isCreator sopra), quindi un rifiuto/approvazione di un TERZO che ha solo
                // proposto (canNonCreatorEditParticipation) non genera questo avviso.
                //
                // giaPartecipante (giro agente sul fix ALTO-1, MEDIO-A): giaInRelazione qui
                // sopra considera "in relazione" anche chi e' GIA' in participants, quindi il
                // creatore poteva rimettere un partecipante vero dentro pendingApproval e
                // ritoglierlo subito - ogni giro genera una notifica verso un TERZO (non piu'
                // verso se stesso come newPendingRequesterIds), fino a 200 a chiamata: molestia
                // + riempimento reale di Atlas. Notificare SOLO chi era davvero in attesa (non
                // gia' partecipante PRIMA di questa PUT) chiude il riciclo: chi viene rifiutato
                // esce da giaInRelazione e non puo' rientrare in pendingApproval (403 sopra).
                if (isCreator) {
                    const giaPartecipante = new Set((hike.participants || []).map(String));
                    const nuoviParticipantsSet = new Set(
                        (body.participants !== undefined ? body.participants : hike.participants).map(String)
                    );
                    esitiPartecipazione = diffIdLists(hike.pendingApproval, body.pendingApproval).removed
                        .filter(id => id !== String(hike.creatorId))
                        .filter(id => !giaPartecipante.has(id))
                        .map(id => ({ userId: id, approvato: nuoviParticipantsSet.has(id) }));
                }
            }
        }

        if (body.carpool !== undefined) {
            // C-2 (security review 21a): il carpooling di un'escursione e' dei suoi
            // partecipanti. canNonCreatorEditCarpool valida la FORMA della modifica ma non
            // ha mai controllato la partecipazione - un estraneo poteva inserirsi come
            // autista, o leggere/riscrivere le offerte altrui, su un'escursione qualsiasi.
            if (!isHikeParticipant(hike, userId)) {
                return res.status(403).json({ error: 'Solo i partecipanti possono usare il carpooling di questa escursione' });
            }
            // A-NUOVO-4 (ri-review sicurezza, 2° giro): il maxlength di schema NON e' applicato
            // ai sotto-documenti degli array su findByIdAndUpdate - il tetto va messo qui, dove
            // il controllo e' reale (senza, ~9 MB per richiesta su departureCity).
            const drivers = (body.carpool && Array.isArray(body.carpool.drivers)) ? body.carpool.drivers : [];
            // 3° giro: e anche il NUMERO di voci - Mongoose non conta gli elementi di un array
            // di sotto-doc su findByIdAndUpdate, quindi migliaia di driver vuoti passavano.
            if (drivers.length > 50) {
                return res.status(400).json({ error: 'Troppi autisti nel carpooling (massimo 50)' });
            }
            if (drivers.some(d => d && String(d.departureCity || '').length > 100)) {
                return res.status(400).json({ error: 'Zona di partenza troppo lunga (massimo 100 caratteri)' });
            }
            if (!isCreator && !canNonCreatorEditCarpool(hike, userId, body.carpool)) {
                return res.status(403).json({ error: 'Non puoi modificare così il carpooling' });
            }
            update.carpool = body.carpool;
        }

        if (body.backpackTemplate !== undefined) {
            // C-2 (security review 21a): lo "zaino condivisibile" e' roba di gruppo, solo i
            // partecipanti possono toccarlo (canNonCreatorEditBackpack valida la forma della
            // modifica, non la partecipazione).
            if (!isHikeParticipant(hike, userId)) {
                return res.status(403).json({ error: 'Solo i partecipanti possono modificare lo zaino di questa escursione' });
            }
            // Blocco zaino/carpooling per-partecipanti: lo "zaino condivisibile" esiste SOLO
            // per le escursioni di piu' giorni. Su una gita in giornata il tab Zaino e' solo
            // la lista personale privata di ognuno (localStorage lato client, non passa mai
            // di qui). Il frontend nasconde la sezione condivisa; questo e' il gate vero.
            if (!hike.multiDay) {
                return res.status(403).json({ error: 'Lo zaino condivisibile esiste solo per le escursioni di più giorni' });
            }
            // A-NUOVO-4: tetto sul nome/categoria dell'articolo E sul numero di articoli qui,
            // non nello schema (vedi il gemello nel ramo carpool). 3° giro: aggiunto il tetto
            // al numero e il controllo su `category`.
            if (!Array.isArray(body.backpackTemplate) || body.backpackTemplate.length > 100) {
                return res.status(400).json({ error: 'Lista zaino non valida o troppo lunga (massimo 100 articoli)' });
            }
            if (body.backpackTemplate.some(i => i && (String(i.name || '').length > 80 || String(i.category || '').length > 40))) {
                return res.status(400).json({ error: 'Nome o categoria di un articolo dello zaino troppo lungo' });
            }
            if (!isCreator && !canNonCreatorEditBackpack(hike, body.backpackTemplate, String(userId))) {
                return res.status(403).json({ error: 'Non puoi modificare così la lista zaino' });
            }
            update.backpackTemplate = body.backpackTemplate;
        }

        // C-NUOVO-1 (ri-review sicurezza, 2° giro): un update senza NESSUN campo riconosciuto
        // non deve diventare una lettura mascherata - findByIdAndUpdate con update vuoto in
        // Mongoose restituisce il documento intero, scavalcando hikeVisibileA e i gate sopra.
        if (!Object.keys(update).length) {
            return res.status(400).json({ error: 'Nessuna modifica valida richiesta' });
        }

        const updated = await Hike.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });

        // La richiesta puo' ora arrivare anche da un terzo (invito squadra su un'escursione ad
        // approvazione manuale, canNonCreatorEditParticipation sopra) - dire "ha chiesto di
        // partecipare" di chi non ha chiesto niente sarebbe fuorviante proprio verso chi deve
        // decidere. Il nome di chi propone si legge una volta sola, e solo se serve davvero.
        // Try separato dall'update sopra: prima Notification.create rientrava nello stesso try
        // della scrittura vera (trovato dal code-reviewer) - se falliva, il client vedeva
        // "impossibile aggiornare l'escursione" anche se l'iscrizione/proposta era gia' andata
        // a segno. La notifica e' un avviso, non deve poter mentire sull'esito della scrittura.
        try {
            const propostiDaAltri = newPendingRequesterIds.some(id => id !== String(userId));
            const chiPropone = propostiDaAltri ? await User.findById(userId) : null;
            // A-3.4: mai lo username vero di un account eliminato dentro il testo di una
            // notifica (chi propone e' un terzo: puo' proporre un membro-tombstone di una
            // squadra). nomeVisibile legge pendingDeletionAt/deletedAt dal documento pieno.
            const nomeChiPropone = nomeVisibile(chiPropone) || 'Un altro partecipante';

            for (const requesterId of newPendingRequesterIds) {
                const requester = await User.findById(requesterId);
                const nome = nomeVisibile(requester) || 'Un utente';
                const text = requesterId === String(userId)
                    ? `${nome} ha chiesto di partecipare alla tua escursione "${hike.title}"`
                    : `${nomeChiPropone} propone ${nome} per la tua escursione "${hike.title}"`;
                // relatedHikeId: la porta via DELETE /api/hikes/:id con l'escursione.
                await Notification.create({ userId: hike.creatorId, text, read: false, relatedHikeId: hike._id });
            }

            // ALTO-1: esito della decisione del creatore, testo fisso generato qui (vedi il
            // commento sopra, dove esitiPartecipazione viene calcolato).
            // Idempotenza (2° giro agente sul fix ALTO-1): giaPartecipante qui sopra
            // chiude il riciclo SENZA rimozione (rimettere dentro chi era gia' partecipante),
            // non quello CON rimozione - un creatore puo' ancora togliere e rimettere lo
            // stesso id in due PUT separate (prima {participants:[creatore], pendingApproval:
            // [X]} senza toccare participants -> nessuna rimozione, poi {participants:
            // [creatore,X], pendingApproval:[]} -> ora X non e' piu' "gia' partecipante" alla
            // PUT precedente). Stesso esito ripetuto = stesso testo: non riscriverlo se esiste
            // gia' per questa persona su questa escursione, invece di inventare un secchio
            // dedicato solo per un caso limite che il creatore puo' produrre solo su una
            // propria escursione (mai su bersagli arbitrari).
            for (const { userId: targetId, approvato } of esitiPartecipazione) {
                const text = approvato
                    ? `Sei tra i partecipanti di "${hike.title}".`
                    : `Non sei stato inserito tra i partecipanti di "${hike.title}".`;
                const giaNotificato = await Notification.exists({ userId: targetId, relatedHikeId: hike._id, text });
                if (!giaNotificato) {
                    await Notification.create({ userId: targetId, text, read: false, relatedHikeId: hike._id });
                }
            }
        } catch (notifErr) {
            console.error('Errore invio notifica richiesta partecipazione:', notifErr);
        }

        // C-NUOVO-1: mai il documento grezzo - un non-partecipante (es. chi si e' appena
        // iscritto a un'escursione ad approvazione manuale) non deve ricevere carpool/zaino.
        res.json(hikeVisibileA(updated, userId));
    } catch (e) {
        console.error('Errore aggiornamento escursione:', e);
        res.status(400).json({ error: "Impossibile aggiornare l'escursione" });
    }
});

// --- CANCELLAZIONE DI UN'ESCURSIONE (solo il creatore) ---
//
// Non esisteva: una hike, una volta creata, era per sempre - e dopo la chiusura di gruppo
// spariva anche il menu "Modifica", quindi il creatore non aveva piu' nessun controllo.
// Serve a togliere le escursioni di prova (richiesta di Denis, 02/09/2026).
//
// Distruttiva e multi-utente: cancella l'escursione PER TUTTI i partecipanti, con tutto
// quello che le sta attaccato. Scelta di Denis: si cancellano anche le tracce GPS collegate
// (ActiveHikeSession) e quindi i loro "mi piace" e la loro presenza nel feed dei follower;
// gli utenti colpiti ricevono una notifica.
// Blocca (409) se c'e' un tracciamento GPS ancora in corso su questa escursione.
// A cascata, in quest'ordine (i figli prima, la hike per ultima: se qualcosa si rompe a
// meta' la hike resta e la si puo' ritentare), poi una seconda passata dopo la cancellazione
// per chiudere la finestra in cui qualcosa di nuovo puo' essersi agganciato:
//   1. tracce collegate -> con ognuna: Like, Notification(relatedSessionId), TrailCandidate
//   2. Completion di tutti -> completedHikes-1 (a chi ne aveva uno) + ricalcolo passo
//   3. chat (HikeMessage), notifiche (relatedHikeId), segnalibri (RouteBookmark),
//      TrailCandidate agganciati alla hike; avvisi ai partecipanti
//   4. la hike
// I badge di vetta NON si toccano (stesso criterio di ogni altro cestino del progetto: non
// e' registrato PERCHE' un timbro e' stato preso, revocarlo rischia di togliere un badge
// vero). ReviewLock/Review non hanno un hikeId diretto (recensioni anonime): eventuali lock
// restano ma sono innocui. Un SavedRoute creato da una traccia collegata NON si tocca: e' una
// COPIA indipendente per scelta (models/SavedRoute.js, punto 113), sopravvive di proposito.
router.delete('/:id', requireAuth, cancellazioneLimiter, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const hike = await Hike.findById(req.params.id);
        if (!hike) {
            return res.status(404).json({ error: 'Escursione non trovata' });
        }
        // Confronto con req.session.userId, MAI con un id del client - regola di tutte le
        // rotte del progetto. Solo il creatore: un partecipante che vuole solo uscirne toglie
        // se stesso da participants (PUT /:id), non passa di qui.
        if (!hike.creatorId.equals(req.session.userId)) {
            return res.status(403).json({ error: "Solo chi ha creato l'escursione può cancellarla." });
        }

        const hikeId = hike._id;

        // Una registrazione GPS ANCORA IN CORSO su questa escursione blocca la cancellazione,
        // come routes/tracking.js DELETE /sessions/:id rifiuta una sessione non 'ended'. Motivo
        // in piu' qui: il Dead Man's Switch manda ai contatti d'emergenza la posizione presa
        // proprio da quella sessione aperta (routes/safety.js) - cancellarla mentre qualcuno
        // cammina degraderebbe un avviso di soccorso. Il creatore ritenta a registrazione finita.
        const tracciamentoInCorso = await ActiveHikeSession.countDocuments({ hikeId, status: { $ne: 'ended' } });
        if (tracciamentoInCorso) {
            return res.status(409).json({
                error: "C'è ancora un tracciamento GPS in corso su questa escursione: non si può cancellare adesso. Riprova quando la registrazione è terminata.",
                code: 'HIKE_TRACKING_IN_CORSO'
            });
        }

        // 1. Tracce GPS collegate (tutte 'ended', per il controllo qui sopra) + cio' che pende
        // da loro. sessionId di TrailCandidate e' 'required': lasciarle orfane sarebbe uno
        // schema rotto, quindi si tolgono (dati di servizio per il routing, si ri-raccolgono).
        const sessioni = await ActiveHikeSession.find({ hikeId }).select('_id userId movingTimeSec').lean();
        const sessionIds = sessioni.map(s => s._id);
        if (sessionIds.length) {
            await Like.deleteMany({ sessionId: { $in: sessionIds } });
            await Notification.deleteMany({ relatedSessionId: { $in: sessionIds } });
            await TrailCandidate.deleteMany({ sessionId: { $in: sessionIds } });
            await ActiveHikeSession.deleteMany({ _id: { $in: sessionIds } });
        }

        // 2. Completion di tutti i partecipanti. Si raccolgono PRIMA gli utenti da aggiornare.
        const comps = await Completion.find({ hikeId }).select('userId').lean();
        await Completion.deleteMany({ hikeId });

        // 3. Chat, notifiche legate alla hike, segnalibri, candidati sentiero agganciati.
        const messaggiTolti = (await HikeMessage.deleteMany({ hikeId })).deletedCount || 0;
        await Notification.deleteMany({ relatedHikeId: hikeId });
        await RouteBookmark.deleteMany({ hikeId });
        await TrailCandidate.deleteMany({ hikeId });

        // Avviso a chi ne faceva parte (iscritti + chi aveva solo la traccia), tranne il
        // creatore: senza, si ritroverebbero escursione, chat, completamento, "mi piace"
        // ricevuti e voce nel feed spariti senza un messaggio - e magari sono gia' in viaggio
        // verso il ritrovo. Niente relatedHikeId: la hike sta per non esistere, il click
        // aprirebbe un fantasma.
        const daAvvisare = [...new Set([
            ...(hike.participants || []).map(String),
            ...sessioni.map(s => String(s.userId))
        ])].filter(id => id !== String(hike.creatorId));
        if (daAvvisare.length) {
            try {
                await Notification.insertMany(daAvvisare.map(userId => ({
                    userId,
                    text: `L'organizzatore ha cancellato l'escursione "${hike.title}": sono state rimosse anche la chat, i completamenti e le tracce GPS collegate.`
                })));
            } catch (e) {
                console.error('Invio notifiche di cancellazione escursione fallito:', e);
            }
        }

        // Passo personale + contatore completamenti. Due insiemi DIVERSI:
        //  - il contatore "Escursioni fatte" scende solo a chi aveva un Completion vero;
        //  - il passo personale va ricalcolato anche a chi aveva SOLO la traccia (senza mai
        //    segnare "fatta"): recalculatePersonalPace legge le osservazioni pure dalle
        //    ActiveHikeSession con movingTimeSec > 0 (lib/hikeStats.js) - stesso motivo per
        //    cui lo fa il cestino delle uscite in routes/tracking.js (punto 92).
        const idsConCompletion = [...new Set(comps.map(c => String(c.userId)))];
        const utentiColpiti = [...new Set([...idsConCompletion, ...sessioni.map(s => String(s.userId))])];
        // Tetto difensivo: e' la rotta piu' lenta del progetto (per ogni utente: 1 findById +
        // il ricalcolo, che dentro fa 3 query + un save). Un'escursione vera ne ha una
        // manciata; 200 e' irraggiungibile in buona fede e protegge l'istanza Render da 512 MB.
        if (utentiColpiti.length > 200) {
            return res.status(409).json({ error: 'Troppi partecipanti da aggiornare in una volta.' });
        }
        // Decremento del contatore in un colpo solo (atomico) subito dopo la cancellazione dei
        // Completion: se il processo muore nel ciclo qui sotto, i contatori restano comunque
        // giusti (un retry non li recupererebbe, i Completion non ci sono gia' piu'). Il ciclo
        // resta best-effort per il solo passo, che si auto-corregge al prossimo
        // completamento/cancellazione dell'utente. Il try per utente serve anche perche' su un
        // account-tombstone (A-3.4) u.save() solleva ValidationError (nome/cognome tolti dallo
        // scrub): qui fallisce in sicurezza.
        if (idsConCompletion.length) {
            const idObj = idsConCompletion.map(id => new mongoose.Types.ObjectId(id));
            await User.updateMany({ _id: { $in: idObj } }, { $inc: { completedHikes: -1 } });
            await User.updateMany({ _id: { $in: idObj }, completedHikes: { $lt: 0 } }, { $set: { completedHikes: 0 } });
        }
        for (const uid of utentiColpiti) {
            try {
                const u = await User.findById(uid);
                if (!u) continue;
                await recalculateAndApplyPace(u); // salva lui (vedi lib/hikeStats.js)
            } catch (e) {
                console.error('Ricalcolo passo dopo cancellazione escursione fallito per', uid, e);
            }
        }

        // 4. La hike, per ultima.
        await Hike.deleteOne({ _id: hikeId });

        // Seconda passata: chiude la finestra fra la cascata e la riga qui sopra (un
        // POST /:id/complete, un /tracking/start, un messaggio in chat arrivati nel frattempo
        // trovavano la hike ancora viva). Best-effort: la hike e' gia' sparita, un errore qui
        // non deve trasformare una cancellazione riuscita in un 500.
        try {
            const tardive = await ActiveHikeSession.find({ hikeId }).select('_id').lean();
            if (tardive.length) {
                const ids = tardive.map(s => s._id);
                await Like.deleteMany({ sessionId: { $in: ids } });
                await Notification.deleteMany({ relatedSessionId: { $in: ids } });
                await TrailCandidate.deleteMany({ sessionId: { $in: ids } });
                await ActiveHikeSession.deleteMany({ _id: { $in: ids } });
            }
            await Completion.deleteMany({ hikeId });
            await HikeMessage.deleteMany({ hikeId });
            await Notification.deleteMany({ relatedHikeId: hikeId });
            await RouteBookmark.deleteMany({ hikeId });
            await TrailCandidate.deleteMany({ hikeId });
        } catch (e) {
            console.error('Seconda passata di pulizia dopo cancellazione escursione fallita:', e);
        }

        res.json({
            success: true,
            rimosse: {
                iscritti: (hike.participants || []).length,
                completamenti: comps.length,
                tracce: sessioni.length,
                messaggi: messaggiTolti
            }
        });
    } catch (e) {
        console.error('Errore cancellazione escursione:', e);
        res.status(500).json({ error: "Non è stato possibile cancellare l'escursione. Riprova." });
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
        // Questo flusso (auto-completamento, es. dal tracciamento dal vivo) non porta un
        // .gpx: nessun movingTimeHours, il passo personale ricade sul totale come sempre.
        const applicato = await applyHikeCompletionStats(user, hike, { actualTimeHours });
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
router.post('/:id/complete-group', requireAuth, scritturaLimiter, async (req, res) => {
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
        // Tetto: una lista lunga qui e' l'unico vettore per creare Completion (e quindi
        // completedHikes/experienceLevel) in massa per utenti scelti a piacere - il creatore
        // e' il solo che puo' arrivare qui, ma nulla gli impedisce di creare una hike apposta.
        // Un'escursione di gruppo vera sta molto sotto 200. Chiude anche il caso "poi la
        // cancello": DELETE /api/hikes/:id itererebbe su tutti quei Completion.
        if (confirmedUserIds.length > 200) {
            return res.status(400).json({ error: 'Troppe persone da confermare in una volta.' });
        }

        // Ogni ID deve corrispondere a un utente vero: evita di infilare in participants ID
        // inventati mandati a mano (la lista qui non passa da nessun'altra convalida).
        const utentiConfermati = await User.find({ _id: { $in: confirmedUserIds } }).select('_id');
        if (utentiConfermati.length !== confirmedUserIds.length) {
            return res.status(400).json({ error: 'Uno degli utenti confermati non esiste.' });
        }
        // M-6 (revisione sicurezza 27ª, decisione di Denis 03/09/2026: chiudere - "togli la
        // funzione"). Oltre a esistere, ogni id confermato dev'essere in RELAZIONE con
        // l'escursione: chi era gia' partecipante o chi aveva CHIESTO (pendingApproval). Prima
        // il creatore poteva passare id ARBITRARI e per ognuno applyHikeCompletionStats creava
        // un Completion, incrementava completedHikes e ricalcolava experienceLevel/passo
        // (lib/hikeStats.js), e poco sotto li scriveva in participants: si modificava il
        // profilo di un utente qualsiasi senza il suo consenso.
        // Revoca la facolta' "segna presente chi non si era MAI iscritto" (punto 64 / 26ª):
        // per un walk-up vero l'organizzatore lo aggiunge prima come partecipante, o quello
        // chiede di partecipare. `pendingInvites` NON e' incluso, esattamente come in
        // `giaInRelazione` di PUT /:id (righe ~482-486): un invitato che non ha ancora
        // accettato non ha acconsentito a stare nell'escursione - finalizzarlo qui sarebbe lo
        // stesso difetto di C-1 con un nome nuovo (rilievo ALTO-1 del 2° giro dell'agente).
        const inRelazione = new Set([
            ...(hike.participants || []).map(String),
            ...(hike.pendingApproval || []).map(String),
            String(hike.creatorId)
        ]);
        const estranei = [...new Set(confirmedUserIds.map(String))].filter(id => !inRelazione.has(id));
        if (estranei.length) {
            return res.status(400).json({ error: "Puoi confermare solo chi era iscritto all'escursione." });
        }

        // Chi era gia' iscritto PRIMA di questa chiamata: serve sotto per avvisare solo chi
        // viene aggiunto ex novo (la ricerca "aggiungi chi non era in lista" e' una funzione
        // vera, ma non deve poter creare un completamento fantasma in silenzio).
        const partecipantiPrima = new Set((hike.participants || []).map(String));

        // Punto 67: un file .gpx facoltativo, "per avere i dati veri dell'escursione" (parole
        // di Denis) - non chiede mai le ore a mano, quelle il file le porta gia' con se'.
        // Stessa validazione di regione/dimensione di calcolaDaPercorso (sopra, punto 43), che
        // ora restituisce anche il gpx gia' letto (gpxLetto) invece di doverlo riparsare qui.
        let actualTimeHours = null;
        let movingTimeHours = null;
        if (req.body && typeof req.body.gpxText === 'string' && req.body.gpxText.trim()) {
            let datiReali;
            try {
                datiReali = await calcolaDaPercorso({ kind: 'gpx', gpxText: req.body.gpxText }, req.session.userId);
            } catch (e) {
                // B-2 (follow-up revisione sicurezza, 31a): solo un errore marcato .utente
                // (erroreUtente, lib/percorso.js) e' sicuro da mostrare cosi' com'e' -
                // fail-closed su qualunque altra eccezione, stesso principio di M-3.
                if (!(e && e.utente)) console.error('Errore gpx in complete-group:', e);
                return res.status(400).json({ error: (e && e.utente) ? e.message : 'Non è stato possibile leggere questo file.' });
            }
            hike.maxAltitude = datiReali.maxAltitude;
            hike.elevationGain = datiReali.elevationGain;
            hike.distanceKm = datiReali.distanceKm;
            hike.routeSource = datiReali.routeSource;

            const letto = datiReali.gpxLetto;
            if (!letto.durataIgnota && letto.inizio && letto.fine) {
                const ore = (letto.fine.getTime() - letto.inizio.getTime()) / 3600000;
                if (ore > 0) actualTimeHours = ore;

                // Punto 79: separa cammino e pause, SOLO se la traccia e' abbastanza fitta
                // da fidarsene (movimentoSecAttendibile lo dice da sola). Mai bloccante:
                // confermare chi ha partecipato e' cio' che conta in questa rotta, il tempo
                // di cammino e' un di piu' - movimentoSecAttendibile non solleva mai.
                const movimento = movimentoSecAttendibile(letto.punti, haversineKm);
                if (movimento.sec) movingTimeHours = movimento.sec / 3600;
            }
        }

        // Punto 80/A: se il .gpx qui sopra ha corretto il dislivello, va salvato PRIMA del
        // ciclo qui sotto. applyHikeCompletionStats ora ricalcola il passo personale
        // rileggendo TUTTI i Completion dell'utente dal database (mai in modo incrementale,
        // vedi lib/hikeStats.js) - e questa stessa escursione e' fra quelli: se il
        // salvataggio restasse dopo il ciclo, la prima persona ricalcolata leggerebbe ancora
        // il dislivello vecchio. Senza un file .gpx questo save() non scrive nulla di nuovo
        // (nessun campo modificato).
        await hike.save();

        // Senza un file .gpx, il tempo reale non c'entra in questo flusso: Denis non ne ha
        // mai parlato per il completamento di gruppo "a mano", riguarda solo "chi c'era" -
        // actualTimeHours e movingTimeHours restano null, esattamente come prima di questo punto.
        for (const u of utentiConfermati) {
            const persona = await User.findById(u._id);
            if (!persona) continue; // sparito fra la query sopra e questa, caso limite innocuo
            const cambiato = await applyHikeCompletionStats(persona, hike, { actualTimeHours, movingTimeHours });
            if (cambiato) await persona.save();
        }

        hike.participants = confirmedUserIds;
        // Una richiesta di iscrizione a un'escursione appena chiusa non significa piu' niente
        // (e PUT /:id ora rifiuta comunque qualunque tocco a participants/pendingApproval su
        // un'escursione completata, vedi EDIT_LOCKED_FIELDS sopra): si azzera qui cosi' il
        // pannello Veto del creatore non resta a proporre "accetta/rifiuta" su un fantasma.
        hike.pendingApproval = [];
        hike.groupCompletedAt = new Date();
        await hike.save();

        // Invito squadra direzionale: un invito che nessuno puo' piu' accettare (l'escursione
        // e' ora chiusa) resterebbe una card morta nella pagina dell'invitato. Si toglie con
        // $unset ESPLICITO - non `[]`: pendingInvites ha default undefined nello schema
        // (vincolo spazio), a differenza di pendingApproval qui sopra.
        if ((hike.pendingInvites || []).length) {
            await Hike.updateOne({ _id: hike._id }, { $unset: { pendingInvites: '' } });
            hike.pendingInvites = undefined;
        }

        // Avvisa chi viene segnato presente pur non essendo fra gli iscritti: la ricerca
        // "aggiungi chi non era in lista" e' una funzione voluta, ma un Completion creato per
        // qualcuno che non ne sa niente non deve restare silenzioso (finisce nel suo "Escursioni
        // fatte" e nel gate recensioni). I gia' iscritti non ricevono nulla: per loro non
        // aggiunge informazione. Best-effort: l'escursione e' gia' chiusa, un errore qui non
        // deve far fallire il completamento.
        try {
            const nuoviConfermati = [...new Set(confirmedUserIds.map(String))]
                .filter(id => !partecipantiPrima.has(id) && id !== String(hike.creatorId));
            if (nuoviConfermati.length) {
                await Notification.insertMany(nuoviConfermati.map(userId => ({
                    userId,
                    text: `Sei stato segnato come presente all'escursione "${hike.title}".`,
                    relatedHikeId: hike._id
                })));
            }
        } catch (e) {
            console.error('Avvisi "segnato presente" non inviati:', e);
        }

        res.json(hike);
    } catch (e) {
        console.error('Errore completamento di gruppo:', e);
        res.status(400).json({ error: 'Impossibile completare la richiesta' });
    }
});

// ===================================================================================
// INVITO SQUADRA DIREZIONALE ("decide l'invitato", rimandato dalla 26ª sessione)
//
// Prima: un compagno di squadra si aggiungeva a `participants` con un PUT del creatore
// (corsia HIKE_AGGIUNTA_NON_CONSENTITA) - cioe' finiva nel gruppo mesh/SOS (server.js) senza
// aver mai detto si'. Ora `invite-squad` mette i membri della squadra in `pendingInvites`, e
// SOLO `invite-response {accept:true}` dell'interessato lo sposta in `participants`. Nessuno
// entra nel gruppo di sicurezza senza un'azione esplicita sua.
// (Tappa 1 di 3: le rotte esistono, il client e la chiusura della vecchia corsia in PUT /:id
// arrivano con le tappe 2 e 3. Vedi C:\Users\lenovo\.claude\plans\camoscio-invito-squadra-direzionale.md)
// ===================================================================================

// POST /api/hikes/:id/invite-squad { squadId }
// Chi puo': un partecipante dell'escursione che e' anche membro della squadra. Su
// un'escursione ad approvazione manuale SOLO il creatore - cosi' "sei in pendingInvites"
// significa sempre "l'organizzatore e' d'accordo", senza bisogno di un campo invitedBy
// (decisione della 27ª sessione).
// invitoLimiter (M-5, revisione sicurezza 27ª): ogni chiamata genera fino a un lotto di
// notifiche (un membro di squadra a testa). Secchio separato dagli altri limiter di
// scrittura, e in particolare da sicurezzaLimiter (il secchio del Dead Man's Switch, 28ª).
router.post('/:id/invite-squad', requireAuth, invitoLimiter, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const squadId = req.body && req.body.squadId;
        if (typeof squadId !== 'string' || !mongoose.Types.ObjectId.isValid(squadId)) {
            return res.status(400).json({ error: 'Squadra non valida.' });
        }
        const hike = await Hike.findById(req.params.id);
        if (!hike) return res.status(404).json({ error: 'Escursione non trovata' });

        const userId = req.session.userId;
        if (hike.groupCompletedAt) {
            return res.status(409).json({ error: 'Questa escursione è già stata completata.', code: 'HIKE_COMPLETATA' });
        }
        if (!isHikeParticipant(hike, userId)) {
            return res.status(403).json({ error: 'Solo un partecipante può invitare una squadra a questa escursione.' });
        }
        if (hike.manualApproval && !hike.creatorId.equals(userId)) {
            return res.status(403).json({
                error: "Questa escursione richiede l'approvazione dell'organizzatore: solo chi l'ha creata può invitare una squadra.",
                code: 'HIKE_INVITO_SOLO_CREATORE'
            });
        }
        // Stessa regola di HIKE_DATE_PASSED (25ª): passato il giorno previsto, niente
        // aggiunte. Confronto fra stringhe "YYYY-MM-DD" nel fuso Europe/Rome, mai new Date().
        if (hike.date && hike.date < oggiRomaISO()) {
            return res.status(409).json({
                error: `Questa escursione era prevista per il ${hike.date}: da quel giorno in poi non accetta più iscrizioni.`,
                code: 'HIKE_DATE_PASSED',
                hikeDate: hike.date
            });
        }

        const squad = await Squad.findById(squadId);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata.' });
        if (!isSquadMember(squad, userId)) {
            return res.status(403).json({ error: 'Puoi invitare solo una squadra di cui fai parte.' });
        }

        // Chi si esclude: il creatore; chi e' gia' partecipante o gia' in pendingApproval (la
        // sua pratica e' in mano al creatore - niente due stati contemporanei); chi e' gia'
        // invitato (idempotenza); gli account eliminati O in grazia (non potrebbero accettare,
        // e la notifica verrebbe poi cancellata dallo scrub - B-2, revisione sicurezza 27ª:
        // applicaInviti in routes/squads.js filtra gia' entrambi, qui filtrava solo deletedAt).
        const membriSquadra = [...new Set((squad.members || []).map(String))];
        const giaDentroSet = new Set([
            String(hike.creatorId),
            ...(hike.participants || []).map(String),
            ...(hike.pendingApproval || []).map(String)
        ]);
        const giaInvitatiSet = new Set((hike.pendingInvites || []).map(String));
        const nGiaDentro = membriSquadra.filter(id => giaDentroSet.has(id)).length;
        const nGiaInvitati = membriSquadra.filter(id => giaInvitatiSet.has(id)).length;
        const candidati = membriSquadra.filter(id => !giaDentroSet.has(id) && !giaInvitatiSet.has(id));

        let daInvitare = [];
        if (candidati.length) {
            const vivi = await User.find({
                _id: { $in: candidati },
                deletedAt: { $exists: false },
                pendingDeletionAt: { $exists: false }
            }).select('_id').lean();
            daInvitare = vivi.map(u => String(u._id));
        }

        // Tetto: pendingInvites nasce dai membri di una squadra, e POST /api/squads non ha
        // ancora un tetto sui membri (arriva con la tappa 4 - "consenso squadra"). 200 come
        // complete-group, con lo stesso ragionamento: una squadra vera sta molto sotto.
        if ((hike.pendingInvites || []).length + daInvitare.length > 200) {
            return res.status(400).json({ error: 'Troppi inviti in una volta.' });
        }

        if (daInvitare.length) {
            await Hike.updateOne(
                { _id: hike._id },
                { $addToSet: { pendingInvites: { $each: daInvitare } } }
            );
            // Best-effort (try separato): un invito che esiste sul documento non deve fallire
            // perche' una notifica non parte.
            try {
                await Notification.insertMany(daInvitare.map(uid => ({
                    userId: uid,
                    text: `Sei stato invitato all'escursione "${hike.title}".`,
                    relatedHikeId: hike._id
                })));
            } catch (e) {
                console.error('Notifiche invito squadra non inviate:', e);
            }
        }

        const aggiornata = await Hike.findById(hike._id);
        res.json({
            invitati: daInvitare.length,
            giaDentro: nGiaDentro,
            giaInvitati: nGiaInvitati,
            hike: hikeVisibileA(aggiornata, userId)
        });
    } catch (e) {
        console.error('Errore invito squadra:', e);
        res.status(400).json({ error: 'Impossibile invitare la squadra.' });
    }
});

// POST /api/hikes/:id/invite-response { accept: true | false }
// L'attore e' SEMPRE req.session.userId (mai un id dal client). accept:true sposta
// l'invitato in `participants` (= nel gruppo mesh/SOS), accept:false toglie solo l'invito.
// Il RIFIUTO non e' mai bloccato - nemmeno su un'escursione conclusa o scaduta: un invito
// morto deve poter sparire dalla pagina dell'invitato.
router.post('/:id/invite-response', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        // Mai coercizione: la stringa "false" e' truthy e trasformerebbe un rifiuto in
        // un'adesione al gruppo di sicurezza.
        if (typeof req.body.accept !== 'boolean') {
            return res.status(400).json({ error: 'Risposta non valida.' });
        }
        const accept = req.body.accept;
        const userId = req.session.userId;

        const hike = await Hike.findById(req.params.id);
        if (!hike) return res.status(404).json({ error: 'Escursione non trovata' });

        const inInvito = (hike.pendingInvites || []).some(id => id.equals(userId));
        if (!inInvito) {
            // Non e' (piu') invitato. Se e' gia' dentro ed e' un accept, e' il doppio clic /
            // la seconda scheda -> 200 idempotente, nessuna seconda notifica.
            if (accept && isHikeParticipant(hike, userId)) {
                return res.json(hikeVisibileA(hike, userId));
            }
            return res.status(403).json({
                error: 'Non hai un invito in attesa per questa escursione.',
                code: 'HIKE_INVITO_ASSENTE'
            });
        }

        if (accept) {
            if (hike.groupCompletedAt) {
                return res.status(409).json({ error: 'Questa escursione è già stata completata.', code: 'HIKE_COMPLETATA' });
            }
            if (hike.date && hike.date < oggiRomaISO()) {
                return res.status(409).json({
                    error: `Questa escursione era prevista per il ${hike.date}: da quel giorno in poi non accetta più iscrizioni.`,
                    code: 'HIKE_DATE_PASSED',
                    hikeDate: hike.date
                });
            }
        }

        // Compare-and-swap: `pendingInvites: userId` nel filtro fa vincere un solo accept fra
        // due concorrenti; `groupCompletedAt: null` (che in Mongo combacia anche col campo
        // assente) fa perdere gracefully un accept che si incrocia con complete-group. Il
        // rifiuto non ha il filtro sulla chiusura: e' sempre permesso.
        const filtro = accept
            ? { _id: hike._id, pendingInvites: userId, groupCompletedAt: null }
            : { _id: hike._id, pendingInvites: userId };
        const mod = accept
            ? { $addToSet: { participants: userId }, $pull: { pendingInvites: userId, pendingApproval: userId } }
            : { $pull: { pendingInvites: userId } };
        const aggiornata = await Hike.findOneAndUpdate(filtro, mod, { new: true });

        if (!aggiornata) {
            // Fra la lettura e qui qualcuno ha tolto l'invito, o l'escursione si e' chiusa.
            const ri = await Hike.findById(hike._id);
            if (accept && ri && isHikeParticipant(ri, userId)) {
                return res.json(hikeVisibileA(ri, userId));
            }
            if (accept && ri && ri.groupCompletedAt) {
                return res.status(409).json({ error: 'Questa escursione è già stata completata.', code: 'HIKE_COMPLETATA' });
            }
            return res.status(403).json({ error: 'Questo invito non è più valido.', code: 'HIKE_INVITO_ASSENTE' });
        }

        // pendingInvites vuoto -> $unset (non lasciare `[]`, vincolo spazio). Best-effort:
        // un `[]` sopravvissuto e' innocuo.
        // B-1 (revisione sicurezza 27ª): il $unset e' condizionato a { $size: 0 } - fra il
        // findOneAndUpdate qui sopra e questo un invite-squad concorrente puo' aver fatto
        // $addToSet di un nuovo invitato: senza il filtro lo cancelleremmo, e quello cliccando
        // "Accetta" prenderebbe 403 HIKE_INVITO_ASSENTE.
        if ((aggiornata.pendingInvites || []).length === 0) {
            try {
                const u = await Hike.updateOne({ _id: aggiornata._id, pendingInvites: { $size: 0 } }, { $unset: { pendingInvites: '' } });
                if (u.modifiedCount) aggiornata.pendingInvites = undefined;
            } catch (e) { /* innocuo */ }
        }

        // Notifica al creatore, in un try SEPARATO (una notifica non deve poter mentire
        // sull'esito - regola gia' in PUT /:id). nomeVisibile: mai lo username vero di un
        // account eliminato. relatedHikeId: la cascata di DELETE /api/hikes/:id.
        try {
            if (!hike.creatorId.equals(userId)) {
                const invitato = await User.findById(userId).select('username pendingDeletionAt deletedAt');
                const nome = nomeVisibile(invitato) || 'Qualcuno';
                await Notification.create({
                    userId: hike.creatorId,
                    text: accept
                        ? `${nome} ha accettato il tuo invito a "${hike.title}".`
                        : `${nome} non parteciperà a "${hike.title}".`,
                    relatedHikeId: hike._id
                });
            }
        } catch (e) {
            console.error('Notifica risposta invito non inviata:', e);
        }

        res.json(hikeVisibileA(aggiornata, userId));
    } catch (e) {
        console.error('Errore risposta a invito:', e);
        res.status(400).json({ error: 'Impossibile registrare la risposta.' });
    }
});

// DELETE /api/hikes/:id/invites/:userId - annulla un invito a un'escursione ancora aperta,
// solo il creatore. M-4 (revisione sicurezza 27ª): gemella di DELETE /api/squads/:id/invites/
// :userId (che esisteva gia'). Prima, per le escursioni, un invito si toglieva SOLO con la
// risposta dell'interessato (e un account eliminato non risponde mai) o con complete-group:
// un invito mandato per errore, o a un account poi eliminato, non si poteva ritirare, e il
// creatore continuava a leggere "N invitati non hanno ancora risposto" su un numero fermo.
// invitoLimiter: e' l'altra meta' del ciclo invita/annulla.
router.delete('/:id/invites/:userId', requireAuth, invitoLimiter, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        const hike = await Hike.findById(req.params.id);
        if (!hike) return res.status(404).json({ error: 'Escursione non trovata' });
        if (!hike.creatorId.equals(req.session.userId)) {
            return res.status(403).json({ error: "Solo chi ha creato l'escursione può annullare un invito" });
        }
        await Hike.updateOne({ _id: hike._id }, { $pull: { pendingInvites: req.params.userId } });
        const dopo = await Hike.findById(hike._id);
        if ((dopo.pendingInvites || []).length === 0) {
            // B-1: $unset condizionato allo stato attuale (un $addToSet concorrente non deve sparire).
            await Hike.updateOne({ _id: hike._id, pendingInvites: { $size: 0 } }, { $unset: { pendingInvites: '' } }).catch(() => {});
        }
        res.json(hikeVisibileA(await Hike.findById(hike._id), req.session.userId));
    } catch (e) {
        console.error('Errore annullamento invito escursione:', e);
        res.status(400).json({ error: "Impossibile annullare l'invito" });
    }
});

// C-1 + A-NUOVO-2 (ri-review sicurezza): il match "parti dalla mia zona?" del carpooling
// girava tutto lato client su user.homeCity, che GET /api/users spediva a chiunque. Ora
// homeCity e' ALWAYS_PRIVATE e il confronto lo fa qui il server, che risponde SOLO col
// CONTEGGIO di chi combacia - MAI i nomi, MAI la zona altrui: coi nomi la rotta diventava un
// oracolo (cambio la mia homeCity in loop e vedo chi compare -> ricostruisco la zona altrui).
// matchLimiter tappa comunque il campionamento a raffica. Solo partecipanti.
function zoneCombaciano(a, b) {
    const c1 = String(a || '').toLowerCase().trim();
    const c2 = String(b || '').toLowerCase().trim();
    if (!c1 || !c2) return false;
    if (c1 === c2) return true;
    // Stessa euristica che stava in checkCityMatch (public/js/carpool.js): una parola
    // "principale" (>3 lettere, non via/piazza/...) contenuta in entrambe le stringhe.
    const escludi = new Set(['via', 'viale', 'piazza', 'corso', 'alto', 'basso', 'nord', 'sud']);
    const parole2 = c2.split(/\s+/);
    return c1.split(/\s+/).some(w1 =>
        w1.length > 3 && !escludi.has(w1) && parole2.some(w2 => w2.includes(w1) || w1.includes(w2))
    );
}

router.get('/:id/home-match', requireAuth, matchLimiter, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Id non valido' });
        }
        const hike = await Hike.findById(req.params.id);
        if (!hike) return res.status(404).json({ error: 'Escursione non trovata' });

        const userId = req.session.userId;
        if (!isHikeParticipant(hike, userId)) {
            return res.status(403).json({ error: 'Solo i partecipanti possono usare il carpooling di questa escursione' });
        }

        const io = await User.findById(userId).select('homeCity');
        const miaZona = io && io.homeCity;
        if (!miaZona) return res.json({ zonaInserita: false, quanti: 0 });

        const altriIds = [...new Set(
            [String(hike.creatorId), ...(hike.participants || []).map(String)]
                .filter(id => id !== String(userId))
        )];
        const altri = await User.find({ _id: { $in: altriIds } }).select('homeCity');

        const quanti = altri.filter(u => zoneCombaciano(miaZona, u.homeCity)).length;
        res.json({ zonaInserita: true, quanti });
    } catch (e) {
        console.error('Errore match zona di partenza:', e);
        res.status(500).json({ error: 'Impossibile calcolare le corrispondenze' });
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
