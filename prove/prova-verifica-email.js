// Prova della VERIFICA DELL'INDIRIZZO EMAIL in registrazione, contro il server locale.
//
// IL CONTROLLO PIU' IMPORTANTE e' quello sulla riservatezza: chiedendo il recupero
// password, un account NON verificato, uno verificato e un indirizzo che non esiste
// devono ricevere la STESSA identica risposta. Se differissero, quel modulo direbbe a
// chiunque quali indirizzi sono registrati e in che stato.
//
// Regole di pulizia come sempre: dati riconoscibili come di prova e cancellazione
// filtrata per l'userId, dentro un finally.

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const crypto = require('crypto');
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

function nuovoBarattolo() { return { cookie: null }; }

async function chiama(barattolo, percorso, opzioni = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opzioni.headers || {});
    if (barattolo && barattolo.cookie) headers.Cookie = barattolo.cookie;
    const res = await fetch(BASE + percorso, {
        method: opzioni.method || 'GET',
        headers,
        body: opzioni.body ? JSON.stringify(opzioni.body) : undefined
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

function lunghezzaLog() { try { return fs.statSync(LOG).size; } catch { return 0; } }

// Estrae dal log del server l'ultimo link di un certo tipo scritto dopo "daByte".
async function estraiLink(daByte, tipo) {
    const re = new RegExp(`http://localhost:3000/${tipo}\\?token=[A-Za-z0-9_-]+`, 'g');
    for (let i = 0; i < 40; i++) {
        const testo = fs.readFileSync(LOG, 'utf8').slice(daByte);
        const trovati = testo.match(re);
        if (trovati && trovati.length) return trovati[trovati.length - 1];
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

const tokenDa = (link) => link ? new URL(link).searchParams.get('token') : null;

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Verifiche = mongoose.connection.collection('emailverifications');
    const Reset = mongoose.connection.collection('passwordresets');

    const partenza = {
        utenti: await Utenti.countDocuments(),
        verifiche: await Verifiche.countDocuments(),
        reset: await Reset.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];
    const P1 = 'PasswordDiProva1!';

    async function registra(email, username, daByte) {
        const barattolo = nuovoBarattolo();
        const r = await chiama(barattolo, '/api/auth/register', {
            method: 'POST',
            body: {
                nome: 'Prova', cognome: 'Verifica', email, password: P1, username,
                ageRange: '30-39', termsAccepted: true,
                emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
            }
        });
        return { r, barattolo };
    }

    try {
        // ====================================================================
        console.log('--- 1. LA REGISTRAZIONE MANDA L\'EMAIL E L\'UTENTE PARTE NON VERIFICATO ---');
        // ====================================================================
        const emailA = `prova-verifica-a-${MARCA}@esempio-di-prova.invalid`;
        const pos0 = lunghezzaLog();
        const { r: regA, barattolo: barattoloA } = await registra(emailA, `provaverificaa${MARCA}`, pos0);
        ok('registrazione riuscita', regA.status === 200, JSON.stringify(regA.corpo).slice(0, 150));

        const utenteA = await Utenti.findOne({ email: emailA });
        idDiProva.push(utenteA._id);
        ok('l\'utente parte NON verificato', utenteA.emailVerified === false, String(utenteA.emailVerified));
        ok('e' + ' c\'e\' un token di conferma sul database',
            await Verifiche.countDocuments({ userId: utenteA._id }) === 1);

        const linkConferma = await estraiLink(pos0, 'conferma-email');
        ok('il link di conferma e\' stato generato', !!linkConferma, String(linkConferma));
        const tokenA = tokenDa(linkConferma);

        const docVerifica = await Verifiche.findOne({ userId: utenteA._id });
        ok('sul database c\'e\' solo l\'impronta, non il token in chiaro',
            !!docVerifica && !JSON.stringify(docVerifica).includes(tokenA));

        // ====================================================================
        console.log('\n--- 2. NESSUNO PUO\' MARCARSI VERIFICATO DA SOLO ---');
        // ====================================================================
        // Provato DAVVERO, non dato per buono perche' "la lista bianca lo esclude".
        const tentativo = await chiama(barattoloA, `/api/users/${utenteA._id}`, {
            method: 'PUT', body: { emailVerified: true }
        });
        const dopoTentativo = await Utenti.findOne({ _id: utenteA._id });
        ok('PUT /api/users/:id con emailVerified:true NON verifica l\'account',
            dopoTentativo.emailVerified === false,
            `status ${tentativo.status}, emailVerified ora = ${dopoTentativo.emailVerified}`);

        // ====================================================================
        console.log('\n--- 3. IL RECUPERO PASSWORD SU ACCOUNT NON VERIFICATO ---');
        // ====================================================================
        const emailInventata = `mai-visto-${MARCA}@esempio-di-prova.invalid`;
        const posRec = lunghezzaLog();

        const rNonVerificato = await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailA } });
        const rInventata = await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailInventata } });

        ok('NON viene creato nessun link di reimpostazione per un account non verificato',
            await Reset.countDocuments({ userId: utenteA._id }) === 0);

        const linkRimandato = await estraiLink(posRec, 'conferma-email');
        ok('gli viene invece rimandata l\'email di CONFERMA (non resta senza niente)', !!linkRimandato);

        // IL CONTROLLO CHE CONTA DI PIU'.
        ok('account NON verificato e indirizzo INVENTATO: risposta identica',
            JSON.stringify(rNonVerificato.corpo) === JSON.stringify(rInventata.corpo),
            `\n     non verificato: ${JSON.stringify(rNonVerificato.corpo)}\n     inventato:      ${JSON.stringify(rInventata.corpo)}`);

        // ====================================================================
        console.log('\n--- 4. LA CONFERMA ---');
        // ====================================================================
        // Il link e' cambiato: quello della registrazione e' stato annullato dal rinvio.
        const tokenBuono = tokenDa(linkRimandato);

        const checkVecchio = await chiama(null, `/api/auth/verify-email/check?token=${encodeURIComponent(tokenA)}`);
        ok('il link della registrazione e\' stato annullato dal rinvio',
            checkVecchio.corpo && checkVecchio.corpo.valid === false);

        const checkBuono = await chiama(null, `/api/auth/verify-email/check?token=${encodeURIComponent(tokenBuono)}`);
        ok('il link piu' + ' recente e\' valido', checkBuono.corpo && checkBuono.corpo.valid === true);

        ok('token inventato: non valido',
            (await chiama(null, '/api/auth/verify-email/check?token=' + 'x'.repeat(43))).corpo.valid === false);
        ok('token vuoto: non valido',
            (await chiama(null, '/api/auth/verify-email/check?token=')).corpo.valid === false);

        // La conferma NON richiede di essere collegati: si usa un barattolo vuoto.
        const conferma = await chiama(nuovoBarattolo(), '/api/auth/verify-email', {
            method: 'POST', body: { token: tokenBuono }
        });
        ok('la conferma funziona SENZA essere collegati', conferma.status === 200, JSON.stringify(conferma.corpo));

        const utenteDopo = await Utenti.findOne({ _id: utenteA._id });
        ok('ora l\'utente risulta verificato', utenteDopo.emailVerified === true);
        ok('il token e\' stato consumato', await Verifiche.countDocuments({ userId: utenteA._id }) === 0);

        const riuso = await chiama(null, '/api/auth/verify-email', { method: 'POST', body: { token: tokenBuono } });
        ok('lo stesso link non funziona una seconda volta', riuso.status === 400);

        // ====================================================================
        console.log('\n--- 5. ORA IL RECUPERO PASSWORD FUNZIONA ---');
        // ====================================================================
        const posDopo = lunghezzaLog();
        const rVerificato = await chiama(null, '/api/auth/forgot-password', { method: 'POST', body: { email: emailA } });
        ok('ora viene creato il link di REIMPOSTAZIONE',
            await Reset.countDocuments({ userId: utenteA._id }) === 1);
        ok('ed e\' arrivato il link giusto', !!(await estraiLink(posDopo, 'reimposta-password')));

        // L'ALTRA META' DEL CONTROLLO DI RISERVATEZZA.
        ok('account VERIFICATO e indirizzo INVENTATO: risposta identica',
            JSON.stringify(rVerificato.corpo) === JSON.stringify(rInventata.corpo),
            `\n     verificato: ${JSON.stringify(rVerificato.corpo)}\n     inventato:  ${JSON.stringify(rInventata.corpo)}`);
        ok('account VERIFICATO e NON verificato: risposta identica',
            JSON.stringify(rVerificato.corpo) === JSON.stringify(rNonVerificato.corpo));

        // ====================================================================
        console.log('\n--- 6. TOKEN SCADUTO: rifiutato dal CODICE, non dalle pulizie di MongoDB ---');
        // ====================================================================
        const tokenScaduto = crypto.randomBytes(32).toString('base64url');
        await Verifiche.insertOne({
            userId: utenteA._id,
            tokenHash: crypto.createHash('sha256').update(tokenScaduto).digest('hex'),
            createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 ore fa
        });
        ok('un token di 25 ore fa risulta NON valido',
            (await chiama(null, `/api/auth/verify-email/check?token=${encodeURIComponent(tokenScaduto)}`)).corpo.valid === false);
        ok('e viene tolto subito dal database',
            await Verifiche.countDocuments({ userId: utenteA._id }) === 0);

        // ====================================================================
        console.log('\n--- 7. "RIMANDA L\'EMAIL" ---');
        // ====================================================================
        const senzaSessione = await chiama(nuovoBarattolo(), '/api/auth/resend-verification', { method: 'POST' });
        ok('senza essere collegati: 401', senzaSessione.status === 401);

        const giaVerificato = await chiama(barattoloA, '/api/auth/resend-verification', { method: 'POST' });
        ok('a chi ha gia\' confermato risponde senza mandare niente',
            giaVerificato.status === 200 && await Verifiche.countDocuments({ userId: utenteA._id }) === 0,
            JSON.stringify(giaVerificato.corpo));

        // Un secondo account, non verificato, per provare il freno.
        const emailB = `prova-verifica-b-${MARCA}@esempio-di-prova.invalid`;
        const { barattolo: barattoloB } = await registra(emailB, `provaverificab${MARCA}`);
        const utenteB = await Utenti.findOne({ email: emailB });
        idDiProva.push(utenteB._id);

        for (let i = 0; i < 3; i++) {
            await chiama(barattoloB, '/api/auth/resend-verification', { method: 'POST' });
        }
        const quarto = await chiama(barattoloB, '/api/auth/resend-verification', { method: 'POST' });
        ok('il freno anti-abuso scatta sul rinvio ripetuto (429)', quarto.status === 429, `status ${quarto.status}`);
        ok('e resta comunque UN SOLO link valido per volta',
            await Verifiche.countDocuments({ userId: utenteB._id }) === 1);

        // ====================================================================
        console.log('\n--- 8. RISERVATEZZA E ACCOUNT DEMO ---');
        // ====================================================================
        const visto = await chiama(barattoloA, `/api/users/${utenteB._id}`);
        ok('emailVerified non si vede guardando il profilo di un altro',
            visto.status === 200 && visto.corpo && visto.corpo.emailVerified === undefined,
            JSON.stringify(Object.keys(visto.corpo || {})));
        ok('e nemmeno l\'email', visto.corpo && visto.corpo.email === undefined);

        const proprio = await chiama(barattoloA, `/api/users/${utenteA._id}`);
        ok('ma il proprietario lo vede sul proprio profilo', proprio.corpo && proprio.corpo.emailVerified === true);

        const demo = await Utenti.findOne({ isDemoAccount: true });
        ok('nessun token di conferma per gli account demo',
            await Verifiche.countDocuments({ userId: demo._id }) === 0);

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
        fallimenti.push('eccezione: ' + e.message);
    } finally {
        for (const id of idDiProva) {
            await Verifiche.deleteMany({ userId: id });
            await Reset.deleteMany({ userId: id });
            await Utenti.deleteOne({ _id: id });
        }
        const Sessioni = mongoose.connection.collection('sessions');
        const sessioni = await Sessioni.find({}).toArray();
        const idStringa = idDiProva.map(String);
        const daTogliere = sessioni.filter(s => {
            let d = s.session;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return false; } }
            return d && idStringa.includes(String(d.userId));
        }).map(s => s._id);
        if (daTogliere.length) await Sessioni.deleteMany({ _id: { $in: daTogliere } });

        const fine = {
            utenti: await Utenti.countDocuments(),
            verifiche: await Verifiche.countDocuments(),
            reset: await Reset.countDocuments()
        };
        console.log('\nConteggi finali:  ', fine);
        console.log('Conteggi iniziali:', partenza);
        ok('database tornato come prima (utenti)', fine.utenti === partenza.utenti);
        ok('database tornato come prima (conferme)', fine.verifiche === partenza.verifiche);
        ok('database tornato come prima (reimpostazioni)', fine.reset === partenza.reset);

        console.log(`\n=========================================`);
        console.log(`  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (fallimenti.length) console.log('  ->', fallimenti.join('\n  -> '));
        console.log(`=========================================`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
