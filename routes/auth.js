const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const router = express.Router();
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const EmailVerification = require('../models/EmailVerification');
const ScherzoDamiano = require('../models/ScherzoDamiano');
const { mongoose } = require('../db/mongo');
const { chiudiTutteLeSessioni } = require('../db/sessionStore');
const { trovaValido, creaToken } = require('../lib/tokens');
const totp = require('../lib/totp'); // secondo fattore TOTP (blocco 3 del piano 2FA)
const AccountRecovery = require('../models/AccountRecovery'); // recupero ritardato 2FA (blocco 5)
const { avviaOTrovaRecupero, trovaRecuperoUtilizzabile, recuperoVivoDi } = require('../lib/recuperoAccount');
const {
    inviaEmail, emailRecuperoPassword, emailRecuperoRitardato, emailVerificaIndirizzo, indirizzoBase,
    configurato: mailerConfigurato, inviiFunzionanti
} = require('../lib/mailer');
const { requireAuth } = require('../middleware/auth');
// A-2 (revisione sicurezza 21a): forza bruta su credenziali + bombardamento email.
// registrazioneLimiter (ALTO, follow-up revisione sicurezza 30ª): authLimiter da solo non
// basta qui, vedi il commento sul limiter.
const { authLimiter, emailLimiter, registrazioneLimiter, secondoFattoreLimiter, duefattoriLimiter, recuperoLimiter } = require('../middleware/rateLimit');
// Punto A-3.4: rientrare col login entro i 30 giorni annulla l'eliminazione dell'account.
const { ripristinaAccount } = require('../lib/accountDeletion');
// ALTO, follow-up revisione sicurezza (30ª): stesso buco di MEDIO-2/3 su Squad.photo.
const { validaFotoProfiloJpeg } = require('../lib/profilePhoto');

const MIN_PASSWORD = 8; // stessa regola della registrazione, in un posto solo

// Blocco 4 del piano 2FA: quanto vive il segreto PROVVISORIO di POST /2fa/setup prima che
// vada rigenerato. Ricontrollato NEL CODICE in /2fa/enable (niente TTL su questo campo: la
// lezione di lib/tokens.js vale anche senza indice - la guardia e' la funzione).
const PENDING_2FA_TTL_MS = 15 * 60 * 1000;
// Emittente mostrato dall'app authenticator (otpauth:// URI). Un valore solo, qui.
const EMITTENTE_2FA = 'Camoscio';

function calculateAge(birthDate) {
    const ms = Date.now() - new Date(birthDate).getTime();
    return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

// Scherzo per un amico di Denis: messaggio mostrato una volta sola a chi si registra con
// username "Damiano" (senza distinguere maiuscole/minuscole). L'interruttore vive su
// MongoDB (ScherzoDamiano, un solo documento con _id fisso), non sull'account stesso, cosi'
// Denis puo' provarlo con un account di prova e riarmarlo (scripts/riarma-scherzo-damiano.js)
// senza "bruciare" la sorpresa prima che arrivi l'amico vero.
const SCHERZO_DAMIANO_ID = 'benvenuto-damiano';
const MESSAGGIO_SCHERZO_DAMIANO = `ACCESSO NEGATO... Anzi no, fermi tutti!
Ci hai messo così tanto a registrarti che nel frattempo le montagne si sono erose di due centimetri.
E ti definisci pure un "amico"? A quest'ora avevamo già fatto la scalata dell'Everest, andata e ritorno tre volte! Quasi quasi ti revocavo l'accesso per manifesta pigrizia.
Comunque, incredibile ma vero: ce l'hai fatta. Benvenuto sul sito! Ora però vedi di non metterci sei mesi anche per allacciarti gli scarponi.`;

// Atomico: se qualcun altro scattasse nello stesso istante non si mostra due volte. Ritorna
// true solo alla registrazione che lo consuma per davvero (documento assente o usato:false).
async function consumaScherzoDamianoSeArmato() {
    try {
        await ScherzoDamiano.findOneAndUpdate(
            { _id: SCHERZO_DAMIANO_ID, usato: { $ne: true } },
            { $set: { usato: true, usatoIl: new Date() } },
            { upsert: true }
        );
        return true;
    } catch (e) {
        if (e.code === 11000) return false; // gia' scattato: l'upsert ha urtato il documento esistente
        throw e;
    }
}

// Registrazione utente reale (Fase C)
// registrazioneLimiter PRIMA di authLimiter, non dopo (giro agente sul fix ALTO
// User.profilePhoto): authLimiter ha skipSuccessfulRequests:true, quindi conta solo le
// risposte NON riuscite - un 429 di registrazioneLimiter e' una di quelle. Con l'ordine
// invertito (registrazioneLimiter dopo) ogni 429 di troppe registrazioni si sommava anche
// al secchio di authLimiter, condiviso con login/reset password/verifica email: misurato,
// bastavano 35 registrazioni per bloccare il LOGIN dello stesso IP per 15 minuti (dietro un
// NAT, es. wifi di un rifugio, di chiunque). Il piu' stretto va per primo nella catena.
router.post('/register', registrazioneLimiter, authLimiter, async (req, res) => {
    try {
        const {
            nome, cognome, email, password, birthDate, ageRange, termsAccepted,
            username, hikingLevel, interests, preferredDifficulty,
            geoPreferences, bio, profilePhoto,
            emergencyContacts, geolocationConsent, privacySetting
        } = req.body;

        // --- 1. Dati base (obbligatori) ---
        if (!nome || !cognome || !email || !password || !username) {
            return res.status(400).json({ error: 'Nome, cognome, email, password e username sono obbligatori' });
        }
        // R-2 (ri-review sicurezza, 3° giro): tetto in chiaro qui, oltre al maxlength di schema
        // (models/User.js). Questi tre campi finiscono nel "Ciao <nome>," delle email.
        if (String(nome).trim().length > 60 || String(cognome).trim().length > 60) {
            return res.status(400).json({ error: 'Nome o cognome troppo lungo (massimo 60 caratteri)' });
        }
        if (String(username).trim().length > 40) {
            return res.status(400).json({ error: 'Username troppo lungo (massimo 40 caratteri)' });
        }
        if (!validator.isEmail(String(email))) {
            return res.status(400).json({ error: 'Email non valida' });
        }
        if (String(password).length < MIN_PASSWORD) {
            return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri` });
        }
        if (!termsAccepted) {
            return res.status(400).json({ error: 'Devi accettare i Termini e la Privacy' });
        }
        if (!birthDate && !ageRange) {
            return res.status(400).json({ error: "Indica la data di nascita oppure una fascia d'età" });
        }
        if (birthDate && calculateAge(birthDate) < 18) {
            return res.status(400).json({ error: 'Devi avere almeno 18 anni per registrarti' });
        }

        // --- 7. Contatti di emergenza (obbligatorio, almeno 1) ---
        if (!Array.isArray(emergencyContacts) || emergencyContacts.length === 0) {
            return res.status(400).json({ error: 'Serve almeno un contatto di emergenza' });
        }
        // R-3 (ri-review sicurezza, 3° giro): il tetto (numero + lunghezza campi) valeva solo
        // per PUT /api/users/:id - un account NUOVO poteva nascere con N contatti e, armando il
        // Dead Man's Switch, far partire N email verso terzi. Stesso helper del PUT.
        const erroreContatti = User.validaContattiEmergenza(emergencyContacts);
        if (erroreContatti) {
            return res.status(400).json({ error: erroreContatti });
        }
        for (const c of emergencyContacts) {
            // Il telefono non e' piu' fra i campi richiesti (16/08/2026): non viene piu'
            // chiesto in registrazione, e lo schema non lo pretende piu' (models/User.js).
            if (!c || !c.name || !c.relationship || !c.email) {
                return res.status(400).json({ error: 'Ogni contatto di emergenza richiede nome, relazione ed email' });
            }
            // Punto 37: l'email e' il canale scelto per l'allarme vero del Dead Man's Switch -
            // stessa validazione gia' usata sotto per l'email dell'account (validator.isEmail).
            if (!validator.isEmail(String(c.email))) {
                return res.status(400).json({ error: `Email non valida per il contatto "${c.name}"` });
            }
        }

        // ALTO, follow-up revisione sicurezza (30ª): il client ora comprime sempre in JPEG
        // (auth.js), quindi qui si valida il formato + i byte veri, non solo la lunghezza.
        // !== undefined/null, non un truthy check (giro agente, BASSO): una stringa vuota
        // andrebbe comunque rifiutata invece di scivolare silenziosamente a null sotto.
        if (profilePhoto !== undefined && profilePhoto !== null) {
            const v = validaFotoProfiloJpeg(profilePhoto);
            if (!v.ok) return res.status(400).json({ error: v.errore });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const normalizedUsername = String(username).trim();

        const emailTaken = await User.findOne({ email: normalizedEmail });
        if (emailTaken) {
            return res.status(409).json({ error: 'Email già registrata' });
        }
        const usernameTaken = await User.findOne({ username: normalizedUsername });
        if (usernameTaken) {
            return res.status(409).json({ error: 'Username già in uso' });
        }

        const passwordHash = await bcrypt.hash(String(password), 10);

        const user = await User.create({
            nome: String(nome).trim(),
            cognome: String(cognome).trim(),
            email: normalizedEmail,
            passwordHash,
            birthDate: birthDate || null,
            ageRange: birthDate ? null : ageRange,
            termsAcceptedAt: new Date(),
            username: normalizedUsername,
            hikingLevel: hikingLevel || null,
            interests: Array.isArray(interests) ? interests : [],
            preferredDifficulty: preferredDifficulty || null,
            geoPreferences: geoPreferences || {},
            bio: bio ? String(bio).slice(0, 250) : '',
            profilePhoto: profilePhoto || null,
            emergencyContacts,
            geolocationConsent: !!geolocationConsent,
            privacySetting: privacySetting || 'Pubblico',
            emailVerified: false, // si dimostra cliccando il link mandato qui sotto
            isDemoAccount: false
        });

        // L'INVIO NON PUO' FAR FALLIRE LA REGISTRAZIONE, ed e' una scelta esplicita
        // dell'utente (2026-07-28): "chi si registra entra subito". Entrare nel sito non
        // deve mai dipendere da un servizio esterno - se il servizio email si guasta,
        // registrarsi deve funzionare lo stesso. E l'account e' gia' creato: un errore
        // adesso mostrerebbe un messaggio di fallimento per una cosa riuscita, e la
        // persona riproverebbe trovando "email gia' registrata".
        // Stesso criterio gia' usato al punto 30 per l'assegnazione dei badge.
        // Chi non riceve l'email puo' comunque farsela rimandare dalla fascia in cima al
        // sito, quindi non resta bloccato in nessun caso.
        await mandaEmailDiVerifica(user).catch((e) => {
            console.error('Email di verifica non inviata (la registrazione e\' comunque riuscita):', e.message);
        });

        req.session.userId = user._id.toString();

        const risposta = user.toJSON();
        if (normalizedUsername.toLowerCase() === 'damiano' && await consumaScherzoDamianoSeArmato()) {
            risposta.scherzoBenvenuto = MESSAGGIO_SCHERZO_DAMIANO;
        }
        res.json(risposta);
    } catch (e) {
        if (e.code === 11000) {
            // B-1, giro agente sul fix BASSO: stesso principio del ramo ValidationError qui
            // sotto - console.error(e) intero avrebbe scritto l'email (o l'username) in
            // chiaro nel log (e.keyValue, aggiunto dal driver Mongo su un duplicato), con la
            // retention dei log di Render fuori dal nostro controllo. Solo il nome del campo.
            console.error('Errore registrazione (duplicato):', Object.keys(e.keyValue || {}));
            return res.status(409).json({ error: 'Email o username già in uso' });
        }
        if (e.name === 'ValidationError') {
            // BASSO, follow-up revisione sicurezza: e.message di Mongoose incorpora il VALORE
            // che ha fallito la validazione (es. "Cast to date failed for value ..."), non
            // solo il nome del campo. I campi piu' esposti (emergencyContacts compreso) sono
            // gia' controllati a mano sopra con messaggi sicuri; questo resta l'ultima rete,
            // per un campo che in futuro nascesse senza lo stesso controllo manuale (qui lo
            // dimostra gia' oggi un birthDate non valido). Messaggio generico al client, log
            // solo dei NOMI dei campi (mai il valore).
            console.error('Errore registrazione (validazione):', Object.keys(e.errors || {}));
            return res.status(400).json({ error: 'Dati non validi. Controlla i campi inseriti.' });
        }
        console.error('Errore registrazione:', e);
        res.status(500).json({ error: 'Errore interno durante la registrazione' });
    }
});

// CAS anti-riuso su twoFactorLastStep (RFC 6238 5.2): "morde" (ritorna true) solo se quel
// passo temporale non e' gia' stato speso. Update condizionale, mai leggi-poi-scrivi - due
// login nello stesso minuto, da telefono e computer, sono una corsa reale. Usato dal login,
// dal reset password e dalla rigenerazione codici: un posto solo. Blocco 3-4 del piano 2FA.
async function spendiPasso(userId, passo) {
    const r = await User.updateOne(
        { _id: userId, $or: [{ twoFactorLastStep: { $lt: passo } }, { twoFactorLastStep: { $exists: false } }] },
        { $set: { twoFactorLastStep: passo } }
    );
    return r.modifiedCount === 1;
}

// Verifica UN tentativo di secondo fattore (codice TOTP o codice di recupero) per `user`,
// che DEVE essere stato caricato con .select('+twoFactorSecret +twoFactorRecoveryHashes').
// Blocco 3 del piano 2FA. NON tocca la sessione ne' i contatori di tentativi: quelli li
// tiene il chiamante, e sono due (login -> req.session.pending2fa.tentativi; reset password
// -> PasswordReset.tentativi2fa). La parte che DECIDE se un codice e' buono sta qui, in un
// posto solo: due copie divergerebbero in silenzio (stessa lezione di
// usciteVisibili/uscitaVisibile e validaContattiEmergenza).
//   -> { ok: true, codiciRimasti? }   codiciRimasti valorizzato SOLO se si e' speso un
//                                      codice di recupero (il chiamante lo gira al client)
//   -> { ok: false, motivo: 'assente' | 'nonValido' | 'giaUsato' | 'segretoRotto' }
async function verificaSecondoFattore(user, corpo) {
    const code = typeof corpo.code === 'string' ? corpo.code.trim() : '';
    const recoveryCode = typeof corpo.recoveryCode === 'string' ? corpo.recoveryCode.trim() : '';
    if (!code && !recoveryCode) return { ok: false, motivo: 'assente' };

    if (code) {
        let esito;
        try {
            esito = totp.verificaCodice(user.twoFactorSecret, code);
        } catch (e) {
            // lib/totp.js LANCIA apposta se il segreto e' assente o troncato: un 2FA non
            // calcolabile non e' un "no". Qui si nega e si logga forte (campo corrotto, non
            // un errore dell'utente) - ma il throw NON deve risalire: un unhandledRejection
            // su Node 24 abbatte il processo, e con lui il Dead Man's Switch.
            // SOLO il prefisso di e.message, non il messaggio intero (revisione del cumulativo
            // 42a, BASSO): su un base32 corrotto lib/totp.js include il CARATTERE non valido
            // nel messaggio - un frammento del segreto non deve finire nei log di Render.
            console.error('2FA: segreto non verificabile per utente', String(user._id), '-', String(e.message).split(':')[0]);
            return { ok: false, motivo: 'segretoRotto' };
        }
        if (!esito.ok) return { ok: false, motivo: 'nonValido' };
        if (!(await spendiPasso(user._id, esito.passo))) return { ok: false, motivo: 'giaUsato' };
        return { ok: true };
    }

    // Codice di recupero: monouso per costruzione. $pull condizionale, un solo comando: due
    // richieste con lo stesso codice ne fanno passare UNA, e lo decide MongoDB.
    const impronta = totp.improntaCodiceRecupero(String(user._id), recoveryCode);
    const morso = await User.updateOne(
        { _id: user._id, twoFactorRecoveryHashes: impronta },
        { $pull: { twoFactorRecoveryHashes: impronta } }
    );
    if (morso.modifiedCount !== 1) return { ok: false, motivo: 'nonValido' };
    return { ok: true, codiciRimasti: Math.max(0, (user.twoFactorRecoveryHashes || []).length - 1) };
}

// Login reale (email + password)
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').toLowerCase().trim();

        const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Email o password non corretti' });
        }

        const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Email o password non corretti' });
        }

        // Punto A-3.4: account gia' scrubato -> come inesistente (l'email e' comunque
        // null dopo lo scrub, quindi non si arriva nemmeno qui: resta per sicurezza).
        if (user.deletedAt) {
            return res.status(401).json({ error: 'Email o password non corretti' });
        }

        // --- Secondo fattore TOTP (blocco 3 del piano 2FA) ---
        // Con il 2FA attivo la password NON basta: si apre uno stato intermedio in
        // req.session.pending2fa (5 minuti, max 5 tentativi) e si risponde
        // 200 { twoFactorRequired: true } SENZA nessun dato dell'utente - oggi /login
        // restituisce user.toJSON() (username, avatar, contatti di emergenza...), e chi
        // conosce la password ma non il codice non deve ricevere niente.
        // req.session.userId NON si scrive: e' l'unica chiave che guardano requireAuth,
        // GET /me e l'upgrade WebSocket del mesh, quindi non aprirla tiene chiusa tutta
        // l'app fino al secondo passo. ripristinaAccount() per un account in eliminazione si
        // sposta a POST /login/2fa (riportarlo in vita sulla sola password sarebbe
        // consegnarlo a chi il 2FA deve fermare). INERTE finche' nessuno accende il 2FA
        // (blocco 4). twoFactorEnabledAt non e' select:false: e' gia' caricato qui.
        if (user.twoFactorEnabledAt) {
            // BASSO (revisione del cumulativo 42a): se questa sessione era gia' autenticata
            // come un altro account (es. A loggato in un tab, prova ad accedere come B che ha
            // il 2FA), il ramo senza 2FA qui sotto SOVRASCRIVE session.userId - questo ramo no,
            // lasciando lo stato incoerente finche' il secondo passo non lo risolve. Nessuna
            // scalata di privilegi (nessuno guadagna un accesso che non aveva gia'), ma va
            // tolto comunque: e' l'unica rotta dove lo stato di sessione conta davvero.
            delete req.session.userId;
            req.session.pending2fa = {
                userId: user._id.toString(),
                scadenza: Date.now() + 5 * 60 * 1000,
                tentativi: 0,
                eraInEliminazione: !!user.pendingDeletionAt
            };
            return res.json({ twoFactorRequired: true });
        }

        // Punto A-3.4: account in eliminazione -> rientrare entro i 30 giorni la ANNULLA.
        const eraInEliminazione = !!user.pendingDeletionAt;
        if (eraInEliminazione) {
            await ripristinaAccount(user);
        }

        req.session.userId = user._id.toString();
        const risposta = user.toJSON();
        delete risposta.pendingDeletionAt;
        delete risposta.deletionScrubAt;
        if (eraInEliminazione) risposta.eliminazioneAnnullata = true;
        res.json(risposta);
    } catch (e) {
        console.error('Errore login:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Secondo passo del login, per chi ha il 2FA attivo (blocco 3 del piano 2FA).
// requireAuth NO: la sessione vera non e' ancora aperta - lo stato sta in
// req.session.pending2fa, scritto da POST /login. I 5 minuti e i 5 tentativi si
// ricontrollano QUI nel codice: le sessioni vivono su Mongo, sopravvivono a un riavvio di
// Render, e non c'e' nessuno scheduler che le faccia scadere.
// secondoFattoreLimiter PRIMA di authLimiter: vedi il commento sul limiter. INERTE finche'
// nessuno ha twoFactorEnabledAt.
router.post('/login/2fa', secondoFattoreLimiter, authLimiter, async (req, res) => {
    try {
        const pending = req.session && req.session.pending2fa;
        if (!pending || Date.now() > pending.scadenza || (pending.tentativi || 0) >= 5) {
            if (req.session) delete req.session.pending2fa;
            return res.status(401).json({ error: 'La sessione di accesso è scaduta: riscrivi email e password.', ripartiDaCapo: true });
        }

        const user = await User.findById(pending.userId).select('+twoFactorSecret +twoFactorRecoveryHashes');
        // Fra i due passi puo' essere cambiato tutto: si ricontrollano gli stati speciali.
        if (!user || user.deletedAt) {
            delete req.session.pending2fa;
            return res.status(401).json({ error: 'La sessione di accesso è scaduta: riscrivi email e password.', ripartiDaCapo: true });
        }

        let codiciRimasti;
        // Il 2FA puo' essersi SPENTO fra i due passi (un'altra scheda, o un recupero
        // ritardato completato - blocco 5). NON si fa passare senza ricontrollare (revisione
        // del cumulativo 42a, MEDIO-1): pending2fa nasce dalla password del PRIMO passo, e se
        // nel frattempo e' stata cambiata - esattamente quello che fa /recovery/complete,
        // insieme allo spegnimento del 2FA - quella prova non vale piu' niente. Lasciar
        // entrare qui vorrebbe dire accettare una credenziale gia' revocata: chi ha fatto il
        // primo passo con la password vecchia (magari un attaccante, mentre il proprietario
        // completava il recupero negli stessi 5 minuti) entrerebbe comunque. Si riparte da
        // capo: /login ricontrolla la password per davvero.
        if (!user.twoFactorEnabledAt) {
            delete req.session.pending2fa;
            return res.status(401).json({
                error: 'Il secondo fattore non è più attivo su questo account: riscrivi email e password.',
                ripartiDaCapo: true
            });
        }
        const v = await verificaSecondoFattore(user, req.body || {});
        if (!v.ok) {
            if (v.motivo === 'assente') {
                return res.status(401).json({ error: 'Serve il codice del secondo fattore.' });
            }
            // Un tentativo a vuoto vero: si conta. A 5 il prossimo giro riparte da capo.
            req.session.pending2fa.tentativi = (pending.tentativi || 0) + 1;
            return res.status(401).json({
                error: v.motivo === 'giaUsato'
                    ? 'Questo codice è già stato usato: aspetta quello nuovo.'
                    : 'Codice non valido.'
            });
        }
        if (v.codiciRimasti !== undefined) codiciRimasti = v.codiciRimasti;

        // Superato il secondo fattore: ORA, e solo ora, gli stati speciali del primo passo.
        if (pending.eraInEliminazione && user.pendingDeletionAt) {
            await ripristinaAccount(user);
        }

        delete req.session.pending2fa;
        // regenerate prima di userId: difesa da session fixation, come POST /reset-password.
        req.session.regenerate((err) => {
            if (err) {
                console.error('Errore rigenerazione sessione dopo il secondo fattore:', err);
                return res.status(500).json({ error: 'Errore interno' });
            }
            req.session.userId = user._id.toString();
            const risposta = user.toJSON();
            delete risposta.pendingDeletionAt;
            delete risposta.deletionScrubAt;
            if (pending.eraInEliminazione) risposta.eliminazioneAnnullata = true;
            if (codiciRimasti !== undefined) risposta.recoveryCodesRimasti = codiciRimasti;
            res.json(risposta);
        });
    } catch (e) {
        console.error('Errore login secondo fattore:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// =====================================================================================
// GESTIONE DEL SECONDO FATTORE (2FA TOTP) - blocco 4 del piano
// C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md
//
// Da QUI il 2FA si accende davvero: il blocco 3 (login/reset a due passi) e' gia' in
// piedi e finora inerte. Opt-in da Impostazioni -> Sicurezza, mai obbligatorio.
// =====================================================================================

// Guardia comune a tutte le /2fa/*: carica il proprio documento (con i campi 2FA
// select:false) e blocca i due casi in cui il secondo fattore non deve nemmeno esistere.
// I 4 account demo sono CONDIVISI e senza password: un 2FA acceso su "Marco Alpinista"
// renderebbe /demo inutilizzabile per chiunque, in modo definitivo (niente password da
// reimpostare, /forgot-password esce subito sui demo, e il recupero ritardato dell'opzione
// C richiede un token PasswordReset che per un demo non esiste). Nascondere il pannello
// lato client non basta: la rotta si chiama con una fetch da console.
// Ritorna il documento, oppure null DOPO aver gia' mandato la risposta d'errore.
async function caricaUtentePer2fa(req, res) {
    const user = await User.findById(req.session.userId).select(
        '+passwordHash +twoFactorSecret +twoFactorPending +twoFactorPendingAt +twoFactorLastStep +twoFactorRecoveryHashes'
    );
    if (!user) { res.status(401).json({ error: 'Non autenticato' }); return null; }
    if (user.isDemoAccount) {
        res.status(403).json({ error: 'Gli account demo non usano il secondo fattore.' });
        return null;
    }
    if (!user.passwordHash) {
        res.status(400).json({ error: 'Questo account non usa una password.' });
        return null;
    }
    return user;
}

// POST /api/auth/2fa/setup - avvia la configurazione: genera il segreto PROVVISORIO e
// restituisce segreto + otpauth:// URI per il QR. NON accende ancora niente (serve
// /2fa/enable con un codice valido).
router.post('/2fa/setup', requireAuth, duefattoriLimiter, async (req, res) => {
    try {
        const user = await caricaUtentePer2fa(req, res);
        if (!user) return;
        if (user.twoFactorEnabledAt) {
            return res.status(409).json({ error: 'Il secondo fattore è già attivo su questo account.' });
        }

        // Idempotente: se c'e' gia' un pending piu' giovane di 15 minuti si restituisce
        // QUELLO. Rigenerarlo a ogni chiamata farebbe si' che una seconda scheda invalidi il
        // QR appena inquadrato nella prima, e l'errore sarebbe "codice non valido" - il
        // messaggio che fa pensare di aver sbagliato a digitare.
        let segreto, pendingAtMs;
        const pendingVivo = user.twoFactorPending && user.twoFactorPendingAt
            && (Date.now() - new Date(user.twoFactorPendingAt).getTime()) < PENDING_2FA_TTL_MS;
        if (pendingVivo) {
            segreto = user.twoFactorPending;
            pendingAtMs = new Date(user.twoFactorPendingAt).getTime();
        } else {
            segreto = totp.generaSegretoBase32();
            pendingAtMs = Date.now();
            await User.updateOne(
                { _id: user._id },
                { $set: { twoFactorPending: segreto, twoFactorPendingAt: new Date(pendingAtMs) } }
            );
        }

        // Il segreto esce IN CHIARO: serve per la digitazione manuale quando la fotocamera
        // non collabora. etichetta ed emittente vengono percent-codificati da uriOtpauth.
        res.json({
            segreto,
            uri: totp.uriOtpauth({ segreto, etichetta: user.email || user.username, emittente: EMITTENTE_2FA }),
            scadeIl: new Date(pendingAtMs + PENDING_2FA_TTL_MS)
        });
    } catch (e) {
        console.error('Errore 2FA setup:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// POST /api/auth/2fa/enable - conferma un codice del segreto provvisorio e ACCENDE il 2FA.
// Restituisce i 10 codici di recupero: escono SOLO qui, e MAI in un console.log.
router.post('/2fa/enable', requireAuth, secondoFattoreLimiter, duefattoriLimiter, async (req, res) => {
    try {
        const user = await caricaUtentePer2fa(req, res);
        if (!user) return;
        if (user.twoFactorEnabledAt) {
            return res.status(409).json({ error: 'Il secondo fattore è già attivo su questo account.' });
        }
        // Password, non solo il codice (revisione del cumulativo 42a, MEDIO-2): senza,
        // l'asimmetria con /2fa/disable (che la chiede) era sfruttabile al contrario di come
        // serve - una sessione aperta rubata (telefono prestato, PC condiviso) poteva accendere
        // il 2FA sul proprio authenticator e chiudere fuori il proprietario vero, che si
        // ritrova senza codice per spegnerlo e come unica via il recupero ritardato (14 giorni).
        const { password } = req.body || {};
        const okPassword = typeof password === 'string' && password && await bcrypt.compare(password, user.passwordHash);
        if (!okPassword) {
            return res.status(401).json({ error: 'Password non corretta.' });
        }
        // D-4 (decisione di Denis, 08/09/2026): l'indirizzo email dev'essere confermato prima
        // di accendere il 2FA. Con l'opzione C l'email e' l'UNICA via di rientro se si perde
        // telefono + codici (recupero ritardato, blocco 5): un 2FA su un indirizzo mai
        // confermato = lockout permanente, non ricevera' mai un token di reset.
        if (!user.emailVerified) {
            return res.status(400).json({ error: "Conferma prima il tuo indirizzo email: è l'unica via per rientrare se perdi il telefono." });
        }
        // Scadenza del pending ricontrollata NEL CODICE (lezione di lib/tokens.js: la guardia
        // e' la funzione; qui non c'e' nemmeno un indice TTL a fare le pulizie).
        if (!user.twoFactorPending || !user.twoFactorPendingAt
            || (Date.now() - new Date(user.twoFactorPendingAt).getTime()) >= PENDING_2FA_TTL_MS) {
            // BASSO (revisione del cumulativo 42a): un pending scaduto non serve piu' a
            // nessuno - ripulirlo invece di lasciarlo sul documento a tempo indeterminato (chi
            // apre la configurazione e non la finisce se lo porterebbe dietro per sempre;
            // inutilizzabile senza /enable, ma resta materiale di credenziale dormiente).
            if (user.twoFactorPending) {
                await User.updateOne({ _id: user._id }, { $unset: { twoFactorPending: 1, twoFactorPendingAt: 1 } });
            }
            return res.status(400).json({ error: 'La configurazione è scaduta. Ricomincia dall\'inizio.' });
        }

        const { code } = req.body || {};
        const codice = typeof code === 'string' ? code.trim() : '';
        let esito;
        try {
            esito = totp.verificaCodice(user.twoFactorPending, codice);
        } catch (e) {
            console.error('2FA enable: segreto pending non verificabile per', String(user._id), '-', String(e.message).split(':')[0]);
            // Stesso motivo del ramo sopra: un pending corrotto non e' piu' recuperabile.
            await User.updateOne({ _id: user._id }, { $unset: { twoFactorPending: 1, twoFactorPendingAt: 1 } });
            return res.status(400).json({ error: 'La configurazione è scaduta. Ricomincia dall\'inizio.' });
        }
        if (!esito.ok) {
            // SOLO in attivazione: si dice di QUANTO e' sfasato l'orologio del telefono
            // invece di lasciare a indovinare. NON si accetta comunque (allargare la
            // finestra per comodita' e' il modo di indebolire il meccanismo senza accorgersene).
            let scartoMinuti;
            try {
                const passi = totp.scartoDiPasso(user.twoFactorPending, codice);
                if (passi !== null && passi !== 0) scartoMinuti = Math.round(passi * totp.PASSO_SECONDI / 60);
            } catch { /* segreto rotto: gia' gestito dal ramo esito qui sopra */ }
            return res.status(401).json(scartoMinuti ? { error: 'Codice non valido.', scartoMinuti } : { error: 'Codice non valido.' });
        }

        // UN SOLO updateOne: segreto + data + 10 impronte + il passo appena speso, e via il
        // pending. Cosi' non esiste nessuno stato intermedio "acceso ma senza codici".
        const codici = totp.generaCodiciRecupero();
        const attivoDal = new Date();
        await User.updateOne(
            { _id: user._id },
            {
                $set: {
                    twoFactorSecret: user.twoFactorPending,
                    twoFactorEnabledAt: attivoDal,
                    twoFactorRecoveryHashes: codici.map(c => totp.improntaCodiceRecupero(String(user._id), c)),
                    twoFactorLastStep: esito.passo
                },
                $unset: { twoFactorPending: 1, twoFactorPendingAt: 1 }
            }
        );
        res.json({ success: true, recoveryCodes: codici, attivoDal });
    } catch (e) {
        console.error('Errore 2FA enable:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// POST /api/auth/2fa/disable - spegne il 2FA. Servono password E secondo fattore (codice
// TOTP o codice di recupero). D-5: NON chiude le altre sessioni (come /change-password).
router.post('/2fa/disable', requireAuth, secondoFattoreLimiter, duefattoriLimiter, async (req, res) => {
    try {
        const user = await caricaUtentePer2fa(req, res);
        if (!user) return;
        if (!user.twoFactorEnabledAt) {
            return res.status(400).json({ error: 'Il secondo fattore non è attivo su questo account.' });
        }
        const { password } = req.body || {};
        const okPassword = typeof password === 'string' && password && await bcrypt.compare(password, user.passwordHash);
        if (!okPassword) {
            return res.status(401).json({ error: 'Password non corretta.' });
        }
        const v = await verificaSecondoFattore(user, req.body || {});
        if (!v.ok) {
            return res.status(401).json({
                error: v.motivo === 'giaUsato'
                    ? 'Questo codice è già stato usato: aspetta quello nuovo.'
                    : 'Codice del secondo fattore non valido.'
            });
        }
        // $unset di TUTTI i campi: un twoFactorRecoveryHashes sopravvissuto tornerebbe buono
        // alla riattivazione successiva - codici che l'utente crede morti e che invece aprono.
        await User.updateOne(
            { _id: user._id },
            { $unset: {
                twoFactorSecret: 1, twoFactorPending: 1, twoFactorPendingAt: 1,
                twoFactorEnabledAt: 1, twoFactorLastStep: 1, twoFactorRecoveryHashes: 1
            } }
        );
        // Opzione C (blocco 5): se c'era un recupero ritardato in corso, l'utente ha appena
        // ritrovato il telefono e spento il 2FA da se' - il recupero non ha piu' oggetto.
        // Lasciarlo maturare farebbe comparire un banner d'allarme per una cosa che non e'
        // piu' un pericolo: il modo migliore per insegnare alla gente a ignorare quel banner.
        // updateMany, non updateOne (revisione del cumulativo 42a, ALTO-3): avviaOTrovaRecupero
        // puo' lasciare per un istante piu' di un vivo (corsa non chiusa, lib/recuperoAccount.js)
        // - con updateOne ne restava annullato solo uno, e il secondo continuava a maturare
        // senza che ne restasse traccia visibile qui.
        await AccountRecovery.updateMany(
            { userId: user._id, annullatoIl: { $exists: false }, completatoIl: { $exists: false } },
            { $set: { annullatoIl: new Date(), annullatoPerche: '2fa-disattivato' } }
        );
        res.json({ success: true });
    } catch (e) {
        console.error('Errore 2FA disable:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// POST /api/auth/2fa/recovery-codes - rigenera i 10 codici di recupero, sostituendo l'intero
// array. D-3: serve password + codice TOTP, NON un codice di recupero al posto del TOTP (chi
// ha perso il telefono passa dalla disattivazione, dove il codice di recupero E' accettato).
router.post('/2fa/recovery-codes', requireAuth, secondoFattoreLimiter, duefattoriLimiter, async (req, res) => {
    try {
        const user = await caricaUtentePer2fa(req, res);
        if (!user) return;
        if (!user.twoFactorEnabledAt) {
            return res.status(400).json({ error: 'Il secondo fattore non è attivo su questo account.' });
        }
        const { password, code } = req.body || {};
        const okPassword = typeof password === 'string' && password && await bcrypt.compare(password, user.passwordHash);
        if (!okPassword) {
            return res.status(401).json({ error: 'Password non corretta.' });
        }
        const codice = typeof code === 'string' ? code.trim() : '';
        let esito;
        try {
            esito = totp.verificaCodice(user.twoFactorSecret, codice);
        } catch (e) {
            console.error('2FA recovery-codes: segreto non verificabile per', String(user._id), '-', String(e.message).split(':')[0]);
            return res.status(401).json({ error: 'Codice del secondo fattore non valido.' });
        }
        if (!esito.ok) {
            return res.status(401).json({ error: 'Codice del secondo fattore non valido.' });
        }
        if (!(await spendiPasso(user._id, esito.passo))) {
            return res.status(401).json({ error: 'Questo codice è già stato usato: aspetta quello nuovo.' });
        }
        const codici = totp.generaCodiciRecupero();
        await User.updateOne(
            { _id: user._id },
            { $set: { twoFactorRecoveryHashes: codici.map(c => totp.improntaCodiceRecupero(String(user._id), c)) } }
        );
        res.json({ success: true, recoveryCodes: codici });
    } catch (e) {
        console.error('Errore 2FA recovery-codes:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// =====================================================================================
// RECUPERO RITARDATO SENZA SECONDO FATTORE (opzione C) - blocco 5 del piano
//
// Chi ha perso app authenticator + tutti i codici di recupero rientra dimostrando SOLO di
// controllare la casella email - ma dopo un'ATTESA (AccountRecovery.DURATA_ATTESA_GIORNI),
// durante la quale il proprietario legittimo vede un banner su ogni pagina e puo' annullare.
// L'attesa + il banner SONO il meccanismo di sicurezza: l'email e' una cortesia (se la
// casella e' gia' compromessa, l'email di avviso la legge l'attaccante).
// =====================================================================================

// Messaggio a schermo per uno stato di trovaRecuperoUtilizzabile() diverso da 'ok'.
function messaggioStatoRecupero(stato) {
    switch (stato) {
        case 'nonMaturo':   return 'Questo link non è ancora attivo.';
        case 'scaduto':     return 'Questo link è scaduto: avvia un nuovo recupero dalla pagina "password dimenticata".';
        case 'annullato':   return 'Questo recupero è stato annullato.';
        case 'completato':  return 'Questo recupero è già stato completato.';
        default:            return 'Questo link non è valido.';
    }
}

// POST /api/auth/recovery/start - avvia il recupero. requireAuth NO (chi la chiama non puo'
// entrare per definizione). La prova che serve e' GIA' in mano a chi chiama: un token
// PasswordReset valido, cioe' il link arrivato nella casella. NON si accetta un'email nel
// body - sarebbe un modo per far partire un recupero contro chiunque conoscendone solo
// l'indirizzo, e il banner d'allarme diventerebbe uno strumento di molestia.
router.post('/recovery/start', recuperoLimiter, emailLimiter, async (req, res) => {
    try {
        const { token } = req.body || {};
        const documento = await trovaTokenRecupero(token);
        if (!documento) {
            return res.status(400).json({ error: 'Questo link non è più valido: potrebbe essere scaduto o già usato. Chiedine un altro.' });
        }
        const user = await User.findById(documento.userId);
        if (!user || user.deletedAt) {
            return res.status(400).json({ error: 'Questo link non è più valido. Chiedine un altro.' });
        }
        if (user.isDemoAccount) {
            return res.status(403).json({ error: 'Gli account demo non usano il secondo fattore.' });
        }
        if (!user.twoFactorEnabledAt) {
            return res.status(400).json({ error: 'Questo account non ha il secondo fattore attivo: puoi reimpostare la password direttamente.' });
        }

        const { recupero, token: tokenRecupero, gia } = await avviaOTrovaRecupero(user._id);
        if (gia) {
            // Gia' in corso: NESSUNA email, NESSUNO spostamento di maturaIl, NESSUN token nuovo.
            return res.json({ avviato: false, giaInCorso: true, maturaIl: recupero.maturaIl, avviatoIl: recupero.createdAt });
        }

        // L'email di avviso e' SINCRONA e il suo fallimento e' un ERRORE - unico punto del
        // progetto dove va detto, perche' e' CONTRO la regola di /register ("l'invio non puo'
        // far fallire"). Li' il ragionamento era: entrare nel sito non deve dipendere da un
        // servizio esterno. Qui e' il contrario: l'email E' meta' dell'avviso, e avviare in
        // silenzio un conto alla rovescia verso la presa di un account e' il vincolo hard 7
        // al rovescio. Se inviaEmail fallisce: si annulla la creazione e si risponde 503.
        const linkCompletamento = `${indirizzoBase()}/reimposta-password?recupero=${tokenRecupero}`;
        const dataMaturita = new Date(recupero.maturaIl).toLocaleString('it-IT', {
            timeZone: 'Europe/Rome',
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) + ' (ora italiana)';
        const { oggetto, testo, html } = emailRecuperoRitardato({
            nome: user.nome || user.username, dataMaturita, linkCompletamento
        });
        const partita = await inviaEmail({ a: user.email, oggetto, testo, html });
        if (!partita) {
            await AccountRecovery.deleteOne({ _id: recupero._id });
            return res.status(503).json({ error: "Non riusciamo a mandare l'email di avviso in questo momento. Riprova più tardi." });
        }

        // IL TOKEN PasswordReset NON SI CONSUMA: serve ancora - se l'utente ritrova i codici
        // di recupero nel frattempo puo' usare lo stesso link per il reset normale col 2FA.
        res.json({ avviato: true, maturaIl: recupero.maturaIl });
    } catch (e) {
        console.error('Errore avvio recupero ritardato:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// GET /api/auth/recovery/status - stato per il BANNER globale. requireAuth SI'.
// Rotta A SE' e non un campo dentro GET /me: refreshState() sostituisce currentUser con la
// versione di GET /api/users e perde i campi non portati (e' successo a profilePhoto, due
// sessioni per rimetterlo a posto). Un banner di SICUREZZA che sparisce da solo al primo
// refreshState e' peggio di un banner che non c'e' mai stato.
router.get('/recovery/status', requireAuth, async (req, res) => {
    try {
        const rec = await recuperoVivoDi(req.session.userId);
        if (!rec) return res.json({ inSospeso: false });
        res.json({ inSospeso: true, maturaIl: rec.maturaIl, avviatoIl: rec.createdAt });
    } catch (e) {
        console.error('Errore stato recupero:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// POST /api/auth/recovery/cancel - annulla. requireAuth SI', ed e' tutto il punto: questa
// sessione ha GIA' passato il 2FA. NON serve ne' la password ne' un codice TOTP: chi e'
// dentro ha gia' dimostrato entrambi all'apertura, e questa e' l'azione DIFENSIVA - metterci
// un attrito significa che qualcuno, di fretta, non la completa. L'asimmetria e' voluta:
// avviare costa, annullare e' gratis. NON si cancella il documento (la storia e' informazione).
// updateMany, non updateOne (revisione del cumulativo 42a, ALTO-3): stesso motivo del commento
// gemello in /2fa/disable qui sopra - la corsa non chiusa di avviaOTrovaRecupero() puo'
// lasciare per un istante piu' di un recupero vivo, e questo e' IL bottone difensivo
// dell'opzione C: deve spegnerli tutti, non uno a caso.
router.post('/recovery/cancel', requireAuth, duefattoriLimiter, async (req, res) => {
    try {
        const esito = await AccountRecovery.updateMany(
            { userId: req.session.userId, annullatoIl: { $exists: false }, completatoIl: { $exists: false } },
            { $set: { annullatoIl: new Date(), annullatoPerche: 'utente' } }
        );
        if (esito.modifiedCount < 1) {
            return res.status(404).json({ error: 'Nessun recupero da annullare.' });
        }
        res.json({ annullato: true });
    } catch (e) {
        console.error('Errore annullamento recupero:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// POST (non GET) /api/auth/recovery/check - nessuna autenticazione. A differenza della
// gemella /reset-password/check (token da un'ora, GET va bene), qui il token vale fino a 21
// giorni e chi lo usa ottiene password nuova + 2FA spento + tutte le sessioni chiuse: un
// token cosi' prezioso non deve finire in una query string, dove i log HTTP della piattaforma,
// i referrer e i proxy di mezzo lo conserverebbero (revisione del cumulativo 42a, MEDIO-4). Lo
// chiama solo JS (reimposta-password.html), nessuna navigazione del browser dipende dal GET.
// Lo STATO distinto ('nonMaturo' + maturaIl) permette alla pagina di dire "questo link
// funzionera' dal <data>" invece di "link non valido" (falso, e farebbe buttare via un link
// ancora buono).
router.post('/recovery/check', async (req, res) => {
    try {
        const { stato, maturaIl } = await trovaRecuperoUtilizzabile(req.body && req.body.token);
        res.json(maturaIl ? { stato, maturaIl } : { stato });
    } catch (e) {
        console.error('Errore verifica link recupero:', e);
        res.json({ stato: 'assente' });
    }
});

// POST /api/auth/recovery/complete - { token, password }. La maturita' si controlla QUI,
// pigramente, nel momento in cui l'utente segue il link. NESSUNO SCHEDULER.
router.post('/recovery/complete', authLimiter, async (req, res) => {
    try {
        const { token, password } = req.body || {};
        if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
            return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri` });
        }

        // bcrypt.hash PRIMA del CAS (revisione del cumulativo 42a, BASSO): non dipende dal suo
        // esito, e togliendolo dalla finestra fra "CAS riuscito" e "utente aggiornato" si
        // accorcia il tratto in cui un errore in mezzo (findById, ripristinaAccount) lascia il
        // recupero segnato completatoIl senza aver davvero cambiato niente - chi lo trova cosi'
        // deve rifare 14 giorni di attesa per un link che, di fatto, ha gia' usato.
        const nuovoHash = await bcrypt.hash(password, 10);

        const { stato, recupero } = await trovaRecuperoUtilizzabile(token);
        if (stato !== 'ok') {
            return res.status(400).json({ stato, error: messaggioStatoRecupero(stato) });
        }

        // CAS PRIMA di toccare l'utente: rende il completamento IDEMPOTENTE (come
        // scrubAccount) e fa in modo che il pezzo IRREVERSIBILE (password + 2FA spento +
        // sessioni chiuse) lo esegua UN SOLO chiamante. Se due richieste con lo stesso token
        // arrivano insieme, qui ne passa una e lo decide MongoDB.
        const marcato = await AccountRecovery.updateOne(
            { _id: recupero._id, completatoIl: { $exists: false } },
            { $set: { completatoIl: new Date() } }
        );
        if (marcato.modifiedCount !== 1) {
            return res.status(400).json({ stato: 'completato', error: messaggioStatoRecupero('completato') });
        }

        const user = await User.findById(recupero.userId);
        if (!user || user.deletedAt) {
            // Il recupero e' gia' marcato completato sopra: non resta vivo. Un account
            // scrubato non si recupera.
            return res.status(400).json({ error: 'Questo link non è più valido.' });
        }
        if (user.pendingDeletionAt) {
            // Come login e reset: seguire questo link E' un percorso di accesso a tutti gli
            // effetti, quindi annulla l'eliminazione in corso.
            await ripristinaAccount(user);
        }

        // UN SOLO updateOne: nuova password + IL 2FA SI SPEGNE. Non e' un effetto
        // collaterale, e' il senso: chi arriva qui ha dimostrato di NON poter usare il 2FA.
        // Lasciarlo acceso = consegnare una password nuova su un account che continua a
        // chiedere un codice che nessuno sa produrre, cioe' rifare il lockout che questo
        // intero meccanismo esiste per evitare.
        await User.updateOne({ _id: user._id }, {
            $set: { passwordHash: nuovoHash },
            $unset: {
                twoFactorSecret: 1, twoFactorPending: 1, twoFactorPendingAt: 1,
                twoFactorEnabledAt: 1, twoFactorLastStep: 1, twoFactorRecoveryHashes: 1
            }
        });

        // I link di reset in giro non valgono piu'.
        await PasswordReset.deleteMany({ userId: user._id });

        // IL MOMENTO CHE NON SI TORNA INDIETRO: se a completare e' l'attaccante, il vero
        // proprietario viene buttato fuori da tutti i dispositivi, con la password cambiata e
        // il 2FA spento. Se a completare e' il vero proprietario, succede lo stesso
        // all'attaccante. NON c'e' modo di distinguerli: e' la conseguenza accettata
        // dell'opzione C, e il motivo per cui i giorni di banner sono l'unica difesa che conta.
        await chiudiTutteLeSessioni(user._id);

        req.session.regenerate((err) => {
            if (err) {
                console.error('Errore rigenerazione sessione dopo il recupero:', err);
                // La password NUOVA e' gia' salvata: non e' un fallimento, va solo rifatto
                // l'accesso a mano.
                return res.json({ success: true, loggedIn: false });
            }
            req.session.userId = user._id.toString();
            res.json({ success: true, loggedIn: true });
        });
    } catch (e) {
        console.error('Errore completamento recupero:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

// Elenco pubblico dei soli account demo (nessun login richiesto): usato dalla pagina /demo
// per disegnare i 4 pulsanti. Espone solo i campi innocui, mai email/contatti/ecc.
router.get('/demo-accounts', async (req, res) => {
    const demoUsers = await User.find({ isDemoAccount: true }).select('username avatar experienceLevel trainingGoal');
    res.json(demoUsers);
});

// Login demo: nessuna password, funziona SOLO per i 4 account storici isDemoAccount:true
router.post('/demo-login', async (req, res) => {
    try {
        // Convalida il formato PRIMA di passarlo alla query: senza questo controllo un valore
        // non stringa (es. {"$ne": null}) verrebbe comunque interpretato da Mongoose come
        // operatore di query invece che come ID letterale (bug trovato in Fase H). Qui
        // l'impatto pratico e' minimo (i 4 account demo sono gia' tutti pubblici e senza
        // password), ma resta comunque scorretto fidarsi cosi' di un valore mandato dal client.
        if (typeof req.body.userId !== 'string' || !mongoose.isValidObjectId(req.body.userId)) {
            return res.status(400).json({ error: 'Richiesta non valida' });
        }
        const user = await User.findOne({ _id: req.body.userId, isDemoAccount: true });
        if (!user) {
            return res.status(404).json({ error: 'Account demo non trovato' });
        }
        req.session.userId = user._id.toString();
        res.json(user);
    } catch (e) {
        res.status(400).json({ error: 'Richiesta non valida' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Errore durante il logout:', err);
            return res.status(500).json({ error: 'Errore durante il logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Chi sono (usato dal frontend all'avvio per sapere se c'e' gia' una sessione valida)
router.get('/me', async (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Non autenticato' });
    }
    // .select('+profilePhoto') (MEDIO, follow-up revisione sicurezza): il campo e' select:false
    // a schema per tenerlo fuori da GET /api/users (lista), ma questa rotta restituisce SOLO
    // il proprio documento - nessun rischio RAM/privacy a riportarlo qui, ed e' il punto dove
    // il client popola currentUser all'avvio (app.js, checkAuthAndShowGate).
    // +twoFactorRecoveryHashes (MEDIO-5, revisione del cumulativo 42a): serve SOLO per
    // contare, mai per esporre l'array - vedi piu' sotto.
    const user = await User.findById(req.session.userId).select('+profilePhoto +twoFactorRecoveryHashes');
    if (!user) {
        return req.session.destroy(() => res.status(401).json({ error: 'Non autenticato' }));
    }
    // Punto A-3.4: account in eliminazione o gia' scrubato -> una sessione superstite non
    // rientra senza passare dal login (che, entro i 30 giorni, annulla l'eliminazione).
    if (user.pendingDeletionAt || user.deletedAt) {
        return req.session.destroy(() => res.status(401).json({ error: 'Non autenticato' }));
    }
    const risposta = user.toJSON();
    // MEDIO-5: il piano (§7) prevedeva un avviso quando i codici di recupero scarseggiano, ma
    // nessuna rotta lo esponeva fuori dalla risposta del login - chi non fa un login a due
    // passi dopo averli consumati (es. li rigenera e poi li usa da un'altra sessione) non lo
    // scopriva mai, fino a perdere anche il telefono: il momento in cui non puo' piu' farci
    // niente. SOLO il conteggio: user.toJSON() ha gia' tolto twoFactorRecoveryHashes (i dati
    // sensibili non attraversano mai questa risposta, nemmeno per un istante nel corpo JSON).
    if (user.twoFactorEnabledAt && Array.isArray(user.twoFactorRecoveryHashes)) {
        risposta.recoveryCodesRimasti = user.twoFactorRecoveryHashes.length;
    }
    res.json(risposta);
});

// =====================================================================================
// RECUPERO E CAMBIO PASSWORD (punto 7 di cose_da_fare.txt)
//
// COME FUNZIONA, in breve: si chiede il recupero indicando la propria email, arriva un
// link che vale UN'ORA e UNA VOLTA SOLA, il link porta a una pagina dove si sceglie la
// password nuova. Finche' non se ne sceglie una nuova, quella vecchia continua a
// funzionare - quindi un link ricevuto e ignorato non fa nessun danno.
//
// PERCHE' UN LINK E NON UNA PASSWORD GENERATA E SPEDITA (che era l'idea iniziale):
//  1) con la password rigenerata subito, chiunque conosca l'indirizzo email di una
//     persona puo' far smettere di funzionare la sua password senza nemmeno avere
//     accesso alla sua casella: non entra al posto suo, ma lo lascia fuori;
//  2) una password mandata per email resta scritta nella casella finche' non si cambia;
//  3) in Fase C si era deciso "email SOLO SALVATA, nessuna verifica reale", quindi
//     nessuno ha mai dimostrato di possedere l'indirizzo scritto in registrazione. Col
//     link quel problema si risolve da solo: CLICCARE IL LINK E' LA PROVA di possedere
//     la casella, e chi ha sbagliato a digitare l'indirizzo semplicemente non riceve
//     niente e non subisce nessun danno.
// =====================================================================================

// --- Freno anti-abuso -----------------------------------------------------------------
// Senza, chiunque puo' far arrivare a raffica email di recupero nella casella di un altro
// (le riceve lui, non chi le ordina) e consumare la quota giornaliera del servizio.
// Sta IN MEMORIA di proposito: nessuna dipendenza nuova e nessuna scrittura sul database
// per una cosa che vale un'ora. LIMITE NOTO E ACCETTATO: un riavvio del server - su Render
// gratuito succede dopo un periodo di inattivita' - azzera il conteggio. E' scritto qui
// invece che nascosto: per quello che deve fermare (l'abuso ripetuto, non l'attacco
// organizzato) va piu' che bene.
// Il tetto che conta e' quello per INDIRIZZO EMAIL: e' quello che difende la casella di
// una persona dall'essere riempita. Quello per IP serve solo a fermare chi prova tanti
// indirizzi diversi, ed e' tenuto largo di proposito: dietro un solo indirizzo IP ci puo'
// essere un'intera rete (casa, ufficio, wi-fi di un rifugio), e un tetto stretto
// bloccherebbe persone che non c'entrano niente fra loro. Misurato facendo le prove: con
// 10 bastavano tre giri di verifica dallo stesso computer per esaurirlo.
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 30;
const FINESTRA_MS = 60 * 60 * 1000;
const tentativiRecupero = new Map();

function troppiTentativi(chiave, massimo) {
    const adesso = Date.now();

    // Pulizia opportunistica: senza, la mappa crescerebbe per sempre.
    for (const [k, orari] of tentativiRecupero) {
        const vivi = orari.filter((t) => adesso - t < FINESTRA_MS);
        if (vivi.length === 0) tentativiRecupero.delete(k);
        else tentativiRecupero.set(k, vivi);
    }

    const orari = tentativiRecupero.get(chiave) || [];
    if (orari.length >= massimo) return true;
    orari.push(adesso);
    tentativiRecupero.set(chiave, orari);
    return false;
}

// La logica dei token (generazione, impronta, controllo di scadenza, uso singolo) sta
// in lib/tokens.js: la usano sia il recupero password sia la verifica dell'indirizzo,
// e una copia per ciascuno vorrebbe dire due controlli di scadenza che possono divergere.
function trovaTokenRecupero(token) {
    return trovaValido(PasswordReset, token, PasswordReset.DURATA_LINK_SECONDI);
}

function trovaTokenVerifica(token) {
    return trovaValido(EmailVerification, token, EmailVerification.DURATA_LINK_SECONDI);
}

// Crea il link di conferma dell'indirizzo e lo manda. Usata in tre punti: alla
// registrazione, quando si chiede di rimandarla, e quando si chiede il recupero password
// di un account non ancora confermato.
// Ritorna true se l'email e' partita davvero.
async function mandaEmailDiVerifica(user) {
    const token = await creaToken(EmailVerification, user._id);
    const link = `${indirizzoBase()}/conferma-email?token=${token}`;
    const { oggetto, testo, html } = emailVerificaIndirizzo({
        nome: user.nome || user.username,
        link,
        durataOre: Math.round(EmailVerification.DURATA_LINK_SECONDI / 3600)
    });
    return inviaEmail({ a: user.email, oggetto, testo, html });
}

// Passo 1: si chiede il link.
router.post('/forgot-password', emailLimiter, async (req, res) => {
    // RISPOSTA SEMPRE IDENTICA, qualunque cosa succeda dopo. Se dicesse "questa email non
    // risulta registrata", quel modulo diventerebbe uno strumento per scoprire chi e'
    // iscritto al sito provando indirizzi a caso - e nessuno ha scelto di rendere pubblica
    // quell'informazione. Vale anche quando l'invio fallisce: l'esito e' nel log del
    // server, non a schermo.
    //
    // FINCHE' LA CHIAVE DELL'INVIO NON E' CONFIGURATA, pero', quel messaggio direbbe il
    // FALSO: prometterebbe un'email che non puo' partire, e chi la aspetta resterebbe li'
    // a controllare la casella. E' lo stesso criterio gia' applicato al Dead Man's Switch
    // (punto 21: "la finestra NON dice piu' il falso") e al dislivello dei percorsi
    // progettati (punto 13: meglio dire che non si puo' sapere, che inventare un numero).
    // Non svela niente su chi e' iscritto: e' uno stato del sito, uguale per tutti.
    // Tre stati, non due. Avere le chiavi non vuol dire riuscire a spedire: il servizio
    // puo' rifiutare (account non ancora validato, mittente non confermato, quota finita)
    // o essere irraggiungibile, e allora "ti abbiamo mandato un'email" e' di nuovo falso.
    // Lo stato di salute e' GLOBALE e non dipende da chi sta chiedendo: vedi il commento
    // in lib/mailer.js sul perche' l'esito della singola richiesta non si puo' usare senza
    // trasformare questo modulo in un elenco degli iscritti.
    let rispostaGenerica;
    if (!mailerConfigurato()) {
        rispostaGenerica = {
            disponibile: false,
            message: "Il recupero password non è ancora attivo su questo sito: l'invio delle email non è configurato, quindi nessun link può partire. La tua password di adesso continua a funzionare."
        };
    } else if (!inviiFunzionanti()) {
        rispostaGenerica = {
            disponibile: false,
            message: "In questo momento non riusciamo a mandare email, quindi il link non può partire. Riprova fra un po'. La tua password di adesso continua a funzionare."
        };
    } else {
        rispostaGenerica = {
            disponibile: true,
            message: "Se quell'indirizzo è registrato, ti abbiamo mandato un'email con il link per reimpostare la password. Controlla anche la posta indesiderata."
        };
    }

    try {
        const email = String(req.body && req.body.email || '').toLowerCase().trim();
        if (!email || !validator.isEmail(email)) {
            return res.json(rispostaGenerica); // nemmeno il formato sbagliato deve distinguersi
        }

        const ip = req.ip || 'sconosciuto';
        if (troppiTentativi(`email:${email}`, MAX_PER_EMAIL) || troppiTentativi(`ip:${ip}`, MAX_PER_IP)) {
            return res.json(rispostaGenerica);
        }

        const user = await User.findOne({ email }).select('+passwordHash');

        // I 4 account demo si usano senza password dalla pagina /demo, quindi non hanno
        // niente da recuperare. Chi non ha una passwordHash idem. In tutti e due i casi la
        // risposta resta quella di sopra: da fuori non si distingue nulla.
        if (!user || user.isDemoAccount || !user.passwordHash) {
            return res.json(rispostaGenerica);
        }

        // INDIRIZZO NON ANCORA CONFERMATO: si manda l'email di CONFERMA invece di quella
        // di reimpostazione. E' il motivo per cui esiste la verifica: finche' nessuno ha
        // dimostrato di possedere questa casella, mandarci dentro un link che cambia la
        // password vorrebbe dire consegnare l'account a chiunque essa sia.
        // NON si risponde "devi prima confermare": la risposta a schermo resta IDENTICA,
        // altrimenti si scoprirebbe dall'esterno quali indirizzi sono registrati e in che
        // stato. E non si tace nemmeno: senza mandare niente, una persona in buona fede
        // aspetterebbe per sempre un'email che non arriva. L'email di conferma le dice
        // cosa fare e la riporta esattamente dove voleva andare.
        if (!user.emailVerified) {
            await mandaEmailDiVerifica(user);
            return res.json(rispostaGenerica);
        }

        // creaToken annulla i link precedenti: NE VALE UNO SOLO PER VOLTA, cosi' un link
        // vecchio rimasto in una casella non resta buono.
        const token = await creaToken(PasswordReset, user._id);

        const link = `${indirizzoBase()}/reimposta-password?token=${token}`;
        const { oggetto, testo, html } = emailRecuperoPassword({
            nome: user.nome || user.username,
            link,
            durataMinuti: Math.round(PasswordReset.DURATA_LINK_SECONDI / 60)
        });

        await inviaEmail({ a: user.email, oggetto, testo, html });
        res.json(rispostaGenerica);
    } catch (e) {
        console.error('Errore richiesta recupero password:', e);
        res.json(rispostaGenerica); // nemmeno un guasto interno deve dire qualcosa di piu'
    }
});

// Passo 2: la pagina chiede "questo token vale ancora?" prima di mostrare il modulo.
// Risponde solo si'/no: nessun dato dell'utente esce da qui, perche' chi ha il token non
// ha ancora dimostrato niente - lo dimostra usandolo.
router.get('/reset-password/check', async (req, res) => {
    try {
        const documento = await trovaTokenRecupero(req.query.token);
        if (!documento) return res.json({ valid: false });
        // Blocco 3 del piano 2FA: se l'utente ha il secondo fattore attivo, la pagina deve
        // mostrare il campo del codice dal primo istante invece di far compilare tutto e poi
        // rifiutare (il modo migliore per far credere che il link sia rotto). Non e' una
        // fuga: chi interroga questa rotta HA GIA' il token, cioe' controlla la casella, e
        // lo scoprirebbe un attimo dopo con la POST.
        const u = await User.findById(documento.userId).select('twoFactorEnabledAt');
        res.json({ valid: true, twoFactorRequired: !!(u && u.twoFactorEnabledAt) });
    } catch (e) {
        console.error('Errore verifica token recupero:', e);
        res.json({ valid: false });
    }
});

// Passo 3: si sceglie la password nuova.
// SENZA secondoFattoreLimiter (tolto qui nella revisione del cumulativo 42a, deviazione d):
// prima di validare il token non esiste ne' pending2fa ne' session.userId, quindi la sua
// chiave per-persona sarebbe comunque ricaduta sull'IP - condividerlo con /login/2fa apriva
// solo un modo per far ricevere 429 sul login a due passi di un altro utente sullo stesso
// NAT. Il freno vero sul codice 2FA qui e' tentativi2fa (5 per link, vedi piu' sotto).
router.post('/reset-password', authLimiter, async (req, res) => {
    try {
        const { token, password } = req.body || {};

        if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
            return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri` });
        }

        const documento = await trovaTokenRecupero(token);
        if (!documento) {
            return res.status(400).json({ error: 'Questo link non è più valido: potrebbe essere scaduto o già usato. Chiedine un altro.' });
        }

        const user = await User.findById(documento.userId).select('+twoFactorSecret +twoFactorRecoveryHashes');
        if (!user) {
            await PasswordReset.deleteOne({ _id: documento._id });
            return res.status(400).json({ error: 'Questo link non è più valido. Chiedine un altro.' });
        }

        // Punto A-3.4: account gia' scrubato -> il link non vale piu' (l'email e' comunque
        // null, quindi il token non dovrebbe nemmeno esistere: difesa in profondita').
        if (user.deletedAt) {
            await PasswordReset.deleteOne({ _id: documento._id });
            return res.status(400).json({ error: 'Questo link non è più valido. Chiedine un altro.' });
        }

        // --- Secondo fattore TOTP (blocco 3 del piano 2FA) ---
        // Con il 2FA attivo il link da solo non reimposta niente: serve anche il codice
        // (TOTP o di recupero). Il TOKEN RESTA INTATTO su un 2FA mancante o sbagliato - una
        // cifra storta non deve costringere a rifare tutto il giro dell'email (tetto 3/ora
        // per indirizzo). Si cancella dopo 5 tentativi a vuoto (tentativi2fa sul
        // PasswordReset): e' L'UNICO freno sui tentativi di codice qui (niente
        // secondoFattoreLimiter su questa rotta, vedi il commento sulla rotta piu' sopra) -
        // senza, un link da solo varrebbe come indovinare un TOTP con tempo illimitato.
        // ripristinaAccount() resta PIU' SOTTO, dopo questo controllo: annullare
        // l'eliminazione e' un atto da login a tutti gli effetti, non lo si fa sulla sola
        // casella. INERTE finche' nessuno accende il 2FA (blocco 4).
        if (user.twoFactorEnabledAt) {
            const v = await verificaSecondoFattore(user, req.body || {});
            if (!v.ok) {
                if (v.motivo === 'assente') {
                    return res.status(401).json({ twoFactorRequired: true });
                }
                const aggiornato = await PasswordReset.findOneAndUpdate(
                    { _id: documento._id }, { $inc: { tentativi2fa: 1 } }, { new: true }
                );
                if (!aggiornato || (aggiornato.tentativi2fa || 0) >= 5) {
                    await PasswordReset.deleteOne({ _id: documento._id });
                    return res.status(400).json({ error: 'Troppi tentativi con un codice non valido: chiedi un nuovo link.' });
                }
                return res.status(401).json({
                    twoFactorRequired: true,
                    error: v.motivo === 'giaUsato'
                        ? 'Questo codice è già stato usato: aspetta quello nuovo.'
                        : 'Codice non valido.'
                });
            }
        }

        // Account in eliminazione: dimostrare di possedere la casella E scegliere una
        // password nuova vale quanto un login -> l'eliminazione si ANNULLA. Senza, chi ha
        // dimenticato la password userebbe questo link, si ritroverebbe dentro credendo di
        // aver annullato, e 30 giorni dopo perderebbe comunque i dati (vincolo hard 7).
        if (user.pendingDeletionAt) {
            await ripristinaAccount(user);
        }

        // updateOne e non save(): save() rivaliderebbe TUTTO il documento, quindi un campo
        // rimasto irregolare da qualche versione precedente del modello farebbe fallire un
        // cambio password che non c'entra niente. Qui si scrive solo il campo che cambia.
        await User.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(password, 10) } });

        // USA E GETTA: il link smette di funzionare subito dopo l'uso, come richiesto.
        await PasswordReset.deleteOne({ _id: documento._id });

        // Si chiudono TUTTE le sessioni gia' aperte di questo utente, su qualunque
        // dispositivo. Se la password era stata rubata, cambiarla senza cacciare fuori chi
        // era gia' dentro non servirebbe a niente: resterebbe collegato finche' vuole.
        // Va fatto PRIMA di aprire quella nuova, altrimenti si chiuderebbe da solo.
        await chiudiTutteLeSessioni(user._id);

        // E poi lo si fa entrare: ha appena dimostrato di possedere la casella e conosce la
        // password nuova, chiedergli di riscriverla subito sarebbe solo un passaggio in piu'.
        req.session.regenerate((err) => {
            if (err) {
                console.error('Errore rigenerazione sessione dopo il cambio password:', err);
                // La password NUOVA e' gia' salvata: non e' un fallimento, va solo rifatto
                // l'accesso a mano. Dirgli "errore" e basta lo farebbe riprovare col link,
                // che ormai non c'e' piu'.
                return res.json({ success: true, loggedIn: false });
            }
            req.session.userId = user._id.toString();
            res.json({ success: true, loggedIn: true });
        });
    } catch (e) {
        console.error('Errore reimpostazione password:', e);
        res.status(500).json({ error: 'Errore interno durante il cambio password' });
    }
});

// Cambio password per chi e' gia' dentro e quella vecchia se la ricorda.
// Non esisteva NESSUNA schermata per farlo: senza, l'unico modo di cambiare la password
// era fingere di averla dimenticata.
router.post('/change-password', authLimiter, requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
            return res.status(400).json({ error: `La nuova password deve avere almeno ${MIN_PASSWORD} caratteri` });
        }

        // L'utente e' SEMPRE quello della sessione, mai un id mandato dal client (stessa
        // regola applicata a tutte le rotte in Fase C).
        const user = await User.findById(req.session.userId).select('+passwordHash');
        if (!user) {
            return res.status(401).json({ error: 'Devi effettuare il login' });
        }
        if (!user.passwordHash) {
            // I 4 account demo entrano senza password: non ce n'e' una da cambiare.
            return res.status(400).json({ error: 'Questo account non usa una password.' });
        }

        // Si chiede comunque quella vecchia: senza, chi trovasse un computer lasciato
        // aperto potrebbe prendersi l'account cambiando la password in due click.
        const corretta = await bcrypt.compare(String(currentPassword || ''), user.passwordHash);
        if (!corretta) {
            return res.status(401).json({ error: 'La password attuale non è corretta' });
        }
        if (newPassword === String(currentPassword)) {
            return res.status(400).json({ error: 'La nuova password è uguale a quella attuale' });
        }

        await User.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(newPassword, 10) } });

        // QUI NON si chiudono le altre sessioni, a differenza del recupero: chi cambia la
        // password sapendo quella vecchia sta facendo manutenzione, non cacciando un
        // intruso, e disconnettergli il telefono sarebbe solo una seccatura.
        res.json({ success: true });
    } catch (e) {
        console.error('Errore cambio password:', e);
        res.status(500).json({ error: 'Errore interno durante il cambio password' });
    }
});

// =====================================================================================
// VERIFICA DELL'INDIRIZZO EMAIL (chiesta dall'utente il 2026-07-28)
//
// A COSA SERVE: in Fase C si era deciso "email SOLO SALVATA, nessuna verifica reale",
// quindi nessuno aveva mai dimostrato di possedere l'indirizzo scritto in registrazione.
// Col recupero password (punto 7) quel buco e' diventato concreto: chi scrive per sbaglio
// l'indirizzo di un'ALTRA persona le consegna la possibilita' di prendersi l'account.
//
// COSA RISOLVE DAVVERO, detto senza esagerare: RIDUCE il problema, non lo elimina. Se
// l'indirizzo e' di un altro, quello riceve la conferma e - se la clicca - puo' comunque
// prendersi l'account. La differenza vera e' che NON SUCCEDE PIU' IN SILENZIO: chi
// sbaglia a digitare non riceve niente e se ne accorge subito, invece di avere un account
// apparentemente sano che qualcun altro puo' reclamare mesi dopo.
//
// SI ENTRA COMUNQUE SENZA AVER CONFERMATO, per scelta esplicita dell'utente: entrare nel
// sito non deve mai dipendere da un servizio esterno. Quello che NON si puo' fare senza
// conferma e' il recupero password - vedi /forgot-password piu' sopra.
// =====================================================================================

// La pagina chiede "questo link vale ancora?" prima di dire qualunque cosa.
// Risponde solo si'/no, come la gemella del recupero password.
router.get('/verify-email/check', async (req, res) => {
    try {
        const documento = await trovaTokenVerifica(req.query.token);
        res.json({ valid: !!documento });
    } catch (e) {
        console.error('Errore verifica token email:', e);
        res.json({ valid: false });
    }
});

// Conferma vera e propria.
// NON RICHIEDE DI ESSERE COLLEGATI: il link puo' arrivare sul telefono mentre ci si era
// registrati dal computer, e chiedere di entrare prima renderebbe la conferma un giro a
// vuoto. Il token stesso e' la prova che serve.
// E NON FA ENTRARE NEL SITO: dimostrare di avere una casella non e' dimostrare di
// conoscere la password. Chi clicca il link da un dispositivo altrui non deve trovarsi
// dentro l'account.
router.post('/verify-email', authLimiter, async (req, res) => {
    try {
        const documento = await trovaTokenVerifica(req.body && req.body.token);
        if (!documento) {
            return res.status(400).json({ error: 'Questo link non è più valido: potrebbe essere scaduto o già usato. Puoi fartene mandare un altro dal sito.' });
        }

        const user = await User.findById(documento.userId);
        if (!user) {
            await EmailVerification.deleteOne({ _id: documento._id });
            return res.status(400).json({ error: 'Questo link non è più valido.' });
        }

        // updateOne e non save(): save() rivaliderebbe tutto il documento, e un campo
        // rimasto irregolare da una versione precedente del modello farebbe fallire una
        // conferma che non c'entra niente. Stesso motivo del punto 7.
        await User.updateOne({ _id: user._id }, { $set: { emailVerified: true } });

        // USA E GETTA, come il link di recupero.
        await EmailVerification.deleteOne({ _id: documento._id });

        res.json({ success: true });
    } catch (e) {
        console.error('Errore conferma indirizzo email:', e);
        res.status(500).json({ error: 'Errore interno durante la conferma' });
    }
});

// "Rimanda l'email": il pulsante della fascia in cima al sito.
// Qui requireAuth ha senso (a differenza della conferma): chi lo preme e' gia' dentro, e
// l'indirizzo si prende dalla sessione invece che da quello che manda il client -
// altrimenti diventerebbe un modo per far arrivare email a chiunque.
router.post('/resend-verification', emailLimiter, requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(401).json({ error: 'Devi effettuare il login' });
        }
        if (user.isDemoAccount || !user.email) {
            return res.status(400).json({ error: 'Questo account non ha un indirizzo email da confermare.' });
        }
        if (user.emailVerified) {
            return res.json({ success: true, message: 'Il tuo indirizzo è già confermato.' });
        }

        // Stesso freno del recupero password: senza, il pulsante diventerebbe un modo per
        // riempire la propria casella e consumare la quota giornaliera del servizio.
        if (troppiTentativi(`verifica:${user._id}`, MAX_PER_EMAIL)) {
            return res.status(429).json({ error: "Hai già chiesto l'email poche volte fa. Controlla anche la posta indesiderata, e riprova fra un'ora." });
        }

        if (!inviiFunzionanti()) {
            return res.status(503).json({ error: "In questo momento non riusciamo a mandare email. Riprova più tardi: puoi continuare a usare il sito." });
        }

        // L'ESITO SI CHIEDE A CHI SPEDISCE, non si indovina prima guardando la
        // configurazione. Un controllo preventivo su mailerConfigurato() qui sembrava
        // innocuo e invece faceva divergere due strade che mandano LA STESSA email: la
        // registrazione usava il ripiego sul terminale, questa lo rifiutava. Due
        // comportamenti diversi per la stessa cosa sono sempre un difetto in agguato in
        // uno dei due (lezione del punto 18, vedi cronologia.txt).
        const partita = await mandaEmailDiVerifica(user);
        if (!partita) {
            return res.status(503).json({ error: "Non siamo riusciti a mandare l'email. Riprova fra un po'." });
        }

        res.json({ success: true, message: "Ti abbiamo mandato l'email. Controlla anche la posta indesiderata." });
    } catch (e) {
        console.error('Errore invio email di verifica:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
});

module.exports = router;
