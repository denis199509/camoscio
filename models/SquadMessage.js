const { mongoose } = require('../db/mongo');

const squadMessageSchema = new mongoose.Schema({
    squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: { createdAt: true, updatedAt: false } });

// Ogni apertura della chat e ogni giro di polling leggono gli ultimi messaggi di UNA squadra
// ordinati per data: indice composto pensato apposta per quella query.
squadMessageSchema.index({ squadId: 1, createdAt: 1 });

module.exports = mongoose.models.SquadMessage || mongoose.model('SquadMessage', squadMessageSchema);
