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
const bcrypt = require('bcryptjs');
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
    if (opts.importedFrom) base.importedFrom = opts.importedFrom;
    if (opts.importedName) base.importedName = opts.importedName;
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
    let idReale = null; // account VERO temporaneo per la sez. 11b (i demo bypassano il consenso geo)

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

        // Item 10 della revisione 35a: trackingSessionId dev'essere una STRINGA (ObjectId.isValid
        // accetta anche i numeri, incoerente col check di squadId).
        const idNumerico = await chiama('POST', `/api/hikes/${h1}/complete-group`,
            { confirmedUserIds: [idA, idB], trackingSessionId: 123456789012 }, ckA);
        ok('trackingSessionId numerico (non stringa) -> 400', idNumerico.status === 400, `status ${idNumerico.status}`);

        // Item 10: gpxText nel body ma vuoto -> 400, NON scivola in silenzio sul ripiego D5
        // (che qui troverebbe sessValida e chiuderebbe h1).
        for (const vuoto of ['', '   ']) {
            const r = await chiama('POST', `/api/hikes/${h1}/complete-group`,
                { confirmedUserIds: [idA, idB], gpxText: vuoto }, ckA);
            ok(`gpxText vuoto ${JSON.stringify(vuoto)} -> 400`, r.status === 400, `status ${r.status} ${JSON.stringify(r.corpo)}`);
        }

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
        // MEDIO-1 (revisione 35a): routePath (la traccia GPS reale del creatore) e
        // groupCompletedAt sono scritti nello STESSO save(). Finche' groupCompletedAt non c'e',
        // GET /api/hikes darebbe l'escursione, routePath compreso, a QUALUNQUE utente loggato -
        // e se il ciclo per-confermato solleva, groupCompletedAt non si scrive mai. La hike che
        // ha la traccia deve sempre essere anche gia' conclusa (= solo-partecipanti).
        ok('MEDIO-1: la hike con routePath e\' anche conclusa (mai "traccia senza chiusura")',
            !!h7db.routePath && !!h7db.groupCompletedAt);

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

        // === 10. Rilievi di correttezza della revisione 35a ===
        console.log('\n--- 10. Correttezza 35a: coda binaria, sessione senza quota, etichetta gpx ---');

        // Item 1: distanceKm con coda binaria (somma di $inc di float) -> arrotondato a 3 decimali.
        const hCoda = await preparaHike('coda', { conB: true });
        await creaSessione(idA, hCoda, { distanceKm: 11.275999999999991, maxAltitudeM: 1500 });
        const rCoda = await chiama('POST', `/api/hikes/${hCoda}/complete-group`, { confirmedUserIds: [idA, idB] }, ckA);
        ok('coda binaria: complete-group -> 200', rCoda.status === 200, JSON.stringify(rCoda.corpo && rCoda.corpo.error));
        const hCodaDb = await Hike.findById(hCoda).lean();
        ok(`distanceKm arrotondato a 3 decimali (${hCodaDb.distanceKm})`, hCodaDb.distanceKm === 11.276, String(hCodaDb.distanceKm));

        // Item 4: registrazione SENZA dato di elevazione (tutti i punti a quota 0) NON deve
        // sovrascrivere i valori di quota messi a mano dall'organizzatore - ma distanza e linea si'.
        const hZero = await preparaHike('zeroquota', { conB: true });
        await Hike.findByIdAndUpdate(hZero, { maxAltitude: 1234, elevationGain: 678 });
        const puntiPiani = [
            [13.50, 42.40, 0, 0, 5], [13.51, 42.41, 0, 1800, 5],
            [13.52, 42.42, 0, 3600, 5], [13.53, 42.41, 0, 5400, 5]
        ];
        await creaSessione(idA, hZero, { points: puntiPiani, elevationGainM: 0, distanceKm: 5.5 });
        const rZero = await chiama('POST', `/api/hikes/${hZero}/complete-group`, { confirmedUserIds: [idA, idB] }, ckA);
        ok('sessione senza quota: complete-group -> 200', rZero.status === 200, JSON.stringify(rZero.corpo && rZero.corpo.error));
        const hZeroDb = await Hike.findById(hZero).lean();
        ok('quota max a mano NON sovrascritta (1234)', hZeroDb.maxAltitude === 1234, String(hZeroDb.maxAltitude));
        ok('dislivello a mano NON sovrascritto (678)', hZeroDb.elevationGain === 678, String(hZeroDb.elevationGain));
        ok('la distanza della registrazione E\' entrata comunque (5.5)', hZeroDb.distanceKm === 5.5, String(hZeroDb.distanceKm));
        ok('la linea sulla mappa c\'e\' comunque', Array.isArray(hZeroDb.routePath) && hZeroDb.routePath.length >= 2, JSON.stringify(hZeroDb.routePath));

        // Item 5: il ripiego D5 trova una sessione nata da un FILE (importedFrom:'gpx') -> la
        // etichetta 'gpx' e ne tiene il nome, non 'live' / 'Traccia registrata'.
        const hFile = await preparaHike('filed5', { conB: true });
        await creaSessione(idA, hFile, { importedFrom: 'gpx', importedName: 'Corno Grande da Campo Imperatore', maxAltitudeM: 2912 });
        const rFile = await chiama('POST', `/api/hikes/${hFile}/complete-group`, { confirmedUserIds: [idA, idB] }, ckA);
        ok('D5 su sessione da file: complete-group -> 200', rFile.status === 200, JSON.stringify(rFile.corpo && rFile.corpo.error));
        const hFileDb = await Hike.findById(hFile).lean();
        ok('routeSource.kind = "gpx" (non "live")', hFileDb.routeSource && hFileDb.routeSource.kind === 'gpx', JSON.stringify(hFileDb.routeSource));
        ok('routeSource.nome tiene il nome del file', hFileDb.routeSource && hFileDb.routeSource.nome === 'Corno Grande da Campo Imperatore', JSON.stringify(hFileDb.routeSource));

        // === 11. D5 (decisione di Denis 08/09/2026): via di ritiro + rispetto della revoca geo ===
        console.log('\n--- 11. D5: ritiro della traccia e consenso geo ---');

        // 11a. Il creatore ritira la traccia auto-pubblicata (routePath:null nella PUT), anche
        //      a escursione conclusa. E' l'unica eccezione al lock del punto 76.
        const hRit = await preparaHike('ritiro', { conB: true });
        await creaSessione(idA, hRit, { maxAltitudeM: 1450 });
        await chiama('POST', `/api/hikes/${hRit}/complete-group`, { confirmedUserIds: [idA, idB] }, ckA);
        let hRitDb = await Hike.findById(hRit).lean();
        ok('11a: dopo il D5 la hike ha routePath e routeSource:live',
            Array.isArray(hRitDb.routePath) && hRitDb.routeSource && hRitDb.routeSource.kind === 'live');
        const putAltrui = await chiama('PUT', `/api/hikes/${hRit}`, { routePath: null }, ckB);
        ok('11a: un NON creatore non puo\' ritirare la traccia -> 403', putAltrui.status === 403, `status ${putAltrui.status}`);
        const putRoutesource = await chiama('PUT', `/api/hikes/${hRit}`, { routeSource: null }, ckA);
        ok('11a: routeSource nel body su una conclusa resta bloccato -> 409', putRoutesource.status === 409, `status ${putRoutesource.status}`);
        const putRitiro = await chiama('PUT', `/api/hikes/${hRit}`, { routePath: null }, ckA);
        ok('11a: il creatore ritira con { routePath: null } -> 200', putRitiro.status === 200, `status ${putRitiro.status} ${JSON.stringify(putRitiro.corpo && putRitiro.corpo.error)}`);
        hRitDb = await Hike.findById(hRit).lean();
        ok('11a: routePath e\' sparito', hRitDb.routePath === undefined, JSON.stringify(hRitDb.routePath));
        ok('11a: routeSource e\' sparito (non descrive piu\' niente senza la linea)', hRitDb.routeSource == null, JSON.stringify(hRitDb.routeSource));

        // 11b. Consenso geo revocato -> il ripiego AUTOMATICO D5 non pesca la sessione; un
        //      trackingSessionId ESPLICITO invece si'. Serve un account VERO (i demo hanno un
        //      bypass del consenso), creato dritto sul DB e cancellato nel finally.
        const pwdReale = `pw-${MARCA}-Zx`;
        const uReale = await User.create({
            username: `PROVA-P1-${MARCA}-reale`, email: `prova-p1-${MARCA}-reale@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwdReale, 10), nome: 'Prova', cognome: 'Reale',
            termsAcceptedAt: new Date(), emailVerified: true, geolocationConsent: false
        });
        idReale = String(uReale._id);
        const rLogin = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: uReale.email, password: pwdReale })
        });
        const ckReale = (rLogin.headers.getSetCookie ? rLogin.headers.getSetCookie() : [rLogin.headers.get('set-cookie')])
            .filter(Boolean).map(c => c.split(';')[0]).join('; ');

        // creatore = uReale, si conferma solo se stesso (e' gia' "in relazione" come creatore).
        const mkHikeReale = async (suffix) => {
            const r = await chiama('POST', '/api/hikes', {
                title: `PROVA-P1-${MARCA}-${suffix}`, difficulty: 'Principiante', date: dataFutura,
                tribeTags: [], trailhead: { lat: 42.4, lng: 13.5, name: `p1r${MARCA}${suffix}` }
            }, ckReale);
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) hikeIds.push(id);
            return id;
        };

        const hNoConsenso = await mkHikeReale('noconsenso');
        await creaSessione(idReale, hNoConsenso, { maxAltitudeM: 1600, distanceKm: 9.1 });
        const rNoConsenso = await chiama('POST', `/api/hikes/${hNoConsenso}/complete-group`, { confirmedUserIds: [idReale] }, ckReale);
        ok('11b: complete-group si chiude comunque -> 200', rNoConsenso.status === 200, JSON.stringify(rNoConsenso.corpo && rNoConsenso.corpo.error));
        const hNoConsensoDb = await Hike.findById(hNoConsenso).lean();
        ok('11b: consenso geo revocato -> il ripiego D5 NON ha pubblicato la traccia', hNoConsensoDb.routePath === undefined, JSON.stringify(hNoConsensoDb.routePath));
        ok('11b: ...e i numeri della sessione non sono entrati (niente routeSource:live)', !hNoConsensoDb.routeSource || hNoConsensoDb.routeSource.kind !== 'live', JSON.stringify(hNoConsensoDb.routeSource));

        const hEsplicito = await mkHikeReale('esplicito');
        const sessEspl = await creaSessione(idReale, hEsplicito, { maxAltitudeM: 1700, distanceKm: 8.8 });
        const rEsplicito = await chiama('POST', `/api/hikes/${hEsplicito}/complete-group`,
            { confirmedUserIds: [idReale], trackingSessionId: String(sessEspl._id) }, ckReale);
        ok('11b: con trackingSessionId ESPLICITO si procede lo stesso -> 200', rEsplicito.status === 200, JSON.stringify(rEsplicito.corpo && rEsplicito.corpo.error));
        const hEspDb = await Hike.findById(hEsplicito).lean();
        ok('11b: la traccia esplicita E\' entrata (routeSource:live + routePath)',
            hEspDb.routeSource && hEspDb.routeSource.kind === 'live' && Array.isArray(hEspDb.routePath), JSON.stringify(hEspDb.routeSource));

        // ...e con il consenso RIDATO, il ripiego automatico torna a funzionare.
        await User.findByIdAndUpdate(idReale, { $set: { geolocationConsent: true } });
        const hRidato = await mkHikeReale('consensoridato');
        await creaSessione(idReale, hRidato, { maxAltitudeM: 1800, distanceKm: 7.2 });
        await chiama('POST', `/api/hikes/${hRidato}/complete-group`, { confirmedUserIds: [idReale] }, ckReale);
        const hRidatoDb = await Hike.findById(hRidato).lean();
        ok('11b: consenso ridato -> il ripiego D5 pubblica di nuovo', Array.isArray(hRidatoDb.routePath)
            && hRidatoDb.routeSource && hRidatoDb.routeSource.kind === 'live', JSON.stringify(hRidatoDb.routeSource));

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
        // Sez. 11b: l'account VERO temporaneo e i suoi documenti.
        if (idReale) {
            await Completion.deleteMany({ userId: oid(idReale) }).catch(() => {});
            await ActiveHikeSession.deleteMany({ userId: oid(idReale) }).catch(() => {});
            await Notification.deleteMany({ userId: oid(idReale) }).catch(() => {});
            await User.deleteOne({ _id: oid(idReale) }).catch(() => {});
        }

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
