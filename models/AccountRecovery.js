const { mongoose } = require('../db/mongo');

// RECUPERO DELL'ACCESSO SENZA SECONDO FATTORE (opzione C, decisione di Denis del 07/09/2026).
// Blocco 5 del piano: C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md (sez. 1b).
//
// Chi ha perso sia l'app authenticator sia tutti i codici di recupero puo' rientrare
// dimostrando SOLO di controllare la casella email - ma non subito: il recupero MATURA dopo
// DURATA_ATTESA_GIORNI, e in quei giorni il proprietario legittimo (che il 2FA ce l'ha
// ancora e continua a fare login) vede un avviso su OGNI pagina del sito e puo' annullarlo.
//
// L'ATTESA E' IL MECCANISMO. Senza, questa collezione sarebbe solo un modo per scavalcare il
// secondo fattore con la sola casella email - cioe' esattamente cio' che il 2FA deve impedire.
//
// MODELLO A SE' e non campi su User: (1) serve un indice TTL, e un TTL vive sul documento che
// deve morire (sui campi di User cancellerebbe l'utente); (2) tokenHash vuole un indice
// unique (su un campo sparso di users sarebbe un indice vuoto nel 99,99% dei casi, su una
// collezione gia' grande); (3) e' un PROCESSO, non un attributo della persona - lo stesso
// motivo per cui PasswordReset non e' un campo di User. Lo spazio NON e' un argomento (con
// default: undefined i campi su User costerebbero zero agli altri): considerato e scartato.

const DURATA_ATTESA_GIORNI = 14;      // quanto si aspetta prima che il link funzioni (D-7, Denis 08/09/2026)
const DURATA_FINESTRA_GIORNI = 7;     // per quanto resta utilizzabile DOPO la maturita'

const accountRecoverySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Impronta sha256 del token del link di completamento, MAI il token vero (come
    // PasswordReset). maturaIl invece NON si sposta MAI.
    tokenHash: { type: String, required: true, unique: true },

    createdAt: { type: Date, required: true, default: Date.now },

    // IL CAMPO PIU' IMPORTANTE DEL FILE, ed e' IMMUTABILE dopo la creazione. Se si potesse
    // spostare avanti, riavviare il recupero azzererebbe l'attesa; se si potesse spostare
    // indietro, l'attesa non ci sarebbe. Nessuna rotta lo riscrive: si scrive una volta sola
    // alla create() e da li' in poi si legge e basta (lib/recuperoAccount.js).
    maturaIl: { type: Date, required: true },

    // Annullato dal proprietario da una sessione che ha gia' passato il 2FA ('utente'),
    // OPPURE perche' l'utente ha ritrovato il telefono e ha spento il 2FA da se'
    // ('2fa-disattivato': il recupero non ha piu' oggetto). NON si cancella il documento:
    // cosi' un secondo tentativo non riparte da zero in silenzio, e resta la traccia di
    // quante volte e' successo. default: undefined - quasi nessuno viene annullato... o quasi
    // tutti, se qualcuno sta attaccando: in entrambi i casi il campo assente vale "no".
    annullatoIl: { type: Date, default: undefined },
    annullatoPerche: { type: String, enum: ['utente', '2fa-disattivato'], default: undefined },

    completatoIl: { type: Date, default: undefined },

    // PARACADUTE, non il meccanismo. La maturita' e la finestra si controllano NEL CODICE
    // (lezione di lib/tokens.js: "l'indice TTL fa le pulizie; la guardia e' la funzione").
    // DEFAULT VERO e non `undefined`, contro l'abitudine del vincolo hard 1: un documento
    // senza una data qui verrebbe SALTATO da Mongo e resterebbe immortale in silenzio - e'
    // scritto per esteso in models/Report.js righe 38-42. lib/recuperoAccount.js lo scrive
    // comunque esplicito (= maturaIl) su ogni creazione; questa default e' la rete di sotto.
    expiresAt: { type: Date, required: true, default: function () { return this.maturaIl; } }
});

// Muore DURATA_FINESTRA_GIORNI DOPO la maturita': con l'attesa a 14 il link e' usabile dal
// giorno 14 al 21, poi si ricomincia (e ricominciare vuol dire una nuova email nella
// casella, cioe' un altro avviso).
accountRecoverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: DURATA_FINESTRA_GIORNI * 24 * 60 * 60 });

const AccountRecovery = mongoose.models.AccountRecovery || mongoose.model('AccountRecovery', accountRecoverySchema);

// Costanti sul modello (come PasswordReset.DURATA_LINK_SECONDI): le usano la rotta, il testo
// dell'email e la schermata. Un posto solo, altrimenti l'email promette una data e il codice
// ne applica un'altra.
AccountRecovery.DURATA_ATTESA_GIORNI = DURATA_ATTESA_GIORNI;
AccountRecovery.DURATA_FINESTRA_GIORNI = DURATA_FINESTRA_GIORNI;

module.exports = AccountRecovery;
