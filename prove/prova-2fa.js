// Prova del secondo fattore TOTP (2FA).
//
// BLOCCO 1 del piano (C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md, sez. 11): qui c'e'
// SOLO LA SEZIONE 1 - lib/totp.js provato da solo contro i vettori degli RFC, senza server e
// senza database. Le sezioni 2-10 (contratto delle rotte, login a due passi, codici di
// recupero monouso, reset a due passi, disattivazione, scrub, ...) arrivano coi blocchi
// successivi e vogliono un server di prova sulla porta 3136.
//
// L'ORACOLO SONO GLI RFC. I valori attesi qui sotto sono TRASCRITTI dal testo degli RFC
// (4226 Appendice D; 6238 Appendice B, colonna SHA1), non calcolati da noi: una prova che si
// costruisce l'atteso con lo stesso codice che verifica non prova niente.
//
//   node prove/prova-2fa.js        (la sezione 1 non vuole il server)

const crypto = require('crypto');
const totp = require('../lib/totp');

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Il seed dei vettori RFC: ASCII "12345678901234567890" (20 byte).
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

    console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
    process.exit(falliti === 0 ? 0 : 1);
})().catch(e => { console.error('ERRORE NON GESTITO NELLA PROVA:', e); process.exit(1); });
