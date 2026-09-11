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
    createdAt: { type: Date, default: Date.now, expires: DURATA_LINK_SECONDI },

    // Tentativi di SECONDO FATTORE falliti su QUESTO link di reset (blocco 3 del piano 2FA:
    // POST /reset-password quando l'utente ha twoFactorEnabledAt). default: undefined
    // (vincolo hard 1): nasce solo se qualcuno sbaglia davvero, con $inc. A quota 5 il link
    // viene cancellato ("chiedine un altro"): e' il tetto vero contro chi prova a indovinare
    // il codice - il rate limiter da solo lascerebbe passare ~80 tentativi per link (un'ora
    // di validita', 20 tentativi ogni 15 minuti). Al 10/09/2026 (blocco 2) nessuna rotta lo
    // scrive ancora. Vedi C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md sez. 6.
    tentativi2fa: { type: Number, default: undefined }
});

const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);
PasswordReset.DURATA_LINK_SECONDI = DURATA_LINK_SECONDI;

module.exports = PasswordReset;
