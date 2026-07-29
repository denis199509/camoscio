// Logica dei token temporanei usa-e-getta, condivisa da tutti i loro impieghi:
// il recupero password (punto 7) e la verifica dell'indirizzo email.
//
// PERCHE' STA IN UN FILE SOLO: era scritta dentro routes/auth.js quando serviva a una
// cosa sola. Al momento di usarla una seconda volta e' stata estratta invece di copiata,
// per la lezione gia' pagata al punto 18 e scritta in cronologia.txt: quando lo stesso
// blocco compare due volte, la differenza fra le copie e' quasi sempre un difetto rimasto
// aperto in una sola. Qui le righe in questione sono il confronto delle impronte e il
// controllo di scadenza - cioe' proprio quelle dove un difetto non si vede finche' non fa
// danno.
//
// Nessuna libreria: crypto e' dentro Node.

const crypto = require('crypto');

// 256 bit dal generatore crittografico di Node: non indovinabile.
// base64url perche' il token finisce dentro un indirizzo web.
function generaToken() {
    return crypto.randomBytes(32).toString('base64url');
}

// Del token si salva SOLO l'impronta, mai il valore in chiaro: se il database finisse
// nelle mani sbagliate, da un'impronta non si torna indietro al token.
function impronta(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Cerca il documento di un token e ne verifica la validita'.
 * Ritorna il documento se e' buono, null altrimenti (assente, malformato o scaduto).
 *
 * LA SCADENZA SI RICONTROLLA QUI e non ci si affida solo alla cancellazione automatica
 * di MongoDB: quella passa ogni ~60 secondi, quindi un token scaduto puo' restare sul
 * database fino a un minuto in piu'. Senza questo controllo, per quel minuto varrebbe.
 * L'indice TTL fa le pulizie; la guardia e' questa funzione.
 *
 * @param {import('mongoose').Model} Modello  PasswordReset oppure EmailVerification
 * @param {string} token                      il token in chiaro arrivato dal link
 * @param {number} durataSecondi              quanto vale, secondo il modello
 */
async function trovaValido(Modello, token, durataSecondi) {
    // Il controllo sulla lunghezza scarta subito valori vuoti o palesemente inventati,
    // senza nemmeno interrogare il database.
    if (typeof token !== 'string' || token.length < 20) return null;

    const documento = await Modello.findOne({ tokenHash: impronta(token) });
    if (!documento) return null;

    const eta = Date.now() - new Date(documento.createdAt).getTime();
    if (eta > durataSecondi * 1000) {
        await Modello.deleteOne({ _id: documento._id }); // scaduto: si toglie subito
        return null;
    }
    return documento;
}

/**
 * Crea un token nuovo per un utente, ANNULLANDO quelli che aveva gia'.
 * Ne vale sempre uno solo per volta: cosi' un link vecchio rimasto in una casella smette
 * di funzionare appena se ne chiede un altro.
 * Ritorna il token in chiaro - l'unica volta in cui esiste fuori dall'email.
 */
async function creaToken(Modello, userId) {
    await Modello.deleteMany({ userId });
    const token = generaToken();
    await Modello.create({ userId, tokenHash: impronta(token) });
    return token;
}

module.exports = { generaToken, impronta, trovaValido, creaToken };
