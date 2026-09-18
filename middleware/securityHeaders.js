// Header di sicurezza (CSP e affini) - piano in
// C:\Users\lenovo\.claude\plans\camoscio-csp-header-sicurezza.md (§3). Origine: blocco 3
// della verifica generale (45a sessione), "nessuna CSP ne' header di sicurezza".
//
// TAPPA 4 (questo file): la CSP va fuori in REPORT-ONLY - segnala in console, non blocca
// nessuna richiesta. Gli altri header sono gia' in piena applicazione: non hanno una
// modalita' di prova e non hanno rischi noti (tranne Permissions-Policy, riletta due volte
// per lo stesso motivo, §2.4 del piano). La tappa 5 fara' scattare l'enforcement cambiando
// SOLO la costante NOME_HEADER_CSP qui sotto.
//
// Contratto, unico e unidirezionale: ogni risposta HTTP esce con questo set fisso di
// header, deciso in un unico posto. Nessun'altra parte del progetto li legge, li modifica
// o puo' derogare. La policy si costruisce UNA VOLTA SOLA qui, al require - non per
// richiesta: zero allocazioni sul percorso caldo (vincolo RAM Render, 02-Vincoli-Hard.md §3).
// Nessun try/catch che inghiotta: se questa costruzione fallisse, il server non parte e si
// vede subito, invece di scoprirlo a meta' giornata su una richiesta qualsiasi.

const PROD = process.env.NODE_ENV === 'production';

// Origine ESPLICITA (non 'self'), non per sfiducia generica ma per un motivo preciso (D-3,
// §2.1 del piano): la chat mesh e' il canale che porta anche l'SOS, e capacitor.config.json
// ha useLegacyBridge:true - non ci si fida che 'self' copra sempre wss:// stesso host su
// ogni WebView Android. Stessa leva NODE_ENV gia' in uso per cookie.secure (server.js) e i
// rate limiter (middleware/rateLimit.js).
const ORIGINE_WS = PROD ? 'wss://camoscio.onrender.com' : `ws://localhost:${process.env.PORT || 3000}`;

// Ogni direttiva e il perche' e' nel piano (§3.2). Riassunto: script-src e' quella che porta
// il 90% del valore (nessun 'unsafe-inline', nessun 'unsafe-eval', nessun nonce/hash - tutto
// il JS e' gia' in file locali dopo le tappe 1-2). style-src tiene 'unsafe-inline' (D-2, i
// 125 attributi style="" restano per scelta). img-src ha data: per le foto base64 e blob:
// per le tile della mappa offline (§2.2 - senza, la mappa scaricata resta bianca senza un
// solo errore a schermo). connect-src copre l'unica fetch esterna (open-meteo) + il WebSocket.
const DIRETTIVE_CSP = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.opentopomap.org",
    `connect-src 'self' https://api.open-meteo.com ${ORIGINE_WS}`,
    "font-src 'self'",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'"
    // Di proposito NON presenti (§3.2/§6 del piano): report-uri/report-to (D-4, nessun
    // endpoint - si legge la console), upgrade-insecure-requests (romperebbe
    // http://localhost in sviluppo, e in produzione non resta piu' nessuna risorsa http://).
    // Di proposito NON impostati altrove in questo file, mai: Cross-Origin-Embedder-Policy
    // (rifiuterebbe le tile di opentopomap.org, che non mandano CORP) e
    // Cross-Origin-Opener-Policy (romperebbe la relazione opener<->popup della finestra di
    // stampa 2FA, tappa 3) - §2.5 del piano.
];
const CSP = DIRETTIVE_CSP.join('; ');

// LA MANIGLIA DI EMERGENZA (§3.1 del piano): tornare a Report-Only in produzione e' una
// riga qui + un deploy, non una caccia. Tappa 5: diventa 'Content-Security-Policy'.
const NOME_HEADER_CSP = 'Content-Security-Policy-Report-Only';

// geolocation=(self) e' OBBLIGATORIO (§2.4 del piano): un geolocation=() scritto per
// distrazione spegnerebbe insieme tracciamento, puntino blu, geofencing dei timbri e "meteo
// dove mi trovo" - il sintomo somiglierebbe a un permesso negato dall'utente, non a un bug.
const PERMISSIONS_POLICY = "geolocation=(self), camera=(), microphone=(), payment=(), usb=()";

function securityHeaders(req, res, next) {
    res.setHeader(NOME_HEADER_CSP, CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    if (PROD) {
        // max-age=300 (5 minuti), non di piu': D-5. Il "dominio email proprio" e' ancora in
        // sospeso (04-Da-Fare.md) - un HSTS lungo su un dominio nuovo mal configurato rende
        // il sito irraggiungibile e NON si annulla dal server. Si alza a 31536000 in una
        // sessione successiva, dopo qualche giorno tranquillo. Mai in locale: romperebbe
        // http://localhost.
        res.setHeader('Strict-Transport-Security', 'max-age=300');
    }
    next();
}

module.exports = securityHeaders;
