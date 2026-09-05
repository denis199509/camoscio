// PROVA: B-2, follow-up revisione sicurezza (31a) - i tre punti che rimandavano il
// messaggio di un errore di calcolaDaPercorso al client (routes/completions.js,
// routes/hikes.js, risolviPercorso in lib/percorso.js) lo facevano SENZA controllare se
// fosse sicuro da mostrare: oggi tutti i messaggi di calcolaDaPercorso sono scritti a mano
// (nessuna perdita vera), ma un errore imprevisto futuro (bug, un driver che cambia
// formato...) sarebbe passato lo stesso. erroreUtente() marca ogni messaggio scritto a mano
// come sicuro (flag .utente, lo stesso gia' usato da ErroreGpx/ErroreFit); i tre punti ora
// mostrano il messaggio vero SOLO se il flag c'e', altrimenti un messaggio generico + log
// server (stesso fail-closed di M-3).
//
// Lanciarla:  node prove/prova-percorso-errori-sicuri.js   (avvia un server suo sulla 3134)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { calcolaDaPercorso, risolviPercorso, erroreUtente } = require('../lib/percorso');
const RouteDraft = require('../models/RouteDraft');

const PORTA = 3134;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

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
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let c = null; try { c = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    const cookieRisposta = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
        .filter(Boolean).map(x => x.split(';')[0]).join('; ');
    return { status: r.status, corpo: c, cookie: cookieRisposta };
}

function corpoRegistrazione(suffix) {
    return {
        nome: 'Prova', cognome: `PercorsoErrori${suffix}`,
        email: `prova-percorso-errori-${MARCA}-${suffix}@esempio-di-prova.invalid`,
        password: 'PasswordDiProva1!', username: `provapercorsoerrori${MARCA}${suffix}`,
        ageRange: '30-39', termsAccepted: true,
        emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
    };
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Hikes = mongoose.connection.collection('hikes');
    const Completamenti = mongoose.connection.collection('completions');
    const partenza = { utenti: await Utenti.countDocuments(), hikes: await Hikes.countDocuments(), completamenti: await Completamenti.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idsUtenti = [];
    const idsHikes = [];
    const idsCompletamenti = [];
    let server;

    try {
        console.log('1. erroreUtente() marca il messaggio; un Error normale non lo ha (unita\', senza server)');
        const marcato = erroreUtente('messaggio di prova');
        ok('erroreUtente() imposta .utente = true', marcato.utente === true);
        ok('...e conserva il messaggio', marcato.message === 'messaggio di prova');
        const nonMarcato = new Error('altro messaggio');
        ok('un Error costruito a mano NON ha .utente', !nonMarcato.utente);

        console.log('\n2. calcolaDaPercorso: i rami raggiungibili restano marcati, stesso messaggio di sempre');
        try {
            await calcolaDaPercorso({ kind: 'chissache' }, new mongoose.Types.ObjectId().toString());
            ok('kind sconosciuto doveva lanciare', false);
        } catch (e) {
            ok('kind sconosciuto -> .utente true', e.utente === true);
            ok('...messaggio invariato', e.message === 'Percorso non valido.', e.message);
        }
        try {
            await calcolaDaPercorso({ kind: 'draft', draftId: new mongoose.Types.ObjectId().toString() }, new mongoose.Types.ObjectId().toString());
            ok('bozza inesistente doveva lanciare', false);
        } catch (e) {
            ok('bozza inesistente -> .utente true', e.utente === true);
            ok('...messaggio invariato', e.message === 'Questo progetto non esiste o non è tuo.', e.message);
        }

        console.log('\n3. FAIL-CLOSED vero: un errore NON marcato (es. il database che si comporta male) non esce mai');
        const draftIdFinto = new mongoose.Types.ObjectId().toString();
        const originaleFindOne = RouteDraft.findOne;
        RouteDraft.findOne = () => { throw new Error('dettaglio interno del database, non deve mai uscire da qui'); };
        try {
            const esito = await risolviPercorso({ kind: 'draft', draftId: draftIdFinto }, new mongoose.Types.ObjectId().toString());
            ok('risolviPercorso torna ok:false (non rilancia)', esito.ok === false, JSON.stringify(esito));
            ok('...messaggio GENERICO, non il dettaglio interno', !!esito.corpo && esito.corpo.error !== 'dettaglio interno del database, non deve mai uscire da qui', JSON.stringify(esito.corpo));
            ok('...il dettaglio non compare nemmeno come sottostringa', !JSON.stringify(esito.corpo).includes('dettaglio interno'));
        } finally {
            RouteDraft.findOne = originaleFindOne;
        }

        console.log('\n4. Server vero: i tre punti che rimandano un errore di percorso al client mostrano solo messaggi sicuri');

        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        const utente = await chiama('POST', '/api/auth/register', corpoRegistrazione('u'));
        const idUtente = utente.corpo && (utente.corpo.id || utente.corpo._id);
        if (idUtente) idsUtenti.push(new mongoose.Types.ObjectId(idUtente));
        ok('registrazione dell\'account di prova riuscita', !!idUtente, JSON.stringify(utente.corpo));

        console.log('\n4a. POST /api/hikes (creazione, via risolviPercorso) - percorso salvato inesistente');
        const creazione = await chiama('POST', '/api/hikes', {
            title: `Prova percorso errori ${MARCA}`, description: 'prova',
            date: new Date(Date.now() + 7 * 86400000).toISOString(), difficulty: 'Facile',
            trailhead: { lat: 41.9028, lng: 12.4964 },
            routeSource: { kind: 'saved', savedRouteId: new mongoose.Types.ObjectId().toString() }
        }, utente.cookie);
        ok('POST /api/hikes con percorso salvato inesistente -> 400', creazione.status === 400, JSON.stringify(creazione.corpo));
        ok('...messaggio esatto e invariato (passa da risolviPercorso)', creazione.corpo && creazione.corpo.error === 'Questo percorso non esiste o non è tuo.', JSON.stringify(creazione.corpo));

        console.log('\n4b. POST /api/completions/:id/gpx (chiamata diretta a calcolaDaPercorso) - testo non-gpx');
        const hikeFixture = await Hikes.insertOne({
            title: `Prova completions ${MARCA}`, description: 'prova', date: new Date(Date.now() - 86400000),
            difficulty: 'Facile', trailhead: { lat: 41.9028, lng: 12.4964 },
            creatorId: new mongoose.Types.ObjectId(idUtente),
            maxAltitude: 1000, distanceKm: 5, elevationGain: 300,
            participants: [new mongoose.Types.ObjectId(idUtente)]
        });
        idsHikes.push(hikeFixture.insertedId);
        const completionFixture = await Completamenti.insertOne({
            userId: new mongoose.Types.ObjectId(idUtente), hikeId: hikeFixture.insertedId, dateCompleted: new Date()
        });
        idsCompletamenti.push(completionFixture.insertedId);

        // BASSO (giro agente): 'questo non e\' un gpx valido' non contiene <gpx>, quindi
        // lib/gpx.js parseGpx lancia SEMPRE lo stesso ErroreGpx con questo messaggio esatto
        // (riga 81 di lib/gpx.js) - un'asserzione POSITIVA su un valore preciso, non solo
        // "non sembra un dettaglio grezzo": e' quella che si accorgerebbe se un giorno il
        // messaggio utile smettesse di arrivare (regressione verso il ripiego generico).
        const messaggioGpxNonValido = "Questo non sembra un file .gpx: manca l'elemento <gpx> di apertura.";

        const uploadCompletions = await chiama('POST', `/api/completions/${completionFixture.insertedId}/gpx`, { gpxText: 'questo non e\' un gpx valido' }, utente.cookie);
        ok('POST /api/completions/:id/gpx con testo non-gpx -> 400', uploadCompletions.status === 400, JSON.stringify(uploadCompletions.corpo));
        ok('...messaggio ESATTO dell\'ErroreGpx (non il ripiego generico, non un dettaglio grezzo)',
            !!uploadCompletions.corpo && uploadCompletions.corpo.error === messaggioGpxNonValido,
            JSON.stringify(uploadCompletions.corpo));

        console.log('\n4c. POST /api/hikes/:id/complete-group (chiamata diretta a calcolaDaPercorso, gpxText opzionale) - testo non-gpx');
        const completeGroup = await chiama('POST', `/api/hikes/${hikeFixture.insertedId}/complete-group`, {
            confirmedUserIds: [idUtente], gpxText: 'questo non e\' un gpx valido'
        }, utente.cookie);
        ok('POST /:id/complete-group con gpxText non parsabile -> 400', completeGroup.status === 400, JSON.stringify(completeGroup.corpo));
        ok('...stesso messaggio ESATTO dell\'ErroreGpx',
            !!completeGroup.corpo && completeGroup.corpo.error === messaggioGpxNonValido,
            JSON.stringify(completeGroup.corpo));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of idsCompletamenti) await Completamenti.deleteOne({ _id: id }).catch(() => {});
        for (const id of idsHikes) await Hikes.deleteOne({ _id: id }).catch(() => {});
        for (const id of idsUtenti) await Utenti.deleteOne({ _id: id }).catch(() => {});
        const fine = { utenti: await Utenti.countDocuments(), hikes: await Hikes.countDocuments(), completamenti: await Completamenti.countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessun dato di prova rimasto', fine.utenti === partenza.utenti && fine.hikes === partenza.hikes && fine.completamenti === partenza.completamenti, JSON.stringify({ partenza, fine }));

        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:', fallimenti);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
