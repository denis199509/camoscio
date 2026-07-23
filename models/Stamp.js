const { mongoose } = require('../db/mongo');

const stampSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    stampId: { type: String, required: true }, // codice del timbro (es. "stamp_mezzeno"), non un ID Mongo
    dateUnlocked: { type: String } // "YYYY-MM-DD", stesso formato usato oggi dal frontend
});

// Un utente puo' sbloccare lo stesso timbro una sola volta (prima era un controllo .some() a mano)
stampSchema.index({ userId: 1, stampId: 1 }, { unique: true });

module.exports = mongoose.models.Stamp || mongoose.model('Stamp', stampSchema);
