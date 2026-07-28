// ==========================================================================
// PROVA DEL PUNTO 33 - il dislivello dei percorsi progettati.
//
// COSA SORVEGLIA DAVVERO. Il difetto pericoloso di questa funzionalita' non e' un errore
// che si vede: e' un NUMERO PLAUSIBILE MA FALSO. Chiedendo una quota ogni 25 m a un dato
// che ha celle da 90 m, il profilo oscilla dentro la stessa cella e ogni tremolio viene
// contato come salita: misurato il 2026-07-28, 2204 m su un percorso che ne ha 1173. Il
// +79%. Nessun errore a schermo, nessuna eccezione: solo un numero sbagliato su un dato
// che serve a decidere se un'escursione e' sicura per te.
// Per questo i controlli 3 e 4 qui sotto sono il cuore della prova.
//
// NON SCRIVE NIENTE SUL DATABASE. Le due tracce vere dell'utente si leggono e basta; i
// conteggi si rileggono comunque alla fine, perche' una prova che "tanto non scrive" e'
// esattamente quella che lascia documenti in giro.
//
// Lanciarla:  node prove/prova-punto33.js         (non serve il server acceso)
// ==========================================================================

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { quoteDelPercorso, campionaLinea, lisciaQuote, passoPerLinea,
        quoteRicordate, dimenticaQuote,
        PASSO_M, LISCIATURA_M, MAX_PUNTI } = require('../lib/elevation');
const { statisticheTraccia, SOGLIA_DISLIVELLO_M } = require('../lib/gpx');
const { haversineKm } = require('../lib/geometry');

let passati = 0, falliti = 0, saltati = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
function salta(nome, motivo) { saltati++; console.log(`  [SALTATO] ${nome} — ${motivo}`); }

// Open-Meteo e' gratuito e ha un tetto (10.000 chiamate al giorno, 600 al minuto). Se in
// questo momento sta frenando, i controlli che dipendono da lui NON provano niente: farli
// fallire direbbe "il sito e' rotto" quando il sito e' a posto. E' la regola scritta in
// LEGGIMI-PROVE.txt - quando una prova fallisce, sospettare prima la prova.
// Quindi si bussa una volta sola, con un punto solo, e si decide.
async function fonteRisponde() {
    const esito = await quoteDelPercorso([[13.5, 42.4], [13.5002, 42.4002]]);
    return esito !== null;
}

// QUESTA PROVA CONSUMA PIU' DEL SITO, ed e' normale: il sito chiede al massimo 500 punti per
// un percorso, la prova ne chiede quasi mille perche' controlla DUE tracce vere di fila. Il
// tetto e' ~600 punti al minuto, quindi fra una traccia e l'altra bisogna lasciar respirare
// la fonte, altrimenti la seconda verrebbe saltata e il controllo piu' importante non si
// farebbe mai.
// Si aspetta una CONDIZIONE VERA (la fonte che torna a rispondere), non un tempo fisso.
async function attendiFonte(tentativi = 8) {
    for (let i = 1; i <= tentativi; i++) {
        if (await fonteRisponde()) return true;
        console.log(`     (la fonte sta frenando: aspetto che si liberi, tentativo ${i}/${tentativi})`);
        await new Promise(r => setTimeout(r, 20000));
    }
    return false;
}

const salita = tuple => statisticheTraccia(tuple, SOGLIA_DISLIVELLO_M, haversineKm).dislivelloM;

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const partenza = {
        sessioni: await mongoose.connection.collection('activehikesessions').countDocuments(),
        bozze: await mongoose.connection.collection('routedrafts').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    try {
        // --- 1. Il campionamento ---
        console.log('1. Campionamento della linea');
        const linea = [[13.5000, 42.4000], [13.5200, 42.4000]];   // ~1,6 km in orizzontale
        const { punti, totaleM } = campionaLinea(linea, PASSO_M);
        ok('la linea viene campionata a passo fisso', punti.length > 50, `${punti.length} punti`);
        const distanze = [];
        for (let i = 1; i < punti.length; i++) distanze.push(haversineKm(punti[i-1][1], punti[i-1][0], punti[i][1], punti[i][0]) * 1000);
        const scartoMax = Math.max(...distanze.map(d => Math.abs(d - PASSO_M)));
        ok(`i punti distano ${PASSO_M} m l'uno dall'altro`, scartoMax < 1, `scarto massimo ${scartoMax.toFixed(2)} m`);
        ok('il campionamento copre tutta la linea', Math.abs(totaleM - punti.length * PASSO_M) < PASSO_M * 2,
            `linea ${Math.round(totaleM)} m, campionata ${punti.length} punti`);

        // --- 1b. Il passo si adatta alla lunghezza, per non sbattere nel tetto della fonte ---
        // Misurato il 2026-07-28: la fonte frena oltre ~600 punti chiesti nello stesso minuto,
        // comunque li si raggruppi. Un percorso da 18 km a passo 25 m ne chiederebbe 755, cioe'
        // NON FUNZIONEREBBE MAI. Questi controlli sorvegliano proprio quel confine.
        console.log('\n1b. Il passo si allarga quando il percorso e\' lungo');
        const lineaDiKm = km => [[13.5, 42.4], [13.5 + km / 82.5, 42.4]];
        ok('un percorso corto usa il passo buono da 25 m', passoPerLinea(lineaDiKm(6)) === 25);
        ok('a 12 km si usa ancora il passo da 25 m', passoPerLinea(lineaDiKm(12)) === 25);
        ok('a 20 km il passo si allarga a 50 m invece di sfondare il tetto', passoPerLinea(lineaDiKm(20)) === 50);
        ok('oltre i 25 km si rinuncia, invece di dare un numero che non regge',
            passoPerLinea(lineaDiKm(30)) === null, String(passoPerLinea(lineaDiKm(30))));
        for (const km of [1, 6, 12, 13, 20, 25]) {
            const p = passoPerLinea(lineaDiKm(km));
            const quanti = Math.round(km * 1000 / p);
            ok(`a ${km} km si chiedono ${quanti} punti, sotto il tetto`, quanti <= MAX_PUNTI, `${quanti} punti`);
        }

        // --- 1c. La memoria delle quote ---
        // PERCHE' CONTA: il pannello ricalcola il percorso a OGNI punto aggiunto. Senza
        // memoria, progettare una gita da cinque tappe chiederebbe alla fonte fino a 2.500
        // punti - meta' del tetto orario per un percorso solo, e il dislivello sparirebbe
        // proprio mentre lo si sta usando.
        // Qui la fonte viene FINTA e si contano le chiamate: e' l'unico modo di provare che
        // non se ne fanno, invece di sperarlo.
        console.log('\n1c. Ripianificare lo stesso percorso non ripete le domande');
        dimenticaQuote();
        const fetchOriginale = global.fetch;
        let chiamateFatte = 0;
        global.fetch = async (url) => {
            chiamateFatte++;
            const quanti = url.match(/latitude=([^&]*)/)[1].split(',').length;
            return { ok: true, json: async () => ({ elevation: Array(quanti).fill(2000) }) };
        };
        try {
            const stessaLinea = [[13.50, 42.40], [13.52, 42.41]];
            const primo = await quoteDelPercorso(stessaLinea);
            const dopoIlPrimo = chiamateFatte;
            const secondo = await quoteDelPercorso(stessaLinea);
            ok('il primo calcolo interroga la fonte', dopoIlPrimo > 0, `${dopoIlPrimo} chiamate`);
            ok('ricalcolare lo stesso percorso non la interroga di nuovo',
                chiamateFatte === dopoIlPrimo, `${chiamateFatte - dopoIlPrimo} chiamate in piu'`);
            ok('e il risultato e\' identico', primo.salitaM === secondo.salitaM && primo.quotaMinM === secondo.quotaMinM);

            // Il caso vero: si aggiunge una tappa a un percorso gia' progettato.
            const prima = chiamateFatte;
            await quoteDelPercorso([[13.50, 42.40], [13.52, 42.41], [13.54, 42.42]]);
            ok('estendendo il percorso si chiede solo il tratto nuovo',
                chiamateFatte - prima <= 1, `${chiamateFatte - prima} chiamate per il tratto aggiunto`);
            ok('la memoria non cresce oltre il suo tetto', quoteRicordate.size <= 20000, `${quoteRicordate.size} quote`);
        } finally {
            global.fetch = fetchOriginale;
            dimenticaQuote();   // le quote finte non devono restare in giro per i controlli veri
        }

        // --- 2. La lisciatura non mangia la montagna vera ---
        console.log('\n2. La lisciatura conserva la salita vera');
        const finestra = Math.round(LISCIATURA_M / PASSO_M);
        // Salita regolare di 600 m su 3 km: dopo la lisciatura deve restare 600 m.
        const rampa = [];
        for (let i = 0; i <= 120; i++) rampa.push(1000 + i * 5);
        const rampaLisciata = lisciaQuote(rampa, finestra);
        const tupleRampa = rampaLisciata.map((q, i) => [13.5 + i * 0.0003, 42.4, q]);
        const salitaRampa = salita(tupleRampa);
        ok('una salita regolare da 600 m resta 600 m dopo la lisciatura',
            Math.abs(salitaRampa - 600) < 25, `${salitaRampa} m`);

        // --- 3. IL CONTROLLO CHE CONTA: il rumore NON diventa dislivello ---
        console.log('\n3. Il tremolio del dato non deve diventare salita  <- il difetto vero');
        // Percorso PIATTO a 2000 m con l'oscillazione tipica di un modello a celle letto
        // troppo fitto: senza lisciare produce centinaia di metri di salita inventata.
        const piatto = [];
        for (let i = 0; i <= 400; i++) piatto.push(2000 + Math.sin(i * 1.7) * 6 + Math.sin(i * 0.9) * 4);
        const tuplePiattoGrezzo = piatto.map((q, i) => [13.5 + i * 0.0003, 42.4, q]);
        const salitaGrezza = salita(tuplePiattoGrezzo);
        const tuplePiattoLiscio = lisciaQuote(piatto, finestra).map((q, i) => [13.5 + i * 0.0003, 42.4, q]);
        const salitaLiscia = salita(tuplePiattoLiscio);
        console.log(`     su un percorso PIATTO: senza lisciare ${salitaGrezza} m, lisciando ${salitaLiscia} m`);
        ok('senza lisciare il rumore produrrebbe dislivello inventato (e\' il difetto che si sorveglia)',
            salitaGrezza > 100, `${salitaGrezza} m`);
        ok('lisciando, un percorso piatto da' + ' zero o quasi', salitaLiscia < 30, `${salitaLiscia} m`);

        // --- 4. Le due escursioni VERE dell'utente ---
        console.log('\n4. Confronto col dislivello vero di due escursioni fatte davvero');
        const vere = await mongoose.connection.collection('activehikesessions')
            .find({ importedFrom: 'gpx' }).toArray();
        ok('le tracce vere di riferimento ci sono ancora sul database', vere.length >= 1, `${vere.length} tracce`);

        const disponibile = await attendiFonte();
        if (!disponibile) console.log('     (la fonte delle quote non risponde adesso: i controlli che dipendono da lei vengono saltati)');

        let primaTraccia = true;
        for (const s of (disponibile ? vere : [])) {
            if (!primaTraccia) await attendiFonte();   // vedi attendiFonte
            primaTraccia = false;
            const nome = (s.importedName || String(s._id)).slice(0, 28);
            // Riferimento onesto: le quote VERE dell'altimetro sugli STESSI punti che si
            // daranno alla fonte. Il dislivello salvato e' stato calcolato sulla traccia
            // completa, prima della semplificazione, quindi confrontarsi con quello
            // attribuirebbe al modello del terreno anche il costo della semplificazione.
            const riferimento = salita(s.points.map(p => [p[0], p[1], p[2]]));
            // Si riprova qualche volta: una traccia vera sono ~500 punti, e se il minuto in
            // corso e' gia' mezzo consumato la richiesta cade a meta'. Non e' un difetto del
            // sito - il sito non chiede mai due tracce di fila - ma qui il confronto col
            // dislivello vero e' il controllo piu' importante di tutta la prova, e vale la
            // pena aspettare invece di saltarlo.
            let esito = null;
            for (let tentativo = 1; tentativo <= 4 && !esito; tentativo++) {
                esito = await quoteDelPercorso(s.points.map(p => [p[0], p[1]]));
                if (!esito && tentativo < 4) {
                    console.log(`     (${nome}: la fonte ha frenato, riprovo fra poco — ${tentativo}/3)`);
                    await new Promise(r => setTimeout(r, 30000));
                }
            }
            if (!esito) { salta(`${nome}: confronto col dislivello vero`, 'la fonte non si e\' liberata in due minuti'); continue; }

            const scartoPerc = ((esito.salitaM - riferimento) / riferimento) * 100;
            console.log(`     ${nome}: stimata ${esito.salitaM} m, riferimento ${riferimento} m, salvata ${s.elevationGainM} m`);
            ok(`${nome}: la salita stimata sta entro il 10% di quella vera`,
                Math.abs(scartoPerc) < 10, `scarto ${scartoPerc.toFixed(1)}%`);
            ok(`${nome}: la discesa e' un numero sensato`,
                esito.discesaM > 0 && esito.discesaM < riferimento * 2, `${esito.discesaM} m`);
            ok(`${nome}: la fascia di quota e' vicina a quella vera`,
                Math.abs(esito.quotaMinM - Math.min(...s.points.map(p => p[2]))) < 60 &&
                Math.abs(esito.quotaMaxM - Math.max(...s.points.map(p => p[2]))) < 100,
                `${esito.quotaMinM}-${esito.quotaMaxM} m`);
        }

        // --- 5. Un guasto della fonte NON deve far fallire niente ---
        // E' la regola presa col punto 34: entrare nel sito non dipende da un servizio
        // esterno, e progettare un percorso nemmeno. Qui si rompe fetch davvero, invece di
        // fidarsi di un interruttore.
        console.log('\n5. Con la fonte guasta il percorso si progetta lo stesso');
        const fetchVero = global.fetch;
        global.fetch = async () => { throw new Error('rete interrotta (finto guasto della prova)'); };
        let esitoGuasto, haLanciato = false;
        try { esitoGuasto = await quoteDelPercorso([[13.5, 42.4], [13.52, 42.41]]); }
        catch { haLanciato = true; }
        global.fetch = fetchVero;
        ok('con la fonte guasta non viene lanciata nessuna eccezione', !haLanciato);
        ok('con la fonte guasta si ottiene null, non un numero inventato', esitoGuasto === null, String(esitoGuasto));

        // E la stessa cosa vista dal progettatore di percorsi.
        const { progettaPercorso } = require('../lib/trailGraph');
        global.fetch = async () => { throw new Error('rete interrotta (finto guasto della prova)'); };
        let percorsoGuasto;
        try { percorsoGuasto = await progettaPercorso([[13.55927, 42.44336], [13.56550, 42.46930]], { agganciaAiSentieri: true }); }
        finally { global.fetch = fetchVero; }
        ok('il percorso viene comunque progettato', !!percorsoGuasto && percorsoGuasto.tappe.length > 0);
        ok('e dichiara che il dislivello non c\'e\'', percorsoGuasto.dislivelloDisponibile === false);
        ok('e non spedisce una salita a zero, che sarebbe una bugia',
            percorsoGuasto.salitaM === undefined, String(percorsoGuasto.salitaM));

        // --- 6. Il percorso progettato per davvero ---
        console.log('\n6. Un percorso progettato vero (l\'esempio dell\'utente)');
        await attendiFonte();   // dopo due tracce vere il tetto al minuto e' quasi esaurito
        const t0 = Date.now();
        const percorso = await progettaPercorso([[13.55927, 42.44336], [13.56550, 42.46930]], { agganciaAiSentieri: true });
        const secondi = (Date.now() - t0) / 1000;
        console.log(`     Campo Imperatore -> Sella di Monte Aquila: ${(percorso.metriTotali/1000).toFixed(2)} km in ${secondi.toFixed(1)} s`);
        // Questi due valgono SEMPRE, anche a fonte muta: sono la parte che non dipende da
        // nessun servizio esterno, ed e' proprio quella che deve continuare a funzionare.
        ok('il profilo NON viene spedito al client (pesa e non serve a niente li\')',
            percorso.profilo === undefined);
        ok('la progettazione resta sotto i 15 secondi', secondi < 15, `${secondi.toFixed(1)} s`);

        if (!percorso.dislivelloDisponibile) {
            salta('il dislivello del percorso progettato', 'la fonte delle quote non risponde adesso');
            ok('a fonte muta non viene inventata nessuna salita', percorso.salitaM === undefined, String(percorso.salitaM));
        } else {
            ok('la salita e\' un numero sensato per il Gran Sasso',
                percorso.salitaM > 100 && percorso.salitaM < 3000, `${percorso.salitaM} m`);
            ok('la quota minima sta sopra i 1000 m (siamo a Campo Imperatore)',
                percorso.quotaMinM > 1000, `${percorso.quotaMinM} m`);
            ok('la quota massima non supera il Corno Grande (2912 m)',
                percorso.quotaMaxM <= 2912, `${percorso.quotaMaxM} m`);
            ok('quota minima e massima sono nell\'ordine giusto', percorso.quotaMinM <= percorso.quotaMaxM);
        }

    } catch (e) {
        // Stampato QUI, prima del finally: un process.exit dentro il finally ucciderebbe il
        // .catch in fondo e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        const fine = {
            sessioni: await mongoose.connection.collection('activehikesessions').countDocuments(),
            bozze: await mongoose.connection.collection('routedrafts').countDocuments()
        };
        console.log('\nConteggi finali:  ', fine);
        ok('nessuna sessione creata o persa', fine.sessioni === partenza.sessioni, `${partenza.sessioni} -> ${fine.sessioni}`);
        ok('nessuna bozza creata o persa', fine.bozze === partenza.bozze, `${partenza.bozze} -> ${fine.bozze}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti${saltati ? `, ${saltati} saltati` : ''} ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        if (saltati) {
            console.log(`\nATTENZIONE: ${saltati} controlli SALTATI perche' la fonte delle quote non rispondeva.`);
            console.log('Non vuol dire che vanno bene: vuol dire che non sono stati fatti. Rilanciare piu\' tardi.');
        }
        process.exit(falliti ? 1 : 0);
    }
})();
