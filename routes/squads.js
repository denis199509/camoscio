const express = require('express');
const router = express.Router();
const Squad = require('../models/Squad');
const SquadMessage = require('../models/SquadMessage');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { invitoLimiter, fotoLimiter, fotoLetturaLimiter } = require('../middleware/rateLimit'); // M-5 (27ª): ciclo invita/annulla non coperto da tetto+idempotenza. fotoLimiter: MEDIO-3 (28ª), foto squadra (~800 KB dopo MEDIO-3 residuo). fotoLetturaLimiter: MEDIO-1b, la stessa lettura senza tetto
const { nomeVisibile } = require('../lib/accountDeletion'); // A-3.4: nome pseudonimizzato per gli account eliminati
// Punto 48: il creatore e' admin/membro per calcolo (creatorId), mai duplicato dentro
// admins[]/members[]. Estratti in lib/squad.js perche' ora li usa anche routes/hikes.js
// (invito squadra direzionale) - una definizione sola.
const { isSquadMember, isSquadAdmin } = require('../lib/squad');
const { promuoviSeSenzaAdmin } = require('../lib/squadAdmin'); // "squadra senza admin", condivisa con l'eliminazione account
const { mongoose } = require('../db/mongo');

// MEDIO-3 residuo (follow-up revisione sicurezza): il client comprime sempre la foto prima
// di mandarla (public/js/squadpage.js, come il FAB foto di una segnalazione in map.js) - i
// due tetti scendono da 2 MB/1,5 MB a un peso vicino a quello di un JPEG compresso. 600 KB e'
// lo stesso MAX_PHOTO_BYTES gia' usato da Report.photo (routes/reports.js): il compressore
// mira a ~380 KB ma puo' restare sopra su un'immagine che non comprime bene, e questo resta
// un tetto duro, non l'obiettivo. abbassare il tetto abbassa anche il caso peggiore di
// riempimento Atlas (20 scritture/ora di fotoLimiter x il payload massimo possibile).
const MAX_PHOTO_BYTES = 600 * 1024;
// Margine sulla stringa base64 (~4/3 dei byte, + il prefisso "data:image/jpeg;base64,"):
// un pre-controllo economico prima di decodificare, MAI il tetto vero (quello e' sui byte).
const MAX_PHOTO_LENGTH = Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 100;
const MAX_MESSAGES = 50;

// Consenso squadra (27ª). Una squadra e' un gruppo di amici: 100 e' gia' assurdo in buona
// fede - non serve il 200 usato per complete-group, che li' protegge un ciclo costoso per
// utente. Qui protegge una lista e un lotto di notifiche. I tetti valgono SOLO sulle
// aggiunte, mai retroattivamente (stessa disciplina di HIKE_DATE_PASSED).
const MAX_MEMBRI_SQUADRA = 100;   // members + pendingInvites
const MAX_INVITI_PER_CHIAMATA = 50;

// Costruisce e applica un lotto di inviti a una squadra, dalla lista di userId scelta a mano
// (creazione) o dal pannello squadra. Una definizione sola per POST / e POST /:id/invite -
// il client non manda mai un elenco di `members`, solo chi INVITARE, e il resto lo decide qui.
// Chi si salta: gia' membro/creatore, gia' invitato, account eliminato. Chi e' in
// `pendingRequests` NON si salta: si APPROVA (ha gia' acconsentito chiedendo, e un admin
// sta dicendo si') - $pull da pendingRequests, dentro a members subito.
// Ritorna { invitati, giaDentro, approvatiDaRichiesta, squad } oppure { errore: {status, body} }.
async function applicaInviti(squad, userIds, chiInvita) {
    const idsPuliti = [...new Set((userIds || [])
        .map(String)
        .filter(id => mongoose.Types.ObjectId.isValid(id)))];

    const giaDentro = new Set([...(squad.members || []).map(String), String(squad.creatorId)]);
    const giaInvitati = new Set((squad.pendingInvites || []).map(String));
    const inRichiesta = new Set((squad.pendingRequests || []).map(String));

    const nGiaDentro = idsPuliti.filter(id => giaDentro.has(id) || giaInvitati.has(id)).length;
    const candidati = idsPuliti.filter(id => !giaDentro.has(id) && !giaInvitati.has(id));

    let vivi = [];
    if (candidati.length) {
        const u = await User.find({
            _id: { $in: candidati },
            deletedAt: { $exists: false },
            pendingDeletionAt: { $exists: false }
        }).select('_id').lean();
        vivi = u.map(x => String(x._id));
    }
    const daApprovare = vivi.filter(id => inRichiesta.has(id)); // avevano chiesto -> entrano subito
    const daInvitare = vivi.filter(id => !inRichiesta.has(id));

    const totaleFinale = (squad.members || []).length + (squad.pendingInvites || []).length +
        daApprovare.length + daInvitare.length;
    if (totaleFinale > MAX_MEMBRI_SQUADRA) {
        return { errore: { status: 400, body: { error: `Una squadra non può superare i ${MAX_MEMBRI_SQUADRA} membri.`, code: 'SQUAD_PIENA' } } };
    }

    const setOps = {};
    if (daInvitare.length) setOps.pendingInvites = { $each: daInvitare };
    if (daApprovare.length) setOps.members = { $each: daApprovare };
    const upd = {};
    if (Object.keys(setOps).length) upd.$addToSet = setOps;
    if (daApprovare.length) upd.$pull = { pendingRequests: { $in: daApprovare } };
    if (Object.keys(upd).length) await Squad.updateOne({ _id: squad._id }, upd);

    // Notifiche best-effort (try separato: un invito che esiste non deve fallire perche' una
    // notifica non parte). nomeVisibile: mai lo username vero di un account eliminato.
    try {
        const chi = await User.findById(chiInvita).select('username pendingDeletionAt deletedAt');
        const nome = nomeVisibile(chi) || 'Qualcuno';
        const notifiche = [
            ...daInvitare.map(userId => ({ userId, text: `${nome} ti ha invitato nella squadra "${squad.name}"`, read: false })),
            ...daApprovare.map(userId => ({ userId, text: `Sei stato aggiunto alla squadra "${squad.name}"`, read: false }))
        ];
        if (notifiche.length) await Notification.insertMany(notifiche);
    } catch (e) {
        console.error('Notifiche invito squadra non inviate:', e);
    }

    return {
        invitati: daInvitare.length,
        giaDentro: nGiaDentro,
        approvatiDaRichiesta: daApprovare.length,
        squad: await Squad.findById(squad._id)
    };
}

// M-3 (revisione sicurezza 27ª): specchio di hikeVisibileA (routes/hikes.js). Chi NON e'
// membro vede la squadra, ma non lo stato delle pratiche altrui: solo il PROPRIO invito /
// la PROPRIA richiesta, che gli servono per rispondere. Senza questo, GET /api/squads
// diceva a ogni utente loggato "X e' invitato nella squadra Y e non ha ancora risposto" -
// un pezzo di grafo sociale su una relazione non ancora accettata, esattamente cio' che il
// ramo escursioni protegge. (members/admins/pendingRequests escono gia' cosi' da prima di
// questo lavoro: problema preesistente e piu' ampio, non affrontato qui.)
// toJSON, NON toObject: le opzioni globali (virtuals:true / delete _id, db/mongo.js) sono
// solo su toJSON - con toObject il ramo strippato uscirebbe con _id e senza id, e il client
// non aggancerebbe piu' le schede (stessa trappola gia' pagata su hikeVisibileA).
function squadVisibileA(squad, userId) {
    if (isSquadMember(squad, userId)) return squad;
    const pubblico = squad.toJSON ? squad.toJSON() : { ...squad };
    for (const campo of ['pendingInvites', 'pendingRequests']) {
        if (!Array.isArray(pubblico[campo])) continue;
        const soloMio = pubblico[campo].filter(id => String(id) === String(userId));
        if (soloMio.length) pubblico[campo] = soloMio;
        else delete pubblico[campo];
    }
    return pubblico;
}

// Ottieni squadre ricorrenti
// try/catch (MEDIO-2 del 2° giro dell'agente): era l'unica rotta del modulo senza, e ora il
// corpo non e' piu' un semplice res.json(squads) - squadVisibileA -> isSquadMember tocca
// squad.creatorId. Una promessa rifiutata qui, non catturata, terminerebbe il processo
// (nessun handler unhandledRejection in server.js), ed e' la rotta chiamata a ogni refreshState.
router.get('/', requireAuth, async (req, res) => {
    try {
        // photo (MEDIO-3, 28ª) NON entra qui: e' select:false a schema, la pagina della
        // singola squadra la prende da GET /:id/photo. Caricarla per ogni squadra a ogni
        // refreshState di ogni utente era il vero muro (RAM su Render), prima ancora dello
        // spazio Atlas.
        const squads = await Squad.find();
        res.json(squads.map(s => squadVisibileA(s, req.session.userId)));
    } catch (e) {
        console.error('Errore lettura squadre:', e);
        res.status(500).json({ error: 'Impossibile leggere le squadre' });
    }
});

// La foto di UNA squadra. Rotta a sé perche' GET /api/squads non la porta piu' (MEDIO-3, 28ª:
// 2 MB x squadra x refreshState = RAM finita su Render). Solo requireAuth, come prima era per
// tutti dentro GET /api/squads: la foto non e' un dato sensibile come il carpool o la chat, e
// il vettore DoS (lista che le carica tutte + scritture illimitate) e' chiuso da select:false
// e fotoLimiter, non da un gate di appartenenza su una singola lettura.
// MEDIO-1b/1c (follow-up revisione sicurezza): questa singola lettura non aveva ne' un
// tetto dedicato (1b) ne' un Cache-Control (1c) - fotoLetturaLimiter chiude il primo (vedi
// il commento sul limiter), l'header il secondo. `no-cache` e non un `max-age`: a
// differenza di Report.photo (immutabile una volta creata), Squad.photo cambia - un admin
// puo' sostituirla o toglierla in qualunque momento (PUT /:id/photo) - quindi un giorno di
// cache "cieca" avrebbe fatto vedere agli ALTRI membri una foto vecchia (anche gia' rimossa)
// fino a 24 ore, senza modo di saperlo (2° giro agente sul fix ALTO-1/MEDIO). `no-cache` non
// e' "niente cache": impone solo la rivalidazione ad ogni richiesta, e Express genera da
// solo un ETag debole su res.json - senza cambiamenti risponde 304 senza corpo, stesso
// risparmio di banda di un max-age, ma sempre corretto. La foto resta un data URL dentro il
// JSON (Squad.photo e' String, non un Buffer come Report.photo) - il client (squadpage.js)
// la usa gia' cosi', nessun cambio di formato.
router.get('/:id/photo', requireAuth, fotoLetturaLimiter, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id).select('+photo');
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });
        res.set('Cache-Control', 'private, no-cache');
        res.json({ photo: squad.photo || null });
    } catch (e) {
        console.error('Errore lettura foto squadra:', e);
        res.status(400).json({ error: 'Impossibile leggere la foto della squadra' });
    }
});

// Crea squadra - il creatore e' sempre chi ha fatto login, ed e' l'UNICO membro alla
// nascita: gli altri si INVITANO (27ª), ed entrano solo se accettano.
// invitoLimiter (M-5): passa da applicaInviti, che manda un lotto di notifiche.
router.post('/', requireAuth, invitoLimiter, async (req, res) => {
    try {
        const creatorId = req.session.userId;
        // Body onesto: { name, inviteUserIds: [...] } - quelli NON diventano membri, ricevono
        // un invito. `members` resta accettato come sinonimo di inviteUserIds SOLO come
        // ripiego per una scheda vecchia aperta durante il deploy (altrimenti otterrebbe una
        // squadra vuota in silenzio); da togliere piu' avanti.
        const daInvitare = Array.isArray(req.body.inviteUserIds) ? req.body.inviteUserIds
            : (Array.isArray(req.body.members) ? req.body.members : []);
        if (daInvitare.length > MAX_INVITI_PER_CHIAMATA) {
            return res.status(400).json({ error: `Troppi inviti in una volta (massimo ${MAX_INVITI_PER_CHIAMATA}).` });
        }

        // A-1 (revisione sicurezza 27ª): il nome va sanificato QUI, non solo a schema - il
        // maxlength di Mongoose non vale sui findByIdAndUpdate e comunque un 400 pulito e'
        // meglio di un ValidationError generico. Stesso idioma di routes/tracking.js:402.
        const name = String(req.body.name || '').trim().slice(0, 80);
        if (!name) {
            return res.status(400).json({ error: 'Il nome della squadra non può essere vuoto' });
        }

        // Whitelist esplicita (punto 48): niente admins/photo dal client alla creazione.
        // Il creatore resta dentro `members` anche se isSquadMember lo calcolerebbe da
        // creatorId: cosi' la forma del documento e' identica a quella dei documenti
        // esistenti, e renderSquadsList/renderNavSquadre (che iterano members) non cambiano.
        const squad = await Squad.create({
            name,
            members: [creatorId],
            creatorId
        });
        const esito = await applicaInviti(squad, daInvitare, creatorId);
        if (esito.errore) {
            // La squadra e' gia' creata (col solo creatore): l'invito che sfora il tetto non
            // e' un motivo per non avere la squadra. Si risponde comunque 200 col documento.
            return res.json(squad);
        }
        res.json(esito.squad || squad);
    } catch (e) {
        console.error('Errore creazione squadra:', e);
        res.status(400).json({ error: 'Impossibile creare la squadra' });
    }
});

// Invita altri utenti in una squadra esistente - solo un amministratore (specchio di
// /:id/approve, visto dall'altro lato). Il server legge i membri da nessuna parte: sono i
// singoli userId scelti a mano nel pannello squadra.
// invitoLimiter (M-5): lotto di notifiche via applicaInviti.
router.post('/:id/invite', requireAuth, invitoLimiter, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore della squadra può invitare nuovi membri' });
        }
        const userIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
        if (userIds.length > MAX_INVITI_PER_CHIAMATA) {
            return res.status(400).json({ error: `Troppi inviti in una volta (massimo ${MAX_INVITI_PER_CHIAMATA}).` });
        }
        const esito = await applicaInviti(squad, userIds, req.session.userId);
        if (esito.errore) return res.status(esito.errore.status).json(esito.errore.body);
        res.json(esito);
    } catch (e) {
        console.error('Errore invito in squadra:', e);
        res.status(400).json({ error: 'Impossibile inviare gli inviti' });
    }
});

// Rispondi a un invito di squadra - l'attore e' SEMPRE req.session.userId. accept:true
// entra fra i membri, accept:false toglie solo l'invito. Idempotente.
router.post('/:id/invite-response', requireAuth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Identificativo non valido.' });
        }
        if (typeof req.body.accept !== 'boolean') {
            return res.status(400).json({ error: 'Risposta non valida.' }); // mai coercizione: "false" e' truthy
        }
        const accept = req.body.accept;
        const userId = req.session.userId;
        const squad = await Squad.findById(req.params.id);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });

        const inInvito = (squad.pendingInvites || []).some(id => id.equals(userId));
        if (!inInvito) {
            if (accept && isSquadMember(squad, userId)) return res.json(squadVisibileA(squad, userId)); // doppio clic
            return res.status(403).json({ error: 'Non hai un invito in attesa per questa squadra.', code: 'SQUAD_INVITO_ASSENTE' });
        }
        // Il tetto si ricontrolla all'accept: fra invito e risposta la squadra puo' essersi
        // riempita.
        if (accept && (squad.members || []).length >= MAX_MEMBRI_SQUADRA) {
            return res.status(409).json({ error: `Questa squadra ha raggiunto i ${MAX_MEMBRI_SQUADRA} membri.`, code: 'SQUAD_PIENA' });
        }

        const mod = accept
            ? { $addToSet: { members: userId }, $pull: { pendingInvites: userId, pendingRequests: userId } }
            : { $pull: { pendingInvites: userId } };
        const aggiornata = await Squad.findOneAndUpdate({ _id: squad._id, pendingInvites: userId }, mod, { new: true });
        if (!aggiornata) {
            const ri = await Squad.findById(squad._id);
            if (accept && ri && isSquadMember(ri, userId)) return res.json(squadVisibileA(ri, userId));
            return res.status(403).json({ error: 'Questo invito non è più valido.', code: 'SQUAD_INVITO_ASSENTE' });
        }
        if ((aggiornata.pendingInvites || []).length === 0) {
            // B-1 (revisione sicurezza 27ª): il $unset va condizionato allo stato ATTUALE
            // dell'array. Fra il findOneAndUpdate qui sopra e questo updateOne un applicaInviti
            // concorrente puo' aver fatto $addToSet di un nuovo invitato: senza il filtro
            // { $size: 0 } lo cancelleremmo, e quello cliccando "Accetta" prenderebbe 403.
            try {
                const u = await Squad.updateOne({ _id: aggiornata._id, pendingInvites: { $size: 0 } }, { $unset: { pendingInvites: '' } });
                if (u.modifiedCount) aggiornata.pendingInvites = undefined;
            } catch (e) { /* [] innocuo */ }
        }

        // Notifica agli admin, come request-join (non sappiamo chi ha invitato: niente invitedBy).
        try {
            const chi = await User.findById(userId).select('username pendingDeletionAt deletedAt');
            const nome = nomeVisibile(chi) || 'Qualcuno';
            const testo = accept
                ? `${nome} è entrato nella squadra "${squad.name}"`
                : `${nome} ha rifiutato l'invito alla squadra "${squad.name}"`;
            const dest = [squad.creatorId, ...(squad.admins || [])].filter(a => !a.equals(userId));
            if (dest.length) await Notification.insertMany(dest.map(a => ({ userId: a, text: testo, read: false })));
        } catch (e) {
            console.error('Notifica risposta invito squadra non inviata:', e);
        }
        // M-3: nel ramo accept:false chi risponde NON e' membro - non deve ricevere la lista
        // pendingInvites/pendingRequests intera. squadVisibileA e' un no-op sull'accept (a
        // quel punto e' membro).
        res.json(squadVisibileA(aggiornata, userId));
    } catch (e) {
        console.error('Errore risposta a invito squadra:', e);
        res.status(400).json({ error: 'Impossibile registrare la risposta' });
    }
});

// Annulla un invito in attesa - solo un amministratore (lo stesso motivo per cui il punto
// 75 ha aggiunto DELETE /:id/pending/:userId: senza, un invito sbagliato resta per sempre).
// invitoLimiter (M-5): e' l'altra meta' del ciclo invita/annulla che riapre la produzione
// di notifiche.
router.delete('/:id/invites/:userId', requireAuth, invitoLimiter, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore può annullare un invito' });
        }
        await Squad.updateOne({ _id: squad._id }, { $pull: { pendingInvites: req.params.userId } });
        const dopo = await Squad.findById(squad._id);
        if ((dopo.pendingInvites || []).length === 0) {
            // B-1: $unset condizionato allo stato attuale (un $addToSet concorrente non deve sparire).
            await Squad.updateOne({ _id: squad._id, pendingInvites: { $size: 0 } }, { $unset: { pendingInvites: '' } }).catch(() => {});
        }
        res.json(await Squad.findById(squad._id));
    } catch (e) {
        console.error('Errore annullamento invito squadra:', e);
        res.status(400).json({ error: 'Impossibile annullare l\'invito' });
    }
});

// Lascia la squadra / rimuovi un membro - la porta d'uscita che finora non c'era.
// Corsie: chiunque su SE STESSO (esce); un admin su un altro membro (lo rimuove); mai sul
// creatore. Ordine di esecuzione IMPORTANTE: prima la promozione/il passaggio di
// proprieta', POI il $pull - al contrario un fallimento a meta' lascerebbe una squadra
// piena senza amministratori, stato irrecuperabile senza script.
router.delete('/:id/members/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });

        const targetId = req.params.userId;
        const seStesso = String(targetId) === String(req.session.userId);
        // Catturato PRIMA della riassegnazione qui sotto (che muta squad.creatorId): serve
        // dopo il $pull per decidere se il creatore uscente conta ancora come admin vivo.
        const creatoreEsce = seStesso && String(squad.creatorId) === String(targetId);
        let successoreInstallato = false;

        // A-2 (revisione sicurezza 27ª): chi chiama deve comunque far parte della squadra,
        // ANCHE quando esce da solo. Prima il controllo sull'admin E quello sull'appartenenza
        // erano ENTRAMBI condizionati a !seStesso: un utente qualunque poteva quindi invocare
        // il flusso d'uscita su una squadra di cui non aveva mai fatto parte, e - se quella
        // squadra aveva `members` vuoto (documenti nati dalla vecchia POST /api/squads, che
        // scriveva `members: req.body.members`) - farne partire lo scioglimento con
        // SquadMessage.deleteMany sulla chat. isSquadMember calcola il creatore da creatorId,
        // quindi un creatore fuori da `members` continua a poter uscire.
        if (!isSquadMember(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Non fai parte di questa squadra' });
        }
        if (!seStesso && !isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Puoi rimuovere solo te stesso, o un altro membro se sei amministratore' });
        }
        if (String(squad.creatorId) === String(targetId)) {
            // ...a meno che sia il creatore stesso a uscire: allora si passa la proprieta'.
            if (!seStesso) {
                return res.status(400).json({ error: 'Chi ha creato la squadra non può essere rimosso' });
            }
            // M-1 (revisione sicurezza 27ª): il successore va scelto fra i membri VIVI, con
            // lo stesso filtro di lib/squadAdmin.js. restanti[0] poteva essere un account
            // eliminato (in grazia o gia' scrubato): la squadra restava con creatorId =
            // tombstone e admins = [tombstone], e promuoviSeSenzaAdmin (riga sotto) non
            // riparava - guarda admins.length, non la vitalita' -> nessun amministratore vivo,
            // nessuno che possa piu' invitare/approvare/rimuovere. Se non c'e' NESSUN
            // successore vivo si lascia fare a promuoviSeSenzaAdmin, che scioglie la squadra
            // dopo il $pull (creatoreVivo resterebbe false).
            const restanti = (squad.members || []).map(String).filter(id => id !== String(targetId));
            if (restanti.length > 0) {
                const vivi = await User.find({
                    _id: { $in: restanti },
                    pendingDeletionAt: { $exists: false },
                    deletedAt: { $exists: false }
                }).select('_id');
                const viviSet = new Set(vivi.map(u => String(u._id)));
                const nuovo = restanti.find(id => viviSet.has(id)) || null;
                if (nuovo) {
                    squad.creatorId = nuovo;
                    if (!squad.admins.some(a => String(a) === nuovo)) squad.admins.push(nuovo);
                    await squad.save();
                    successoreInstallato = true;
                    // B-4 (revisione sicurezza 28ª): chi eredita la conduzione della squadra
                    // deve saperlo. Best-effort, come tutte le notifiche del modulo.
                    try {
                        await Notification.create({
                            userId: nuovo,
                            text: `Sei ora il referente della squadra "${squad.name}": chi l'aveva creata è uscito.`,
                            read: false
                        });
                    } catch (e) { console.error('Notifica nuovo referente squadra non inviata:', e); }
                }
            }
            // restanti === 0: la squadra si scioglie dopo il $pull qui sotto.
        }
        // Il !seStesso resta: un self-caller ha gia' dimostrato l'appartenenza col gate in
        // cima, e il creatore che esce e' gia' passato di sopra. Questo intercetta solo "un
        // admin rimuove un id che non e' nella squadra".
        if (!seStesso &&
            !(squad.members || []).some(m => String(m) === String(targetId)) &&
            String(squad.creatorId) !== String(targetId)) {
            return res.status(404).json({ error: 'Questa persona non è un membro della squadra' });
        }

        // B-4 (revisione sicurezza 28ª): un admin che espelle un membro lo faceva in silenzio.
        // Solo per una rimozione altrui: chi esce da solo non ha bisogno di essere avvisato.
        // PRIMA del $pull: se la rimozione scioglie la squadra (ramo qui sotto), il rimosso
        // e' proprio chi ha piu' bisogno di saperlo. squad.name e' gia' in memoria.
        if (!seStesso) {
            try {
                await Notification.create({
                    userId: targetId,
                    text: `Sei stato rimosso dalla squadra "${squad.name}".`,
                    read: false
                });
            } catch (e) { console.error('Notifica rimozione da squadra non inviata:', e); }
        }

        const dopo = await Squad.findByIdAndUpdate(
            squad._id,
            { $pull: { members: targetId, admins: targetId } },
            { new: true }
        );
        if (!dopo || (dopo.members || []).length === 0) {
            await Squad.deleteOne({ _id: squad._id });
            await SquadMessage.deleteMany({ squadId: squad._id });
            return res.json({ sciolta: true });
        }

        // Nessun admin vivo -> promuovi il piu' anziano (o sciogli, se sono tutti tombstone).
        // M-1: se e' il CREATORE a uscire e non e' stato installato nessun successore vivo
        // (restanti tutti tombstone), il creatore uscente NON conta piu' come admin vivo -
        // altrimenti promuoviSeSenzaAdmin uscirebbe subito 'ok' e la squadra resterebbe con
        // un creatorId fantasma e zero amministratori. Stessa scelta di riassegnaAdminSquadre
        // (creatoreContaComeAdmin=false quando e' il creatore stesso ad andarsene).
        let creatoreVivo = false;
        if (dopo.creatorId && !(creatoreEsce && !successoreInstallato)) {
            const c = await User.findById(dopo.creatorId).select('pendingDeletionAt deletedAt');
            creatoreVivo = !!c && !c.pendingDeletionAt && !c.deletedAt;
        }
        const esito = await promuoviSeSenzaAdmin(dopo, creatoreVivo);
        if (esito === 'sciolta') return res.json({ sciolta: true });
        // M-3: chi ha appena lasciato la squadra non e' piu' membro -> non deve ricevere la
        // lista pendingInvites/pendingRequests intera.
        res.json(squadVisibileA(dopo, req.session.userId));
    } catch (e) {
        console.error('Errore uscita/rimozione dalla squadra:', e);
        res.status(400).json({ error: 'Impossibile completare l\'operazione' });
    }
});

// Cambia la foto della squadra - solo amministratori (punto 48).
// fotoLimiter (MEDIO-3, 28ª): un data URL scritto a raffica riempie Atlas anche col tetto
// piu' basso di MEDIO-3 residuo (MAX_PHOTO_BYTES qui sopra).
router.put('/:id/photo', requireAuth, fotoLimiter, async (req, res) => {
    try {
        // select('+photo') non serve: si SCRIVE la foto nuova, non si legge la vecchia.
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
        // MEDIO-2 (follow-up revisione sicurezza): fin qui si controllava solo la LUNGHEZZA
        // della stringa (il data URL, prefisso compreso), mai i byte veri - lo stesso buco che
        // Report.photo (routes/reports.js) gia' chiude per le segnalazioni. MEDIO-3 residuo ha
        // poi aggiunto un compressore lato client (squadpage.js, come il FAB foto di una
        // segnalazione) che normalizza SEMPRE in JPEG: qui si controlla solo quel formato,
        // riconosciuto dai BYTE veri decodificati (i magic byte FF D8 FF), mai dall'etichetta
        // "data:image/xxx" che il client potrebbe non rispettare (vincolo hard 7, non fidarsi
        // di un'etichetta). Stesso identico controllo di reports.js, stesso motivo.
        if (photo) {
            const m = String(photo).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/);
            if (!m) {
                return res.status(400).json({ error: 'Formato foto non valido' });
            }
            const buffer = Buffer.from(m[1], 'base64');
            // Dimensione VERA (byte decodificati): il tetto sopra e' sulla stringa e puo'
            // mentire (spazi/padding estranei nel base64 non contano ai fini dei byte reali).
            if (buffer.length > MAX_PHOTO_BYTES) {
                return res.status(400).json({ error: 'Foto troppo grande, scegline una più piccola' });
            }
            if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
                return res.status(400).json({ error: 'Formato foto non valido' });
            }
        }
        squad.photo = photo || null;
        await squad.save();
        // La foto appena assegnata resta nell'oggetto in memoria (select:false vale sulle
        // query, non sulla serializzazione): la risposta la contiene, e il client la usa per
        // ridisegnare l'anteprima senza un GET in piu'.
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

        // M-3: chi chiede di entrare non e' membro -> vede solo la propria richiesta appena
        // aggiunta, non gli inviti/le richieste altrui.
        res.json(squadVisibileA(squad, userId));
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
