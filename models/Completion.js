const { mongoose } = require('../db/mongo');

const completionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', required: true },
    dateCompleted: { type: Date, default: Date.now },
    actualTimeHours: { type: Number, default: null },
    // Punto 79: tempo di solo CAMMINO, separato dalle pause, letto da un .gpx quando la
    // traccia e' abbastanza fitta da distinguerle (lib/gpx.js, tempiTraccia). actualTimeHours
    // NON cambia significato - resta il tempo totale, pause comprese, esattamente come nei
    // documenti scritti prima di questo campo. default: undefined come deadManActive ecc.:
    // vincolo hard 1, quasi nessun completamento avra' un file gpx affidabile.
    movingTimeHours: { type: Number, default: undefined }
});

// Un utente puo' segnare la stessa escursione come completata una sola volta
// (prima era un controllo .some() a mano dentro la rotta)
completionSchema.index({ userId: 1, hikeId: 1 }, { unique: true });

module.exports = mongoose.models.Completion || mongoose.model('Completion', completionSchema);
