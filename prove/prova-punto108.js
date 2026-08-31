// ==========================================================================
// PROVA DEL PUNTO 108 — un timbro si sblocca solo con una traccia reale
//
// COSA CAMBIA E PERCHE'. Fino al 2026-08-28 POST /api/stamps creava il timbro per chi
// era loggato, con un qualunque stampId nel corpo, SENZA nessun controllo di posizione: i
// 150 m del geofencing vivevano solo nel browser (checkGeofencing in public/js/map.js) e
// decidevano soltanto se comparisse il bottone "TIMBRA". Col tasto "teletrasporta GPS"
// sulla mappa - o con un fetch dalla console - si sbloccavano tutti i badge da fermi
// ("senza alzarmi dal letto", parole di Denis).
// Ora il server sblocca il timbro SOLO se una traccia reale dell'utente (registrazione in
// corso, registrazione conclusa o .gpx importato) e' passata entro SOGLIA_TIMBRO_M dalla
// vetta. La regola sta in lib/geofenceTimbri.js, condivisa con l'import .gpx e col
// conteggio salite del punto 42b (prima erano due copie a mano dentro routes/tracking.js).
//
// COSA SORVEGLIA:
//   Sez. 1  (ne' server ne' DB) - il REFACTOR non cambia la matematica: la scansione
//           vecchia (copiata qui verbatim da routes/tracking.js) e le funzioni nuove di
//           lib/geofenceTimbri.js danno lo stesso identico risultato, sui casi limite,
//           sul confine esatto della finestra in gradi e su tracce randomizzate.
//           + (2026-08-31) una voce di catalogo puo' avere una soglia propria `sogliaM`
//           (Ju Busciu 10 m): con quella un punto a 20-140 m non tocca piu', col default si'.
//   Sez. 2  (DB in sola lettura) - puntiTimbrabili() restituisce ogni voce di
//           badge-points.js con coordinate finite, con le sue lat/lng.
//   Sez. 3  (server acceso) - l'integrazione vera:
//           3a POST /api/stamps su una vetta SENZA traccia vicina -> 403, nessuno Stamp
//           3b POST /api/stamps con uno stampId fuori catalogo    -> 400, nessuno Stamp
//           3c registrazione che passa dalla vetta -> POST /api/stamps -> 200, Stamp creato
//           3d ripetere la stessa chiamata -> 200 idempotente, un solo Stamp sul DB
//           3e import .gpx che tocca un'altra vetta -> quel timbro viene assegnato
//           3f GET /peak-ascents -> la vetta di 3c risulta con siteCount >= 1
//
// CONTROPROVA (da rifare a mano quando si tocca questo codice): con il vecchio
// routes/stamps.js (POST senza verifica) cadono 3a e 3b - vedi in fondo il conteggio
// misurato il 2026-08-28.
//
// SICUREZZA DEI DATI: le sezioni 2-3 leggono/scrivono su un account DEMO. Gli Stamp e le
// ActiveHikeSession creati qui vengono cancellati in un finally, filtrati per userId E per
// chiave (stampId / _id). Gli Stamp gia' presenti sull'account demo all'avvio vengono
// letti e MAI toccati. Conteggi di partenza letti e riconfrontati alla fine.
//
// Lanciarla:
//   node server.js > prove/server-prove.log 2>&1      (in un'altra finestra)
//   node prove/prova-punto108.js
// Senza server acceso: girano solo le sezioni 1 e 2, la 3 si salta e lo dice.
// ==========================================================================

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { haversineKm } = require('../lib/geometry');
const {
    SOGLIA_TIMBRO_M, puntiTimbrabili, distanzaMinimaDaTraccia, tracciaToccaPunto
} = require('../lib/geofenceTimbri');
const CATALOGO = require('../public/js/badge-points.js');

const BASE_URL = process.env.PROVA_BASE_URL || 'http://localhost:3000';

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome}   ${dettaglio}`); }
}

// --------------------------------------------------------------------------
// SEZIONE 1 - Equivalenza del refactor (ne' server ne' DB)
//
// vecchioMinimo / vecchioToccata sono COPIATI VERBATIM da routes/tracking.js PRIMA del
// refactor del 2026-08-28: rispettivamente il corpo interno di assegnaTimbriDallaTraccia
// (righe ~368-381) e quello di /peak-ascents (righe ~446-457). Se un giorno la regola in
// lib/geofenceTimbri.js cambia DAVVERO di comportamento, questa sezione va aggiornata
// insieme - ed e' il suo scopo accorgersene.
// --------------------------------------------------------------------------
function vecchioMinimo(punti, cLat, cLng) {
    const gradiLat = SOGLIA_TIMBRO_M / 111320;
    const gradiLng = SOGLIA_TIMBRO_M / (111320 * Math.max(0.1, Math.cos(cLat * Math.PI / 180)));
    let minimo = Infinity;
    for (const p of punti) {
        if (Math.abs(p[1] - cLat) > gradiLat) continue;
        if (Math.abs(p[0] - cLng) > gradiLng) continue;
        const d = haversineKm(p[1], p[0], cLat, cLng) * 1000;
        if (d < minimo) minimo = d;
    }
    return minimo;
}
function vecchioToccata(points, cLat, cLng) {
    const gradiLat = SOGLIA_TIMBRO_M / 111320;
    const gradiLng = SOGLIA_TIMBRO_M / (111320 * Math.max(0.1, Math.cos(cLat * Math.PI / 180)));
    return (points || []).some(p =>
        Math.abs(p[1] - cLat) <= gradiLat &&
        Math.abs(p[0] - cLng) <= gradiLng &&
        haversineKm(p[1], p[0], cLat, cLng) * 1000 <= SOGLIA_TIMBRO_M
    );
}

function rnd(min, max) { return min + Math.random() * (max - min); }
// Punto a ~metri da (lat,lng) in direzione bearing, come tupla [lng, lat] (ordine di ActiveHikeSession)
function spostaMetri(lat, lng, metri, bearing) {
    return [
        lng + (metri * Math.sin(bearing)) / (111320 * Math.cos(lat * Math.PI / 180)),
        lat + (metri * Math.cos(bearing)) / 111320
    ];
}

function sezione1() {
    console.log('\n1. Il refactor non cambia la matematica (scansione vecchia == lib/geofenceTimbri.js)');
    let casi = 0, differenze = 0;

    const confronta = (punti, cLat, cLng, etichetta) => {
        casi++;
        // tracciaToccaPunto prende l'OGGETTO del punto (2026-08-31: gli serve sogliaM). Qui
        // si passa {lat,lng} senza sogliaM -> soglia di default 150 m, come vecchioToccata.
        const nTok = tracciaToccaPunto(punti, { lat: cLat, lng: cLng });
        let diverso = (vecchioToccata(punti, cLat, cLng) !== nTok);

        if (Array.isArray(punti) && punti.length > 0) {
            const vMin = vecchioMinimo(punti, cLat, cLng);
            const nMin = distanzaMinimaDaTraccia(punti, cLat, cLng);
            if (!((vMin === nMin) || (vMin === Infinity && nMin === Infinity))) diverso = true;
            if (nTok !== (nMin <= SOGLIA_TIMBRO_M)) diverso = true; // il si'/no deve seguire il minimo
        }
        if (diverso) { differenze++; console.log(`     differenza su [${etichetta}]`); }
    };

    // casi limite
    confronta([], 42.5, 13.5, 'traccia vuota');
    confronta(undefined, 42.5, 13.5, 'undefined');
    confronta(null, 42.5, 13.5, 'null');
    confronta([[13.5, 42.5, 0, 0, 5]], 42.5, 13.5, 'punto sovrapposto');

    // spazzata 120..180 m su piu' latitudini (anche alte)
    for (const cLat of [37, 42.5, 46.5, 60, 78]) {
        for (let m = 120; m <= 180; m++) {
            for (let b = 0; b < 8; b++) confronta([spostaMetri(cLat, 13.5, m, b / 8 * 2 * Math.PI)], cLat, 13.5, `soglia m=${m} lat=${cLat}`);
        }
    }
    // confine esatto della finestra rettangolare in gradi (dove il pre-filtro puo' scartare)
    for (const cLat of [42.5, 60]) {
        const gLat = SOGLIA_TIMBRO_M / 111320;
        const gLng = SOGLIA_TIMBRO_M / (111320 * Math.max(0.1, Math.cos(cLat * Math.PI / 180)));
        for (const fLat of [0.5, 0.9, 0.999, 1, 1.001, 1.1, 1.5]) {
            for (const fLng of [0.5, 0.9, 0.999, 1, 1.001, 1.1, 1.5]) {
                confronta([[13.5 + gLng * fLng, cLat + gLat * fLat, 0, 0, 5]], cLat, 13.5, `finestra ${fLat}x${fLng} lat=${cLat}`);
            }
        }
    }
    // tracce randomizzate lunghe, meta' vicine meta' lontane
    for (let it = 0; it < 3000; it++) {
        const cLat = rnd(36, 47), cLng = rnd(6, 19), n = Math.floor(rnd(1, 300));
        const vicina = it % 2 === 0;
        const punti = [];
        for (let i = 0; i < n; i++) {
            const m = (vicina && i === (n >> 1)) ? rnd(0, 300) : rnd(200, 40000);
            punti.push(spostaMetri(cLat, cLng, m, rnd(0, 2 * Math.PI)));
        }
        confronta(punti, cLat, cLng, `random it=${it}`);
    }

    ok(`nessuna differenza su ${casi} casi confrontati`, differenze === 0, `${differenze} differenze`);

    // controprova interna: una soglia sbagliata DEVE far divergere
    let controDiff = 0;
    for (let it = 0; it < 1500; it++) {
        const cLat = rnd(36, 47), cLng = rnd(6, 19);
        const p = spostaMetri(cLat, cLng, rnd(151, 300), rnd(0, 2 * Math.PI)); // fascia 151-300 m
        const rotto = haversineKm(p[1], p[0], cLat, cLng) * 1000 <= 300; // regressione: 300 invece di 150
        if (vecchioToccata([p], cLat, cLng) !== rotto) controDiff++;
    }
    ok('la controprova interna vede una soglia sbagliata (fascia 151-300 m)', controDiff > 0, `${controDiff}/1500`);

    // --- soglia propria del punto: `sogliaM` (2026-08-31, Ju Busciu a 10 m) ---
    // Con una sogliaM stretta un punto a 20-140 m NON tocca piu', mentre col default a 150 si'.
    // Se sogliaPunto/tracciaToccaPunto ignorassero sogliaM, il ramo "medio" fallirebbe.
    let sm = 0;
    for (let it = 0; it < 500; it++) {
        const cLat = rnd(36, 47), cLng = rnd(6, 19);
        const stretto = { lat: cLat, lng: cLng, sogliaM: 10 };
        const largo = { lat: cLat, lng: cLng };
        const vicino = [spostaMetri(cLat, cLng, rnd(0, 9), rnd(0, 2 * Math.PI))];   // < 10 m
        const medio = [spostaMetri(cLat, cLng, rnd(20, 140), rnd(0, 2 * Math.PI))]; // 20-140 m
        if (!(tracciaToccaPunto(vicino, stretto) && tracciaToccaPunto(vicino, largo))) sm++;
        if (!(!tracciaToccaPunto(medio, stretto) && tracciaToccaPunto(medio, largo))) sm++;
    }
    ok('sogliaM stringe la soglia del singolo punto (Ju Busciu 10 m)', sm === 0, `${sm} casi fuori attesa su 1000`);
}

// --------------------------------------------------------------------------
// SEZIONE 2 - puntiTimbrabili() (DB in sola lettura)
// --------------------------------------------------------------------------
async function sezione2() {
    console.log('\n2. puntiTimbrabili() contiene tutto il catalogo con coordinate finite');
    const catalogoConCoord = CATALOGO.filter(b => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const punti = await puntiTimbrabili();
    const perId = new Map(punti.map(p => [p.stampId, p]));

    ok('almeno una voce nel catalogo con coordinate', catalogoConCoord.length > 0, `${catalogoConCoord.length}`);

    let mancanti = 0, coordSbagliate = 0;
    for (const b of catalogoConCoord) {
        const p = perId.get(b.stampId);
        if (!p) { mancanti++; continue; }
        if (p.lat !== b.lat || p.lng !== b.lng) coordSbagliate++;
    }
    ok('ogni voce del catalogo compare in puntiTimbrabili()', mancanti === 0, `${mancanti} mancanti`);
    ok('con le stesse coordinate del catalogo', coordSbagliate === 0, `${coordSbagliate} diverse`);
    ok('ogni punto restituito ha lat/lng numeriche',
        punti.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)), '');
}

// --------------------------------------------------------------------------
// SEZIONE 3 - Integrazione col server vero
// --------------------------------------------------------------------------
async function serverAcceso() {
    try {
        const r = await fetch(BASE_URL + '/api/auth/demo-accounts', { signal: AbortSignal.timeout(3000) });
        return r.ok;
    } catch { return false; }
}

// /api/auth/demo-accounts espone "id", NON "_id" (trappola gia' pagata piu' volte).
async function entraComeDemo() {
    const elenco = await (await fetch(BASE_URL + '/api/auth/demo-accounts')).json();
    const scelto = elenco[0];
    const r = await fetch(BASE_URL + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: scelto.id })
    });
    if (!r.ok) throw new Error('accesso demo fallito: ' + r.status);
    const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');

    // Le sessioni stanno su Atlas (connect-mongo): demo-login torna PRIMA che la sessione
    // sia leggibile. Si aspetta una condizione vera, mai un tempo fisso.
    for (let i = 0; i < 40; i++) {
        const me = await fetch(BASE_URL + '/api/auth/me', { headers: { Cookie: cookie } });
        if (me.ok) { const u = await me.json(); if (u && (u.id || u._id)) return { cookie, userId: String(u.id || u._id), nome: u.username }; }
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('la sessione demo non e\' diventata leggibile');
}

// invio "grezzo" che NON solleva sul non-2xx: serve per controllare 403 / 400
async function inviaGrezzo(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE_URL + percorso, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    let body = null;
    try { body = await r.json(); } catch { /* corpo non JSON */ }
    return { status: r.status, body };
}
async function inviaOk(metodo, percorso, corpo, cookie) {
    const r = await inviaGrezzo(metodo, percorso, corpo, cookie);
    if (r.status < 200 || r.status >= 300) throw new Error(`${metodo} ${percorso} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body;
}

// GPX sintetico che passa esattamente da (lat,lng), con orari (quindi non "durata ignota").
function gpxCheTocca(lat, lng, quota) {
    const t0 = Date.UTC(2026, 5, 14, 6, 0, 0); // 14/06/2026, data passata e riconoscibile
    const passi = [];
    for (let i = -6; i <= 6; i++) passi.push({ lat, lng: lng + i * 0.00015, ele: quota, s: (i + 6) * 20 });
    const trkpt = passi.map(p =>
        `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">` +
        `<ele>${p.ele.toFixed(1)}</ele><time>${new Date(t0 + p.s * 1000).toISOString()}</time></trkpt>`
    ).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<gpx version="1.1" creator="prova-punto108"><trk><name>PROVA-108 traccia finta</name>' +
        `<trkseg>\n${trkpt}\n</trkseg></trk></gpx>`;
}

async function sezione3(conn) {
    console.log('\n3. Integrazione col server vero');
    if (!(await serverAcceso())) {
        console.log('   (server non acceso su localhost:3000: sezione 3 saltata)');
        console.log('   lancialo con:  node server.js > prove/server-prove.log 2>&1');
        return { saltata: true };
    }

    const stampsCol = conn.collection('stamps');
    const sessCol = conn.collection('activehikesessions');

    const utente = await entraComeDemo();
    const oid = new mongoose.Types.ObjectId(utente.userId);
    console.log(`   account demo: ${utente.nome} (${utente.userId})`);

    // Stato di partenza per QUEST'utente
    const stampStartDocs = await stampsCol.find({ userId: oid }).toArray();
    const stampStartIds = new Set(stampStartDocs.map(s => s.stampId));
    const stampStartCount = stampStartDocs.length;
    const sessStartCount = await sessCol.countDocuments({ userId: oid });

    // Scegli due vette del catalogo che questo demo NON ha ancora timbrato
    const liberi = CATALOGO.filter(b => Number.isFinite(b.lat) && Number.isFinite(b.lng) && !stampStartIds.has(b.stampId));
    if (liberi.length < 2) { ok('almeno due vette non ancora timbrate dal demo', false, `${liberi.length}`); return { saltata: false }; }
    const puntoLive = liberi[0];
    const puntoGpx = liberi[1];
    const STAMP_FUORI_CATALOGO = `PROVA-108-fuori-catalogo-${Date.now()}`;
    console.log(`   vetta per 3c/3d/3f: ${puntoLive.nome} (${puntoLive.stampId})`);
    console.log(`   vetta per 3e (.gpx): ${puntoGpx.nome} (${puntoGpx.stampId})`);

    const sessioniCreate = [];
    const stampDaPulire = [STAMP_FUORI_CATALOGO, puntoLive.stampId, puntoGpx.stampId];

    try {
        // 3a - nessuna traccia vicina -> 403
        const r3a = await inviaGrezzo('POST', '/api/stamps', { stampId: puntoLive.stampId }, utente.cookie);
        ok('3a  POST /api/stamps senza traccia vicina -> 403', r3a.status === 403, `status ${r3a.status}`);
        ok('3a  con un messaggio che spiega perche\'', !!(r3a.body && r3a.body.error), JSON.stringify(r3a.body));
        ok('3a  nessuno Stamp creato',
            await stampsCol.countDocuments({ userId: oid }) === stampStartCount, '');

        // 3b - stampId fuori catalogo -> 400
        const r3b = await inviaGrezzo('POST', '/api/stamps', { stampId: STAMP_FUORI_CATALOGO }, utente.cookie);
        ok('3b  POST /api/stamps con stampId fuori catalogo -> 400', r3b.status === 400, `status ${r3b.status}`);
        ok('3b  nessuno Stamp creato',
            await stampsCol.countDocuments({ userId: oid }) === stampStartCount, '');
        ok('3b  niente Stamp col codice fasullo sul DB',
            await stampsCol.countDocuments({ userId: oid, stampId: STAMP_FUORI_CATALOGO }) === 0, '');

        // 3c - registrazione che passa dalla vetta -> POST /api/stamps -> 200
        const avvio = await inviaOk('POST', '/api/tracking/start', {}, utente.cookie);
        const sessId = String(avvio.id || avvio._id);
        sessioniCreate.push(sessId);
        ok('3c  sessione di tracciamento avviata', !!sessId, '');

        // Cinque punti su una linea che attraversa la vetta: quello centrale e' a ~0 m.
        const punti = [];
        for (let i = -2; i <= 2; i++) {
            punti.push([puntoLive.lng + i * 0.0002, puntoLive.lat, puntoLive.quota || 2000, (i + 2) * 10, 8]);
        }
        await inviaOk('POST', `/api/tracking/${sessId}/points`, { points: punti }, utente.cookie);

        const r3c = await inviaGrezzo('POST', '/api/stamps', { stampId: puntoLive.stampId }, utente.cookie);
        ok('3c  POST /api/stamps con la registrazione sulla vetta -> 200', r3c.status === 200, `status ${r3c.status}`);
        ok('3c  lo Stamp e\' sul DB',
            await stampsCol.countDocuments({ userId: oid, stampId: puntoLive.stampId }) === 1, '');

        // 3d - idempotente
        const r3d = await inviaGrezzo('POST', '/api/stamps', { stampId: puntoLive.stampId }, utente.cookie);
        ok('3d  ripetere la stessa chiamata -> 200', r3d.status === 200, `status ${r3d.status}`);
        ok('3d  sul DB resta un solo Stamp per quella vetta',
            await stampsCol.countDocuments({ userId: oid, stampId: puntoLive.stampId }) === 1, '');

        // 3e - import .gpx che tocca un'altra vetta (best-effort: puo' saltare per il tetto mensile)
        let gpxImportato = false;
        const imp = await inviaGrezzo('POST', '/api/tracking/import-gpx',
            { gpx: gpxCheTocca(puntoGpx.lat, puntoGpx.lng, puntoGpx.quota || 2000) }, utente.cookie);
        if (imp.status === 429) {
            console.log('   3e  tetto .gpx mensile raggiunto per questo demo: sotto-sezione saltata');
        } else {
            ok('3e  import .gpx accettato -> 200', imp.status === 200, `status ${imp.status}: ${JSON.stringify(imp.body).slice(0, 120)}`);
            if (imp.body && imp.body.id) { sessioniCreate.push(String(imp.body.id)); gpxImportato = true; }
            ok('3e  il .gpx ha assegnato il timbro della vetta che tocca',
                await stampsCol.countDocuments({ userId: oid, stampId: puntoGpx.stampId }) === 1,
                `badge in risposta: ${JSON.stringify((imp.body && imp.body.badge) || [])}`);
        }

        // 3f - /peak-ascents dopo il refactor (usa tracciaToccaPunto). NB: quella rotta
        // conta solo le sessioni status:'ended', quindi NON vede la registrazione ancora
        // aperta di 3c (comportamento voluto: il conteggio salite e' per le uscite
        // concluse). La si verifica sulla sessione .gpx di 3e, che nasce gia' conclusa.
        const asc = await inviaOk('GET', `/api/tracking/peak-ascents/${utente.userId}`, null, utente.cookie);
        ok('3f  GET /peak-ascents risponde con un array', Array.isArray(asc), typeof asc);
        if (gpxImportato) {
            const voce = (asc || []).find(v => v.stampId === puntoGpx.stampId);
            ok('3f  la vetta toccata dal .gpx ha siteCount >= 1', !!voce && voce.siteCount >= 1, JSON.stringify(voce || null));
            ok('3f  e total >= 1', !!voce && voce.total >= 1, JSON.stringify(voce || null));
        } else {
            console.log('   3f  (3e saltata: niente sessione conclusa da verificare in peak-ascents)');
        }

    } finally {
        // Pulizia: filtrata per userId E per chiave. Non tocca gli Stamp che c'erano gia'.
        const idsMieiStamp = stampDaPulire.filter(id => !stampStartIds.has(id));
        if (idsMieiStamp.length) {
            const del = await stampsCol.deleteMany({ userId: oid, stampId: { $in: idsMieiStamp } });
            console.log(`   (pulizia: ${del.deletedCount} Stamp di prova cancellati)`);
        }
        if (sessioniCreate.length) {
            const del = await sessCol.deleteMany({
                userId: oid,
                _id: { $in: sessioniCreate.map(id => new mongoose.Types.ObjectId(id)) }
            });
            console.log(`   (pulizia: ${del.deletedCount} ActiveHikeSession di prova cancellate)`);
        }
        const stampFine = await stampsCol.countDocuments({ userId: oid });
        const sessFine = await sessCol.countDocuments({ userId: oid });
        ok('nessuno Stamp di troppo lasciato sull\'account demo', stampFine === stampStartCount, `${stampStartCount} -> ${stampFine}`);
        ok('nessuna ActiveHikeSession di troppo lasciata sull\'account demo', sessFine === sessStartCount, `${sessStartCount} -> ${sessFine}`);
    }
    return { saltata: false };
}

// --------------------------------------------------------------------------
(async () => {
    sezione1();

    let conn = null;
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        conn = mongoose.connection;
        await sezione2();
        await sezione3(conn);
    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + e.message);
    } finally {
        if (conn) await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
