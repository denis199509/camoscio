const { mongoose } = require('../db/mongo');

// Durata di un link di conferma dell'indirizzo email: VENTIQUATTRO ORE, non un'ora come
// il recupero password. Non e' una svista: un recupero password lo si chiede mentre si e'
// davanti allo schermo, e tenerlo corto riduce la finestra in cui un link intercettato
// varrebbe qualcosa. Una conferma invece arriva quando arriva - magari la sera, e la si
// apre la mattina dopo - e farla scadere in un'ora vorrebbe dire costringere quasi tutti
// a chiederne un'altra.
const DURATA_LINK_SECONDI = 24 * 60 * 60;

const emailVerificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // IMPRONTA SHA-256 del token, MAI il token vero: stesso ragionamento scritto per
    // models/PasswordReset.js. La logica sta in lib/tokens.js, condivisa dai due.
    tokenHash: { type: String, required: true, unique: true },

    // expires crea da solo l'indice TTL: MongoDB cancella il documento da solo dopo 24 ore.
    // ATTENZIONE: il cancellatore automatico passa ogni ~60 secondi, quindi la scadenza va
    // RICONTROLLATA NEL CODICE al momento dell'uso - lo fa trovaValido() in lib/tokens.js.
    createdAt: { type: Date, default: Date.now, expires: DURATA_LINK_SECONDI }
});

const EmailVerification = mongoose.models.EmailVerification || mongoose.model('EmailVerification', emailVerificationSchema);
EmailVerification.DURATA_LINK_SECONDI = DURATA_LINK_SECONDI;

module.exports = EmailVerification;
