const { mongoose } = require('../db/mongo');

// Durata di un link di recupero password (punto 7 di cose_da_fare.txt): un'ora,
// come richiesto esplicitamente dall'utente. Sta qui e non sparso nelle rotte
// perche' la usano in tre: la scadenza automatica di MongoDB (sotto), il
// controllo nel codice e il testo dell'email.
const DURATA_LINK_SECONDI = 60 * 60;

const passwordResetSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // IMPRONTA SHA-256 del token, MAI il token vero. Il token in chiaro esiste solo
    // dentro il link mandato via email: se un giorno questo database finisse nelle
    // mani sbagliate, i documenti qui dentro non permetterebbero di entrare in
    // nessun account - da un'impronta non si torna indietro al token.
    tokenHash: { type: String, required: true, unique: true },

    // expires crea da solo l'indice TTL: MongoDB cancella il documento un'ora dopo
    // averlo creato, senza nessun lavoro periodico da scrivere e senza lasciare
    // residui sul database (vincolo hard sullo spazio).
    // ATTENZIONE: il cancellatore automatico di MongoDB passa ogni ~60 secondi, quindi
    // un documento puo' sopravvivere fino a un minuto oltre la scadenza. La scadenza
    // va percio' RICONTROLLATA NEL CODICE al momento dell'uso (vedi routes/auth.js):
    // la cancellazione automatica fa le pulizie, non la guardia.
    createdAt: { type: Date, default: Date.now, expires: DURATA_LINK_SECONDI }
});

const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);
PasswordReset.DURATA_LINK_SECONDI = DURATA_LINK_SECONDI;

module.exports = PasswordReset;
