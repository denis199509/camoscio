const { mongoose } = require('../db/mongo');

const reportSchema = new mongoose.Schema({
    type: { type: String, enum: ['frana', 'ghiaccio', 'fontana_secca', 'ostacolo'], required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    description: String,
    // Punto 45: 'pending' finche' un moderatore non la conferma. Il default e' fail-closed
    // per qualunque creazione futura che dimenticasse di specificare lo stato - oggi non
    // cambia nulla in pratica: sia POST /api/reports sia scripts/seed-atlas.js impostano
    // sempre lo stato esplicitamente.
    status: { type: String, enum: ['pending', 'active', 'resolved'], default: 'pending' },
    // Chi ha segnalato: puo' restare vuoto per segnalazioni pre-Fase-C o volutamente anonime
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
