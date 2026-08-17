// PROVA DEL PUNTO 92: il passo personale si misura anche dalle TRACCE GPS, e si misura
// invertendo la formula CAI invece di dividere dislivello per ore.
//
// Le quattro decisioni di Denis che questa prova sorveglia:
//   1. i tempi scritti a mano NON fanno piu' passo (serve movingTimeHours, mai actualTimeHours);
//   2. formula B: il passo e' quello che, dentro oreCai(), avrebbe predetto ESATTAMENTE il
//      tempo misurato - chi cammina come il CAI risulta 400 m/h, non ~267;
//   3. anti-doppio-conteggio: traccia con hikeId + Completion per lo stesso hikeId = UNA sola
//      osservazione (vince la traccia); senza collegamento restano indipendenti (non e' un bug);
//   4. movingTimeSec si calcola solo in /import-gpx e /:id/end, sui punti COMPLETI.
//
// DATI DI PROVA: quasi tutto gira su un userId SINTETICO (un ObjectId che non appartiene a
// nessun utente), cosi' nessun account vero o demo viene sfiorato - recalculatePersonalPace
// interroga tracce e completamenti per userId, non ha bisogno che l'utente esista davvero.
// L'unica eccezione e' la sezione 8, che parla col server vero e quindi ha bisogno di una
// sessione: li' si usa l'ULTIMO account demo (gli altri tre sono gia' impegnati da
// prova-punto77.js), se ne legge lo stato PRIMA e lo si rimette esattamente com'era.
//
// Lanciarla:  node prove/prova-punto92.js
//   La sezione 8 vuole il server acceso su localhost:3000 (node server.js > prove/server-prove.log 2>&1).
//   Senza server si salta da sola e lo dice; tutto il resto gira comunque.

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { connectMongo, mongoose } = require('../db/mongo');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Completion = require('../models/Completion');
const Hike = require('../models/Hike');
const Stamp = require('../models/Stamp');
const { paceUpDaMisura, recalculatePersonalPace } = require('../lib/hikeStats');
const { oreCai, passoDaOre, PASSO_SALITA_CAI, VELOCITA_PIANO_KMH } = require('../public/js/cai-tempi.js');
const { parseGpx, statisticheTraccia, tempiTraccia, SOGLIA_DISLIVELLO_M } = require('../lib/gpx');
const { haversineKm, metersPerDegree } = require('../lib/geometry');

const RADICE = path.join(__dirname, '..');
const BASE = process.env.CAMOSCIO_BASE || 'http://localhost:3000';
const MARCA = Date.now();

// Utente che NON esiste: nessun documento User, nessun account vero o demo coinvolto in
// tutta la parte di dominio. Serve solo come chiave dei documenti di prova.
const UTENTE_FINTO = new mongoose.Types.ObjectId();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
function vicino(nome, valore, atteso, tolleranza, unita = '') {
    ok(`${nome} (${valore}${unita}, atteso ~${atteso}${unita} ±${tolleranza})`,
        Number.isFinite(valore) && Math.abs(valore - atteso) <= tolleranza);
}

// Come in prova-passo-non-misurato.js: i file di public/js si caricano in Node con un
// "window" finto, per verificare che la copia letta dal browser sia LA STESSA letta dal
// server con require() - il senso stesso di aver creato cai-tempi.js.
function daFrontendConFinestraNuova(file) {
    const finestra = {};
    const sorgente = fs.readFileSync(path.join(RADICE, 'public', 'js', file), 'utf8');
    new Function('window', sorgente)(finestra);
    return finestra;
}

// --- traccia sintetica per la sezione 8 -----------------------------------------------
// 40 minuti, un punto ogni 10 secondi (241 punti): abbondantemente sopra le soglie di
// tempiTraccia (30 punti, 10 minuti, un punto ogni 60s al massimo). Dentro c'e' una sosta
// vera di 5 minuti, cosi' movingTimeSec DEVE risultare diverso dalla durata totale - se
// fossero uguali la prova non distinguerebbe "ha misurato il cammino" da "ha copiato la
// durata". In Molise, dentro le quattro regioni coperte e lontano da qualunque vetta
// timbrabile (la traccia non deve regalare badge all'account demo).
const LAT_PROVA = 41.60, LNG_PROVA = 14.65;
function gpxDiProva() {
    const { mLng } = metersPerDegree(LAT_PROVA);
    const t0 = Date.UTC(2026, 5, 14, 6, 0, 0); // 14/06/2026, data passata e riconoscibile
    const passi = [];
    let lng = LNG_PROVA, quota = 1000;
    const spinta = (0.55 * 10) / mLng; // 0,55 m/s: passo lento da salita ripida
    for (let s = 0; s <= 900; s += 10) { passi.push({ s, lng, quota }); lng += spinta; quota += 1; }
    for (let s = 910; s <= 1200; s += 10) passi.push({ s, lng, quota });   // sosta di 5 minuti
    for (let s = 1210; s <= 2400; s += 10) { lng += spinta; quota += 1; passi.push({ s, lng, quota }); }
    const trkpt = passi.map(p =>
        `<trkpt lat="${LAT_PROVA.toFixed(7)}" lon="${p.lng.toFixed(7)}">` +
        `<ele>${p.quota.toFixed(1)}</ele><time>${new Date(t0 + p.s * 1000).toISOString()}</time></trkpt>`
    ).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        `<gpx version="1.1" creator="prova-punto92"><trk><name>PROVA-92 traccia finta ${MARCA}</name>` +
        `<trkseg>\n${trkpt}\n</trkseg></trk></gpx>`;
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
    return { status: r.status, corpo: corpoRisposta, testo };
}

// Crea una traccia di prova. Tutti i valori sono espliciti: nessun default dello schema
// entra nei numeri che poi si controllano.
async function traccia(campi) {
    return ActiveHikeSession.create(Object.assign({
        userId: UTENTE_FINTO,
        status: 'ended',
        startedAt: new Date('2026-06-14T06:00:00Z'),
        endedAt: new Date('2026-06-14T10:00:00Z'),
        importedName: `PROVA-92 traccia finta ${MARCA}`,
        // Punti finti ma non vuoti: servono alla sezione 7 (la query non deve caricarli).
        points: [[LNG_PROVA, LAT_PROVA, 1000, 0, 0], [LNG_PROVA + 0.001, LAT_PROVA, 1100, 600, 0]]
    }, campi));
}

async function pulisciTracce() {
    await ActiveHikeSession.deleteMany({ userId: UTENTE_FINTO });
}

(async () => {
    // Conteggi letti all'inizio e riconfrontati alla fine, mai scritti a mano.
    await connectMongo();
    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        sessioni: await mongoose.connection.collection('activehikesessions').countDocuments(),
        completamenti: await mongoose.connection.collection('completions').countDocuments(),
        escursioni: await mongoose.connection.collection('hikes').countDocuments(),
        timbri: await mongoose.connection.collection('stamps').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let hikeFinto = null;
    let idDemo = null;
    let statoDemoPrima = null;
    let sessioneDemo = null;
    let timbriRegalati = [];
    let findVero = null;

    try {
        // =================================================================================
        console.log('--- 1. FORMULA B: chi cammina come il CAI viene misurato 400, non 267 ---');

        // Il caso di riferimento: 800 m di dislivello, 8 km, 3 ore. E' ESATTAMENTE cio' che
        // la formula CAI predice per un passo di 400 m/h, quindi la misura deve restituire 400.
        vicino('oreCai(800 m, 8 km, 400 m/h) predice 3 ore', oreCai(800, 8, 400), 3, 0.0001, ' h');
        vicino('passoDaOre(800 m, 8 km, 3 h) torna il passo CAI', passoDaOre(800, 8, 3), 400, 0.0001, ' m/h');
        vicino('paceUpDaMisura sullo stesso caso da' + '\' 400', paceUpDaMisura(800, 8, 3), 400, 0.0001, ' m/h');
        ok('e NON i ~267 della vecchia divisione dislivello/ore',
            Math.abs(paceUpDaMisura(800, 8, 3) - (800 / 3)) > 100, String(paceUpDaMisura(800, 8, 3)));

        // Andata e ritorno su valori qualunque: passoDaOre e' l'inverso esatto di oreCai.
        for (const [d, s, p] of [[1200, 14, 350], [400, 2, 500], [900, 6, 250], [1500, 20, 600]]) {
            vicino(`inverso esatto su ${d} m / ${s} km / ${p} m/h`, passoDaOre(d, s, oreCai(d, s, p)), p, 0.001, ' m/h');
        }

        // Caso degenerato: senza sviluppo orizzontale la formula CAI si riduce alla divisione
        // semplice, e la nuova misura deve coincidere con la vecchia.
        vicino('distanza 0: coincide con la divisione semplice (400/2)', passoDaOre(400, 0, 2), 200, 0.0001, ' m/h');
        vicino('distanza 0 anche passando da paceUpDaMisura', paceUpDaMisura(400, 0, 2), 200, 0.0001, ' m/h');
        vicino('distanza mancante trattata come 0', paceUpDaMisura(400, undefined, 2), 200, 0.0001, ' m/h');

        // Piu' veloce del solo riferimento in piano: fuori dal modello, si dice "non lo so".
        ok('piu' + '\' veloce del riferimento in piano => null, non un numero',
            passoDaOre(500, 8, 1.5) === null, String(passoDaOre(500, 8, 1.5)));
        ok('esattamente pari al riferimento in piano => null (ore > F, non >=)',
            passoDaOre(500, 8, 2) === null, String(passoDaOre(500, 8, 2)));
        ok('e paceUpDaMisura lo propaga come null', paceUpDaMisura(500, 8, 1.5) === null, String(paceUpDaMisura(500, 8, 1.5)));

        // La formula ha due rami (dislivello dominante / sviluppo dominante): sul confine
        // devono dare lo stesso numero, altrimenti c'e' un salto invisibile nei dati veri.
        const F = 8 / VELOCITA_PIANO_KMH;
        const eps = 1e-6;
        vicino('nessun salto fra i due rami sul confine ore = 1,5 F',
            passoDaOre(800, 8, 1.5 * F + eps) - passoDaOre(800, 8, 1.5 * F - eps), 0, 0.01, ' m/h');

        // Ingressi assurdi o mancanti: scartati, mai un numero silenziosamente sbagliato.
        ok('ore mancanti => null', paceUpDaMisura(800, 8, undefined) === null);
        ok('ore zero => null', paceUpDaMisura(800, 8, 0) === null);
        ok('ore negative => null', paceUpDaMisura(800, 8, -3) === null);
        ok('ore oltre le 24 => null', paceUpDaMisura(800, 8, 30) === null);
        ok('dislivello zero => nessuna prova sul passo IN SALITA, null', paceUpDaMisura(0, 8, 3) === null);
        ok('dislivello mancante => null', paceUpDaMisura(undefined, 8, 3) === null);
        ok('passo implausibile per eccesso scartato (non tagliato)', paceUpDaMisura(5000, 0, 0.5) === null,
            String(paceUpDaMisura(5000, 0, 0.5)));
        ok('passo implausibile per difetto scartato', paceUpDaMisura(20, 0, 1) === null, String(paceUpDaMisura(20, 0, 1)));
        ok('un passo lentissimo ma umano resta valido', paceUpDaMisura(300, 0, 3) === 100, String(paceUpDaMisura(300, 0, 3)));

        // =================================================================================
        console.log('\n--- 2. UNA COPIA SOLA della formula: server e browser leggono lo stesso file ---');

        const finestra = daFrontendConFinestraNuova('cai-tempi.js');
        ok('il file caricato come nel browser espone oreCai', typeof finestra.oreCai === 'function');
        ok('il file caricato come nel browser espone passoDaOre', typeof finestra.passoDaOre === 'function');
        ok('browser e server danno lo stesso tempo previsto',
            finestra.oreCai(800, 8, 400) === oreCai(800, 8, 400));
        ok('browser e server danno lo stesso passo misurato',
            finestra.passoDaOre(800, 8, 3) === passoDaOre(800, 8, 3));
        ok('la costante CAI e' + '\' la stessa dalle due parti', finestra.PASSO_SALITA_CAI === PASSO_SALITA_CAI && PASSO_SALITA_CAI === 400);
        const sorgenteHtml = fs.readFileSync(path.join(RADICE, 'public', 'index.html'), 'utf8');
        ok('index.html carica cai-tempi.js PRIMA di profile.js',
            sorgenteHtml.indexOf('cai-tempi.js') !== -1 &&
            sorgenteHtml.indexOf('cai-tempi.js') < sorgenteHtml.indexOf('js/profile.js'),
            `${sorgenteHtml.indexOf('cai-tempi.js')} / ${sorgenteHtml.indexOf('js/profile.js')}`);

        // =================================================================================
        console.log('\n--- 3. Una TRACCIA diventa un\'osservazione, senza nessun Completion ---');

        await traccia({ elevationGainM: 800, distanceKm: 8, movingTimeSec: 3 * 3600 });
        let r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('una traccia misurata produce esattamente un\'osservazione', r.osservazioni.length === 1, JSON.stringify(r.osservazioni));
        ok('l\'osservazione dichiara di venire dalla traccia',
            r.osservazioni[0] && r.osservazioni[0].fonte === 'traccia', JSON.stringify(r.osservazioni[0]));
        ok('il passo e' + '\' quello della formula B (400), non 267', r.nuovoPaceUp === 400, String(r.nuovoPaceUp));
        ok('il passo in discesa resta il default riscalato nella stessa proporzione',
            r.nuovoPaceDown === Math.round(500 * (400 / 350)), String(r.nuovoPaceDown));

        // Una traccia senza dislivello non dice niente sul passo IN SALITA: non deve entrare.
        await traccia({ elevationGainM: 0, distanceKm: 5, movingTimeSec: 2 * 3600 });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('una traccia senza dislivello non aggiunge osservazioni', r.osservazioni.length === 1, JSON.stringify(r.osservazioni));

        // Una traccia assurda (registratore lasciato acceso in auto) si SCARTA, non si taglia.
        await traccia({ elevationGainM: 5000, distanceKm: 1, movingTimeSec: 900 });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('una traccia con un passo assurdo viene scartata, non media dentro',
            r.osservazioni.length === 1 && r.nuovoPaceUp === 400, JSON.stringify(r));

        // Una traccia SENZA movingTimeSec (registrata prima del punto 92, o troppo rada) non
        // e' materiale per il passo: nessun ripiego sulla durata totale.
        await traccia({ elevationGainM: 700, distanceKm: 7 });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('una traccia senza movingTimeSec non produce osservazioni', r.osservazioni.length === 1, JSON.stringify(r.osservazioni));

        await pulisciTracce();
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('tolte le tracce, zero osservazioni (nessun residuo)', r.osservazioni.length === 0 && r.nuovoPaceUp === null, JSON.stringify(r));

        // =================================================================================
        console.log('\n--- 4. I TEMPI SCRITTI A MANO non fanno piu\' passo ---');

        hikeFinto = await Hike.create({
            title: `PROVA-92 escursione finta ${MARCA}`,
            creatorId: UTENTE_FINTO,
            difficulty: 'Principiante',
            date: '2026-06-14',
            elevationGain: 800,
            distanceKm: 8,
            trailhead: { lat: LAT_PROVA, lng: LNG_PROVA, name: `Prova-92-${MARCA}` },
            // Obbligatorio: sulla collezione c'e' un indice 2dsphere, e un "location" col solo
            // type e senza coordinate fa rifiutare l'inserimento da MongoDB.
            location: { type: 'Point', coordinates: [LNG_PROVA, LAT_PROVA] }
        });

        await Completion.create({
            userId: UTENTE_FINTO, hikeId: hikeFinto._id,
            dateCompleted: new Date('2026-06-14T18:00:00Z'),
            actualTimeHours: 3
        });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('un completamento col solo tempo dichiarato a mano NON produce osservazioni',
            r.osservazioni.length === 0, JSON.stringify(r.osservazioni));
        ok('e quindi non produce nemmeno un passo', r.nuovoPaceUp === null, String(r.nuovoPaceUp));

        await Completion.updateOne({ userId: UTENTE_FINTO, hikeId: hikeFinto._id }, { $set: { movingTimeHours: 3 } });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('lo stesso completamento con un tempo di CAMMINO vero produce un\'osservazione',
            r.osservazioni.length === 1, JSON.stringify(r.osservazioni));
        ok('l\'osservazione dichiara di venire dal completamento',
            r.osservazioni[0] && r.osservazioni[0].fonte === 'completamento', JSON.stringify(r.osservazioni[0]));
        ok('col tempo di cammino il passo e' + '\' quello della formula B (400)', r.nuovoPaceUp === 400, String(r.nuovoPaceUp));

        // =================================================================================
        console.log('\n--- 5. ANTI-DOPPIO-CONTEGGIO: dove c\'e\' il collegamento, vince la traccia ---');

        // Numeri diversi apposta: la traccia misura 320 m/h, il completamento ne misurerebbe
        // 400. Se contassero entrambi la media sarebbe 360, e si vedrebbe subito.
        const traccia320 = await traccia({
            hikeId: hikeFinto._id, elevationGainM: 800, distanceKm: 8, movingTimeSec: Math.round(3.5 * 3600)
        });
        vicino('la traccia da sola misurerebbe 320 m/h', paceUpDaMisura(800, 8, 3.5), 320, 0.5, ' m/h');
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('traccia collegata + completamento sullo stesso hikeId = UNA sola osservazione',
            r.osservazioni.length === 1, JSON.stringify(r.osservazioni));
        ok('e quella che resta e' + '\' la traccia', r.osservazioni[0] && r.osservazioni[0].fonte === 'traccia', JSON.stringify(r.osservazioni[0]));
        ok('il passo e' + '\' quello della traccia (320), non la media col completamento (360)',
            r.nuovoPaceUp === 320, String(r.nuovoPaceUp));

        // Senza collegamento esplicito le due misure restano indipendenti: decisione 4 di
        // Denis, non un difetto - nessun abbinamento indovinato per data.
        await ActiveHikeSession.updateOne({ _id: traccia320._id, userId: UTENTE_FINTO }, { $set: { hikeId: null } });
        r = await recalculatePersonalPace(UTENTE_FINTO);
        ok('senza collegamento traccia->escursione le due osservazioni restano indipendenti',
            r.osservazioni.length === 2, JSON.stringify(r.osservazioni));
        ok('e il passo e' + '\' la media delle due (360)', r.nuovoPaceUp === 360, String(r.nuovoPaceUp));

        // =================================================================================
        console.log('\n--- 6. IDEMPOTENZA: due chiamate di fila, stesso risultato ---');

        const primaVolta = await recalculatePersonalPace(UTENTE_FINTO);
        const secondaVolta = await recalculatePersonalPace(UTENTE_FINTO);
        ok('due ricalcoli di fila danno lo stesso identico risultato',
            JSON.stringify(primaVolta) === JSON.stringify(secondaVolta),
            `${JSON.stringify(primaVolta)} / ${JSON.stringify(secondaVolta)}`);
        ok('il ricalcolo non ha creato ne' + '\' cancellato tracce',
            await ActiveHikeSession.countDocuments({ userId: UTENTE_FINTO }) === 1);

        // =================================================================================
        console.log('\n--- 7. VINCOLO RAM: la query sulle tracce non deve mai portarsi dietro i punti ---');

        // Si intercetta cosa TORNA davvero dal database, non come e' scritta la query: e' il
        // documento caricato in memoria il costo che il vincolo hard vuole evitare.
        let docsVisti = null;
        findVero = ActiveHikeSession.find;
        ActiveHikeSession.find = function (...argomenti) {
            const query = findVero.apply(this, argomenti);
            const execVero = query.exec.bind(query);
            query.exec = async function () {
                const risultato = await execVero();
                if (Array.isArray(risultato)) docsVisti = risultato;
                return risultato;
            };
            return query;
        };
        await recalculatePersonalPace(UTENTE_FINTO);
        ActiveHikeSession.find = findVero;
        findVero = null;

        ok('la query sulle tracce e' + '\' stata intercettata', Array.isArray(docsVisti) && docsVisti.length === 1,
            JSON.stringify(docsVisti && docsVisti.length));
        const traccaLetta = (docsVisti || [])[0] || {};
        ok('il documento letto NON contiene i punti della traccia',
            !Object.prototype.hasOwnProperty.call(traccaLetta, 'points'), Object.keys(traccaLetta).join(','));
        ok('e nemmeno _id (senza, l\'indice coprente non copre)',
            !Object.prototype.hasOwnProperty.call(traccaLetta, '_id'), Object.keys(traccaLetta).join(','));
        ok('ma contiene i quattro numeri che servono',
            ['elevationGainM', 'distanceKm', 'movingTimeSec'].every(k => Object.prototype.hasOwnProperty.call(traccaLetta, k)),
            Object.keys(traccaLetta).join(','));
        const indiciTracce = ActiveHikeSession.schema.indexes();
        ok('esiste un indice parziale sulle sole tracce con un tempo di cammino',
            indiciTracce.some(([campi, opzioni]) => campi.movingTimeSec &&
                opzioni && opzioni.partialFilterExpression && opzioni.partialFilterExpression.movingTimeSec),
            JSON.stringify(indiciTracce));
        ok('movingTimeSec non ha un default (assente = non misurabile, mai zero)',
            ActiveHikeSession.schema.path('movingTimeSec').defaultValue === undefined,
            String(ActiveHikeSession.schema.path('movingTimeSec').defaultValue));

        // =================================================================================
        console.log('\n--- 8. DAL VIVO: /import-gpx misura il cammino e aggiorna il passo ---');

        let serverAcceso = false;
        try { await fetch(BASE + '/api/auth/demo-accounts'); serverAcceso = true; } catch { /* non acceso */ }

        if (!serverAcceso) {
            console.log(`     (server non acceso su ${BASE}: sezione saltata)`);
            console.log('     lancialo con:  node server.js > prove/server-prove.log 2>&1');
        } else {
            const testoGpx = gpxDiProva();

            // Prima di toccare il server: cosa dovrebbe uscire dal file, calcolato qui.
            const letto = parseGpx(testoGpx);
            const attesoStat = statisticheTraccia(letto.punti, SOGLIA_DISLIVELLO_M, haversineKm);
            const attesoTempi = tempiTraccia(letto.punti, haversineKm);
            ok('la traccia sintetica e' + '\' attendibile per tempiTraccia', attesoTempi.attendibile, JSON.stringify(attesoTempi.motivi));
            ok('e contiene una sosta vera (cammino diverso dalla durata totale)',
                attesoTempi.movimentoSec > 0 && attesoTempi.movimentoSec < attesoTempi.totaleSec,
                `${attesoTempi.movimentoSec}/${attesoTempi.totaleSec}`);

            const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
            ok('elenco degli account demo disponibile', Array.isArray(elenco) && elenco.length >= 1, JSON.stringify(elenco.length));
            // L'ULTIMO: i primi tre sono gia' usati da prova-punto77.js.
            const demo = elenco[elenco.length - 1];
            idDemo = demo.id;
            console.log(`     (account demo usato: ${demo.username})`);

            // Stato PRIMA, per rimetterlo esattamente com'era nel finally.
            statoDemoPrima = await mongoose.connection.collection('users').findOne(
                { _id: new mongoose.Types.ObjectId(String(idDemo)) },
                { projection: { averagePaceUp: 1, averagePaceDown: 1, experienceLevel: 1, completedHikes: 1 } }
            );
            const osservazioniDemoPrima = await recalculatePersonalPace(new mongoose.Types.ObjectId(String(idDemo)));
            // PRECONDIZIONE, non un controllo sul punto 92: se questa cade c'e' un residuo di
            // una prova precedente addosso all'account demo (una traccia "PROVA-92" mai
            // cancellata), e tutti i numeri della sezione risulterebbero sballati per quel
            // motivo e non per un difetto del sito.
            ok('l\'account demo parte pulito, senza nessuna osservazione (precondizione)',
                osservazioniDemoPrima.osservazioni.length === 0, JSON.stringify(osservazioniDemoPrima.osservazioni));

            const accesso = await fetch(BASE + '/api/auth/demo-login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: idDemo })
            });
            const cookie = (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
                .filter(Boolean).map(c => c.split(';')[0]).join('; ');
            ok('accesso demo riuscito', accesso.status === 200 && !!cookie, String(accesso.status));

            // SI ASPETTA UNA CONDIZIONE VERA, non un tempo fisso. Le sessioni stanno su
            // MongoDB Atlas (db/sessionStore.js, connect-mongo): la risposta di demo-login
            // torna prima che il documento di sessione sia leggibile, e la richiesta subito
            // dopo si becca un 401 che NON e' un difetto del sito - visto succedere davvero
            // il 17/08/2026 mentre si scriveva questa prova.
            let sessioneViva = false;
            for (let i = 0; i < 50 && !sessioneViva; i++) {
                const io = await chiama('GET', '/api/auth/me', null, cookie);
                sessioneViva = io.status === 200 && !!io.corpo &&
                    String(io.corpo.id || io.corpo._id) === String(idDemo);
                if (!sessioneViva) await new Promise(r => setTimeout(r, 100));
            }
            ok('la sessione demo e' + '\' davvero attiva sul server', sessioneViva);

            const importazione = await chiama('POST', '/api/tracking/import-gpx', { gpx: testoGpx }, cookie);
            ok('importazione accettata', importazione.status === 200, `${importazione.status} ${importazione.testo.slice(0, 200)}`);
            sessioneDemo = importazione.corpo && importazione.corpo.id;
            timbriRegalati = (importazione.corpo && importazione.corpo.badge) || [];
            ok('la traccia di prova non ha regalato timbri all\'account demo',
                timbriRegalati.length === 0, JSON.stringify(timbriRegalati));
            // Senza id non c'e' niente da guardare, e proseguire vorrebbe solo dire morire
            // su un ObjectId non valido portandosi via anche la pulizia leggibile.
            if (!sessioneDemo) throw new Error('importazione non riuscita: sezione 8 interrotta');

            const salvata = await mongoose.connection.collection('activehikesessions')
                .findOne({ _id: new mongoose.Types.ObjectId(String(sessioneDemo)) });
            ok('la sessione salvata ha un movingTimeSec valorizzato',
                !!(salvata && salvata.movingTimeSec > 0), String(salvata && salvata.movingTimeSec));
            ok('movingTimeSec e' + '\' quello misurato sui punti COMPLETI del file',
                salvata && salvata.movingTimeSec === attesoTempi.movimentoSec,
                `${salvata && salvata.movingTimeSec} contro ${attesoTempi.movimentoSec}`);
            ok('e' + '\' il tempo di CAMMINO, non la durata totale: la sosta e' + '\' esclusa',
                salvata && salvata.movingTimeSec < attesoTempi.totaleSec,
                `${salvata && salvata.movingTimeSec} contro ${attesoTempi.totaleSec}`);
            // La prova che il calcolo DEVE stare prima della semplificazione: di 241 punti
            // ne restano pochissimi, troppo pochi (e troppo radi) perche' tempiTraccia possa
            // dire qualcosa se venisse chiamata dopo.
            ok('i punti salvati sono molti meno di quelli letti (semplificazione)',
                importazione.corpo.puntiSalvati < importazione.corpo.puntiLetti / 10,
                `${importazione.corpo.puntiSalvati} su ${importazione.corpo.puntiLetti}`);
            ok('sui punti semplificati tempiTraccia non saprebbe piu' + '\' dire niente',
                tempiTraccia(salvata.points, haversineKm).attendibile === false);

            const attesoPasso = Math.round(paceUpDaMisura(salvata.elevationGainM, salvata.distanceKm, salvata.movingTimeSec / 3600));
            ok('la risposta rimanda l\'utente aggiornato', !!(importazione.corpo && importazione.corpo.user),
                Object.keys(importazione.corpo || {}).join(','));
            ok('nella risposta il passo e' + '\' quello misurato dalla traccia appena caricata',
                importazione.corpo.user && importazione.corpo.user.averagePaceUp === attesoPasso,
                `${importazione.corpo.user && importazione.corpo.user.averagePaceUp} contro ${attesoPasso}`);
            ok('ed e' + '\' un passo umanamente plausibile, non un artefatto',
                attesoPasso >= 100 && attesoPasso <= 900, `${attesoPasso} m/h`);

            const utenteDopo = await mongoose.connection.collection('users')
                .findOne({ _id: new mongoose.Types.ObjectId(String(idDemo)) }, { projection: { averagePaceUp: 1, averagePaceDown: 1 } });
            ok('e il passo e' + '\' anche stato SALVATO, non solo rimandato indietro',
                utenteDopo && utenteDopo.averagePaceUp === attesoPasso,
                `${utenteDopo && utenteDopo.averagePaceUp} contro ${attesoPasso}`);
            ok('la risposta non si porta dietro la password',
                !Object.prototype.hasOwnProperty.call(importazione.corpo.user, 'passwordHash'),
                Object.keys(importazione.corpo.user).join(','));

            // Cancellare la traccia toglie l'osservazione: il passo non puo' restare li'
            // orfano di qualunque misura.
            const cancellazione = await chiama('DELETE', `/api/tracking/sessions/${sessioneDemo}`, null, cookie);
            ok('cancellazione della traccia accettata', cancellazione.status === 200, String(cancellazione.status));
            const utenteDopoCancellazione = await mongoose.connection.collection('users')
                .findOne({ _id: new mongoose.Types.ObjectId(String(idDemo)) }, { projection: { averagePaceUp: 1, averagePaceDown: 1 } });
            ok('cancellata l\'unica traccia misurata, il passo non resta orfano',
                !Object.prototype.hasOwnProperty.call(utenteDopoCancellazione, 'averagePaceUp'),
                JSON.stringify(utenteDopoCancellazione));
            const ancora = await mongoose.connection.collection('activehikesessions')
                .countDocuments({ _id: new mongoose.Types.ObjectId(String(sessioneDemo)) });
            ok('e la traccia e' + '\' sparita davvero dal database', ancora === 0, String(ancora));
            if (ancora === 0) sessioneDemo = null;
        }

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        // Se la sezione 7 e' morta a meta', il monkeypatch va comunque tolto.
        if (findVero) ActiveHikeSession.find = findVero;

        // --- pulizia: SEMPRE filtrata per l'userId di prova, mai una deleteMany generica ---
        await ActiveHikeSession.deleteMany({ userId: UTENTE_FINTO }).catch(() => {});
        await Completion.deleteMany({ userId: UTENTE_FINTO }).catch(() => {});
        if (hikeFinto) await Hike.deleteOne({ _id: hikeFinto._id, creatorId: UTENTE_FINTO }).catch(() => {});

        // --- account demo: rimesso esattamente com'era, letto PRIMA di toccarlo ---
        if (idDemo) {
            const idDemoOggetto = new mongoose.Types.ObjectId(String(idDemo));
            if (sessioneDemo) {
                await mongoose.connection.collection('activehikesessions').deleteMany({
                    _id: new mongoose.Types.ObjectId(String(sessioneDemo)), userId: idDemoOggetto
                }).catch(() => {});
            }
            if (timbriRegalati.length) {
                await Stamp.deleteMany({ userId: idDemoOggetto, stampId: { $in: timbriRegalati.map(t => t.stampId) } }).catch(() => {});
            }
            if (statoDemoPrima) {
                const set = {}, unset = {};
                for (const campo of ['averagePaceUp', 'averagePaceDown', 'experienceLevel', 'completedHikes']) {
                    if (Object.prototype.hasOwnProperty.call(statoDemoPrima, campo)) set[campo] = statoDemoPrima[campo];
                    else unset[campo] = 1;
                }
                const modifiche = {};
                if (Object.keys(set).length) modifiche.$set = set;
                if (Object.keys(unset).length) modifiche.$unset = unset;
                await mongoose.connection.collection('users').updateOne({ _id: idDemoOggetto }, modifiche).catch(() => {});
                const rimesso = await mongoose.connection.collection('users').findOne(
                    { _id: idDemoOggetto },
                    { projection: { averagePaceUp: 1, averagePaceDown: 1, experienceLevel: 1, completedHikes: 1 } }
                );
                // Campo per campo, mai JSON.stringify sui due documenti interi: dopo un
                // $set/$unset MongoDB puo' restituire le chiavi in un ORDINE diverso, e il
                // confronto fra le due stringhe fallirebbe con gli stessi identici valori.
                const campiDaRimettere = ['averagePaceUp', 'averagePaceDown', 'experienceLevel', 'completedHikes'];
                const uguali = campiDaRimettere.every(c =>
                    Object.prototype.hasOwnProperty.call(rimesso, c) === Object.prototype.hasOwnProperty.call(statoDemoPrima, c) &&
                    rimesso[c] === statoDemoPrima[c]);
                ok('l\'account demo e' + '\' stato rimesso esattamente com\'era',
                    uguali, `${JSON.stringify(rimesso)} contro ${JSON.stringify(statoDemoPrima)}`);
            }
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            sessioni: await mongoose.connection.collection('activehikesessions').countDocuments(),
            completamenti: await mongoose.connection.collection('completions').countDocuments(),
            escursioni: await mongoose.connection.collection('hikes').countDocuments(),
            timbri: await mongoose.connection.collection('stamps').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        for (const chiave of Object.keys(partenza)) {
            ok(`nessun documento di prova rimasto: ${chiave}`, fine[chiave] === partenza[chiave],
                `${partenza[chiave]} -> ${fine[chiave]}`);
        }

        await mongoose.disconnect().catch(() => {});
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
