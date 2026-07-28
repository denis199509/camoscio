// LA REGISTRAZIONE DEVE RIUSCIRE ANCHE SE L'EMAIL NON PARTE.
//
// E' la conseguenza diretta della scelta dell'utente ("chi si registra entra subito"), e
// il motivo per cui e' importante: entrare nel sito non deve mai dipendere da un servizio
// esterno. Se questo controllo non ci fosse, un guasto di Mailjet bloccherebbe le
// iscrizioni e non ce ne accorgeremmo finche' qualcuno non se ne lamenta.
//
// COME SI SIMULA IL GUASTO SENZA FINGERE NIENTE: si avvia un secondo server su un'altra
// porta con chiavi Mailjet FINTE. Cosi' configurato() e' vero (quindi il ripiego "stampa
// sul terminale" NON scatta) e la chiamata vera a Mailjet fallisce davvero con un 401.
// E' esattamente quello che succederebbe con chiavi sbagliate o revocate.

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3100;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Verifiche = mongoose.connection.collection('emailverifications');
    const partenza = { utenti: await Utenti.countDocuments(), verifiche: await Verifiche.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];
    let server;
    let logServer = '';

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA),
                MAILJET_API_KEY: 'chiave-finta-che-non-funziona',
                MAILJET_SECRET_KEY: 'segreto-finto-che-non-funziona',
                MAIL_SENDER_EMAIL: 'mittente@esempio-di-prova.invalid'
            })
        });
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        // Si aspetta che risponda davvero, non un tempo fisso.
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il secondo server e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        const email = `prova-senza-email-${MARCA}@esempio-di-prova.invalid`;
        const res = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: 'Prova', cognome: 'SenzaEmail', email, password: 'PasswordDiProva1!',
                username: `provasenzaemail${MARCA}`, ageRange: '30-39', termsAccepted: true,
                emergencyContacts: [{ name: 'Contatto Di Prova', phone: '000', relationship: 'Prova' }]
            })
        });

        ok('LA REGISTRAZIONE RIESCE anche se l\'email non parte', res.status === 200, `status ${res.status}`);

        const utente = await Utenti.findOne({ email });
        ok('l\'account esiste davvero sul database', !!utente);
        if (utente) {
            idDiProva.push(utente._id);
            ok('ed e\' segnato come non verificato', utente.emailVerified === false);
        }

        // Si aspetta che il messaggio d'errore compaia nel log, invece di leggerlo a tempo.
        for (let i = 0; i < 20 && !/Invio email fallito/.test(logServer); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
        ok('il guasto e\' finito nel log del server (non e\' passato sotto silenzio)',
            /Invio email fallito/.test(logServer),
            logServer.split('\n').filter(r => /Invio email/.test(r)).join(' | ').slice(0, 200));

        // E il sito, da quel momento, smette di promettere email che non partono.
        const dopo = await fetch(BASE + '/api/auth/forgot-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `chiunque-${MARCA}@esempio-di-prova.invalid` })
        }).then(r => r.json());
        ok('dopo un invio fallito il sito NON promette piu\' email',
            dopo.disponibile === false, JSON.stringify(dopo));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of idDiProva) {
            await Verifiche.deleteMany({ userId: id });
            await Utenti.deleteOne({ _id: id });
        }
        const fine = { utenti: await Utenti.countDocuments(), verifiche: await Verifiche.countDocuments() };
        console.log('\nConteggi finali:  ', fine);
        ok('database tornato come prima',
            fine.utenti === partenza.utenti && fine.verifiche === partenza.verifiche);

        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
