// ==========================================================================
// PROVA NEL BROWSER DEL PUNTO 38 - il tasto "Torna all'inizio".
//
// PERCHE' SERVE ANCHE QUESTA, oltre a prove/prova-punto38.js. Quella controlla i NUMERI
// (il server, il salvataggio, i motivi dichiarati); ma il punto 38 vive quasi tutto nel
// browser - l'interruttore, il tasto, la riga del ritorno, il segnaposto che diventa
// "partenza e arrivo". Senza questa prova la parte piu' grossa del lavoro non la guarda
// nessuno, e la controprova dell'altra prova lo ha mostrato: i suoi controlli 1-4 passano
// anche col codice vecchio, perche' provano il motore, non l'interfaccia.
//
// IL CONTROLLO CHE VALE PIU' DI TUTTI e' il 4: una tappa aggiunta DOPO aver chiuso l'anello
// deve finire PRIMA del ritorno. Se finisse dopo, il percorso passerebbe dalla macchina a
// meta' gita e nessun numero se ne accorgerebbe - i chilometri sarebbero anche giusti.
//
// NON SCRIVE NIENTE SUL DATABASE: entra con un account demo e non salva nessuna bozza.
//
// Lanciarla:  node prove/prova-browser-punto38.js     (serve il server su localhost:3000)
// ==========================================================================

const PUPPETEER_PATH = process.env.PUPPETEER_PATH || 'C:/Users/lenovo/node_modules/puppeteer';
const puppeteer = require(PUPPETEER_PATH);
const path = require('path');

const BASE = 'http://localhost:3000';

// Le coordinate gia' verificate al punto 13 (le stesse di prova-punto33.js): Campo
// Imperatore e Sella di Monte Aquila stanno nella stessa rete di sentieri.
const CAMPO_IMPERATORE = { lng: 13.55927, lat: 42.44336 };
const SELLA_MONTE_AQUILA = { lng: 13.56550, lat: 42.46930 };
const TERZA_TAPPA = { lng: 13.57100, lat: 42.46000 };

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Si aspetta una CONDIZIONE VERA, mai un tempo fisso: leggere il DOM "a tempo" da' falsi
// allarmi, ed e' una trappola gia' pagata su questo progetto.
const attendi = (page, fn, arg) => page.waitForFunction(fn, { timeout: 25000 }, arg);

// Il click passa da Leaflet e quindi da onMapClick in map.js, che e' chi consegna il click
// al progettatore: chiamare gestisciClickMappa a mano salterebbe proprio quel collegamento.
async function tocca(page, punto) {
    const prima = await page.evaluate(() => document.querySelectorAll('.rp-punti li').length);
    await page.evaluate(p => {
        window.mapInstance.fire('click', { latlng: window.L.latLng(p.lat, p.lng) });
    }, punto);
    await attendi(page, n => document.querySelectorAll('.rp-punti li').length > n, prima);
}

// Il pannello ricalcola a ogni tappa: si aspetta che il riepilogo ci sia davvero, invece di
// misurare mentre "Sto cercando il percorso..." e' ancora a schermo.
const attendiCalcolo = page => attendi(page, () =>
    document.querySelector('.rp-esito') && !document.querySelector('.rp-esito.attesa'));

const totaleMetri = page => page.evaluate(() => {
    const t = document.querySelector('.rp-totali div strong');
    if (!t) return null;
    const s = t.textContent.trim();
    return s.includes('km') ? parseFloat(s.replace(',', '.')) * 1000 : parseFloat(s);
});

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Gli errori JS si stampano SUBITO: raccolti per la fine si perdono, se lo script muore
    // prima su un timeout (trappola gia' pagata).
    page.on('pageerror', e => console.log('     [errore JS nella pagina]', e.message));

    try {
        await page.setViewport({ width: 1440, height: 900 });

        // --- accesso demo ---
        // /api/auth/demo-accounts espone "id", NON "_id": con _id il login risponde 400 e la
        // pagina resta ferma sull'accesso senza dire perche'.
        console.log('1. Accesso con un account demo');
        await page.goto(BASE + '/demo.html', { waitUntil: 'networkidle2' });
        const entrato = await page.evaluate(async () => {
            const elenco = await (await fetch('/api/auth/demo-accounts')).json();
            const r = await fetch('/api/auth/demo-login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: elenco[0].id })
            });
            return r.ok;
        });
        ok('si entra con un account demo', entrato);

        await page.goto(BASE, { waitUntil: 'networkidle2' });
        // Aspettare currentUser NON BASTA: initApp e' lenta e il progettatore e' in fondo alla
        // catena. Si insiste finche' l'effetto non c'e' davvero.
        await attendi(page, () => !!window.CamoscioRoutePlanner && !!window.mapInstance);
        await page.evaluate(() => document.querySelector('.nav-btn[data-target="map-section"]').click());
        await attendi(page, () => document.getElementById('btn-rp-avvia'));

        // --- il tasto esiste e non e' premibile a vuoto ---
        console.log('\n2. Il tasto c\'e\', e non prima che serva');
        await page.click('#btn-rp-avvia');
        await attendi(page, () => document.getElementById('btn-rp-anello'));
        ok('il tasto "Torna all\'inizio" compare appena si comincia a progettare',
            await page.$('#btn-rp-anello') !== null);
        ok('...ed e\' spento finche\' non ci sono due tappe',
            await page.$eval('#btn-rp-anello', b => b.disabled));
        ok('...e si chiama con le parole di Denis',
            /torna all'inizio/i.test(await page.$eval('#btn-rp-anello', b => b.textContent)));

        await tocca(page, CAMPO_IMPERATORE);
        ok('con una tappa sola e\' ancora spento',
            await page.$eval('#btn-rp-anello', b => b.disabled));
        await tocca(page, SELLA_MONTE_AQUILA);
        ok('con due tappe si accende',
            !(await page.$eval('#btn-rp-anello', b => b.disabled)));

        await attendiCalcolo(page);
        const solaAndata = await totaleMetri(page);
        ok('prima di chiudere, il riquadro dichiara "sola andata"',
            /sola andata/i.test(await page.$eval('.rp-tipo', e => e.textContent)));

        // --- si chiude l'anello ---
        console.log('\n3. Si chiude l\'anello');
        await page.click('#btn-rp-anello');
        await attendi(page, () => document.querySelector('.rp-ritorno'));
        await attendiCalcolo(page);

        ok('compare la riga del ritorno alla partenza',
            /ritorno alla partenza/i.test(await page.$eval('.rp-ritorno', e => e.textContent)));
        ok('il riquadro dichiara "anello"',
            /anello/i.test(await page.$eval('.rp-tipo', e => e.textContent)));
        ok('il tasto diventa "Togli il ritorno", cosi\' si puo\' riaprire',
            /togli il ritorno/i.test(await page.$eval('#btn-rp-anello', b => b.textContent)));

        const conAnello = await totaleMetri(page);
        ok('i chilometri a schermo raddoppiano',
            conAnello > solaAndata * 1.8 && conAnello < solaAndata * 2.2,
            `sola andata ${solaAndata} m, anello ${conAnello} m`);

        // Nessun segnaposto in piu': il ritorno e' lo stesso punto 1.
        const segnaposti = await page.evaluate(() => document.querySelectorAll('.route-point-marker').length);
        ok('non compare un terzo segnaposto sopra il primo', segnaposti === 2, `${segnaposti} segnaposti`);
        ok('il segnaposto 1 dice che li\' si parte E si torna',
            await page.evaluate(() => document.querySelectorAll('.route-point-anello').length === 1));

        // --- IL CONTROLLO CHE CONTA ---
        console.log('\n4. Una tappa aggiunta dopo finisce PRIMA del ritorno');
        await tocca(page, TERZA_TAPPA);
        await attendiCalcolo(page);
        const righe = await page.evaluate(() =>
            [...document.querySelectorAll('.rp-punti li')].map(li => li.className || 'tappa'));
        ok('l\'anello resta chiuso dopo aver aggiunto una tappa',
            righe.filter(c => c.includes('rp-ritorno')).length === 1, righe.join(' | '));
        ok('il ritorno e\' l\'ULTIMA riga, non una in mezzo',
            righe[righe.length - 1].includes('rp-ritorno'), righe.join(' | '));
        ok('le tappe scelte sono tre, piu\' il ritorno', righe.length === 4, `${righe.length} righe`);

        // --- LA CORSA FRA DUE CALCOLI ---
        //
        // Questo controllo nasce da una SCHERMATA, non da un ragionamento: a 390 px il
        // riquadro diceva "Anello" e sotto mostrava 6,6 km con salita 932 m e discesa 221 m,
        // cioe' i numeri della sola andata. Premendo il tasto mentre il calcolo precedente e'
        // ancora in volo partono due richieste, e se la prima risponde per seconda il suo
        // esito resta a schermo sotto l'etichetta sbagliata.
        // Qui la corsa non si spera: si COSTRUISCE, ritardando apposta la prima risposta.
        console.log('\n4b. Una risposta vecchia non sovrascrive quella nuova');
        let risposte = 0;
        let ritardaProssima = false;
        // L'intercettazione si accende ADESSO e non prima di navigare: accesa prima rallenta i
        // caricamenti e refreshState() finisce per riscrivere i dati in memoria (trappola gia'
        // pagata su questo progetto).
        await page.setRequestInterception(true);
        page.on('request', req => {
            const daRitardare = ritardaProssima && req.url().includes('/api/routing/plan') && req.method() === 'POST';
            if (daRitardare) ritardaProssima = false;
            if (daRitardare) setTimeout(() => req.continue().catch(() => {}), 2500);
            else req.continue().catch(() => {});
        });
        const t0 = Date.now();
        page.on('response', res => {
            if (res.url().includes('/api/routing/plan')) {
                risposte++;
                console.log(`     (risposta ${risposte} di /plan a +${Date.now() - t0} ms)`);
            }
        });

        await page.click('#btn-rp-svuota');
        await attendi(page, () => !document.querySelector('.rp-punti'));
        // Quante chiamate a /plan la pagina aveva gia' fatto prima di questa sezione: le voci
        // di performance non si azzerano da sole, quindi il confronto va fatto sul delta.
        const planPrima = await page.evaluate(() =>
            performance.getEntriesByType('resource').filter(r => r.name.includes('/api/routing/plan')).length);
        risposte = 0;
        ritardaProssima = true;
        await tocca(page, CAMPO_IMPERATORE);
        await tocca(page, SELLA_MONTE_AQUILA);   // parte la richiesta LENTA (sola andata)
        await page.click('#btn-rp-anello');      // parte la richiesta VELOCE (anello)

        // SI ASPETTA UN SEGNALE PRESO DENTRO LA PAGINA, non l'evento di Puppeteer.
        // Al primo tentativo qui si aspettava che Node avesse visto due risposte: quell'evento
        // scatta quando il corpo arriva a Node, cioe' PRIMA che la pagina abbia fatto res.json()
        // e assegnato il risultato. La prova leggeva lo schermo un istante troppo presto e
        // passava anche col difetto rimesso - cioe' non stava provando niente. E' la trappola
        // del "misurare a tempo fisso", in veste nuova.
        // performance.getEntriesByType('resource') registra invece il momento in cui LA PAGINA
        // ha finito di scaricare, quindi da li' in poi il danno, se c'e', e' gia' fatto.
        await attendi(page, n => performance.getEntriesByType('resource')
            .filter(r => r.name.includes('/api/routing/plan')).length >= n + 2, planPrima);
        // Un giro completo di rendering dopo l'ultima risposta: aggiornaPannello() viene
        // chiamata nella stessa catena di promesse, quindi due frame la contengono di sicuro.
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await attendiCalcolo(page);

        const quote = await page.evaluate(() => {
            const n = [...document.querySelectorAll('.rp-quote .rp-totali strong')].map(e => parseInt(e.textContent.replace(/\D/g, ''), 10));
            return { salita: n[0], discesa: n[1] };
        });
        const dopoLaCorsa = await totaleMetri(page);
        console.log(`     osservato: ${dopoLaCorsa} m, salita ${quote.salita} m, discesa ${quote.discesa} m (sola andata: ${solaAndata} m)`);
        ok('dopo la corsa il riquadro dice ancora "anello"',
            /anello/i.test(await page.$eval('.rp-tipo', e => e.textContent)));
        ok('...e i chilometri sono quelli dell\'anello, non della sola andata',
            dopoLaCorsa > solaAndata * 1.8, `${dopoLaCorsa} m contro ${solaAndata} m di sola andata`);
        // La firma inconfondibile: su un anello si scende quanto si e' saliti. Se qui salita e
        // discesa fossero sbilanciate, a schermo ci sarebbe il profilo della sola andata sotto
        // l'etichetta "anello" - cioe' il difetto trovato nella schermata.
        ok('...e salita e discesa si pareggiano, come su un anello vero',
            Number.isFinite(quote.salita) && Number.isFinite(quote.discesa) &&
            Math.abs(quote.salita - quote.discesa) <= Math.max(20, quote.salita * 0.08),
            `salita ${quote.salita} m, discesa ${quote.discesa} m`);

        await page.setRequestInterception(false);

        // --- si riapre ---
        console.log('\n5. Il ritorno si toglie');
        await page.click('#btn-rp-anello');
        await attendi(page, () => !document.querySelector('.rp-ritorno'));
        ok('togliendo il ritorno la riga sparisce', await page.$('.rp-ritorno') === null);
        await attendiCalcolo(page);
        ok('e il riquadro torna a dire "sola andata"',
            /sola andata/i.test(await page.$eval('.rp-tipo', e => e.textContent)));

        // --- "Svuota" spegne anche l'anello ---
        console.log('\n6. "Svuota" vuol dire ricominciare da capo');
        await page.click('#btn-rp-anello');
        await attendi(page, () => document.querySelector('.rp-ritorno'));
        await page.click('#btn-rp-svuota');
        await attendi(page, () => !document.querySelector('.rp-punti'));
        await tocca(page, CAMPO_IMPERATORE);
        await tocca(page, SELLA_MONTE_AQUILA);
        ok('dopo "Svuota" il percorso nuovo non si richiude da solo',
            await page.$('.rp-ritorno') === null);

        // --- schermate: quello che nessun controllo automatico vede ---
        console.log('\n7. Schermate');
        await page.click('#btn-rp-anello');
        await attendi(page, () => document.querySelector('.rp-ritorno'));
        await attendiCalcolo(page);

        const cartella = __dirname;
        await page.screenshot({ path: path.join(cartella, 'p38-anello-1440.png') });
        // Straripamento orizzontale della barra laterale: e' larga 380px anche su un monitor
        // grande, quindi i quattro tasti ci stanno o non ci stanno indipendentemente dallo
        // schermo. E' il caso che ha gia' fregato una volta su questo progetto.
        const straripa = await page.evaluate(() => {
            const c = document.querySelector('.route-planner-card');
            return c ? c.scrollWidth > c.clientWidth + 1 : false;
        });
        ok('a 1440px il pannello non straripa in orizzontale', !straripa);

        await page.setViewport({ width: 390, height: 844 });
        await attendi(page, () => window.innerWidth === 390);
        // Su telefono il pannello sta SOTTO la mappa: senza portarlo in vista la schermata
        // inquadrerebbe la mappa e non i comandi, cioe' proprio la cosa da guardare (quattro
        // tasti in una colonna stretta). Una schermata che non riprende il pezzo in esame non
        // e' una verifica, e' un'illusione di verifica.
        await page.evaluate(() => document.querySelector('.rp-comandi').scrollIntoView({ block: 'center' }));
        await attendi(page, () => {
            const r = document.querySelector('.rp-comandi').getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
        });
        await page.screenshot({ path: path.join(cartella, 'p38-anello-390.png') });
        const straripaMobile = await page.evaluate(() => {
            const c = document.querySelector('.route-planner-card');
            return c ? c.scrollWidth > c.clientWidth + 1 : false;
        });
        ok('a 390px il pannello non straripa in orizzontale', !straripaMobile);
        ok('a 390px la pagina non scorre di lato',
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        console.log('     schermate salvate: prove/p38-anello-1440.png e prove/p38-anello-390.png');

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e.message);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        await browser.close();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
