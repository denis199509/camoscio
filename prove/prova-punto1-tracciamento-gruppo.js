// PROVA: Punto 1 (35a sessione) - a fine tracciamento collegato a un'escursione, il CREATORE
// chiude il gruppo dalla checklist "chi era con te" (POST /api/hikes/:id/complete-group), e la
// registrazione dal vivo diventa la traccia CONDIVISA dell'escursione.
//
// Copre il ramo nuovo di complete-group: il body accetta un `trackingSessionId` opzionale
// (mutuamente esclusivo con `gpxText`); se c'e', distanza / dislivello / quota max / linea /
// tempi vengono letti da quella ActiveHikeSession invece che da un file caricato a mano. Se
// NON arriva ne' l'uno ne' l'altro, la rotta ripiega sull'ultima registrazione conclusa per
// quell'escursione (D5, "chiudo dalla card la sera, la rete al rientro mancava").
//
// Decisioni di Denis verificate qui:
//  - tempo totale AL NETTO delle pause (durationSeconds, virtual della sessione);
//  - tempo di cammino UNIFORME per tutti i confermati (non solo il proprietario della traccia);
//  - linea sulla mappa: routeSource.kind:'live' + routePath con la disciplina del punto 116;
//  - ripiego lato server (D5) quando la registrazione non e' piu' "in mano".
//
// Lanciarla:  node prove/prova-punto1-tracciamento-gruppo.js   (avvia un server suo sulla 3135)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const User = require('../models/User');
const Hike = require('../models/Hike');
const Completion = require('../models/Completion');
const Notification = require('../models/Notification');
const ActiveHikeSession = require('../models/ActiveHikeSession');

const PORTA = 3135;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();
const oid = s => new mongoose.Types.ObjectId(s);

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, cond, dett = '') {
    if (cond) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dett}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let c = null; try { c = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: c, testo };
}
async function loginDemo(userId) {
    const a = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId })
    });
    return (a.headers.getSetCookie ? a.headers.getSetCookie() : [a.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}
async function istantaneaPace(id) {
    const u = await User.findById(id).lean();
    return { averagePaceUp: u.averagePaceUp, averagePaceDown: u.averagePaceDown, experienceLevel: u.experienceLevel, completedHikes: u.completedHikes };
}
async function ripristinaPace(id, s) {
    if (!id || !s) return;
    const set = {}, unset = {};
    for (const k of ['averagePaceUp', 'averagePaceDown', 'experienceLevel', 'completedHikes']) {
        if (s[k] === undefined || s[k] === null) unset[k] = 1; else set[k] = s[k];
    }
    const upd = {};
    if (Object.keys(set).length) upd.$set = set;
    if (Object.keys(unset).length) upd.$unset = unset;
    if (Object.keys(upd).length) await User.updateOne({ _id: oid(id) }, upd).catch(() => {});
}

// Punti [lng, lat, alt, secondi, precisione] - una salita a una vetta a 1450 m e ritorno.
const PUNTI_SINTETICI = [
    [13.50, 42.40, 800, 0, 5],
    [13.51, 42.41, 1050, 1800, 5],
    [13.52, 42.42, 1450, 3600, 5],   // vetta
    [13.53, 42.41, 1100, 5400, 5],
    [13.54, 42.40, 850, 7200, 5]
];

const sessioniCreate = [];
// startedAt 5h fa, endedAt 30min fa (span 4h30), 30min di pausa -> durationSeconds = 4h esatte.
const T_START = () => new Date(Date.now() - 5 * 3600 * 1000);
const T_END = () => new Date(Date.now() - 0.5 * 3600 * 1000);
const PAUSA_MS = 30 * 60 * 1000;
const DURATA_ATTESA_ORE = 4.0;

async function creaSessione(userId, hikeId, opts = {}) {
    const ended = opts.status !== 'active';
    const base = {
        userId: oid(userId),
        hikeId: hikeId ? oid(hikeId) : null,
        status: opts.status || 'ended',
        startedAt: T_START(),
        endedAt: ended ? T_END() : null,
        lastPointAt: T_END(),
        pausedMs: opts.pausedMs != null ? opts.pausedMs : PAUSA_MS,
        distanceKm: opts.distanceKm != null ? opts.distanceKm : 6.3,
        elevationGainM: opts.elevationGainM != null ? opts.elevationGainM : 420,
        points: opts.points || PUNTI_SINTETICI
    };
    if (opts.movingTimeSec != null) base.movingTimeSec = opts.movingTimeSec;
    if (opts.maxAltitudeM != null) base.maxAltitudeM = opts.maxAltitudeM;
    const s = await ActiveHikeSession.create(base);
    sessioniCreate.push(s._id);
    return s;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const conta = c => mongoose.connection.collection(c).countDocuments();
    const partenza = {
        hikes: await conta('hikes'), completions: await conta('completions'),
        notifications: await conta('notifications'), activehikesessions: await conta('activehikesessions')
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, log = '';
    const hikeIds = [];
    let idA, idB, idC, paceA, paceB, paceC;

    try {
        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        const demo = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        idA = demo[0].id; idB = demo[1].id; idC = demo[3].id;
        const ckA = await loginDemo(idA), ckB = await loginDemo(idB), ckC = await loginDemo(idC);
        console.log(`     (A=${demo[0].username} creatore, B=${demo[1].username}, C=${demo[3].username})`);
        paceA = await istantaneaPace(idA); paceB = await istantaneaPace(idB); paceC = await istantaneaPace(idC);

        const dataFutura = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        // Crea l'escursione (creatore A) e ci iscrive B e/o C (self-join, escursione senza
        // approvazione manuale) cosi' sono "in relazione" per complete-group.
        const preparaHike = async (suffix, { conB = false, conC = false } = {}) => {
            const r = await chiama('POST', '/api/hikes', {
                title: `PROVA-P1-${MARCA}-${suffix}`, difficulty: 'Principiante', date: dataFutura,
                tribeTags: [], trailhead: { lat: 42.4, lng: 13.5, name: `p1${MARCA}${suffix}` }
            }, ckA);
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) hikeIds.push(id);
            // Ogni partecipante si iscrive da solo (self-join, escursione senza approvazione
            // manuale): la PUT porta la lista finale COMPRESO se stesso, uno alla volta.
            if (conB) await chiama('PUT', `/api/hikes/${id}`, { participants: [idA, idB] }, ckB);
            if (conC) await chiama('PUT', `/api/hikes/${id}`, { participants: conB ? [idA, idB, idC] : [idA, idC] }, ckC);
            return id;
        };

        // === 1. CONTRATTO: le fonti in conflitto e le sessioni non valide ===
        console.log('\n--- 1. Contratto del trackingSessionId ---');
        const h1 = await preparaHike('contratto', { conB: true });
        const sessValida = await creaSessione(idA, h1, { movingTimeSec: 12600, maxAltitudeM: 1450 });

        const dueFonti = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], gpxText: '<gpx></gpx>', trackingSessionId: String(sessValida._id) }, ckA);
        ok('gpxText + trackingSessionId insieme -> 400', dueFonti.status === 400, `status ${dueFonti.status} ${JSON.stringify(dueFonti.corpo)}`);
        ok('...messaggio "una sola fonte"', dueFonti.corpo && /una sola fonte/i.test(dueFonti.corpo.error || ''), JSON.stringify(dueFonti.corpo));

        const idNonValido = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: 'non-un-objectid' }, ckA);
        ok('trackingSessionId non valido -> 400', idNonValido.status === 400, `status ${idNonValido.status}`);

        const sessDiC = await creaSessione(idC, h1, {});
        const sessAltrui = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sessDiC._id) }, ckA);
        ok('registrazione di un altro utente -> 404', sessAltrui.status === 404, `status ${sessAltrui.status} ${JSON.stringify(sessAltrui.corpo)}`);

        const sessAperta = await creaSessione(idA, h1, { status: 'active' });
        const nonConclusa = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sessAperta._id) }, ckA);
        ok('registrazione non ancora terminata (status active) -> 409', nonConclusa.status === 409, `status ${nonConclusa.status} ${JSON.stringify(nonConclusa.corpo)}`);

        const hAltra = await preparaHike('altra');
        const sessAltraHike = await creaSessione(idA, hAltra, {});
        const hikeSbagliata = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sessAltraHike._id) }, ckA);
        ok('registrazione collegata a un\'altra escursione -> 400', hikeSbagliata.status === 400, `status ${hikeSbagliata.status} ${JSON.stringify(hikeSbagliata.corpo)}`);

        const sessSenzaHike = await creaSessione(idA, null, {});
        const senzaHike = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sessSenzaHike._id) }, ckA);
        ok('registrazione senza hikeId (uscita libera) -> 400', senzaHike.status === 400, `status ${senzaHike.status}`);

        ok('h1 NON e\' stata chiusa da nessuno di questi tentativi', !(await Hike.findById(h1).lean()).groupCompletedAt);

        // === 2. MISURE: la sessione diventa i numeri condivisi dell'escursione ===
        console.log('\n--- 2. Le misure della registrazione entrano nella Hike ---');
        const h2 = await preparaHike('misure', { conB: true });
        const sess2 = await creaSessione(idA, h2, { movingTimeSec: 12600, maxAltitudeM: 1450, distanceKm: 6.3, elevationGainM: 420 });
        const chiudi2 = await chiama('POST', `/api/hikes/${h2}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sess2._id) }, ckA);
        ok('complete-group con trackingSessionId -> 200', chiudi2.status === 200, JSON.stringify(chiudi2.corpo && chiudi2.corpo.error));
        const h2db = await Hike.findById(h2).lean();
        ok('hike.distanceKm = quella della sessione (6.3)', h2db.distanceKm === 6.3, `${h2db.distanceKm}`);
        ok('hike.elevationGain = quello della sessione (420)', h2db.elevationGain === 420, `${h2db.elevationGain}`);
        ok('hike.maxAltitude = quella della sessione (1450)', h2db.maxAltitude === 1450, `${h2db.maxAltitude}`);
        ok('hike.groupCompletedAt impostato', !!h2db.groupCompletedAt);
        ok('hike.participants = [A, B]', (h2db.participants || []).map(String).sort().join() === [idA, idB].map(String).sort().join(), JSON.stringify(h2db.participants));
        const compA2 = await Completion.findOne({ userId: oid(idA), hikeId: oid(h2) }).lean();
        const compB2 = await Completion.findOne({ userId: oid(idB), hikeId: oid(h2) }).lean();
        ok('A (creatore) ha un Completion', !!compA2);
        ok('B (partecipante) ha un Completion', !!compB2);
        ok('actualTimeHours = durata AL NETTO delle pause (~4.0 h, non ~4.5)',
            compA2 && Math.abs(compA2.actualTimeHours - DURATA_ATTESA_ORE) < 0.05, `${compA2 && compA2.actualTimeHours}`);

        // === 3. SESSIONE DEGENERE: i numeri veri della Hike non si toccano ===
        console.log('\n--- 3. Registrazione partita per sbaglio: numeri della Hike intatti ---');
        const h3 = await preparaHike('degenere', { conB: true });
        // Numeri scritti a mano dall'organizzatore PRIMA (controprova: devono restare identici).
        await Hike.updateOne({ _id: oid(h3) }, { $set: { distanceKm: 11.1, elevationGain: 777, maxAltitude: 1999 } });
        const sessVuota = await creaSessione(idA, h3, { points: [], distanceKm: 0, elevationGainM: 0 });
        const chiudi3 = await chiama('POST', `/api/hikes/${h3}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sessVuota._id) }, ckA);
        ok('complete-group con sessione vuota -> 200 (chiude comunque il gruppo)', chiudi3.status === 200, JSON.stringify(chiudi3.corpo && chiudi3.corpo.error));
        const h3db = await Hike.findById(h3).lean();
        ok('groupCompletedAt impostato lo stesso', !!h3db.groupCompletedAt);
        ok('participants scritti lo stesso', (h3db.participants || []).map(String).includes(String(idB)));
        ok('distanceKm NON toccata (11.1)', h3db.distanceKm === 11.1, `${h3db.distanceKm}`);
        ok('elevationGain NON toccato (777)', h3db.elevationGain === 777, `${h3db.elevationGain}`);
        ok('maxAltitude NON toccata (1999)', h3db.maxAltitude === 1999, `${h3db.maxAltitude}`);
        ok('nessun routeSource "live" su una sessione degenere', !h3db.routeSource, JSON.stringify(h3db.routeSource));

        // === 4. movingTimeSec assente: nessun errore, Completion senza tempo di cammino ===
        console.log('\n--- 4. Registrazione senza tempo di cammino misurato ---');
        const h4 = await preparaHike('nomoving', { conB: true });
        const sess4 = await creaSessione(idA, h4, { maxAltitudeM: 1450 }); // niente movingTimeSec
        const chiudi4 = await chiama('POST', `/api/hikes/${h4}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sess4._id) }, ckA);
        ok('complete-group senza movingTimeSec -> 200', chiudi4.status === 200, JSON.stringify(chiudi4.corpo && chiudi4.corpo.error));
        const compA4 = await Completion.findOne({ userId: oid(idA), hikeId: oid(h4) }).lean();
        ok('Completion creato, actualTimeHours c\'e\' (~4.0)', compA4 && Math.abs(compA4.actualTimeHours - DURATA_ATTESA_ORE) < 0.05, `${compA4 && compA4.actualTimeHours}`);
        ok('Completion SENZA movingTimeHours', compA4 && (compA4.movingTimeHours === undefined || compA4.movingTimeHours === null), `${compA4 && compA4.movingTimeHours}`);

        // === 5. Tempo di cammino UNIFORME per tutti (decisione di Denis) ===
        console.log('\n--- 5. movingTimeHours identico per ogni confermato ---');
        const h5 = await preparaHike('uniforme', { conB: true });
        const sess5 = await creaSessione(idA, h5, { movingTimeSec: 12600, maxAltitudeM: 1450 }); // 3.5 h
        const chiudi5 = await chiama('POST', `/api/hikes/${h5}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sess5._id) }, ckA);
        ok('complete-group -> 200', chiudi5.status === 200, JSON.stringify(chiudi5.corpo && chiudi5.corpo.error));
        const compA5 = await Completion.findOne({ userId: oid(idA), hikeId: oid(h5) }).lean();
        const compB5 = await Completion.findOne({ userId: oid(idB), hikeId: oid(h5) }).lean();
        ok('A ha movingTimeHours ~3.5', compA5 && Math.abs(compA5.movingTimeHours - 3.5) < 0.02, `${compA5 && compA5.movingTimeHours}`);
        ok('B ha lo STESSO movingTimeHours ~3.5 (uniforme)', compB5 && Math.abs(compB5.movingTimeHours - 3.5) < 0.02, `${compB5 && compB5.movingTimeHours}`);

        // === 6. IDEMPOTENZA: chi aveva gia' un Completion non viene sovrascritto ===
        console.log('\n--- 6. Un confermato aveva gia\' un Completion ---');
        const h6 = await preparaHike('idem', { conB: true, conC: true });
        // C si e' gia' auto-completato con un tempo diverso PRIMA della chiusura di gruppo.
        await Completion.create({ userId: oid(idC), hikeId: oid(h6), dateCompleted: new Date(), actualTimeHours: 9.99 });
        const cHikesCprima = (await istantaneaPace(idC)).completedHikes;
        const sess6 = await creaSessione(idA, h6, { movingTimeSec: 12600, maxAltitudeM: 1450 });
        const chiudi6 = await chiama('POST', `/api/hikes/${h6}/complete-group`,
            { confirmedUserIds: [idA, idB, idC], trackingSessionId: String(sess6._id) }, ckA);
        ok('complete-group con C gia\' completato -> 200', chiudi6.status === 200, JSON.stringify(chiudi6.corpo && chiudi6.corpo.error));
        const cHikesCdopo = (await istantaneaPace(idC)).completedHikes;
        ok('completedHikes di C non aumenta due volte (stesso valore)', cHikesCdopo === cHikesCprima, `${cHikesCprima} -> ${cHikesCdopo}`);
        const compC6 = await Completion.findOne({ userId: oid(idC), hikeId: oid(h6) }).lean();
        ok('actualTimeHours di C NON sovrascritto (resta 9.99)', compC6 && compC6.actualTimeHours === 9.99, `${compC6 && compC6.actualTimeHours}`);
        const compTotC = await Completion.countDocuments({ userId: oid(idC), hikeId: oid(h6) });
        ok('un solo Completion per C su questa escursione', compTotC === 1, `${compTotC}`);

        // === 7. routePath (linea sulla mappa) ===
        console.log('\n--- 7. routeSource:live + routePath ---');
        const h7db = await Hike.findById(h2).lean(); // riusa h2 (sez. 2, chiusa con successo)
        ok('routeSource.kind = "live"', h7db.routeSource && h7db.routeSource.kind === 'live', JSON.stringify(h7db.routeSource));
        ok('routeSource.nome = "Traccia registrata"', h7db.routeSource && h7db.routeSource.nome === 'Traccia registrata', h7db.routeSource && h7db.routeSource.nome);
        ok('routePath valido ([[lng,lat]], 2..400)',
            Array.isArray(h7db.routePath) && h7db.routePath.length >= 2 && h7db.routePath.length <= 400 &&
            h7db.routePath.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])),
            JSON.stringify(h7db.routePath));

        // === 8. Solo il CREATORE: un partecipante non passa ===
        console.log('\n--- 8. complete-group resta creator-only ---');
        const h8 = await preparaHike('creatoronly', { conB: true });
        const sess8 = await creaSessione(idB, h8, {}); // sessione DI B, per la sua escursione
        const bProva = await chiama('POST', `/api/hikes/${h8}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: String(sess8._id) }, ckB);
        ok('B (partecipante non creatore) -> 403', bProva.status === 403, `status ${bProva.status} ${JSON.stringify(bProva.corpo)}`);
        ok('h8 NON e\' stata chiusa', !(await Hike.findById(h8).lean()).groupCompletedAt);

        // === 9. RIPIEGO D5: nessuna fonte esplicita -> ultima sessione conclusa dell'escursione ===
        console.log('\n--- 9. Ripiego lato server (D5): chiusura dalla card, senza id ---');
        const h9 = await preparaHike('d5', { conB: true });
        await creaSessione(idA, h9, { movingTimeSec: 12600, maxAltitudeM: 1450, distanceKm: 7.7, elevationGainM: 512 });
        const chiudi9 = await chiama('POST', `/api/hikes/${h9}/complete-group`,
            { confirmedUserIds: [idA, idB] }, ckA); // NIENTE trackingSessionId, NIENTE gpxText
        ok('complete-group senza fonte esplicita -> 200', chiudi9.status === 200, JSON.stringify(chiudi9.corpo && chiudi9.corpo.error));
        const h9db = await Hike.findById(h9).lean();
        ok('D5: la Hike ha preso i numeri dell\'ultima sessione (distanceKm 7.7)', h9db.distanceKm === 7.7, `${h9db.distanceKm}`);
        ok('D5: routeSource.kind = "live"', h9db.routeSource && h9db.routeSource.kind === 'live', JSON.stringify(h9db.routeSource));
        const compA9 = await Completion.findOne({ userId: oid(idA), hikeId: oid(h9) }).lean();
        ok('D5: actualTimeHours ~4.0 dal ripiego', compA9 && Math.abs(compA9.actualTimeHours - DURATA_ATTESA_ORE) < 0.05, `${compA9 && compA9.actualTimeHours}`);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        for (const id of hikeIds) {
            await Completion.deleteMany({ hikeId: oid(id) }).catch(() => {});
            await Notification.deleteMany({ relatedHikeId: oid(id) }).catch(() => {});
            await Hike.deleteOne({ _id: oid(id) }).catch(() => {});
        }
        for (const sid of sessioniCreate) await ActiveHikeSession.deleteOne({ _id: sid }).catch(() => {});
        const idsProva = [idA, idB, idC].filter(Boolean).map(oid);
        await Notification.deleteMany({ userId: { $in: idsProva }, text: /PROVA-P1-/ }).catch(() => {});
        await ripristinaPace(idA, paceA); await ripristinaPace(idB, paceB); await ripristinaPace(idC, paceC);

        const fine = {
            hikes: await conta('hikes'), completions: await conta('completions'),
            notifications: await conta('notifications'), activehikesessions: await conta('activehikesessions')
        };
        console.log('\nConteggi finali:', fine);
        for (const k of Object.keys(partenza)) ok(`nessun residuo di prova in "${k}"`, fine[k] === partenza[k], `${partenza[k]} -> ${fine[k]}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
