const fs = require('fs');
const path = require('path');

const initialData = require('../scripts/seed-data.json');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Funzione helper per leggere il DB
function readDb() {
    try {
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf-8');
            return initialData;
        }
        const data = fs.readFileSync(dbPath, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Errore durante la lettura del DB:", e);
        return initialData;
    }
}

// Funzione helper per scrivere sul DB
function writeDb(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error("Errore durante la scrittura del DB:", e);
    }
}

module.exports = { readDb, writeDb, dbPath };
