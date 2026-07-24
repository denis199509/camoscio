// Fase F - Piccolo strato comune sopra IndexedDB (nessuna libreria: l'API nativa del
// browser basta per i due usi che servono: 1) mettere in coda i punti GPS non ancora
// inviati al server quando manca campo, 2) conservare le tile della mappa scaricate
// per l'uso offline. Un solo database condiviso, aperto una sola volta.

const CAMOSCIO_DB_NAME = 'camoscio-tracking';
const CAMOSCIO_DB_VERSION = 1;

let dbOpenPromise = null;

function openCamoscioDB() {
    if (dbOpenPromise) return dbOpenPromise;

    dbOpenPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB non disponibile su questo browser'));
            return;
        }

        const request = indexedDB.open(CAMOSCIO_DB_NAME, CAMOSCIO_DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('pendingPoints')) {
                const store = db.createObjectStore('pendingPoints', { keyPath: 'localId', autoIncrement: true });
                store.createIndex('sessionId', 'sessionId', { unique: false });
            }

            if (!db.objectStoreNames.contains('tiles')) {
                db.createObjectStore('tiles', { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => reject(request.error);
    });

    return dbOpenPromise;
}

// --- Coda punti GPS in attesa di invio ---

async function idbQueuePoints(sessionId, points) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingPoints', 'readwrite');
        const store = tx.objectStore('pendingPoints');
        points.forEach(point => store.add({ sessionId, point }));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGetQueuedPoints(sessionId) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingPoints', 'readonly');
        const index = tx.objectStore('pendingPoints').index('sessionId');
        const request = index.getAll(IDBKeyRange.only(sessionId));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function idbDeleteQueuedPoints(localIds) {
    if (localIds.length === 0) return;
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingPoints', 'readwrite');
        const store = tx.objectStore('pendingPoints');
        localIds.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Cache tile mappa offline ---

async function idbGetTile(key) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const request = tx.objectStore('tiles').get(key);
        request.onsuccess = () => resolve(request.result ? request.result.blob : null);
        request.onerror = () => reject(request.error);
    });
}

async function idbPutTile(key, blob) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').put({ key, blob, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbCountTiles() {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const request = tx.objectStore('tiles').count();
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => reject(request.error);
    });
}

window.openCamoscioDB = openCamoscioDB;
window.idbQueuePoints = idbQueuePoints;
window.idbGetQueuedPoints = idbGetQueuedPoints;
window.idbDeleteQueuedPoints = idbDeleteQueuedPoints;
window.idbGetTile = idbGetTile;
window.idbPutTile = idbPutTile;
window.idbCountTiles = idbCountTiles;
