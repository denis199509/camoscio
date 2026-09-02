// PROVA: DELETE /api/hikes/:id - cancellazione di un'escursione da parte del creatore.
//
// Non esisteva nessuna rotta per cancellare una Hike: una volta creata era per sempre, e
// dopo la chiusura di gruppo spariva anche "Modifica". Aggiunta il 02/09/2026 su richiesta
// di Denis (togliere le escursioni di prova). E' distruttiva e multi-utente, quindi la prova
// controlla:
//  - le GUARDIE: solo il creatore (403), id non valido (400), inesistente (404), 401;
//  - il BLOCCO 409 se c'e' un tracciamento GPS ancora in corso (una sessione non 'ended');
//  - la CASCATA completa: Completion, tracce collegate (concluse) coi loro Like /
//    Notification(relatedSessionId) / TrailCandidate, chat, RouteBookmark,
//    Notification(relatedHikeId), TrailCandidate(hikeId), avvisi ai partecipanti,
//    completedHikes-1 e ricalcolo passo (anche a chi aveva SOLO la traccia).
//
// Tre account demo: A crea e cancella; B partecipante che completa e ha una traccia; C ha
// SOLO una traccia (nessun Completion) e mette un "mi piace".
//
// CONTROPROVA (fatta a mano quando serve): neutralizzare il path della rotta in
// routes/hikes.js (`router.delete('/:id'...` -> `'/:id_OFF'`) e rilanciare -> "cancellazione
// accettata (200)" cade e con lei tutte le asserzioni di cascata (~18). Verificato il
// 02/09/2026: 22 passati / 18 falliti col path neutralizzato.
//
// Lanciarla:  node prove/prova-elimina-escursione.js      (avvia un server suo sulla 3126)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const User = require('../models/User');
const Hike = require('../models/Hike');
const Completion = require('../models/Completion');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Like = require('../models/Like');
const RouteBookmark = require('../models/RouteBookmark');
const HikeMessage = require('../models/HikeMessage');
const Notification = require('../models/Notification');
const TrailCandidate = require('../models/TrailCandidate');

const PORTA = 3126;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();
const oid = s => new mongoose.Types.ObjectId(s);

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
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
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

function vedeEscursione(risposta, hikeId) {
    return Array.isArray(risposta.corpo) && risposta.corpo.some(h => h.id === hikeId || h._id === hikeId);
}

// Stato "pace" di un account demo, per ripristinarlo IDENTICO nel finally: la rotta DELETE
// (come gia' DELETE /api/completions/:id) chiama recalculateAndApplyPace, che a zero
// osservazioni TOGLIE il passo - e i 4 demo del seed hanno un passo assegnato a mano. La
// prova non deve lasciare l'account demo diverso da come l'ha trovato.
async function istantaneaPace(id) {
    const u = await User.findById(id).lean();
    return {
        averagePaceUp: u.averagePaceUp, averagePaceDown: u.averagePaceDown,
        experienceLevel: u.experienceLevel, completedHikes: u.completedHikes
    };
}
async function ripristinaPace(id, snap) {
    if (!snap) return;
    const set = {}, unset = {};
    for (const k of ['averagePaceUp', 'averagePaceDown', 'experienceLevel', 'completedHikes']) {
        if (snap[k] === undefined || snap[k] === null) unset[k] = 1; else set[k] = snap[k];
    }
    const upd = {};
    if (Object.keys(set).length) upd.$set = set;
    if (Object.keys(unset).length) upd.$unset = unset;
    if (Object.keys(upd).length) await User.updateOne({ _id: oid(id) }, upd);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const conta = async c => mongoose.connection.collection(c).countDocuments();
    const partenza = {
        utenti: await conta('users'), escursioni: await conta('hikes'),
        completamenti: await conta('completions'), sessioni: await conta('activehikesessions'),
        mipiace: await conta('likes'), segnalibri: await conta('routebookmarks'),
        messaggi: await conta('hikemessages'), notifiche: await conta('notifications'),
        trailcandidate: await conta('trailcandidates')
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, logServer = '';
    let hikeId = null, hike2Id = null, sessBId = null, sessCId = null;
    let idA = null, idB = null, idC = null;
    let paceA = null, paceB = null, paceC = null;

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

        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno tre account demo disponibili', Array.isArray(elenco) && elenco.length >= 3, `trovati ${elenco.length}`);
        idA = elenco[0].id; idB = elenco[1].id; idC = elenco[2].id;
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        console.log(`     (A=${elenco[0].username}, B=${elenco[1].username}, C=${elenco[2].username})`);

        paceA = await istantaneaPace(idA);
        paceB = await istantaneaPace(idB);
        paceC = await istantaneaPace(idC);

        // === 1. GUARDIE ===
        console.log('\n--- 1. Guardie ---');
        const creazione = await chiama('POST', '/api/hikes', {
            title: `PROVA-ELIM-${MARCA}`,
            difficulty: 'Principiante',
            date: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
            tribeTags: [],
            trailhead: { lat: 42.46, lng: 13.56, name: `Prova-elim-${MARCA}` }
        }, cookieA);
        ok('A crea l\'escursione (200)', creazione.status === 200, JSON.stringify(creazione.corpo));
        hikeId = creazione.corpo && (creazione.corpo.id || creazione.corpo._id);
        ok('escursione creata con un id', !!hikeId);

        const idInvalido = await chiama('DELETE', '/api/hikes/non-un-objectid', null, cookieA);
        ok('id non valido -> 400', idInvalido.status === 400, `status ${idInvalido.status}`);

        const idAssente = await chiama('DELETE', `/api/hikes/${new mongoose.Types.ObjectId()}`, null, cookieA);
        ok('id ben formato ma inesistente -> 404', idAssente.status === 404, `status ${idAssente.status}`);

        const comeB = await chiama('DELETE', `/api/hikes/${hikeId}`, null, cookieB);
        ok('un non-creatore NON puo\' cancellare -> 403', comeB.status === 403, `status ${comeB.status}`);
        ok('dopo il 403 l\'escursione esiste ancora', vedeEscursione(await chiama('GET', '/api/hikes', null, cookieA), hikeId));

        const comeAnonimo = await chiama('DELETE', `/api/hikes/${hikeId}`, null, null);
        ok('senza login -> 401', comeAnonimo.status === 401, `status ${comeAnonimo.status}`);

        // === 2. BLOCCO 409: tracciamento GPS in corso ===
        console.log('\n--- 2. Blocco con tracciamento in corso ---');
        const cre2 = await chiama('POST', '/api/hikes', {
            title: `PROVA-ELIM-${MARCA}-b`, difficulty: 'Principiante',
            date: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
            tribeTags: [], trailhead: { lat: 42.47, lng: 13.57, name: `Prova-elim-${MARCA}-b` }
        }, cookieA);
        hike2Id = cre2.corpo && (cre2.corpo.id || cre2.corpo._id);
        const sessAperta = await ActiveHikeSession.create({
            userId: oid(idB), hikeId: oid(hike2Id), status: 'active', openSession: true,
            startedAt: new Date(), points: []
        });
        const bloccato = await chiama('DELETE', `/api/hikes/${hike2Id}`, null, cookieA);
        ok('con una sessione APERTA -> 409', bloccato.status === 409, `status ${bloccato.status}`);
        ok('codice HIKE_TRACKING_IN_CORSO', bloccato.corpo && bloccato.corpo.code === 'HIKE_TRACKING_IN_CORSO', JSON.stringify(bloccato.corpo));
        ok('dopo il 409 l\'escursione esiste ancora', (await Hike.findById(hike2Id)) !== null);
        ok('dopo il 409 la sessione aperta esiste ancora', (await ActiveHikeSession.findById(sessAperta._id)) !== null);
        // Terminata la registrazione, la cancellazione passa.
        await ActiveHikeSession.updateOne({ _id: sessAperta._id }, { $set: { status: 'ended', endedAt: new Date() }, $unset: { openSession: 1 } });
        const oraSi = await chiama('DELETE', `/api/hikes/${hike2Id}`, null, cookieA);
        ok('a registrazione conclusa -> 200', oraSi.status === 200, JSON.stringify(oraSi.corpo));
        ok('la sessione (ora conclusa) e\' stata cancellata con la hike', (await ActiveHikeSession.findById(sessAperta._id)) === null);
        hike2Id = null; // gia' cancellata, niente cleanup

        // === 3. CASCATA ===
        console.log('\n--- 3. Cascata ---');
        await chiama('PUT', `/api/hikes/${hikeId}`, { participants: [idA, idB] }, cookieA);
        const completa = await chiama('POST', `/api/hikes/${hikeId}/complete-group`, { confirmedUserIds: [idA, idB] }, cookieA);
        ok('chiusura di gruppo accettata (A + B)', completa.status === 200, JSON.stringify(completa.corpo));
        ok('due Completion creati dalla chiusura di gruppo', await Completion.countDocuments({ hikeId: oid(hikeId) }) === 2);
        const bDopoCompletamento = (await User.findById(idB).lean()).completedHikes || 0;

        // Fixture agganciate all'escursione, inserite direttamente (la prova e' sulla CASCATA
        // del DELETE, non su come nascono questi documenti).
        //  - sessB: traccia di B, che ha ANCHE il Completion;
        //  - sessC: traccia di C, che NON ha un Completion -> esercita il ramo "utente con
        //           solo la traccia" nel ricalcolo passo (union di comps + sessioni).
        const sessB = await ActiveHikeSession.create({
            userId: oid(idB), hikeId: oid(hikeId), status: 'ended',
            startedAt: new Date(Date.now() - 7200000), endedAt: new Date(Date.now() - 3600000),
            distanceKm: 6.2, elevationGainM: 400, movingTimeSec: 5400,
            points: [[13.56, 42.46, 1000, 0, 5], [13.57, 42.47, 1200, 3600, 5]]
        });
        const sessC = await ActiveHikeSession.create({
            userId: oid(idC), hikeId: oid(hikeId), status: 'ended',
            startedAt: new Date(Date.now() - 7200000), endedAt: new Date(Date.now() - 4000000),
            distanceKm: 3.0, elevationGainM: 150, movingTimeSec: 2700,
            points: [[13.56, 42.46, 1000, 0, 5], [13.565, 42.465, 1100, 2700, 5]]
        });
        sessBId = String(sessB._id); sessCId = String(sessC._id);
        await Like.create({ userId: oid(idA), sessionId: sessB._id });
        await RouteBookmark.create({ userId: oid(idC), hikeId: oid(hikeId) });
        await HikeMessage.create({ hikeId: oid(hikeId), senderId: oid(idA), text: `PROVA-ELIM-${MARCA} msg` });
        await Notification.create({ userId: oid(idB), text: `PROVA-ELIM-${MARCA} hike`, relatedHikeId: oid(hikeId) });
        await Notification.create({ userId: oid(idC), text: `PROVA-ELIM-${MARCA} sess`, relatedSessionId: sessB._id });
        // TrailCandidate: uno legato via sessionId (ramo {sessionId:{$in}}), uno via hikeId
        // (ramo {hikeId}) - quello che raccoglie i candidati lasciati indietro da tracking.js.
        await TrailCandidate.create({ userId: oid(idB), sessionId: sessB._id, hikeId: oid(hikeId), points: [[13.56, 42.46, 1000, 0, 5]] });
        await TrailCandidate.create({ userId: oid(idC), sessionId: sessC._id, points: [[13.56, 42.46, 1000, 0, 5]] });

        ok('fixture: 2 tracce collegate', await ActiveHikeSession.countDocuments({ hikeId: oid(hikeId) }) === 2);
        ok('fixture: 1 "mi piace" sulla traccia', await Like.countDocuments({ sessionId: sessB._id }) === 1);
        ok('fixture: 1 segnalibro', await RouteBookmark.countDocuments({ hikeId: oid(hikeId) }) === 1);
        ok('fixture: 1 messaggio in chat', await HikeMessage.countDocuments({ hikeId: oid(hikeId) }) === 1);
        // Solo le MIE due fixture (per marca): il creatore Marco ha squadre, quindi
        // POST /api/hikes ha gia' generato altre notifiche con relatedHikeId - che e' bene
        // (le porta via la cascata), ma un conteggio totale qui sarebbe fragile.
        ok('fixture: 2 notifiche agganciate', await Notification.countDocuments({ text: { $in: [`PROVA-ELIM-${MARCA} hike`, `PROVA-ELIM-${MARCA} sess`] } }) === 2);
        ok('fixture: 2 trail-candidate', await TrailCandidate.countDocuments({ $or: [{ hikeId: oid(hikeId) }, { sessionId: { $in: [sessB._id, sessC._id] } }] }) === 2);

        const RX_AVVISO = /ha cancellato l'escursione/;
        const nAvvisiPrima = await Notification.countDocuments({ userId: oid(idB), text: RX_AVVISO });

        const cancella = await chiama('DELETE', `/api/hikes/${hikeId}`, null, cookieA);
        ok('cancellazione accettata (200)', cancella.status === 200, JSON.stringify(cancella.corpo));
        const rim = (cancella.corpo && cancella.corpo.rimosse) || {};
        ok('risposta: completamenti = 2', rim.completamenti === 2, JSON.stringify(rim));
        ok('risposta: tracce = 2', rim.tracce === 2, JSON.stringify(rim));
        ok('risposta: iscritti riportati', rim.iscritti >= 2, JSON.stringify(rim));
        ok('risposta: niente conteggi privati (segnalibri/mipiace)', rim.segnalibri === undefined && rim.mipiace === undefined, JSON.stringify(rim));

        ok('la Hike non esiste piu\'', (await Hike.findById(hikeId)) === null);
        ok('GET /api/hikes non la mostra piu\' ad A', !vedeEscursione(await chiama('GET', '/api/hikes', null, cookieA), hikeId));
        ok('Completion azzerati per questa hike', await Completion.countDocuments({ hikeId: oid(hikeId) }) === 0);
        ok('ActiveHikeSession collegate cancellate', await ActiveHikeSession.countDocuments({ hikeId: oid(hikeId) }) === 0);
        ok('le due tracce specifiche non esistono piu\'', (await ActiveHikeSession.findById(sessBId)) === null && (await ActiveHikeSession.findById(sessCId)) === null);
        ok('"mi piace" della traccia cancellati', await Like.countDocuments({ sessionId: oid(sessBId) }) === 0);
        ok('segnalibri della hike cancellati', await RouteBookmark.countDocuments({ hikeId: oid(hikeId) }) === 0);
        ok('messaggi chat della hike cancellati', await HikeMessage.countDocuments({ hikeId: oid(hikeId) }) === 0);
        ok('notifiche relatedHikeId cancellate', await Notification.countDocuments({ relatedHikeId: oid(hikeId) }) === 0);
        ok('notifiche relatedSessionId cancellate', await Notification.countDocuments({ relatedSessionId: oid(sessBId) }) === 0);
        ok('trail-candidate (via hikeId e via sessionId) cancellati',
            await TrailCandidate.countDocuments({ $or: [{ hikeId: oid(hikeId) }, { sessionId: { $in: [oid(sessBId), oid(sessCId)] } }] }) === 0);

        const bDopoDelete = (await User.findById(idB).lean()).completedHikes || 0;
        ok('completedHikes di B tornato indietro di 1', bDopoDelete === bDopoCompletamento - 1, `${bDopoCompletamento} -> ${bDopoDelete}`);
        ok('avviso di cancellazione ricevuto da B', await Notification.countDocuments({ userId: oid(idB), text: RX_AVVISO }) === nAvvisiPrima + 1);
        ok('avviso di cancellazione ricevuto da C (aveva solo la traccia)', await Notification.countDocuments({ userId: oid(idC), text: RX_AVVISO }) >= 1);

        // === 4. Idempotenza ===
        console.log('\n--- 4. Idempotenza ---');
        const dinuovo = await chiama('DELETE', `/api/hikes/${hikeId}`, null, cookieA);
        ok('ricancellare la stessa hike -> 404', dinuovo.status === 404, `status ${dinuovo.status}`);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // Cleanup mirato per id / marca, mai deleteMany generiche.
        for (const hid of [hikeId, hike2Id].filter(Boolean)) {
            const h = oid(hid);
            await Completion.deleteMany({ hikeId: h }).catch(() => {});
            await RouteBookmark.deleteMany({ hikeId: h }).catch(() => {});
            await HikeMessage.deleteMany({ hikeId: h }).catch(() => {});
            await TrailCandidate.deleteMany({ hikeId: h }).catch(() => {});
            await ActiveHikeSession.deleteMany({ hikeId: h }).catch(() => {});
            await Hike.deleteOne({ _id: h }).catch(() => {});
        }
        for (const sid of [sessBId, sessCId].filter(Boolean)) {
            await Like.deleteMany({ sessionId: oid(sid) }).catch(() => {});
            await TrailCandidate.deleteMany({ sessionId: oid(sid) }).catch(() => {});
            await ActiveHikeSession.deleteOne({ _id: oid(sid) }).catch(() => {});
        }
        // Notifiche di prova: marca univoca E userId dell'account di prova (CLAUDE.md: le
        // pulizie di prova si filtrano sempre per userId, non solo sulla marca).
        const idsProva = [idA, idB, idC].filter(Boolean).map(oid);
        await Notification.deleteMany({ userId: { $in: idsProva }, text: { $regex: `PROVA-ELIM-${MARCA}` } }).catch(() => {});
        await Notification.deleteMany({ userId: { $in: idsProva }, text: /ha cancellato l'escursione "PROVA-ELIM-/ }).catch(() => {});

        // Passo/contatori dei tre account demo, ripristinati IDENTICI a com'erano. Prima del riconteggio.
        await ripristinaPace(idA, paceA).catch(() => {});
        await ripristinaPace(idB, paceB).catch(() => {});
        await ripristinaPace(idC, paceC).catch(() => {});

        const fine = {
            utenti: await conta('users'), escursioni: await conta('hikes'),
            completamenti: await conta('completions'), sessioni: await conta('activehikesessions'),
            mipiace: await conta('likes'), segnalibri: await conta('routebookmarks'),
            messaggi: await conta('hikemessages'), notifiche: await conta('notifications'),
            trailcandidate: await conta('trailcandidates')
        };
        console.log('\nConteggi finali:', fine);
        for (const k of Object.keys(partenza)) {
            ok(`nessun residuo di prova in "${k}"`, fine[k] === partenza[k], `${partenza[k]} -> ${fine[k]}`);
        }

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
