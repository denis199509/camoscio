// Prova nel browser della verifica email, a 1440 e 390 px.
// La fascia in cima e' un elemento NUOVO che sta sopra tutte le schermate: se sborda o
// schiaccia il resto lo si vede solo guardando, e solo su schermo stretto.

const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';
const LOG = process.env.CAMOSCIO_LOG || (__dirname + '/server-prove.log');
const SCATTI = process.env.CAMOSCIO_SCATTI || __dirname;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

function lunghezzaLog() { try { return fs.statSync(LOG).size; } catch { return 0; } }

async function estraiLink(daByte) {
    for (let i = 0; i < 40; i++) {
        const testo = fs.readFileSync(LOG, 'utf8').slice(daByte);
        const trovati = testo.match(/http:\/\/localhost:3000\/conferma-email\?token=[A-Za-z0-9_-]+/g);
        if (trovati && trovati.length) return trovati[trovati.length - 1];
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

async function aspetta(page, fn, descrizione, timeout = 20000) {
    try { await page.waitForFunction(fn, { timeout }); return true; }
    catch { console.log(`     (scaduto aspettando: ${descrizione})`); return false; }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Verifiche = mongoose.connection.collection('emailverifications');
    const Sessioni = mongoose.connection.collection('sessions');

    const partenza = {
        utenti: await Utenti.countDocuments(),
        verifiche: await Verifiche.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];
    let browser;

    try {
        browser = await puppeteer.launch({ headless: 'new' });

        for (const schermo of [{ nome: 'COMPUTER 1440x900', width: 1440, height: 900 },
                               { nome: 'TELEFONO 390x844', width: 390, height: 844 }]) {

            console.log(`\n================ ${schermo.nome} ================`);
            // Contesto isolato: le pagine dello stesso browser condividono i cookie e al
            // secondo giro risulterebbe gia' collegato (trappola gia' pagata).
            const contesto = await browser.createBrowserContext();
            const page = await contesto.newPage();
            await page.setViewport({ width: schermo.width, height: schermo.height });

            const erroriJs = [];
            page.on('pageerror', e => { console.log('     ERRORE JS:', e.message); erroriJs.push(e.message); });

            // --- Registrazione via API, poi si apre il sito gia' collegati ---
            const email = `prova-fascia-${MARCA}-${schermo.width}@esempio-di-prova.invalid`;
            const pos = lunghezzaLog();
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const reg = await page.evaluate(async (email) => {
                const r = await fetch('/api/auth/register', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nome: 'Prova', cognome: 'Fascia', email, password: 'PasswordDiProva1!',
                        username: 'provafascia' + Date.now(), ageRange: '30-39', termsAccepted: true,
                        emergencyContacts: [{ name: 'Contatto Di Prova', phone: '000', relationship: 'Prova' }]
                    })
                });
                return r.status;
            }, email);
            ok('account di prova creato', reg === 200, `status ${reg}`);
            const utente = await Utenti.findOne({ email });
            idDiProva.push(utente._id);

            // --- 1. La fascia compare a chi non ha confermato ---
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const fasciaVisibile = await aspetta(page, () => {
                const b = document.getElementById('email-verify-banner');
                return b && !b.classList.contains('hidden');
            }, 'fascia di conferma');
            ok('la fascia compare a chi non ha confermato', fasciaVisibile);

            const testoFascia = await page.evaluate(() => {
                const b = document.getElementById('email-verify-banner');
                return b ? b.innerText : '';
            });
            ok('dice cosa fare e perche\'',
                /Conferma il tuo indirizzo/i.test(testoFascia) && /password/i.test(testoFascia),
                testoFascia.slice(0, 140));
            ok('e ricorda la posta indesiderata', /indesiderata/i.test(testoFascia));

            // --- 2. Non sborda e non copre il resto ---
            const misure = await page.evaluate(() => {
                const b = document.getElementById('email-verify-banner');
                const r = b.getBoundingClientRect();
                const bottone = document.getElementById('btn-resend-verification').getBoundingClientRect();
                return {
                    sborda: document.documentElement.scrollWidth > window.innerWidth + 1,
                    bottoneDentro: bottone.right <= r.right + 1 && bottone.left >= r.left - 1,
                    altezza: Math.round(r.height)
                };
            });
            ok('la pagina non scorre in orizzontale', !misure.sborda, JSON.stringify(misure));
            ok('il pulsante "Rimanda" sta dentro la fascia', misure.bottoneDentro, JSON.stringify(misure));
            ok('la fascia non e\' spropositata', misure.altezza > 0 && misure.altezza < 200, `${misure.altezza}px`);

            await page.screenshot({ path: `${SCATTI}/verifica-fascia-${schermo.width}.png` });

            // --- 3. Il pulsante "Rimanda l'email" ---
            const posRinvio = lunghezzaLog();
            await page.click('#btn-resend-verification');
            const avvisoMostrato = await aspetta(page, () => {
                const c = document.getElementById('toast-container');
                return c && c.children.length > 0;
            }, 'messaggio dopo il rinvio');
            ok('premendo "Rimanda" compare un messaggio', avvisoMostrato);
            ok('e parte davvero una nuova email', !!(await estraiLink(posRinvio)));

            // --- 4. La pagina di conferma: link non valido ---
            await page.goto(`${BASE}/conferma-email?token=${'z'.repeat(43)}`, { waitUntil: 'networkidle2' });
            const scaduto = await aspetta(page, () => {
                const s = document.getElementById('stato-scaduto');
                return s && !s.classList.contains('hidden');
            }, 'stato "link non valido"');
            ok('un link inventato mostra "non piu\' valido"', scaduto);
            const testoScaduto = await page.evaluate(() => document.getElementById('stato-scaduto').innerText);
            ok('e dice che forse hai gia\' confermato', /gi&agrave; confermato|già confermato/i.test(testoScaduto),
                testoScaduto.slice(0, 160));
            await page.screenshot({ path: `${SCATTI}/verifica-scaduto-${schermo.width}.png` });

            // --- 5. La pagina di conferma: link buono ---
            const link = await estraiLink(posRinvio);
            await page.goto(link, { waitUntil: 'networkidle2' });
            const confermato = await aspetta(page, () => {
                const f = document.getElementById('stato-fatto');
                return f && !f.classList.contains('hidden');
            }, 'stato "confermato"');
            ok('il link vero conferma l\'indirizzo', confermato);
            ok('il token e\' sparito dalla barra degli indirizzi',
                (await page.evaluate(() => window.location.search)) === '');
            await page.screenshot({ path: `${SCATTI}/verifica-fatto-${schermo.width}.png` });

            const utenteDopo = await Utenti.findOne({ _id: utente._id });
            ok('e sul database risulta verificato', utenteDopo.emailVerified === true);

            // --- 6. La fascia sparisce ---
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const fasciaSparita = await aspetta(page, () => {
                const b = document.getElementById('email-verify-banner');
                const gate = document.getElementById('auth-gate');
                return gate && gate.classList.contains('hidden') && b && b.classList.contains('hidden');
            }, 'fascia sparita');
            ok('tornando al sito la fascia e\' sparita', fasciaSparita);

            // --- 7. Gli account demo non la vedono ---
            await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
            // Si ricarica SUBITO dopo il logout, come fa il sito vero (performLogout in
            // auth.js chiama window.location.reload()). Senza, la pagina resta aperta con
            // una sessione ormai morta e refreshState() riceve 401 da ogni API: uno stato
            // che usando il sito non si verifica, e che faceva fallire questa prova per un
            // difetto preesistente che non c'entra niente con la verifica email.
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const demo = await page.evaluate(async () => {
                const elenco = await (await fetch('/api/auth/demo-accounts')).json();
                const r = await fetch('/api/auth/demo-login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: elenco[0].id })
                });
                return r.status;
            });
            ok('accesso con un account demo', demo === 200, `status ${demo}`);

            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const fasciaDemo = await aspetta(page, () => {
                const gate = document.getElementById('auth-gate');
                const b = document.getElementById('email-verify-banner');
                return gate && gate.classList.contains('hidden') && b && b.classList.contains('hidden');
            }, 'fascia assente per l\'account demo');
            ok('un account demo NON vede la fascia (non ha un indirizzo da confermare)', fasciaDemo);

            ok('nessun errore JavaScript in tutta la prova', erroriJs.length === 0, erroriJs.join(' | '));

            await page.close();
            await contesto.close();
        }

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
        fallimenti.push('eccezione: ' + e.message);
    } finally {
        if (browser) await browser.close();

        for (const id of idDiProva) {
            await Verifiche.deleteMany({ userId: id });
            await Utenti.deleteOne({ _id: id });
        }
        const sessioni = await Sessioni.find({}).toArray();
        const idStringa = idDiProva.map(String);
        const daTogliere = sessioni.filter(s => {
            let d = s.session;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return false; } }
            return d && idStringa.includes(String(d.userId));
        }).map(s => s._id);
        if (daTogliere.length) await Sessioni.deleteMany({ _id: { $in: daTogliere } });

        const fine = {
            utenti: await Utenti.countDocuments(),
            verifiche: await Verifiche.countDocuments()
        };
        console.log('\nConteggi finali:  ', fine);
        console.log('Conteggi iniziali:', partenza);
        ok('database tornato come prima (utenti)', fine.utenti === partenza.utenti);
        ok('database tornato come prima (conferme)', fine.verifiche === partenza.verifiche);

        console.log(`\n=========================================`);
        console.log(`  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (fallimenti.length) console.log('  ->', fallimenti.join('\n  -> '));
        console.log(`=========================================`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
