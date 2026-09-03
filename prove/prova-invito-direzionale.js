// PROVA — INVITO SQUADRA DIREZIONALE, lato escursione (tappe 1-3).
// Rimandato dalla 26ª sessione: "solo chi accetta diventa partecipante, chi rifiuta no.
// decide l'invitato, non il creatore della squadra" (parole di Denis).
//
// Copre le due rotte nuove di routes/hikes.js:
//   POST /api/hikes/:id/invite-squad   { squadId }
//   POST /api/hikes/:id/invite-response { accept }
// più il $unset di pendingInvites in complete-group e la serializzazione ridotta in
// hikeVisibileA. La CHIUSURA della vecchia corsia (il creatore/un partecipante non puo'
// piu' aggiungere altri a `participants` con un PUT) e' provata da prova-invito-squadra.js
// (sezione B) e prova-partecipanti-forzati.js.
//
// CONTROPROVA: sul commit precedente le due rotte rispondono 404 e le sezioni 2-8 cadono.
//
// Trappola dei 4 demo (vault 07): Marco/Luca/Sofia stanno nella squadra reale "I Camosci
// della Val Brembana". La squadra di prova si crea a parte e si cancella nel finally.
//
// Lanciarla:  node prove/prova-invito-direzionale.js   (avvia un server suo sulla 3117)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3117;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-INVDIR-' + Date.now();

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

// Helper UNICO per costruire una squadra di prova - alla tappa 4 ("consenso squadra")
// questa funzione diventa creazione + accept degli invitati, e cambia SOLO qui.
// Dalla tappa 4 ("consenso squadra") POST /api/squads crea la squadra col SOLO creatore e
// invita gli altri: qui li si fa accettare, cosi' a valle la squadra ha membri veri.
// invitati: [{ id, cookie }] - il creatore e' gia' membro, non va passato.
async function creaSquadraDiProva(cookieCreatore, nome, invitati) {
    const r = await chiama('POST', '/api/squads', { name: nome, inviteUserIds: invitati.map(x => x.id) }, cookieCreatore);
    const id = r.corpo && (r.corpo.id || r.corpo._id);
    if (r.status !== 200 || !id) throw new Error('creaSquadraDiProva fallita: ' + JSON.stringify(r));
    for (const inv of invitati) {
        const acc = await chiama('POST', `/api/squads/${id}/invite-response`, { accept: true }, inv.cookie);
        if (acc.status !== 200) throw new Error(`accept invito squadra fallito per ${inv.id}: ` + JSON.stringify(acc));
    }
    return id;
}

const TRAILHEAD = { lat: 42.4686, lng: 13.5644, name: 'PROVA' }; // Gran Sasso, Abruzzo
function fraGiorni(n) {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const hikesCol = mongoose.connection.collection('hikes');
    const squadsCol = mongoose.connection.collection('squads');
    const notifCol = mongoose.connection.collection('notifications');
    const oid = s => new mongoose.Types.ObjectId(s);

    const partenza = {
        hikes: await hikesCol.countDocuments(),
        squads: await squadsCol.countDocuments(),
        notifiche: await notifCol.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    const hikeIds = [];
    const squadIds = [];

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
        const A = elenco[0].id, B = elenco[3].id, C = elenco[1].id, D = elenco[2].id;
        const ckA = await loginDemo(A), ckB = await loginDemo(B), ckC = await loginDemo(C), ckD = await loginDemo(D);
        console.log(`     A=${elenco[0].username} (crea)  B=${elenco[3].username} (invitato)  C=${elenco[1].username}  D=${elenco[2].username}\n`);

        // Squadra di prova: A (creatore) + B + C, che accettano l'invito. B (Giulia) e' l'unico
        // demo libero, C (Luca) sta gia' in "Val Brembana" ma qui e' in una squadra NUOVA.
        const S = await creaSquadraDiProva(ckA, MARCA + '-S', [{ id: B, cookie: ckB }, { id: C, cookie: ckC }]);
        squadIds.push(oid(S));
        const S_altrui = await creaSquadraDiProva(ckB, MARCA + '-S2', [{ id: D, cookie: ckD }]); // squadra di B, senza A
        squadIds.push(oid(S_altrui));

        async function creaHike(cookie, suff, extra = {}) {
            const r = await chiama('POST', '/api/hikes', {
                title: MARCA + ' ' + suff, difficulty: 'Esperto', date: fraGiorni(20),
                trailhead: TRAILHEAD, ...extra
            }, cookie);
            if (r.status !== 200 || !r.corpo || !r.corpo.id) throw new Error('creaHike fallita: ' + JSON.stringify(r));
            hikeIds.push(oid(r.corpo.id));
            return r.corpo.id;
        }

        // === 1. invite-squad: guardie ===
        console.log('1. invite-squad — guardie di accesso');
        const H = await creaHike(ckA, 'H');
        let r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: S }, ckB);
        ok('B (non partecipante) invita → 403', r.status === 403, `status ${r.status}`);
        r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: S_altrui }, ckA);
        ok('A invita una squadra di cui non fa parte → 403', r.status === 403, `status ${r.status}`);
        r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: String(new mongoose.Types.ObjectId()) }, ckA);
        ok('squadId inesistente → 404', r.status === 404, `status ${r.status}`);
        r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: 'non-un-id' }, ckA);
        ok('squadId non valido → 400', r.status === 400, `status ${r.status}`);

        // === 2. invite-squad legittimo ===
        console.log('\n2. invite-squad legittimo: i membri vanno in pendingInvites, nessuno in participants');
        r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: S }, ckA);
        ok('→ 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));
        ok('invitati = 2 (B e C; A è già creatore)', r.corpo && r.corpo.invitati === 2, JSON.stringify(r.corpo));
        let Hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('pendingInvites sul DB = [B, C]', Hdb && (Hdb.pendingInvites || []).map(String).sort().join() === [B, C].sort().join(),
            JSON.stringify(Hdb && Hdb.pendingInvites));
        ok('participants sul DB = [A] soltanto (nessuno spostato)', Hdb && Hdb.participants.map(String).join() === A,
            JSON.stringify(Hdb && Hdb.participants));
        // Solo le notifiche d'INVITO: A crea l'escursione e l'auto-annuncio alle sue squadre
        // (routes/hikes.js POST /) ne genera altre con lo stesso relatedHikeId.
        const nB = await notifCol.countDocuments({ userId: oid(B), relatedHikeId: oid(H), text: /invitato all'escursione/ });
        const nC = await notifCol.countDocuments({ userId: oid(C), relatedHikeId: oid(H), text: /invitato all'escursione/ });
        ok('B e C hanno 1 notifica d\'invito ciascuno con relatedHikeId', nB === 1 && nC === 1, `B:${nB} C:${nC}`);

        // === 3. idempotenza dell'invito ===
        console.log('\n3. reinvito della stessa squadra → nessun doppione');
        r = await chiama('POST', `/api/hikes/${H}/invite-squad`, { squadId: S }, ckA);
        ok('→ 200, invitati = 0, giaInvitati = 2', r.status === 200 && r.corpo.invitati === 0 && r.corpo.giaInvitati === 2, JSON.stringify(r.corpo));
        Hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('pendingInvites invariato (2 elementi, nessun doppione)', (Hdb.pendingInvites || []).length === 2);

        // === 4. invite-response ===
        console.log('\n4. invite-response: B accetta, C rifiuta');
        r = await chiama('POST', `/api/hikes/${H}/invite-response`, { accept: true }, ckB);
        ok('B accept → 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));
        Hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('B ora in participants', Hdb.participants.map(String).includes(B));
        ok('B fuori da pendingInvites', !(Hdb.pendingInvites || []).map(String).includes(B));
        const nAccept = await notifCol.countDocuments({ userId: oid(A), relatedHikeId: oid(H), text: /ha accettato/ });
        ok('il creatore A ha ricevuto la notifica di accettazione', nAccept === 1, `trovate ${nAccept}`);

        r = await chiama('POST', `/api/hikes/${H}/invite-response`, { accept: false }, ckC);
        ok('C reject → 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));
        Hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('C NON in participants', !Hdb.participants.map(String).includes(C));
        ok('pendingInvites ora ASSENTE sul DB (non [])', Hdb.pendingInvites === undefined, JSON.stringify(Hdb.pendingInvites));

        // === 5. invite-response: errori ===
        console.log('\n5. invite-response — errori e idempotenza');
        r = await chiama('POST', `/api/hikes/${H}/invite-response`, { accept: true }, ckD);
        ok('D mai invitato → 403 HIKE_INVITO_ASSENTE', r.status === 403 && r.corpo.code === 'HIKE_INVITO_ASSENTE', JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/hikes/${H}/invite-response`, { accept: 'false' }, ckB);
        ok('accept stringa "false" → 400 (non vale come adesione)', r.status === 400, `status ${r.status}`);
        r = await chiama('POST', `/api/hikes/${H}/invite-response`, {}, ckB);
        ok('accept mancante → 400', r.status === 400, `status ${r.status}`);
        const nAcceptPrima = await notifCol.countDocuments({ userId: oid(A), relatedHikeId: oid(H), text: /ha accettato/ });
        r = await chiama('POST', `/api/hikes/${H}/invite-response`, { accept: true }, ckB);
        ok('B (già partecipante) accept ripetuto → 200', r.status === 200, `status ${r.status}`);
        Hdb = await hikesCol.findOne({ _id: oid(H) });
        ok('un solo B in participants (nessun doppione)', Hdb.participants.map(String).filter(x => x === B).length === 1);
        const nAcceptDopo = await notifCol.countDocuments({ userId: oid(A), relatedHikeId: oid(H), text: /ha accettato/ });
        ok('nessuna SECONDA notifica di accettazione', nAcceptDopo === nAcceptPrima, `${nAcceptPrima} → ${nAcceptDopo}`);

        // === 6. hikeVisibileA — serializzazione ridotta di pendingInvites ===
        console.log('\n6. GET /api/hikes/ — chi vede pendingInvites');
        const H6 = await creaHike(ckA, 'H6');
        await chiama('POST', `/api/hikes/${H6}/invite-squad`, { squadId: S }, ckA); // B, C invitati
        const vistoDa = async (ck) => {
            const lista = (await chiama('GET', '/api/hikes/', undefined, ck)).corpo || [];
            return lista.find(h => h.id === H6 || h._id === H6);
        };
        const vD = await vistoDa(ckD); // D: non partecipante, non invitato
        ok('D (estraneo) NON vede pendingInvites', vD && (vD.pendingInvites === undefined || vD.pendingInvites.length === 0), JSON.stringify(vD && vD.pendingInvites));
        const vC = await vistoDa(ckC); // C: invitato, non partecipante
        ok('C (invitato) vede SOLO il proprio id in pendingInvites', vC && (vC.pendingInvites || []).map(String).join() === C, JSON.stringify(vC && vC.pendingInvites));
        const vA = await vistoDa(ckA); // A: creatore/partecipante
        ok('A (creatore) vede la lista intera [B, C]', vA && (vA.pendingInvites || []).map(String).sort().join() === [B, C].sort().join(), JSON.stringify(vA && vA.pendingInvites));

        // B-6 (revisione sicurezza 28ª): un partecipante NON creatore non vede la lista intera
        // degli invitati in attesa - solo il creatore, a cui serve per il conteggio.
        await chiama('POST', `/api/hikes/${H6}/invite-response`, { accept: true }, ckC); // C accetta -> partecipante non creatore
        const vCpart = await vistoDa(ckC);
        ok('B-6: C (ora partecipante, non creatore) NON vede pendingInvites',
            vCpart && (vCpart.pendingInvites === undefined || vCpart.pendingInvites.length === 0), JSON.stringify(vCpart && vCpart.pendingInvites));
        // R-1, trappola gia' pagata due volte in questo file: se hikeVisibileA regredisse a
        // toObject() la copia uscirebbe con _id/__v e senza id, e il client non aggancerebbe piu'.
        ok('B-6: la copia per il partecipante esce con .id e senza ._id/__v (no toObject)',
            vCpart && typeof vCpart.id === 'string' && vCpart._id === undefined && vCpart.__v === undefined,
            JSON.stringify(Object.keys(vCpart || {})));
        ok('B-6: il partecipante non creatore vede ancora carpool/backpackTemplate (l\'estraneo D no)',
            vCpart && ('carpool' in vCpart) && ('backpackTemplate' in vCpart) && !('carpool' in vD),
            JSON.stringify({ cpart: 'carpool' in (vCpart || {}), d: 'carpool' in (vD || {}) }));
        ok('B-6: pendingInvitesCount (conteggio non nominativo) = 1 per il partecipante',
            vCpart && vCpart.pendingInvitesCount === 1, JSON.stringify(vCpart && vCpart.pendingInvitesCount));
        const vAdopo = await vistoDa(ckA);
        ok('B-6: A (creatore) continua a vedere l\'invito restante [B]',
            vAdopo && (vAdopo.pendingInvites || []).map(String).join() === B, JSON.stringify(vAdopo && vAdopo.pendingInvites));

        // === 7. manualApproval: invita solo il creatore ===
        console.log('\n7. escursione ad approvazione manuale: invita solo il creatore');
        const H7 = await creaHike(ckA, 'H7', { manualApproval: true });
        // C entra come partecipante NON creatore: chiede (H7 e' ad approvazione manuale) e A
        // accetta. Dalla tappa 3 il creatore non puo' piu' aggiungere C "a mano".
        await chiama('PUT', `/api/hikes/${H7}`, { pendingApproval: [C] }, ckC);
        await chiama('PUT', `/api/hikes/${H7}`, { participants: [A, C], pendingApproval: [] }, ckA);
        r = await chiama('POST', `/api/hikes/${H7}/invite-squad`, { squadId: S }, ckC);
        ok('C (partecipante non creatore) invita → 403 HIKE_INVITO_SOLO_CREATORE', r.status === 403 && r.corpo.code === 'HIKE_INVITO_SOLO_CREATORE', JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/hikes/${H7}/invite-squad`, { squadId: S }, ckA);
        ok('A (creatore) invita → 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));

        // === 8. complete-group svuota pendingInvites ===
        console.log('\n8. complete-group azzera pendingInvites con $unset');
        const H8 = await creaHike(ckA, 'H8');
        await chiama('POST', `/api/hikes/${H8}/invite-squad`, { squadId: S }, ckA); // B, C in pendingInvites
        r = await chiama('POST', `/api/hikes/${H8}/complete-group`, { confirmedUserIds: [A] }, ckA);
        ok('complete-group → 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));
        Hdb = await hikesCol.findOne({ _id: oid(H8) });
        ok('pendingInvites ASSENTE dopo la chiusura (non [])', Hdb.pendingInvites === undefined, JSON.stringify(Hdb.pendingInvites));
        r = await chiama('POST', `/api/hikes/${H8}/invite-squad`, { squadId: S }, ckA);
        ok('invite-squad su escursione conclusa → 409 HIKE_COMPLETATA', r.status === 409 && r.corpo.code === 'HIKE_COMPLETATA', JSON.stringify(r.corpo));

        // === 9. guardie conclusa / data passata su invite-response (stato forzato sul DB) ===
        console.log('\n9. invite-response: escursione conclusa / data passata — accept 409, reject 200');
        const Hconc = await hikesCol.insertOne({
            title: MARCA + ' Hconc', difficulty: 'Esperto', date: fraGiorni(10),
            creatorId: oid(A), participants: [oid(A)], pendingApproval: [], pendingInvites: [oid(B)],
            groupCompletedAt: new Date(),
            location: { type: 'Point', coordinates: [13.5644, 42.4686] }, trailhead: TRAILHEAD
        });
        hikeIds.push(Hconc.insertedId);
        r = await chiama('POST', `/api/hikes/${Hconc.insertedId}/invite-response`, { accept: true }, ckB);
        ok('accept su conclusa → 409 HIKE_COMPLETATA', r.status === 409 && r.corpo.code === 'HIKE_COMPLETATA', JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/hikes/${Hconc.insertedId}/invite-response`, { accept: false }, ckB);
        ok('reject su conclusa → 200 (il rifiuto non è mai bloccato)', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));

        const Hpast = await hikesCol.insertOne({
            title: MARCA + ' Hpast', difficulty: 'Esperto', date: fraGiorni(-3),
            creatorId: oid(A), participants: [oid(A)], pendingApproval: [], pendingInvites: [oid(B)],
            location: { type: 'Point', coordinates: [13.5644, 42.4686] }, trailhead: TRAILHEAD
        });
        hikeIds.push(Hpast.insertedId);
        r = await chiama('POST', `/api/hikes/${Hpast.insertedId}/invite-response`, { accept: true }, ckB);
        ok('accept su data passata → 409 HIKE_DATE_PASSED con hikeDate', r.status === 409 && r.corpo.code === 'HIKE_DATE_PASSED' && !!r.corpo.hikeDate, JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/hikes/${Hpast.insertedId}/invite-squad`, { squadId: S }, ckA);
        ok('invite-squad su data passata → 409 HIKE_DATE_PASSED', r.status === 409 && r.corpo.code === 'HIKE_DATE_PASSED', JSON.stringify(r.corpo));
        r = await chiama('POST', `/api/hikes/${Hpast.insertedId}/invite-response`, { accept: false }, ckB);
        ok('reject su data passata → 200', r.status === 200, JSON.stringify(r.corpo && r.corpo.error));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++; fallimenti.push('eccezione non gestita: ' + e.message);
    } finally {
        if (hikeIds.length) {
            await hikesCol.deleteMany({ _id: { $in: hikeIds } });
            await notifCol.deleteMany({ relatedHikeId: { $in: hikeIds } });
        }
        await hikesCol.deleteMany({ title: { $regex: '^' + MARCA } });
        if (squadIds.length) await squadsCol.deleteMany({ _id: { $in: squadIds } });
        await squadsCol.deleteMany({ name: { $regex: '^' + MARCA } });
        // Notifiche degli inviti squadra (non hanno relatedHikeId): il testo cita il nome
        // della squadra di prova, che contiene MARCA.
        await notifCol.deleteMany({ text: { $regex: 'squadra "' + MARCA } });
        const fine = {
            hikes: await hikesCol.countDocuments(),
            squads: await squadsCol.countDocuments(),
            notifiche: await notifCol.countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessuna escursione di prova lasciata', fine.hikes === partenza.hikes, JSON.stringify({ partenza, fine }));
        ok('nessuna squadra di prova lasciata', fine.squads === partenza.squads, JSON.stringify({ partenza, fine }));
        ok('nessuna notifica di prova lasciata', fine.notifiche === partenza.notifiche, JSON.stringify({ partenza, fine }));
        if (server) server.kill();
        await mongoose.disconnect();
    }

    console.log(`\n==== ${passati} ok, ${falliti} falliti ====`);
    if (falliti) { console.log('Falliti:', fallimenti); process.exit(1); }
})();
