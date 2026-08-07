// PROVA DEL PUNTO 37 (Dead Man's Switch, seconda meta'): il conto alla rovescia sul server.
//
// COSA CONTROLLA, in breve: che il timer sopravviva a pagina chiusa. Non si puo' chiudere
// davvero una pagina dentro una prova automatica, quindi si SIMULA l'unica cosa che conta
// dal punto di vista del server - il tempo che passa - retrodatando la scadenza direttamente
// sul database (POST /activate la rifiuta nel passato, giustamente: quel controllo e' per
// l'utente, non per questa prova) e chiamando POST /controlla-scadenze come farebbe il
// trigger esterno.
//
// Usa un account DEMO (login senza password) invece di registrarne uno nuovo: meno stato da
// pulire, stesso schema gia' visto in prova-punto35.js e prova-dislivello-vivo.js. L'unico
// dato condiviso toccato e' emergencyContacts, salvato prima e ripristinato identico dopo.
//
// NIENT'EMAIL VERA: il server di prova parte con le chiavi Mailjet VUOTE (non quelle del
// .env reale, che dal 06/08/2026 sono vere - vedi 07-Trappole-Tecniche.md del vault), cosi'
// lib/mailer.js stampa il contenuto sul suo log invece di chiamare Mailjet davvero. Si legge
// il contenuto da li', stesso principio di prova-registrazione-senza-email.js.
//
// Lanciarla:  node prove/prova-punto37.js      (non serve un server gia' acceso, ne avvia uno suo)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3102;
const BASE = `http://localhost:${PORTA}`;
const SEGRETO = 'segreto-di-prova-punto37';
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let corpoRisposta = null;
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* risposta non-JSON */ }
    return { status: r.status, corpo: corpoRisposta, testo };
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const Notification = require('../models/Notification');

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        notifiche: await mongoose.connection.collection('notifications').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let logServer = '';
    let demoId = null;
    let contattiOriginali = null;
    const inizioProva = new Date();

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA),
                SAFETY_CRON_SECRET: SEGRETO,
                // Vuote apposta (non quelle vere del .env): forza il ramo "stampa sul log"
                // di lib/mailer.js invece di chiamare Mailjet per davvero.
                MAILJET_API_KEY: '', MAILJET_SECRET_KEY: '', MAIL_SENDER_EMAIL: ''
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
        if (!pronto) throw new Error('il server di prova non risponde');

        // --- 1. Accesso con un account demo ---
        // /api/auth/demo-accounts espone "id", non "_id" (trappola gia' pagata piu' volte).
        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno un account demo disponibile', Array.isArray(elenco) && elenco.length > 0);
        demoId = elenco[0].id;

        const accesso = await fetch(BASE + '/api/auth/demo-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: demoId })
        });
        ok('accesso demo riuscito', accesso.status === 200, `status ${accesso.status}`);
        const cookie = (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
            .filter(Boolean).map(c => c.split(';')[0]).join('; ');
        console.log(`     (account demo usato: ${elenco[0].username})`);

        // --- 2. Due contatti temporanei: uno SENZA email (simula un contatto vecchio, pre
        //        punto 37) e uno CON - serve a provare sia il rifiuto sia il caso buono.
        const demoAttuale = await User.findById(demoId);
        contattiOriginali = (demoAttuale.emergencyContacts || []).map(c => c.toObject());

        const emailProva = `contatto-prova-37-${MARCA}@esempio-di-prova.invalid`;
        const nuoviContatti = contattiOriginali.concat([
            { name: 'Contatto Prova SenzaEmail', phone: '000', relationship: 'Prova' },
            { name: 'Contatto Prova ConEmail', phone: '000', relationship: 'Prova', email: emailProva }
        ]);
        const indiceSenzaEmail = contattiOriginali.length;
        const indiceConEmail = contattiOriginali.length + 1;

        const salvataggio = await chiama('PUT', `/api/users/${demoId}`, { emergencyContacts: nuoviContatti }, cookie);
        ok('contatti di prova salvati', salvataggio.status === 200, JSON.stringify(salvataggio.corpo));

        // --- 3. Attivazione: rifiutata senza cookie, rifiutata su un contatto senza email,
        //        accettata su un contatto con email ---
        const scadenzaFutura = new Date(Date.now() + 3600000).toISOString();

        const senzaSessione = await chiama('POST', '/api/safety/activate',
            { expiresAt: scadenzaFutura, contactIndex: indiceConEmail }, null);
        ok('attivare senza sessione viene rifiutato (401)', senzaSessione.status === 401, `status ${senzaSessione.status}`);

        const conContattoSenzaEmail = await chiama('POST', '/api/safety/activate',
            { expiresAt: scadenzaFutura, contactIndex: indiceSenzaEmail }, cookie);
        ok('attivare su un contatto SENZA email viene rifiutato',
            conContattoSenzaEmail.status === 400, `status ${conContattoSenzaEmail.status}`);

        const attivazione = await chiama('POST', '/api/safety/activate',
            { expiresAt: scadenzaFutura, contactIndex: indiceConEmail }, cookie);
        ok('attivazione su un contatto CON email accettata', attivazione.status === 200, JSON.stringify(attivazione.corpo));

        const dopoAttivazione = await User.findById(demoId);
        ok('deadManActive salvato sul database', dopoAttivazione.deadManActive === true);
        ok('deadManContactIndex salvato correttamente', dopoAttivazione.deadManContactIndex === indiceConEmail);
        ok('deadManExpiresAt salvato correttamente',
            !!dopoAttivazione.deadManExpiresAt && Math.abs(dopoAttivazione.deadManExpiresAt.getTime() - new Date(scadenzaFutura).getTime()) < 1000);

        // --- 4. Il check-in disattiva DAVVERO sul server, non solo in locale ---
        const checkin = await chiama('POST', '/api/safety/deactivate', null, cookie);
        ok('check-in accettato', checkin.status === 200, JSON.stringify(checkin.corpo));
        const dopoCheckin = await User.findById(demoId);
        ok('dopo il check-in deadManActive non e\' piu\' impostato', dopoCheckin.deadManActive === undefined);
        ok('dopo il check-in deadManExpiresAt non e\' piu\' impostato', dopoCheckin.deadManExpiresAt === undefined);

        // Il controllo scadenze, chiamato subito dopo un check-in regolare, non deve fare
        // scattare nessun allarme: e' la prova che il check-in funziona davvero, non solo a
        // schermo.
        const notificheDopoCheckin = await Notification.countDocuments({ userId: demoId, createdAt: { $gte: inizioProva } });
        await chiama('POST', `/api/safety/controlla-scadenze?chiave=${SEGRETO}`, null, null);
        const notificheAncora = await Notification.countDocuments({ userId: demoId, createdAt: { $gte: inizioProva } });
        ok('nessuna notifica creata per un timer regolarmente disattivato',
            notificheAncora === notificheDopoCheckin, `${notificheDopoCheckin} -> ${notificheAncora}`);

        // --- 5. Riattiva e simula il tempo che passa (retrodatando sul database: /activate
        //        rifiuta apposta una scadenza nel passato, quel controllo e' per l'utente) ---
        await chiama('POST', '/api/safety/activate', { expiresAt: scadenzaFutura, contactIndex: indiceConEmail }, cookie);
        await User.findByIdAndUpdate(demoId, { deadManExpiresAt: new Date(Date.now() - 60000) });

        // --- 6. La rotta del cron: rifiutata senza segreto e col segreto sbagliato ---
        const senzaSegreto = await chiama('POST', '/api/safety/controlla-scadenze', null, null);
        ok('controlla-scadenze senza segreto viene rifiutata (403)', senzaSegreto.status === 403, `status ${senzaSegreto.status}`);

        const segretoSbagliato = await chiama('POST', '/api/safety/controlla-scadenze?chiave=sbagliato', null, null);
        ok('controlla-scadenze col segreto sbagliato viene rifiutata (403)', segretoSbagliato.status === 403, `status ${segretoSbagliato.status}`);

        // --- 7. IL CONTROLLO CHE CONTA: il segreto giusto trova lo scaduto e manda l'allarme ---
        const controllo = await chiama('POST', `/api/safety/controlla-scadenze?chiave=${SEGRETO}`, null, null);
        ok('controlla-scadenze col segreto giusto risponde 200', controllo.status === 200, JSON.stringify(controllo.corpo));
        ok('controlla-scadenze ha trovato almeno uno scaduto',
            controllo.corpo && controllo.corpo.controllati >= 1, JSON.stringify(controllo.corpo));

        const dopoScadenza = await User.findById(demoId);
        ok('dopo la scadenza il timer e\' stato disattivato da solo', dopoScadenza.deadManActive === undefined);

        const notificaAllarme = await Notification.findOne({ userId: demoId, createdAt: { $gte: inizioProva } }).sort({ createdAt: -1 });
        ok('e\' stata lasciata una notifica sull\'esito', !!notificaAllarme, 'nessuna notifica trovata');
        if (notificaAllarme) {
            ok('la notifica parla di un avviso mandato', /avviso.*email|email.*fallit/i.test(notificaAllarme.text), notificaAllarme.text);
        }

        // Si aspetta che il contenuto arrivi nel log del server, invece di leggerlo a tempo fisso.
        for (let i = 0; i < 20 && !logServer.includes(emailProva); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
        ok('l\'email vera e\' stata composta per il contatto giusto (letta dal log del server)',
            logServer.includes(emailProva));
        ok('l\'oggetto dell\'email parla del check-in mancato',
            /non ha fatto il check-in/i.test(logServer));

        // --- 8. Nessuna regressione: disattivare senza sessione resta vietato ---
        const disattivaSenzaSessione = await chiama('POST', '/api/safety/deactivate', null, null);
        ok('disattivare senza sessione viene rifiutato (401)', disattivaSenzaSessione.status === 401, `status ${disattivaSenzaSessione.status}`);

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        if (demoId && contattiOriginali) {
            try {
                await User.findByIdAndUpdate(demoId, {
                    emergencyContacts: contattiOriginali,
                    $unset: { deadManActive: 1, deadManExpiresAt: 1, deadManContactIndex: 1 }
                });
            } catch (e) {
                console.error('ATTENZIONE: ripristino dei contatti demo fallito a mano:', e.message);
            }
            await mongoose.connection.collection('notifications').deleteMany({
                userId: new mongoose.Types.ObjectId(demoId),
                createdAt: { $gte: inizioProva }
            });
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            notifiche: await mongoose.connection.collection('notifications').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna notifica di prova rimasta', fine.notifiche === partenza.notifiche, `${partenza.notifiche} -> ${fine.notifiche}`);

        if (demoId) {
            const demoFinale = await User.findById(demoId);
            const contattiTornatiUguali = JSON.stringify((demoFinale.emergencyContacts || []).map(c => c.toObject()))
                === JSON.stringify(contattiOriginali || []);
            ok('i contatti demo sono tornati esattamente come prima', contattiTornatiUguali);
        }

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
