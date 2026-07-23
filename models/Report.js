const { mongoose } = require('../db/mongo');

const reportSchema = new mongoose.Schema({
    type: { type: String, enum: ['frana', 'ghiaccio', 'fontana_secca', 'ostacolo'], required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    description: String,
    status: { type: String, default: 'active' },
    // Chi ha segnalato: puo' restare vuoto per segnalazioni pre-Fase-C o volutamente anonime
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
