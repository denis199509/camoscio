// Prova della funzione configurato() di lib/mailer.js: quando il recupero password si
// considera davvero utilizzabile. Non tocca ne' il database ne' la rete.
//
// Il caso che conta: ONLINE con le chiavi giuste ma senza APP_BASE_URL. Le email
// partirebbero e i link punterebbero a "localhost", cioe' al computer di chi legge:
// inservibili, e senza nessun segnale che qualcosa non va.

const percorso = 'C:/Users/lenovo/OneDrive/Desktop/camoscio/lib/mailer.js';

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

function conAmbiente(variabili) {
    for (const chiave of ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAIL_SENDER_EMAIL', 'APP_BASE_URL', 'NODE_ENV']) {
        delete process.env[chiave];
    }
    Object.assign(process.env, variabili);
    delete require.cache[require.resolve(percorso)];
    return require(percorso);
}

const CHIAVI = {
    MAILJET_API_KEY: 'chiave-di-prova',
    MAILJET_SECRET_KEY: 'segreto-di-prova',
    MAIL_SENDER_EMAIL: 'mittente@esempio-di-prova.invalid'
};

console.log('--- IN LOCALE ---');
let m = conAmbiente({ NODE_ENV: 'development' });
ok('senza chiavi: NON configurato (il sito lo dice invece di promettere email)', m.configurato() === false);

m = conAmbiente({ NODE_ENV: 'development', ...CHIAVI });
ok('con le chiavi e senza APP_BASE_URL: configurato (in locale localhost va benissimo)', m.configurato() === true);
ok('e il link punta a localhost', m.indirizzoBase() === 'http://localhost:3000', m.indirizzoBase());

console.log('\n--- ONLINE (NODE_ENV=production) ---');
m = conAmbiente({ NODE_ENV: 'production', ...CHIAVI });
ok('chiavi giuste ma APP_BASE_URL MANCANTE: NON configurato', m.configurato() === false);

m = conAmbiente({ NODE_ENV: 'production', ...CHIAVI, APP_BASE_URL: 'http://localhost:3000' });
ok('chiavi giuste ma APP_BASE_URL copiata da quella locale: NON configurato', m.configurato() === false);

m = conAmbiente({ NODE_ENV: 'production', ...CHIAVI, APP_BASE_URL: 'https://camoscio.onrender.com' });
ok('tutto giusto: configurato', m.configurato() === true);
ok('e il link punta al sito vero', m.indirizzoBase() === 'https://camoscio.onrender.com', m.indirizzoBase());

m = conAmbiente({ NODE_ENV: 'production', ...CHIAVI, APP_BASE_URL: 'https://camoscio.onrender.com/' });
ok('la barra finale di troppo non rompe il link', m.indirizzoBase() === 'https://camoscio.onrender.com', m.indirizzoBase());

m = conAmbiente({ NODE_ENV: 'production', MAILJET_API_KEY: 'x', APP_BASE_URL: 'https://camoscio.onrender.com' });
ok('una sola chiave su due: NON configurato', m.configurato() === false);

console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
process.exit(falliti === 0 ? 0 : 1);
