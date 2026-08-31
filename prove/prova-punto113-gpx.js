// PROVA DEL FIX 30/08/2026 (punto 113): il .gpx aggiunto a un'escursione GIA' COMPLETATA
// (tasto ⬆, POST /api/completions/:id/gpx) salva anche la TRACCIA come ActiveHikeSession
// collegata all'escursione -> l'escursione diventa pubblicabile nel feed.
//
// Segnalato da Denis: "Alba Corno Grande" non si pubblicava ("serve una traccia") pur
// avendo gia' caricato il .gpx col ⬆ (si vedeva il tempo di cammino). Causa: la rotta
// estraeva solo gli orari e buttava la geometria; il feed ha bisogno della linea.
//
// Copre:
//  - dopo il ⬆, una ActiveHikeSession con hikeId != null, importedFrom:'gpx', status
//    'ended', points, movingTimeSec, NESSUN openSession, NON pubblicata di default;
//  - quella sessione E' pubblicabile (POST /sessions/:id/publish -> 200);
//  - il ricaricamento aggiorna LO STESSO documento (nessun doppione) e conserva
//    publishedAt/caption; importedName segue il nuovo file;
//  - una sessione REGISTRATA DAL VIVO (importedFrom assente) NON viene toccata dal ⬆;
//  - il tetto mensile delle importazioni (/import-gpx) NON conta le sessioni con hikeId:
//    quel tetto e' per le uscite a se' (hikeId:null);
//  - sez. 6 (punto 115): il nome della traccia collegata;
//  - sez. 7 (coda punto 113, 2026-08-31): il ⬆ assegna anche i badge di vetta, come
//    "Carica un file .gpx" - assegnaTimbriDallaTraccia spostata in lib/geofenceTimbri.js
//    e richiamata da routes/completions.js; il badge nuovo torna nel campo "badge" della
//    risposta e un ri-upload non crea doppioni.
//
// CONTROPROVA: la stessa prova sul codice PRIMA del fix (git worktree su 37650c8) fa
// cadere le sezioni 2-4 (nessuna sessione creata dal ⬆, quindi niente da pubblicare).
// Per la sez. 7, il codice prima del 2026-08-31 non passa `badge` nella risposta del ⬆.
// Dettaglio ed esito in LEGGIMI-PROVE.txt.
//
// Lanciarla:  node prove/prova-punto113-gpx.js   (avvia un server suo sulla 3115)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3115;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-113gpx-' + Date.now();

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

// GPX vero: ~60 punti sul Gran Sasso, 1 punto/min, con 15 min di sosta in mezzo. Il
// tracciato zigzaga (Math.sin/cos) cosi' abbastanza punti sopravvivono a simplifyTrack.
function gpx(nome, giornoIso) {
    const t0 = new Date(giornoIso + 'T06:00:00Z').getTime();
    let lat = 42.4686, lng = 13.5644, alt = 1800;
    const pts = [];
    for (let i = 0; i < 60; i++) {
        const fermo = i >= 25 && i < 40;
        if (!fermo) { lat += 0.0006 + Math.sin(i / 2) * 0.0004; lng += 0.0004 + Math.cos(i / 3) * 0.0003; alt += (i < 30 ? 22 : -18); }
        pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${Math.round(alt)}</ele><time>${new Date(t0 + i * 60000).toISOString()}</time></trkpt>`);
    }
    return `<?xml version="1.0"?><gpx version="1.1" creator="prova"><trk><name>${nome}</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

// Punto 115: come gpx() ma SENZA <name> - imita un .fit (che non porta un nome traccia)
// esportato in gpx. Serve a verificare il ripiego "nome = titolo dell'escursione".
function gpxSenzaNome(giornoIso) {
    const conNome = gpx('_', giornoIso);
    return conNome.replace(/<name>[^<]*<\/name>/, '');
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const hikes = mongoose.connection.collection('hikes');
    const comps = mongoose.connection.collection('completions');
    const sessions = mongoose.connection.collection('activehikesessions');
    const stamps = mongoose.connection.collection('stamps'); // sez. 7: badge di vetta dal ⬆
    const oid = s => new mongoose.Types.ObjectId(s);

    const partenza = {
        hikes: await hikes.countDocuments(),
        completions: await comps.countDocuments(),
        sessioni: await sessions.countDocuments(),
        timbri: await stamps.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    const hikeIdsCreati = [];

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
        const idA = elenco[0].id;
        const cookieA = await loginDemo(idA);
        console.log(`     (A = ${elenco[0].username})`);

        // Un hike completato da A, SENZA traccia collegata (come "Alba Corno Grande").
        async function creaHikeCompletato(suffisso) {
            const h = await hikes.insertOne({
                title: MARCA + ' ' + suffisso, description: 'x', difficulty: 'Esperto', date: '2026-08-01',
                creatorId: oid(idA), participants: [oid(idA)], pendingApproval: [],
                distanceKm: 10, elevationGain: 900, maxAltitude: 2912,
                location: { type: 'Point', coordinates: [13.5644, 42.4686] },
                trailhead: { lat: 42.4686, lng: 13.5644, name: MARCA }
            });
            hikeIdsCreati.push(h.insertedId);
            const c = await comps.insertOne({ userId: oid(idA), hikeId: h.insertedId, dateCompleted: new Date('2026-08-02') });
            return { HID: h.insertedId.toString(), CID: c.insertedId.toString() };
        }

        // === 1. Il ⬆ aggiorna gli orari E crea la sessione collegata ===
        console.log('\n1. POST /api/completions/:id/gpx: aggiorna gli orari E salva la traccia come sessione');
        const { HID, CID } = await creaHikeCompletato('escursione');
        ok('setup: 0 sessioni collegate a questo hike prima del .gpx', await sessions.countDocuments({ hikeId: oid(HID) }) === 0);

        const up = await chiama('POST', `/api/completions/${CID}/gpx`, { gpxText: gpx(MARCA + '-t1', '2026-08-02') }, cookieA);
        ok('POST /:id/gpx -> 200', up.status === 200, JSON.stringify(up.corpo && up.corpo.error));
        const comp = up.corpo && up.corpo.completion;
        ok('Completion: actualTimeHours e movingTimeHours valorizzati', comp && comp.actualTimeHours > 0 && comp.movingTimeHours > 0);

        const sess = await sessions.find({ hikeId: oid(HID) }).toArray();
        ok('esattamente 1 ActiveHikeSession collegata al hike', sess.length === 1, `trovate ${sess.length}`);
        const S = sess[0];
        ok('sessione: userId = A, status ended, importedFrom gpx', S && String(S.userId) === idA && S.status === 'ended' && S.importedFrom === 'gpx');
        ok('sessione: points salvati (>= 2)', S && Array.isArray(S.points) && S.points.length >= 2, S && S.points && `${S.points.length} punti`);
        ok('sessione: movingTimeSec misurato (> 0)', S && S.movingTimeSec > 0);
        ok('sessione: distanceKm > 0', S && S.distanceKm > 0);
        ok('sessione: NIENTE openSession (traccia gia\' conclusa)', S && S.openSession === undefined);
        ok('sessione: NON pubblicata di default', S && S.publishedAt === undefined);

        // === 2. La sessione e' pubblicabile ===
        console.log('\n2. L\'escursione completata e\' ora pubblicabile nel feed');
        const SID = S._id.toString();
        const pub = await chiama('POST', `/api/tracking/sessions/${SID}/publish`, { caption: MARCA }, cookieA);
        ok('POST /sessions/:id/publish -> 200', pub.status === 200, `status ${pub.status}`);
        const Sdopo = await sessions.findOne({ _id: S._id });
        ok('publishedAt sul DB dopo publish', Sdopo.publishedAt instanceof Date);
        ok('caption salvata', Sdopo.caption === MARCA);

        // === 3. Ricaricamento: stesso documento, geometria sostituita, publishedAt tenuto ===
        console.log('\n3. Ri-upload del .gpx: aggiorna lo STESSO documento, conserva publishedAt/caption');
        const up2 = await chiama('POST', `/api/completions/${CID}/gpx`, { gpxText: gpx(MARCA + '-t2', '2026-08-02') }, cookieA);
        ok('ri-upload -> 200', up2.status === 200, `status ${up2.status}`);
        const sess2 = await sessions.find({ hikeId: oid(HID) }).toArray();
        ok('sempre 1 sola sessione (nessun doppione)', sess2.length === 1, `trovate ${sess2.length}`);
        ok('e\' lo STESSO documento (stesso _id)', String(sess2[0]._id) === SID);
        ok('publishedAt CONSERVATO dopo il ri-upload', sess2[0].publishedAt instanceof Date);
        ok('caption CONSERVATA dopo il ri-upload', sess2[0].caption === MARCA);
        ok('importedName aggiornato al nuovo file', sess2[0].importedName === (MARCA + '-t2'), sess2[0].importedName);

        // === 4. Una sessione REGISTRATA DAL VIVO non viene toccata dal ⬆ ===
        console.log('\n4. Il ⬆ NON tocca una sessione registrata dal vivo (importedFrom assente)');
        const { HID: HID2, CID: CID2 } = await creaHikeCompletato('registrata');
        const viva = await sessions.insertOne({
            userId: oid(idA), hikeId: oid(HID2), status: 'ended',
            startedAt: new Date('2026-08-02T05:00:00Z'), endedAt: new Date('2026-08-02T12:00:00Z'), lastPointAt: new Date('2026-08-02T12:00:00Z'),
            distanceKm: 11.5, elevationGainM: 950, points: [[13.56, 42.46, 1500, 0, 5], [13.57, 42.47, 1900, 3600, 5]], movingTimeSec: 20000
        });
        const up3 = await chiama('POST', `/api/completions/${CID2}/gpx`, { gpxText: gpx(MARCA + '-t3', '2026-08-02') }, cookieA);
        ok('POST /:id/gpx su un hike con sessione dal vivo -> 200', up3.status === 200);
        const sessViva = await sessions.find({ hikeId: oid(HID2) }).toArray();
        ok('sempre 1 sola sessione (non ne crea una seconda)', sessViva.length === 1, `trovate ${sessViva.length}`);
        ok('e\' quella dal vivo, INTATTA (importedFrom ancora assente, distanceKm 11.5)',
            sessViva[0].importedFrom === undefined && sessViva[0].distanceKm === 11.5,
            JSON.stringify({ imp: sessViva[0].importedFrom, d: sessViva[0].distanceKm }));

        // === 5. Il tetto mensile delle importazioni non conta le sessioni con hikeId ===
        console.log('\n5. /import-gpx: il tetto conta solo hikeId:null');
        const inizioMese = new Date(); inizioMese.setDate(1); inizioMese.setHours(0, 0, 0, 0);
        const sogliaId = mongoose.Types.ObjectId.createFromTime(Math.floor(inizioMese.getTime() / 1000));
        const conFiltro = await sessions.countDocuments({ userId: oid(idA), importedFrom: 'gpx', hikeId: null, _id: { $gte: sogliaId } });
        const senzaFiltro = await sessions.countDocuments({ userId: oid(idA), importedFrom: 'gpx', _id: { $gte: sogliaId } });
        ok('la sessione collegata (hikeId != null) resta fuori dal conteggio del tetto',
            senzaFiltro - conFiltro >= 1, JSON.stringify({ con: conFiltro, senza: senzaFiltro }));

        // === 6. Punto 115: nome della traccia collegata ===
        console.log('\n6. Punto 115: il .fit senza <name> ripiega sul titolo dell\'escursione; la matita e il ri-upload');
        const { HID: HID3, CID: CID3 } = await creaHikeCompletato('punto115');
        const titoloHike = MARCA + ' punto115';

        // 6a - .gpx SENZA <name> (come un .fit) -> importedName = titolo dell'escursione
        const u6a = await chiama('POST', `/api/completions/${CID3}/gpx`, { gpxText: gpxSenzaNome('2026-08-03') }, cookieA);
        ok('6a  POST /:id/gpx senza <name> -> 200', u6a.status === 200, JSON.stringify(u6a.corpo && u6a.corpo.error));
        let S6 = await sessions.findOne({ hikeId: oid(HID3) });
        ok('6a  importedName = titolo dell\'escursione (niente data nuda nel feed)',
            S6 && S6.importedName === titoloHike, S6 && S6.importedName);

        // 6b - rinomina con la matita (PATCH /name)
        const u6b = await chiama('PATCH', `/api/tracking/sessions/${S6._id}/name`, { name: MARCA + ' Nome a mano' }, cookieA);
        ok('6b  PATCH /name -> 200', u6b.status === 200, `status ${u6b.status}`);
        S6 = await sessions.findOne({ _id: S6._id });
        ok('6b  importedName aggiornato al nome scelto', S6.importedName === MARCA + ' Nome a mano', S6.importedName);

        // 6c - ri-upload di un .gpx SENZA <name>: il nome scelto a mano NON viene toccato
        const u6c = await chiama('POST', `/api/completions/${CID3}/gpx`, { gpxText: gpxSenzaNome('2026-08-03') }, cookieA);
        ok('6c  ri-upload senza <name> -> 200', u6c.status === 200);
        S6 = await sessions.findOne({ _id: S6._id });
        ok('6c  il nome messo a mano e\' RIMASTO (ri-upload senza nome non lo tocca)',
            S6.importedName === MARCA + ' Nome a mano', S6.importedName);

        // 6d - ri-upload di un .gpx CON <name>: quello vince (l'utente sta ricaricando quella traccia)
        const u6d = await chiama('POST', `/api/completions/${CID3}/gpx`, { gpxText: gpx(MARCA + ' dal file', '2026-08-03') }, cookieA);
        ok('6d  ri-upload con <name> -> 200', u6d.status === 200);
        S6 = await sessions.findOne({ _id: S6._id });
        ok('6d  il <name> del nuovo file vince sul nome vecchio', S6.importedName === MARCA + ' dal file', S6.importedName);

        // === 7. Coda punto 113 (2026-08-31): il ⬆ assegna i badge di vetta come /import-gpx ===
        console.log('\n7. Il .gpx del ⬆ assegna i badge di vetta (assegnaTimbriDallaTraccia spostata in lib/geofenceTimbri.js)');
        const stampProva = MARCA + '-cima';
        // Una vetta di prova ESATTAMENTE sul primo punto del gpx sintetico (42.4686 /
        // 13.5644): puntiTimbrabili() la raccoglie dai `peaks` degli hike sul DB, e nessun
        // account reale ha questo stampId - cosi' la prova non dipende da quali badge ha
        // gia' il demo e non sfiora nessun timbro vero.
        const h7 = await hikes.insertOne({
            title: MARCA + ' cima', description: 'x', difficulty: 'Esperto', date: '2026-08-01',
            creatorId: oid(idA), participants: [oid(idA)], pendingApproval: [],
            distanceKm: 10, elevationGain: 900, maxAltitude: 2912,
            location: { type: 'Point', coordinates: [13.5644, 42.4686] },
            trailhead: { lat: 42.4686, lng: 13.5644, name: MARCA },
            peaks: [{ stampId: stampProva, name: MARCA + ' Cima di prova', lat: 42.4686, lng: 13.5644 }]
        });
        hikeIdsCreati.push(h7.insertedId);
        const c7 = await comps.insertOne({ userId: oid(idA), hikeId: h7.insertedId, dateCompleted: new Date('2026-08-02') });
        const CID7 = c7.insertedId.toString();

        ok('7  setup: A non ha ancora il timbro di prova',
            await stamps.countDocuments({ userId: oid(idA), stampId: stampProva }) === 0);

        const u7 = await chiama('POST', `/api/completions/${CID7}/gpx`, { gpxText: gpx(MARCA + '-cima', '2026-08-02') }, cookieA);
        ok('7  POST /:id/gpx -> 200', u7.status === 200, JSON.stringify(u7.corpo && u7.corpo.error));
        ok('7  la risposta porta il badge nuovo nel campo "badge"',
            Array.isArray(u7.corpo && u7.corpo.badge) && u7.corpo.badge.some(b => b.stampId === stampProva),
            JSON.stringify(u7.corpo && u7.corpo.badge));
        ok('7  il timbro e\' sul DB con la data dell\'ESCURSIONE (2026-08-02, non quella del caricamento)',
            await stamps.countDocuments({ userId: oid(idA), stampId: stampProva, dateUnlocked: '2026-08-02' }) === 1);

        // 7b - ri-upload: nessun badge NUOVO (gia' preso), nessun doppione
        const u7b = await chiama('POST', `/api/completions/${CID7}/gpx`, { gpxText: gpx(MARCA + '-cima2', '2026-08-02') }, cookieA);
        ok('7b  ri-upload -> 200', u7b.status === 200);
        ok('7b  nessun badge NUOVO nella risposta (era gia\' preso)',
            Array.isArray(u7b.corpo && u7b.corpo.badge) && u7b.corpo.badge.length === 0,
            JSON.stringify(u7b.corpo && u7b.corpo.badge));
        ok('7b  sempre 1 solo timbro (nessun doppione)',
            await stamps.countDocuments({ userId: oid(idA), stampId: stampProva }) === 1);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + e.message);
    } finally {
        if (server) server.kill();
        for (const hid of hikeIdsCreati) {
            await sessions.deleteMany({ hikeId: hid }).catch(() => {});
            await comps.deleteMany({ hikeId: hid }).catch(() => {});
            await hikes.deleteOne({ _id: hid }).catch(() => {});
        }
        await sessions.deleteMany({ importedName: new RegExp('^' + MARCA) }).catch(() => {});
        // Sez. 7: il timbro nasce con stampId marcato (MARCA), nessun dato vero combacia.
        await stamps.deleteMany({ stampId: new RegExp('^' + MARCA) }).catch(() => {});

        const fine = {
            hikes: await hikes.countDocuments(),
            completions: await comps.countDocuments(),
            sessioni: await sessions.countDocuments(),
            timbri: await stamps.countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessuna escursione di prova rimasta', fine.hikes === partenza.hikes, `${partenza.hikes} -> ${fine.hikes}`);
        ok('nessun completamento di prova rimasto', fine.completions === partenza.completions, `${partenza.completions} -> ${fine.completions}`);
        ok('nessuna sessione di prova rimasta', fine.sessioni === partenza.sessioni, `${partenza.sessioni} -> ${fine.sessioni}`);
        ok('nessun timbro di prova rimasto', fine.timbri === partenza.timbri, `${partenza.timbri} -> ${fine.timbri}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
