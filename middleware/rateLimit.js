// Rate limiting (A-2 della revisione sicurezza 21a). Prima non ce n'era nessuno: forza
// bruta libera su login e cambio password, e - insieme all'IDOR C-2 gia' chiuso - un modo
// per riempire i 512 MB di Atlas martellando una rotta di scrittura.
//
// server.js fa gia' `app.set('trust proxy', 1)`: dietro il proxy di Render `req.ip` e'
// l'IP vero del client, non quello del proxy, quindi il conteggio e' per-utente e non
// finisce tutto in un secchio solo. Store in memoria (default): va bene su Render free,
// che gira come istanza singola; se un giorno si scala a piu' istanze servira' uno store
// condiviso (Mongo/Redis), ed e' l'unico motivo per cui questo file esiste separato.
const { rateLimit } = require('express-rate-limit');

const messaggioTroppiTentativi = {
    error: 'Troppi tentativi da questo dispositivo. Aspetta qualche minuto e riprova.'
};

// Attivi SOLO in produzione (Render mette NODE_ENV=production - stesso criterio gia' usato
// per cookie.secure in server.js). In locale e nelle prove di prove/ sarebbero solo un
// intralcio: localhost e' un IP solo, la suite intera sballerebbe il conteggio, e non c'e'
// nessun attaccante da fermare. Per provarli in locale: NODE_ENV=production node server.js
const soloInProduzione = () => process.env.NODE_ENV !== 'production';

// Rotte di credenziali: login, registrazione, reset/cambio password, conferma email.
// skipSuccessfulRequests: un accesso andato a buon fine NON consuma quota - a pagare il
// conto e' solo chi sbaglia, cioe' esattamente il profilo di un attacco a forza bruta.
// 20 fallimenti in un quarto d'ora: un umano che ha dimenticato la password sta sotto,
// uno script no.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// Rotte che MANDANO UN'EMAIL a un indirizzo scelto da chi chiama (recupero password,
// re-invio conferma): l'abuso qui e' bombardare la casella di qualcun altro, quindi si
// contano tutte le richieste (anche quelle "riuscite") su una finestra piu' lunga.
const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// Rete di sicurezza generale su /api. Volutamente MOLTO larga: una sessione attiva
// (mappa + tracciamento + notifiche) fa forse 30-40 richieste al minuto, e piu'
// escursionisti dietro lo stesso wifi di un trailhead contano come un IP solo (NAT) -
// quindi il tetto deve stare largo di un ordine di grandezza. A 3000 in 5 minuti ci
// arrivi solo con uno script: e' quello il caso "riempimento DB" della revisione. La
// vera protezione sulle credenziali e' authLimiter/emailLimiter qui sopra.
const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 3000,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// --- Limiter mirati chiesti dalla ri-review sicurezza (secondo giro) ---

// GET /api/hikes/:id/home-match: anche restituendo solo il CONTEGGIO (niente nomi), una
// chiamata a raffica resta un modo per campionare. 30/ora e' molto piu' di qualunque uso
// reale (si guarda quando si apre il tab Carpooling).
const matchLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// GET /api/users/me/export: rotta costosa (assembla ~15 collezioni, serializza tutto in una
// stringa). 3 al giorno bastano e avanzano per un export dati, e chiudono il vettore DoS di
// memoria su Render 512 MB.
const exportLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 3,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// POST /api/hikes (crea escursione) e POST /api/safety/activate (arma il Dead Man's Switch):
// scritture che nessun umano ripete decine di volte all'ora. Tappo al riempimento DB e
// all'uso del DMS come relay email.
const scritturaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// POST /api/hikes/:id/invite-squad, POST /api/squads e POST /api/squads/:id/invite (+ il suo
// annullamento): ogni chiamata puo' generare un LOTTO di notifiche (fino a 50). Il progetto
// si difende con tetto + idempotenza invece che con un limiter, e su una singola
// squadra/escursione regge; NON regge sul ciclo invita -> DELETE /:id/invites -> invita, che
// rimette i destinatari fra gli invitabili (100 notifiche ogni 52 richieste, ripetibile fino
// al tetto di apiLimiter). Secchio SEPARATO da scritturaLimiter, che e' condiviso con
// POST /api/safety/activate (armare il Dead Man's Switch): esaurirlo con gli inviti farebbe
// rispondere 429 al timer di sicurezza - lo stesso motivo per cui cancellazioneLimiter e'
// separato. 40/ora e' molto oltre qualunque uso in buona fede. M-5, revisione sicurezza 27ª.
const invitoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 40,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// DELETE /api/hikes/:id: secchio SEPARATO da scritturaLimiter di proposito. Quella rotta la
// condivide con POST /api/safety/activate (armare il Dead Man's Switch): se la cancellazione
// - il cui caso d'uso dichiarato e' ripulire piu' escursioni di prova di fila - esaurisse
// quel secchio, armare il timer di sicurezza risponderebbe 429. Qui 20/ora, per IP: molto
// oltre qualunque pulizia in buona fede, e non intacca il secchio del soccorso.
const cancellazioneLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

module.exports = { authLimiter, emailLimiter, apiLimiter, matchLimiter, exportLimiter, scritturaLimiter, cancellazioneLimiter, invitoLimiter };
