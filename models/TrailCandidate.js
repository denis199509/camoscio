const { mongoose } = require('../db/mongo');

// Fase G - Quando durante un'escursione un tratto consistente di GPS non passa vicino a
// NESSUN sentiero conosciuto (collezione Trail), viene salvato qui invece che scartato:
// e' un candidato per una futura mappatura manuale su OpenStreetMap ("se non hai il
// percorso, mappalo per le prossime volte", richiesta originale in cose_da_fare.txt).
//
// Stessa tupla compatta usata da ActiveHikeSession: [lng, lat, altitudineMetri,
// secondiDaInizio, precisioneMetri].
const trailCandidateSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveHikeSession', required: true },
    points: { type: [[Number]], required: true },
    detectedAt: { type: Date, default: Date.now },
    reviewed: { type: Boolean, default: false } // per una futura schermata di revisione manuale, non ancora richiesta
});

module.exports = mongoose.models.TrailCandidate || mongoose.model('TrailCandidate', trailCandidateSchema);
