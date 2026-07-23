const { mongoose } = require('../db/mongo');

// Sostituisce il vecchio array db._reviewLocks: un documento per blocco, con indice
// unico sull'hash. Cosi' due richieste simultanee non possono piu' aggirare il
// controllo anti-doppia-recensione (con l'array in JSON era tecnicamente possibile).
const reviewLockSchema = new mongoose.Schema({
    lockHash: { type: String, required: true, unique: true }
});

module.exports = mongoose.models.ReviewLock || mongoose.model('ReviewLock', reviewLockSchema);
