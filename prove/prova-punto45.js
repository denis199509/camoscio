// PROVA DEL PUNTO 45 (moderazione segnalazioni sentiero): campo canModerateReports, le tre
// rotte nuove (GET /pending, PATCH /:id/confirm, DELETE /:id) e la correzione di sicurezza
// su GET /api/reports (non deve piu' esporre segnalazioni 'pending' a chiunque sia loggato).
//
// Usa due account DEMO (login senza password): A resta senza permesso per tutta la prova,
// B viene elevato a moderatore DIRETTAMENTE sul database - non esiste (e non deve esistere)
// un'interfaccia per farlo, si usa scripts/set-report-moderator.js in produzione. Stesso
// schema di prova-punto37.js (che eleva deadManExpiresAt allo stesso modo).
//
// Lanciarla:  node prove/prova-punto45.js      (non serve un server gia' acceso, ne avvia uno suo)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3103;
const BASE = `http://localhost:${PORTA}`;
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

async function loginDemo(userId) {
    const accesso = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const Report = require('../models/Report');

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        report: await mongoose.connection.collection('reports').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let logServer = '';
    let idA = null, idB = null, reportId1 = null, reportId2 = null;

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, { PORT: String(PORTA) })
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

        // --- 1. Due account demo: A resta senza permesso per tutta la prova, B verra'
        //        elevato al punto 5 ---
        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno due account demo disponibili', Array.isArray(elenco) && elenco.length >= 2, `trovati ${elenco.length}`);
        idA = elenco[0].id;
        idB = elenco[1].id;
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        console.log(`     (account demo: A=${elenco[0].username}, B=${elenco[1].username})`);

        // --- 2. A crea una segnalazione: deve nascere 'pending', non subito pubblica ---
        const creazione = await chiama('POST', '/api/reports',
            { type: 'frana', lat: 42.45, lng: 13.55, description: `PROVA-45-${MARCA} prima segnalazione` }, cookieA);
        ok('creazione segnalazione accettata', creazione.status === 200, JSON.stringify(creazione.corpo));
        ok('nasce con status pending', creazione.corpo && creazione.corpo.status === 'pending', JSON.stringify(creazione.corpo));
        reportId1 = creazione.corpo && creazione.corpo.id;

        // --- 3. La falla di sicurezza che questo lavoro chiude: la GET pubblica non deve
        //        esporre un pending via rete, nemmeno a chi l'ha creato ---
        const listaPubblicaA = await chiama('GET', '/api/reports', null, cookieA);
        ok('GET /api/reports non contiene la segnalazione pending appena creata',
            Array.isArray(listaPubblicaA.corpo) && !listaPubblicaA.corpo.some(r => r.id === reportId1));

        // --- 4. A (senza permesso) non puo' moderare: 403 su tutte e tre le rotte nuove ---
        const pendingComeA = await chiama('GET', '/api/reports/pending', null, cookieA);
        ok('GET /pending come A (senza permesso) da 403', pendingComeA.status === 403, `status ${pendingComeA.status}`);

        const confermaComeA = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieA);
        ok('PATCH /:id/confirm come A (senza permesso) da 403', confermaComeA.status === 403, `status ${confermaComeA.status}`);

        const rifiutaComeA = await chiama('DELETE', `/api/reports/${reportId1}`, null, cookieA);
        ok('DELETE /:id come A (senza permesso) da 403', rifiutaComeA.status === 403, `status ${rifiutaComeA.status}`);

        // --- 5. Eleva B a moderatore DIRETTAMENTE sul database ---
        await User.findByIdAndUpdate(idB, { canModerateReports: true });
        const bDopoElevazione = await User.findById(idB);
        ok('B risulta moderatore sul database', bDopoElevazione.canModerateReports === true);

        // --- 6. B vede la segnalazione di A nell'elenco pendenti ---
        const pendingComeB = await chiama('GET', '/api/reports/pending', null, cookieB);
        ok('GET /pending come B (con permesso) risponde 200', pendingComeB.status === 200, `status ${pendingComeB.status}`);
        ok('la segnalazione di A compare nei pendenti di B',
            Array.isArray(pendingComeB.corpo) && pendingComeB.corpo.some(r => r.id === reportId1));

        // --- 7. B conferma: diventa pubblica esattamente come un report attivo di sempre ---
        const conferma = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieB);
        ok('conferma come B accettata', conferma.status === 200, JSON.stringify(conferma.corpo));
        ok('dopo la conferma lo status e\' active', conferma.corpo && conferma.corpo.status === 'active', JSON.stringify(conferma.corpo));

        const listaPubblicaDopo = await chiama('GET', '/api/reports', null, cookieA);
        ok('dopo la conferma la segnalazione compare nella lista pubblica',
            Array.isArray(listaPubblicaDopo.corpo) && listaPubblicaDopo.corpo.some(r => r.id === reportId1));

        // --- 8. Una seconda segnalazione, rifiutata: deve sparire per sempre, non solo
        //        cambiare stato ---
        const creazione2 = await chiama('POST', '/api/reports',
            { type: 'ghiaccio', lat: 42.46, lng: 13.56, description: `PROVA-45-${MARCA} seconda segnalazione` }, cookieA);
        reportId2 = creazione2.corpo && creazione2.corpo.id;
        ok('seconda segnalazione creata come pending', creazione2.status === 200 && creazione2.corpo && creazione2.corpo.status === 'pending');

        const rifiuto = await chiama('DELETE', `/api/reports/${reportId2}`, null, cookieB);
        ok('rifiuto come B accettato', rifiuto.status === 200, JSON.stringify(rifiuto.corpo));

        const dopoRifiuto = await Report.findById(reportId2);
        ok('la segnalazione rifiutata e\' stata eliminata per davvero (non solo nascosta)', dopoRifiuto === null);

        // --- 9. Nessuna regressione: il vecchio flusso crowdsourced "risolvi" resta aperto
        //        a chiunque sia loggato, anche a chi non modera, anche sulla segnalazione
        //        ormai attiva grazie al punto 7 ---
        const risolviVecchiaRotta = await chiama('PATCH', `/api/reports/${reportId1}`, null, cookieA);
        ok('la vecchia PATCH /:id (risolvi) resta aperta a chiunque loggato',
            risolviVecchiaRotta.status === 200, JSON.stringify(risolviVecchiaRotta.corpo));

        // --- 10. Le rotte di moderazione rifiutano un report che non e' (piu') pending ---
        const confermaSuRisolto = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieB);
        ok('confermare un report non-pending da 400', confermaSuRisolto.status === 400, `status ${confermaSuRisolto.status}`);

        const rifiutaSuRisolto = await chiama('DELETE', `/api/reports/${reportId1}`, null, cookieB);
        ok('rifiutare un report non-pending da 400', rifiutaSuRisolto.status === 400, `status ${rifiutaSuRisolto.status}`);

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // Cleanup mirato per id, mai una deleteMany generica.
        if (reportId1) await mongoose.connection.collection('reports').deleteOne({ _id: new mongoose.Types.ObjectId(reportId1) }).catch(() => {});
        if (reportId2) await mongoose.connection.collection('reports').deleteOne({ _id: new mongoose.Types.ObjectId(reportId2) }).catch(() => {});
        if (idB) await User.findByIdAndUpdate(idB, { $unset: { canModerateReports: 1 } }).catch(() => {});

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            report: await mongoose.connection.collection('reports').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna segnalazione di prova rimasta sul database', fine.report === partenza.report, `${partenza.report} -> ${fine.report}`);

        if (idB) {
            const bFinale = await User.findById(idB);
            ok('B non e\' piu\' moderatore (permesso revocato a fine prova)', bFinale.canModerateReports === undefined);
        }

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
