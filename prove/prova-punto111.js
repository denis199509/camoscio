// PROVA DEL PUNTO 111 - "risolvi" e scadenza delle segnalazioni sentiero passano da Denis.
//
// Copre i PASSI 1-6 del piano:
//  - scadenza esplicita alla creazione (Report.expiresAt = createdAt + 90gg)
//  - "risolvi" di un utente normale = RICHIESTA (POST /:id/resolve-request), NON cancella
//  - GET /api/reports non esporta i campi nuovi (resolutionRequestedBy, expiryNotifiedAt)
//  - guardia anti-doppione atomica sulla richiesta (una sola notifica)
//  - DELETE /:id/resolve ora e' gated moderatore (era requireAuth)
//  - "Tieni ancora" (DELETE /:id/resolve-request, moderatore) riporta la segnalazione pulita
//  - "Conferma la risoluzione" (DELETE /:id/resolve, moderatore) cancella per intero
//  - "Rinnova +90gg" (PATCH /:id/renew, moderatore): 90 giorni DA ADESSO, azzera il timbro
//  - controllo scadenze PIGRO su GET /api/notifications: avvisa una volta sola, il rinnovo ri-arma
//  - destinatari: chi ha receivesReportAlerts, con ripiego sui moderatori se nessuno ce l'ha
// I passi 7+ (GET /moderation, UI Moderazione, controprova sugli indici) arrivano dopo.
//
// Due account DEMO: A parte utente normale (in sez. 10 viene elevato a moderatore per un
// attimo, poi revocato), B viene elevato a moderatore E dato receivesReportAlerts
// DIRETTAMENTE sul database (nessuna interfaccia - in produzione
// scripts/set-report-moderator.js e scripts/set-report-alerts.js). Tutto revocato nel
// finally. Stesso schema di prova-punto45.js.
//
// Lanciarla:  node prove/prova-punto111.js   (avvia un server suo sulla 3111)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3111;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome}   ${dettaglio}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let corpo2 = null;
    try { corpo2 = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: corpo2, testo };
}
async function scaricaFoto(percorso, cookie) {
    const r = await fetch(BASE + percorso, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: r.status };
}
async function loginDemo(userId) {
    const a = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (a.headers.getSetCookie ? a.headers.getSetCookie() : [a.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}
function jpegFinto(bytes) {
    const buf = Buffer.alloc(bytes);
    buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF;
    for (let i = 3; i < bytes; i++) buf[i] = i % 256;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const Report = require('../models/Report');
    const reports = mongoose.connection.collection('reports');
    const notifiche = mongoose.connection.collection('notifications');

    // Quanti avvisi di scadenza/risoluzione ha ricevuto un utente per UNA data segnalazione.
    const contaAvvisi = (oid, ridStr) => notifiche.countDocuments({
        userId: oid, relatedReportId: new mongoose.Types.ObjectId(ridStr)
    });

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        report: await reports.countDocuments(),
        notifiche: await notifiche.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let idA = null, idB = null, oidA = null, oidB = null;
    const reportIdsCreati = [];   // per la pulizia

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, { PORT: String(PORTA) })
        });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* attesa */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno due account demo', Array.isArray(elenco) && elenco.length >= 2, `${elenco.length}`);
        idA = elenco[0].id; idB = elenco[1].id;
        oidA = new mongoose.Types.ObjectId(idA);
        oidB = new mongoose.Types.ObjectId(idB);
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        console.log(`     (A=${elenco[0].username} utente normale, B=${elenco[1].username} moderatore+avvisi)`);

        await User.findByIdAndUpdate(idB, { canModerateReports: true, receivesReportAlerts: true });
        const bDb = await User.findById(idB);
        ok('B e\' moderatore e riceve gli avvisi', bDb.canModerateReports === true && bDb.receivesReportAlerts === true);

        // Crea una segnalazione (via A) e la porta subito ad 'active' (via B): le sezioni
        // 8-10 partono tutte da una segnalazione attiva di cui poi forzano expiresAt.
        async function creaReportAttivo(descr) {
            const cr = await chiama('POST', '/api/reports',
                { type: 'ostacolo', lat: 42.44, lng: 13.54, description: descr }, cookieA);
            const id = cr.corpo && cr.corpo.id;
            if (id) reportIdsCreati.push(id);
            await chiama('PATCH', `/api/reports/${id}/confirm`, null, cookieB);
            return id;
        }
        const UN_GIORNO = 86400000;
        const nelPassato = (giorni) => new Date(Date.now() - giorni * UN_GIORNO);

        // === 1. Scadenza esplicita alla creazione ===
        console.log('\n1. Una segnalazione nasce con expiresAt = createdAt + 90 giorni');
        const cr = await chiama('POST', '/api/reports',
            { type: 'frana', lat: 42.44, lng: 13.54, description: `PROVA-111-${MARCA}`, photo: jpegFinto(1500) }, cookieA);
        ok('POST /api/reports accettato', cr.status === 200, JSON.stringify(cr.corpo));
        const rid = cr.corpo && cr.corpo.id;
        if (rid) reportIdsCreati.push(rid);
        const doc1 = await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) });
        const deltaGiorni = (new Date(doc1.expiresAt) - new Date(doc1.createdAt)) / 86400000;
        ok('expiresAt ~ createdAt + 90 giorni', Math.abs(deltaGiorni - 90) < 0.01, `${deltaGiorni} giorni`);
        ok('resolutionRequestedAt ASSENTE (non null)', !('resolutionRequestedAt' in doc1));
        ok('resolutionRequestedBy ASSENTE (non null)', !('resolutionRequestedBy' in doc1));
        ok('expiryNotifiedAt ASSENTE (non null)', !('expiryNotifiedAt' in doc1));

        // porto la segnalazione ad 'active' (le richieste di risoluzione valgono solo li')
        const conf = await chiama('PATCH', `/api/reports/${rid}/confirm`, null, cookieB);
        ok('B conferma la segnalazione -> active', conf.status === 200 && conf.corpo.status === 'active', JSON.stringify(conf.corpo));

        // === 2. "Risolvi" di un utente normale = richiesta, NON cancella ===
        console.log('\n2. Il "risolvi" di A non cancella: diventa una richiesta');
        const nBefore = await notifiche.countDocuments({ userId: oidB });
        const rr = await chiama('POST', `/api/reports/${rid}/resolve-request`, null, cookieA);
        ok('POST /:id/resolve-request -> 200', rr.status === 200, JSON.stringify(rr.corpo));
        const doc2 = await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) });
        ok('la segnalazione ESISTE ancora', !!doc2);
        ok('status ancora active', doc2.status === 'active');
        ok('resolutionRequestedAt valorizzato (Date)', doc2.resolutionRequestedAt instanceof Date);
        ok('resolutionRequestedBy = A', String(doc2.resolutionRequestedBy) === String(idA));
        const listaA = await chiama('GET', '/api/reports', null, cookieA);
        ok('compare ancora in GET /api/reports', Array.isArray(listaA.corpo) && listaA.corpo.some(r => r.id === rid));
        const nAfter = await notifiche.countDocuments({ userId: oidB });
        ok('la prima richiesta ha creato ESATTAMENTE 1 notifica per B', nAfter - nBefore === 1, `${nBefore} -> ${nAfter}`);

        // === 3. GET /api/reports non esporta i campi nuovi sensibili/interni ===
        console.log('\n3. GET /api/reports: fuori resolutionRequestedBy e expiryNotifiedAt, dentro resolutionRequestedAt');
        const voce = listaA.corpo.find(r => r.id === rid);
        ok('resolutionRequestedAt PRESENTE nella risposta', !!voce.resolutionRequestedAt);
        ok('resolutionRequestedBy ASSENTE dalla risposta', !('resolutionRequestedBy' in voce));
        ok('expiryNotifiedAt ASSENTE dalla risposta', !('expiryNotifiedAt' in voce));
        console.log('     (la lista /moderation per il moderatore arriva col passo 7)');

        // === 4. Guardia anti-doppione: ripremere non ri-notifica ===
        console.log('\n4. Ripremere "risolvi" (stesso utente e un altro) non crea altre notifiche');
        const rr2 = await chiama('POST', `/api/reports/${rid}/resolve-request`, null, cookieA);
        ok('A ripreme -> 200 giaRichiesta:true', rr2.status === 200 && rr2.corpo.giaRichiesta === true, JSON.stringify(rr2.corpo));
        const rr3 = await chiama('POST', `/api/reports/${rid}/resolve-request`, null, cookieB);
        ok('B (altro utente) preme -> 200 giaRichiesta:true', rr3.status === 200 && rr3.corpo.giaRichiesta === true, JSON.stringify(rr3.corpo));
        const nAfter2 = await notifiche.countDocuments({ userId: oidB });
        ok('nessuna notifica in piu\'', nAfter2 === nAfter, `${nAfter} -> ${nAfter2}`);
        const doc4 = await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) });
        ok('resolutionRequestedBy resta A (chi e\' arrivato primo)', String(doc4.resolutionRequestedBy) === String(idA));

        // === 5. Un utente normale non puo' piu' cancellare ===
        console.log('\n5. DELETE /:id/resolve da un utente normale -> 403');
        const delA = await chiama('DELETE', `/api/reports/${rid}/resolve`, null, cookieA);
        ok('DELETE /:id/resolve come A -> 403', delA.status === 403, `status ${delA.status}`);
        ok('la segnalazione c\'e\' ancora', !!(await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) })));

        // === 6. "Tieni ancora": il moderatore annulla la richiesta ===
        console.log('\n6. "Tieni ancora": DELETE /:id/resolve-request (moderatore)');
        const tieni = await chiama('DELETE', `/api/reports/${rid}/resolve-request`, null, cookieB);
        ok('DELETE /:id/resolve-request come B -> 200', tieni.status === 200, JSON.stringify(tieni.corpo));
        const doc6 = await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) });
        ok('resolutionRequestedAt di nuovo ASSENTE', !('resolutionRequestedAt' in doc6));
        ok('resolutionRequestedBy di nuovo ASSENTE', !('resolutionRequestedBy' in doc6));
        ok('status ancora active', doc6.status === 'active');
        const tieniComeA = await chiama('DELETE', `/api/reports/${rid}/resolve-request`, null, cookieA);
        ok('DELETE /:id/resolve-request come A (non moderatore) -> 403', tieniComeA.status === 403, `status ${tieniComeA.status}`);
        // A rifa la richiesta: torna a notificare
        const rrDopo = await chiama('POST', `/api/reports/${rid}/resolve-request`, null, cookieA);
        ok('A rifa la richiesta -> 200 success', rrDopo.status === 200 && rrDopo.corpo.success === true && !rrDopo.corpo.giaRichiesta, JSON.stringify(rrDopo.corpo));
        const nAfter3 = await notifiche.countDocuments({ userId: oidB });
        ok('la richiesta rifatta crea 1 notifica nuova', nAfter3 - nAfter2 === 1, `${nAfter2} -> ${nAfter3}`);

        // === 7. "Conferma la risoluzione": il moderatore cancella per intero ===
        console.log('\n7. "Conferma la risoluzione": DELETE /:id/resolve (moderatore)');
        const conferma = await chiama('DELETE', `/api/reports/${rid}/resolve`, null, cookieB);
        ok('DELETE /:id/resolve come B -> 200', conferma.status === 200, JSON.stringify(conferma.corpo));
        ok('la segnalazione e\' sparita dal database', !(await reports.findOne({ _id: new mongoose.Types.ObjectId(rid) })));
        const fotoDopo = await scaricaFoto(`/api/reports/${rid}/photo`, cookieB);
        ok('la foto non e\' piu\' raggiungibile (404)', fotoDopo.status === 404, `status ${fotoDopo.status}`);
        const confDiNuovo = await chiama('DELETE', `/api/reports/${rid}/resolve`, null, cookieB);
        ok('richiamare DELETE /:id/resolve su un id sparito -> 200 (idempotente)', confDiNuovo.status === 200, `status ${confDiNuovo.status}`);

        // === 8. "Rinnova +90gg": 90 giorni DA ADESSO, non expiresAt + 90 ===
        console.log('\n8. PATCH /:id/renew (moderatore): 90 giorni da adesso, azzera expiryNotifiedAt');
        const rid8 = await creaReportAttivo(`PROVA-111-8-${MARCA}`);
        const oid8 = new mongoose.Types.ObjectId(rid8);
        // "scaduta da 100 giorni" e gia' timbrata: expiresAt + 90 sarebbe ancora nel passato
        await reports.updateOne({ _id: oid8 }, { $set: { expiresAt: nelPassato(100), expiryNotifiedAt: nelPassato(5) } });

        const renewA = await chiama('PATCH', `/api/reports/${rid8}/renew`, null, cookieA);
        ok('PATCH /:id/renew come A (non moderatore) -> 403', renewA.status === 403, `status ${renewA.status}`);
        const doc8pre = await reports.findOne({ _id: oid8 });
        ok('A non ha spostato niente (expiresAt ancora nel passato)', new Date(doc8pre.expiresAt) < new Date());
        ok('A non ha toccato expiryNotifiedAt', doc8pre.expiryNotifiedAt instanceof Date);

        const renewB = await chiama('PATCH', `/api/reports/${rid8}/renew`, null, cookieB);
        ok('PATCH /:id/renew come B (moderatore) -> 200', renewB.status === 200, JSON.stringify(renewB.corpo));
        const doc8 = await reports.findOne({ _id: oid8 });
        const giorniDaAdesso = (new Date(doc8.expiresAt) - Date.now()) / UN_GIORNO;
        ok('expiresAt spostato a ~90 giorni DA ADESSO', Math.abs(giorniDaAdesso - 90) < 1, `${giorniDaAdesso.toFixed(2)} giorni`);
        ok('non e\' "expiresAt + 90" (che sarebbe ancora nel passato)', new Date(doc8.expiresAt) > new Date());
        ok('expiryNotifiedAt azzerato dal rinnovo', !('expiryNotifiedAt' in doc8));

        const renewMancante = await chiama('PATCH', `/api/reports/${new mongoose.Types.ObjectId()}/renew`, null, cookieB);
        ok('PATCH /:id/renew su un id inesistente -> 404', renewMancante.status === 404, `status ${renewMancante.status}`);

        // === 9. Controllo scadenze PIGRO su GET /api/notifications: avvisa una volta sola ===
        console.log('\n9. GET /api/notifications fa scattare il controllo scadenze (un avviso solo, il rinnovo ri-arma)');
        const rid9 = await creaReportAttivo(`PROVA-111-9-${MARCA}`);
        const oid9 = new mongoose.Types.ObjectId(rid9);
        await reports.updateOne({ _id: oid9 }, { $set: { expiresAt: nelPassato(1) } });

        ok('nessun avviso di scadenza per B prima del fetch', (await contaAvvisi(oidB, rid9)) === 0);
        // il fetch di A (che NON e' destinatario) fa comunque scattare il controllo globale
        const fetchA9 = await chiama('GET', `/api/notifications/${idA}`, null, cookieA);
        ok('GET /api/notifications/:idA -> 200', fetchA9.status === 200, `status ${fetchA9.status}`);
        ok('1 avviso di scadenza creato per B (destinatario)', (await contaAvvisi(oidB, rid9)) === 1);
        ok('nessun avviso per A (non e\' destinatario)', (await contaAvvisi(oidA, rid9)) === 0);
        const avviso9 = await notifiche.findOne({ userId: oidB, relatedReportId: oid9 });
        ok('il testo dell\'avviso dice "scaduta"', /scadut/i.test(avviso9 && avviso9.text || ''), avviso9 && avviso9.text);
        ok('la notifica porta a relatedReportId (click-through)', avviso9 && String(avviso9.relatedReportId) === rid9);
        const doc9 = await reports.findOne({ _id: oid9 });
        ok('expiryNotifiedAt "timbrato" sulla segnalazione', doc9.expiryNotifiedAt instanceof Date);

        // secondo giro: non deve rinotificare
        await chiama('GET', `/api/notifications/${idB}`, null, cookieB);
        await chiama('GET', `/api/notifications/${idA}`, null, cookieA);
        ok('un secondo fetch non crea un secondo avviso', (await contaAvvisi(oidB, rid9)) === 1);

        // il rinnovo ri-arma: dopo renew + nuova scadenza, riavvisa
        await chiama('PATCH', `/api/reports/${rid9}/renew`, null, cookieB);
        const doc9r = await reports.findOne({ _id: oid9 });
        ok('renew ha tolto di nuovo expiryNotifiedAt', !('expiryNotifiedAt' in doc9r));
        await reports.updateOne({ _id: oid9 }, { $set: { expiresAt: nelPassato(1) } });
        await chiama('GET', `/api/notifications/${idB}`, null, cookieB);
        ok('dopo il rinnovo la scadenza riavvisa (2 avvisi in tutto)', (await contaAvvisi(oidB, rid9)) === 2);

        // === 10. Destinatari: chi ha receivesReportAlerts, non "tutti i moderatori" ===
        console.log('\n10. L\'avviso va a receivesReportAlerts; se nessuno ce l\'ha, ripiego sui moderatori');

        // 10a. A diventa moderatore ma NON destinatario: non deve ricevere l'avviso
        await User.findByIdAndUpdate(idA, { canModerateReports: true });
        const rid10 = await creaReportAttivo(`PROVA-111-10-${MARCA}`);
        await reports.updateOne({ _id: new mongoose.Types.ObjectId(rid10) }, { $set: { expiresAt: nelPassato(1) } });
        await chiama('GET', `/api/notifications/${idB}`, null, cookieB);
        ok('B (receivesReportAlerts) riceve l\'avviso', (await contaAvvisi(oidB, rid10)) === 1);
        ok('A (moderatore ma NON receivesReportAlerts) non lo riceve', (await contaAvvisi(oidA, rid10)) === 0);

        // 10b. Nessuno ha receivesReportAlerts -> ripiego RUMOROSO su tutti i moderatori
        await User.findByIdAndUpdate(idB, { $unset: { receivesReportAlerts: 1 } });
        const restanti = await User.countDocuments({ receivesReportAlerts: true });
        ok('nessun utente con receivesReportAlerts per la prova del ripiego', restanti === 0, `${restanti} rimasti`);
        const rid10b = await creaReportAttivo(`PROVA-111-10b-${MARCA}`);
        await reports.updateOne({ _id: new mongoose.Types.ObjectId(rid10b) }, { $set: { expiresAt: nelPassato(1) } });
        await chiama('GET', `/api/notifications/${idB}`, null, cookieB);
        ok('ripiego: B (moderatore) riceve comunque l\'avviso', (await contaAvvisi(oidB, rid10b)) === 1);
        ok('ripiego: anche A (moderatore) riceve l\'avviso', (await contaAvvisi(oidA, rid10b)) === 1);

        // ripristino: il finally si aspetta B destinatario e A pulito
        await User.findByIdAndUpdate(idB, { receivesReportAlerts: true });
        await User.findByIdAndUpdate(idA, { $unset: { canModerateReports: 1 } });

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + e.message);
    } finally {
        if (server) server.kill();

        // Pulizia mirata: report per _id, notifiche per relatedReportId dei test (quegli
        // ObjectId sono nati in questo run - nessun dato vero puo' combaciare). Non filtrata
        // per userId: la sez. 10b, col ripiego, crea avvisi anche per A e per eventuali
        // altri moderatori veri.
        for (const rid of reportIdsCreati) {
            await reports.deleteOne({ _id: new mongoose.Types.ObjectId(rid) }).catch(() => {});
        }
        if (reportIdsCreati.length) {
            const del = await notifiche.deleteMany({
                relatedReportId: { $in: reportIdsCreati.map(r => new mongoose.Types.ObjectId(r)) }
            }).catch(() => ({ deletedCount: 0 }));
            console.log(`     (pulizia: ${del.deletedCount} notifiche di prova cancellate)`);
        }
        if (idB) await User.findByIdAndUpdate(idB, { $unset: { canModerateReports: 1, receivesReportAlerts: 1 } }).catch(() => {});
        if (idA) await User.findByIdAndUpdate(idA, { $unset: { canModerateReports: 1, receivesReportAlerts: 1 } }).catch(() => {});

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            report: await reports.countDocuments(),
            notifiche: await notifiche.countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna segnalazione di prova rimasta', fine.report === partenza.report, `${partenza.report} -> ${fine.report}`);
        ok('nessuna notifica di prova rimasta', fine.notifiche === partenza.notifiche, `${partenza.notifiche} -> ${fine.notifiche}`);
        if (idB) {
            const bFin = await User.findById(idB);
            ok('B non e\' piu\' moderatore ne\' riceve avvisi', bFin.canModerateReports === undefined && bFin.receivesReportAlerts === undefined);
        }
        if (idA) {
            const aFin = await User.findById(idA);
            ok('A e\' tornato un utente normale', aFin.canModerateReports === undefined && aFin.receivesReportAlerts === undefined);
        }

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
