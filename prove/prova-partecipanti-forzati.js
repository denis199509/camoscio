// PROVA: due vulnerabilita' PREESISTENTI trovate dall'agente security-privacy rivedendo la
// cancellazione escursione (02/09/2026), poi chiuse:
//
//  (1) PUT /api/hikes/:id - il CREATORE non aveva nessun filtro su chi aggiungere a
//      participants/pendingApproval. Un PUT {participants:[<id sconosciuto>]} bastava per
//      infilare quella persona nel gruppo mesh/SOS di un'escursione non conclusa e riceverne
//      le coordinate GPS reali (server.js). Ora il creatore puo' aggiungere SOLO chi ha
//      chiesto (pendingApproval) o chi e' gia' dentro. Dalla 27a sessione ("invito squadra
//      direzionale") nemmeno un compagno di squadra si aggiunge a mano: si INVITA, ed entra
//      solo se accetta (POST /:id/invite-squad -> pendingInvites -> invite-response).
//
//  (2) POST /api/hikes/:id/complete-group - nessun rate limiter, nessun tetto alla lista, e
//      chi viene "segnato presente" senza essere iscritto non lo sapeva. Ora: scritturaLimiter,
//      tetto 200, e un avviso a chi viene aggiunto ex novo.
//
// Lanciarla:  node prove/prova-partecipanti-forzati.js     (avvia un server suo sulla 3127)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const User = require('../models/User');
const Hike = require('../models/Hike');
const Squad = require('../models/Squad');
const Completion = require('../models/Completion');
const Notification = require('../models/Notification');

const PORTA = 3127;
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

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const conta = c => mongoose.connection.collection(c).countDocuments();
    const partenza = {
        hikes: await conta('hikes'), squads: await conta('squads'),
        completions: await conta('completions'), notifications: await conta('notifications')
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, log = '';
    const hikeIds = [];
    let squadId = null;
    let idA, idB, idC, paceA, paceB, paceC;

    try {
        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        const demo = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        // C DEVE essere un account che NON condivide nessuna squadra con A, altrimenti la
        // correzione lo lascia passare a ragione (aggiungere un compagno di squadra e'
        // consentito). demo[2] (Sofia) NON va bene: sta nella squadra reale "I Camosci della
        // Val Brembana" insieme a demo[0] (Marco) e demo[1] (Luca). demo[3] (Giulia) non e'
        // in nessuna squadra: e' l'unico "estraneo" vero fra i quattro demo.
        idA = demo[0].id; idB = demo[1].id; idC = demo[3].id;
        const ckA = await loginDemo(idA), ckB = await loginDemo(idB), ckC = await loginDemo(idC);
        console.log(`     (A=${demo[0].username}, B=${demo[1].username}, C=${demo[3].username})`);
        paceA = await istantaneaPace(idA); paceB = await istantaneaPace(idB); paceC = await istantaneaPace(idC);

        const dataFutura = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        const creaHike = async (suffix) => {
            const r = await chiama('POST', '/api/hikes', {
                title: `PROVA-VULN-${MARCA}-${suffix}`, difficulty: 'Principiante', date: dataFutura,
                tribeTags: [], trailhead: { lat: 42.4, lng: 13.5, name: `v${MARCA}${suffix}` }
            }, ckA);
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) hikeIds.push(id);
            return id;
        };

        // === 1. PUT participants: il creatore NON puo' aggiungere uno sconosciuto ===
        console.log('\n--- 1. PUT participants, aggiunta arbitraria del creatore ---');
        const h1 = await creaHike('put');
        const forza = await chiama('PUT', `/api/hikes/${h1}`, { participants: [idA, idC] }, ckA);
        ok('aggiungere C (mai iscritto, non in squadra) -> 403', forza.status === 403, `status ${forza.status} ${JSON.stringify(forza.corpo)}`);
        ok('codice HIKE_AGGIUNTA_NON_CONSENTITA', forza.corpo && forza.corpo.code === 'HIKE_AGGIUNTA_NON_CONSENTITA', JSON.stringify(forza.corpo));
        const h1dopo = await Hike.findById(h1).lean();
        ok('C NON e\' finito fra i partecipanti', !(h1dopo.participants || []).map(String).includes(String(idC)));

        // ...ma se C CHIEDE di partecipare, il creatore lo puo' accettare
        const chiede = await chiama('PUT', `/api/hikes/${h1}`, { pendingApproval: [idC] }, ckC);
        ok('C puo\' chiedere di partecipare (pendingApproval, self)', chiede.status === 200, JSON.stringify(chiede.corpo));
        const accetta = await chiama('PUT', `/api/hikes/${h1}`, { participants: [idA, idC], pendingApproval: [] }, ckA);
        ok('il creatore accetta chi ha chiesto -> 200', accetta.status === 200, JSON.stringify(accetta.corpo));
        ok('ora C e\' partecipante', (accetta.corpo.participants || []).map(String).includes(String(idC)));

        // ...e NEMMENO ora che A e C condividono una squadra: dalla 27ª ("decide l'invitato")
        // un compagno di squadra si INVITA, non si aggiunge a mano. Stessa aggiunta, stesso 403.
        // Dalla 27ª POST /api/squads crea la squadra col solo creatore e invita gli altri:
        // C accetta, cosi' e' un membro vero e invite-squad (hike) lo trova.
        const sq = await chiama('POST', '/api/squads', { name: `PROVA-VULN-${MARCA}`, inviteUserIds: [idC] }, ckA);
        squadId = sq.corpo && (sq.corpo.id || sq.corpo._id);
        ok('squadra di prova creata', !!squadId, JSON.stringify(sq.corpo));
        const accC = await chiama('POST', `/api/squads/${squadId}/invite-response`, { accept: true }, ckC);
        ok('C accetta l\'invito alla squadra -> 200 ed e\' membro', accC.status === 200 && (accC.corpo.members || []).map(String).includes(String(idC)), JSON.stringify(accC.corpo));
        const h2 = await creaHike('squad');
        const invita = await chiama('PUT', `/api/hikes/${h2}`, { participants: [idA, idC] }, ckA);
        ok('il creatore NON puo\' aggiungere a mano un compagno di squadra -> 403', invita.status === 403, `status ${invita.status} ${JSON.stringify(invita.corpo)}`);
        ok('codice HIKE_AGGIUNTA_NON_CONSENTITA anche per il compagno di squadra', invita.corpo && invita.corpo.code === 'HIKE_AGGIUNTA_NON_CONSENTITA', JSON.stringify(invita.corpo));
        ok('C NON e\' fra i partecipanti', !((await Hike.findById(h2).lean()).participants || []).map(String).includes(String(idC)));
        // ...ma via l'INVITO direzionale C entra - SE accetta. Stessa aggiunta impossibile a
        // mano, strada nuova possibile: e' la prova che a decidere ora e' l'invitato.
        const inv = await chiama('POST', `/api/hikes/${h2}/invite-squad`, { squadId }, ckA);
        ok('A invita la squadra -> 200', inv.status === 200, JSON.stringify(inv.corpo));
        const h2conInvito = await Hike.findById(h2).lean();
        ok('C e\' in pendingInvites, non fra i partecipanti', (h2conInvito.pendingInvites || []).map(String).includes(String(idC)) && !(h2conInvito.participants || []).map(String).includes(String(idC)));
        const rispC = await chiama('POST', `/api/hikes/${h2}/invite-response`, { accept: true }, ckC);
        ok('C accetta l\'invito -> 200', rispC.status === 200, JSON.stringify(rispC.corpo));
        const h2fine = await Hike.findById(h2).lean();
        ok('ora C e\' partecipante, e fuori da pendingInvites', (h2fine.participants || []).map(String).includes(String(idC)) && !(h2fine.pendingInvites || []).map(String).includes(String(idC)));

        // === 2. complete-group: tetto alla lista ===
        console.log('\n--- 2. complete-group, tetto alla lista ---');
        const h3 = await creaHike('cap');
        const lista201 = Array.from({ length: 201 }, () => String(new mongoose.Types.ObjectId()));
        const troppi = await chiama('POST', `/api/hikes/${h3}/complete-group`, { confirmedUserIds: lista201 }, ckA);
        ok('201 confermati -> 400', troppi.status === 400, `status ${troppi.status}`);
        ok('messaggio "troppe persone"', troppi.corpo && /[Tt]roppe persone/.test(troppi.corpo.error || ''), JSON.stringify(troppi.corpo));
        ok('la hike NON e\' stata chiusa', !(await Hike.findById(h3).lean()).groupCompletedAt);

        // === 3. complete-group: avviso a chi e' segnato presente senza essere iscritto ===
        console.log('\n--- 3. complete-group, avviso a chi non era iscritto ---');
        const h4 = await creaHike('avviso');
        await chiama('PUT', `/api/hikes/${h4}`, { participants: [idA, idB] }, ckB); // B si iscrive da solo (h4 senza approvazione manuale); C no
        const nCprima = await Notification.countDocuments({ userId: oid(idC), text: /segnato come presente/ });
        const nBprima = await Notification.countDocuments({ userId: oid(idB), text: /segnato come presente/ });
        const chiudi = await chiama('POST', `/api/hikes/${h4}/complete-group`, { confirmedUserIds: [idA, idB, idC] }, ckA);
        ok('completamento di gruppo con C aggiunto ex novo -> 200', chiudi.status === 200, JSON.stringify(chiudi.corpo));
        ok('C (non era iscritto) riceve l\'avviso "segnato presente"',
            await Notification.countDocuments({ userId: oid(idC), text: /segnato come presente/ }) === nCprima + 1);
        ok('B (era gia\' iscritto) NON riceve l\'avviso',
            await Notification.countDocuments({ userId: oid(idB), text: /segnato come presente/ }) === nBprima);
        ok('A (creatore) NON riceve l\'avviso',
            await Notification.countDocuments({ userId: oid(idA), text: /segnato come presente/ }) === 0);

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
        if (squadId) await Squad.deleteOne({ _id: oid(squadId) }).catch(() => {});
        const idsProva = [idA, idB, idC].filter(Boolean).map(oid);
        await Notification.deleteMany({ userId: { $in: idsProva }, text: /segnato come presente all'escursione "PROVA-VULN-/ }).catch(() => {});
        await Notification.deleteMany({ userId: { $in: idsProva }, text: new RegExp('squadra "PROVA-VULN-' + MARCA) }).catch(() => {});
        await ripristinaPace(idA, paceA); await ripristinaPace(idB, paceB); await ripristinaPace(idC, paceC);

        const fine = { hikes: await conta('hikes'), squads: await conta('squads'), completions: await conta('completions'), notifications: await conta('notifications') };
        console.log('\nConteggi finali:', fine);
        for (const k of Object.keys(partenza)) ok(`nessun residuo di prova in "${k}"`, fine[k] === partenza[k], `${partenza[k]} -> ${fine[k]}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
