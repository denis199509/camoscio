require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { sessionStore } = require('./db/sessionStore');
const { connectMongo } = require('./db/mongo');
const { loadTrailIndex } = require('./lib/trailIndex');
const { requireAuth } = require('./middleware/auth');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const hikesRouter = require('./routes/hikes');
const reportsRouter = require('./routes/reports');
const diariesRouter = require('./routes/diaries');
const stampsRouter = require('./routes/stamps');
const completionsRouter = require('./routes/completions');
const notificationsRouter = require('./routes/notifications');
const reviewsRouter = require('./routes/reviews');
const squadsRouter = require('./routes/squads');
const bookmarksRouter = require('./routes/bookmarks');
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

app.use(express.json({ limit: '10mb' })); // limite alzato per le note vocali del diario e le foto profilo (base64)

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

// Creazione della cartella per le note vocali del diario se non esiste
const uploadsPath = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath);
}

// --- REST API ENDPOINTS ---

app.use('/api/auth', authRouter);

// /api/login e /api/users* (vedi routes/users.js sul perche' sono nello stesso router)
app.use('/api', usersRouter);

app.use('/api/hikes', hikesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/diaries', diariesRouter);
app.use('/api/stamps', stampsRouter);
app.use('/api/completions', completionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/squads', squadsRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/regions', regionsRouter);
app.use('/api/geocoding', geocodingRouter);
app.use('/api/routing', routingRouter);
app.use('/api/safety', safetyRouter);

// Carica una nota vocale del diario (base64 in JSON, nessuna dipendenza aggiuntiva).
// Salva su disco, non nel database: resta qui perche' non riguarda MongoDB. requireAuth
// aggiunto in Fase H (caccia ai bug generale): mancava del tutto, chiunque - anche senza
// account - poteva scrivere file arbitrari sul disco del server senza limite di quantita'.
app.post('/api/uploads/audio', requireAuth, (req, res) => {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
        return res.status(400).json({ error: 'Nessun audio ricevuto' });
    }

    const extension = mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
    const fileName = `voicenote_${Date.now()}.${extension}`;
    const filePath = path.join(uploadsPath, fileName);

    try {
        fs.writeFileSync(filePath, Buffer.from(audioBase64, 'base64'));
        res.json({ url: `/uploads/${fileName}` });
    } catch (e) {
        console.error('Errore nel salvataggio della nota vocale:', e);
        res.status(500).json({ error: 'Impossibile salvare la nota vocale' });
    }
});

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
wss.on('connection', (ws) => {
    console.log('Nuova sessione client connessa al Mesh Network Simulator.');

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            console.log('Ricevuto pacchetto mesh:', parsed);

            // Broadcast a tutti i client connessi eccetto il mittente
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(parsed));
                }
            });
        } catch (e) {
            console.error('Errore decodifica messaggio WS:', e);
        }
    });
});

connectMongo()
    .then(() => {
        server.listen(port, () => {
            console.log(`===================================================`);
            console.log(` Camoscio Hiking Web App in esecuzione!`);
            console.log(` Portale locale: http://localhost:${port}`);
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
