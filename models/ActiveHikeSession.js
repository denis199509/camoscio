const { mongoose } = require('../db/mongo');

// Fase F - Tracciamento GPS live. Collezione volutamente SEPARATA da "hikes": un
// aggiornamento continuo del percorso durante l'escursione non deve mai poter
// sovrascrivere per errore gli altri dati dell'escursione (titolo, partecipanti...).
//
// Ogni punto e' salvato come tupla compatta [lng, lat, altitudineMetri, secondiDaInizio,
// precisioneMetri] invece che come oggetto con chiavi ripetute per ogni punto: stesso
// contenuto, molto meno spazio (vincolo hard di cose_da_fare.txt).
const activeHikeSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', default: null },
    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
    startedAt: { type: Date, required: true, default: Date.now },
    lastPointAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    // Totali incrementali: aggiornati ad ogni gruppo di punti ricevuto invece di essere
    // ricalcolati dall'inizio ogni volta (fondamentale per restare performanti anche
    // su un'escursione di piu' ore con migliaia di punti).
    distanceKm: { type: Number, default: 0 },
    elevationGainM: { type: Number, default: 0 },
    points: { type: [[Number]], default: [] },
    // Presente (sempre true) solo mentre la sessione e' aperta (active/paused); rimosso
    // alla chiusura (vedi POST /:id/end). Serve per l'indice unico parziale sotto: un
    // utente non puo' avere due tracciamenti aperti insieme, e la stessa query serve
    // anche per "riprendi dopo ricaricamento" (GET /api/tracking/active).
    // NIENT'ALTRO default qui di proposito: /start lo imposta esplicitamente a true in
    // fase di creazione. Con un default a livello di schema, Mongoose lo rimetterebbe
    // a true ogni volta che legge un documento a cui e' stato tolto con $unset, facendo
    // sembrare "ancora aperta" (nella risposta JSON, non nel database) anche una
    // sessione gia' conclusa da tempo.
    openSession: { type: Boolean },
    // Tempo totale gia' passato in pausa + il momento in cui e' iniziata la pausa corrente
    // (null se non in pausa): serve per escludere le pause dal calcolo della durata, cosi'
    // il passo medio a fine escursione non viene falsato da una sosta lunga (es. pranzo).
    pausedMs: { type: Number, default: 0 },
    pausedAt: { type: Date, default: null }
});

activeHikeSessionSchema.index(
    { userId: 1, openSession: 1 },
    { unique: true, partialFilterExpression: { openSession: true } }
);

// Durata calcolata dal dato reale (ultimo punto ricevuto), non dall'orologio di sistema:
// se il telefono perde segnale o il browser viene chiuso, il tempo "conta" solo fino
// all'ultimo aggiornamento davvero arrivato. Il tempo in pausa (passato e, se la sessione
// e' in pausa proprio ora, anche quello in corso) viene escluso dal totale.
activeHikeSessionSchema.virtual('durationSeconds').get(function () {
    if (!this.startedAt) return 0;
    const end = this.endedAt || this.lastPointAt || new Date();

    let pausedTotalMs = this.pausedMs || 0;
    if (this.pausedAt && !this.endedAt) {
        pausedTotalMs += (Date.now() - this.pausedAt.getTime());
    }

    return Math.max(0, Math.round((end.getTime() - this.startedAt.getTime() - pausedTotalMs) / 1000));
});

// Non salvata su disco: si ricava da distanza e durata gia' salvate, non serve un campo dedicato.
activeHikeSessionSchema.virtual('avgSpeedKmh').get(function () {
    const hours = this.durationSeconds / 3600;
    if (!hours) return 0;
    return Math.round((this.distanceKm / hours) * 10) / 10;
});

module.exports = mongoose.models.ActiveHikeSession || mongoose.model('ActiveHikeSession', activeHikeSessionSchema);
