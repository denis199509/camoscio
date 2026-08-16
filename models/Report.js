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
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Punto 45 (foto): Buffer e non stringa base64 (~25% piu' leggero, mai costruito in RAM
    // se non richiesto). select:false come passwordHash - non deve uscire nelle liste
    // (GET /, GET /pending), solo dalla rotta dedicata GET /:id/photo. NON vale pero' per il
    // documento appena creato da Report.create() nella stessa richiesta: va tolta a mano
    // prima di res.json() li' (vedi routes/reports.js).
    photo: { type: Buffer, select: false },
    // Derivato, scritto solo alla creazione: default: undefined come canModerateReports in
    // User.js (vincolo spazio) - la maggioranza delle segnalazioni non ha foto.
    hasPhoto: { type: Boolean, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

// Punto 45 (foto): chi non viene mai risolta (confermata poi "risolta" cancella per intero,
// vedi DELETE /:id/resolve - non esiste piu' uno stato 'resolved' persistente) sparisce da
// sola dopo 30 giorni. Nessun cron/script a parte: e' Mongo stesso a cancellare il
// documento in background quando createdAt supera la soglia.
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
