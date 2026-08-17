// PROVA DEL PUNTO 93: quando un progetto e' collegato (routeSource kind:'draft') e il
// dislivello non si puo' calcolare (fonte delle quote giu', o percorso oltre i 25 km), la
// pubblicazione/modifica di un'escursione non si blocca piu' del tutto: il server risponde
// 422 {richiedeQuote:true, motivo, distanceKm, nomePercorso} invece di un 400 secco, e
// accetta un secondo tentativo con routeSource.quoteManuali = {maxAltitude, elevationGain}
// per completare la pubblicazione tenendo il progetto collegato (routeSource.dislivelloManuale
// diventa true - la PROVA che quei due numeri sono stati dichiarati, non calcolati).
//
// Il caso "troppo lungo" (oltre ~25 km) e' usato apposta per i controlli DAL VIVO invece di
// "fonte giu'": e' deterministico e non dipende dall'umore di Open-Meteo (il caso vero che ha
// fatto scoprire il problema, "fonte giu'", non e' pilotabile dal client per scelta di
// sicurezza - vedi lib/percorso.js/lib/trailGraph.js: saltaQuote esiste solo per le prove che
// chiamano progettaPercorso direttamente, mai raggiungibile da una richiesta HTTP).
//
// Lanciarla:  node prove/prova-punto93.js      (non serve un server gia' acceso, ne avvia uno suo)

require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const RouteDraft = require('../models/RouteDraft');
const Hike = require('../models/Hike');
const { calcolaDaPercorso, risolviPercorso } = require('../lib/percorso');

const PORTA = 3107;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

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
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* risposta non-JSON */ }
    return { status: r.status, corpo: corpoRisposta };
}

async function loginDemo(userId) {
    const accesso = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const partenza = {
        escursioni: await mongoose.connection.collection('hikes').countDocuments(),
        bozze: await mongoose.connection.collection('routedrafts').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let draftUnitId = null, draftHttpId = null, hikeId = null;

    try {
        // --- 1. FUNZIONI, senza server: calcolaDaPercorso/risolviPercorso direttamente ---
        console.log('--- 1. calcolaDaPercorso / risolviPercorso sul ramo draft ---');
        const utenteFinto = new mongoose.Types.ObjectId();
        const bozzaUnit = await RouteDraft.create({
            userId: utenteFinto,
            nome: `PROVA-93-unit-${MARCA}`,
            punti: [[13.0, 42.0], [13.5, 42.4]], // ~40 km in linea d'aria, oltre la soglia dei 25 km
            agganciaAiSentieri: false
        });
        draftUnitId = bozzaUnit._id;

        const esito1 = await calcolaDaPercorso({ kind: 'draft', draftId: String(draftUnitId) }, utenteFinto);
        ok('percorso troppo lungo -> quoteMancanti', esito1.quoteMancanti === true, JSON.stringify(esito1));
        ok('motivo e\' "troppo lungo", non "fonte"', esito1.motivo === 'troppo lungo', esito1.motivo);
        ok('la distanza resta calcolata (non manca mai)', typeof esito1.distanceKm === 'number' && esito1.distanceKm > 25, esito1.distanceKm);
        ok('il nome del progetto torna nella risposta', esito1.nomePercorso === bozzaUnit.nome);

        const r2 = await risolviPercorso({ kind: 'draft', draftId: String(draftUnitId) }, utenteFinto);
        ok('risolviPercorso traduce in 422', r2.status === 422 && r2.ok === false, JSON.stringify(r2));
        ok('corpo del 422 ha richiedeQuote', r2.corpo && r2.corpo.richiedeQuote === true);
        ok('corpo del 422 ha un messaggio per l\'utente', typeof r2.corpo.error === 'string' && r2.corpo.error.length > 0);

        const esito3 = await calcolaDaPercorso({ kind: 'draft', draftId: String(draftUnitId), quoteManuali: { maxAltitude: 1820, elevationGain: 950 } }, utenteFinto);
        ok('con quote a mano valide: numeri usati esattamente', esito3.maxAltitude === 1820 && esito3.elevationGain === 950, JSON.stringify(esito3));
        ok('dislivelloManuale = true (la prova che sono dichiarati)', esito3.routeSource && esito3.routeSource.dislivelloManuale === true);
        ok('il progetto resta collegato (kind ancora draft)', esito3.routeSource && esito3.routeSource.kind === 'draft');

        const fuoriScala = await calcolaDaPercorso({ kind: 'draft', draftId: String(draftUnitId), quoteManuali: { maxAltitude: 99999, elevationGain: -50 } }, utenteFinto);
        ok('quote a mano assurde -> trattate come assenti (ancora quoteMancanti)', fuoriScala.quoteMancanti === true, JSON.stringify(fuoriScala));

        const senzaNumeri = await calcolaDaPercorso({ kind: 'draft', draftId: String(draftUnitId), quoteManuali: {} }, utenteFinto);
        ok('quoteManuali vuoto -> ancora quoteMancanti', senzaNumeri.quoteMancanti === true);

        await RouteDraft.deleteOne({ _id: draftUnitId });
        draftUnitId = null;

        // --- 2. DAL VIVO: POST/PUT /api/hikes attraverso il server vero ---
        console.log('\n--- 2. Dal vivo: creazione e modifica di un\'escursione ---');
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, { PORT: String(PORTA) })
        });
        let logServer = '';
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde: ' + logServer);

        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        const idA = elenco[0].id;
        const cookieA = await loginDemo(idA);
        console.log(`     (account demo usato: ${elenco[0].username})`);

        const bozzaHttp = await RouteDraft.create({
            userId: idA,
            nome: `PROVA-93-http-${MARCA}`,
            punti: [[13.0, 42.0], [13.5, 42.4]],
            agganciaAiSentieri: false
        });
        draftHttpId = bozzaHttp._id;

        // 2a. Creazione SENZA quote a mano -> 422, niente creato
        const tent1 = await chiama('POST', '/api/hikes', {
            title: `PROVA-93-${MARCA}`, difficulty: 'Principiante', date: '2026-08-01', tribeTags: [],
            trailhead: { lat: 42.45, lng: 13.55, name: `Prova-93-${MARCA}` },
            routeSource: { kind: 'draft', draftId: String(draftHttpId) }
        }, cookieA);
        ok('POST senza quote a mano -> 422', tent1.status === 422, JSON.stringify(tent1.corpo));
        ok('richiedeQuote true nella risposta HTTP', tent1.corpo && tent1.corpo.richiedeQuote === true);
        ok('nessuna escursione creata dal tentativo fallito', (await Hike.countDocuments({ title: `PROVA-93-${MARCA}` })) === 0);

        // 2b. Rinvio CON quote a mano -> creata, con dislivelloManuale
        const tent2 = await chiama('POST', '/api/hikes', {
            title: `PROVA-93-${MARCA}`, difficulty: 'Principiante', date: '2026-08-01', tribeTags: [],
            trailhead: { lat: 42.45, lng: 13.55, name: `Prova-93-${MARCA}` },
            routeSource: { kind: 'draft', draftId: String(draftHttpId), quoteManuali: { maxAltitude: 1820, elevationGain: 950 } }
        }, cookieA);
        ok('POST con quote a mano -> 200', tent2.status === 200, JSON.stringify(tent2.corpo));
        hikeId = tent2.corpo && (tent2.corpo.id || tent2.corpo._id);
        ok('escursione creata con un id', !!hikeId);
        ok('maxAltitude scritto esattamente', tent2.corpo.maxAltitude === 1820);
        ok('elevationGain scritto esattamente', tent2.corpo.elevationGain === 950);
        ok('distanceKm resta quella calcolata dal percorso', tent2.corpo.distanceKm > 25);
        ok('routeSource.dislivelloManuale true sull\'escursione creata', tent2.corpo.routeSource && tent2.corpo.routeSource.dislivelloManuale === true);

        // 2c. Modifica (PUT) con lo STESSO ramo, senza quote a mano -> 422 anche li'
        const tent3 = await chiama('PUT', `/api/hikes/${hikeId}`, {
            routeSource: { kind: 'draft', draftId: String(draftHttpId) }
        }, cookieA);
        ok('PUT senza quote a mano -> 422 (stesso comportamento della creazione)', tent3.status === 422, JSON.stringify(tent3.corpo));
        ok('richiedeQuote true anche in modifica', tent3.corpo && tent3.corpo.richiedeQuote === true);

        // 2d. Modifica con quote a mano diverse -> aggiornate
        const tent4 = await chiama('PUT', `/api/hikes/${hikeId}`, {
            routeSource: { kind: 'draft', draftId: String(draftHttpId), quoteManuali: { maxAltitude: 2000, elevationGain: 1100 } }
        }, cookieA);
        ok('PUT con quote a mano -> 200', tent4.status === 200, JSON.stringify(tent4.corpo));
        ok('modifica aggiorna maxAltitude', tent4.corpo.maxAltitude === 2000);
        ok('modifica aggiorna elevationGain', tent4.corpo.elevationGain === 1100);
        ok('dislivelloManuale resta true dopo la modifica', tent4.corpo.routeSource && tent4.corpo.routeSource.dislivelloManuale === true);

        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti > 0) console.log('Falliti:', fallimenti);
    } catch (e) {
        console.error('ERRORE DELLA PROVA:', e);
    } finally {
        if (hikeId) await Hike.deleteOne({ _id: hikeId });
        if (draftUnitId) await RouteDraft.deleteOne({ _id: draftUnitId });
        if (draftHttpId) await RouteDraft.deleteOne({ _id: draftHttpId });
        // Rete di sicurezza in piu', filtrata per il titolo/nome riconoscibile di questa prova.
        await Hike.deleteMany({ title: { $regex: `^PROVA-93-${MARCA}` } });
        await RouteDraft.deleteMany({ nome: { $regex: `^PROVA-93-${MARCA}` } });
        if (server) server.kill();

        const finale = {
            escursioni: await mongoose.connection.collection('hikes').countDocuments(),
            bozze: await mongoose.connection.collection('routedrafts').countDocuments()
        };
        console.log('\nConteggi finali:', finale);
        console.log(finale.escursioni === partenza.escursioni ? '  [ok]    nessuna escursione di prova rimasta' : '  [FALLITO] escursioni residue!');
        console.log(finale.bozze === partenza.bozze ? '  [ok]    nessuna bozza di prova rimasta' : '  [FALLITO] bozze residue!');

        await mongoose.disconnect();
        process.exit(falliti > 0 ? 1 : 0);
    }
})();
