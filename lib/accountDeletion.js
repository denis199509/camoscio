// Eliminazione account (punto A-3.4) - la logica, tenuta fuori dalle rotte cosi' e'
// testabile e non duplicata fra la richiesta dell'utente (DELETE /api/users/me) e il
// trigger esterno dello scrub (GET|POST /api/users/scrub-eliminati).
//
// MODELLO in due tempi (deciso con Denis il 02/09/2026):
//  1. RICHIESTA - l'utente preme "Elimina account" in Impostazioni (ri-digita la
//     password). Subito: pendingDeletionAt/deletionScrubAt settati, l'account e'
//     pseudonimizzato ("Account eliminato") per TUTTI, il Dead Man's Switch e'
//     disarmato, le squadre di cui era l'unico amministratore passano al membro piu'
//     anziano (o si sciolgono se non ha altri membri). Le sessioni le chiude la rotta.
//  2. GRAZIA 30 giorni - se rientra col login, ripristinaAccount() annulla tutto.
//  3. SCRUB (giorno 30, trigger esterno) - scrubAccount() [CP2]: sovrascrive i dati
//     personali, libera l'email, deletedAt. I contenuti restano, col nome "Account
//     eliminato".
//
// I contenuti (Hike, HikeMessage/SquadMessage, Squad, SavedRoute, Completion,
// ActiveHikeSession, Stamp, Like, Follow, ...) NON si toccano: creatorId/senderId/...
// restano, e la lettura li mostra come "Account eliminato" (serializeUserForViewer in
// routes/users.js + il passaggio in refreshState lato client).

const User = require('../models/User');
const Hike = require('../models/Hike');
const Squad = require('../models/Squad');
const RouteBookmark = require('../models/RouteBookmark');
const Notification = require('../models/Notification');
const EmailVerification = require('../models/EmailVerification');
const PasswordReset = require('../models/PasswordReset');
const RouteDraft = require('../models/RouteDraft');
const SavedRoute = require('../models/SavedRoute');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Follow = require('../models/Follow');
const { promuoviSeSenzaAdmin } = require('./squadAdmin'); // regola "squadra senza admin" condivisa con routes/squads.js

const GIORNI_GRAZIA = 30;

// Testo di ripiego: il client lo rimpiazza con la traduzione (common.accountEliminato)
// dentro refreshState. Serve comunque un valore per chi legge la risposta senza il
// client (prove automatiche, chiamate dirette).
const NOME_ELIMINATO = 'Account eliminato';

// "YYYY-MM-DD" nel fuso Europe/Rome. Hike.date e' salvato cosi' dal frontend (data
// locale, non UTC): confrontarlo con una data UTC sballerebbe di qualche ora vicino a
// mezzanotte. 'sv-SE' produce proprio il formato ISO YYYY-MM-DD.
// Esportata anche a routes/hikes.js (blocco iscrizioni oltre il giorno previsto):
// helper generico, non specifico dell'eliminazione account - vive qui perche' e' l'unico
// punto che lo usava finora, si sposta in un lib/ suo se un terzo chiamante lo richiede.
function oggiRomaISO() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}

// Le escursioni FUTURE ancora aperte organizzate da questo utente. Bloccano
// l'eliminazione (decisione di Denis): un'escursione in programma senza organizzatore
// non puo' funzionare - prima va annullata o passata ad altri. "Futura" = data di oggi
// (Rome) o successiva E non ancora conclusa (groupCompletedAt assente). Una passata mai
// chiusa NON blocca: e' di fatto morta, il suo creatore diventa "Account eliminato"
// come tutto il resto.
async function escursioniFutureDaCreatore(userId) {
    return Hike.find({
        creatorId: userId,
        groupCompletedAt: { $exists: false },
        date: { $gte: oggiRomaISO() }
    }).select('_id title date').lean();
}

// Squadre rese ingestibili dall'uscita di scena di userId: se non resta nessun
// amministratore "vivo" (il creatore, se non e' lui e non e' a sua volta eliminato; o un
// admin esplicito non eliminato), si promuove il primo membro vivo in ordine
// d'iscrizione. Se non c'e' nessun membro vivo la squadra si scioglie (con lo storico
// della sua chat). Il creatorId NON viene mai cambiato: resta storico, mostrato come
// "Account eliminato".
async function riassegnaAdminSquadre(userId) {
    const uid = String(userId);
    const squads = await Squad.find({ $or: [{ creatorId: userId }, { admins: userId }] });

    for (const squad of squads) {
        // Fuori l'utente dagli admin espliciti (no-op se non c'era).
        squad.admins = (squad.admins || []).filter(a => String(a) !== uid);

        // Il creatore conta come admin "vivo"? Se e' lui che se ne va, no. Se e' un altro,
        // si controlla che non sia gia' eliminato a sua volta (catena rara ma possibile).
        let creatoreVivo = false;
        if (String(squad.creatorId) !== uid) {
            const c = await User.findById(squad.creatorId).select('pendingDeletionAt deletedAt');
            creatoreVivo = !!c && !c.pendingDeletionAt && !c.deletedAt;
        }

        // La regola "nessun admin vivo -> promuovi il piu' anziano, o sciogli" vive in
        // lib/squadAdmin.js: la usa anche "lascia la squadra". 'ok' = solo il filtro admin
        // qui sopra, che va persistito.
        const esito = await promuoviSeSenzaAdmin(squad, creatoreVivo);
        if (esito === 'ok') await squad.save();
    }
}

// Avvia l'eliminazione (dopo che la rotta ha verificato password e assenza di
// escursioni future). NON tocca le sessioni: lo fa la rotta (chiudiTutteLeSessioni +
// destroy della propria).
async function avviaEliminazione(user) {
    const adesso = new Date();
    const scrub = new Date(adesso.getTime() + GIORNI_GRAZIA * 24 * 60 * 60 * 1000);
    // PRIMA la riassegnazione squadre: fa squad.save() (validazione piena del documento
    // Squad) e puo' sollevare. Se e' qui che fallisce, non deve restare un pendingDeletionAt
    // scritto a meta' con le sessioni ancora aperte. riassegnaAdminSquadre non dipende dal
    // flag dell'utente uscente (filtra gli ALTRI membri per pendingDeletionAt).
    await riassegnaAdminSquadre(user._id);
    await User.updateOne(
        { _id: user._id },
        {
            $set: { pendingDeletionAt: adesso, deletionScrubAt: scrub },
            // Un account in uscita non deve far scattare allarmi di sicurezza.
            $unset: { deadManActive: 1, deadManExpiresAt: 1 }
        }
    );
    return { pendingDeletionAt: adesso, deletionScrubAt: scrub };
}

// Annulla l'eliminazione (login entro i 30 giorni). NOTA: non ripristina il Dead Man's
// Switch (era disarmato: si ri-arma a mano) ne' "de-riassegna" gli amministratori di
// squadra (caso di bordo raro, accettato).
async function ripristinaAccount(user) {
    await User.updateOne(
        { _id: user._id },
        { $unset: { pendingDeletionAt: 1, deletionScrubAt: 1 } }
    );
}

// Scrub definitivo (giorno 30, chiamato dal trigger esterno /api/users/scrub-eliminati).
// Sovrascrive i dati personali, libera l'email per una nuova registrazione, toglie la
// password (niente piu' login), cancella le righe SOLO-private (segnalibri, notifiche,
// token). I CONTENUTI restano (Hike, HikeMessage/SquadMessage, Squad, SavedRoute,
// Completion, ActiveHikeSession, Stamp, Like, Follow, RouteDraft, TrailCandidate) e
// continuano a mostrarsi come "Account eliminato".
// Idempotente: su un account gia' scrubato (deletedAt) non fa nulla.
async function scrubAccount(user) {
    if (!user || user.deletedAt) return false;
    const now = new Date();

    // nome/cognome sono `required` a schema: si scrivono SEGNAPOSTO costanti invece di
    // $unset. Non e' meno erasure (valori identici per ogni tombstone, zero contenuto
    // informativo, e comunque mai serviti - serializeUserForViewer taglia tutto prima),
    // ma tiene il documento valido: senza, qualunque .save() su questo utente fatto da un
    // ALTRO (completamento di gruppo, recensione) fallirebbe con ValidationError e
    // porterebbe giu' la rotta di quell'altro. Stesso motivo per completedHikes: 0 invece
    // di $unset (un undefined in un calcolo di reputazione da' NaN).
    // Il filtro `deletedAt: { $exists: false }` rende l'update idempotente: se due ping del
    // cron arrivano insieme, solo il primo scrive (modifiedCount 1), il secondo 0.
    const esito = await User.updateOne(
        { _id: user._id, deletedAt: { $exists: false } },
        {
            $set: {
                deletedAt: now,
                // Token stabile e univoco, MAI mostrato: il client usa il flag `deleted` +
                // la traduzione. Serve solo a non violare l'indice unique su `username`.
                username: `utente-eliminato-${user._id}`,
                nome: 'Utente',
                cognome: 'eliminato',
                completedHikes: 0,
                emailVerified: false,
                geolocationConsent: false,
                reputation: 50,
                experienceLevel: 'Principiante',
                avatar: '👤',
                bio: '',
                trainingGoal: '',
                homeCity: '',
                interests: [],
                emergencyContacts: [],
                geoPreferences: {}
            },
            $unset: {
                pendingDeletionAt: 1, deletionScrubAt: 1,
                email: 1, passwordHash: 1,
                profilePhoto: 1,
                birthDate: 1, ageRange: 1, termsAcceptedAt: 1,
                hikingLevel: 1, preferredDifficulty: 1, localExpert: 1,
                recognizedAscents: 1,
                averagePaceUp: 1, averagePaceDown: 1,
                deadManActive: 1, deadManExpiresAt: 1,
                canModerateReports: 1, receivesReportAlerts: 1
            }
        }
    );

    // Righe SOLO-private: nessun valore per gli altri utenti, nessun contenuto pubblico.
    await RouteBookmark.deleteMany({ userId: user._id });
    await Notification.deleteMany({ userId: user._id });
    await EmailVerification.deleteMany({ userId: user._id });
    await PasswordReset.deleteMany({ userId: user._id });

    // Geometria strettamente privata (routes/routing.js filtra tutto per req.session.userId):
    // dopo lo scrub non ha piu' nessun lettore possibile - resterebbe solo a occupare spazio.
    await RouteDraft.deleteMany({ userId: user._id });
    await SavedRoute.deleteMany({ userId: user._id });

    // Le tracce GPS: il contenuto "sociale" di un'uscita e' la card (data, distanza,
    // dislivello, titolo), NON la polilinea grezza - che rivelerebbe gli spostamenti e le
    // partenze da casa di chi ha CHIESTO la cancellazione. Si svuota la geometria, la
    // didascalia e la pubblicazione nel feed; i totali della card restano.
    await ActiveHikeSession.updateMany(
        { userId: user._id },
        { $set: { points: [] }, $unset: { offTrailBuffer: 1, publishedAt: 1, caption: 1 } }
    );

    // I follow, in entrambe le direzioni: senza, un account eliminato resta "seguibile" e
    // le sue (ex) tracce resterebbero raggiungibili da un follower via
    // GET /api/tracking/sessions/:id/points (che chiede solo l'esistenza di un Follow).
    await Follow.deleteMany({ $or: [{ followerId: user._id }, { followingId: user._id }] });

    // M-4 (revisione sicurezza 27ª): inviti/richieste pendenti su documenti di TERZI.
    // Nessuno potra' mai accettarli (l'account non esiste piu') e restano a puntare a una
    // persona che ha CHIESTO la cancellazione - sotto GDPR art. 17 e' dato residuo, e per il
    // creatore di quella squadra/escursione il conteggio "N non hanno ancora risposto" non
    // torna mai a zero. Speculare al DELETE /:id/invites/:userId di squads.js e hikes.js.
    await Squad.updateMany({ pendingInvites: user._id }, { $pull: { pendingInvites: user._id } });
    await Squad.updateMany({ pendingRequests: user._id }, { $pull: { pendingRequests: user._id } });
    await Hike.updateMany({ pendingInvites: user._id }, { $pull: { pendingInvites: user._id } });
    await Hike.updateMany({ pendingApproval: user._id }, { $pull: { pendingApproval: user._id } });

    // I deleteMany/updateMany qui sopra sono idempotenti: contano per il chiamante solo se
    // e' stato QUESTO giro a fare lo scrub (non un ping simultaneo arrivato un istante prima).
    return esito.modifiedCount > 0;
}

// Vista pubblica di un account eliminato (in grazia o gia' scrubato): nessun dato
// personale, per NESSUNO. Forma minima compatibile con quello che il client si aspetta
// da GET /api/users (chiave `id`, come il transform globale di toJSON in db/mongo.js).
// reputation/experienceLevel neutri: alcuni punti del client li stampano senza guardia
// ("Rep: undefined%"), e un undefined a schermo e' un modo per distinguere a occhio i
// tombstone.
function serializzaUtentePubblico(user) {
    return {
        id: String(user._id),
        deleted: true,
        username: NOME_ELIMINATO,
        avatar: '👤',
        reputation: 50,
        experienceLevel: 'Principiante'
    };
}

// Un account "eliminato" agli occhi del sito: in grazia (pendingDeletionAt) o gia'
// scrubato (deletedAt).
function eliminato(user) {
    return !!(user && (user.pendingDeletionAt || user.deletedAt));
}

// L'unico modo lecito di trasformare un documento User in un nome da mostrare a terzi:
// per un account eliminato ritorna "Account eliminato", mai lo username vero (grazia) ne'
// il token interno (dopo lo scrub). Il documento va letto includendo i campi di stato
// (.select('username pendingDeletionAt deletedAt')).
function nomeVisibile(user) {
    if (!user) return null;
    return eliminato(user) ? NOME_ELIMINATO : user.username;
}

module.exports = {
    GIORNI_GRAZIA,
    NOME_ELIMINATO,
    escursioniFutureDaCreatore,
    riassegnaAdminSquadre,
    avviaEliminazione,
    ripristinaAccount,
    scrubAccount,
    serializzaUtentePubblico,
    eliminato,
    nomeVisibile,
    oggiRomaISO
};
