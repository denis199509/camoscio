require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readDb, writeDb } = require('./db/jsonStore');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); // limite alzato per le note vocali del diario (audio base64)
app.use(express.static(path.join(__dirname, 'public')));

// Creazione della cartella per le note vocali del diario se non esiste
const uploadsPath = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath);
}

// Inizializza il DB all'avvio
readDb();

// --- REST API ENDPOINTS ---

// Login simulato (ritorna l'utente)
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    const db = readDb();
    let user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
        // Se l'utente non esiste, crealo al volo per testabilità rapida
        user = {
            id: "user_" + Date.now(),
            username: username,
            reputation: 50,
            kycVerified: false,
            completedHikes: 0,
            averagePaceUp: 350,
            averagePaceDown: 500,
            experienceLevel: "Principiante",
            avatar: "🏔️",
            trainingGoal: "",
            localExpert: null
        };
        db.users.push(user);
        writeDb(db);
    }
    res.json(user);
});

// Ottieni dettagli utente
app.get('/api/users/:id', (req, res) => {
    const db = readDb();
    const user = db.users.find(u => u.id === req.params.id);
    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ error: "Utente non trovato" });
    }
});

// Ottieni tutti gli utenti
app.get('/api/users', (req, res) => {
    const db = readDb();
    res.json(db.users);
});

// Aggiorna profilo utente (es. KYC, goal, localExpert)
app.put('/api/users/:id', (req, res) => {
    const db = readDb();
    const index = db.users.findIndex(u => u.id === req.params.id);
    if (index !== -1) {
        db.users[index] = { ...db.users[index], ...req.body };
        writeDb(db);
        res.json(db.users[index]);
    } else {
        res.status(404).json({ error: "Utente non trovato" });
    }
});

// Ottieni escursioni
app.get('/api/hikes', (req, res) => {
    const db = readDb();
    res.json(db.hikes);
});

// Crea escursione
app.post('/api/hikes', (req, res) => {
    const db = readDb();
    const newHike = {
        id: "hike_" + Date.now(),
        participants: [req.body.creatorId],
        pendingApproval: [],
        backpackTemplate: [],
        peaks: [],
        carpool: {
            fuelPrice: 1.85,
            fuelConsumption: 7.0,
            tollCost: 0,
            drivers: []
        },
        ...req.body
    };
    db.hikes.push(newHike);

    // Notifica automatica ai membri delle squadre ricorrenti del creatore (funzionalità 17b)
    const creatorSquads = db.squads.filter(s => s.creatorId === newHike.creatorId);
    creatorSquads.forEach(squad => {
        squad.members.forEach(memberId => {
            if (memberId === newHike.creatorId) return;
            db.notifications.push({
                id: "notif_" + Date.now() + "_" + memberId,
                userId: memberId,
                text: `La tua squadra "${squad.name}" ha una nuova escursione: "${newHike.title}"`,
                read: false,
                createdAt: new Date().toISOString()
            });
        });
    });

    writeDb(db);
    res.json(newHike);
});

// Aggiorna escursione (es. partecipanti, lista zaino, carpooling)
app.put('/api/hikes/:id', (req, res) => {
    const db = readDb();
    const index = db.hikes.findIndex(h => h.id === req.params.id);
    if (index !== -1) {
        db.hikes[index] = { ...db.hikes[index], ...req.body };
        writeDb(db);
        res.json(db.hikes[index]);
    } else {
        res.status(404).json({ error: "Escursione non trovata" });
    }
});

// Segna un'escursione come completata: aggiorna cronologia, passo personale e livello esperienza
app.post('/api/hikes/:id/complete', (req, res) => {
    const db = readDb();
    const hike = db.hikes.find(h => h.id === req.params.id);
    if (!hike) {
        return res.status(404).json({ error: "Escursione non trovata" });
    }

    const { userId, actualTimeHours } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ error: "Utente non trovato" });
    }
    if (!hike.participants.includes(userId)) {
        return res.status(403).json({ error: "Solo i partecipanti dell'escursione possono segnarla come completata" });
    }

    const alreadyCompleted = db.completions.some(c => c.userId === userId && c.hikeId === hike.id);
    if (alreadyCompleted) {
        return res.status(409).json({ error: "Escursione già segnata come completata", user });
    }

    db.completions.push({
        userId,
        hikeId: hike.id,
        dateCompleted: new Date().toISOString(),
        actualTimeHours: actualTimeHours ? Number(actualTimeHours) : null
    });

    // Aggiorna il passo personale (media incrementale) solo se è stato dichiarato un tempo reale
    if (actualTimeHours && Number(actualTimeHours) > 0) {
        const priorSamples = user.completedHikes || 0;
        const observedPaceUp = hike.elevationGain / Number(actualTimeHours);

        const newPaceUp = ((user.averagePaceUp * priorSamples) + observedPaceUp) / (priorSamples + 1);
        const paceRatio = newPaceUp / user.averagePaceUp;

        user.averagePaceUp = Math.round(newPaceUp);
        user.averagePaceDown = Math.round(user.averagePaceDown * paceRatio);
    }

    user.completedHikes = (user.completedHikes || 0) + 1;

    // Ricalcola il livello di esperienza dalla cronologia reale, mai autodichiarato
    if (user.completedHikes >= 10 || user.averagePaceUp >= 500) {
        user.experienceLevel = "Esperto";
    } else if (user.completedHikes >= 4 || user.averagePaceUp >= 350) {
        user.experienceLevel = "Intermedio";
    } else {
        user.experienceLevel = "Principiante";
    }

    writeDb(db);
    res.json(user);
});

// Ottieni report di crowdsourcing (Waze)
app.get('/api/reports', (req, res) => {
    const db = readDb();
    res.json(db.reports);
});

// Crea report di crowdsourcing (Waze)
app.post('/api/reports', (req, res) => {
    const db = readDb();
    const newReport = {
        id: "rep_" + Date.now(),
        createdAt: new Date().toISOString(),
        status: "active",
        ...req.body
    };
    db.reports.push(newReport);
    writeDb(db);
    res.json(newReport);
});

// Ottieni diari
app.get('/api/diaries', (req, res) => {
    const db = readDb();
    res.json(db.diaries);
});

// Crea nota diario
app.post('/api/diaries', (req, res) => {
    const db = readDb();
    const newDiary = {
        id: "diary_" + Date.now(),
        timestamp: new Date().toISOString(),
        ...req.body
    };
    db.diaries.push(newDiary);
    writeDb(db);
    res.json(newDiary);
});

// Carica una nota vocale del diario (base64 in JSON, nessuna dipendenza aggiuntiva)
app.post('/api/uploads/audio', (req, res) => {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
        return res.status(400).json({ error: "Nessun audio ricevuto" });
    }

    const extension = mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
    const fileName = `voicenote_${Date.now()}.${extension}`;
    const filePath = path.join(uploadsPath, fileName);

    try {
        fs.writeFileSync(filePath, Buffer.from(audioBase64, 'base64'));
        res.json({ url: `/uploads/${fileName}` });
    } catch (e) {
        console.error("Errore nel salvataggio della nota vocale:", e);
        res.status(500).json({ error: "Impossibile salvare la nota vocale" });
    }
});

// Ottieni timbri di un utente
app.get('/api/stamps/:userId', (req, res) => {
    const db = readDb();
    const userStamps = db.stamps.filter(s => s.userId === req.params.userId);
    res.json(userStamps);
});

// Aggiungi timbro (sbloccato con geofencing)
app.post('/api/stamps', (req, res) => {
    const { userId, stampId } = req.body;
    const db = readDb();

    // Verifica se già esistente
    const alreadyExists = db.stamps.some(s => s.userId === userId && s.stampId === stampId);
    if (!alreadyExists) {
        db.stamps.push({
            userId,
            stampId,
            dateUnlocked: new Date().toISOString().split('T')[0]
        });
        writeDb(db);
    }
    res.json({ success: true });
});

// Ottieni le escursioni già segnate come completate da un utente
app.get('/api/completions/:userId', (req, res) => {
    const db = readDb();
    const userCompletions = db.completions.filter(c => c.userId === req.params.userId);
    res.json(userCompletions);
});

// Ottieni le notifiche di un utente (più recenti prima)
app.get('/api/notifications/:userId', (req, res) => {
    const db = readDb();
    const userNotifications = db.notifications
        .filter(n => n.userId === req.params.userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(userNotifications);
});

// Crea una notifica (usato lato client per gli esiti di approvazione/rifiuto iscrizione)
app.post('/api/notifications', (req, res) => {
    const db = readDb();
    const newNotification = {
        id: "notif_" + Date.now(),
        read: false,
        createdAt: new Date().toISOString(),
        ...req.body
    };
    db.notifications.push(newNotification);
    writeDb(db);
    res.json(newNotification);
});

// Segna una notifica come letta
app.put('/api/notifications/:id/read', (req, res) => {
    const db = readDb();
    const notification = db.notifications.find(n => n.id === req.params.id);
    if (!notification) {
        return res.status(404).json({ error: "Notifica non trovata" });
    }
    notification.read = true;
    writeDb(db);
    res.json(notification);
});

// Ottieni recensioni aggregate per un utente
app.get('/api/reviews/:userId', (req, res) => {
    const db = readDb();
    const userReviews = db.reviews.filter(r => r.targetUserId === req.params.userId);
    res.json(userReviews);
});

// Inserisci recensione (Rigorosamente anonima!)
app.post('/api/reviews', (req, res) => {
    const db = readDb();
    const { targetUserId, punctuality, equipment, respect, comment, reviewerId, hikeId } = req.body;

    // Anti-spam: un hash one-way (mai reviewerId in chiaro) impedisce a chi ha già recensito
    // questa persona per questa escursione di rifarlo. Se reviewerId/hikeId non vengono forniti
    // (client più vecchio) la recensione procede comunque, semplicemente senza protezione anti-duplicati.
    let lockHash = null;
    if (reviewerId && hikeId) {
        lockHash = crypto.createHash('sha256').update(`${reviewerId}|${targetUserId}|${hikeId}`).digest('hex');
        if (db._reviewLocks.includes(lockHash)) {
            return res.status(409).json({ error: "Hai già recensito questa persona per questa escursione." });
        }
    }

    const newReview = {
        id: "rev_" + Date.now(),
        targetUserId,
        punctuality: Number(punctuality),
        equipment: Number(equipment),
        respect: Number(respect),
        comment: comment || ""
    };

    db.reviews.push(newReview);
    if (lockHash) {
        db._reviewLocks.push(lockHash);
    }

    // Aggiorna reputazione dell'utente recensito in base al feedback e all'esperienza
    const userIndex = db.users.findIndex(u => u.id === targetUserId);
    if (userIndex !== -1) {
        const user = db.users[userIndex];
        const allTargetReviews = db.reviews.filter(r => r.targetUserId === targetUserId);
        const avgScore = allTargetReviews.reduce((sum, r) => sum + (r.punctuality + r.equipment + r.respect) / 3, 0) / allTargetReviews.length;

        // La reputazione è una formula dinamica basata sul rating medio e sul numero di escursioni completate
        user.reputation = Math.min(100, Math.max(10, Math.round((avgScore / 5) * 80 + (user.completedHikes * 1.5))));
        db.users[userIndex] = user;
    }

    writeDb(db);
    res.json({ success: true });
});

// Ottieni squadre ricorrenti
app.get('/api/squads', (req, res) => {
    const db = readDb();
    res.json(db.squads);
});

// Crea squadra
app.post('/api/squads', (req, res) => {
    const db = readDb();
    const newSquad = {
        id: "squad_" + Date.now(),
        ...req.body
    };
    db.squads.push(newSquad);
    writeDb(db);
    res.json(newSquad);
});

// Ottieni preferiti / rotte desiderate
app.get('/api/bookmarks', (req, res) => {
    const db = readDb();
    res.json(db.routeBookmarks);
});

// Aggiungi preferito sentiero
app.post('/api/bookmarks', (req, res) => {
    const db = readDb();
    const { userId, hikeId } = req.body;
    const exists = db.routeBookmarks.some(b => b.userId === userId && b.hikeId === hikeId);
    if (!exists) {
        db.routeBookmarks.push({ userId, hikeId });
        writeDb(db);
    }
    res.json({ success: true });
});

// --- SERVER HTTP & WEBSOCKET SETUP ---

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Gestione dei messaggi WebSocket per il mesh networking locale
wss.on('connection', (ws) => {
    console.log("Nuova sessione client connessa al Mesh Network Simulator.");

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            console.log("Ricevuto pacchetto mesh:", parsed);

            // Broadcast a tutti i client connessi eccetto il mittente
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(parsed));
                }
            });
        } catch (e) {
            console.error("Errore decodifica messaggio WS:", e);
        }
    });
});

server.listen(port, () => {
    console.log(`===================================================`);
    console.log(` Camoscio Hiking Web App in esecuzione!`);
    console.log(` Portale locale: http://localhost:${port}`);
    console.log(`===================================================`);
});
