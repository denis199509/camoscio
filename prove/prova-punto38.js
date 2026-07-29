// ==========================================================================
// PROVA DEL PUNTO 38 - "TORNA ALL'INIZIO", cioe' chiudere l'anello.
//
// COSA SORVEGLIA DAVVERO. Il tasto in se' e' facile; quello che si puo' rompere in silenzio
// sono i NUMERI. Prima del punto 38 un progetto Campo Imperatore -> Corno Grande mostrava i
// chilometri della SOLA ANDATA, e chi leggeva "8,4 km" pensava alla giornata. Se l'anello si
// chiudesse "quasi" - per esempio tornando a un punto vicino ma non a quello di partenza, o
// dimenticando il ritorno nel salvataggio della bozza - il sito tornerebbe a dire un numero
// plausibile e falso, senza nessun errore a schermo. E' esattamente il genere di difetto per
// cui esiste questa cartella.
//
// I CONTROLLI CHE CONTANO sono il 2 (l'anello si chiude DAVVERO sul punto 1), il 3 (la
// distanza raddoppia) e il 7 (la bozza salvata conserva i chilometri dell'anello, non
// dell'andata).
//
// SCRIVE SUL DATABASE, ma solo bozze di prova: si cancellano in un blocco finally FILTRATO
// PER userId dell'account demo, e i conteggi si riconfrontano alla fine. E' la regola nata
// dall'incidente del 2026-07-27, quando una pulizia non filtrata cancello' un timbro vero.
// I nomi delle bozze cominciano tutti con "PROVA38" apposta: e' la seconda difesa, quella
// che funziona anche quando la prima si dimentica.
//
// Lanciarla:  node prove/prova-punto38.js      (serve il server acceso su localhost:3000)
// ==========================================================================

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { progettaPercorso } = require('../lib/trailGraph');
const { quoteDelPercorso, passoPerLinea } = require('../lib/elevation');

const BASE = 'http://localhost:3000';
const NOME_PROVA = 'PROVA38';

let passati = 0, falliti = 0, saltati = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
function salta(nome, motivo) { saltati++; console.log(`  [SALTATO] ${nome} — ${motivo}`); }

// I due punti dell'esempio di Denis, COPIATI DA prove/prova-punto33.js e non riscritti a
// occhio: sono le coordinate gia' verificate al punto 13, dove risulta che i due stanno
// nella stessa rete di sentieri.
// Al primo giro erano state scritte a mano (42.4520 invece di 42.46930, cioe' quasi due
// chilometri piu' in la') e il controllo "resta sui sentieri" falliva: il percorso usciva
// dalla rete e veniva tirato in linea d'aria. Non era il sito a sbagliare, era la prova -
// che e' la trappola scritta in LEGGIMI-PROVE.txt, incontrata di nuovo.
const CAMPO_IMPERATORE = [13.55927, 42.44336];
const SELLA_MONTE_AQUILA = [13.56550, 42.46930];

// Stessa regola del browser (puntiDaPercorrere in public/js/routeplanner.js). E' scritta due
// volte, e va bene che lo sia: qui serve proprio a controllare che il server veda quello che
// il browser gli manda. Se un domani cambia di la', questa prova deve fallire.
const chiudi = punti => [...punti, punti[0]];

// Open-Meteo ha un tetto. Se sta frenando, i controlli sulle quote NON provano niente:
// farli fallire direbbe "il sito e' rotto" quando il sito e' a posto.
async function fonteRisponde() {
    return (await quoteDelPercorso([[13.5, 42.4], [13.5002, 42.4002]])) !== null;
}

async function chiamata(percorso, opzioni, cookie) {
    const res = await fetch(BASE + percorso, {
        ...opzioni,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opzioni.headers || {}) }
    });
    let corpo = null;
    try { corpo = await res.json(); } catch (e) { /* alcune risposte non sono json */ }
    return { stato: res.status, corpo, cookie: res.headers.get('set-cookie') };
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    // I conteggi di partenza si LEGGONO, non si scrivono a mano: una prova che pretende
    // "6 sessioni" comincia a fallire da sola appena l'utente aggiunge dati suoi.
    const partenza = { bozze: await mongoose.connection.collection('routedrafts').countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    let idDemo = null;

    try {
        // ==================================================================
        // 1. LA REGOLA DELLA CHIUSURA
        // ==================================================================
        console.log('1. La regola che chiude l\'anello');
        const tre = [[13.55, 42.44], [13.56, 42.45], [13.57, 42.44]];
        ok('l\'anello aggiunge un punto solo', chiudi(tre).length === tre.length + 1);
        ok('il punto aggiunto e\' esattamente il primo',
            chiudi(tre)[3][0] === tre[0][0] && chiudi(tre)[3][1] === tre[0][1]);
        // Il difetto che questo controllo esclude: se la tappa nuova finisse DOPO il ritorno,
        // il percorso passerebbe dalla macchina a meta' gita. E' il motivo per cui l'anello e'
        // un interruttore e non un punto dentro l'elenco.
        const conQuarta = [...tre, [13.58, 42.46]];
        ok('una tappa aggiunta dopo la chiusura finisce PRIMA del ritorno',
            chiudi(conQuarta)[3][0] === 13.58 && chiudi(conQuarta)[4][0] === tre[0][0]);

        // ==================================================================
        // 2. IL PERCORSO SI CHIUDE DAVVERO SUL PUNTO 1
        // ==================================================================
        console.log('\n2. Il percorso calcolato torna al punto di partenza');
        const andata = await progettaPercorso([CAMPO_IMPERATORE, SELLA_MONTE_AQUILA],
            { agganciaAiSentieri: true, saltaQuote: true });
        const anello = await progettaPercorso(chiudi([CAMPO_IMPERATORE, SELLA_MONTE_AQUILA]),
            { agganciaAiSentieri: true, saltaQuote: true });

        ok('l\'andata da sola ha una tappa', andata.tappe.length === 1, `${andata.tappe.length}`);
        ok('l\'anello ne ha due (andata e ritorno)', anello.tappe.length === 2, `${anello.tappe.length}`);

        const ultimo = anello.tappe[anello.tappe.length - 1].coordinate.slice(-1)[0];
        const scartoM = Math.hypot(
            (ultimo[0] - CAMPO_IMPERATORE[0]) * 82000,
            (ultimo[1] - CAMPO_IMPERATORE[1]) * 111320
        );
        // IL CONTROLLO PIU' IMPORTANTE DELLA PROVA: "quasi al punto di partenza" non e'
        // tornare alla macchina.
        ok('l\'ultimo punto del percorso E\' il punto di partenza', scartoM < 1, `scarto ${scartoM.toFixed(2)} m`);

        // ==================================================================
        // 3. LA DISTANZA COMPRENDE IL RITORNO
        // ==================================================================
        console.log('\n3. I chilometri sono quelli della giornata, non della meta\'');
        const rapporto = anello.metriTotali / andata.metriTotali;
        ok('un andata-e-ritorno misura circa il doppio della sola andata',
            rapporto > 1.8 && rapporto < 2.2,
            `andata ${andata.metriTotali} m, anello ${anello.metriTotali} m (x${rapporto.toFixed(2)})`);
        ok('l\'esempio di Denis resta sui sentieri, anche al ritorno',
            anello.tappe.every(t => t.tipo === 'sentiero'),
            anello.tappe.map(t => t.tipo).join(' + '));

        // ==================================================================
        // 4. SALITA E DISCESA SI PAREGGIANO
        // ==================================================================
        // Tornando al punto da cui si e' partiti si scende esattamente quanto si e' salito.
        // E' il controllo che si accorgerebbe di un ritorno calcolato su una linea sbagliata
        // anche quando la distanza tornasse per caso.
        console.log('\n4. Su un anello si scende quanto si e\' saliti');
        if (!(await fonteRisponde())) {
            salta('salita e discesa si pareggiano', 'la fonte delle quote non risponde adesso');
        } else {
            const conQuote = await progettaPercorso(chiudi([CAMPO_IMPERATORE, SELLA_MONTE_AQUILA]),
                { agganciaAiSentieri: true });
            if (!conQuote.dislivelloDisponibile) {
                salta('salita e discesa si pareggiano', 'le quote non sono arrivate per questo percorso');
            } else {
                const differenza = Math.abs(conQuote.salitaM - conQuote.discesaM);
                ok('salita e discesa si pareggiano su un anello',
                    differenza <= Math.max(15, conQuote.salitaM * 0.06),
                    `salita ${conQuote.salitaM} m, discesa ${conQuote.discesaM} m`);
                ok('il dislivello dell\'anello e\' dichiarato disponibile', conQuote.dislivelloDisponibile === true);
            }
        }

        // ==================================================================
        // 5. OLTRE I 25 KM SI DICE LA CAUSA VERA
        // ==================================================================
        // Il difetto che questo controllo copre esisteva gia' prima del punto 38, ma chiudere
        // l'anello raddoppia la lunghezza e lo rende facile da incontrare: il pannello diceva
        // "la fonte non ha risposto, riprova fra poco" su un percorso che non funzionera' mai.
        console.log('\n5. Oltre i 25 km il motivo dichiarato e\' la lunghezza, non la fonte');
        const lineaDiKm = km => [[13.5, 42.4], [13.5 + km / 82.5, 42.4]];
        ok('a 20 km le quote si possono ancora stimare', passoPerLinea(lineaDiKm(20)) !== null);
        ok('oltre i 25 km passoPerLinea rinuncia', passoPerLinea(lineaDiKm(30)) === null);

        const troppoLungo = await progettaPercorso([[13.5, 42.4], [13.5 + 40 / 82.5, 42.4]],
            { agganciaAiSentieri: false });
        ok('un percorso oltre i 25 km non dichiara il dislivello',
            troppoLungo.dislivelloDisponibile === false);
        ok('...e dice che il motivo e\' la LUNGHEZZA, non la fonte muta',
            troppoLungo.motivoDislivello === 'troppo lungo', String(troppoLungo.motivoDislivello));

        const fonteGuasta = await progettaPercorso([CAMPO_IMPERATORE, SELLA_MONTE_AQUILA],
            { agganciaAiSentieri: true, saltaQuote: true });
        ok('con la fonte guasta il motivo dichiarato e\' invece la fonte',
            fonteGuasta.motivoDislivello === 'fonte', String(fonteGuasta.motivoDislivello));

        // ==================================================================
        // 6-8. IL GIRO COMPLETO CONTRO IL SERVER VERO
        // ==================================================================
        console.log('\n6. Il server vero: accesso con un account demo');
        let cookie = null;
        try {
            const elenco = await chiamata('/api/auth/demo-accounts', { method: 'GET' });
            // TRAPPOLA GIA' PAGATA: questa rotta espone "id", NON "_id". Con _id il login
            // demo risponde 400 e la pulizia finale non cancella niente.
            const demo = elenco.corpo && elenco.corpo[0];
            const entra = await chiamata('/api/auth/demo-login', {
                method: 'POST', body: JSON.stringify({ userId: demo.id })
            });
            cookie = entra.cookie ? entra.cookie.split(';')[0] : null;
            idDemo = demo.id;
            ok('si entra con un account demo', entra.stato === 200 && !!cookie, `stato ${entra.stato}`);
        } catch (e) {
            salta('il giro contro il server vero', 'il server non risponde su ' + BASE);
        }

        if (cookie) {
            console.log('\n7. La bozza salvata conserva i chilometri dell\'anello');
            const salva = await chiamata('/api/routing/drafts', {
                method: 'POST',
                body: JSON.stringify({
                    nome: `${NOME_PROVA} anello`,
                    punti: [CAMPO_IMPERATORE, SELLA_MONTE_AQUILA],
                    anello: true,
                    agganciaAiSentieri: true
                })
            }, cookie);
            ok('la bozza ad anello si salva', salva.stato === 200, `stato ${salva.stato}`);
            if (salva.stato === 200) {
                const b = salva.corpo;
                ok('la bozza si ricorda di essere un anello', b.anello === true, String(b.anello));
                // I punti SALVATI restano quelli toccati: il ritorno e' un'intenzione, non una
                // tappa. Se qui ne comparissero tre, riaprendo la bozza si vedrebbe un
                // segnaposto fantasma sopra quello di partenza.
                ok('salva le due tappe scelte, non tre', b.punti.length === 2, `${b.punti.length} punti`);
                // IL CONTROLLO CHE DICE SE IL LAVORO E' SERVITO: i metri salvati sono quelli
                // dell'anello. Se fossero quelli dell'andata, l'elenco dei progetti tornerebbe
                // a dire la meta' dei chilometri veri.
                ok('i metri salvati sono quelli dell\'ANELLO, non dell\'andata',
                    Math.abs(b.metriTotali - anello.metriTotali) < anello.metriTotali * 0.1,
                    `salvati ${b.metriTotali} m, anello ${anello.metriTotali} m, andata ${andata.metriTotali} m`);
            }

            const salvaAndata = await chiamata('/api/routing/drafts', {
                method: 'POST',
                body: JSON.stringify({
                    nome: `${NOME_PROVA} sola andata`,
                    punti: [CAMPO_IMPERATORE, SELLA_MONTE_AQUILA],
                    agganciaAiSentieri: true
                })
            }, cookie);
            if (salvaAndata.stato === 200) {
                // default: undefined e non false - vincolo hard sullo spazio. Il campo NON deve
                // proprio esistere sul documento di una sola andata.
                ok('una bozza di sola andata non scrive il campo anello',
                    salvaAndata.corpo.anello === undefined, String(salvaAndata.corpo.anello));
            } else {
                ok('la bozza di sola andata si salva', false, `stato ${salvaAndata.stato}`);
            }

            console.log('\n8. Il tetto delle tappe tiene conto del ritorno');
            const venticinque = Array.from({ length: 25 }, (_, i) => [13.55 + i * 0.001, 42.44]);
            const troppe = await chiamata('/api/routing/drafts', {
                method: 'POST',
                body: JSON.stringify({ nome: `${NOME_PROVA} troppe`, punti: venticinque, anello: true })
            }, cookie);
            ok('25 tappe piu\' il ritorno vengono rifiutate', troppe.stato === 400, `stato ${troppe.stato}`);
            ok('...con un messaggio che spiega il perche\', non un errore muto',
                !!(troppe.corpo && /ritorno/i.test(troppe.corpo.error || '')),
                troppe.corpo && troppe.corpo.error);

            // Il percorso chiuso passa da /plan come un percorso qualunque: era la ragione per
            // cui non e' servito toccare quella rotta.
            const plan = await chiamata('/api/routing/plan', {
                method: 'POST',
                body: JSON.stringify({ punti: chiudi([CAMPO_IMPERATORE, SELLA_MONTE_AQUILA]), agganciaAiSentieri: true })
            }, cookie);
            ok('/api/routing/plan accetta un percorso chiuso senza modifiche',
                plan.stato === 200 && plan.corpo.tappe.length === 2, `stato ${plan.stato}`);
        }

    } catch (e) {
        // Stampato QUI, prima del finally: un process.exit dentro il finally ucciderebbe il
        // .catch in fondo e la prova morirebbe senza stampare niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        // PULIZIA SEMPRE FILTRATA PER L'UTENTE DI PROVA, anche se "tanto quel nome ce l'ho
        // solo io". E' la regola nata dal timbro vero cancellato il 2026-07-27.
        if (idDemo) {
            const via = await mongoose.connection.collection('routedrafts').deleteMany({
                userId: new mongoose.Types.ObjectId(idDemo),
                nome: { $regex: '^' + NOME_PROVA }
            });
            console.log(`\nPulizia: ${via.deletedCount} bozze di prova cancellate.`);
        }

        const fine = { bozze: await mongoose.connection.collection('routedrafts').countDocuments() };
        console.log('Conteggi finali:  ', fine);
        ok('nessuna bozza creata o persa', fine.bozze === partenza.bozze, `${partenza.bozze} -> ${fine.bozze}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti${saltati ? `, ${saltati} saltati` : ''} ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        if (saltati) {
            console.log(`\nATTENZIONE: ${saltati} controlli SALTATI, cioe' NON FATTI. Rilanciare piu' tardi.`);
        }
        process.exit(falliti ? 1 : 0);
    }
})();
