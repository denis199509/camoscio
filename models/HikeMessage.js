const { mongoose } = require('../db/mongo');

const hikeMessageSchema = new mongoose.Schema({
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: { createdAt: true, updatedAt: false } });

// Ogni apertura della chat e ogni giro di polling leggono gli ultimi messaggi di UNA
// escursione ordinati per data: indice composto pensato apposta per quella query (stesso
// principio di SquadMessage, punto 48).
hikeMessageSchema.index({ hikeId: 1, createdAt: 1 });

module.exports = mongoose.models.HikeMessage || mongoose.model('HikeMessage', hikeMessageSchema);
