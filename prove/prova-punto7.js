// Prova del PUNTO 7 (recupero e cambio password) contro il server locale vero.
//
// REGOLE SEGUITE (imparate il 2026-07-27, vedi cronologia.txt):
//  - i dati di prova NON somigliano ai dati veri dell'utente: email @esempio-di-prova.invalid,
//    nomi che dicono "prova", cosi' anche se una pulizia sbagliasse filtro si vede subito;
//  - ogni cancellazione porta con se' l'userId dell'account di prova, sempre;
//  - i conteggi del database si leggono all'INIZIO e si riconfrontano alla FINE, invece di
//    scriverli a mano: un controllo che dipende da quanti dati ha l'utente non prova il codice;
//  - l'errore si stampa in un catch PRIMA del finally, altrimenti un process.exit dentro il
//    finally ucciderebbe il .catch e la prova morirebbe senza dire niente.

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';
const LOG = process.env.CAMOSCIO_LOG || (__dirname + '/server-prove.log');
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];

function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// --- Piccolo client HTTP con barattolo di biscotti, per simulare browser diversi ---
function nuovoBarattolo() {
    return { cookie: null };
}

async function chiama(barattolo, percorso, opzioni = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opzioni.headers || {});
    if (barattolo && barattolo.cookie) headers.Cookie = barattolo.cookie;

    const res = await fetch(BASE + percorso, {
        method: opzioni.method || 'GET',
        headers,
        body: opzioni.body ? JSON.stringify(opzioni.body) : undefined,
        redirect: 'manual'
    });

    const impostati = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (barattolo && impostati.length) {
        const sid = impostati.find(c => c.startsWith('connect.sid='));
        if (sid) barattolo.cookie = sid.split(';')[0];
    }

    let corpo = null;
    try { corpo = await res.json(); } catch { corpo = null; }
    return { status: res.status, corpo };
}

// Il link viene stampato sul terminale del server (modalita' senza chiave Brevo).
// Si guarda SOLO la parte di log scritta dopo la richiesta, e si insiste finche' non
// compare invece di leggere "a tempo": un log in sottofondo puo' arrivare in ritardo.
function lunghezzaLog() {
    try { return fs.statSync(LOG).size; } catch { return 0; }
}

async function estraiLink(daByte) {
    for (let tentativo = 0; tentativo < 40; tentativo++) {
        const testo = fs.readFileSync(LOG, 'utf8').slice(daByte);
        const trovati = testo.match(/http:\/\/localhost:3000\/reimposta-password\?token=[A-Za-z0-9_-]+/g);
        if (trovati && trovati.length) return trovati[trovati.length - 1];
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

function tokenDa(link) {
    return link ? new URL(link).searchParams.get('token') : null;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection;
    const Utenti = db.collection('users');
    const Reset = db.collection('passwordresets');
    const Verifiche = db.collection('emailverifications');
    const Sessioni = db.collection('sessions');

    // Conteggi di partenza: letti, non scritti a mano.
    const partenza = {
        utenti: await Utenti.countDocuments(),
        reset: await Reset.countDocuments(),
        sessioni: await Sessioni.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];

    try {
        // ============================================================================
        console.log('--- PREPARAZIONE: tre account di prova ---');
        // ============================================================================
        const P1 = 'PasswordDiProva1!';
        const emailU1 = `prova-punto7-a-${MARCA}@esempio-di-prova.invalid`;
        const emailDemo = `prova-punto7-demo-${MARCA}@esempio-di-prova.invalid`;
        const emailFreno = `prova-punto7-freno-${MARCA}@esempio-di-prova.invalid`;

        async function registra(email, username) {
            const r = await chiama(nuovoBarattolo(), '/api/auth/register', {
                method: 'POST',
                body: {
                    nome: 'Prova', cognome: 'Punto7', email, password: P1,
                    username, ageRange: '30-39', termsAccepted: true,
                    emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
                }
            });
            return r;
        }

        const r1 = await registra(emailU1, `provapunto7a${MARCA}`);
        ok('account di prova creato', r1.status === 200, JSON.stringify(r1.corpo).slice(0, 200));
        const u1 = await Utenti.findOne({ email: emailU1 });
        idDiProva.push(u1._id);

        // Dal 2026-07-28 il recupero password funziona SOLO per gli indirizzi confermati:
        // a un account non confermato viene mandata l'email di conferma. Qui si vuole
        // provare il recupero, quindi l'account si segna come confermato direttamente sul
        // database - la verifica ha una prova tutta sua (prova-verifica-email.js).
        await Utenti.updateOne({ _id: u1._id }, { $set: { emailVerified: true } });

        const rDemo = await registra(emailDemo, `provapunto7demo${MARCA}`);
        const uDemo = await Utenti.findOne({ email: emailDemo });
        idDiProva.push(uDemo._id);
        await Utenti.updateOne({ _id: uDemo._id }, { $set: { isDemoAccount: true } });
        ok('secondo account marcato come demo', rDemo.status === 200);

        const rFreno = await registra(emailFreno, `provapunto7freno${MARCA}`);
        const uFreno = await Utenti.findOne({ email: emailFreno });
        idDiProva.push(uFreno._id);
        await Utenti.updateOne({ _id: uFreno._id }, { $set: { emailVerified: true } });
        ok('terzo account di prova creato', rFreno.status === 200);

        // ============================================================================
        console.log('\n--- 1. LA RISPOSTA E\' SEMPRE LA STESSA ---');
        // ============================================================================
        const rIgnota = await chiama(null, '/api/auth/forgot-password', {
            method: 'POST', body: { email: `non-esiste-${MARCA}@esempio-di-prova.invalid` }
        });
        const pos0 = lunghezzaLog();
        const rNota = await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailU1 } });

        ok('email inesistente risponde 200', rIgnota.status === 200);
        ok('email vera risponde 200', rNota.status === 200);
        ok('il messaggio e\' IDENTICO nei due casi (nessun modo di scoprire chi e\' iscritto)',
            JSON.stringify(rIgnota.corpo) === JSON.stringify(rNota.corpo),
            `\n     ignota: ${JSON.stringify(rIgnota.corpo)}\n     nota:   ${JSON.stringify(rNota.corpo)}`);

        // In locale la chiave di Brevo non c'e': il server deve DIRLO, non promettere
        // un'email che non puo' partire. Quando la chiave ci sara', questo stesso
        // controllo verifica il messaggio normale.
        const chiaveConfigurata = !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.MAIL_SENDER_EMAIL);
        if (chiaveConfigurata) {
            ok('con la chiave configurata, dice che l\'email e\' partita',
                rNota.corpo.disponibile === true && /Se quell'indirizzo è registrato/.test(rNota.corpo.message),
                JSON.stringify(rNota.corpo));
        } else {
            ok('senza chiave NON promette un\'email: lo dice chiaramente',
                rNota.corpo.disponibile === false && /non è ancora attivo/.test(rNota.corpo.message),
                JSON.stringify(rNota.corpo));
            ok('e rassicura che la password di adesso continua a funzionare',
                /continua a funzionare/.test(rNota.corpo.message));
        }

        const link1 = await estraiLink(pos0);
        ok('il link e\' stato generato', !!link1, String(link1));
        const token1 = tokenDa(link1);
        ok('il token e\' lungo almeno 40 caratteri', !!token1 && token1.length >= 40, `lungo ${token1 && token1.length}`);

        const docReset = await Reset.findOne({ userId: u1._id });
        ok('sul database c\'e\' un documento di recupero', !!docReset);
        ok('sul database NON c\'e\' il token in chiaro, solo l\'impronta',
            !!docReset && !JSON.stringify(docReset).includes(token1));

        ok('nessun documento di recupero per l\'email inesistente', await Reset.countDocuments() === partenza.reset + 1);

        // ============================================================================
        console.log('\n--- 2. VERIFICA DEL TOKEN ---');
        // ============================================================================
        const cOk = await chiama(null, `/api/auth/reset-password/check?token=${encodeURIComponent(token1)}`);
        ok('token vero: valido', cOk.corpo && cOk.corpo.valid === true, JSON.stringify(cOk.corpo));

        const cInventato = await chiama(null, '/api/auth/reset-password/check?token=' + 'x'.repeat(43));
        ok('token inventato: non valido', cInventato.corpo && cInventato.corpo.valid === false);

        const cVuoto = await chiama(null, '/api/auth/reset-password/check?token=');
        ok('token vuoto: non valido', cVuoto.corpo && cVuoto.corpo.valid === false);

        const cAssente = await chiama(null, '/api/auth/reset-password/check');
        ok('nessun token: non valido', cAssente.corpo && cAssente.corpo.valid === false);

        // ============================================================================
        console.log('\n--- 3. PASSWORD TROPPO CORTA: rifiutata E il link resta buono ---');
        // ============================================================================
        const corta = await chiama(null, '/api/auth/reset-password', { method: 'POST', body: { token: token1, password: 'breve' } });
        ok('password sotto gli 8 caratteri rifiutata (400)', corta.status === 400, JSON.stringify(corta.corpo));
        const ancoraValido = await chiama(null, `/api/auth/reset-password/check?token=${encodeURIComponent(token1)}`);
        ok('un tentativo rifiutato NON consuma il link', ancoraValido.corpo && ancoraValido.corpo.valid === true);

        // ============================================================================
        console.log('\n--- 4. DUE SESSIONI APERTE, POI IL CAMBIO LE CHIUDE ---');
        // ============================================================================
        const barattoloA = nuovoBarattolo();
        const barattoloB = nuovoBarattolo();
        const lA = await chiama(barattoloA, '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P1 } });
        const lB = await chiama(barattoloB, '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P1 } });
        ok('accesso dal "browser" A', lA.status === 200);
        ok('accesso dal "browser" B', lB.status === 200);
        ok('A e B sono due sessioni diverse', barattoloA.cookie !== barattoloB.cookie);

        const meA = await chiama(barattoloA, '/api/auth/me');
        const meB = await chiama(barattoloB, '/api/auth/me');
        ok('prima del cambio, A e\' dentro', meA.status === 200);
        ok('prima del cambio, B e\' dentro', meB.status === 200);

        const P2 = 'PasswordDiProva2!';
        const barattoloC = nuovoBarattolo();
        const reset1 = await chiama(barattoloC, '/api/auth/reset-password', { method: 'POST', body: { token: token1, password: P2 } });
        ok('cambio password riuscito (200)', reset1.status === 200, JSON.stringify(reset1.corpo));
        ok('e l\'utente resta dentro sul dispositivo dove l\'ha cambiata',
            reset1.corpo && reset1.corpo.loggedIn === true, JSON.stringify(reset1.corpo));

        const meCdopo = await chiama(barattoloC, '/api/auth/me');
        ok('la sessione nuova funziona davvero', meCdopo.status === 200);

        const meAdopo = await chiama(barattoloA, '/api/auth/me');
        const meBdopo = await chiama(barattoloB, '/api/auth/me');
        ok('la sessione A e\' stata chiusa (401)', meAdopo.status === 401, `status ${meAdopo.status}`);
        ok('la sessione B e\' stata chiusa (401)', meBdopo.status === 401, `status ${meBdopo.status}`);

        // ============================================================================
        console.log('\n--- 5. IL LINK E\' USA E GETTA ---');
        // ============================================================================
        const riuso = await chiama(null, '/api/auth/reset-password', { method: 'POST', body: { token: token1, password: 'AltraPassword9!' } });
        ok('lo stesso link non funziona una seconda volta (400)', riuso.status === 400, JSON.stringify(riuso.corpo));
        ok('e nemmeno la verifica lo accetta piu\'',
            (await chiama(null, `/api/auth/reset-password/check?token=${encodeURIComponent(token1)}`)).corpo.valid === false);
        ok('il documento di recupero e\' sparito dal database', await Reset.countDocuments({ userId: u1._id }) === 0);

        // ============================================================================
        console.log('\n--- 6. LA PASSWORD E\' CAMBIATA DAVVERO ---');
        // ============================================================================
        const vecchia = await chiama(nuovoBarattolo(), '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P1 } });
        ok('la password vecchia non funziona piu\' (401)', vecchia.status === 401);
        const nuova = await chiama(nuovoBarattolo(), '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P2 } });
        ok('la password nuova funziona (200)', nuova.status === 200);

        // ============================================================================
        console.log('\n--- 7. TOKEN SCADUTO: rifiutato dal CODICE, non dalle pulizie di MongoDB ---');
        // ============================================================================
        // Si crea a mano un documento con createdAt di due ore fa. MongoDB lo cancellerebbe
        // da solo, ma passa solo ogni ~60 secondi: qui si verifica che nel frattempo il
        // codice lo rifiuti comunque.
        const crypto = require('crypto');
        const tokenScaduto = crypto.randomBytes(32).toString('base64url');
        await Reset.insertOne({
            userId: u1._id,
            tokenHash: crypto.createHash('sha256').update(tokenScaduto).digest('hex'),
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
        });
        const cScaduto = await chiama(null, `/api/auth/reset-password/check?token=${encodeURIComponent(tokenScaduto)}`);
        ok('un token di due ore fa risulta NON valido', cScaduto.corpo && cScaduto.corpo.valid === false);
        const rScaduto = await chiama(null, '/api/auth/reset-password', { method: 'POST', body: { token: tokenScaduto, password: 'PasswordDiProva3!' } });
        ok('e non permette di cambiare la password (400)', rScaduto.status === 400);
        ok('il documento scaduto viene tolto subito', await Reset.countDocuments({ userId: u1._id }) === 0);

        // ============================================================================
        console.log('\n--- 8. GLI ACCOUNT DEMO NON HANNO NIENTE DA RECUPERARE ---');
        // ============================================================================
        const rDemoForgot = await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailDemo } });
        ok('risponde 200 come per tutti gli altri', rDemoForgot.status === 200);
        ok('ma la risposta e\' identica a quella degli altri casi',
            JSON.stringify(rDemoForgot.corpo) === JSON.stringify(rNota.corpo));
        ok('e nessun link viene creato per un account demo',
            await Reset.countDocuments({ userId: uDemo._id }) === 0);

        // ============================================================================
        console.log('\n--- 9. CAMBIO PASSWORD DAL PROFILO ---');
        // ============================================================================
        const barattoloProfilo = nuovoBarattolo();
        await chiama(barattoloProfilo, '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P2 } });

        const senzaSessione = await chiama(nuovoBarattolo(), '/api/auth/change-password', {
            method: 'POST', body: { currentPassword: P2, newPassword: 'PasswordDiProva4!' }
        });
        ok('senza essere collegati: 401', senzaSessione.status === 401);

        const attualeSbagliata = await chiama(barattoloProfilo, '/api/auth/change-password', {
            method: 'POST', body: { currentPassword: 'QuestaNonEQuellaGiusta1!', newPassword: 'PasswordDiProva4!' }
        });
        ok('password attuale sbagliata: 401', attualeSbagliata.status === 401, JSON.stringify(attualeSbagliata.corpo));

        const nuovaCorta = await chiama(barattoloProfilo, '/api/auth/change-password', {
            method: 'POST', body: { currentPassword: P2, newPassword: 'corta' }
        });
        ok('nuova password troppo corta: 400', nuovaCorta.status === 400);

        const uguale = await chiama(barattoloProfilo, '/api/auth/change-password', {
            method: 'POST', body: { currentPassword: P2, newPassword: P2 }
        });
        ok('nuova password uguale a quella attuale: 400', uguale.status === 400);

        const P3 = 'PasswordDiProva4!';
        const cambio = await chiama(barattoloProfilo, '/api/auth/change-password', {
            method: 'POST', body: { currentPassword: P2, newPassword: P3 }
        });
        ok('cambio corretto: 200', cambio.status === 200, JSON.stringify(cambio.corpo));
        ok('si resta collegati (qui NON si chiudono le altre sessioni)',
            (await chiama(barattoloProfilo, '/api/auth/me')).status === 200);
        ok('e si entra con la password nuova',
            (await chiama(nuovoBarattolo(), '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P3 } })).status === 200);
        ok('mentre con la precedente no',
            (await chiama(nuovoBarattolo(), '/api/auth/login', { method: 'POST', body: { email: emailU1, password: P2 } })).status === 401);

        // ============================================================================
        console.log('\n--- 10. IL FRENO ANTI-ABUSO ---');
        // ============================================================================
        // Tre richieste per lo stesso indirizzo passano, la quarta no. Si guarda quanti
        // documenti di recupero sono stati creati, non la risposta (che e' sempre uguale).
        for (let i = 0; i < 3; i++) {
            await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailFreno } });
        }
        const dopoTre = await Reset.countDocuments({ userId: uFreno._id });
        ok('dopo tre richieste esiste UN SOLO link valido (i precedenti si annullano)', dopoTre === 1, `trovati ${dopoTre}`);

        await Reset.deleteMany({ userId: uFreno._id }); // si toglie per vedere se la quarta ne crea uno
        await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailFreno } });
        const dopoQuattro = await Reset.countDocuments({ userId: uFreno._id });
        ok('la quarta richiesta viene fermata dal freno (nessun link creato)', dopoQuattro === 0, `trovati ${dopoQuattro}`);

    } catch (e) {
        // Stampato QUI e non dopo il finally: un'uscita dentro il finally ucciderebbe il catch.
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
        fallimenti.push('eccezione: ' + e.message);
    } finally {
        // --- PULIZIA: sempre filtrata per gli account di prova, mai "tanto quel valore ce l'ho solo io" ---
        for (const id of idDiProva) {
            await Reset.deleteMany({ userId: id });
            await Verifiche.deleteMany({ userId: id });
            await Utenti.deleteOne({ _id: id });
        }
        // Le sessioni create dalla prova: si riconoscono dall'userId degli account di prova.
        const sessioni = await Sessioni.find({}).toArray();
        const idStringa = idDiProva.map(String);
        const daTogliere = sessioni.filter(s => {
            let dati = s.session;
            if (typeof dati === 'string') { try { dati = JSON.parse(dati); } catch { return false; } }
            return dati && idStringa.includes(String(dati.userId));
        }).map(s => s._id);
        if (daTogliere.length) await Sessioni.deleteMany({ _id: { $in: daTogliere } });

        const fine = {
            utenti: await Utenti.countDocuments(),
            reset: await Reset.countDocuments(),
            sessioni: await Sessioni.countDocuments()
        };
        console.log('\nConteggi finali: ', fine);
        console.log('Conteggi iniziali:', partenza);
        ok('il database e\' tornato come prima (utenti)', fine.utenti === partenza.utenti);
        ok('il database e\' tornato come prima (documenti di recupero)', fine.reset === partenza.reset);
        ok('il database e\' tornato come prima (sessioni)', fine.sessioni === partenza.sessioni);

        console.log(`\n=========================================`);
        console.log(`  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (fallimenti.length) console.log('  ->', fallimenti.join('\n  -> '));
        console.log(`=========================================`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
