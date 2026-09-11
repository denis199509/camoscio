// Prova del RECUPERO RITARDATO senza secondo fattore (opzione C). Blocco 5 del piano 2FA:
// C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md (sez. 1b, 4.6-4.9, 10).
//
// Il 2FA e il recupero ritardato hanno cicli di vita diversi (secondi contro GIORNI) e
// questa prova ha bisogno di MANIPOLARE maturaIl sul database per non aspettare due
// settimane: sta in un file suo, separato da prova-2fa.js, cosi' le date scritte nel passato
// non sporcano la prova dei vettori RFC. Avvia un server suo sulla porta 3138.
//
// Account reali temporanei creati dritti sul DB, cancellati nel finally, filtrati per id.
// Dati finti: prova-recupero-<tag>@esempio-di-prova.invalid.
//
// FORZATURE DELLA PROVA, dichiarate:
//  - sbloccaPasso(): azzera twoFactorLastStep per non aspettare 30 s a ogni login TOTP dove
//    e' sotto prova il flusso e non l'anti-riuso (gia' provato in prova-2fa sez. 5);
//  - forzaMaturaIl(): sposta maturaIl sul documento (mai raggiungibile dalle rotte: maturaIl
//    e' immutabile per progetto). Si tocca SOLO maturaIl, non expiresAt, cosi' l'indice TTL
//    non cancella il documento mentre la prova lo sta ancora leggendo.
//
// CONTROPROVE non facoltative (git stash del codice, da rifare a mano se si tocca la zona):
//  - sostituire avviaOTrovaRecupero() con creaToken(AccountRecovery, userId) (cioe' cadere
//    nella trappola del deleteMany, piano sez. 0.4)  ->  deve crollare la SEZIONE 3:
//    maturaIl si sposterebbe in avanti a ogni richiesta;
//  - togliere lo $unset dei campi 2FA dal completamento  ->  deve crollare la SEZIONE 7:
//    il login dopo il completamento chiederebbe ancora il secondo fattore (il lockout che
//    l'opzione C esiste per evitare).
//
//   node prove/prova-recupero-ritardato.js        (avvia il suo server sulla 3138)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const totp = require('../lib/totp');

const PORTA = 3138;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();
const GIORNO = 24 * 60 * 60 * 1000;

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
function cookieDa(resp) {
    const raw = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')];
    return raw.filter(Boolean).map(c => c.split(';')[0]).join('; ');
}
async function chiama(metodo, percorso, corpo, cookie) {
    const resp = await fetch(BASE + percorso, {
        method: metodo || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await resp.text();
    let c = null;
    try { c = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: resp.status, corpo: c, testo, cookie: cookieDa(resp) };
}
const loginPasso1 = (email, password) => chiama('POST', '/api/auth/login', { email, password });
const codiceOra = (segreto) => totp.codiceDaPasso(segreto, totp.passoCorrente());

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const AccountRecovery = require('../models/AccountRecovery');
    const PasswordReset = require('../models/PasswordReset');
    const { scrubAccount } = require('../lib/accountDeletion');

    const cnt = async (c) => mongoose.connection.collection(c).countDocuments();
    const partenza = { utenti: await cnt('users'), recuperi: await cnt('accountrecoveries'), reset: await cnt('passwordresets') };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, logServer = '';
    const ids = {};

    async function sbloccaPasso(userId) {
        await User.updateOne({ _id: userId }, { $unset: { twoFactorLastStep: 1 } });
    }
    // sposta SOLO maturaIl (non expiresAt: cosi' il TTL non ci cancella il documento sotto).
    async function forzaMaturaIl(userId, quando) {
        await AccountRecovery.updateOne(
            { userId, annullatoIl: { $exists: false }, completatoIl: { $exists: false } },
            { $set: { maturaIl: quando } }
        );
    }
    async function creaUtente(tag, opzioni = {}) {
        const pwd = `pw-${tag}-${MARCA}-Xk`;
        const u = await User.create({
            username: `PROVA-REC-${tag}-${MARCA}`,
            email: `prova-recupero-${tag}-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwd, 10),
            nome: 'Prova', cognome: tag, termsAcceptedAt: new Date(),
            emailVerified: opzioni.emailVerified !== false
        });
        ids[tag] = String(u._id);
        return { u, pwd };
    }
    async function accendi2fa(email, password) {
        const a = await loginPasso1(email, password);
        const s = await chiama('POST', '/api/auth/2fa/setup', {}, a.cookie);
        const en = await chiama('POST', '/api/auth/2fa/enable', { password, code: codiceOra(s.corpo.segreto) }, a.cookie);
        return { segreto: s.corpo.segreto, cookie: a.cookie, enable: en };
    }
    // link della password (?token=) o del completamento recupero (?recupero=) dal log.
    async function estrai(param) {
        const re = new RegExp(`reimposta-password\\?${param}=([A-Za-z0-9_-]+)`);
        for (let i = 0; i < 30; i++) {
            const m = logServer.match(re);
            if (m) return m[1];
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }
    // fa arrivare un token PasswordReset per un utente (via /forgot-password) e lo estrae.
    async function tokenReset(email) {
        logServer = '';
        await chiama('POST', '/api/auth/forgot-password', { email }, null);
        return estrai('token');
    }

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA), MAILJET_API_KEY: '', MAILJET_SECRET_KEY: '', MAIL_SENDER_EMAIL: ''
            })
        });
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server non risponde');

        const ATTESA_MS = AccountRecovery.DURATA_ATTESA_GIORNI * GIORNO;

        // -------------------------------------------------------------------------
        console.log('\n1. Avvio del recupero');
        // -------------------------------------------------------------------------
        const { u: r1, pwd: pwd1 } = await creaUtente('R1');
        await accendi2fa(r1.email, pwd1);
        const tk1 = await tokenReset(r1.email);
        ok('R1: un token PasswordReset e\' comparso nel log', !!tk1, tk1 ? '' : logServer.slice(-300));
        logServer = '';
        const start1 = await chiama('POST', '/api/auth/recovery/start', { token: tk1 }, null);
        ok('/recovery/start -> 200 { avviato: true, maturaIl }',
            start1.status === 200 && start1.corpo && start1.corpo.avviato === true && !!start1.corpo.maturaIl,
            JSON.stringify(start1.corpo));
        const maturaIl1 = new Date(start1.corpo.maturaIl).getTime();
        ok('maturaIl ~ adesso + DURATA_ATTESA_GIORNI (tolleranza 1 min)',
            Math.abs(maturaIl1 - (Date.now() + ATTESA_MS)) < 60000,
            `scarto ${Math.round((maturaIl1 - (Date.now() + ATTESA_MS)) / 1000)} s`);
        const doc1 = await AccountRecovery.findOne({ userId: r1._id });
        ok('il documento AccountRecovery esiste, annullatoIl e completatoIl assenti',
            !!doc1 && doc1.annullatoIl === undefined && doc1.completatoIl === undefined);
        ok('expiresAt presente e UGUALE a maturaIl (la trappola di Report.js)',
            !!doc1.expiresAt && new Date(doc1.expiresAt).getTime() === new Date(doc1.maturaIl).getTime(),
            JSON.stringify({ e: doc1.expiresAt, m: doc1.maturaIl }));
        ok('l\'email di avviso e\' comparsa nel log del server',
            /recupero dell'accesso/i.test(logServer) && /reimposta-password\?recupero=/.test(logServer));
        const chkTk1 = await chiama('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(tk1)}`);
        ok('il token PasswordReset NON e\' stato consumato (vale ancora)',
            chkTk1.corpo && chkTk1.corpo.valid === true, JSON.stringify(chkTk1.corpo));

        // -------------------------------------------------------------------------
        console.log('\n2. Prerequisiti');
        // -------------------------------------------------------------------------
        const startNoTok = await chiama('POST', '/api/auth/recovery/start', {}, null);
        ok('/recovery/start senza token -> 400', startNoTok.status === 400, `status ${startNoTok.status}`);
        const startBadTok = await chiama('POST', '/api/auth/recovery/start', { token: 'x'.repeat(44) }, null);
        ok('/recovery/start con token inventato -> 400', startBadTok.status === 400, `status ${startBadTok.status}`);
        // utente SENZA 2FA
        const { u: rNo, pwd: pwdNo } = await creaUtente('RNO2FA');
        const tkNo = await tokenReset(rNo.email);
        const startNo2fa = await chiama('POST', '/api/auth/recovery/start', { token: tkNo }, null);
        ok('/recovery/start su un account SENZA 2FA -> 400 ("puoi reimpostare direttamente")',
            startNo2fa.status === 400 && /reimpostare la password direttamente/i.test((startNo2fa.corpo && startNo2fa.corpo.error) || ''),
            JSON.stringify(startNo2fa.corpo));
        // account demo: prendo un token con /forgot-password? i demo escono subito. Provo la
        // rotta con un token valido di R1 ma... no: il 403 demo scatta su user.isDemoAccount,
        // e un demo non ha un PasswordReset. Copro il 403 demo gia' in prova-2fa (sez. 2);
        // qui verifico solo che la guardia demo esista chiamando /recovery/start dopo aver
        // messo isDemoAccount su un utente di prova.
        await User.updateOne({ _id: rNo._id }, { $set: { isDemoAccount: true, twoFactorEnabledAt: new Date() } });
        const tkDemo = await tokenReset(rNo.email);
        // con isDemoAccount:true /forgot-password esce subito -> nessun token. Se non c'e'
        // token, salto l'asserzione demo (coperta altrove) invece di far fallire per il motivo sbagliato.
        if (tkDemo) {
            const startDemo = await chiama('POST', '/api/auth/recovery/start', { token: tkDemo }, null);
            ok('/recovery/start su account demo -> 403', startDemo.status === 403, `status ${startDemo.status}`);
        } else {
            ok('(demo: /forgot-password non emette token per i demo - guardia 403 coperta in prova-2fa sez.2)', true);
        }
        await User.updateOne({ _id: rNo._id }, { $unset: { isDemoAccount: 1, twoFactorEnabledAt: 1 } });

        // -------------------------------------------------------------------------
        console.log('\n3. Idempotenza (il controllo che vale di piu\')');
        // -------------------------------------------------------------------------
        const tk1b = await tokenReset(r1.email);
        logServer = '';
        const start1b = await chiama('POST', '/api/auth/recovery/start', { token: tk1b }, null);
        ok('secondo /recovery/start (token NUOVO) -> 200 { giaInCorso: true }',
            start1b.status === 200 && start1b.corpo && start1b.corpo.giaInCorso === true, JSON.stringify(start1b.corpo));
        ok('maturaIl IDENTICO al primo (se si sposta, il meccanismo e\' svuotato)',
            new Date(start1b.corpo.maturaIl).getTime() === maturaIl1,
            `${start1b.corpo.maturaIl} vs ${new Date(maturaIl1).toISOString()}`);
        ok('un SOLO documento AccountRecovery per R1',
            (await AccountRecovery.countDocuments({ userId: r1._id })) === 1);
        ok('NESSUNA seconda email nel log', !/recupero dell'accesso/i.test(logServer), logServer.slice(-200));

        // -------------------------------------------------------------------------
        console.log('\n4. Il link non funziona PRIMA della maturita\'');
        // -------------------------------------------------------------------------
        // /recovery/start ha detto "giaInCorso" e NON ha rimandato email ne' token: il link
        // di completamento e' quello della PRIMA email (sez. 1), ormai fuori dal buffer.
        // Riparto pulito: annullo il recupero vivo e ne avvio uno nuovo, cosi' ho un
        // ?recupero= fresco da leggere nel log. (3o e ultimo /forgot-password per R1.)
        await AccountRecovery.deleteMany({ userId: r1._id });
        const tk1c = await tokenReset(r1.email);
        logServer = '';
        await chiama('POST', '/api/auth/recovery/start', { token: tk1c }, null);
        const linkRec1 = await estrai('recupero');
        ok('ottenuto un token di completamento dall\'email', !!linkRec1);
        const check1 = await chiama('POST', '/api/auth/recovery/check', { token: linkRec1 });
        ok('/recovery/check PRIMA della maturita\' -> { stato: "nonMaturo", maturaIl }',
            check1.corpo && check1.corpo.stato === 'nonMaturo' && !!check1.corpo.maturaIl, JSON.stringify(check1.corpo));
        const compPrima = await chiama('POST', '/api/auth/recovery/complete', { token: linkRec1, password: `NUOVA-${MARCA}-aa` }, null);
        ok('/recovery/complete PRIMA della maturita\' -> 400 con lo stato',
            compPrima.status === 400 && compPrima.corpo && compPrima.corpo.stato === 'nonMaturo', JSON.stringify(compPrima.corpo));
        const loginR1 = await chiama('POST', '/api/auth/login', { email: r1.email, password: pwd1 }, null);
        ok('...la password di R1 NON e\' cambiata, e il 2FA e\' ancora richiesto',
            loginR1.status === 200 && loginR1.corpo.twoFactorRequired === true, JSON.stringify(loginR1.corpo));

        // -------------------------------------------------------------------------
        console.log('\n5. Il banner (GET /recovery/status)');
        // -------------------------------------------------------------------------
        await sbloccaPasso(r1._id);
        const p1 = await loginPasso1(r1.email, pwd1);
        const seg1doc = await User.findById(r1._id).select('+twoFactorSecret');
        const p1full = await chiama('POST', '/api/auth/login/2fa', { code: codiceOra(seg1doc.twoFactorSecret) }, p1.cookie);
        ok('R1: login a due passi completato per il test del banner', p1full.status === 200, JSON.stringify({ s: p1full.status }));
        const st1 = await chiama('GET', '/api/auth/recovery/status', null, p1full.cookie);
        ok('/recovery/status con un recupero vivo -> { inSospeso: true, maturaIl, avviatoIl }',
            st1.status === 200 && st1.corpo.inSospeso === true && !!st1.corpo.maturaIl && !!st1.corpo.avviatoIl,
            JSON.stringify(st1.corpo));
        // un utente SENZA recupero
        const { u: rSenza, pwd: pwdSenza } = await creaUtente('RSENZA');
        const pS = await loginPasso1(rSenza.email, pwdSenza);
        const stS = await chiama('GET', '/api/auth/recovery/status', null, pS.cookie);
        ok('/recovery/status senza recupero -> { inSospeso: false }',
            stS.status === 200 && stS.corpo.inSospeso === false, JSON.stringify(stS.corpo));
        const stNoSess = await chiama('GET', '/api/auth/recovery/status', null, null);
        ok('/recovery/status senza sessione -> 401', stNoSess.status === 401, `status ${stNoSess.status}`);

        // -------------------------------------------------------------------------
        console.log('\n6. Annullamento da loggato');
        // -------------------------------------------------------------------------
        const cancel1 = await chiama('POST', '/api/auth/recovery/cancel', {}, p1full.cookie);
        ok('/recovery/cancel -> 200 { annullato: true }',
            cancel1.status === 200 && cancel1.corpo.annullato === true, JSON.stringify(cancel1.corpo));
        const docAnn = await AccountRecovery.findOne({ userId: r1._id }).sort({ createdAt: -1 });
        ok('sul documento: annullatoIl presente, annullatoPerche "utente", documento NON cancellato',
            !!docAnn && !!docAnn.annullatoIl && docAnn.annullatoPerche === 'utente');
        const st1dopo = await chiama('GET', '/api/auth/recovery/status', null, p1full.cookie);
        ok('/recovery/status dopo l\'annullamento -> { inSospeso: false }',
            st1dopo.corpo && st1dopo.corpo.inSospeso === false, JSON.stringify(st1dopo.corpo));
        // il link, anche forzando maturaIl nel passato, resta rifiutato con stato "annullato"
        await AccountRecovery.updateOne({ _id: docAnn._id }, { $set: { maturaIl: new Date(Date.now() - GIORNO) } });
        const checkAnn = await chiama('POST', '/api/auth/recovery/check', { token: linkRec1 });
        ok('/recovery/check sul link di un recupero annullato -> stato "annullato" (anche se maturaIl e\' passato)',
            checkAnn.corpo && checkAnn.corpo.stato === 'annullato', JSON.stringify(checkAnn.corpo));
        const cancelBis = await chiama('POST', '/api/auth/recovery/cancel', {}, p1full.cookie);
        ok('/recovery/cancel quando non c\'e\' niente da annullare -> 404', cancelBis.status === 404, `status ${cancelBis.status}`);

        // -------------------------------------------------------------------------
        console.log('\n7. Completamento DOPO la maturita\' (R7) + 11: pendingDeletionAt ripristinato');
        // -------------------------------------------------------------------------
        const { u: r7, pwd: pwd7 } = await creaUtente('R7');
        const acc7 = await accendi2fa(r7.email, pwd7);
        // una sessione aperta PRIMA del completamento, per verificare che venga chiusa
        await sbloccaPasso(r7._id);
        const sessVecchia = await loginPasso1(r7.email, pwd7);
        const seg7doc = await User.findById(r7._id).select('+twoFactorSecret');
        const sessVecchiaFull = await chiama('POST', '/api/auth/login/2fa', { code: codiceOra(seg7doc.twoFactorSecret) }, sessVecchia.cookie);
        ok('R7: sessione "vecchia" aperta', sessVecchiaFull.status === 200);

        const tk7 = await tokenReset(r7.email);
        logServer = '';
        await chiama('POST', '/api/auth/recovery/start', { token: tk7 }, null);
        const linkRec7 = await estrai('recupero');
        ok('R7: token di completamento ottenuto', !!linkRec7);
        // forzo maturaIl a ieri (maturo, e ben dentro la finestra di 7 giorni)
        await forzaMaturaIl(r7._id, new Date(Date.now() - GIORNO));
        // e metto R7 in eliminazione, per verificare il ripristino al completamento (sez. 11)
        await User.updateOne({ _id: r7._id }, { $set: { pendingDeletionAt: new Date(), deletionScrubAt: new Date(Date.now() + 30 * GIORNO) } });

        const check7 = await chiama('POST', '/api/auth/recovery/check', { token: linkRec7 });
        ok('/recovery/check dopo la maturita\' -> stato "ok"', check7.corpo && check7.corpo.stato === 'ok', JSON.stringify(check7.corpo));
        const nuova7 = `NUOVA-${MARCA}-r7`;
        const comp7 = await chiama('POST', '/api/auth/recovery/complete', { token: linkRec7, password: nuova7 }, null);
        ok('/recovery/complete -> 200 { success: true }', comp7.status === 200 && comp7.corpo.success === true, JSON.stringify(comp7.corpo));

        const login7nuova = await chiama('POST', '/api/auth/login', { email: r7.email, password: nuova7 }, null);
        ok('login con la password NUOVA, SENZA secondo passo (il 2FA e\' spento)',
            login7nuova.status === 200 && !login7nuova.corpo.twoFactorRequired && login7nuova.corpo.username,
            JSON.stringify({ s: login7nuova.status, tfr: login7nuova.corpo && login7nuova.corpo.twoFactorRequired }));
        const doc7user = await User.findById(r7._id)
            .select('+twoFactorSecret +twoFactorPending +twoFactorPendingAt +twoFactorLastStep +twoFactorRecoveryHashes');
        ok('tutti e 6 i campi 2FA ASSENTI dopo il completamento',
            doc7user.twoFactorSecret === undefined && doc7user.twoFactorPending === undefined
            && doc7user.twoFactorPendingAt === undefined && doc7user.twoFactorEnabledAt === undefined
            && doc7user.twoFactorLastStep === undefined && doc7user.twoFactorRecoveryHashes === undefined);
        ok('11: pendingDeletionAt SPARITO (il completamento ha ripristinato l\'account)',
            doc7user.pendingDeletionAt === undefined);
        const doc7rec = await AccountRecovery.findOne({ userId: r7._id });
        ok('sul documento recupero: completatoIl presente', !!doc7rec && !!doc7rec.completatoIl);
        const meVecchia = await chiama('GET', '/api/auth/me', null, sessVecchiaFull.cookie);
        ok('la sessione aperta PRIMA del completamento -> GET /me 401 (chiuse tutte)', meVecchia.status === 401, `status ${meVecchia.status}`);
        ok('i PasswordReset di R7 sono stati cancellati', (await PasswordReset.countDocuments({ userId: r7._id })) === 0);

        // -------------------------------------------------------------------------
        console.log('\n8. Idempotenza del completamento');
        // -------------------------------------------------------------------------
        const comp7bis = await chiama('POST', '/api/auth/recovery/complete', { token: linkRec7, password: `X-${MARCA}-bis` }, null);
        ok('lo stesso link una seconda volta -> 400 { stato: "completato" }',
            comp7bis.status === 400 && comp7bis.corpo && comp7bis.corpo.stato === 'completato', JSON.stringify(comp7bis.corpo));
        const login7ancora = await chiama('POST', '/api/auth/login', { email: r7.email, password: nuova7 }, null);
        ok('...e la password non e\' cambiata di nuovo (nuova7 vale ancora)',
            login7ancora.status === 200 && login7ancora.corpo.username, JSON.stringify({ s: login7ancora.status }));

        // -------------------------------------------------------------------------
        console.log('\n9. Finestra: oltre i 7 giorni dopo la maturita\' -> scaduto');
        // -------------------------------------------------------------------------
        const { u: r9, pwd: pwd9 } = await creaUtente('R9');
        await accendi2fa(r9.email, pwd9);
        const tk9 = await tokenReset(r9.email);
        logServer = '';
        await chiama('POST', '/api/auth/recovery/start', { token: tk9 }, null);
        const linkRec9 = await estrai('recupero');
        await forzaMaturaIl(r9._id, new Date(Date.now() - 20 * GIORNO)); // maturo da 20 gg, finestra 7 -> scaduto
        const check9 = await chiama('POST', '/api/auth/recovery/check', { token: linkRec9 });
        ok('/recovery/check oltre la finestra -> stato "scaduto"', check9.corpo && check9.corpo.stato === 'scaduto', JSON.stringify(check9.corpo));
        const comp9 = await chiama('POST', '/api/auth/recovery/complete', { token: linkRec9, password: `NUOVA-${MARCA}-r9` }, null);
        ok('/recovery/complete oltre la finestra -> 400 { stato: "scaduto" }',
            comp9.status === 400 && comp9.corpo.stato === 'scaduto', JSON.stringify(comp9.corpo));
        const login9 = await chiama('POST', '/api/auth/login', { email: r9.email, password: pwd9 }, null);
        ok('...la password di R9 non e\' cambiata (2FA ancora richiesto)',
            login9.status === 200 && login9.corpo.twoFactorRequired === true);

        // -------------------------------------------------------------------------
        console.log('\n10. Disattivare il 2FA annulla il recupero');
        // -------------------------------------------------------------------------
        const { u: r10, pwd: pwd10 } = await creaUtente('R10');
        const acc10 = await accendi2fa(r10.email, pwd10);
        const recCodes10 = acc10.enable.corpo.recoveryCodes;
        await sbloccaPasso(r10._id);
        const p10 = await loginPasso1(r10.email, pwd10);
        const seg10doc = await User.findById(r10._id).select('+twoFactorSecret');
        const p10full = await chiama('POST', '/api/auth/login/2fa', { code: codiceOra(seg10doc.twoFactorSecret) }, p10.cookie);
        const tk10 = await tokenReset(r10.email);
        await chiama('POST', '/api/auth/recovery/start', { token: tk10 }, null);
        ok('R10: recupero avviato', (await AccountRecovery.countDocuments({ userId: r10._id, annullatoIl: { $exists: false } })) === 1);
        const dis10 = await chiama('POST', '/api/auth/2fa/disable', { password: pwd10, recoveryCode: recCodes10[0] }, p10full.cookie);
        ok('/2fa/disable -> 200', dis10.status === 200, JSON.stringify(dis10.corpo));
        const doc10rec = await AccountRecovery.findOne({ userId: r10._id });
        ok('il recupero e\' annullato con annullatoPerche "2fa-disattivato"',
            !!doc10rec && !!doc10rec.annullatoIl && doc10rec.annullatoPerche === '2fa-disattivato', JSON.stringify({ a: doc10rec && doc10rec.annullatoPerche }));
        const st10 = await chiama('GET', '/api/auth/recovery/status', null, p10full.cookie);
        ok('/recovery/status -> { inSospeso: false }', st10.corpo && st10.corpo.inSospeso === false, JSON.stringify(st10.corpo));

        // -------------------------------------------------------------------------
        console.log('\n11b. Stato speciale: account gia\' scrubato -> 400 all\'avvio');
        // -------------------------------------------------------------------------
        const { u: r11, pwd: pwd11 } = await creaUtente('R11');
        await accendi2fa(r11.email, pwd11);
        const tk11 = await tokenReset(r11.email);
        await User.updateOne({ _id: r11._id }, { $set: { deletedAt: new Date() } });
        const start11 = await chiama('POST', '/api/auth/recovery/start', { token: tk11 }, null);
        ok('/recovery/start su un account con deletedAt -> 400', start11.status === 400, `status ${start11.status}`);

        // -------------------------------------------------------------------------
        console.log('\n12. scrubAccount() porta via il documento AccountRecovery');
        // -------------------------------------------------------------------------
        const u12 = await User.create({
            username: `PROVA-REC-R12-${MARCA}`, email: `prova-recupero-r12-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(`pw-${MARCA}`, 10), nome: 'Prova', cognome: 'R12',
            termsAcceptedAt: new Date(), emailVerified: true
        });
        ids.R12 = String(u12._id);
        await AccountRecovery.create({
            userId: u12._id, tokenHash: 'f'.repeat(64),
            maturaIl: new Date(Date.now() + 5 * GIORNO), expiresAt: new Date(Date.now() + 5 * GIORNO)
        });
        ok('R12: un recupero vivo esiste prima dello scrub', (await AccountRecovery.countDocuments({ userId: u12._id })) === 1);
        await scrubAccount(await User.findById(u12._id).select('+passwordHash'));
        ok('dopo scrubAccount: nessun documento AccountRecovery per R12',
            (await AccountRecovery.countDocuments({ userId: u12._id })) === 0);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + (e && e.message));
    } finally {
        if (server) server.kill();
        const oid = s => { try { return new mongoose.Types.ObjectId(s); } catch { return null; } };
        for (const k of Object.keys(ids)) if (ids[k]) {
            await User.deleteOne({ _id: oid(ids[k]) }).catch(() => {});
            await AccountRecovery.deleteMany({ userId: oid(ids[k]) }).catch(() => {});
            await mongoose.connection.collection('passwordresets').deleteMany({ userId: oid(ids[k]) }).catch(() => {});
        }
        const fine = { utenti: await cnt('users'), recuperi: await cnt('accountrecoveries'), reset: await cnt('passwordresets') };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessun AccountRecovery di prova rimasto', fine.recuperi === partenza.recuperi, `${partenza.recuperi} -> ${fine.recuperi}`);
        ok('nessun PasswordReset di prova rimasto', fine.reset === partenza.reset, `${partenza.reset} -> ${fine.reset}`);
        await mongoose.disconnect();
        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti === 0 ? 0 : 1);
    }
})().catch(e => { console.error('ERRORE NON GESTITO NELLA PROVA:', e); process.exit(1); });
