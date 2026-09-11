// Prova NEL BROWSER del secondo fattore TOTP (blocchi 6-7 del piano 2FA):
// C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md
//
// Due cose che nessuna prova server puo' vedere:
//   1) IL QR sullo schermo (blocco 6) - che l'<svg> di #tfa-qr esista e non sia vuoto, che
//      il riquadro abbia davvero fondo bianco (getComputedStyle), e che con window.qrcode
//      reso undefined compaia il RIPIEGO col segreto invece di una scheda rotta.
//   2) IL BANNER GLOBALE "recupero in corso" (blocco 7) - che compaia su ALMENO TRE sezioni
//      diverse dopo aver navigato (e' fuori da .page-container, ma va verificato dal vivo),
//      che NON sparisca dopo un refreshState() forzato a mano (la trappola di §4.7: lo stato
//      NON sta in currentUser), e che il pulsante "Annulla" lo faccia sparire SENZA
//      ricaricare la pagina.
//
// Come si lancia (Puppeteer fuori da package.json, come le altre prove-browser):
//   node server.js > prove/server-prove.log 2>&1        (altra finestra)
//   PUPPETEER_PATH=/percorso/di/node_modules/puppeteer node prove/prova-browser-2fa.js
//
// Utente reale temporaneo creato dritto sul DB, cancellato nel finally (filtrato per id).

const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const totp = require('../lib/totp');

const BASE = 'http://localhost:3000';
const SCATTI = process.env.CAMOSCIO_SCATTI || __dirname;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
const codiceOra = (seg) => totp.codiceDaPasso(seg, totp.passoCorrente());

// login a due passi via fetch DENTRO la pagina (riusa i cookie del contesto del browser).
// Il codice TOTP si calcola QUI in node e si passa come stringa a page.evaluate.
async function loginDuePassi(page, email, password, segreto) {
    const code = codiceOra(segreto);
    return page.evaluate(async (email, password, code) => {
        const p1 = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const d1 = await p1.json();
        if (!d1.twoFactorRequired) return { status: p1.status, full: true };
        const p2 = await fetch('/api/auth/login/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        return { status: p2.status, full: false, body: await p2.json() };
    }, email, password, code);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const AccountRecovery = require('../models/AccountRecovery');
    const PasswordReset = require('../models/PasswordReset');
    const { creaToken } = require('../lib/tokens');

    const conteggi = async () => ({
        utenti: await mongoose.connection.collection('users').countDocuments(),
        recuperi: await mongoose.connection.collection('accountrecoveries').countDocuments()
    });
    const partenza = await conteggi();
    console.log('Conteggi di partenza:', partenza, '\n');

    let browser, userId = null;
    try {
        // server raggiungibile?
        try { await fetch(BASE + '/api/auth/demo-accounts'); }
        catch { throw new Error('server non raggiungibile su ' + BASE + ' - avvialo con: node server.js > prove/server-prove.log 2>&1'); }

        const email = `prova-browser-2fa-${MARCA}@esempio-di-prova.invalid`;
        const password = `pw-${MARCA}-Xk`;
        const u = await User.create({
            username: `PROVA-BROWSER-2FA-${MARCA}`, email,
            passwordHash: bcrypt.hashSync(password, 10), nome: 'Prova', cognome: 'Browser',
            termsAcceptedAt: new Date(), emailVerified: true
        });
        userId = String(u._id);

        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

        // =====================================================================
        // 1 - IL QR SULLO SCHERMO (blocco 6)
        // =====================================================================
        {
            const ctx = await browser.createBrowserContext();
            const page = await ctx.newPage();
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(BASE, { waitUntil: 'networkidle2' });

            const login = await page.evaluate(async (email, password) => {
                const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
                return { status: r.status, body: await r.json() };
            }, email, password);
            ok('1: login (senza 2FA) riuscito', login.status === 200, JSON.stringify(login.body && login.body.error));

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForFunction(() => window.CamoscioState && window.CamoscioState.currentUser && !window.CamoscioState.currentUser.isDemoAccount, { timeout: 15000 });
            await page.evaluate(() => window.navigateTo('settings'));
            await page.waitForFunction(() => {
                const c = document.getElementById('settings-2fa-card');
                return c && !c.classList.contains('hidden');
            }, { timeout: 15000 });
            ok('1: la card #settings-2fa-card e\' visibile per un utente reale', true);

            // stato "spento" -> clic su "Attiva il secondo fattore"
            await page.evaluate(() => document.getElementById('tfa-btn-attiva').click());
            await page.waitForFunction(() => {
                const q = document.querySelector('#tfa-qr svg');
                return q && q.getBoundingClientRect().width > 40;
            }, { timeout: 15000 });

            const qr = await page.evaluate(() => {
                const box = document.getElementById('tfa-qr');
                const svg = box.querySelector('svg');
                const paths = svg ? svg.querySelectorAll('path').length : 0;
                return {
                    hasSvg: !!svg,
                    paths,
                    boxBg: getComputedStyle(box).backgroundColor,
                    svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
                    segretoMostrato: (document.getElementById('tfa-secret').textContent || '').length
                };
            });
            ok('1: #tfa-qr contiene un <svg> con almeno un <path> (QR non vuoto)', qr.hasSvg && qr.paths >= 1, JSON.stringify(qr));
            ok('1: il riquadro del QR ha fondo BIANCO', qr.boxBg === 'rgb(255, 255, 255)', qr.boxBg);
            ok('1: l\'SVG e\' visibile (larghezza > 40 px)', qr.svgW > 40, `${qr.svgW}px`);
            ok('1: la chiave in chiaro e\' mostrata per la digitazione manuale', qr.segretoMostrato >= 16, `${qr.segretoMostrato} char`);

            await page.screenshot({ path: `${SCATTI}/p2fa-qr-1440.png` });

            // ripiego: window.qrcode = undefined -> deve comparire il testo, non rompersi
            const ctx2 = await browser.createBrowserContext();
            const page2 = await ctx2.newPage();
            await page2.evaluateOnNewDocument(() => { Object.defineProperty(window, 'qrcode', { value: undefined, configurable: true }); });
            await page2.setViewport({ width: 1440, height: 900 });
            await page2.goto(BASE, { waitUntil: 'networkidle2' });
            await page2.evaluate(async (email, password) => {
                await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            }, email, password);
            await page2.reload({ waitUntil: 'networkidle2' });
            await page2.waitForFunction(() => window.CamoscioState && window.CamoscioState.currentUser && !window.CamoscioState.currentUser.isDemoAccount, { timeout: 15000 });
            await page2.evaluate(() => window.navigateTo('settings'));
            await page2.waitForFunction(() => {
                const c = document.getElementById('settings-2fa-card');
                return c && !c.classList.contains('hidden');
            }, { timeout: 15000 });
            await page2.evaluate(() => document.getElementById('tfa-btn-attiva').click());
            await page2.waitForFunction(() => !document.getElementById('tfa-configurazione').hidden, { timeout: 15000 });
            const ripiego = await page2.evaluate(() => {
                const box = document.getElementById('tfa-qr');
                return { noSvg: !box.querySelector('svg'), hasText: /chiave|a mano|inserisci/i.test(box.textContent || ''), configVisibile: !document.getElementById('tfa-configurazione').hidden };
            });
            ok('1: senza window.qrcode il pannello NON si rompe (config visibile, nessun svg)', ripiego.configVisibile && ripiego.noSvg, JSON.stringify(ripiego));
            ok('1: ...e compare il testo "inserisci la chiave a mano"', ripiego.hasText, JSON.stringify(ripiego));
            await ctx2.close();
            await ctx.close();
        }

        // =====================================================================
        // 2 - IL BANNER GLOBALE (blocco 7)
        // =====================================================================
        {
            // accendo il 2FA su DB per poter avviare un recupero
            const segreto = totp.generaSegretoBase32();
            const codici = totp.generaCodiciRecupero();
            await User.updateOne({ _id: u._id }, {
                $set: {
                    twoFactorSecret: segreto, twoFactorEnabledAt: new Date(),
                    twoFactorRecoveryHashes: codici.map(c => totp.improntaCodiceRecupero(String(u._id), c))
                },
                $unset: { twoFactorPending: 1, twoFactorPendingAt: 1, twoFactorLastStep: 1 }
            });
            // avvio un recupero: serve un token PasswordReset -> /recovery/start
            const tok = await creaToken(PasswordReset, u._id);
            const avvio = await fetch(BASE + '/api/auth/recovery/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok })
            });
            ok('2: /recovery/start -> 200', avvio.status === 200, `status ${avvio.status}`);

            const ctx = await browser.createBrowserContext();
            const page = await ctx.newPage();
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 300));
            const acc = await loginDuePassi(page, email, password, segreto);
            ok('2: login a due passi riuscito', acc.status === 200, JSON.stringify(acc));

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForFunction(() => {
                const b = document.getElementById('recovery-banner');
                return b && !b.classList.contains('hidden');
            }, { timeout: 15000 });
            ok('2: il banner #recovery-banner e\' visibile dopo il login', true);

            const testoBanner = await page.$eval('#recovery-banner', el => el.textContent.replace(/\s+/g, ' ').trim());
            ok('2: il banner dice "Recupero account in corso" e ha una data',
                /Recupero account in corso/.test(testoBanner) && /\d{1,2}\s\w+\s\d{4}/.test(testoBanner), testoBanner.slice(0, 160));

            // navigazione: il banner resta su ALMENO 3 sezioni diverse
            let visibileSu = 0, sezioniViste = [];
            for (const sez of ['dashboard', 'my-hikes', 'social', 'progress', 'settings']) {
                await page.evaluate(s => window.navigateTo(s), sez);
                await new Promise(r => setTimeout(r, 400));
                const vis = await page.$eval('#recovery-banner', el => !el.classList.contains('hidden') && el.getBoundingClientRect().height > 0);
                if (vis) { visibileSu++; sezioniViste.push(sez); }
            }
            ok('2: il banner resta visibile su almeno 3 sezioni diverse dopo aver navigato', visibileSu >= 3, `visibile su: ${sezioniViste.join(', ')}`);

            // la trappola di §4.7: un refreshState() forzato NON deve farlo sparire
            await page.evaluate(async () => { if (window.refreshState) await window.refreshState(); });
            await new Promise(r => setTimeout(r, 500));
            const dopoRefresh = await page.$eval('#recovery-banner', el => !el.classList.contains('hidden'));
            ok('2: il banner NON sparisce dopo un refreshState() forzato (stato NON in currentUser)', dopoRefresh);

            await page.screenshot({ path: `${SCATTI}/p2fa-banner-1440.png` });

            // "Annulla il recupero": sparisce SENZA ricaricare
            const urlPrima = page.url();
            await page.evaluate(() => document.getElementById('btn-recovery-cancel').click());
            await page.waitForFunction(() => {
                const b = document.getElementById('recovery-banner');
                return b && b.classList.contains('hidden');
            }, { timeout: 15000 });
            const urlDopo = page.url();
            ok('2: "Annulla il recupero" fa sparire il banner SENZA ricaricare la pagina', urlPrima === urlDopo);
            const docRec = await AccountRecovery.findOne({ userId: u._id }).sort({ createdAt: -1 });
            ok('2: sul DB il recupero e\' annullato (annullatoPerche "utente")',
                !!docRec && !!docRec.annullatoIl && docRec.annullatoPerche === 'utente');

            // pass stretto a 390 px: il banner non deve traboccare
            await page.setViewport({ width: 390, height: 780 });
            await fetch(BASE + '/api/auth/recovery/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await creaToken(PasswordReset, u._id) }) });
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForFunction(() => {
                const b = document.getElementById('recovery-banner');
                return b && !b.classList.contains('hidden');
            }, { timeout: 15000 });
            const overflow = await page.$eval('#recovery-banner', el => el.scrollWidth - el.clientWidth);
            ok('2: a 390 px il banner non trabocca orizzontalmente', overflow <= 1, `overflow ${overflow}px`);
            await page.screenshot({ path: `${SCATTI}/p2fa-banner-390.png` });

            await ctx.close();
        }

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + (e && e.message));
    } finally {
        if (browser) await browser.close();
        if (userId) {
            const oid = new mongoose.Types.ObjectId(userId);
            await mongoose.connection.collection('users').deleteOne({ _id: oid }).catch(() => {});
            await mongoose.connection.collection('accountrecoveries').deleteMany({ userId: oid }).catch(() => {});
            await mongoose.connection.collection('passwordresets').deleteMany({ userId: oid }).catch(() => {});
        }
        const fine = await conteggi();
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessun AccountRecovery di prova rimasto', fine.recuperi === partenza.recuperi, `${partenza.recuperi} -> ${fine.recuperi}`);
        await mongoose.disconnect();
        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
