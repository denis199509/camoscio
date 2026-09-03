// Promozione automatica quando una squadra resta senza amministratori - estratta da
// lib/accountDeletion.js (riassegnaAdminSquadre) perche' ora la usa anche
// routes/squads.js (DELETE /:id/members/:userId, "lascia la squadra"). Una definizione
// sola: due copie della stessa regola divergerebbero in silenzio (lezione del punto 18).

const User = require('../models/User');
const Squad = require('../models/Squad');
const SquadMessage = require('../models/SquadMessage');

// Guarda cosa RESTA di una squadra dopo che qualcuno ha smesso di poterla amministrare
// (eliminazione account, o uscita volontaria). Se non c'e' nessun amministratore vivo si
// promuove il primo membro vivo in ordine d'iscrizione (l'ordine dell'array `members` -
// $addToSet in approvazione, vedi routes/squads.js). Se non c'e' nessun membro vivo la
// squadra si scioglie, con lo storico della sua chat.
//
// PRESUPPOSTI (li garantisce il chiamante): chi se n'e' andato e' gia' stato tolto da
// `squad.admins` (e, per "lascia la squadra", anche da `squad.members`); e per l'uscita
// del creatore il chiamante ha gia' passato `creatorId` al nuovo proprietario PRIMA di
// chiamare qui. Questa funzione NON tocca `creatorId`.
//
// `creatoreContaComeAdmin`: lo decide il chiamante. false quando e' il creatore stesso ad
// andarsene (eliminazione account) o quando il creatore e' un tombstone; true quando il
// creatore e' un altro utente vivo.
//
// Ritorna 'ok' (niente da fare), 'promosso' (nuovo admin) o 'sciolta' (squadra cancellata).
// Nei casi 'promosso' e 'sciolta' persiste da sola (squad.save() / deleteOne); nel caso
// 'ok' NON salva - il chiamante che aveva modificato `squad.admins` deve salvare lui.
async function promuoviSeSenzaAdmin(squad, creatoreContaComeAdmin) {
    if (creatoreContaComeAdmin || (squad.admins || []).length > 0) return 'ok';

    let promosso = null;
    if ((squad.members || []).length) {
        const vivi = await User.find({
            _id: { $in: squad.members },
            pendingDeletionAt: { $exists: false },
            deletedAt: { $exists: false }
        }).select('_id');
        const viviSet = new Set(vivi.map(u => String(u._id)));
        promosso = squad.members.find(m => viviSet.has(String(m))) || null;
    }

    if (promosso) {
        squad.admins.push(promosso);
        await squad.save();
        return 'promosso';
    }
    await Squad.deleteOne({ _id: squad._id });
    await SquadMessage.deleteMany({ squadId: squad._id });
    return 'sciolta';
}

module.exports = { promuoviSeSenzaAdmin };
