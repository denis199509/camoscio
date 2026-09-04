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

// POST /api/hikes (crea escursione), complete-group, DELETE /api/users/me, GET|POST
// /api/users/scrub-eliminati: scritture (o scansioni) che nessun umano ripete decine di volte
// all'ora. Tappo al riempimento DB.
// NB (MEDIO-1, revisione sicurezza 28ª): POST /api/safety/activate NON e' piu' qui - armare
// il Dead Man's Switch ha il suo sicurezzaLimiter dedicato, cosi' la rotta del soccorso non
// puo' finire la quota per colpa di traffico che soccorso non e' (stesso motivo di
// cancellazioneLimiter e invitoLimiter).
const scritturaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// POST /api/safety/activate (armare il Dead Man's Switch): secchio DEDICATO. Terzo caso della
// stessa regola di cancellazioneLimiter e invitoLimiter, e il piu' importante: la rotta del
// soccorso non deve poter rispondere 429 per colpa di traffico che soccorso non e' - creare
// escursioni, chiuderle in gruppo, cancellare l'account, tutte su scritturaLimiter, e dietro
// un NAT (wifi di un rifugio) la quota e' condivisa fra persone diverse. 60/ora: riarmare il
// timer piu' volte durante un'uscita e' un uso normale. MEDIO-1, revisione sicurezza 28ª.
const sicurezzaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 60,
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
// al tetto di apiLimiter). Secchio SEPARATO dagli altri limiter di scrittura: un ciclo di
// inviti non deve intaccare la quota di chi crea escursioni (scritturaLimiter) ne', a maggior
// ragione, quella di chi arma il timer di sicurezza (sicurezzaLimiter) - lo stesso motivo per
// cui cancellazioneLimiter e' separato. 40/ora e' molto oltre qualunque uso in buona fede.
// M-5, revisione sicurezza 27ª.
const invitoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 40,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// DELETE /api/hikes/:id: secchio SEPARATO da scritturaLimiter di proposito. Il caso d'uso
// dichiarato e' ripulire piu' escursioni di prova di fila: se consumasse la quota di
// scritturaLimiter, creare una nuova escursione o cancellare il proprio account
// risponderebbe 429 nel mezzo della pulizia. Resta separato anche da sicurezzaLimiter (il
// secchio del Dead Man's Switch, MEDIO-1 della 28ª): una pulizia non deve poter toccare la
// quota del soccorso. Qui 20/ora, per IP: molto oltre qualunque pulizia in buona fede.
const cancellazioneLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// PUT /api/squads/:id/photo: la foto e' un data URL fino a ~800 KB (MAX_PHOTO_LENGTH in
// routes/squads.js, abbassato da 2 MB con MEDIO-3 residuo quando il client ha iniziato a
// comprimere sempre in JPEG). Senza un tetto suo, un solo IP puo' riscrivere la foto di una
// squadra a raffica e riempire i 512 MB di Atlas (vincolo hard) in poche ore. Cambiare la
// foto di una squadra e' un gesto raro: 20/ora e' larghissimo per un umano e taglia il ritmo
// di riempimento di un ordine di grandezza. MEDIO-3, revisione sicurezza 28ª. (User.profilePhoto
// ha lo stesso problema su un'altra rotta: da guardare a parte.)
const fotoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

// GET /api/squads/:id/photo (MEDIO-1b, follow-up revisione sicurezza): la risposta arriva
// fino a ~800 KB (data URL base64 del tetto MAX_PHOTO_LENGTH di routes/squads.js - foto piu'
// vecchie di MEDIO-3 residuo possono ancora pesare fino ai 2 MB di prima), e prima non aveva
// NESSUN tappo oltre l'apiLimiter generale - 3000 richieste/5min vorrebbe dire fino a diversi
// GB/ora da un solo IP, ben oltre quanto regge la banda di Render gratuito.
// Secchio dedicato e SEPARATO da fotoLimiter (che copre la scrittura, PUT /:id/photo): una
// lettura a raffica non deve poter consumare la quota di chi cambia davvero la foto della
// propria squadra, ne' viceversa. 100/ora e' largo per chi sfoglia a mano le pagine delle
// proprie squadre.
const fotoLetturaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 100,
    skip: soloInProduzione,
    standardHeaders: true,
    legacyHeaders: false,
    message: messaggioTroppiTentativi
});

module.exports = { authLimiter, emailLimiter, apiLimiter, matchLimiter, exportLimiter, scritturaLimiter, sicurezzaLimiter, cancellazioneLimiter, invitoLimiter, fotoLimiter, fotoLetturaLimiter };
