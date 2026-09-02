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
const bcrypt = require('bcryptjs');

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
    let utenteId = null;   // account REALE temporaneo (il DMS non e' disponibile sui demo - A-NUOVO-1)
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

        // --- 1. Account REALE temporaneo + accesso ---
        // Il Dead Man's Switch non e' piu' disponibile sugli account demo (A-NUOVO-1: erano
        // il primo anello della catena "armo il timer con N contatti finti e uso l'invio
        // come relay"). Si crea un utente vero, dritti sul database, e lo si cancella nel
        // finally. Marca riconoscibile nell'username e email @esempio-di-prova.invalid.
        const pwd = `pw-${MARCA}-Xk`;
        const utente = await User.create({
            username: `PROVA-37-${MARCA}`,
            email: `prova-37-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwd, 10),
            nome: 'Prova', cognome: 'Trentasette',
            termsAcceptedAt: new Date(),
            emailVerified: true
        });
        utenteId = String(utente._id);

        const accesso = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: utente.email, password: pwd })
        });
        ok('accesso all\'account di prova riuscito', accesso.status === 200, `status ${accesso.status}`);
        const cookie = (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
            .filter(Boolean).map(c => c.split(';')[0]).join('; ');

        // --- 2. A-3.2: niente piu' "contatto scelto" - alla scadenza l'allarme va a TUTTI i
        //        contatti che hanno un'email. Si preparano: uno SENZA email (non conta) e DUE
        //        con email (devono essere avvisati entrambi).
        const demoId = utenteId; // il resto della prova usa "demoId" come id dell'account
        const emailProvaA = `contatto-prova-37a-${MARCA}@esempio-di-prova.invalid`;
        const emailProvaB = `contatto-prova-37b-${MARCA}@esempio-di-prova.invalid`;
        const soloSenzaEmail = [{ name: 'Contatto Prova SenzaEmail', relationship: 'Prova' }];
        const conDueEmail = [
            { name: 'Contatto Prova SenzaEmail', relationship: 'Prova' },
            { name: 'Contatto Prova ConEmail A', relationship: 'Prova', email: emailProvaA },
            { name: 'Contatto Prova ConEmail B', relationship: 'Prova', email: emailProvaB }
        ];

        // --- 3. Attivazione: rifiutata senza cookie; rifiutata se NESSUN contatto ha
        //        un'email; accettata appena ce n'e' almeno uno ---
        const scadenzaFutura = new Date(Date.now() + 3600000).toISOString();

        const senzaSessione = await chiama('POST', '/api/safety/activate', { expiresAt: scadenzaFutura }, null);
        ok('attivare senza sessione viene rifiutato (401)', senzaSessione.status === 401, `status ${senzaSessione.status}`);

        await chiama('PUT', `/api/users/${demoId}`, { emergencyContacts: soloSenzaEmail }, cookie);
        const senzaEmail = await chiama('POST', '/api/safety/activate', { expiresAt: scadenzaFutura }, cookie);
        ok('attivare senza NESSUN contatto con email viene rifiutato (400)',
            senzaEmail.status === 400, `status ${senzaEmail.status}`);

        const salvataggio = await chiama('PUT', `/api/users/${demoId}`, { emergencyContacts: conDueEmail }, cookie);
        ok('contatti di prova salvati (uno senza email, due con)', salvataggio.status === 200, JSON.stringify(salvataggio.corpo));

        const attivazione = await chiama('POST', '/api/safety/activate', { expiresAt: scadenzaFutura }, cookie);
        ok('attivazione accettata con almeno un contatto con email', attivazione.status === 200, JSON.stringify(attivazione.corpo));

        const dopoAttivazione = await User.findById(demoId);
        ok('deadManActive salvato sul database', dopoAttivazione.deadManActive === true);
        ok('deadManContactIndex NON viene piu\' scritto (A-3.2)', dopoAttivazione.deadManContactIndex === undefined);
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
        await chiama('POST', '/api/safety/activate', { expiresAt: scadenzaFutura }, cookie);
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

        // A-3.2: l'allarme va a TUTTI i contatti con email - devono comparire ENTRAMBI gli
        // indirizzi di prova nel log del server, non solo uno.
        for (let i = 0; i < 20 && !(logServer.includes(emailProvaA) && logServer.includes(emailProvaB)); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
        ok('l\'email e\' stata composta per il PRIMO contatto con email (log del server)',
            logServer.includes(emailProvaA));
        ok('...e anche per il SECONDO contatto con email (avvisati tutti, A-3.2)',
            logServer.includes(emailProvaB));
        ok('con piu\' contatti, l\'email dice di coordinarsi con gli altri (A-3.2)',
            /coordinatevi/i.test(logServer) && /uno dei contatti di emergenza/i.test(logServer));
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

        // L'account di prova e' NOSTRO (creato in questo run): si cancella per intero, con
        // tutte le notifiche che ha generato. Filtrato per _id, mai per qualcos'altro.
        if (utenteId) {
            const oid = new mongoose.Types.ObjectId(utenteId);
            try { await User.deleteOne({ _id: oid }); } catch (e) {
                console.error('ATTENZIONE: cancellazione account di prova fallita:', e.message);
            }
            await mongoose.connection.collection('notifications').deleteMany({ userId: oid });
            await mongoose.connection.collection('activehikesessions').deleteMany({ userId: oid });
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            notifiche: await mongoose.connection.collection('notifications').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna notifica di prova rimasta', fine.notifiche === partenza.notifiche, `${partenza.notifiche} -> ${fine.notifiche}`);

        if (utenteId) {
            const rimasto = await User.findById(utenteId);
            ok('l\'account di prova e\' stato cancellato', !rimasto);
        }

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
