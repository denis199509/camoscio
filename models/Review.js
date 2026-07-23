const { mongoose } = require('../db/mongo');

// Rigorosamente anonima: NESSUN campo reviewerId qui, per design (vedi models/ReviewLock.js
// per come si impedisce comunque la doppia recensione senza rompere l'anonimato).
const reviewSchema = new mongoose.Schema({
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    punctuality: { type: Number, min: 1, max: 5, required: true },
    equipment: { type: Number, min: 1, max: 5, required: true },
    respect: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '' }
});

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);
