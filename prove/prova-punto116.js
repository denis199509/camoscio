// PROVA DEL PUNTO 116: la traccia importata in creazione escursione (.gpx / .fit) si
// salva anche come polyline sull'Hike (campo routePath), per disegnarla come linea sulla
// mappa (Esplora + mini-mappa nel tab Dettagli di hike-page).
//
// Prima di questo punto:
//  - il modulo di creazione importava solo .gpx (niente .fit), e models/Hike.js aveva
//    l'enum routeSource.kind = ['draft','gpx','saved'] SENZA 'fit' -> un routeSource
//    kind:'fit' calcolava bene ma non si salvava (ValidationError -> 400 generico);
//  - risolviPercorso (lib/percorso.js) SCARTAVA la geometria: sull'escursione restavano
//    solo i tre numeri + l'etichetta, nessuna linea da disegnare.
//
// Si controlla che:
//  - POST /api/hikes con routeSource kind:'gpx' -> 200 e l'escursione ha routePath
//    ([[lng,lat],...], 2..MAX_PUNTI_PERCORSO punti), semplificato (molto piu' corto dei
//    <trkpt> di partenza), + i tre numeri calcolati;
//  - lo stesso con kind:'fit' (REGRESSIONE dell'enum) -> 200 e routePath salvato;
//  - kind:'saved' (percorso copiato da una traccia): routePath copiato dal SavedRoute,
//    gia' semplificato e capato alla sua creazione;
//  - una traccia fuori dalle 4 regioni -> 400, nessuna escursione creata;
//  - PUT routeSource:null -> routePath tolto ($unset);
//  - PUT numeri a mano dal creatore su un'escursione con traccia -> routeSource E routePath
//    tolti insieme;
//  - calcolaDaPercorso/risolviPercorso direttamente: routePath c'e' per gpx/fit, e' capato
//    a MAX_PUNTI_PERCORSO su una traccia fittissima, e risolviPercorso NON lascia colare
//    gpxLetto verso Hike.create/update.
//
// CONTROPROVA: sullo stesso test col codice PRIMA del punto 116, la sez. 2 (fit) va in 400
// (enum) e le sez. 1/2/6 non trovano routePath (risolviPercorso lo scartava).
//
// Lanciarla:  node prove/prova-punto116.js   (avvia un server suo sulla 3116)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { FitEncoder, FitBaseType } = require('fit-file-parser');
const { calcolaDaPercorso, risolviPercorso, MAX_PUNTI_PERCORSO } = require('../lib/percorso');

const PORTA = 3116;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-116-' + Date.now();

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

// --- Costruttori di tracce di prova -----------------------------------------------------

// GPX a 5 tratti RETTILINEI uniti da svolte nette (~120 <trkpt>), sul Gran Sasso (Abruzzo).
// I tratti dritti collassano a 2 punti sotto Douglas-Peucker: routePath deve risultare
// molto piu' corto dei 120 punti di partenza. Quota in salita monotona (dislivello > 0).
function gpxRettilinei(nome, giorno, opts = {}) {
    const dLat = opts.dLat || 0, dLng = opts.dLng || 0; // per spostare la traccia fuori regione
    const t0 = new Date(giorno + 'T06:00:00Z').getTime();
    const svolte = [
        [42.440, 13.550], [42.460, 13.575], [42.450, 13.605],
        [42.472, 13.628], [42.492, 13.606], [42.502, 13.640]
    ].map(([la, ln]) => [la + dLat, ln + dLng]);
    const pts = [];
    let k = 0;
    for (let s = 0; s < svolte.length - 1; s++) {
        const [la0, ln0] = svolte[s], [la1, ln1] = svolte[s + 1];
        for (let i = 0; i < 24; i++) {
            const f = i / 24;
            const lat = la0 + (la1 - la0) * f;
            const lng = ln0 + (ln1 - ln0) * f;
            pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${1400 + k * 7}</ele><time>${new Date(t0 + k * 60000).toISOString()}</time></trkpt>`);
            k++;
        }
    }
    return { xml: `<?xml version="1.0"?><gpx version="1.1" creator="prova"><trk><name>${nome}</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`, nTrkpt: k };
}

// GPX FITTISSIMO e a zig-zag largo (> 18 m di ampiezza): quasi nessun punto cade con
// Douglas-Peucker, quindi n punti > MAX_PUNTI_PERCORSO -> deve scattare il campionamento
// a passo fisso. Serve solo per la sez. 7 (chiamata diretta, niente HTTP).
function gpxZigzag(n, giorno) {
    const t0 = new Date(giorno + 'T06:00:00Z').getTime();
    let lat = 42.440, lng = 13.550;
    const pts = [];
    for (let i = 0; i < n; i++) {
        lat += (i % 2 ? 1 : -1) * 0.00045 + 0.00002;
        lng += (i % 3 ? 1 : -1) * 0.00045 + 0.00002;
        pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><ele>${1500 + (i % 50)}</ele><time>${new Date(t0 + i * 2000).toISOString()}</time></trkpt>`);
    }
    return `<?xml version="1.0"?><gpx version="1.1" creator="prova"><trk><name>zig</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

// .fit sintetico: camminata DRITTA (tutti stessa lat, lng crescente), 1 punto/s, con quota.
// Una retta collassa a 2 punti: routePath deve essere piccolissimo. Parte da Campo
// Imperatore (Abruzzo). Costruito col FitEncoder della stessa libreria (come prova-fit.js).
const T0_FIT = new Date('2026-08-02T06:00:00Z');
const SC = Math.pow(2, 31) / 180;
function encodeFitDritto(nPunti) {
    const LAT0 = 42.44, LNG0 = 13.55;
    const mPerDegLng = 111320 * Math.cos(LAT0 * Math.PI / 180);
    const passoLng = 1.1 / mPerDegLng;
    const enc = new FitEncoder();
    enc.writeMessage(0, [
        { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
        { number: 4, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(T0_FIT) }
    ]);
    for (let i = 0; i < nPunti; i++) {
        enc.writeMessage(20, [
            { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(T0_FIT.getTime() + i * 1000)) },
            { number: 0, size: 4, baseType: FitBaseType.Sint32, value: Math.round(LAT0 * SC) },
            { number: 1, size: 4, baseType: FitBaseType.Sint32, value: Math.round((LNG0 + i * passoLng) * SC) },
            { number: 2, size: 2, baseType: FitBaseType.Uint16, value: Math.round((2000 + i / 10 + 500) * 5) }
        ]);
    }
    return Buffer.from(enc.close()).toString('base64');
}

// --- Asserzioni comuni sulla forma di routePath ---------------------------------------
function routePathValido(rp) {
    return Array.isArray(rp) && rp.length >= 2 && rp.length <= MAX_PUNTI_PERCORSO &&
        rp.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
            p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90);
}

const TRAILHEAD = { lat: 42.4686, lng: 13.5644, name: MARCA }; // Gran Sasso, Abruzzo

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const hikes = mongoose.connection.collection('hikes');
    const savedRoutes = mongoose.connection.collection('savedroutes');
    const oid = s => new mongoose.Types.ObjectId(s);
    const partenza = { hikes: await hikes.countDocuments(), savedRoutes: await savedRoutes.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    const hikeIdsCreati = [];
    const savedRouteIdsCreati = [];

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
        console.log(`     (A = ${elenco[0].username})\n`);

        // === 1. POST /api/hikes con routeSource kind:'gpx' ===
        console.log('1. POST /api/hikes con una traccia .gpx: routePath salvato e semplificato');
        const g1 = gpxRettilinei(MARCA + '-gpx', '2026-08-02');
        const r1 = await chiama('POST', '/api/hikes', {
            title: MARCA + ' gpx', difficulty: 'Esperto', date: '2026-09-20',
            trailhead: TRAILHEAD, routeSource: { kind: 'gpx', gpxText: g1.xml }
        }, cookieA);
        ok('POST -> 200', r1.status === 200, JSON.stringify(r1.corpo && r1.corpo.error));
        const h1 = r1.corpo || {};
        if (h1.id) hikeIdsCreati.push(oid(h1.id));
        ok('routeSource.kind = gpx', h1.routeSource && h1.routeSource.kind === 'gpx', JSON.stringify(h1.routeSource));
        ok('routeSource.nome = <name> del file', h1.routeSource && h1.routeSource.nome === MARCA + '-gpx', h1.routeSource && h1.routeSource.nome);
        ok('routePath valido ([[lng,lat]], 2..' + MAX_PUNTI_PERCORSO + ')', routePathValido(h1.routePath), JSON.stringify(h1.routePath && h1.routePath.slice(0, 2)));
        ok(`routePath semplificato: ${h1.routePath && h1.routePath.length} punti << ${g1.nTrkpt} <trkpt>`,
            h1.routePath && h1.routePath.length >= 2 && h1.routePath.length < g1.nTrkpt / 3, `${h1.routePath && h1.routePath.length} vs ${g1.nTrkpt}`);
        ok('i tre numeri calcolati (maxAltitude/elevationGain/distanceKm)',
            Number.isFinite(h1.maxAltitude) && Number.isFinite(h1.elevationGain) && Number.isFinite(h1.distanceKm) && h1.elevationGain > 0 && h1.distanceKm > 0,
            JSON.stringify({ m: h1.maxAltitude, d: h1.elevationGain, k: h1.distanceKm }));
        const h1db = await hikes.findOne({ _id: oid(h1.id) });
        ok('routePath PERSISTITO sul DB (stessa lunghezza)', h1db && Array.isArray(h1db.routePath) && h1db.routePath.length === h1.routePath.length);
        ok('routePath sul DB e\' [lng,lat] a 2 numeri', h1db && h1db.routePath.every(p => Array.isArray(p) && p.length === 2));

        // === 2. POST /api/hikes con routeSource kind:'fit' (REGRESSIONE enum) ===
        console.log('\n2. POST /api/hikes con una traccia .fit: enum accetta \'fit\', routePath salvato');
        const r2 = await chiama('POST', '/api/hikes', {
            title: MARCA + ' fit', difficulty: 'Intermedio', date: '2026-09-21',
            trailhead: TRAILHEAD, routeSource: { kind: 'fit', fitBase64: encodeFitDritto(600) }
        }, cookieA);
        ok('POST -> 200 (prima del punto 116 era 400: enum senza \'fit\')', r2.status === 200, JSON.stringify(r2.corpo && r2.corpo.error));
        const h2 = r2.corpo || {};
        if (h2.id) hikeIdsCreati.push(oid(h2.id));
        ok('routeSource.kind = fit', h2.routeSource && h2.routeSource.kind === 'fit', JSON.stringify(h2.routeSource));
        ok('routeSource.nome = "Traccia importata" (il .fit non porta un nome)', h2.routeSource && h2.routeSource.nome === 'Traccia importata', h2.routeSource && h2.routeSource.nome);
        ok('routePath valido', routePathValido(h2.routePath), JSON.stringify(h2.routePath));
        ok('routePath di una retta e\' minimo (<= 5 punti)', h2.routePath && h2.routePath.length >= 2 && h2.routePath.length <= 5, `${h2.routePath && h2.routePath.length} punti`);
        const h2db = await hikes.findOne({ _id: oid(h2.id) });
        ok('routePath persistito sul DB', h2db && Array.isArray(h2db.routePath) && h2db.routePath.length >= 2);
        ok('routeSource.kind = fit salvato sul DB (enum lo accetta)', h2db && h2db.routeSource && h2db.routeSource.kind === 'fit');

        // === 3. Traccia fuori dalle 4 regioni -> rifiutata, nessuna escursione creata ===
        console.log('\n3. Traccia fuori regione: POST -> 400, niente escursione');
        const nPrima = await hikes.countDocuments();
        const gFuori = gpxRettilinei('fuori', '2026-08-02', { dLat: 4.0, dLng: -5.0 }); // ~46.4 N, ~8.5 E
        const r3 = await chiama('POST', '/api/hikes', {
            title: MARCA + ' fuori', difficulty: 'Esperto', date: '2026-09-22',
            trailhead: TRAILHEAD, routeSource: { kind: 'gpx', gpxText: gFuori.xml }
        }, cookieA);
        ok('POST -> 400', r3.status === 400, `status ${r3.status}`);
        ok('errore parla di regioni', r3.corpo && /region/i.test(r3.corpo.error || ''), r3.corpo && r3.corpo.error);
        ok('nessuna escursione creata', await hikes.countDocuments() === nPrima);

        // === 4. PUT routeSource:null -> routePath tolto ===
        console.log('\n4. PUT routeSource:null sull\'escursione .gpx -> routePath $unset');
        const r4 = await chiama('PUT', `/api/hikes/${h1.id}`, { routeSource: null }, cookieA);
        ok('PUT -> 200', r4.status === 200, JSON.stringify(r4.corpo && r4.corpo.error));
        const h1dopo = await hikes.findOne({ _id: oid(h1.id) });
        ok('routePath rimosso dal DB', h1dopo && h1dopo.routePath === undefined, JSON.stringify(h1dopo && h1dopo.routePath));
        ok('routeSource rimosso dal DB', h1dopo && (h1dopo.routeSource === undefined || h1dopo.routeSource === null));

        // === 5. PUT numeri a mano dal creatore -> routeSource E routePath tolti insieme ===
        console.log('\n5. PUT numeri a mano dal creatore sull\'escursione .fit -> routeSource + routePath via');
        const r5 = await chiama('PUT', `/api/hikes/${h2.id}`, { maxAltitude: 1990, elevationGain: 810, distanceKm: 12.3 }, cookieA);
        ok('PUT -> 200', r5.status === 200, JSON.stringify(r5.corpo && r5.corpo.error));
        const h2dopo = await hikes.findOne({ _id: oid(h2.id) });
        ok('routeSource rimosso', h2dopo && (h2dopo.routeSource === undefined || h2dopo.routeSource === null));
        ok('routePath rimosso', h2dopo && h2dopo.routePath === undefined, JSON.stringify(h2dopo && h2dopo.routePath));
        ok('i numeri a mano sono stati scritti', h2dopo && h2dopo.maxAltitude === 1990 && h2dopo.elevationGain === 810);

        // === 6. routeSource kind:'saved' (percorso copiato da una traccia): la linea
        //        arriva dal SavedRoute, gia' semplificata e capata alla sua creazione ===
        console.log('\n6. POST /api/hikes con routeSource kind:\'saved\': routePath copiato dal SavedRoute');
        const puntiSalvati = [
            [13.550, 42.440], [13.560, 42.450], [13.558, 42.462],
            [13.572, 42.470], [13.590, 42.468], [13.601, 42.480]
        ];
        const sr = await savedRoutes.insertOne({
            userId: oid(idA), nome: MARCA + '-saved', punti: puntiSalvati,
            distanzaKm: 9.4, dislivelloM: 620, quotaMaxM: 2010, creatoIl: new Date()
        });
        savedRouteIdsCreati.push(sr.insertedId);
        const r6s = await chiama('POST', '/api/hikes', {
            title: MARCA + ' saved', difficulty: 'Intermedio', date: '2026-09-23',
            trailhead: TRAILHEAD, routeSource: { kind: 'saved', savedRouteId: sr.insertedId.toString() }
        }, cookieA);
        ok('POST -> 200', r6s.status === 200, JSON.stringify(r6s.corpo && r6s.corpo.error));
        const h6 = r6s.corpo || {};
        if (h6.id) hikeIdsCreati.push(oid(h6.id));
        ok('routeSource.kind = saved', h6.routeSource && h6.routeSource.kind === 'saved');
        ok('routePath valido', routePathValido(h6.routePath), JSON.stringify(h6.routePath));
        ok('routePath = i punti del SavedRoute (stessa lunghezza, stesso primo/ultimo)',
            h6.routePath && h6.routePath.length === puntiSalvati.length &&
            h6.routePath[0][0] === puntiSalvati[0][0] && h6.routePath[0][1] === puntiSalvati[0][1] &&
            h6.routePath[5][0] === puntiSalvati[5][0] && h6.routePath[5][1] === puntiSalvati[5][1],
            JSON.stringify(h6.routePath && [h6.routePath[0], h6.routePath[h6.routePath.length - 1]]));
        ok('i tre numeri vengono dal SavedRoute', h6.maxAltitude === 2010 && h6.elevationGain === 620 && h6.distanceKm === 9.4,
            JSON.stringify({ m: h6.maxAltitude, d: h6.elevationGain, k: h6.distanceKm }));
        const h6db = await hikes.findOne({ _id: oid(h6.id) });
        ok('routePath persistito sul DB', h6db && Array.isArray(h6db.routePath) && h6db.routePath.length === puntiSalvati.length);

        // === 7. calcolaDaPercorso / risolviPercorso direttamente ===
        console.log('\n7. calcolaDaPercorso / risolviPercorso: routePath per gpx/fit, capato, niente gpxLetto in risolviPercorso');
        const uid = new mongoose.Types.ObjectId();
        const d6gpx = await calcolaDaPercorso({ kind: 'gpx', gpxText: gpxRettilinei('u', '2026-08-02').xml }, uid);
        ok('calcolaDaPercorso(gpx): routePath valido', routePathValido(d6gpx.routePath));
        ok('calcolaDaPercorso(gpx): gpxLetto ancora presente qui (contratto interno)', !!d6gpx.gpxLetto);

        const d6fit = await calcolaDaPercorso({ kind: 'fit', fitBase64: encodeFitDritto(400) }, uid);
        ok('calcolaDaPercorso(fit): routePath valido', routePathValido(d6fit.routePath));

        const d6cap = await calcolaDaPercorso({ kind: 'gpx', gpxText: gpxZigzag(3000, '2026-08-02') }, uid);
        ok(`traccia da 3000 punti -> routePath capato a <= ${MAX_PUNTI_PERCORSO} (${d6cap.routePath.length})`,
            d6cap.routePath.length <= MAX_PUNTI_PERCORSO && d6cap.routePath.length >= 2);
        ok('la traccia fittissima NON e\' collassata a 2 punti (il cap ha lavorato, non il DP)', d6cap.routePath.length > 50, `${d6cap.routePath.length} punti`);

        const r6 = await risolviPercorso({ kind: 'gpx', gpxText: gpxRettilinei('u2', '2026-08-02').xml }, uid);
        ok('risolviPercorso(gpx): ok', r6.ok === true);
        ok('risolviPercorso(gpx): dati.routePath presente', r6.ok && routePathValido(r6.dati.routePath));
        ok('risolviPercorso NON fa colare gpxLetto verso Hike.create/update',
            r6.ok && !('gpxLetto' in r6.dati) &&
            Object.keys(r6.dati).sort().join(',') === 'distanceKm,elevationGain,maxAltitude,routePath,routeSource',
            r6.ok && Object.keys(r6.dati).join(','));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++; fallimenti.push('eccezione non gestita: ' + e.message);
    } finally {
        // Pulizia: solo la roba di QUESTA prova, filtrata per marca + creatore demo.
        if (hikeIdsCreati.length) await hikes.deleteMany({ _id: { $in: hikeIdsCreati } });
        await hikes.deleteMany({ title: { $regex: '^' + MARCA } });
        if (savedRouteIdsCreati.length) await savedRoutes.deleteMany({ _id: { $in: savedRouteIdsCreati } });
        await savedRoutes.deleteMany({ nome: { $regex: '^' + MARCA } });
        const fine = { hikes: await hikes.countDocuments(), savedRoutes: await savedRoutes.countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessuna escursione di prova lasciata sul DB', fine.hikes === partenza.hikes, JSON.stringify({ partenza, fine }));
        ok('nessun percorso salvato di prova lasciato sul DB', fine.savedRoutes === partenza.savedRoutes, JSON.stringify({ partenza, fine }));
        if (server) server.kill();
        await mongoose.disconnect();
    }

    console.log(`\n==== ${passati} ok, ${falliti} falliti ====`);
    if (falliti) { console.log('Falliti:', fallimenti); process.exit(1); }
})();
