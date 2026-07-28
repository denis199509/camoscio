const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const router = express.Router();
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const { mongoose } = require('../db/mongo');
const { chiudiTutteLeSessioni } = require('../db/sessionStore');
const {
    inviaEmail, emailRecuperoPassword, indirizzoBase,
    configurato: mailerConfigurato, inviiFunzionanti
} = require('../lib/mailer');
const { requireAuth } = require('../middleware/auth');

const MAX_PHOTO_LENGTH = 2 * 1024 * 1024; // ~1.5MB decodificati: "piccola immagine", non un file pesante
const MIN_PASSWORD = 8; // stessa regola della registrazione, in un posto solo

function calculateAge(birthDate) {
    const ms = Date.now() - new Date(birthDate).getTime();
    return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

// Registrazione utente reale (Fase C)
router.post('/register', async (req, res) => {
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
        for (const c of emergencyContacts) {
            if (!c || !c.name || !c.phone || !c.relationship) {
                return res.status(400).json({ error: 'Ogni contatto di emergenza richiede nome, telefono e relazione' });
            }
        }

        if (profilePhoto && String(profilePhoto).length > MAX_PHOTO_LENGTH) {
            return res.status(400).json({ error: 'Foto profilo troppo grande, scegline una più piccola' });
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
            isDemoAccount: false
        });

        req.session.userId = user._id.toString();
        res.json(user);
    } catch (e) {
        console.error('Errore registrazione:', e);
        if (e.code === 11000) {
            return res.status(409).json({ error: 'Email o username già in uso' });
        }
        if (e.name === 'ValidationError') {
            return res.status(400).json({ error: e.message });
        }
        res.status(500).json({ error: 'Errore interno durante la registrazione' });
    }
});

// Login reale (email + password)
router.post('/login', async (req, res) => {
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

        req.session.userId = user._id.toString();
        res.json(user);
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
    const user = await User.findById(req.session.userId);
    if (!user) {
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

// Del token si salva solo l'impronta: vedi il commento in models/PasswordReset.js.
function impronta(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Cerca il documento del token e ne verifica la validita'.
// LA SCADENZA SI RICONTROLLA QUI e non ci si affida solo alla cancellazione automatica di
// MongoDB: quella passa ogni ~60 secondi, quindi un token scaduto puo' restare sul
// database fino a un minuto in piu'. Senza questo controllo, per quel minuto varrebbe.
async function trovaTokenValido(token) {
    if (typeof token !== 'string' || token.length < 20) return null;

    const documento = await PasswordReset.findOne({ tokenHash: impronta(token) });
    if (!documento) return null;

    const eta = Date.now() - new Date(documento.createdAt).getTime();
    if (eta > PasswordReset.DURATA_LINK_SECONDI * 1000) {
        await PasswordReset.deleteOne({ _id: documento._id }); // scaduto: si toglie subito
        return null;
    }
    return documento;
}

// Passo 1: si chiede il link.
router.post('/forgot-password', async (req, res) => {
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

        // NE VALE UNO SOLO PER VOLTA: chiedendo un secondo link, il primo smette di
        // funzionare. Cosi' un link vecchio rimasto in una casella non resta buono.
        await PasswordReset.deleteMany({ userId: user._id });

        // 256 bit dal generatore crittografico di Node: non indovinabile, nessuna libreria
        // in piu'. base64url perche' finisce dentro un indirizzo web.
        const token = crypto.randomBytes(32).toString('base64url');
        await PasswordReset.create({ userId: user._id, tokenHash: impronta(token) });

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
        const documento = await trovaTokenValido(req.query.token);
        res.json({ valid: !!documento });
    } catch (e) {
        console.error('Errore verifica token recupero:', e);
        res.json({ valid: false });
    }
});

// Passo 3: si sceglie la password nuova.
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body || {};

        if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
            return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri` });
        }

        const documento = await trovaTokenValido(token);
        if (!documento) {
            return res.status(400).json({ error: 'Questo link non è più valido: potrebbe essere scaduto o già usato. Chiedine un altro.' });
        }

        const user = await User.findById(documento.userId);
        if (!user) {
            await PasswordReset.deleteOne({ _id: documento._id });
            return res.status(400).json({ error: 'Questo link non è più valido. Chiedine un altro.' });
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
router.post('/change-password', requireAuth, async (req, res) => {
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

module.exports = router;
