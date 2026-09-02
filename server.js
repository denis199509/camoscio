require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const session = require('express-session');
const { sessionStore } = require('./db/sessionStore');
const { connectMongo } = require('./db/mongo');
const { loadTrailIndex } = require('./lib/trailIndex');
// C-3 (revisione sicurezza 21a): serve al WebSocket del mesh per instradare i messaggi
// solo ai co-partecipanti del mittente, invece che a tutti i client connessi.
const Hike = require('./models/Hike');
const User = require('./models/User'); // M-1: nome mittente dei pacchetti mesh, dal DB non dal client

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const hikesRouter = require('./routes/hikes');
const reportsRouter = require('./routes/reports');
const stampsRouter = require('./routes/stamps');
const completionsRouter = require('./routes/completions');
const notificationsRouter = require('./routes/notifications');
const reviewsRouter = require('./routes/reviews');
const squadsRouter = require('./routes/squads');
const bookmarksRouter = require('./routes/bookmarks');
const followRouter = require('./routes/follow'); // punto 113: "Segui" una persona
const feedRouter = require('./routes/feed'); // punto 113: il feed delle uscite pubblicate
const trackingRouter = require('./routes/tracking');
const regionsRouter = require('./routes/regions');
const geocodingRouter = require('./routes/geocoding');
const routingRouter = require('./routes/routing'); // punto 13: progettazione percorso multi-punto
const safetyRouter = require('./routes/safety'); // punto 37: Dead Man's Switch server-side

const app = express();
const port = process.env.PORT || 3000;

// Render (e la maggior parte dei servizi di hosting) termina l'HTTPS su un proxy
// davanti all'app e le inoltra le richieste in HTTP semplice: senza questa riga
// Express non capisce che la connessione originale era sicura, e il cookie di
// sessione con secure:true (sotto) non verrebbe mai impostato correttamente,
// impedendo qualunque login di funzionare una volta online.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' })); // limite alzato per le foto profilo (base64)

// Tenuta come variabile a parte (non solo dentro app.use) perche' la riusa anche il WebSocket
// del mesh networking piu' sotto, per riconoscere chi si connette senza duplicare la logica di
// lettura/verifica del cookie di sessione.
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // creato in db/sessionStore.js: lo usa anche routes/auth.js (punto 7)
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // richiede HTTPS: vero solo su Render, mai in locale
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
    }
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// Pagina dedicata ai 4 account demo storici (Fase C): accesso senza password,
// chiaramente separata dagli account veri.
app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

// Pagina di scelta della nuova password (punto 7): ci si arriva SOLO dal link temporaneo
// mandato per email. Il file esiste sempre, ma la pagina non mostra niente finche' non ha
// chiesto al server se il token nell'indirizzo e' ancora valido - e' li' che sta la sua
// "temporaneita'", non nel file.
app.get('/reimposta-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reimposta-password.html'));
});

// Pagina di conferma dell'indirizzo email: ci si arriva dal link mandato in
// registrazione. Non richiede di essere collegati - il link puo' arrivare sul telefono
// mentre ci si era registrati dal computer.
app.get('/conferma-email', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'conferma-email.html'));
});

// --- REST API ENDPOINTS ---

// A-2 (revisione sicurezza 21a): rete di sicurezza generale su tutto /api. Larga a
// sufficienza da non toccare nessun uso umano reale; ferma solo lo script che martella.
// I limiti stretti su login/password/email stanno dentro routes/auth.js.
const { apiLimiter } = require('./middleware/rateLimit');
app.use('/api', apiLimiter);

app.use('/api/auth', authRouter);

// /api/login e /api/users* (vedi routes/users.js sul perche' sono nello stesso router)
app.use('/api', usersRouter);

app.use('/api/hikes', hikesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/stamps', stampsRouter);
app.use('/api/completions', completionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/squads', squadsRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/follow', followRouter);
app.use('/api/feed', feedRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/regions', regionsRouter);
app.use('/api/geocoding', geocodingRouter);
app.use('/api/routing', routingRouter);
app.use('/api/safety', safetyRouter);

// --- SERVER HTTP & WEBSOCKET SETUP ---

const server = http.createServer(app);
// noServer: gestiamo l'upgrade a mano sotto, per poter controllare la sessione PRIMA di
// accettare la connessione (vedi bug corretto in Fase H sotto).
const wss = new WebSocket.Server({ noServer: true });

// Bug corretto in Fase H (caccia ai bug generale): questo WebSocket non richiedeva ALCUN login,
// chiunque su internet poteva collegarsi direttamente (senza nemmeno aver mai aperto il sito) e
// trasmettere falsi messaggi/SOS a chiunque avesse la pagina Sicurezza aperta - grave in
// particolare per un canale pensato per le emergenze. Riusa lo stesso sessionMiddleware di
// Express sulla richiesta di upgrade per leggere il cookie di sessione gia' esistente, senza
// duplicarne la logica; una richiesta di upgrade senza sessione valida viene chiusa subito.
server.on('upgrade', (request, socket, head) => {
    sessionMiddleware(request, {}, () => {
        if (!request.session || !request.session.userId) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
});

// Gestione dei messaggi WebSocket per il mesh networking locale
wss.on('connection', async (ws, request) => {
    // L'upgrade qui sopra ha gia' verificato la sessione: si tiene da parte CHI e' questo
    // socket, per instradare i messaggi mesh (C-3, revisione sicurezza 21a). Dal cookie di
    // sessione, MAI da un campo mandato dal client.
    ws.camoscioUserId = (request.session && request.session.userId)
        ? String(request.session.userId) : null;
    ws.camoscioUserName = null;
    ws.meshMsgFinestra = 0;      // M-1: contatore messaggi nella finestra corrente
    ws.meshMsgFinestraDa = 0;    //      inizio finestra (ms)
    // M-1: il nome del mittente lo mette il server, quindi va letto dal DB una volta alla
    // connessione (la sessione tiene solo lo userId). Se la lettura fallisce si ripiega su
    // un nome generico - un messaggio senza nome e' meglio di nessuna chat.
    if (ws.camoscioUserId) {
        try {
            const u = await User.findById(ws.camoscioUserId).select('username');
            ws.camoscioUserName = (u && u.username) || null;
        } catch (e) { /* ripiego sul generico sotto */ }
    }
    console.log('Nuova sessione client connessa al Mesh Network.');

    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message);
            // C-3: NON stampare il pacchetto intero - contiene lat/lng reali del mittente,
            // finirebbero nei log di Render. Solo il tipo.
            console.log('Ricevuto pacchetto mesh, tipo:', parsed && parsed.type);

            const mittenteId = ws.camoscioUserId;
            if (!mittenteId) return;

            // M-1 (ri-review sicurezza, 2° giro): il WebSocket non passa da apiLimiter, e ogni
            // messaggio fa una query su Hike. Tetto grezzo: 20 messaggi ogni 10 secondi per
            // socket. Oltre, si scartano in silenzio.
            const ora = Date.now();
            if (ora - ws.meshMsgFinestraDa > 10000) { ws.meshMsgFinestraDa = ora; ws.meshMsgFinestra = 0; }
            if (++ws.meshMsgFinestra > 20) return;

            // M-1: il payload NON si inoltra verbatim - senderId/senderName li mette il server
            // dalla sessione (un co-partecipante non deve poter far comparire un "[SOS] <nome
            // di un altro>"), e lat/lng devono essere numeri finiti o il client che li disegna
            // (displayMeshMessage -> toFixed) va in errore. Si passa avanti solo un oggetto
            // ricostruito, coi soli campi previsti.
            // Un client legittimo (sendMeshChatMessage in safety.js) manda lat/lng come
            // NUMERI: si accettano solo quelli, tutto il resto (stringa, null, boolean...)
            // diventa null - il client che li disegna non deve mai chiamare .toFixed su null.
            const rawLat = parsed && parsed.lat;
            const rawLng = parsed && parsed.lng;
            const pacchetto = {
                type: 'mesh_packet',
                senderId: mittenteId,
                senderName: ws.camoscioUserName || 'Un escursionista',
                text: String((parsed && parsed.text) || '').slice(0, 1000),
                lat: (typeof rawLat === 'number' && Number.isFinite(rawLat)) ? rawLat : null,
                lng: (typeof rawLng === 'number' && Number.isFinite(rawLng)) ? rawLng : null,
                isSos: !!(parsed && parsed.isSos),
                timestamp: String((parsed && parsed.timestamp) || '').slice(0, 40)
            };
            if (!parsed || parsed.type !== 'mesh_packet' || (!pacchetto.text && !pacchetto.isSos)) return;

            // C-3: prima il pacchetto (con la posizione GPS reale dentro) andava in
            // broadcast a OGNI client connesso, e il filtro "raggio 100 m" viveva solo
            // lato client, aggirabile. Ora il server inoltra SOLO a chi condivide col
            // mittente un'escursione non ancora conclusa (come partecipante o creatore).
            // Chi e' fuori da quel gruppo non riceve nulla - il pacchetto non parte.
            const escursioni = await Hike.find(
                { groupCompletedAt: null, $or: [{ participants: mittenteId }, { creatorId: mittenteId }] },
                { participants: 1, creatorId: 1 }
            ).lean();

            const destinatari = new Set();
            for (const h of escursioni) {
                if (h.creatorId) destinatari.add(String(h.creatorId));
                for (const p of (h.participants || [])) destinatari.add(String(p));
            }
            destinatari.delete(mittenteId); // il proprio messaggio il client lo mostra gia' da se'
            if (!destinatari.size) return;

            const payload = JSON.stringify(pacchetto);
            wss.clients.forEach((client) => {
                if (client !== ws
                    && client.readyState === WebSocket.OPEN
                    && client.camoscioUserId
                    && destinatari.has(client.camoscioUserId)) {
                    client.send(payload);
                }
            });
        } catch (e) {
            console.error('Errore gestione messaggio mesh:', e);
        }
    });
});

connectMongo()
    .then(() => {
        server.listen(port, async () => {
            console.log(`===================================================`);
            console.log(` Camoscio Hiking Web App in esecuzione!`);
            console.log(` Portale locale: http://localhost:${port}`);
            // M-2 (ri-review sicurezza, 2° giro): NODE_ENV regge da solo quattro controlli
            // (cookie.secure, base URL email, fail-closed del segreto cron, i rate limiter) e
            // nessuno di questi ha un sintomo visibile se il valore e' sbagliato. Lo si stampa
            // all'avvio, e si urla se in produzione manca il segreto del cron: in quel caso
            // segretoCronValido (routes/safety.js) e' fail-closed e /api/safety/controlla-scadenze
            // risponde 403 a OGNI chiamata - il Dead Man's Switch non scatterebbe mai, in silenzio.
            const prod = process.env.NODE_ENV === 'production';
            console.log(` NODE_ENV=${process.env.NODE_ENV || '(non impostata)'} - rate limiter ${prod ? 'ATTIVI' : 'SPENTI'}, cookie secure ${prod ? 'si' : 'no'}`);
            if (prod && !process.env.SAFETY_CRON_SECRET) {
                console.error(' ATTENZIONE: SAFETY_CRON_SECRET vuota in produzione - /api/safety/controlla-scadenze risponde 403 a ogni chiamata: il Dead Man\'s Switch NON scattera\' mai. Impostare il segreto e puntarci il cron esterno.');
            }
            // Punto A-3.4: stesso ragionamento per ACCOUNT_SCRUB_SECRET (/api/users/scrub-eliminati).
            // Se manca in produzione, gli account eliminati restano "Account eliminato" a
            // tempo indeterminato e i dati personali non vengono mai cancellati - promessa
            // non mantenuta, in silenzio. Piu' una rete di sicurezza che non dipende da
            // cron-job.org: quanti account hanno gia' superato i 30 giorni senza scrub.
            if (prod && !process.env.ACCOUNT_SCRUB_SECRET) {
                console.error(' ATTENZIONE: ACCOUNT_SCRUB_SECRET vuota in produzione - /api/users/scrub-eliminati risponde 403 a ogni chiamata: i dati personali degli account eliminati NON verranno mai cancellati. Impostare il segreto e puntarci il cron esterno.');
            }
            try {
                const inRitardo = await User.countDocuments({ deletionScrubAt: { $lte: new Date() }, deletedAt: { $exists: false } });
                if (inRitardo) {
                    console.error(` ATTENZIONE: ${inRitardo} account hanno superato i 30 giorni di grazia e non sono ancora stati scrubati (il cron di /api/users/scrub-eliminati non sta girando).`);
                }
            } catch (e) {
                console.error(' Non e\' stato possibile controllare gli account in attesa di scrub:', e.message);
            }
            console.log(`===================================================`);
        });

        // Non blocca l'avvio del server: il tracciamento GPS (Fase F) funziona comunque
        // senza aggancio al sentiero (Fase G) finche' l'indice non e' pronto, si aggancia
        // semplicemente da quel momento in poi (vedi lib/trailIndex.js).
        loadTrailIndex().catch(err => console.error('Errore caricamento indice sentieri (Fase G):', err.message));
    })
    .catch((err) => {
        console.error('Impossibile connettersi a MongoDB Atlas, il server non parte:', err.message);
        process.exit(1);
    });
