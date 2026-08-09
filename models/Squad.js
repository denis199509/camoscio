const { mongoose } = require('../db/mongo');

const squadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Il creatore NON e' duplicato qui dentro: e' admin per calcolo (creatorId), non per dato salvato.
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    photo: { type: String, default: null }, // data URL base64, stesso formato di User.profilePhoto
    // Punto 75: richieste di entrare in una squadra gia' esistente, in attesa che un
    // amministratore (uno qualunque) confermi o rifiuti - stesso principio di
    // Hike.pendingApproval, spostato su Squad/admins invece che su Hike/creatore.
    pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.models.Squad || mongoose.model('Squad', squadSchema);
