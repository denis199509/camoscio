const { mongoose } = require('../db/mongo');

const completionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', required: true },
    dateCompleted: { type: Date, default: Date.now },
    actualTimeHours: { type: Number, default: null }
});

// Un utente puo' segnare la stessa escursione come completata una sola volta
// (prima era un controllo .some() a mano dentro la rotta)
completionSchema.index({ userId: 1, hikeId: 1 }, { unique: true });

module.exports = mongoose.models.Completion || mongoose.model('Completion', completionSchema);
