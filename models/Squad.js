const { mongoose } = require('../db/mongo');

const squadSchema = new mongoose.Schema({
    // maxlength (A-1, revisione sicurezza 27ª): senza tetto il nome finisce dentro una
    // notifica PER OGNI invitato (routes/squads.js, applicaInviti -> Notification.insertMany,
    // fino a 50 per chiamata) e una sola POST /api/squads con un `name` da 9,9 MB riempirebbe
    // i 512 MB di Atlas (vincolo hard). 80 e' larghissimo per un nome squadra. Il tetto vero
    // e' comunque nella rotta (trim + slice): lo schema non lo applica sui findByIdAndUpdate.
    name: { type: String, required: true, maxlength: 80 },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Il creatore NON e' duplicato qui dentro: e' admin per calcolo (creatorId), non per dato salvato.
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    photo: { type: String, default: null }, // data URL base64, stesso formato di User.profilePhoto
    // Punto 75: richieste di entrare in una squadra gia' esistente, in attesa che un
    // amministratore (uno qualunque) confermi o rifiuti - stesso principio di
    // Hike.pendingApproval, spostato su Squad/admins invece che su Hike/creatore.
    pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Consenso squadra (27ª sessione): l'altra direzione di pendingRequests - "un admin ha
    // invitato, decide LA PERSONA". Nessuno entra in `members` senza una delle due
    // direzioni (chiedere+essere approvati, o essere invitati+accettare). Specchio di
    // Hike.pendingInvites.
    // default: undefined e NON [] (vincolo hard spazio): a riposo una squadra non ha inviti
    // aperti, e quando l'ultimo risponde il campo si $unset. Ogni lettura: (squad.pendingInvites || []).
    // NB: members/admins/pendingRequests restano array semplici con default [] - non si
    // allineano (sarebbe una migrazione su tutti i documenti per zero guadagno). Il vincolo
    // vale sui campi NUOVI.
    pendingInvites: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: undefined }
});

module.exports = mongoose.models.Squad || mongoose.model('Squad', squadSchema);
