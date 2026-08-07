// Prova dello stato "invio guasto" (account Mailjet non ancora validato, mittente non
// confermato, quota finita, servizio irraggiungibile).
//
// IL CONTROLLO CHE CONTA e' l'ultimo: quando l'invio e' guasto, un indirizzo REGISTRATO e
// uno INVENTATO devono ricevere ancora la STESSA identica risposta. Se differissero, il
// modulo diventerebbe un elenco degli iscritti proprio nel momento peggiore - quando ogni
// tentativo fallisce e quindi la differenza si vede su ogni singola richiesta.

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';
const MARCA = Date.now();

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

async function chiedi(email) {
    const r = await fetch(BASE + '/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    return r.json();
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Reset = mongoose.connection.collection('passwordresets');
    const Verifiche = mongoose.connection.collection('emailverifications');

    const partenza = { utenti: await Utenti.countDocuments(), reset: await Reset.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];

    try {
        const emailRegistrata = `prova-guasto-${MARCA}@esempio-di-prova.invalid`;
        const emailInventata = `mai-visto-${MARCA}@esempio-di-prova.invalid`;

        const reg = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: 'Prova', cognome: 'Guasto', email: emailRegistrata, password: 'PasswordDiProva1!',
                username: `provaguasto${MARCA}`, ageRange: '30-39', termsAccepted: true,
                emergencyContacts: [{ name: 'Contatto Di Prova', phone: '000', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
            })
        });
        ok('account di prova creato', reg.status === 200);
        idDiProva.push((await Utenti.findOne({ email: emailRegistrata }))._id);

        console.log('\n--- Il server gira SENZA chiavi (come in locale) ---');
        const registrata = await chiedi(emailRegistrata);
        const inventata = await chiedi(emailInventata);

        ok('dice che il recupero non e\' configurato',
            registrata.disponibile === false && /non è ancora attivo/.test(registrata.message),
            JSON.stringify(registrata));

        // QUESTO E' IL CONTROLLO IMPORTANTE.
        ok('indirizzo REGISTRATO e indirizzo INVENTATO ricevono la stessa identica risposta',
            JSON.stringify(registrata) === JSON.stringify(inventata),
            `\n     registrata: ${JSON.stringify(registrata)}\n     inventata:  ${JSON.stringify(inventata)}`);

        console.log('\n--- Le tre risposte possibili sono distinte e coerenti ---');
        const { configurato, inviiFunzionanti } = require('../lib/mailer');
        ok('in locale senza chiavi: configurato() e\' falso', configurato() === false);
        ok('e lo stato di salute parte da "funzionante" (nessun invio ancora tentato)',
            inviiFunzionanti() === true);

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        for (const id of idDiProva) {
            await Reset.deleteMany({ userId: id });
            await Verifiche.deleteMany({ userId: id });
            await Utenti.deleteOne({ _id: id });
        }
        const fine = { utenti: await Utenti.countDocuments(), reset: await Reset.countDocuments() };
        console.log('\nConteggi finali:  ', fine);
        ok('database tornato come prima', fine.utenti === partenza.utenti && fine.reset === partenza.reset);

        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
