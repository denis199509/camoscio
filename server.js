require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { connectMongo } = require('./db/mongo');

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

const app = express();
const port = process.env.PORT || 3000;

// Render (e la maggior parte dei servizi di hosting) termina l'HTTPS su un proxy
// davanti all'app e le inoltra le richieste in HTTP semplice: senza questa riga
// Express non capisce che la connessione originale era sicura, e il cookie di
// sessione con secure:true (sotto) non verrebbe mai impostato correttamente,
// impedendo qualunque login di funzionare una volta online.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' })); // limite alzato per le note vocali del diario e le foto profilo (base64)

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // richiede HTTPS: vero solo su Render, mai in locale
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Pagina dedicata ai 4 account demo storici (Fase C): accesso senza password,
// chiaramente separata dagli account veri.
app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
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

// Carica una nota vocale del diario (base64 in JSON, nessuna dipendenza aggiuntiva).
// Salva su disco, non nel database: resta qui perche' non riguarda MongoDB.
app.post('/api/uploads/audio', (req, res) => {
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
const wss = new WebSocket.Server({ server });

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
    })
    .catch((err) => {
        console.error('Impossibile connettersi a MongoDB Atlas, il server non parte:', err.message);
        process.exit(1);
    });
