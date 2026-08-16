// PROVA DEL PUNTO 45 (moderazione segnalazioni sentiero + foto): campo canModerateReports, le
// rotte di moderazione (GET /pending, PATCH /:id/confirm, DELETE /:id), la correzione di
// sicurezza su GET /api/reports (non deve piu' esporre segnalazioni 'pending' a chiunque sia
// loggato), la foto (upload, GET /:id/photo, mai nelle liste) e "risolvi" che ora CANCELLA per
// intero (DELETE /:id/resolve) invece di marcare 'resolved'.
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

// GET /:id/photo risponde byte veri (image/jpeg), non JSON: serve un fetch a parte che non
// provi a fare JSON.parse sul corpo.
async function scaricaFoto(percorso, cookie) {
    const r = await fetch(BASE + percorso, { headers: cookie ? { Cookie: cookie } : {} });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, contentType: r.headers.get('content-type'), buf };
}

async function loginDemo(userId) {
    const accesso = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

// Un JPEG finto ma valido per i controlli del server: i tre magic bytes veri (FF D8 FF) piu'
// N byte a caso. Il server non decodifica l'immagine, controlla solo dimensione e questi tre
// byte - non serve un JPEG vero e proprio per provare la rotta.
function jpegFinto(bytes) {
    const buf = Buffer.alloc(bytes);
    buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
    for (let i = 3; i < bytes; i++) buf[i] = i % 256; // contenuto riconoscibile, per il confronto byte a byte dopo
    return buf;
}
function comeDataUrl(buf) {
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
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

        // --- 2. A crea una segnalazione CON FOTO: deve nascere 'pending', non subito
        //        pubblica, e la foto non deve mai comparire nella risposta ---
        const fotoOriginale = jpegFinto(2000);
        const creazione = await chiama('POST', '/api/reports',
            { type: 'frana', lat: 42.45, lng: 13.55, description: `PROVA-45-${MARCA} prima segnalazione`, photo: comeDataUrl(fotoOriginale) },
            cookieA);
        ok('creazione segnalazione accettata', creazione.status === 200, JSON.stringify(creazione.corpo));
        ok('nasce con status pending', creazione.corpo && creazione.corpo.status === 'pending', JSON.stringify(creazione.corpo));
        ok('hasPhoto e\' true', creazione.corpo && creazione.corpo.hasPhoto === true, JSON.stringify(creazione.corpo));
        ok('la risposta NON contiene mai il campo photo (select:false non vale sul documento appena creato)',
            creazione.corpo && !('photo' in creazione.corpo), JSON.stringify(creazione.corpo));
        reportId1 = creazione.corpo && creazione.corpo.id;

        // --- 3. La falla di sicurezza che questo lavoro chiude: la GET pubblica non deve
        //        esporre un pending via rete, nemmeno a chi l'ha creato ---
        const listaPubblicaA = await chiama('GET', '/api/reports', null, cookieA);
        ok('GET /api/reports non contiene la segnalazione pending appena creata',
            Array.isArray(listaPubblicaA.corpo) && !listaPubblicaA.corpo.some(r => r.id === reportId1));

        // --- 4. A (senza permesso) non puo' moderare: 403 su tutte e tre le rotte di
        //        moderazione. La rotta di risoluzione (DELETE /:id/resolve) invece NON e'
        //        gated sul permesso - qui deve dare 400 (report ancora pending, non active),
        //        mai 403: e' proprio la differenza voluta (crowdsourced come "risolvi" di
        //        sempre, non come confermare/rifiutare). ---
        const pendingComeA = await chiama('GET', '/api/reports/pending', null, cookieA);
        ok('GET /pending come A (senza permesso) da 403', pendingComeA.status === 403, `status ${pendingComeA.status}`);

        const confermaComeA = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieA);
        ok('PATCH /:id/confirm come A (senza permesso) da 403', confermaComeA.status === 403, `status ${confermaComeA.status}`);

        const rifiutaComeA = await chiama('DELETE', `/api/reports/${reportId1}`, null, cookieA);
        ok('DELETE /:id come A (senza permesso) da 403', rifiutaComeA.status === 403, `status ${rifiutaComeA.status}`);

        const risolviPendingComeA = await chiama('DELETE', `/api/reports/${reportId1}/resolve`, null, cookieA);
        ok('DELETE /:id/resolve su un report ancora pending da 400, non 403 (non e\' gated sul permesso)',
            risolviPendingComeA.status === 400, `status ${risolviPendingComeA.status}`);

        // --- 4b. Senza nessun cookie: 401 su rotte protette (foto e risoluzione comprese) ---
        const fotoSenzaLogin = await scaricaFoto(`/api/reports/${reportId1}/photo`, null);
        ok('GET /:id/photo senza login da 401', fotoSenzaLogin.status === 401, `status ${fotoSenzaLogin.status}`);

        const risolviSenzaLogin = await chiama('DELETE', `/api/reports/${reportId1}/resolve`, null, null);
        ok('DELETE /:id/resolve senza login da 401', risolviSenzaLogin.status === 401, `status ${risolviSenzaLogin.status}`);

        // --- 5. Eleva B a moderatore DIRETTAMENTE sul database ---
        await User.findByIdAndUpdate(idB, { canModerateReports: true });
        const bDopoElevazione = await User.findById(idB);
        ok('B risulta moderatore sul database', bDopoElevazione.canModerateReports === true);

        // --- 6. B vede la segnalazione di A nell'elenco pendenti, con hasPhoto ma senza la
        //        foto vera (select:false rispettato dalle query normali) ---
        const pendingComeB = await chiama('GET', '/api/reports/pending', null, cookieB);
        ok('GET /pending come B (con permesso) risponde 200', pendingComeB.status === 200, `status ${pendingComeB.status}`);
        const vocePending = Array.isArray(pendingComeB.corpo) && pendingComeB.corpo.find(r => r.id === reportId1);
        ok('la segnalazione di A compare nei pendenti di B', !!vocePending);
        ok('hasPhoto visibile nell\'elenco pendenti', vocePending && vocePending.hasPhoto === true);
        ok('la foto NON e\' nell\'elenco pendenti (select:false)', vocePending && !('photo' in vocePending));

        // --- 7. La foto vera si scarica solo dalla rotta dedicata, e i byte tornano
        //        identici a quelli mandati - anche per A (il creatore, non moderatore):
        //        GET /:id/photo e' requireAuth e basta, non gated sul permesso. ---
        const fotoScaricata = await scaricaFoto(`/api/reports/${reportId1}/photo`, cookieA);
        ok('GET /:id/photo come A (creatore, non moderatore) risponde 200', fotoScaricata.status === 200, `status ${fotoScaricata.status}`);
        ok('Content-Type e\' image/jpeg', fotoScaricata.contentType === 'image/jpeg', fotoScaricata.contentType);
        ok('i byte della foto tornano identici a quelli mandati', fotoScaricata.buf.equals(fotoOriginale));

        // --- 8. B conferma: diventa pubblica esattamente come un report attivo di sempre ---
        const conferma = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieB);
        ok('conferma come B accettata', conferma.status === 200, JSON.stringify(conferma.corpo));
        ok('dopo la conferma lo status e\' active', conferma.corpo && conferma.corpo.status === 'active', JSON.stringify(conferma.corpo));

        const listaPubblicaDopo = await chiama('GET', '/api/reports', null, cookieA);
        const voceAttiva = Array.isArray(listaPubblicaDopo.corpo) && listaPubblicaDopo.corpo.find(r => r.id === reportId1);
        ok('dopo la conferma la segnalazione compare nella lista pubblica', !!voceAttiva);
        ok('hasPhoto visibile anche nella lista pubblica', voceAttiva && voceAttiva.hasPhoto === true);
        ok('la foto NON e\' nella lista pubblica (select:false)', voceAttiva && !('photo' in voceAttiva));

        // --- 9. Le rotte di moderazione rifiutano un report che non e' (piu') pending -
        //        fatto ORA, mentre reportId1 e' ancora 'active' e prima di risolverlo
        //        (che lo cancella per davvero, vedi punto 12): dopo non esisterebbe piu' da
        //        poter testare. ---
        const confermaSuAttivo = await chiama('PATCH', `/api/reports/${reportId1}/confirm`, null, cookieB);
        ok('confermare un report non-pending da 400', confermaSuAttivo.status === 400, `status ${confermaSuAttivo.status}`);

        const rifiutaSuAttivo = await chiama('DELETE', `/api/reports/${reportId1}`, null, cookieB);
        ok('rifiutare (moderazione) un report non-pending da 400', rifiutaSuAttivo.status === 400, `status ${rifiutaSuAttivo.status}`);

        // --- 10. Una seconda segnalazione, SENZA foto (percorso facoltativo), rifiutata:
        //         deve sparire per sempre, non solo cambiare stato ---
        const creazione2 = await chiama('POST', '/api/reports',
            { type: 'ghiaccio', lat: 42.46, lng: 13.56, description: `PROVA-45-${MARCA} seconda segnalazione` }, cookieA);
        reportId2 = creazione2.corpo && creazione2.corpo.id;
        ok('seconda segnalazione creata come pending', creazione2.status === 200 && creazione2.corpo && creazione2.corpo.status === 'pending');
        ok('senza foto, hasPhoto resta assente (non false: vincolo spazio)', creazione2.corpo && creazione2.corpo.hasPhoto === undefined, JSON.stringify(creazione2.corpo));

        const rifiuto = await chiama('DELETE', `/api/reports/${reportId2}`, null, cookieB);
        ok('rifiuto come B accettato', rifiuto.status === 200, JSON.stringify(rifiuto.corpo));

        const dopoRifiuto = await Report.findById(reportId2);
        ok('la segnalazione rifiutata e\' stata eliminata per davvero (non solo nascosta)', dopoRifiuto === null);

        // --- 11. Foto troppo grande o con byte iniziali sbagliati: 400, nessun documento
        //         creato (il conteggio non deve muoversi) ---
        const conteggioPrimaFotoCattive = await mongoose.connection.collection('reports').countDocuments();

        const fotoTroppoGrande = jpegFinto(700 * 1024); // sopra i 600 KB del server
        const creazioneTroppoGrande = await chiama('POST', '/api/reports',
            { type: 'ostacolo', lat: 42.47, lng: 13.57, description: 'foto troppo grande', photo: comeDataUrl(fotoTroppoGrande) }, cookieA);
        ok('foto oltre il tetto (600 KB) da 400', creazioneTroppoGrande.status === 400, `status ${creazioneTroppoGrande.status}`);

        const fotoByteSbagliati = Buffer.alloc(2000); // niente FF D8 FF in testa
        const creazioneByteSbagliati = await chiama('POST', '/api/reports',
            { type: 'ostacolo', lat: 42.47, lng: 13.57, description: 'byte non jpeg', photo: comeDataUrl(fotoByteSbagliati) }, cookieA);
        ok('foto senza i magic bytes JPEG da 400', creazioneByteSbagliati.status === 400, `status ${creazioneByteSbagliati.status}`);

        const conteggioDopoFotoCattive = await mongoose.connection.collection('reports').countDocuments();
        ok('nessuna delle due segnalazioni rifiutate e\' stata creata sul database',
            conteggioDopoFotoCattive === conteggioPrimaFotoCattive, `${conteggioPrimaFotoCattive} -> ${conteggioDopoFotoCattive}`);

        // --- 12. "Risolvi" ora CANCELLA per intero (non solo status:'resolved') - resta
        //         crowdsourced, quindi apribile anche da A (il creatore, non moderatore),
        //         non solo da B. Idempotente: richiamarla su un id gia' sparito da comunque
        //         200, non 404 (due persone potrebbero risolvere lo stesso pericolo quasi
        //         insieme). ---
        const risolvi = await chiama('DELETE', `/api/reports/${reportId1}/resolve`, null, cookieA);
        ok('risolvi (A, non moderatore) accettato', risolvi.status === 200, JSON.stringify(risolvi.corpo));
        ok('risolvi risponde {success:true}', risolvi.corpo && risolvi.corpo.success === true, JSON.stringify(risolvi.corpo));

        const dopoRisolvi = await Report.findById(reportId1);
        ok('la segnalazione risolta e\' stata eliminata per davvero (non status:\'resolved\')', dopoRisolvi === null);

        const risolviDiNuovo = await chiama('DELETE', `/api/reports/${reportId1}/resolve`, null, cookieA);
        ok('richiamare risolvi su un id gia\' sparito da comunque 200 (idempotente)', risolviDiNuovo.status === 200, `status ${risolviDiNuovo.status}`);

        const fotoDopoRisolvi = await scaricaFoto(`/api/reports/${reportId1}/photo`, cookieA);
        ok('la foto non e\' piu\' raggiungibile dopo la risoluzione', fotoDopoRisolvi.status === 404, `status ${fotoDopoRisolvi.status}`);

        // reportId1 e' gia' stato cancellato per davvero da questo stesso test: non serve
        // piu' ripulirlo a mano nel finally (ma il codice li' e' comunque sicuro se lo fosse).

        // --- 13. Indice TTL su createdAt: MongoDB deve cancellare da solo una segnalazione
        //         mai risolta dopo 30 giorni - controllo strutturale (non si puo' aspettare
        //         30 giorni in una prova). ---
        const indici = await mongoose.connection.collection('reports').indexes();
        const indiceTtl = indici.find(i => i.key && i.key.createdAt === 1 && typeof i.expireAfterSeconds === 'number');
        ok('esiste un indice TTL su createdAt', !!indiceTtl, JSON.stringify(indici));
        ok('la scadenza dell\'indice TTL e\' 30 giorni', indiceTtl && indiceTtl.expireAfterSeconds === 30 * 24 * 60 * 60, indiceTtl && indiceTtl.expireAfterSeconds);

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // Cleanup mirato per id, mai una deleteMany generica. reportId1 e reportId2 sono
        // gia' stati cancellati per davvero durante la prova (punti 10 e 12): questi
        // deleteOne restano no-op sicuri se il documento non c'e' piu'.
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
