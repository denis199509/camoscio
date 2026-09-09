// TOTP (RFC 6238) e HOTP (RFC 4226) scritti a mano sul modulo `crypto` di Node, piu' la
// gestione delle impronte dei codici di recupero monouso. Zero dipendenze: e' una decisione
// di Denis (07/09/2026) e insieme il vincolo hard 2 (tutto open source dove possibile) - una
// libreria TOTP porterebbe un albero di dipendenze per ~150 righe di aritmetica su un HMAC.
//
// Stessa filosofia di lib/tokens.js: e' il livello di DOMINIO. Nessun accesso al database,
// nessun `req`, nessun modello Mongoose. Le rotte lo useranno e basta, e si prova da solo
// contro i vettori degli RFC senza server ne' database (prove/prova-2fa.js, sezione 1).
//
// ---------------------------------------------------------------------------------------------
// LE TRE TRAPPOLE DELL'HOTP - quelle che danno un codice "quasi giusto" che non combacia MAI
// con nessuna app authenticator, e senza nessun messaggio d'errore che aiuti a capirlo:
//
//  1. LA CHIAVE DELL'HMAC SONO I BYTE DECODIFICATI, non la stringa base32.
//     crypto.createHmac('sha1', decodificaBase32(segreto))  -  non  ...('sha1', segreto).
//     Passare la stringa produce 6 cifre plausibili che nessun telefono accettera'.
//
//  2. IL CONTATORE E' UN INTERO A 64 BIT BIG-ENDIAN, IN UN BUFFER DI 8 BYTE (RFC 4226 5.1).
//     Buffer.alloc(8) + writeBigUInt64BE: cosi' non c'e' modo che gli operatori bit a bit di
//     JS (che lavorano su int32 con segno) lo taglino impacchettandolo a mano. Il vettore
//     RFC 6238 con T = 20000000000 e' incluso nella prova come controllo del contatore grande.
//
//  3. TRONCAMENTO DINAMICO (RFC 4226 5.3) e ZERO DAVANTI. L'offset sono i 4 bit bassi
//     dell'ultimo byte dell'HMAC; da li' si prendono 31 bit; modulo 10^CIFRE; e si imbottisce
//     con padStart(CIFRE, '0'). String(1234) darebbe 4 cifre e non combacerebbe: una volta su 10.
//
// CONFRONTO A TEMPO COSTANTE: crypto.timingSafeEqual LANCIA se i due Buffer hanno lunghezza
// diversa, quindi la lunghezza si confronta prima (e per un codice a 6 cifre la lunghezza non
// e' un segreto). E' lo stesso problema gia' risolto in lib/cronSecret.js (stringheUguali,
// righe 20-24): codiciUguali() qui sotto e' quella riga, riscritta per i codici.
//
// IMPRONTE DEI CODICI DI RECUPERO: sha256 (impronta() di lib/tokens.js) con l'userId in testa,
// NON bcrypt. A ogni tentativo sbagliato il server farebbe fino a 10 confronti bcrypt (~1 s di
// CPU su Render gratuito, istanza singola): un vettore DoS, non una difesa. Un codice a 60 bit
// da crypto.randomBytes non sta in nessun dizionario e non ha bisogno di un hash lento. La
// stringa da hashare si compone SOLO qui: se generazione e verifica la costruissero in modo
// diverso, i codici smetterebbero di funzionare in silenzio e se ne accorgerebbe solo chi ha
// gia' perso il telefono.

const crypto = require('crypto');
const { impronta } = require('./tokens');

const PASSO_SECONDI = 30;   // RFC 6238: durata di un passo temporale
const CIFRE = 6;            // lunghezza del codice: lo standard di fatto di Google Authenticator
const FINESTRA = 1;         // al login si accettano il passo precedente e il successivo: +/- 30 s

// RFC 4648, alfabeto base32 "standard" (maiuscole + 2-7). E' quello che ogni app si aspetta.
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Crockford base32 per i codici di recupero: niente I, L, O, U (si confondono con 1/0 o
// formano parole). In lettura I/L -> 1 e O -> 0 (vedi normalizzaCodiceRecupero).
const ALFABETO_RECUPERO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LUNGHEZZA_CODICE_RECUPERO = 12;   // 12 caratteri su 32 simboli = 60 bit
const QUANTI_CODICI_RECUPERO = 10;

// --- base32 --------------------------------------------------------------------------------

// Buffer -> stringa base32 senza padding. Accumula i bit in un intero e ne sfila 5 alla volta.
function codificaBase32(buffer) {
    let out = '';
    let acc = 0, bit = 0;
    for (const byte of buffer) {
        acc = (acc << 8) | byte;
        bit += 8;
        while (bit >= 5) {
            bit -= 5;
            out += ALFABETO_BASE32[(acc >>> bit) & 31];
        }
        acc &= (1 << bit) - 1;   // butta i bit gia' consumati: acc non deve crescere all'infinito
    }
    if (bit > 0) out += ALFABETO_BASE32[(acc << (5 - bit)) & 31];
    return out;
}

// stringa base32 -> Buffer. Tollera minuscole, spazi e '=' di padding; LANCIA su un carattere
// fuori alfabeto - un segreto malformato non deve passare inosservato.
function decodificaBase32(stringa) {
    const pulita = String(stringa).toUpperCase().replace(/[\s=]/g, '');
    const byte = [];
    let acc = 0, bit = 0;
    for (const ch of pulita) {
        const v = ALFABETO_BASE32.indexOf(ch);
        if (v < 0) throw new Error(`base32: carattere non valido ${JSON.stringify(ch)}`);
        acc = (acc << 5) | v;
        bit += 5;
        if (bit >= 8) {
            bit -= 8;
            byte.push((acc >>> bit) & 0xff);
        }
        acc &= (1 << bit) - 1;
    }
    return Buffer.from(byte);
}

// 20 byte (160 bit = il blocco di HMAC-SHA1, la dimensione che ogni app si aspetta) -> 32 char.
function generaSegretoBase32() {
    return codificaBase32(crypto.randomBytes(20));
}

// --- HOTP / TOTP --------------------------------------------------------------------------

// Passo temporale corrente: RFC 6238 con T0 = 0 e X = PASSO_SECONDI.
function passoCorrente(adessoMs = Date.now()) {
    return Math.floor(adessoMs / 1000 / PASSO_SECONDI);
}

// HOTP (RFC 4226) sul passo dato -> CIFRE cifre, con gli zeri davanti.
function codiceDaPasso(segreto, passo) {
    const chiave = decodificaBase32(segreto);              // BYTE, non la stringa (trappola 1)
    // RFC 4226 R6: il segreto condiviso DEVE essere lungo almeno 128 bit (16 byte). Un
    // twoFactorSecret vuoto o troncato (bug di scrittura, campo corrotto) NON deve produrre un
    // codice: su Node 24 crypto.createHmac('sha1', Buffer.alloc(0)) non lancia e darebbe un HMAC
    // deterministico -> il secondo fattore diventerebbe calcolabile da chiunque sappia che il
    // segreto e' vuoto, in silenzio. Meglio un errore forte (login negato, 500 nei log) che un
    // 2FA aggirabile. verificaCodice/scartoDiPasso lo propagano: un segreto rotto non e' un "no".
    // NB per chi scrivera' le rotte (blocco 2 del piano): in Express un throw da un handler
    // async NON gestito diventa unhandledRejection e su Node 24 fa CADERE il processo (spegne
    // anche il Dead Man's Switch) - ogni chiamante va in try/catch, col catch che nega e logga.
    if (chiave.length < 16) throw new Error('TOTP: segreto troppo corto (< 128 bit)');
    const contatore = Buffer.alloc(8);
    contatore.writeBigUInt64BE(BigInt(passo), 0);          // 64 bit big-endian (trappola 2)
    const h = crypto.createHmac('sha1', chiave).update(contatore).digest();
    const offset = h[h.length - 1] & 0x0f;                 // troncamento dinamico (RFC 4226 5.3)
    const bin = ((h[offset] & 0x7f) << 24)
              | ((h[offset + 1] & 0xff) << 16)
              | ((h[offset + 2] & 0xff) << 8)
              | (h[offset + 3] & 0xff);
    return String(bin % (10 ** CIFRE)).padStart(CIFRE, '0');   // zero davanti (trappola 3)
}

// Solo cifre; via spazi e ogni altro segno. '' se non resta niente.
function soloCifre(s) {
    return String(s).replace(/\D+/g, '');
}

// Confronto a tempo costante di due codici numerici (vedi l'intestazione del file).
function codiciUguali(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Verifica un codice TOTP nella finestra +/- `finestra` passi intorno ad adesso.
// -> { ok: true, passo }  se combacia (passo = il passo che l'ha accettato, serve al CAS
//    anti-riuso su twoFactorLastStep);  { ok: false }  altrimenti.
function verificaCodice(segreto, codice, opzioni = {}) {
    // adessoMs: solo un numero finito, altrimenti adesso. Un 'ieri' o un null passavano
    // (=== undefined non li prende) e diventavano BigInt(NaN) / il 1970 in codiceDaPasso.
    const adessoMs = Number.isFinite(opzioni.adessoMs) ? opzioni.adessoMs : Date.now();
    // finestra: intero, fra 0 e 10. Senza il tetto, {finestra: 1e9} girava un ciclo da due
    // miliardi di HMAC; senza Math.floor, {finestra: 1.5} dava un passo frazionario ->
    // BigInt() lancia RangeError (stessa classe del Math.max chiuso come URGENTE nella 35a).
    // +/- 10 passi = +/- 5 minuti, gia' larghissimo (al login vero si usa FINESTRA = 1).
    const finestra = Math.min(Math.max(0, Math.floor(Number(opzioni.finestra ?? FINESTRA) || 0)), 10);
    const atteso = soloCifre(codice);
    if (atteso.length !== CIFRE) return { ok: false };
    const centro = passoCorrente(adessoMs);
    for (let d = -finestra; d <= finestra; d++) {
        const passo = centro + d;
        if (passo < 0) continue;
        if (codiciUguali(codiceDaPasso(segreto, passo), atteso)) return { ok: true, passo };
    }
    return { ok: false };
}

// SOLO per la schermata di attivazione: di quanti passi e' sfasato l'orologio del telefono?
// Ritorna lo scarto in passi (negativo = telefono indietro) col valore assoluto piu' piccolo,
// oppure null se il codice non combacia entro +/- maxPassi. NON si usa al login: allargare la
// finestra per comodita' e' il modo di indebolire il meccanismo senza accorgersene.
function scartoDiPasso(segreto, codice, maxPassi = 10, adessoMs = Date.now()) {
    const atteso = soloCifre(codice);
    if (atteso.length !== CIFRE) return null;
    // Stesso tetto di verificaCodice: e' LA funzione fatta per prendere una finestra larga,
    // quindi quella piu' esposta a un valore fuori scala. scartoDiPasso(s, c, 200000) bloccava
    // l'event loop ~15 s. 100 passi = +/- 50 minuti, oltre ogni sfasamento d'orologio reale.
    const tetto = Math.min(Math.max(0, Math.floor(Number(maxPassi) || 0)), 100);
    const orologioMs = Number.isFinite(adessoMs) ? adessoMs : Date.now();
    const centro = passoCorrente(orologioMs);
    for (let ampiezza = 0; ampiezza <= tetto; ampiezza++) {
        for (const d of (ampiezza === 0 ? [0] : [-ampiezza, ampiezza])) {
            const passo = centro + d;
            if (passo < 0) continue;
            if (codiciUguali(codiceDaPasso(segreto, passo), atteso)) return d;
        }
    }
    return null;
}

// otpauth:// URI per il QR e per l'inserimento manuale. Etichetta ed emittente vengono
// percent-codificati: un'email con '+' o un accento, lasciata cosi', darebbe un QR sbagliato
// in silenzio (in modalita' byte la libreria QR usa latin1). L'URI risultante e' ASCII puro.
function uriOtpauth({ segreto, etichetta, emittente }) {
    const em = encodeURIComponent(emittente);
    const et = encodeURIComponent(etichetta);
    return `otpauth://totp/${em}:${et}`
        + `?secret=${segreto}`
        + `&issuer=${em}`
        + `&algorithm=SHA1&digits=${CIFRE}&period=${PASSO_SECONDI}`;
}

// --- codici di recupero -----------------------------------------------------------------

// `quanti` codici distinti, 12 caratteri Crockford base32, formattati XXXX-XXXX-XXXX.
// NESSUN rifiuto del modulo: 256 = 32 * 8, quindi `b % 32` su un byte uniforme e' GIA' uniforme
// (ogni residuo esce esattamente 8 volte su 256). Scartare i byte >= 248 lascerebbe 248 valori,
// non multiplo di 32, e INTRODURREBBE il bias che si voleva togliere: i simboli 0..23 escono 8
// volte su 248, i 24..31 sette. Errore ereditato dal piano 2FA §7, corretto (piano + qui) il
// 09/09/2026 dopo la revisione del cumulativo.
function generaCodiciRecupero(quanti = QUANTI_CODICI_RECUPERO) {
    const codici = new Set();
    let pool = Buffer.alloc(0), i = 0;
    const prossimoByte = () => {
        if (i >= pool.length) { pool = crypto.randomBytes(256); i = 0; }
        return pool[i++];
    };
    while (codici.size < quanti) {
        let grezzo = '';
        while (grezzo.length < LUNGHEZZA_CODICE_RECUPERO) {
            grezzo += ALFABETO_RECUPERO[prossimoByte() % 32];
        }
        codici.add(`${grezzo.slice(0, 4)}-${grezzo.slice(4, 8)}-${grezzo.slice(8, 12)}`);
    }
    return [...codici];
}

// Normalizza un codice digitato dall'utente: maiuscole, via spazi e trattini, e le
// sostituzioni di Crockford (I ed L valgono 1, O vale 0). NON toglie altri caratteri: se
// resta qualcosa fuori alfabeto l'impronta semplicemente non combaciera', ed e' corretto cosi'.
function normalizzaCodiceRecupero(s) {
    return String(s)
        .toUpperCase()
        .replace(/[\s-]/g, '')
        .replace(/[IL]/g, '1')
        .replace(/O/g, '0');
}

// Impronta sha256 di un codice di recupero, con l'userId in testa alla stringa: una tabella
// precalcolata non vale per due utenti diversi. UNICO punto in cui questa stringa si compone.
function improntaCodiceRecupero(userId, codice) {
    return impronta(`${userId}:${normalizzaCodiceRecupero(codice)}`);
}

module.exports = {
    PASSO_SECONDI, CIFRE, FINESTRA,
    codificaBase32, decodificaBase32, generaSegretoBase32,
    passoCorrente, codiceDaPasso, verificaCodice, scartoDiPasso, uriOtpauth,
    generaCodiciRecupero, normalizzaCodiceRecupero, improntaCodiceRecupero,
};
