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
const {
    inviaEmail, emailRecuperoPassword, emailVerificaIndirizzo, indirizzoBase,
    configurato: mailerConfigurato, inviiFunzionanti
} = require('../lib/mailer');
const { requireAuth } = require('../middleware/auth');
// A-2 (revisione sicurezza 21a): forza bruta su credenziali + bombardamento email.
// registrazioneLimiter (ALTO, follow-up revisione sicurezza 30ª): authLimiter da solo non
// basta qui, vedi il commento sul limiter.
const { authLimiter, emailLimiter, registrazioneLimiter } = require('../middleware/rateLimit');
// Punto A-3.4: rientrare col login entro i 30 giorni annulla l'eliminazione dell'account.
const { ripristinaAccount } = require('../lib/accountDeletion');
// ALTO, follow-up revisione sicurezza (30ª): stesso buco di MEDIO-2/3 su Squad.photo.
const { validaFotoProfiloJpeg } = require('../lib/profilePhoto');

const MIN_PASSWORD = 8; // stessa regola della registrazione, in un posto solo

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
            console.error('Errore registrazione:', e);
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
    const user = await User.findById(req.session.userId).select('+profilePhoto');
    if (!user) {
        return req.session.destroy(() => res.status(401).json({ error: 'Non autenticato' }));
    }
    // Punto A-3.4: account in eliminazione o gia' scrubato -> una sessione superstite non
    // rientra senza passare dal login (che, entro i 30 giorni, annulla l'eliminazione).
    if (user.pendingDeletionAt || user.deletedAt) {
        return req.session.destroy(() => res.status(401).json({ error: 'Non autenticato' }));
    }
    res.json(user);
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
        res.json({ valid: !!documento });
    } catch (e) {
        console.error('Errore verifica token recupero:', e);
        res.json({ valid: false });
    }
});

// Passo 3: si sceglie la password nuova.
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

        const user = await User.findById(documento.userId);
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
