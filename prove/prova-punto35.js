// Prova del PUNTO 35: la pagina resta aperta oltre la scadenza della sessione.
//
// DA DOVE NASCE: il difetto e' stato trovato il 2026-07-28 da una prova del punto 34 che
// usciva dal logout SENZA ricaricare la pagina - uno stato che usando il sito non si crea
// (performLogout ricarica sempre), ma che si crea da solo quando la sessione scade con la
// pagina lasciata aperta. Qui quello stato lo si ricrea APPOSTA.
//
// COSA CONTROLLA, in una riga: che una risposta 401 non finisca dentro lo stato globale.
// Prima della correzione fetchApi faceva res.json() e basta, quindi CamoscioState.hikes,
// .users, .stamps... diventavano {error:'Devi effettuare il login'} - un oggetto al posto
// di un elenco - e map.js cadeva su db.stamps.some.
//
// NON SCRIVE NIENTE SUL DATABASE: usa un account demo (che entra senza password) e non
// crea documenti. I conteggi si leggono lo stesso all'inizio e si riconfrontano alla fine,
// perche' una prova che credeva di non scrivere e' esattamente il modo in cui si lasciano
// documenti orfani in giro.

const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Si aspetta una condizione vera, mai un tempo fisso.
async function aspetta(page, fn, descrizione, timeout = 20000) {
    try { await page.waitForFunction(fn, { timeout }); return true; }
    catch { console.log(`     (scaduto aspettando: ${descrizione})`); return false; }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        sessioni: await mongoose.connection.collection('sessions').countDocuments(),
        timbri: await mongoose.connection.collection('stamps').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new' });
        const contesto = await browser.createBrowserContext();
        const page = await contesto.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        // Gli errori JS si stampano SUBITO: se lo script muore su un timeout prima della
        // fine, quello raccolto per dopo si perde proprio quando serviva.
        const erroriJs = [];
        page.on('pageerror', (e) => { console.log('     ERRORE JS:', e.message); erroriJs.push(e.message); });

        // --- 1. Si entra con un account demo ---
        // /api/auth/demo-accounts espone "id", NON "_id" (trappola gia' pagata: con _id il
        // login demo risponde 400 e l'app resta ferma sulla schermata di accesso).
        await page.goto(BASE + '/demo.html', { waitUntil: 'networkidle2' });
        const entrato = await page.evaluate(async () => {
            const elenco = await (await fetch('/api/auth/demo-accounts')).json();
            if (!Array.isArray(elenco) || !elenco.length) return { errore: 'nessun account demo' };
            const r = await fetch('/api/auth/demo-login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: elenco[0].id })
            });
            return { stato: r.status, nome: elenco[0].username };
        });
        ok('accesso demo riuscito', entrato.stato === 200, JSON.stringify(entrato));
        console.log(`     (account demo usato: ${entrato.nome})`);

        await page.goto(BASE, { waitUntil: 'networkidle2' });

        // initApp e' lunga e currentUser viene valorizzato PRIMA che finisca: si aspetta un
        // effetto vero (lo stato popolato), non il solo currentUser.
        const pronta = await aspetta(page, () => {
            const s = window.CamoscioState;
            return s && s.currentUser && Array.isArray(s.hikes) && s.hikes.length > 0;
        }, 'app inizializzata con i dati caricati');
        ok('app inizializzata e stato popolato', pronta);

        // --- 2. Fotografia dello stato BUONO, per confrontarla dopo ---
        // Si aspetta che la catena di refreshState sia DAVVERO finita prima di fotografare.
        // initApp ne lancia una che carica timbri, completamenti e notifiche DOPO il primo
        // gruppo di chiamate: fotografando appena hikes e' popolato, stamps risultava ancora
        // vuoto e arrivava un istante dopo, facendo fallire il confronto per colpa della
        // prova. E' la stessa trappola gia' pagata al punto 32 (aspettare currentUser non
        // basta): si aspetta un effetto vero, non un momento plausibile.
        await page.evaluate(async () => { await window.refreshState(); });

        const prima = await page.evaluate(() => {
            const s = window.CamoscioState;
            const tipi = {};
            for (const c of ['users', 'hikes', 'reports', 'squads', 'bookmarks', 'stamps', 'completions', 'notifications']) {
                tipi[c] = Array.isArray(s[c]) ? `array(${s[c].length})` : typeof s[c];
            }
            return { tipi, utente: s.currentUser && s.currentUser.username };
        });
        const tuttiElenchiPrima = Object.values(prima.tipi).every(t => t.startsWith('array'));
        ok('con la sessione valida lo stato e\' fatto di elenchi', tuttiElenchiPrima, JSON.stringify(prima.tipi));

        // --- 3. La sessione muore mentre la pagina resta aperta ---
        // Si chiama /api/auth/logout a mano invece di premere il pulsante: performLogout
        // ricarica la pagina, e ricaricando lo scenario da provare sparisce. Questo e'
        // esattamente cio' che succede da soli quando la sessione scade.
        const uscito = await page.evaluate(async () => {
            const r = await fetch('/api/auth/logout', { method: 'POST' });
            return r.status;
        });
        ok('sessione distrutta lato server (pagina NON ricaricata)', uscito === 200, `stato ${uscito}`);

        const rispondeCon401 = await page.evaluate(async () => {
            const r = await fetch('/api/hikes');
            return r.status;
        });
        ok('a sessione scaduta il server risponde 401', rispondeCon401 === 401, `stato ${rispondeCon401}`);

        // --- 4. IL CONTROLLO CHE CONTA: refreshState con la sessione scaduta ---
        const erroriPrimaDelRefresh = erroriJs.length;
        await page.evaluate(async () => { await window.refreshState(); });

        const dopo = await page.evaluate(() => {
            const s = window.CamoscioState;
            const tipi = {};
            for (const c of ['users', 'hikes', 'reports', 'squads', 'bookmarks', 'stamps', 'completions', 'notifications']) {
                tipi[c] = Array.isArray(s[c]) ? `array(${s[c].length})` : typeof s[c];
            }
            return { tipi };
        });

        const tuttiElenchiDopo = Object.values(dopo.tipi).every(t => t.startsWith('array'));
        ok('lo stato resta fatto di elenchi anche dopo il 401', tuttiElenchiDopo, JSON.stringify(dopo.tipi));
        ok('stamps e\' ancora un elenco (era questo a far cadere map.js)',
            dopo.tipi.stamps.startsWith('array'), dopo.tipi.stamps);
        ok('lo stato non e\' stato svuotato: e\' rimasto identico a prima',
            JSON.stringify(dopo.tipi) === JSON.stringify(prima.tipi),
            `prima ${JSON.stringify(prima.tipi)} / dopo ${JSON.stringify(dopo.tipi)}`);
        // Detto anche a parte: "elenco" e "elenco VUOTO" sono due esiti diversi, e svuotare
        // lo stato romperebbe la pagina in modo piu' silenzioso che corromperlo.
        ok('le escursioni non sono sparite dallo stato',
            dopo.tipi.hikes === prima.tipi.hikes && !dopo.tipi.hikes.endsWith('(0)'), dopo.tipi.hikes);
        ok('nessun errore JavaScript durante il refresh a sessione scaduta',
            erroriJs.length === erroriPrimaDelRefresh, erroriJs.slice(erroriPrimaDelRefresh).join(' | '));

        // --- 5. Non si tace: l'utente viene avvisato una volta sola ---
        const avviso = await page.evaluate(() => {
            const toast = document.querySelectorAll('#toast-container .toast');
            return Array.from(toast).map(t => t.textContent.trim());
        });
        ok('compare l\'avviso che la sessione e\' scaduta',
            avviso.some(t => /sessione/i.test(t) && /scadut/i.test(t)), JSON.stringify(avviso));

        await page.evaluate(async () => { await window.refreshState(); await window.refreshState(); });
        const avvisoDopoTreGiri = await page.evaluate(() => {
            const toast = document.querySelectorAll('#toast-container .toast');
            return Array.from(toast).map(t => t.textContent.trim()).filter(t => /sessione/i.test(t)).length;
        });
        ok('l\'avviso NON si ripete a ogni refresh (ne resta uno solo)',
            avvisoDopoTreGiri === 1, `${avvisoDopoTreGiri} avvisi`);

        // --- 6. La riprova che il difetto era reale ---
        // Si rimette la versione vecchia di fetchApi dentro una copia della logica e si
        // verifica che SENZA il controllo di res.ok arrivi davvero un oggetto al posto di un
        // elenco. Senza questo, la prova passerebbe anche se il 401 non arrivasse affatto.
        const senzaControllo = await page.evaluate(async () => {
            const res = await fetch('/api/hikes');
            const dati = await res.json();   // la vecchia fetchApi faceva esattamente questo
            return { eElenco: Array.isArray(dati), chiavi: Object.keys(dati) };
        });
        ok('senza il controllo di res.ok arrivava un oggetto, non un elenco',
            !senzaControllo.eElenco && senzaControllo.chiavi.includes('error'),
            JSON.stringify(senzaControllo));

        // --- 7. Nessuna regressione: con la sessione valida refreshState funziona ancora ---
        const rientrato = await page.evaluate(async () => {
            const elenco = await (await fetch('/api/auth/demo-accounts')).json();
            const r = await fetch('/api/auth/demo-login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: elenco[0].id })
            });
            if (r.status !== 200) return { stato: r.status };
            await window.refreshState();
            const s = window.CamoscioState;
            return { stato: r.status, hikes: Array.isArray(s.hikes) ? s.hikes.length : null,
                     stamps: Array.isArray(s.stamps) ? s.stamps.length : null };
        });
        ok('rientrando, refreshState ricarica i dati come prima',
            rientrato.stato === 200 && rientrato.hikes > 0 && rientrato.stamps !== null,
            JSON.stringify(rientrato));

        await contesto.close();

    } catch (e) {
        // L'errore si stampa qui, PRIMA del finally: un process.exit dentro il finally
        // ucciderebbe il .catch in fondo e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (browser) await browser.close();

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            sessioni: await mongoose.connection.collection('sessions').countDocuments(),
            timbri: await mongoose.connection.collection('stamps').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        const utentiUguali = fine.utenti === partenza.utenti;
        const timbriUguali = fine.timbri === partenza.timbri;
        ok('nessun utente creato o perso', utentiUguali, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessun timbro creato o perso', timbriUguali, `${partenza.timbri} -> ${fine.timbri}`);
        // Le sessioni cambiano di proposito (si entra, si esce, si rientra): non e' un difetto.
        console.log(`     (sessioni ${partenza.sessioni} -> ${fine.sessioni}: cambiano di proposito)`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
