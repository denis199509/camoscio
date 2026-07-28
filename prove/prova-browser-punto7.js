// Prova nel browser del PUNTO 7, a 1440 e 390 px.
// Il telefono conta: la pagina /reimposta-password e' nuova, e i due difetti di
// impaginazione del punto 13 (100vh e il padding azzerato) erano invisibili alle prove
// automatiche proprio perche' nessuno guardava lo schermo stretto.
//
// Stesse regole di pulizia della prova via API: dati riconoscibili come di prova e
// cancellazione filtrata per l'userId dell'account di prova, dentro un finally.

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
        const trovati = testo.match(/http:\/\/localhost:3000\/reimposta-password\?token=[A-Za-z0-9_-]+/g);
        if (trovati && trovati.length) return trovati[trovati.length - 1];
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

// Non si legge il DOM "a tempo": si insiste finche' la condizione non e' vera davvero.
async function aspetta(page, fn, descrizione, timeout = 15000) {
    try {
        await page.waitForFunction(fn, { timeout });
        return true;
    } catch {
        console.log(`     (scaduto aspettando: ${descrizione})`);
        return false;
    }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Reset = mongoose.connection.collection('passwordresets');
    const Sessioni = mongoose.connection.collection('sessions');
    const Verifiche = mongoose.connection.collection('emailverifications');

    const partenza = {
        utenti: await Utenti.countDocuments(),
        reset: await Reset.countDocuments(),
        sessioni: await Sessioni.countDocuments(),
        verifiche: await Verifiche.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    const idDiProva = [];
    let browser;

    try {
        const emailProva = `prova-browser-p7-${MARCA}@esempio-di-prova.invalid`;
        const P1 = 'PasswordDiProva1!';
        const P2 = 'PasswordScelta2026!';

        // Account di prova creato via API: qui interessa il recupero, non la registrazione.
        const reg = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: 'Prova', cognome: 'Browser', email: emailProva, password: P1,
                username: `provabrowserp7${MARCA}`, ageRange: '30-39', termsAccepted: true,
                emergencyContacts: [{ name: 'Contatto Di Prova', phone: '000', relationship: 'Prova' }]
            })
        });
        ok('account di prova creato', reg.status === 200);
        const utente = await Utenti.findOne({ email: emailProva });
        idDiProva.push(utente._id);

        // L'INDIRIZZO VA SEGNATO COME CONFERMATO, altrimenti questa prova non prova piu'
        // niente. Dal punto 34 (fatto lo stesso giorno, DOPO che questa prova era scritta)
        // chiedere il recupero con un indirizzo non confermato manda - giustamente - l'email
        // di CONFERMA invece di quella di reimpostazione: il link di reimpostazione non
        // arrivava, e da li' in poi la prova moriva su page.goto(undefined) senza eseguire
        // nulla del resto, compreso l'intero giro a 390 px.
        // Si fa sul database come nella prova via API: qui interessa il recupero password,
        // non il flusso di conferma, che ha gia' la sua prova (prova-verifica-email.js).
        await Utenti.updateOne({ _id: utente._id }, { $set: { emailVerified: true } });

        browser = await puppeteer.launch({ headless: 'new' });

        for (const schermo of [{ nome: 'COMPUTER 1440x900', width: 1440, height: 900 },
                               { nome: 'TELEFONO 390x844', width: 390, height: 844 }]) {

            console.log(`\n================ ${schermo.nome} ================`);
            // CONTESTO ISOLATO, non browser.newPage(): le pagine dello stesso browser
            // condividono i cookie, quindi al secondo giro la pagina sarebbe gia' stata
            // collegata dal giro precedente e la schermata di accesso - giustamente - non
            // sarebbe comparsa. La prova sarebbe fallita accusando il sito di un difetto
            // che era tutto suo.
            const contesto = await browser.createBrowserContext();
            const page = await contesto.newPage();
            await page.setViewport({ width: schermo.width, height: schermo.height });

            const erroriJs = [];
            page.on('pageerror', (e) => { console.log('     ERRORE JS:', e.message); erroriJs.push(e.message); });

            // --- 1. Il link "Password dimenticata?" nella schermata di accesso ---
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            await aspetta(page, () => {
                const g = document.getElementById('auth-gate');
                return g && !g.classList.contains('hidden');
            }, 'schermata di accesso visibile');

            const linkVisibile = await page.evaluate(() => {
                const a = document.getElementById('link-go-forgot');
                if (!a) return null;
                const r = a.getBoundingClientRect();
                return { testo: a.textContent.trim(), largo: r.width, alto: r.height };
            });
            ok('il link "Password dimenticata?" c\'e\' ed e\' visibile',
                !!linkVisibile && linkVisibile.largo > 0 && linkVisibile.alto > 0, JSON.stringify(linkVisibile));

            // --- 2. Si apre la vista del recupero ---
            await page.click('#link-go-forgot');
            const vistaAperta = await aspetta(page, () => {
                const v = document.getElementById('auth-forgot-view');
                const l = document.getElementById('auth-login-view');
                return v && !v.classList.contains('hidden') && l && l.classList.contains('hidden');
            }, 'vista recupero aperta');
            ok('cliccando si apre la vista del recupero e sparisce quella di accesso', vistaAperta);

            // --- 3. Niente sborda in larghezza (il difetto che le prove non vedono) ---
            const sborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            ok('la pagina non scorre in orizzontale', !sborda);

            const dentroIlRiquadro = await page.evaluate(() => {
                const card = document.getElementById('auth-forgot-view').getBoundingClientRect();
                const campo = document.getElementById('forgot-email').getBoundingClientRect();
                const bottone = document.getElementById('btn-forgot-submit').getBoundingClientRect();
                return {
                    campoDentro: campo.left >= card.left - 1 && campo.right <= card.right + 1,
                    bottoneDentro: bottone.left >= card.left - 1 && bottone.right <= card.right + 1,
                    campoLargo: Math.round(campo.width)
                };
            });
            ok('il campo email sta dentro il riquadro', dentroIlRiquadro.campoDentro, JSON.stringify(dentroIlRiquadro));
            ok('il pulsante sta dentro il riquadro', dentroIlRiquadro.bottoneDentro, JSON.stringify(dentroIlRiquadro));
            ok('il campo ha una larghezza sensata', dentroIlRiquadro.campoLargo > 100, `${dentroIlRiquadro.campoLargo}px`);

            // --- 4. Si chiede il link ---
            const pos = lunghezzaLog();
            await page.type('#forgot-email', emailProva);
            await page.click('#btn-forgot-submit');

            const chiaveConfigurata = !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.MAIL_SENDER_EMAIL);

            if (chiaveConfigurata) {
                const confermaVisibile = await aspetta(page, () => {
                    const d = document.getElementById('auth-forgot-done');
                    return d && !d.classList.contains('hidden');
                }, 'messaggio di conferma');
                ok('dopo l\'invio compare la conferma', confermaVisibile);

                const testoConferma = await page.evaluate(() => document.getElementById('auth-forgot-done').innerText);
                ok('la conferma non rivela se l\'email esiste',
                    /Se quell'indirizzo è registrato/i.test(testoConferma), testoConferma.slice(0, 120));
                ok('la conferma spiega la durata e l\'uso singolo',
                    /un'ora/i.test(testoConferma) && /una volta sola/i.test(testoConferma), testoConferma.slice(0, 200));

                const moduloNascosto = await page.evaluate(() =>
                    document.getElementById('auth-forgot-form').classList.contains('hidden'));
                ok('il modulo sparisce dopo l\'invio', moduloNascosto);
            } else {
                // Senza chiave (com'e' oggi in locale, e come sara' online finche' l'utente
                // non la mette): non deve comparire nessun riquadro verde che dice "fatto"
                // per un'email che non e' partita.
                const avvisoVisibile = await aspetta(page, () => {
                    const e = document.getElementById('auth-forgot-error');
                    return e && !e.classList.contains('hidden');
                }, 'avviso "invio non attivo"');
                ok('senza chiave compare un AVVISO, non una conferma', avvisoVisibile);

                const testoAvviso = await page.evaluate(() => document.getElementById('auth-forgot-error').innerText);
                ok('l\'avviso dice che il recupero non e\' ancora attivo',
                    /non è ancora attivo/i.test(testoAvviso), testoAvviso.slice(0, 160));
                ok('e che la password di adesso continua a funzionare',
                    /continua a funzionare/i.test(testoAvviso), testoAvviso.slice(0, 200));

                const verdeNascosto = await page.evaluate(() =>
                    document.getElementById('auth-forgot-done').classList.contains('hidden'));
                ok('il riquadro verde di conferma NON compare', verdeNascosto);

                const moduloResta = await page.evaluate(() =>
                    !document.getElementById('auth-forgot-form').classList.contains('hidden'));
                ok('il modulo resta a schermo (non c\'e\' niente da aspettare)', moduloResta);
            }

            await page.screenshot({ path: `${SCATTI}/p7-recupero-${schermo.width}.png` });

            // --- 5. La pagina del link ---
            const link = await estraiLink(pos);
            ok('il link e\' arrivato', !!link);

            // Prima il caso del link sbagliato, che e' quello che si vede piu' spesso.
            await page.goto(`${BASE}/reimposta-password?token=${'z'.repeat(43)}`, { waitUntil: 'networkidle2' });
            const scadutoMostrato = await aspetta(page, () => {
                const s = document.getElementById('stato-scaduto');
                return s && !s.classList.contains('hidden');
            }, 'stato "link non valido"');
            ok('un link non valido mostra "questo link non è più valido"', scadutoMostrato);
            const moduloAssente = await page.evaluate(() =>
                document.getElementById('stato-modulo').classList.contains('hidden'));
            ok('e NON mostra il modulo della password', moduloAssente);
            const testoScaduto = await page.evaluate(() => document.getElementById('stato-scaduto').innerText);
            ok('spiega che la password di adesso continua a funzionare',
                /continua a funzionare/i.test(testoScaduto), testoScaduto.slice(0, 150));
            await page.screenshot({ path: `${SCATTI}/p7-link-scaduto-${schermo.width}.png` });

            // Ora il link vero.
            await page.goto(link, { waitUntil: 'networkidle2' });
            const moduloMostrato = await aspetta(page, () => {
                const m = document.getElementById('stato-modulo');
                return m && !m.classList.contains('hidden');
            }, 'modulo della nuova password');
            ok('il link vero apre il modulo della nuova password', moduloMostrato);

            const indirizzoRipulito = await page.evaluate(() => window.location.search);
            ok('il token e\' stato tolto dalla barra degli indirizzi', indirizzoRipulito === '', `search="${indirizzoRipulito}"`);

            const sbordaReset = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            ok('la pagina di reimpostazione non scorre in orizzontale', !sbordaReset);

            await page.screenshot({ path: `${SCATTI}/p7-reimposta-${schermo.width}.png` });

            // --- 6. Le due password non coincidono ---
            await page.type('#reset-password', P2);
            await page.type('#reset-password-confirm', 'QualcosAltro9!');
            await page.click('#reset-submit');
            const erroreCoincidenza = await aspetta(page, () => {
                const e = document.getElementById('reset-error');
                return e && !e.classList.contains('hidden');
            }, 'errore "non coincidono"');
            ok('due password diverse danno errore a schermo', erroreCoincidenza);

            // --- 7. Cambio riuscito ---
            await page.evaluate(() => { document.getElementById('reset-password-confirm').value = ''; });
            await page.type('#reset-password-confirm', P2);
            await page.click('#reset-submit');

            const fatto = await aspetta(page, () => {
                const f = document.getElementById('stato-fatto');
                return f && !f.classList.contains('hidden');
            }, 'schermata "password aggiornata"');
            ok('la password si cambia e la pagina lo dice', fatto);

            const testoFatto = await page.evaluate(() => document.getElementById('stato-fatto').innerText);
            ok('dice che si e\' gia\' dentro', /Sei già dentro/i.test(testoFatto), testoFatto.slice(0, 150));
            await page.screenshot({ path: `${SCATTI}/p7-fatto-${schermo.width}.png` });

            // --- 8. Si e' davvero collegati ---
            await page.goto(BASE, { waitUntil: 'networkidle2' });
            const dentroDavvero = await aspetta(page, () => {
                const gate = document.getElementById('auth-gate');
                return gate && gate.classList.contains('hidden');
            }, 'applicazione aperta senza chiedere l\'accesso');
            ok('tornando al sito si e\' gia\' dentro, senza rifare l\'accesso', dentroDavvero);

            // --- 9. Cambio password dal profilo ---
            const sezioneVisibile = await aspetta(page, () => {
                const s = document.getElementById('change-password-section');
                return s && !s.classList.contains('hidden');
            }, 'sezione cambio password nel profilo');
            ok('nel profilo compare la sezione "Cambia password"', sezioneVisibile);

            const P3 = 'TerzaPasswordProva3!';
            await page.evaluate((vecchia, nuova) => {
                document.getElementById('cp-current').value = vecchia;
                document.getElementById('cp-new').value = nuova;
                document.getElementById('cp-confirm').value = nuova;
            }, P2, P3);
            await page.click('#btn-change-password');

            const cambiato = await aspetta(page, () =>
                document.getElementById('cp-new').value === '' && document.getElementById('cp-current').value === '',
                'campi svuotati dopo il cambio');
            ok('il cambio dal profilo funziona e svuota i campi', cambiato);

            // La prova vera: si entra con la password nuova.
            const provaLogin = await page.evaluate(async (email, password) => {
                const r = await fetch('/api/auth/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                return r.status;
            }, emailProva, P3);
            ok('e si entra davvero con la password appena scelta', provaLogin === 200, `status ${provaLogin}`);

            ok('nessun errore JavaScript in tutta la prova', erroriJs.length === 0, erroriJs.join(' | '));

            await page.close();
            await contesto.close();

            // Per il giro successivo serve ripartire dalla password di prima.
            const bcrypt = require('bcryptjs');
            await Utenti.updateOne({ _id: utente._id }, { $set: { passwordHash: await bcrypt.hash(P1, 10) } });
            await Reset.deleteMany({ userId: utente._id });
        }

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
        fallimenti.push('eccezione: ' + e.message);
    } finally {
        if (browser) await browser.close();

        for (const id of idDiProva) {
            await Reset.deleteMany({ userId: id });
            // ANCHE I TOKEN DI CONFERMA, che questa prova non puliva. Registrarsi ne crea
            // uno (dal punto 34), quindi ogni giro lasciava un documento orfano sul
            // database - trovato il 2026-07-28 ricontando le collezioni a fine sessione.
            // Non erano permanenti (c'e' un indice TTL di 24 ore) ma la prova diceva
            // "database tornato come prima" senza guardare questa collezione, che e' il
            // modo in cui un residuo passa inosservato.
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
            reset: await Reset.countDocuments(),
            sessioni: await Sessioni.countDocuments(),
            verifiche: await Verifiche.countDocuments()
        };
        console.log('\nConteggi finali:  ', fine);
        console.log('Conteggi iniziali:', partenza);
        ok('database tornato come prima (utenti)', fine.utenti === partenza.utenti);
        ok('database tornato come prima (recuperi)', fine.reset === partenza.reset);
        ok('database tornato come prima (sessioni)', fine.sessioni === partenza.sessioni);
        ok('database tornato come prima (conferme)', fine.verifiche === partenza.verifiche,
            `${partenza.verifiche} -> ${fine.verifiche}`);

        console.log(`\n=========================================`);
        console.log(`  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (fallimenti.length) console.log('  ->', fallimenti.join('\n  -> '));
        console.log(`=========================================`);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
