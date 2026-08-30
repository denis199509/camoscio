// PROVA DEL PUNTO 115 - rinominare un'uscita.
//
// Copre:
//   - PATCH /api/tracking/sessions/:id/name: solo il proprietario, nome trim + tetto 120,
//     nome vuoto -> $unset (torna alla data), id non valido -> 400, inesistente -> 404,
//     di un altro utente -> 403 e nessuna modifica.
//   - POST /api/tracking/sessions/:id/publish con { name, caption }: pubblica E assegna il
//     nome; name:'' toglie il nome ma lascia pubblicato; name assente non tocca il nome.
//   - POST /api/tracking/sessions/:id/unpublish: toglie publishedAt/caption ma NON il nome.
//
// Lanciarla:  node prove/prova-punto115.js   (avvia un server suo sulla 3115)
// CONTROPROVA: su un commit prima del 115, la rotta PATCH /name risponde 404 e le sezioni
// che la usano cadono; publish ignora `name`.

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3115;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-115-' + Date.now();

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
async function loginDemo(userId) {
    const a = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (a.headers.getSetCookie ? a.headers.getSetCookie() : [a.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = mongoose.connection.collection('users');
    const sessions = mongoose.connection.collection('activehikesessions');
    const oid = s => new mongoose.Types.ObjectId(s);
    const sessioniCreate = [];

    let server;
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
        const idA = elenco[0].id, idB = elenco[1].id;
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        console.log(`     (A=${elenco[0].username}, B=${elenco[1].username})`);

        // Sessione conclusa di A, senza nome (importedName assente) - come un .fit appena importato.
        async function creaSessione() {
            const pts = [];
            let lng = 13.556, lat = 42.468;
            for (let i = 0; i < 60; i++) { pts.push([+lng.toFixed(5), +lat.toFixed(5), 1300 + i, i * 30, 5]); lng += 0.0004; lat += 0.0003; }
            const r = await sessions.insertOne({
                userId: oid(idA), hikeId: null, status: 'ended',
                startedAt: new Date(Date.now() - 4 * 3600e3), endedAt: new Date(Date.now() - 2 * 3600e3),
                lastPointAt: new Date(Date.now() - 2 * 3600e3),
                distanceKm: 5.2, elevationGainM: 300, points: pts,
                importedFrom: 'gpx'  // NB: nessun importedName -> l'uscita parte "senza nome"
            });
            sessioniCreate.push(r.insertedId.toString());
            return r.insertedId.toString();
        }
        const leggi = async id => sessions.findOne({ _id: oid(id) });

        // ============================================================
        console.log('\n1. PATCH /name: il proprietario mette un nome');
        const s1 = await creaSessione();
        const r1 = await chiama('PATCH', `/api/tracking/sessions/${s1}/name`, { name: `  ${MARCA} Cresta est  ` }, cookieA);
        ok('PATCH /name -> 200', r1.status === 200, `status ${r1.status}`);
        ok('risposta { importedName } col nome trimmato', r1.corpo && r1.corpo.importedName === `${MARCA} Cresta est`, JSON.stringify(r1.corpo));
        ok('sul DB importedName e\' il nome trimmato', (await leggi(s1)).importedName === `${MARCA} Cresta est`);

        console.log('\n2. PATCH /name: nome vuoto -> torna alla data (campo tolto)');
        const r2 = await chiama('PATCH', `/api/tracking/sessions/${s1}/name`, { name: '   ' }, cookieA);
        ok('PATCH /name vuoto -> 200', r2.status === 200, `status ${r2.status}`);
        ok('risposta importedName: null', r2.corpo && r2.corpo.importedName === null, JSON.stringify(r2.corpo));
        ok('sul DB il campo importedName non c\'e\' piu\'', !('importedName' in (await leggi(s1))));

        console.log('\n3. PATCH /name: tetto a 120 caratteri');
        const lungo = 'x'.repeat(200);
        const r3 = await chiama('PATCH', `/api/tracking/sessions/${s1}/name`, { name: lungo }, cookieA);
        ok('PATCH /name lungo -> 200', r3.status === 200, `status ${r3.status}`);
        ok('nome tagliato a 120', r3.corpo && r3.corpo.importedName && r3.corpo.importedName.length === 120, String(r3.corpo && r3.corpo.importedName && r3.corpo.importedName.length));
        ok('sul DB 120 caratteri', (await leggi(s1)).importedName.length === 120);

        console.log('\n4. PATCH /name: un altro utente non puo\'');
        await chiama('PATCH', `/api/tracking/sessions/${s1}/name`, { name: `${MARCA} originale` }, cookieA);
        const r4 = await chiama('PATCH', `/api/tracking/sessions/${s1}/name`, { name: `${MARCA} MANOMESSO` }, cookieB);
        ok('PATCH /name di un altro -> 403', r4.status === 403, `status ${r4.status}`);
        ok('il nome sul DB e\' rimasto quello del proprietario', (await leggi(s1)).importedName === `${MARCA} originale`);

        console.log('\n5. PATCH /name: id non valido e id inesistente');
        const r5a = await chiama('PATCH', `/api/tracking/sessions/non-un-id/name`, { name: 'x' }, cookieA);
        ok('id non valido -> 400', r5a.status === 400, `status ${r5a.status}`);
        const r5b = await chiama('PATCH', `/api/tracking/sessions/${new mongoose.Types.ObjectId()}/name`, { name: 'x' }, cookieA);
        ok('id inesistente -> 404', r5b.status === 404, `status ${r5b.status}`);

        console.log('\n6. POST /publish con { name, caption }: pubblica E nomina');
        const s2 = await creaSessione();
        const r6 = await chiama('POST', `/api/tracking/sessions/${s2}/publish`, { name: `${MARCA} Anello del rifugio`, caption: 'bella giornata' }, cookieA);
        ok('publish -> 200', r6.status === 200, `status ${r6.status}`);
        {
            const d = await leggi(s2);
            ok('sul DB: publishedAt presente', d.publishedAt instanceof Date);
            ok('sul DB: caption salvata', d.caption === 'bella giornata');
            ok('sul DB: importedName salvato dalla pubblicazione', d.importedName === `${MARCA} Anello del rifugio`);
        }

        console.log('\n7. POST /publish con name:"" -> toglie il nome, resta pubblicata');
        const r7 = await chiama('POST', `/api/tracking/sessions/${s2}/publish`, { name: '', caption: 'ripubblico' }, cookieA);
        ok('publish -> 200', r7.status === 200, `status ${r7.status}`);
        {
            const d = await leggi(s2);
            ok('sul DB: importedName rimosso', !('importedName' in d));
            ok('sul DB: ancora pubblicata', d.publishedAt instanceof Date);
        }

        console.log('\n8. POST /publish SENZA campo name -> non tocca il nome');
        await chiama('PATCH', `/api/tracking/sessions/${s2}/name`, { name: `${MARCA} nome a mano` }, cookieA);
        const r8 = await chiama('POST', `/api/tracking/sessions/${s2}/publish`, { caption: 'solo commento' }, cookieA);
        ok('publish -> 200', r8.status === 200, `status ${r8.status}`);
        ok('il nome messo a mano e\' rimasto', (await leggi(s2)).importedName === `${MARCA} nome a mano`);

        console.log('\n9. POST /unpublish: toglie publishedAt/caption ma NON il nome');
        const r9 = await chiama('POST', `/api/tracking/sessions/${s2}/unpublish`, null, cookieA);
        ok('unpublish -> 200', r9.status === 200, `status ${r9.status}`);
        {
            const d = await leggi(s2);
            ok('sul DB: publishedAt tolto', !('publishedAt' in d));
            ok('sul DB: caption tolta', !('caption' in d));
            ok('sul DB: importedName RIMASTO', d.importedName === `${MARCA} nome a mano`);
        }

    } catch (e) {
        console.error('\nERRORE NELLA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of sessioniCreate) await sessions.deleteOne({ _id: oid(id) }).catch(() => {});
        await sessions.deleteMany({ importedName: new RegExp('^' + MARCA) }).catch(() => {});
        await mongoose.disconnect();
        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (fallimenti.length) console.log('  falliti:', fallimenti.join(' | '));
        process.exit(falliti ? 1 : 0);
    }
})();
