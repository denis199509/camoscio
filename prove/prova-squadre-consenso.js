// PROVA — CONSENSO PER ENTRARE (E USCIRE DA) UNA SQUADRA. Tappa 4 dell'invito squadra
// direzionale: chiude la falla "chiunque puo' mettere chiunque nella propria squadra, e
// quel qualcuno non puo' uscirne" (design: camoscio-squadre-consenso.md).
//
// Copre routes/squads.js:
//   POST /api/squads                     (crea col solo creatore, invita gli altri)
//   POST /api/squads/:id/invite          (admin invita)
//   POST /api/squads/:id/invite-response (l'invitato accetta/rifiuta)
//   DELETE /api/squads/:id/invites/:userId  (admin annulla un invito)
//   DELETE /api/squads/:id/members/:userId  (lascia la squadra / rimuovi un membro)
// + la regola condivisa lib/squadAdmin.js (promozione / scioglimento).
//
// CONTROPROVA: sul commit precedente POST /api/squads mette i `members` dritti dentro,
// non esiste DELETE /:id/members, e le sezioni 1/3/4 cadono.
//
// Trappola dei 4 demo (vault 07): Marco/Luca/Sofia stanno nella squadra reale "I Camosci
// della Val Brembana". Le squadre di prova si creano a parte e si cancellano nel finally.
//
// Lanciarla:  node prove/prova-squadre-consenso.js   (avvia un server suo sulla 3128)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3128;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-SQC-' + Date.now();

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
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let c = null; try { c = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: c };
}
async function loginDemo(userId) {
    const a = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId })
    });
    return (a.headers.getSetCookie ? a.headers.getSetCookie() : [a.headers.get('set-cookie')])
        .filter(Boolean).map(x => x.split(';')[0]).join('; ');
}
const S = a => (a || []).map(String);

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const squadsCol = mongoose.connection.collection('squads');
    const msgCol = mongoose.connection.collection('squadmessages');
    const notifCol = mongoose.connection.collection('notifications');
    const usersCol = mongoose.connection.collection('users');
    const hikesCol = mongoose.connection.collection('hikes');
    const oid = s => new mongoose.Types.ObjectId(s);

    const partenza = {
        squads: await squadsCol.countDocuments(),
        squadmessages: await msgCol.countDocuments(),
        notifications: await notifCol.countDocuments(),
        users: await usersCol.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    const squadIds = [];
    const hikeIds = [];

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) })
        });
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* attesa */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        const A = elenco[0].id, G = elenco[3].id, L = elenco[1].id, So = elenco[2].id;
        const ckA = await loginDemo(A), ckG = await loginDemo(G), ckL = await loginDemo(L), ckSo = await loginDemo(So);
        console.log(`     A=${elenco[0].username} (crea)  G=${elenco[3].username}  L=${elenco[1].username}  So=${elenco[2].username}\n`);

        const creaSquad = async (nome, body, cookie = ckA) => {
            const r = await chiama('POST', '/api/squads', { name: MARCA + nome, ...body }, cookie);
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) squadIds.push(oid(id));
            return { id, r };
        };

        // === 1. Creazione: solo il creatore in members, gli altri invitati ===
        console.log('1. POST /api/squads: creatore solo, gli altri in pendingInvites');
        const { id: S1, r: r1 } = await creaSquad('-S1', { inviteUserIds: [G] });
        ok('creata -> 200', r1.status === 200 && !!S1, JSON.stringify(r1.corpo));
        ok('members = [creatore] soltanto', S(r1.corpo.members).join() === String(A), JSON.stringify(r1.corpo.members));
        ok('G e\' in pendingInvites', S(r1.corpo.pendingInvites).includes(String(G)), JSON.stringify(r1.corpo.pendingInvites));
        const nInvG = await notifCol.countDocuments({ userId: oid(G), text: new RegExp('invitato nella squadra "' + MARCA + '-S1') });
        ok('G ha ricevuto la notifica d\'invito', nInvG === 1, `trovate ${nInvG}`);

        // vecchio client: manda `members` -> ottiene comunque INVITI
        const { id: S2, r: r2 } = await creaSquad('-S2', { members: [G] });
        ok('body {members:[...]} (client vecchio) -> G in pendingInvites, NON in members', S(r2.corpo.members).join() === String(A) && S(r2.corpo.pendingInvites).includes(String(G)), JSON.stringify(r2.corpo));

        // === 2. invite: solo admin ===
        console.log('\n2. POST /:id/invite — solo un amministratore');
        await chiama('POST', `/api/squads/${S1}/invite-response`, { accept: true }, ckG); // G accetta S1 -> membro (non admin)
        let r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: [L] }, ckG);
        ok('G (membro non admin) invita -> 403', r.status === 403, `status ${r.status}`);
        await chiama('POST', `/api/squads/${S1}/admins/${G}`, {}, ckA); // A promuove G ad admin
        r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: [L] }, ckG);
        ok('G (ora admin) invita -> 200 (causalita\')', r.status === 200, JSON.stringify(r.corpo));
        ok('invitati = 1', r.corpo && r.corpo.invitati === 1, JSON.stringify(r.corpo));

        // === 3. idempotenza / gia' dentro / pendingRequests ===
        console.log('\n3. invite: gia\' membro saltato, reinvito idempotente, richiesta -> entra subito');
        r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: [G] }, ckA); // G e' gia' membro
        ok('invitare un membro -> saltato (invitati 0)', r.status === 200 && r.corpo.invitati === 0, JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: [L] }, ckA); // L gia' in pendingInvites
        ok('reinvito -> idempotente (invitati 0)', r.status === 200 && r.corpo.invitati === 0, JSON.stringify(r.corpo));
        let s1db = await squadsCol.findOne({ _id: oid(S1) });
        ok('pendingInvites invariato (un solo L)', S(s1db.pendingInvites).filter(x => x === String(L)).length === 1);

        await chiama('POST', `/api/squads/${S1}/request-join`, {}, ckSo); // So chiede di entrare in S1
        r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: [So] }, ckA); // ...e A la invita
        ok('invitare chi ha gia\' chiesto -> approvatiDaRichiesta 1, invitati 0', r.corpo && r.corpo.approvatiDaRichiesta === 1 && r.corpo.invitati === 0, JSON.stringify(r.corpo));
        s1db = await squadsCol.findOne({ _id: oid(S1) });
        ok('So e\' in members e NON piu\' in pendingRequests', S(s1db.members).includes(String(So)) && !S(s1db.pendingRequests).includes(String(So)));

        // === 4. tetti ===
        console.log('\n4. tetti: 51 in una chiamata -> 400; oltre 100 totali -> SQUAD_PIENA');
        r = await chiama('POST', `/api/squads/${S1}/invite`, { userIds: Array.from({ length: 51 }, () => String(new mongoose.Types.ObjectId())) }, ckA);
        ok('51 userId in una chiamata -> 400', r.status === 400, `status ${r.status}`);
        const { id: Sfull } = await creaSquad('-Sfull', {});
        await squadsCol.updateOne({ _id: oid(Sfull) }, { $set: { pendingInvites: Array.from({ length: 100 }, () => new mongoose.Types.ObjectId()) } });
        r = await chiama('POST', `/api/squads/${Sfull}/invite`, { userIds: [G] }, ckA);
        ok('oltre 100 totali -> 400 SQUAD_PIENA', r.status === 400 && r.corpo.code === 'SQUAD_PIENA', JSON.stringify(r.corpo));

        // === 5. invite-response ===
        console.log('\n5. invite-response: accetta / rifiuta / errori / idempotenza');
        const rAcc = await chiama('POST', `/api/squads/${S2}/invite-response`, { accept: true }, ckG);
        ok('G accetta S2 -> 200, membro', rAcc.status === 200 && S(rAcc.corpo.members).includes(String(G)), JSON.stringify(rAcc.corpo));
        let s2db = await squadsCol.findOne({ _id: oid(S2) });
        ok('pendingInvites ASSENTE sul DB (non [])', s2db.pendingInvites === undefined, JSON.stringify(s2db.pendingInvites));
        const nEntrato = await notifCol.countDocuments({ userId: oid(A), text: new RegExp('entrato nella squadra "' + MARCA + '-S2') });
        r = await chiama('POST', `/api/squads/${S2}/invite-response`, { accept: true }, ckG); // ripetuto
        ok('accept ripetuto -> 200 idempotente', r.status === 200);
        s2db = await squadsCol.findOne({ _id: oid(S2) });
        ok('un solo G in members', S(s2db.members).filter(x => x === String(G)).length === 1);
        ok('nessuna SECONDA notifica "entrato"', await notifCol.countDocuments({ userId: oid(A), text: new RegExp('entrato nella squadra "' + MARCA + '-S2') }) === nEntrato);

        const { id: S3 } = await creaSquad('-S3', { inviteUserIds: [G] });
        r = await chiama('POST', `/api/squads/${S3}/invite-response`, { accept: false }, ckG);
        ok('G rifiuta S3 -> 200, NON membro', r.status === 200 && !S(r.corpo.members).includes(String(G)), JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/squads/${S3}/invite-response`, { accept: true }, ckL); // L mai invitato a S3
        ok('non invitato -> 403 SQUAD_INVITO_ASSENTE', r.status === 403 && r.corpo.code === 'SQUAD_INVITO_ASSENTE', JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/squads/${S3}/invite-response`, {}, ckG);
        ok('accept mancante -> 400', r.status === 400);
        r = await chiama('POST', `/api/squads/${S3}/invite-response`, { accept: 'false' }, ckG);
        ok('accept stringa "false" -> 400 (mai coercizione)', r.status === 400);

        // === 6. DELETE /:id/invites/:userId ===
        console.log('\n6. annullamento invito: solo admin');
        await chiama('POST', `/api/squads/${S3}/invite`, { userIds: [G] }, ckA); // re-invito G a S3
        r = await chiama('DELETE', `/api/squads/${S3}/invites/${G}`, undefined, ckL); // L non e' admin di S3
        ok('un non admin non annulla un invito -> 403', r.status === 403, `status ${r.status}`);
        r = await chiama('DELETE', `/api/squads/${S3}/invites/${G}`, undefined, ckA);
        ok('l\'admin annulla l\'invito -> 200, G fuori da pendingInvites', r.status === 200 && !S(r.corpo.pendingInvites).includes(String(G)), JSON.stringify(r.corpo && r.corpo.pendingInvites));

        // === 7. lascia la squadra / rimuovi un membro ===
        console.log('\n7. DELETE /:id/members/:userId — uscita, rimozione, creatore, scioglimento');
        // S1 ora: A(creatore/admin), G(admin), So(membro), L(pendingInvites). L accetta.
        await chiama('POST', `/api/squads/${S1}/invite-response`, { accept: true }, ckL);
        r = await chiama('DELETE', `/api/squads/${S1}/members/${So}`, undefined, ckSo); // So esce da sola
        ok('un membro esce da solo -> 200', r.status === 200, JSON.stringify(r.corpo));
        s1db = await squadsCol.findOne({ _id: oid(S1) });
        ok('...e non e\' piu\' in members ne\' admins', !S(s1db.members).includes(String(So)) && !S(s1db.admins).includes(String(So)));
        r = await chiama('DELETE', `/api/squads/${S1}/members/${G}`, undefined, ckL); // L (non admin) prova a rimuovere G
        ok('un non-admin non rimuove un altro -> 403', r.status === 403, `status ${r.status}`);
        r = await chiama('DELETE', `/api/squads/${S1}/members/${A}`, undefined, ckG); // G (admin) prova a rimuovere il creatore
        ok('un admin non puo\' rimuovere il creatore -> 400', r.status === 400, JSON.stringify(r.corpo));
        r = await chiama('DELETE', `/api/squads/${S1}/members/${L}`, undefined, ckG); // G (admin) rimuove L (membro)
        ok('un admin rimuove un altro membro -> 200', r.status === 200, JSON.stringify(r.corpo));
        ok('B-4: L (rimosso da un admin) ha ricevuto una notifica',
            await notifCol.countDocuments({ userId: oid(L), text: new RegExp('rimosso dalla squadra "' + MARCA + '-S1') }) === 1);

        // creatore che esce -> passa la proprieta'
        const { id: S4 } = await creaSquad('-S4', { inviteUserIds: [G, L] });
        await chiama('POST', `/api/squads/${S4}/invite-response`, { accept: true }, ckG);
        await chiama('POST', `/api/squads/${S4}/invite-response`, { accept: true }, ckL);
        r = await chiama('DELETE', `/api/squads/${S4}/members/${A}`, undefined, ckA); // A (creatore) esce
        ok('il creatore esce -> 200', r.status === 200, JSON.stringify(r.corpo));
        const s4db = await squadsCol.findOne({ _id: oid(S4) });
        ok('creatorId e\' passato al membro piu\' anziano (G)', String(s4db.creatorId) === String(G), String(s4db.creatorId));
        ok('...che e\' anche in admins, e A e\' fuori da members', S(s4db.admins).includes(String(G)) && !S(s4db.members).includes(String(A)));
        ok('B-4: G (nuovo referente di S4) ha ricevuto una notifica',
            await notifCol.countDocuments({ userId: oid(G), text: new RegExp('referente della squadra "' + MARCA + '-S4') }) === 1);

        // un admin non creatore che esce, col creatore ancora presente -> nessuna promozione forzata
        const { id: S4b } = await creaSquad('-S4b', { inviteUserIds: [G] });
        await chiama('POST', `/api/squads/${S4b}/invite-response`, { accept: true }, ckG);
        await chiama('POST', `/api/squads/${S4b}/admins/${G}`, {}, ckA);
        await chiama('DELETE', `/api/squads/${S4b}/members/${G}`, undefined, ckG);
        const s4bdb = await squadsCol.findOne({ _id: oid(S4b) });
        ok('un admin non creatore esce: la squadra resta valida (il creatore e\' ancora admin per calcolo)', s4bdb && String(s4bdb.creatorId) === String(A) && !S(s4bdb.members).includes(String(G)));

        // ultimo membro esce -> la squadra si scioglie
        const { id: S5 } = await creaSquad('-S5', {});
        r = await chiama('DELETE', `/api/squads/${S5}/members/${A}`, undefined, ckA);
        ok('l\'ultimo membro esce -> { sciolta: true }', r.status === 200 && r.corpo && r.corpo.sciolta === true, JSON.stringify(r.corpo));
        ok('...e la squadra non esiste piu\' sul DB', await squadsCol.findOne({ _id: oid(S5) }) === null);

        // === 7b. rilievi della REVISIONE SICUREZZA 27ª: A-2, M-1, M-3 ===
        console.log('\n7b. A-2 (appartenenza dell\'attore), M-1 (successore vivo), M-3 (squadVisibileA)');

        // A-2: un NON MEMBRO non puo' invocare il flusso d'uscita "su se stesso" su una
        // squadra di cui non fa parte (prima il gate era condizionato a !seStesso -> un
        // estraneo faceva partire lo scioglimento di una squadra con members vuoto).
        const { id: S7b } = await creaSquad('-S7b', { inviteUserIds: [G] });
        await chiama('POST', `/api/squads/${S7b}/invite-response`, { accept: true }, ckG);
        r = await chiama('DELETE', `/api/squads/${S7b}/members/${So}`, undefined, ckSo); // So non e' in S7b
        ok('A-2: un non-membro che "esce" da una squadra estranea -> 403', r.status === 403, `status ${r.status}: ${JSON.stringify(r.corpo)}`);
        ok('A-2: ...e la squadra estranea esiste ancora (niente scioglimento)', await squadsCol.findOne({ _id: oid(S7b) }) !== null);

        // M-1: il successore del creatore uscente si sceglie fra i membri VIVI. Un id che non
        // risolve a nessun utente (o un tombstone) va saltato - prima si prendeva restanti[0]
        // e la squadra restava con creatorId fantasma + zero admin.
        const idFantasma = String(new mongoose.Types.ObjectId()); // non corrisponde a nessun User
        const { id: S8 } = await creaSquad('-S8', { inviteUserIds: [G] });
        await chiama('POST', `/api/squads/${S8}/invite-response`, { accept: true }, ckG); // members: [A, G]
        await squadsCol.updateOne({ _id: oid(S8) }, { $push: { members: oid(idFantasma) } }); // members: [A, G, fantasma]
        r = await chiama('DELETE', `/api/squads/${S8}/members/${A}`, undefined, ckA); // A (creatore) esce
        ok('M-1: A esce -> 200', r.status === 200, JSON.stringify(r.corpo));
        const s8db = await squadsCol.findOne({ _id: oid(S8) });
        ok('M-1: il nuovo creatorId e\' G (vivo), NON l\'id fantasma', s8db && String(s8db.creatorId) === String(G), s8db && String(s8db.creatorId));

        // M-1: se NON c'e' nessun successore vivo, la squadra si scioglie invece di restare
        // con un creatorId fantasma.
        const { id: S9 } = await creaSquad('-S9', {});
        await squadsCol.updateOne({ _id: oid(S9) }, { $push: { members: oid(idFantasma) } }); // members: [A, fantasma]
        r = await chiama('DELETE', `/api/squads/${S9}/members/${A}`, undefined, ckA);
        ok('M-1: creatore esce, unico "membro" restante e\' un fantasma -> { sciolta: true }',
            r.status === 200 && r.corpo && r.corpo.sciolta === true, JSON.stringify(r.corpo));
        ok('M-1: ...e la squadra non esiste piu\' sul DB', await squadsCol.findOne({ _id: oid(S9) }) === null);

        // M-3: GET /api/squads da un NON MEMBRO non espone gli inviti/le richieste altrui.
        const { id: S10 } = await creaSquad('-S10', { inviteUserIds: [L] }); // L invitato, non ancora dentro
        const listaSo = (await chiama('GET', '/api/squads', undefined, ckSo)).corpo || [];
        const s10visto = listaSo.find(s => (s.id || s._id) === S10);
        ok('M-3: So (non membro) vede comunque la squadra S10', !!s10visto, JSON.stringify(listaSo.map(s => s.id || s._id)));
        ok('M-3: ...ma NON vede pendingInvites (l\'invito di L a una squadra di cui non fa parte)',
            s10visto && (s10visto.pendingInvites === undefined || s10visto.pendingInvites.length === 0),
            JSON.stringify(s10visto && s10visto.pendingInvites));
        const listaG = (await chiama('GET', '/api/squads', undefined, ckA)).corpo || []; // A e' il creatore di S10
        const s10vistoDaA = listaG.find(s => (s.id || s._id) === S10);
        ok('M-3: il creatore (membro) vede pendingInvites per intero', s10vistoDaA && S(s10vistoDaA.pendingInvites).includes(String(L)),
            JSON.stringify(s10vistoDaA && s10vistoDaA.pendingInvites));

        // === 8. coerenza col gemello (Hike.pendingInvites sopravvive all'uscita) ===
        console.log('\n8. l\'invito a un\'escursione sopravvive all\'uscita dalla squadra');
        const { id: S6 } = await creaSquad('-S6', { inviteUserIds: [G] });
        await chiama('POST', `/api/squads/${S6}/invite-response`, { accept: true }, ckG);
        const hk = await chiama('POST', '/api/hikes', {
            title: MARCA + '-H', difficulty: 'Esperto', date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
            trailhead: { lat: 42.4686, lng: 13.5644, name: MARCA }
        }, ckA);
        const H = hk.corpo && hk.corpo.id;
        if (H) hikeIds.push(oid(H));
        await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: S6 }, ckA); // G invitata alla gita
        await chiama('DELETE', `/api/squads/${S6}/members/${G}`, undefined, ckG);    // G esce dalla squadra
        const hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('G e\' ancora in Hike.pendingInvites: l\'invito vive sull\'escursione, non sulla squadra',
            S(hdb.pendingInvites).includes(String(G)), JSON.stringify(hdb.pendingInvites));

        // === 8b. B-5 (revisione sicurezza 28ª): l'export dati contiene gli inviti RICEVUTI ===
        // G qui ha DUE inviti in sospeso: alla gita H (sez. 8, sopravvissuto all'uscita da S6)
        // e a S6b (creata ora, mai accettata).
        console.log('\n8b. B-5: /api/users/me/export include gli inviti ricevuti e non accettati');
        const { id: S6b } = await creaSquad('-S6b', { inviteUserIds: [G] }); // G invitato, NON accetta
        const exp = await chiama('GET', '/api/users/me/export', undefined, ckG);
        ok('export -> 200', exp.status === 200, `status ${exp.status}`);
        const invS = (exp.corpo && exp.corpo.invitiSquadraRicevuti) || [];
        ok('B-5: invitiSquadraRicevuti contiene S6b (solo nome + id, non il documento intero)',
            invS.some(s => String(s._id) === String(S6b) && s.name === MARCA + '-S6b') && !invS.some(s => 'members' in s), JSON.stringify(invS));
        const invH = (exp.corpo && exp.corpo.invitiEscursioneRicevuti) || [];
        ok('B-5: invitiEscursioneRicevuti contiene la gita H (l\'invito sopravvissuto all\'uscita da S6)',
            invH.some(h => String(h._id) === String(H)), JSON.stringify(invH));

        // === 8c. MEDIO-3 (revisione sicurezza 28ª): Squad.photo fuori da GET /api/squads ===
        console.log('\n8c. MEDIO-3: la foto squadra ha una rotta dedicata, non esce dalla lista');
        const { id: Sfoto } = await creaSquad('-Sfoto', {});
        const fintoDataUrl = 'data:image/png;base64,' + 'A'.repeat(240);
        let rf = await chiama('PUT', `/api/squads/${Sfoto}/photo`, { photo: fintoDataUrl }, ckA);
        ok('PUT /:id/photo da admin -> 200', rf.status === 200, JSON.stringify(rf.corpo && rf.corpo.error));
        ok('...la risposta contiene ancora la foto (serve al client per l\'anteprima)', rf.corpo && rf.corpo.photo === fintoDataUrl);
        const listaConFoto = (await chiama('GET', '/api/squads', undefined, ckA)).corpo || [];
        const sfotoInLista = listaConFoto.find(s => (s.id || s._id) === Sfoto);
        ok('MEDIO-3: GET /api/squads NON porta il campo photo', sfotoInLista && !('photo' in sfotoInLista),
            JSON.stringify(sfotoInLista && Object.keys(sfotoInLista)));
        rf = await chiama('GET', `/api/squads/${Sfoto}/photo`, undefined, ckA);
        ok('MEDIO-3: GET /api/squads/:id/photo restituisce la foto', rf.status === 200 && rf.corpo && rf.corpo.photo === fintoDataUrl, JSON.stringify(rf.corpo && Object.keys(rf.corpo)));
        rf = await chiama('GET', `/api/squads/${Sfoto}/photo`, undefined, null);
        ok('MEDIO-3: la rotta foto richiede login -> 401', rf.status === 401, `status ${rf.status}`);
        rf = await chiama('PUT', `/api/squads/${Sfoto}/photo`, { photo: fintoDataUrl }, ckL); // L non e' admin di Sfoto
        ok('MEDIO-3: PUT /:id/photo da un non-admin -> 403', rf.status === 403, `status ${rf.status}`);

        // === 9. non regressione: request-join + approve ===
        console.log('\n9. request-join + approve (punto 75) invariati');
        const { id: S7 } = await creaSquad('-S7', {});
        await chiama('POST', `/api/squads/${S7}/request-join`, {}, ckL);
        r = await chiama('POST', `/api/squads/${S7}/approve/${L}`, {}, ckA);
        ok('approve di una richiesta -> 200, L in members', r.status === 200 && S(r.corpo.members).includes(String(L)), JSON.stringify(r.corpo));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++; fallimenti.push('eccezione non gestita: ' + e.message);
    } finally {
        // Pulizia: filtrata per MARCA (nel nome della squadra e nel testo delle notifiche).
        if (squadIds.length) {
            const idStr = squadIds.map(String);
            await msgCol.deleteMany({ squadId: { $in: squadIds } });
            await squadsCol.deleteMany({ _id: { $in: squadIds } });
        }
        await squadsCol.deleteMany({ name: { $regex: '^' + MARCA } });
        if (hikeIds.length) {
            await hikesCol.deleteMany({ _id: { $in: hikeIds } });
            await notifCol.deleteMany({ relatedHikeId: { $in: hikeIds } });
        }
        await hikesCol.deleteMany({ title: { $regex: '^' + MARCA } });
        // Ogni notifica di prova cita il nome (fra virgolette) di una squadra/escursione di
        // prova, che contiene MARCA: invito, ingresso, rifiuto, richiesta, approvazione.
        await notifCol.deleteMany({ text: { $regex: '"' + MARCA } });

        const fine = {
            squads: await squadsCol.countDocuments(),
            squadmessages: await msgCol.countDocuments(),
            notifications: await notifCol.countDocuments(),
            users: await usersCol.countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        for (const k of Object.keys(partenza)) {
            ok(`nessun residuo di prova in "${k}"`, fine[k] === partenza[k], `${partenza[k]} -> ${fine[k]}`);
        }
        if (server) server.kill();
        await mongoose.disconnect();
    }

    console.log(`\n==== ${passati} ok, ${falliti} falliti ====`);
    if (falliti) { console.log('Falliti:', fallimenti); process.exit(1); }
})();
