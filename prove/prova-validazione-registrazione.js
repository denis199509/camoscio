// PROVA: BASSO, follow-up revisione sicurezza - POST /api/auth/register non deve piu'
// rispecchiare il VALORE grezzo di un ValidationError di Mongoose (ne' al client ne' nel
// log del server), solo il nome dei campi coinvolti.
//
// PERCHE' birthDate e non emergencyContacts: i campi piu' esposti (nome/cognome/username/
// emergencyContacts) hanno gia' un controllo manuale con messaggio sicuro PRIMA di
// User.create() (vedi routes/auth.js) - un valore che li supera non arriva mai al
// ValidationError generico. birthDate invece non ha un controllo di formato a monte: una
// stringa non parsabile come data passa calculateAge() (NaN < 18 e' false in JS, non blocca)
// e arriva intatta a User.create(), dove il cast a Date fallisce - e' la dimostrazione che il
// catch generico resta una rete viva per qualunque campo futuro senza lo stesso controllo.
//
// Lanciarla:  node prove/prova-validazione-registrazione.js   (avvia un server suo sulla 3131)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3131;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();
const VALORE_GREZZO = `questo-testo-non-e-una-data-${MARCA}`;

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const partenza = { utenti: await Utenti.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];
    let server, logServer = '';

    try {
        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        console.log('\n1. birthDate non valido -> ValidationError di Mongoose');

        const email = `prova-validazione-${MARCA}@esempio-di-prova.invalid`;
        const res = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: 'Prova', cognome: 'Validazione', email, password: 'PasswordDiProva1!',
                username: `provavalidazione${MARCA}`, birthDate: VALORE_GREZZO, termsAccepted: true,
                emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
            })
        });
        const corpo = await res.json();

        ok('risponde 400 (non 500: e\' proprio il ramo ValidationError)', res.status === 400, `status ${res.status}`);
        ok('il messaggio e\' generico, NON quello di Mongoose', corpo.error === 'Dati non validi. Controlla i campi inseriti.', JSON.stringify(corpo));
        ok('il valore grezzo NON compare nella risposta', !JSON.stringify(corpo).includes(VALORE_GREZZO), JSON.stringify(corpo));

        const nonCreato = await Utenti.findOne({ email });
        ok('l\'account NON e\' stato creato', !nonCreato);
        if (nonCreato) idDiProva.push(nonCreato._id);

        // Il valore non deve rispecchiarsi nemmeno nel log del server (stdout/stderr) - solo
        // il nome del campo (birthDate) puo' comparire, mai il valore che l'ha fatto fallire.
        for (let i = 0; i < 10 && !/Errore registrazione \(validazione\)/.test(logServer); i++) {
            await new Promise(r => setTimeout(r, 200));
        }
        ok('il log del server nomina il campo (birthDate)', /Errore registrazione \(validazione\)/.test(logServer) && /birthDate/.test(logServer),
            logServer.split('\n').filter(r => /Errore registrazione/.test(r)).join(' | ').slice(0, 200));
        ok('...ma NON il valore grezzo', !logServer.includes(VALORE_GREZZO));

        console.log('\n2. controllo di comodo: un contatto di emergenza troppo lungo resta un messaggio sicuro (invariato)');

        const contattoLungo = 'x'.repeat(200);
        const res2 = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: 'Prova', cognome: 'Validazione2', email: `prova-validazione2-${MARCA}@esempio-di-prova.invalid`,
                password: 'PasswordDiProva1!', username: `provavalidazione2${MARCA}`, ageRange: '30-39', termsAccepted: true,
                emergencyContacts: [{ name: contattoLungo, relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
            })
        });
        const corpo2 = await res2.json();
        ok('resta 400 con messaggio sicuro (validaContattiEmergenza, invariato)', res2.status === 400 && corpo2.error === 'Un contatto di emergenza ha un campo troppo lungo', JSON.stringify(corpo2));
        ok('non e\' passato dal ramo ValidationError (nessun testo di Mongoose)', !/Cast to|validation failed/i.test(corpo2.error || ''));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of idDiProva) {
            await Utenti.deleteOne({ _id: id }).catch(() => {});
        }
        const fine = { utenti: await Utenti.countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, JSON.stringify({ partenza, fine }));

        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
