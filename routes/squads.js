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
const { promuoviSeSenzaAdmin } = require('../lib/squadAdmin'); // "squadra senza admin", condivisa con l'eliminazione account
const { mongoose } = require('../db/mongo');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;
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

// Ottieni squadre ricorrenti
router.get('/', requireAuth, async (req, res) => {
    const squads = await Squad.find();
    res.json(squads);
});

// Crea squadra - il creatore e' sempre chi ha fatto login, ed e' l'UNICO membro alla
// nascita: gli altri si INVITANO (27ª), ed entrano solo se accettano.
router.post('/', requireAuth, async (req, res) => {
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

        // Whitelist esplicita (punto 48): niente admins/photo dal client alla creazione.
        // Il creatore resta dentro `members` anche se isSquadMember lo calcolerebbe da
        // creatorId: cosi' la forma del documento e' identica a quella dei documenti
        // esistenti, e renderSquadsList/renderNavSquadre (che iterano members) non cambiano.
        const squad = await Squad.create({
            name: req.body.name,
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
router.post('/:id/invite', requireAuth, async (req, res) => {
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
            if (accept && isSquadMember(squad, userId)) return res.json(squad); // doppio clic
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
            if (accept && ri && isSquadMember(ri, userId)) return res.json(ri);
            return res.status(403).json({ error: 'Questo invito non è più valido.', code: 'SQUAD_INVITO_ASSENTE' });
        }
        if ((aggiornata.pendingInvites || []).length === 0) {
            try { await Squad.updateOne({ _id: aggiornata._id }, { $unset: { pendingInvites: '' } }); aggiornata.pendingInvites = undefined; } catch (e) { /* [] innocuo */ }
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
        res.json(aggiornata);
    } catch (e) {
        console.error('Errore risposta a invito squadra:', e);
        res.status(400).json({ error: 'Impossibile registrare la risposta' });
    }
});

// Annulla un invito in attesa - solo un amministratore (lo stesso motivo per cui il punto
// 75 ha aggiunto DELETE /:id/pending/:userId: senza, un invito sbagliato resta per sempre).
router.delete('/:id/invites/:userId', requireAuth, async (req, res) => {
    try {
        const squad = await Squad.findById(req.params.id);
        if (!squad) return res.status(404).json({ error: 'Squadra non trovata' });
        if (!isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Solo un amministratore può annullare un invito' });
        }
        await Squad.updateOne({ _id: squad._id }, { $pull: { pendingInvites: req.params.userId } });
        const dopo = await Squad.findById(squad._id);
        if ((dopo.pendingInvites || []).length === 0) {
            await Squad.updateOne({ _id: squad._id }, { $unset: { pendingInvites: '' } }).catch(() => {});
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
        if (!seStesso && !isSquadAdmin(squad, req.session.userId)) {
            return res.status(403).json({ error: 'Puoi rimuovere solo te stesso, o un altro membro se sei amministratore' });
        }
        if (String(squad.creatorId) === String(targetId)) {
            // ...a meno che sia il creatore stesso a uscire: allora si passa la proprieta'.
            if (!seStesso) {
                return res.status(400).json({ error: 'Chi ha creato la squadra non può essere rimosso' });
            }
            const restanti = (squad.members || []).map(String).filter(id => id !== String(targetId));
            if (restanti.length > 0) {
                const nuovo = restanti[0]; // ordine d'iscrizione
                squad.creatorId = nuovo;
                if (!squad.admins.some(a => String(a) === nuovo)) squad.admins.push(nuovo);
                await squad.save();
            }
            // restanti === 0: la squadra si scioglie dopo il $pull qui sotto.
        }
        if (!seStesso && !(squad.members || []).some(m => String(m) === String(targetId))) {
            return res.status(404).json({ error: 'Questa persona non è un membro della squadra' });
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
        let creatoreVivo = false;
        if (dopo.creatorId) {
            const c = await User.findById(dopo.creatorId).select('pendingDeletionAt deletedAt');
            creatoreVivo = !!c && !c.pendingDeletionAt && !c.deletedAt;
        }
        const esito = await promuoviSeSenzaAdmin(dopo, creatoreVivo);
        if (esito === 'sciolta') return res.json({ sciolta: true });
        res.json(dopo);
    } catch (e) {
        console.error('Errore uscita/rimozione dalla squadra:', e);
        res.status(400).json({ error: 'Impossibile completare l\'operazione' });
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
