// Prova del secondo fattore TOTP (2FA).
//
// SEZIONE 1 (blocco 1 del piano - C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md):
//   lib/totp.js provato da solo contro i vettori degli RFC. NIENTE server, niente database.
//   L'ORACOLO SONO GLI RFC: i valori attesi sono TRASCRITTI dal testo (4226 Appendice D;
//   6238 Appendice B, colonna SHA1), non calcolati da noi.
//
// SEZIONI 2-10 (blocchi 3-4 del piano): le ROTTE. Avvia un server suo sulla porta 3137
//   (la 3136 e' di prova-contatti-emergenza). Account reali temporanei creati dritti sul
//   database (come prova-eliminazione-account / prova-punto37), cancellati nel finally,
//   filtrati per id.
//   - 2  contratto: /2fa/* e /login/2fa senza sessione -> 401; su account demo -> 403;
//        /setup idempotente; /enable senza /setup -> 400
//   - 3  attivazione: /setup -> /enable -> 200 + 10 codici; stato sul DB; /me senza segreto;
//        D-4 (email non confermata -> 400); /setup su 2FA attivo -> 409
//   - 4  login a due passi: passo 1 non apre la sessione (GET /me -> 401 fra i due passi:
//        e' IL controllo centrale del piano); codice sbagliato -> 401; giusto -> 200
//   - 5  anti-riuso: lo stesso codice TOTP due volte -> 401 (CAS su twoFactorLastStep)
//   - 6  codice di recupero monouso: -> 200 + recoveryCodesRimasti; riuso -> 401;
//        accettato in minuscolo/con spazi/senza trattini
//   - 7  reset a due passi: /check dice twoFactorRequired; senza codice -> 401 e TOKEN
//        INTATTO; con codice -> 200; 5 tentativi a vuoto -> il token muore
//   - 8  disattivazione: senza password -> 401; senza codice -> 401; con entrambi -> 200 e
//        tutti e 6 i campi 2FA spariti; poi login in un passo solo
//   - 9  stati speciali: pendingDeletionAt + 2FA -> dopo il PRIMO passo pendingDeletionAt
//        e' ancora li'; dopo il secondo e' sparito e la risposta porta eliminazioneAnnullata
//   - 10 scrub: scrubAccount() su un utente con 2FA -> segreto e impronte spariti
//
// PER NON ASPETTARE 30 s A OGNI LOGIN: dove sotto prova c'e' il FLUSSO (non l'anti-riuso) si
// azzera twoFactorLastStep sul DB con sbloccaPasso() prima del login TOTP. E' una forzatura
// DELLA PROVA, dichiarata: l'anti-riuso vero (il CAS) e' sotto prova nella sezione 5, che
// NON sblocca. Stesso spirito delle date forzate in prova-recupero-ritardato / prova-punto111.
//
// CONTROPROVE non facoltative (git stash del codice, da rifare a mano se si tocca la zona):
//   - rimettere `req.session.userId = ...` nel PRIMO passo di POST /login  -> deve crollare
//     la sezione 4 (GET /me fra i due passi risponderebbe 200);
//   - togliere il CAS spendiPasso() da verificaSecondoFattore  -> deve crollare la sezione 5;
//   - $pull del codice di recupero senza condizione  -> deve crollare la sezione 6;
//   - togliere lo $unset dei campi 2FA da scrubAccount  -> deve crollare la sezione 10.
//
//   node prove/prova-2fa.js        (la sezione 1 non vuole il server; 2-10 avviano il loro)

require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const totp = require('../lib/totp');

const PORTA = 3137;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// --- helper HTTP (sezioni 2-10) ---
function cookieDa(resp) {
    const raw = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')];
    return raw.filter(Boolean).map(c => c.split(';')[0]).join('; ');
}
async function chiama(metodo, percorso, corpo, cookie) {
    const resp = await fetch(BASE + percorso, {
        method: metodo || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await resp.text();
    let corpoRisposta = null;
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: resp.status, corpo: corpoRisposta, testo, cookie: cookieDa(resp) };
}
// POST /api/auth/login: per un utente senza 2FA e' un login completo; per uno col 2FA e' il
// primo passo (risposta { twoFactorRequired: true }, sessione NON aperta).
async function loginPasso1(email, password) {
    return chiama('POST', '/api/auth/login', { email, password });
}
// codice TOTP del passo CORRENTE per un segreto.
function codiceOra(segreto) {
    return totp.codiceDaPasso(segreto, totp.passoCorrente());
}

const SEED_RFC = totp.codificaBase32(Buffer.from('12345678901234567890', 'ascii'));

(async () => {
    // =====================================================================================
    // SEZIONE 1 - lib/totp.js contro gli RFC (nessun server, nessun database)
    // =====================================================================================

    // --- 1a. Vettori HOTP, RFC 4226 Appendice D ---------------------------------------
    console.log('\n1a. Vettori HOTP (RFC 4226 Appendice D)');
    {
        ok('base32 del seed RFC = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            SEED_RFC === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', SEED_RFC);

        // Colonna "HOTP" della tabella dell'Appendice D, contatori 0..9.
        const attesi = ['755224', '287082', '359152', '969429', '338314',
                        '254676', '287922', '162583', '399871', '520489'];
        attesi.forEach((atteso, contatore) => {
            const codice = totp.codiceDaPasso(SEED_RFC, contatore);
            ok(`HOTP(seed, ${contatore}) = ${atteso}`, codice === atteso, codice);
        });
    }

    // --- 1b. Vettori TOTP, RFC 6238 Appendice B (righe SHA1) -------------------------
    // La tabella dell'RFC da' 8 cifre; il nostro codice ne da' 6, cioe' le ultime 6 di quelle
    // (bin % 10^8 % 10^6 === bin % 10^6).
    console.log('\n1b. Vettori TOTP (RFC 6238 Appendice B, SHA1)');
    {
        const vettori = [
            { T: 59,          otto: '94287082' },
            { T: 1111111109,  otto: '07081804' },
            { T: 1111111111,  otto: '14050471' },
            { T: 1234567890,  otto: '89005924' },
            { T: 2000000000,  otto: '69279037' },
            { T: 20000000000, otto: '65353130' },   // > 2^32 s: controllo del contatore grande
        ];
        for (const { T, otto } of vettori) {
            const atteso6 = otto.slice(-6);
            const passo = totp.passoCorrente(T * 1000);
            const codice = totp.codiceDaPasso(SEED_RFC, passo);
            ok(`TOTP(T=${T}) -> ${atteso6}  (ultime 6 di ${otto})`, codice === atteso6, codice);

            const v = totp.verificaCodice(SEED_RFC, atteso6, { adessoMs: T * 1000 });
            ok(`verificaCodice accetta TOTP(T=${T}), passo ${passo}`,
                v.ok === true && v.passo === passo, JSON.stringify(v));
        }
        // consistenza interna: T=59 sta nel passo 1, e HOTP(seed, 1) = 287082
        ok('T=59 ricade nel passo 1 (coerente con HOTP contatore 1)',
            totp.passoCorrente(59 * 1000) === 1 && totp.codiceDaPasso(SEED_RFC, 1) === '287082');
    }

    // --- 1c. base32: andata/ritorno, tolleranze, rifiuti ---------------------------
    console.log('\n1c. base32');
    {
        let tornati = 0;
        for (let i = 0; i < 200; i++) {
            const buf = crypto.randomBytes(1 + Math.floor(Math.random() * 40));
            if (Buffer.compare(totp.decodificaBase32(totp.codificaBase32(buf)), buf) === 0) tornati++;
        }
        ok('200 buffer casuali: encode -> decode li restituisce identici', tornati === 200, `${tornati}/200`);

        const s = totp.generaSegretoBase32();
        ok("generaSegretoBase32 -> 32 caratteri dell'alfabeto", /^[A-Z2-7]{32}$/.test(s), s);

        const rif = totp.decodificaBase32('GEZDGNBVGY3TQOJQ');
        ok('minuscole tollerate',
            Buffer.compare(totp.decodificaBase32('gezdgnbvgy3tqojq'), rif) === 0);
        ok('spazi tollerati',
            Buffer.compare(totp.decodificaBase32('GEZD GNBV GY3T QOJQ'), rif) === 0);
        ok("'=' di padding tollerato",
            Buffer.compare(totp.decodificaBase32('GEZDGNBVGY3TQOJQ===='), rif) === 0);

        let lanciato = false;
        try { totp.decodificaBase32('GEZD0189'); } catch { lanciato = true; }  // 0/1/8/9 fuori base32
        ok('un carattere fuori alfabeto fa lanciare decodificaBase32', lanciato);
    }

    // --- 1d. finestra di verifica --------------------------------------------------
    console.log('\n1d. Finestra +/- 1 passo');
    {
        const segreto = totp.generaSegretoBase32();
        const adessoMs = 1_700_000_000_000;
        const codiceP = totp.codiceDaPasso(segreto, totp.passoCorrente(adessoMs));
        // Lo STESSO codice, "guardato" da momenti diversi: P-1/P/P+1 lo accettano, P-2/P+2 no.
        for (const [d, atteso] of [[-2, false], [-1, true], [0, true], [1, true], [2, false]]) {
            const v = totp.verificaCodice(segreto, codiceP, { adessoMs: adessoMs + d * 30_000 });
            ok(`codice del passo P: a P${d >= 0 ? '+' : ''}${d} -> ${atteso}`, v.ok === atteso, JSON.stringify(v));
        }
        ok("finestra 0: da P-1 il codice non passa piu'",
            totp.verificaCodice(segreto, codiceP, { adessoMs: adessoMs - 30_000, finestra: 0 }).ok === false);
        ok('un codice non di 6 cifre e\' rifiutato senza calcolare niente',
            totp.verificaCodice(segreto, '12345', { adessoMs }).ok === false &&
            totp.verificaCodice(segreto, 'abcdef', { adessoMs }).ok === false);
    }

    // --- 1e. scartoDiPasso (diagnostica dell'orologio) ---------------------------
    console.log('\n1e. scartoDiPasso');
    {
        const segreto = totp.generaSegretoBase32();
        const p = totp.passoCorrente();
        ok('codice del passo corrente -> 0',
            totp.scartoDiPasso(segreto, totp.codiceDaPasso(segreto, p)) === 0);
        ok('codice di 4 passi avanti -> +4',
            totp.scartoDiPasso(segreto, totp.codiceDaPasso(segreto, p + 4)) === 4);
        ok('codice di 3 passi indietro -> -3',
            totp.scartoDiPasso(segreto, totp.codiceDaPasso(segreto, p - 3)) === -3);
        ok('codice valido ma 50 passi fuori -> null entro +/- 10',
            totp.scartoDiPasso(segreto, totp.codiceDaPasso(segreto, p + 50), 10) === null);
        ok('codice non numerico -> null', totp.scartoDiPasso(segreto, 'abcdef') === null);
    }

    // --- 1f. zeri davanti nel codice --------------------------------------------
    console.log('\n1f. Zeri davanti (padStart)');
    {
        // Si cerca un (segreto, passo) che dia un valore numerico < 100000, cioe' con almeno
        // uno zero in testa: con prob. ~1/10 a tentativo si trova quasi subito.
        let conZero = null;
        for (let i = 0; i < 5000 && !conZero; i++) {
            const c = totp.codiceDaPasso(totp.generaSegretoBase32(), i);
            if (c[0] === '0') conZero = c;
        }
        ok('trovato un codice che inizia per 0', conZero !== null);
        ok('e ha comunque 6 caratteri', conZero !== null && conZero.length === 6, String(conZero));
    }

    // --- 1g. uriOtpauth --------------------------------------------------------
    console.log('\n1g. uriOtpauth');
    {
        const uri = totp.uriOtpauth({
            segreto: SEED_RFC, etichetta: 'mario+test@ésempio.it', emittente: 'Camoscio',
        });
        ok('prefisso otpauth://totp/', uri.startsWith('otpauth://totp/'), uri);
        ok('issuer=Camoscio', uri.includes('issuer=Camoscio'), uri);
        ok('il segreto e\' in chiaro (serve per la digitazione manuale)',
            uri.includes(`secret=${SEED_RFC}`), uri);
        ok('algorithm/digits/period dichiarati',
            uri.includes('algorithm=SHA1&digits=6&period=30'), uri);
        ok("l'URI e' ASCII puro (nessun byte non-ASCII)", /^[\x00-\x7F]*$/.test(uri), uri);
        ok("il '+' dell'email e' percent-codificato, non letterale",
            uri.includes('%2B') && !uri.includes('mario+test'), uri);
        ok("l'accento e' percent-codificato (%C3%A9)", uri.includes('%C3%A9'), uri);
    }

    // --- 1h. Codici di recupero: funzioni pure --------------------------------
    // Il consumo monouso ($pull condizionale, impronta rimossa) e' nella sezione 6, col server.
    console.log('\n1h. Codici di recupero (formato, alfabeto, normalizzazione, impronta)');
    {
        const RE_CODICE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
        const codici = totp.generaCodiciRecupero();
        ok('10 codici', codici.length === 10);
        ok('tutti distinti', new Set(codici).size === 10);
        ok('formato XXXX-XXXX-XXXX, alfabeto Crockford (niente I L O U)',
            codici.every(c => RE_CODICE.test(c)), codici.join(' '));
        ok('quanti=4 -> 4 codici', totp.generaCodiciRecupero(4).length === 4);

        ok('normalizza: minuscole, spazi e trattini',
            totp.normalizzaCodiceRecupero(' ab1c-d3f4 g5hj ') === 'AB1CD3F4G5HJ');
        ok('normalizza: I ed L diventano 1',
            totp.normalizzaCodiceRecupero('ilIL-2222-3333') === '111122223333');
        ok('normalizza: O diventa 0',
            totp.normalizzaCodiceRecupero('O0o0-1111-2222') === '000011112222');

        const uid = '64b2f0aa11223344aabbccdd';
        const h = totp.improntaCodiceRecupero(uid, 'ABCD-EFGH-JKMN');
        ok('impronta = 64 hex', /^[0-9a-f]{64}$/.test(h), h);
        ok('stessa impronta se lo stesso codice e\' riscritto in minuscolo con spazi',
            totp.improntaCodiceRecupero(uid, 'abcd efgh jkmn') === h);
        ok('impronta diversa per un altro userId',
            totp.improntaCodiceRecupero('64b2f0aa11223344aabbcce0', 'ABCD-EFGH-JKMN') !== h);
        ok('impronta diversa per un altro codice',
            totp.improntaCodiceRecupero(uid, 'ABCD-EFGH-JKMP') !== h);
    }

    // --- 1i. Guardie della revisione del cumulativo (09/09/2026) --------------
    // Non sono vettori RFC: sono le tre guardie non banali del batch di fix.
    console.log('\n1i. Guardie del batch (segreto corto, tetto finestra, codici senza rifiuto)');
    {
        // Segreto < 128 bit -> codiceDaPasso LANCIA. Su Node 24 createHmac con chiave vuota
        // NON lancia da solo e darebbe un HMAC deterministico (2FA calcolabile in silenzio).
        let lanci = 0;
        for (const s of ['', 'AA======', 'GEZDGNBVGY3TQOJQ' /* 10 byte, sotto i 16 */]) {
            try { totp.codiceDaPasso(s, 0); } catch { lanci++; }
        }
        ok('codiceDaPasso lancia su segreto < 16 byte (3 casi: vuoto, 1 byte, 10 byte)',
            lanci === 3, `${lanci}/3`);

        let propaga = false;
        try { totp.verificaCodice('', '123456', { adessoMs: 0 }); }
        catch { propaga = true; }
        ok('verificaCodice PROPAGA (non maschera un segreto rotto con {ok:false})', propaga);

        let propagaScarto = false;
        try { totp.scartoDiPasso('', '123456'); }
        catch { propagaScarto = true; }
        ok('scartoDiPasso PROPAGA sullo stesso segreto rotto', propagaScarto);

        // Tetto a 10 sulla finestra: una finestra assurda non gira miliardi di HMAC e non
        // allarga il match oltre +/- 10 passi. Che questo blocco finisca e' gia' la prova che
        // non c'e' un ciclo da 2e9 iterazioni.
        const seg = totp.generaSegretoBase32();
        const t0 = 1_700_000_000_000;
        const centro = totp.passoCorrente(t0);
        ok('finestra 1e9: il codice del passo corrente passa comunque, e in fretta',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro), { adessoMs: t0, finestra: 1e9 }).ok === true);
        ok('finestra 1e9: un codice 11 passi fuori NON passa (tetto = 10)',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro + 11), { adessoMs: t0, finestra: 1e9 }).ok === false);
        ok('finestra 1e9: un codice 9 passi fuori passa (dentro il tetto)',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro + 9), { adessoMs: t0, finestra: 1e9 }).ok === true);
        ok('finestra NaN / stringa -> trattata come 0 (solo il passo corrente)',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro), { adessoMs: t0, finestra: 'x' }).ok === true &&
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro - 1), { adessoMs: t0, finestra: 'x' }).ok === false);

        // finestra FRAZIONARIA / stringa numerica: Math.floor la porta a intero, niente
        // RangeError da BigInt(passo frazionario) (rilievo B-1, revisione 40a).
        let noRange = true;
        try {
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro), { adessoMs: t0, finestra: 1.5 });
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro), { adessoMs: t0, finestra: '2.5' });
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro), { adessoMs: t0, finestra: -5 });
        } catch { noRange = false; }
        ok('finestra 1.5 / "2.5" / -5 non lanciano (Math.floor + clamp 0..10)', noRange);
        ok('finestra 1.5 accetta comunque il passo +/-1 (arrotondata a 1)',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, centro + 1), { adessoMs: t0, finestra: 1.5 }).ok === true);

        // adessoMs non-numerico o null -> adesso, MAI BigInt(NaN) o il 1970 (rilievo B-1).
        let adessoOk = true;
        try {
            for (const bad of ['ieri', null, NaN, {}]) totp.verificaCodice(seg, '000000', { adessoMs: bad });
        } catch { adessoOk = false; }
        ok('adessoMs "ieri"/null/NaN/{} non lanciano (Number.isFinite -> Date.now())', adessoOk);
        ok('adessoMs null NON e\' il 1970 (un codice di adesso passa con adessoMs:null)',
            totp.verificaCodice(seg, totp.codiceDaPasso(seg, totp.passoCorrente()), { adessoMs: null }).ok === true);

        // scartoDiPasso: maxPassi enorme non blocca l'event loop (rilievo B-2). Se questo
        // blocco finisce, il tetto a 100 ha retto; in piu' un codice 200 passi fuori -> null.
        ok('scartoDiPasso con maxPassi 999999: codice 200 passi fuori -> null (tetto 100)',
            totp.scartoDiPasso(seg, totp.codiceDaPasso(seg, totp.passoCorrente() + 200), 999999) === null);
        ok('scartoDiPasso con maxPassi 999999: codice del passo corrente -> 0',
            totp.scartoDiPasso(seg, totp.codiceDaPasso(seg, totp.passoCorrente()), 999999) === 0);

        // Tolto `if (b >= 248) continue;`: controlla che la generazione non si sia rotta e che
        // ogni simbolo resti in alfabeto. NON misura il bias (test statistico = instabile);
        // il ragionamento 256 = 32*8 sta nel commento della funzione.
        const RE_SIMBOLO = /^[0-9A-HJKMNP-TV-Z]$/;
        const simboli = new Set();
        let fuoriAlfabeto = 0, totSimboli = 0;
        for (const c of totp.generaCodiciRecupero(200)) {
            for (const ch of c.replace(/-/g, '')) {
                totSimboli++;
                simboli.add(ch);
                if (!RE_SIMBOLO.test(ch)) fuoriAlfabeto++;
            }
        }
        ok('200 codici generati = 2400 simboli, tutti nell\'alfabeto Crockford',
            totSimboli === 2400 && fuoriAlfabeto === 0, `fuori: ${fuoriAlfabeto}`);
        ok('200 codici: compaiono tutti e 32 i simboli (nessuno sparito togliendo il rifiuto)',
            simboli.size === 32, `${simboli.size}/32`);
    }

    // =====================================================================================
    // SEZIONI 2-10 - le rotte (server di prova sulla 3137)
    // =====================================================================================
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const { scrubAccount } = require('../lib/accountDeletion');

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        reset: await mongoose.connection.collection('passwordresets').countDocuments()
    };
    console.log('\nConteggi di partenza (sez. 2-10):', partenza);

    let server, logServer = '';
    const ids = {};

    // azzera twoFactorLastStep: forzatura DELLA PROVA per non aspettare 30 s a ogni login
    // dove sotto prova c'e' il flusso e non l'anti-riuso (che e' la sezione 5, e NON sblocca).
    async function sbloccaPasso(userId) {
        await User.updateOne({ _id: userId }, { $unset: { twoFactorLastStep: 1 } });
    }
    async function creaUtente(tag, opzioni = {}) {
        const pwd = `pw-${tag}-${MARCA}-Xk`;
        const u = await User.create({
            username: `PROVA-2FA-${tag}-${MARCA}`,
            email: `prova-2fa-${tag}-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwd, 10),
            nome: 'Prova', cognome: tag,
            termsAcceptedAt: new Date(),
            emailVerified: opzioni.emailVerified !== false
        });
        ids[tag] = String(u._id);
        return { u, pwd };
    }
    // enable 2FA per un utente via il flusso HTTP vero; ritorna { segreto, recoveryCodes, cookie }
    async function accendi2fa(email, password) {
        const a = await loginPasso1(email, password);
        const s = await chiama('POST', '/api/auth/2fa/setup', {}, a.cookie);
        const en = await chiama('POST', '/api/auth/2fa/enable', { password, code: codiceOra(s.corpo.segreto) }, a.cookie);
        return { segreto: s.corpo.segreto, recoveryCodes: (en.corpo && en.corpo.recoveryCodes) || [], cookie: a.cookie, enable: en };
    }
    async function estraiTokenReset() {
        for (let i = 0; i < 30; i++) {
            const m = logServer.match(/reimposta-password\?token=([A-Za-z0-9_-]+)/);
            if (m) return m[1];
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA),
                MAILJET_API_KEY: '', MAILJET_SECRET_KEY: '', MAIL_SENDER_EMAIL: ''
            })
        });
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        // -----------------------------------------------------------------------------
        console.log('\n2. Contratto delle rotte');
        // -----------------------------------------------------------------------------
        for (const p of ['/2fa/setup', '/2fa/enable', '/2fa/disable', '/2fa/recovery-codes']) {
            const r = await chiama('POST', '/api/auth' + p, {}, null);
            ok(`POST ${p} senza sessione -> 401`, r.status === 401, `status ${r.status}`);
        }
        const senzaStato = await chiama('POST', '/api/auth/login/2fa', {}, null);
        ok('POST /login/2fa senza stato intermedio -> 401 { ripartiDaCapo: true }',
            senzaStato.status === 401 && senzaStato.corpo && senzaStato.corpo.ripartiDaCapo === true,
            JSON.stringify(senzaStato.corpo));

        // account demo -> 403 su tutte le /2fa/*
        const demo = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        const rDemo = await fetch(BASE + '/api/auth/demo-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: demo[0].id || demo[0]._id })
        });
        const cookieDemo = cookieDa(rDemo);
        for (const p of ['/2fa/setup', '/2fa/enable', '/2fa/disable', '/2fa/recovery-codes']) {
            const r = await chiama('POST', '/api/auth' + p, { code: '000000', password: 'x' }, cookieDemo);
            ok(`POST ${p} su account demo -> 403`, r.status === 403, `status ${r.status} ${JSON.stringify(r.corpo)}`);
        }

        // utente U1: ciclo completo
        const { u: u1, pwd: pwd1 } = await creaUtente('U1');
        const a1 = await loginPasso1(u1.email, pwd1);
        ok('U1 (senza 2FA) login -> 200 col profilo pieno',
            a1.status === 200 && a1.corpo && a1.corpo.username && !a1.corpo.twoFactorRequired, JSON.stringify({ s: a1.status }));
        const cookie1 = a1.cookie;

        const enSenzaSetup = await chiama('POST', '/api/auth/2fa/enable', { password: pwd1, code: '000000' }, cookie1);
        ok('POST /2fa/enable senza aver fatto /setup -> 400', enSenzaSetup.status === 400, `status ${enSenzaSetup.status}`);

        const s1a = await chiama('POST', '/api/auth/2fa/setup', {}, cookie1);
        const s1b = await chiama('POST', '/api/auth/2fa/setup', {}, cookie1);
        ok('POST /2fa/setup -> 200 { segreto (32 base32), uri otpauth, scadeIl }',
            s1a.status === 200 && /^[A-Z2-7]{32}$/.test(s1a.corpo.segreto || '')
            && String(s1a.corpo.uri || '').startsWith('otpauth://totp/') && !!s1a.corpo.scadeIl,
            JSON.stringify(s1a.corpo));
        ok('/2fa/setup due volte -> STESSO segreto (idempotente: non invalida il QR della prima scheda)',
            s1a.corpo.segreto === s1b.corpo.segreto);
        const seg1 = s1a.corpo.segreto;

        // -----------------------------------------------------------------------------
        console.log('\n3. Attivazione');
        // -----------------------------------------------------------------------------
        // D-4: email non confermata -> /enable rifiuta PRIMA ancora di guardare il codice
        const { u: u3, pwd: pwd3 } = await creaUtente('U3', { emailVerified: false });
        const a3 = await loginPasso1(u3.email, pwd3);
        await chiama('POST', '/api/auth/2fa/setup', {}, a3.cookie);
        const en3 = await chiama('POST', '/api/auth/2fa/enable', { password: pwd3, code: '000000' }, a3.cookie);
        ok('D-4: /2fa/enable con emailVerified:false -> 400 e messaggio "conferma"',
            en3.status === 400 && /conferma/i.test((en3.corpo && en3.corpo.error) || ''), JSON.stringify(en3.corpo));

        const enWrongPwd = await chiama('POST', '/api/auth/2fa/enable', { password: 'sbagliata-' + MARCA, code: codiceOra(seg1) }, cookie1);
        ok('/2fa/enable con password sbagliata -> 401',
            enWrongPwd.status === 401 && /[Pp]assword/.test((enWrongPwd.corpo && enWrongPwd.corpo.error) || ''),
            JSON.stringify(enWrongPwd.corpo));

        const enBad = await chiama('POST', '/api/auth/2fa/enable', { password: pwd1, code: '000000' }, cookie1);
        ok('/2fa/enable con codice sbagliato -> 401', enBad.status === 401, `status ${enBad.status}`);

        const en1 = await chiama('POST', '/api/auth/2fa/enable', { password: pwd1, code: codiceOra(seg1) }, cookie1);
        ok('/2fa/enable con codice giusto -> 200 { success }',
            en1.status === 200 && en1.corpo && en1.corpo.success === true,
            JSON.stringify({ s: en1.status, e: en1.corpo && en1.corpo.error }));
        const recCodes1 = (en1.corpo && en1.corpo.recoveryCodes) || [];
        ok('...10 codici di recupero, tutti distinti', recCodes1.length === 10 && new Set(recCodes1).size === 10, `${recCodes1.length}`);
        ok('...attivoDal presente nella risposta', !!(en1.corpo && en1.corpo.attivoDal));

        const docU1 = await User.findById(u1._id).select('+twoFactorSecret +twoFactorPending +twoFactorPendingAt +twoFactorRecoveryHashes +twoFactorLastStep');
        ok('DB: twoFactorSecret presente e = il segreto del /setup', docU1.twoFactorSecret === seg1);
        ok('DB: twoFactorEnabledAt presente', !!docU1.twoFactorEnabledAt);
        ok('DB: twoFactorPending / twoFactorPendingAt ASSENTI dopo enable',
            docU1.twoFactorPending === undefined && docU1.twoFactorPendingAt === undefined);
        ok('DB: 10 impronte di recupero, tutte sha256 (nessun codice in chiaro)',
            Array.isArray(docU1.twoFactorRecoveryHashes) && docU1.twoFactorRecoveryHashes.length === 10
            && docU1.twoFactorRecoveryHashes.every(h => /^[0-9a-f]{64}$/.test(h)));
        ok('DB: il codice di attivazione e\' gia\' "speso" (twoFactorLastStep valorizzato)',
            typeof docU1.twoFactorLastStep === 'number');

        const me1 = await chiama('GET', '/api/auth/me', null, cookie1);
        ok('/me: porta twoFactorEnabledAt', me1.status === 200 && !!me1.corpo.twoFactorEnabledAt);
        ok('/me: NON porta twoFactorSecret / twoFactorPending / twoFactorRecoveryHashes',
            me1.corpo.twoFactorSecret === undefined && me1.corpo.twoFactorPending === undefined
            && me1.corpo.twoFactorRecoveryHashes === undefined, JSON.stringify(Object.keys(me1.corpo)));

        const setupAttivo = await chiama('POST', '/api/auth/2fa/setup', {}, cookie1);
        ok('/2fa/setup su un 2FA GIA\' attivo -> 409', setupAttivo.status === 409, `status ${setupAttivo.status}`);
        const enableAttivo = await chiama('POST', '/api/auth/2fa/enable', { code: codiceOra(seg1) }, cookie1);
        ok('/2fa/enable su un 2FA GIA\' attivo -> 409', enableAttivo.status === 409, `status ${enableAttivo.status}`);

        // -----------------------------------------------------------------------------
        console.log('\n4. Login a due passi');
        // -----------------------------------------------------------------------------
        await sbloccaPasso(u1._id);
        const p1 = await loginPasso1(u1.email, pwd1);
        ok('login passo 1: 200 { twoFactorRequired: true }',
            p1.status === 200 && p1.corpo && p1.corpo.twoFactorRequired === true, JSON.stringify(p1.corpo));
        ok('login passo 1: il corpo NON contiene username / email / avatar',
            p1.corpo.username === undefined && p1.corpo.email === undefined && p1.corpo.avatar === undefined,
            JSON.stringify(Object.keys(p1.corpo)));
        const meMezzo = await chiama('GET', '/api/auth/me', null, p1.cookie);
        ok('GET /me FRA i due passi -> 401 (la sessione non e\' aperta) [CONTROLLO CENTRALE]',
            meMezzo.status === 401, `status ${meMezzo.status}`);
        const p2bad = await chiama('POST', '/api/auth/login/2fa', { code: '000000' }, p1.cookie);
        ok('login passo 2 con codice sbagliato -> 401', p2bad.status === 401, `status ${p2bad.status}`);
        const code4 = codiceOra(seg1);
        const p2 = await chiama('POST', '/api/auth/login/2fa', { code: code4 }, p1.cookie);
        ok('login passo 2 con codice giusto -> 200 col profilo',
            p2.status === 200 && p2.corpo && p2.corpo.username, JSON.stringify({ s: p2.status, e: p2.corpo && p2.corpo.error }));
        const meDopo = await chiama('GET', '/api/auth/me', null, p2.cookie);
        ok('GET /me DOPO il passo 2 -> 200', meDopo.status === 200 && !!meDopo.corpo.username);

        // -----------------------------------------------------------------------------
        console.log('\n5. Anti-riuso del codice TOTP (CAS, NIENTE sbloccaPasso)');
        // -----------------------------------------------------------------------------
        const p1b = await loginPasso1(u1.email, pwd1);
        const p2reuse = await chiama('POST', '/api/auth/login/2fa', { code: code4 }, p1b.cookie);
        ok('lo STESSO codice TOTP, secondo login nella stessa finestra -> 401',
            p2reuse.status === 401, `status ${p2reuse.status} ${JSON.stringify(p2reuse.corpo)}`);

        // -----------------------------------------------------------------------------
        console.log('\n6. Codice di recupero monouso');
        // -----------------------------------------------------------------------------
        const p1c = await loginPasso1(u1.email, pwd1);
        const usoRec = await chiama('POST', '/api/auth/login/2fa', { recoveryCode: recCodes1[0] }, p1c.cookie);
        ok('login con un codice di recupero -> 200 + recoveryCodesRimasti: 9',
            usoRec.status === 200 && usoRec.corpo && usoRec.corpo.recoveryCodesRimasti === 9,
            JSON.stringify({ s: usoRec.status, r: usoRec.corpo && usoRec.corpo.recoveryCodesRimasti }));
        const docU1b = await User.findById(u1._id).select('+twoFactorRecoveryHashes');
        ok('DB: restano 9 impronte', docU1b.twoFactorRecoveryHashes.length === 9);
        const p1d = await loginPasso1(u1.email, pwd1);
        const recReuse = await chiama('POST', '/api/auth/login/2fa', { recoveryCode: recCodes1[0] }, p1d.cookie);
        ok('lo STESSO codice di recupero di nuovo -> 401', recReuse.status === 401, `status ${recReuse.status}`);
        const p1e = await loginPasso1(u1.email, pwd1);
        const recSporco = recCodes1[1].toLowerCase().replace(/-/g, '  ');
        const recNorm = await chiama('POST', '/api/auth/login/2fa', { recoveryCode: recSporco }, p1e.cookie);
        ok('un codice di recupero in minuscolo, con spazi e senza trattini -> accettato (200)',
            recNorm.status === 200, `status ${recNorm.status} (inviato: "${recSporco}")`);

        // -----------------------------------------------------------------------------
        // 6b. Rigenerazione dei codici di recupero (/2fa/recovery-codes) - buco di test
        // segnalato dalla revisione del cumulativo 42a: la rotta aveva solo il contratto
        // (401/403), mai il percorso riuscito. cookie1 e' ancora una sessione valida di U1
        // (aperta in sez. 2, prima ancora di accendere il 2FA: requireAuth non chiede altro).
        console.log('\n6b. Rigenerazione dei codici di recupero (/2fa/recovery-codes)');
        // -----------------------------------------------------------------------------
        await sbloccaPasso(u1._id);
        const vecchioCodiceVivo = recCodes1[3]; // mai usato nelle sezioni 6/precedenti
        const rigen = await chiama('POST', '/api/auth/2fa/recovery-codes', { password: pwd1, code: codiceOra(seg1) }, cookie1);
        ok('/2fa/recovery-codes con password + codice giusti -> 200 con 10 codici nuovi, tutti distinti',
            rigen.status === 200 && Array.isArray(rigen.corpo.recoveryCodes)
            && rigen.corpo.recoveryCodes.length === 10 && new Set(rigen.corpo.recoveryCodes).size === 10,
            JSON.stringify({ s: rigen.status, n: rigen.corpo.recoveryCodes && rigen.corpo.recoveryCodes.length }));
        const nuoviCodici = rigen.corpo.recoveryCodes || [];
        ok('...i 10 codici nuovi sono DIVERSI da tutti quelli vecchi', !nuoviCodici.some(c => recCodes1.includes(c)));

        const docU1rigen = await User.findById(u1._id).select('+twoFactorRecoveryHashes');
        ok('DB: esattamente 10 impronte dopo la rigenerazione (sostituzione, non accodamento)',
            Array.isArray(docU1rigen.twoFactorRecoveryHashes) && docU1rigen.twoFactorRecoveryHashes.length === 10,
            `${docU1rigen.twoFactorRecoveryHashes && docU1rigen.twoFactorRecoveryHashes.length}`);

        const p1h = await loginPasso1(u1.email, pwd1);
        const vecchioRifiutato = await chiama('POST', '/api/auth/login/2fa', { recoveryCode: vecchioCodiceVivo }, p1h.cookie);
        ok('un codice di recupero VECCHIO (di prima della rigenerazione) -> 401',
            vecchioRifiutato.status === 401, `status ${vecchioRifiutato.status}`);

        const p1i = await loginPasso1(u1.email, pwd1);
        const nuovoAccettato = await chiama('POST', '/api/auth/login/2fa', { recoveryCode: nuoviCodici[0] }, p1i.cookie);
        ok('un codice di recupero NUOVO -> 200', nuovoAccettato.status === 200, `status ${nuovoAccettato.status}`);

        // -----------------------------------------------------------------------------
        console.log('\n7. Reset password a due passi (U4)');
        // -----------------------------------------------------------------------------
        const { u: u4, pwd: pwd4 } = await creaUtente('U4');
        const acc4 = await accendi2fa(u4.email, pwd4);
        ok('U4: 2FA acceso', acc4.enable.status === 200, JSON.stringify({ s: acc4.enable.status }));
        const seg4 = acc4.segreto;

        logServer = '';
        await chiama('POST', '/api/auth/forgot-password', { email: u4.email }, null);
        const token4 = await estraiTokenReset();
        ok('U4: un token di reset e\' comparso nel log del server', !!token4, token4 ? '' : logServer.slice(-300));

        const chk4 = await chiama('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(token4)}`);
        ok('/reset-password/check -> { valid: true, twoFactorRequired: true }',
            chk4.corpo && chk4.corpo.valid === true && chk4.corpo.twoFactorRequired === true, JSON.stringify(chk4.corpo));

        const nuovaPwd4 = `NUOVA-${MARCA}-ab`;
        const rsSenza = await chiama('POST', '/api/auth/reset-password', { token: token4, password: nuovaPwd4 }, null);
        ok('/reset-password SENZA codice -> 401 { twoFactorRequired: true }',
            rsSenza.status === 401 && rsSenza.corpo && rsSenza.corpo.twoFactorRequired === true, JSON.stringify(rsSenza.corpo));
        const provaVecchia = await chiama('POST', '/api/auth/login', { email: u4.email, password: pwd4 }, null);
        ok('...la password NON e\' cambiata (il login vecchio arriva ancora al passo 1)',
            provaVecchia.status === 200 && provaVecchia.corpo.twoFactorRequired === true, JSON.stringify(provaVecchia.corpo));
        const chk4b = await chiama('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(token4)}`);
        ok('...e il token e\' ANCORA valido', chk4b.corpo && chk4b.corpo.valid === true);

        await sbloccaPasso(u4._id);
        const rsOk = await chiama('POST', '/api/auth/reset-password',
            { token: token4, password: nuovaPwd4, code: codiceOra(seg4) }, null);
        ok('/reset-password con password + codice giusto -> 200',
            rsOk.status === 200 && rsOk.corpo && rsOk.corpo.success === true, JSON.stringify(rsOk.corpo));
        const chk4c = await chiama('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(token4)}`);
        ok('...il token e\' sparito (usa e getta)', chk4c.corpo && chk4c.corpo.valid === false);
        const loginNuova = await chiama('POST', '/api/auth/login', { email: u4.email, password: nuovaPwd4 }, null);
        ok('...la password nuova funziona, e il 2FA e\' ANCORA richiesto (il reset non lo spegne)',
            loginNuova.status === 200 && loginNuova.corpo.twoFactorRequired === true, JSON.stringify(loginNuova.corpo));

        // 7b: 5 tentativi a vuoto -> il token muore
        logServer = '';
        await chiama('POST', '/api/auth/forgot-password', { email: u4.email }, null);
        const token4b = await estraiTokenReset();
        ok('U4: un secondo token di reset', !!token4b);
        let ultimo;
        for (let i = 1; i <= 5; i++) {
            const r = await chiama('POST', '/api/auth/reset-password',
                { token: token4b, password: `X-${MARCA}-abcd`, code: '000000' }, null);
            ultimo = { status: r.status, corpo: r.corpo };
        }
        ok('5 tentativi 2FA sbagliati: l\'ultimo -> 400 (token cancellato)',
            ultimo.status === 400, `ultimo ${JSON.stringify(ultimo)}`);
        const chk4d = await chiama('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(token4b)}`);
        ok('...e /check ora dice valid:false', chk4d.corpo && chk4d.corpo.valid === false);

        // -----------------------------------------------------------------------------
        console.log('\n8. Disattivazione (U1)');
        // -----------------------------------------------------------------------------
        await sbloccaPasso(u1._id);
        const d1 = await loginPasso1(u1.email, pwd1);
        const d1full = await chiama('POST', '/api/auth/login/2fa', { code: codiceOra(seg1) }, d1.cookie);
        ok('U1: login completo per la disattivazione', d1full.status === 200, JSON.stringify({ s: d1full.status }));
        const cookieD = d1full.cookie;

        const disNoPwd = await chiama('POST', '/api/auth/2fa/disable', {}, cookieD);
        ok('/2fa/disable senza password -> 401', disNoPwd.status === 401, `status ${disNoPwd.status}`);
        const disNoCode = await chiama('POST', '/api/auth/2fa/disable', { password: pwd1 }, cookieD);
        ok('/2fa/disable con password ma senza secondo fattore -> 401', disNoCode.status === 401, `status ${disNoCode.status}`);
        // recCodes1 e' stato interamente sostituito dalla rigenerazione di sez. 6b: da qui in
        // poi i codici vivi di U1 sono quelli in nuoviCodici (indice 0 gia' speso in 6b).
        const disWrongPwd = await chiama('POST', '/api/auth/2fa/disable', { password: 'sbagliata', recoveryCode: nuoviCodici[1] }, cookieD);
        ok('/2fa/disable con password sbagliata -> 401', disWrongPwd.status === 401, `status ${disWrongPwd.status}`);
        const disOk = await chiama('POST', '/api/auth/2fa/disable', { password: pwd1, recoveryCode: nuoviCodici[1] }, cookieD);
        ok('/2fa/disable con password + codice di recupero -> 200',
            disOk.status === 200 && disOk.corpo && disOk.corpo.success === true, JSON.stringify(disOk.corpo));
        const docU1c = await User.findById(u1._id)
            .select('+twoFactorSecret +twoFactorPending +twoFactorPendingAt +twoFactorLastStep +twoFactorRecoveryHashes');
        ok('DB: tutti e 6 i campi 2FA ASSENTI dopo disable',
            docU1c.twoFactorSecret === undefined && docU1c.twoFactorPending === undefined
            && docU1c.twoFactorPendingAt === undefined && docU1c.twoFactorEnabledAt === undefined
            && docU1c.twoFactorLastStep === undefined && docU1c.twoFactorRecoveryHashes === undefined,
            JSON.stringify({
                s: docU1c.twoFactorSecret, e: docU1c.twoFactorEnabledAt,
                l: docU1c.twoFactorLastStep, r: docU1c.twoFactorRecoveryHashes
            }));
        const loginDopoDisable = await chiama('POST', '/api/auth/login', { email: u1.email, password: pwd1 }, null);
        ok('dopo disable: login in UN passo solo (niente twoFactorRequired)',
            loginDopoDisable.status === 200 && !loginDopoDisable.corpo.twoFactorRequired && loginDopoDisable.corpo.username,
            JSON.stringify({ tfr: loginDopoDisable.corpo.twoFactorRequired }));

        // -----------------------------------------------------------------------------
        console.log('\n9. Stati speciali: account in eliminazione + 2FA (U5)');
        // -----------------------------------------------------------------------------
        const { u: u5, pwd: pwd5 } = await creaUtente('U5');
        const acc5 = await accendi2fa(u5.email, pwd5);
        ok('U5: 2FA acceso', acc5.enable.status === 200);
        const seg5 = acc5.segreto;
        await User.updateOne({ _id: u5._id }, {
            $set: { pendingDeletionAt: new Date(), deletionScrubAt: new Date(Date.now() + 30 * 864e5) }
        });
        await sbloccaPasso(u5._id);
        const q1 = await loginPasso1(u5.email, pwd5);
        ok('U5 (in eliminazione) login passo 1 -> 200 { twoFactorRequired: true }',
            q1.status === 200 && q1.corpo && q1.corpo.twoFactorRequired === true, JSON.stringify(q1.corpo));
        const u5mezzo = await User.findById(u5._id);
        ok('...dopo il PRIMO passo pendingDeletionAt e\' ANCORA li\' (ripristino NON fatto sulla sola password)',
            !!u5mezzo.pendingDeletionAt);
        const q2 = await chiama('POST', '/api/auth/login/2fa', { code: codiceOra(seg5) }, q1.cookie);
        ok('...passo 2 -> 200 con eliminazioneAnnullata: true',
            q2.status === 200 && q2.corpo && q2.corpo.eliminazioneAnnullata === true,
            JSON.stringify({ s: q2.status, e: q2.corpo && q2.corpo.eliminazioneAnnullata }));
        const u5dopo = await User.findById(u5._id);
        ok('...e ORA pendingDeletionAt e\' sparito', u5dopo.pendingDeletionAt === undefined);

        // -----------------------------------------------------------------------------
        console.log('\n10. scrubAccount() porta via segreto e impronte');
        // -----------------------------------------------------------------------------
        const u6 = await User.create({
            username: `PROVA-2FA-U6-${MARCA}`, email: `prova-2fa-u6-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(`pw-${MARCA}`, 10), nome: 'Prova', cognome: 'U6',
            termsAcceptedAt: new Date(), emailVerified: true,
            twoFactorSecret: totp.generaSegretoBase32(), twoFactorEnabledAt: new Date(),
            twoFactorRecoveryHashes: ['a'.repeat(64), 'b'.repeat(64)], twoFactorLastStep: 42
        });
        ids.U6 = String(u6._id);
        await scrubAccount(await User.findById(u6._id).select('+passwordHash'));
        const u6dopo = await User.findById(u6._id)
            .select('+twoFactorSecret +twoFactorRecoveryHashes +twoFactorLastStep +twoFactorPending +twoFactorPendingAt');
        ok('scrubAccount: twoFactorSecret e le impronte di recupero SPARITI',
            u6dopo.twoFactorSecret === undefined && u6dopo.twoFactorRecoveryHashes === undefined);
        ok('scrubAccount: spariti anche twoFactorEnabledAt / LastStep / Pending / PendingAt',
            u6dopo.twoFactorEnabledAt === undefined && u6dopo.twoFactorLastStep === undefined
            && u6dopo.twoFactorPending === undefined && u6dopo.twoFactorPendingAt === undefined);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA (sez. 2-10):', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + (e && e.message));
    } finally {
        if (server) server.kill();

        const oid = s => { try { return new mongoose.Types.ObjectId(s); } catch { return null; } };
        for (const k of Object.keys(ids)) if (ids[k]) {
            await User.deleteOne({ _id: oid(ids[k]) }).catch(() => {});
            await mongoose.connection.collection('passwordresets').deleteMany({ userId: oid(ids[k]) }).catch(() => {});
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            reset: await mongoose.connection.collection('passwordresets').countDocuments()
        };
        console.log('\nConteggi finali (sez. 2-10):', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessun PasswordReset di prova rimasto', fine.reset === partenza.reset, `${partenza.reset} -> ${fine.reset}`);

        await mongoose.disconnect();
        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti === 0 ? 0 : 1);
    }
})().catch(e => { console.error('ERRORE NON GESTITO NELLA PROVA:', e); process.exit(1); });
