// Fase F - Piccolo strato comune sopra IndexedDB (nessuna libreria: l'API nativa del
// browser basta per i due usi che servono: 1) mettere in coda i punti GPS non ancora
// inviati al server quando manca campo, 2) conservare le tile della mappa scaricate
// per l'uso offline. Un solo database condiviso, aperto una sola volta.

const CAMOSCIO_DB_NAME = 'camoscio-tracking';
// v2 (MEDIO, verifica generale blocco 3, 15/09): aggiunto l'indice ambientAt sulle tile,
// serve alla pulizia automatica della cache (vedi idbEnforceAmbientTileCap). Il campo sta
// SOLO sulle tile "per caso", mai su quelle scaricate apposta (vedi idbPutTile) - cosi'
// quelle scaricate apposta non compaiono proprio nell'indice, non solo vengono scartate a
// runtime: la pulizia non le legge nemmeno.
const CAMOSCIO_DB_VERSION = 2;

let dbOpenPromise = null;

function openCamoscioDB() {
    if (dbOpenPromise) return dbOpenPromise;

    // Riferimento a QUESTA promise (non al campo di modulo, che un tentativo successivo
    // puo' gia' aver sostituito quando i callback qui sotto scattano) - serve a non far
    // sabotare da una connessione ormai orfana lo stato di un tentativo piu' recente.
    const promiseCorrente = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB non disponibile su questo browser'));
            return;
        }

        const request = indexedDB.open(CAMOSCIO_DB_NAME, CAMOSCIO_DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const upgradeTx = event.target.transaction;

            if (!db.objectStoreNames.contains('pendingPoints')) {
                const store = db.createObjectStore('pendingPoints', { keyPath: 'localId', autoIncrement: true });
                store.createIndex('sessionId', 'sessionId', { unique: false });
            }

            // Chi arriva gia' dalla v1 ha lo store 'tiles' ma non l'indice ambientAt - si
            // aggiunge qui sopra lo store esistente, non lo si ricrea (fallirebbe). Le tile
            // salvate dalla v1 non hanno ne' ambientAt ne' explicit: restano fuori
            // dall'indice (ne' cancellabili ne' contate nel tetto) finche' non vengono
            // riscritte - createTile pero' non riscrive mai una tile gia' in cache, quindi
            // quell'insieme e' chiuso e non puo' ricrescere. Scelta deliberata: e' il modo
            // piu' sicuro di trattare mappe scaricate prima di sapere se erano "per caso" o
            // apposta per un'escursione.
            const tileStore = db.objectStoreNames.contains('tiles')
                ? upgradeTx.objectStore('tiles')
                : db.createObjectStore('tiles', { keyPath: 'key' });
            if (!tileStore.indexNames.contains('ambientAt')) {
                tileStore.createIndex('ambientAt', 'ambientAt', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            // Un'altra scheda con Camoscio aperto (o l'eliminazione account, profile.js)
            // puo' chiedere di cambiare versione o svuotare il DB: senza questo, questa
            // connessione resterebbe aperta alla versione vecchia e bloccherebbe l'altra
            // richiesta invece di lasciarle spazio. Il confronto evita che una connessione
            // ormai vecchia azzeri per sbaglio il campo di un tentativo piu' recente.
            db.onversionchange = () => { db.close(); if (dbOpenPromise === promiseCorrente) dbOpenPromise = null; };
            // Chiusura anomala (dati del sito svuotati dall'utente, errore del backing
            // store): senza questo, ogni transazione successiva lancerebbe InvalidStateError
            // per il resto della sessione invece di poter riaprire una connessione nuova.
            // Non scatta su un db.close() esplicito, quindi non si accavalla col ramo sopra.
            db.onclose = () => { if (dbOpenPromise === promiseCorrente) dbOpenPromise = null; };
            resolve(db);
        };
        request.onerror = () => { if (dbOpenPromise === promiseCorrente) dbOpenPromise = null; reject(request.error); };
        // Un'altra scheda di Camoscio tiene il DB aperto alla versione precedente: senza
        // questo ramo la Promise non si risolverebbe MAI (ne' successo ne' errore) e ogni
        // chiamata IndexedDB successiva in questa scheda - compreso l'accodamento dei punti
        // GPS mentre si traccia - resterebbe in sospeso in silenzio.
        request.onblocked = () => {
            if (dbOpenPromise === promiseCorrente) dbOpenPromise = null;
            // La richiesta resta viva anche dopo il reject: se l'altra scheda si chiude
            // piu' tardi, arriverebbe comunque a onsuccess con una connessione che ormai
            // nessuno aspetta piu' - si chiude subito invece di lasciarla aperta e orfana
            // (potrebbe altrimenti bloccare in futuro il deleteDatabase di profile.js).
            request.onsuccess = (event) => { event.target.result.close(); };
            reject(new Error('Database bloccato da un\'altra scheda di Camoscio aperta'));
        };
    });

    dbOpenPromise = promiseCorrente;
    return dbOpenPromise;
}

// --- Coda punti GPS in attesa di invio ---

// MEDIO (verifica generale blocco 3) e corretto qui (15/09, 50a) insieme al resto del
// giro sulla cache tile: tx.onerror legge tx.error, che per specifica puo' essere ancora
// vuoto quando l'evento arriva alla transazione (lo valorizza il passo di abort, dopo) -
// e un abort che NON nasce da un errore di richiesta (es. un fallimento in fase di commit,
// come spesso si manifesta la quota piena su scritture consistenti) non fa scattare
// "error" per niente: senza tx.onabort la Promise non si sarebbe risolta MAI, lasciando
// tracking.js in attesa per sempre di un punto GPS che non verra' mai ne' accodato ne'
// segnalato come perso. Proprio la coda che questo lavoro doveva proteggere dalla quota
// piena non poteva dirlo quando succedeva davvero.
async function idbQueuePoints(sessionId, points) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingPoints', 'readwrite');
        const store = tx.objectStore('pendingPoints');
        points.forEach(point => {
            const req = store.add({ sessionId, point });
            req.onerror = () => reject(req.error);
        });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Accodamento punti GPS interrotto'));
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
        tx.onabort = () => reject(tx.error || new Error('Lettura punti GPS interrotta'));
    });
}

async function idbDeleteQueuedPoints(localIds) {
    if (localIds.length === 0) return;
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingPoints', 'readwrite');
        const store = tx.objectStore('pendingPoints');
        localIds.forEach(id => {
            const req = store.delete(id);
            req.onerror = () => reject(req.error);
        });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Cancellazione punti GPS interrotta'));
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

// explicit=true per le tile scaricate apposta (downloadOfflineMapForBounds): quelle non
// portano ambientAt, quindi non entrano nell'indice che la pulizia usa (vedi
// idbEnforceAmbientTileCap) - non "vengono scartate", non ci sono proprio. Le tile "per
// caso" (default) portano invece ambientAt: la data serve a tenere le piu' recenti e
// togliere le piu' vecchie una volta sopra il tetto.
//
// Nota sull'errore: si legge da REQ, non da TX - per specifica, al momento in cui
// l'evento "error" arriva alla transazione il campo tx.error puo' essere ancora vuoto (lo
// valorizza il passo di abort, che viene dopo). Un QuotaExceededError letto da tx.error a
// questo punto sarebbe quindi null, e chi chiama idbPutTile non potrebbe mai distinguerlo.
async function idbPutTile(key, blob, explicit) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        if (explicit) {
            const req = store.put({ key, blob, explicit: true });
            req.onerror = () => reject(req.error);
        } else {
            // add, non put: se durante il fetch di rete appena concluso qualcun altro ha
            // gia' scritto questa chiave come esplicita (un download apposta in corso sulla
            // stessa area che si sta guardando), la sua versione vince - un put l'avrebbe
            // silenziosamente retrocessa ad "ambient", ridiventando cancellabile.
            const req = store.add({ key, blob, ambientAt: Date.now() });
            req.onerror = (event) => {
                if (req.error && req.error.name === 'ConstraintError') { event.preventDefault(); return; }
                reject(req.error);
            };
        }
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Scrittura tile interrotta'));
    });
}

// Cerca la tile e, se c'e', la promuove a "esplicita" (protetta dalla pulizia) - IN UNA
// SOLA transazione: separare il controllo (idbGetTile) dalla promozione lascerebbe una
// finestra in cui idbEnforceAmbientTileCap puo' cancellare la tile proprio nel mezzo,
// facendo credere al download apposta di averla protetta quando invece e' sparita.
// Ritorna true se la tile c'era gia' (il chiamante non deve riscaricarla), false se va
// scaricata.
async function idbEnsureTileExplicit(key) {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        let trovata = false;
        const req = store.get(key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const rec = req.result;
            if (!rec) return; // non c'e': il chiamante la scarichera'
            trovata = true;
            if (!rec.explicit) {
                delete rec.ambientAt; // esce dall'indice: la pulizia non la vedra' piu'
                rec.explicit = true;
                store.put(rec);
            }
        };
        tx.oncomplete = () => resolve(trovata);
        tx.onabort = () => reject(tx.error || new Error('Promozione tile interrotta'));
    });
}

// MEDIO (verifica generale, blocco 3, 45a sessione) e corretto qui (15/09, 50a): la cache
// delle tile viste "per caso" (createTile in offline-map.js, non un download esplicito)
// non aveva ne' tetto ne' scadenza - poteva crescere per sempre nella stessa IndexedDB
// della coda punti GPS non ancora inviati, rischiando di far fallire quella scrittura
// (ben piu' grave) quando la quota del browser satura.
//
// L'indice ambientAt esiste SOLO sulle tile "per caso" (vedi idbPutTile): quelle
// scaricate apposta per un'escursione non ci sono proprio, quindi non vengono mai lette
// ne' tantomeno cancellate qui, indipendentemente da quanto sono vecchie - altrimenti una
// pulizia automatica potrebbe cancellare la mappa offline di un'escursione gia'
// programmata per far posto a tile viste curiosando sulla mappa.
//
// Prima un conteggio economico (index.count(), nessun record letto per intero): se non si
// e' sopra il tetto, la funzione esce senza aprire un cursore. Solo se serve, una passata
// con openKeyCursor in ordine DECRESCENTE (dalla piu' recente alla piu' vecchia, chiave e
// basta - MAI il blob dell'immagine, che qui non serve) cancella le chiavi oltre le prime
// maxAmbient incontrate.
async function idbEnforceAmbientTileCap(maxAmbient) {
    const db = await openCamoscioDB();
    const countTx = db.transaction('tiles', 'readonly');
    const totaleAmbient = await new Promise((resolve, reject) => {
        const req = countTx.objectStore('tiles').index('ambientAt').count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
        countTx.onabort = () => reject(countTx.error || new Error('Conteggio tile interrotto'));
    });
    if (totaleAmbient <= maxAmbient) return 0;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        let ambientSeen = 0;
        let deleted = 0;
        const request = store.index('ambientAt').openKeyCursor(null, 'prev');
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            ambientSeen++;
            if (ambientSeen > maxAmbient) {
                store.delete(cursor.primaryKey);
                deleted++;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        // La Promise si risolve sulla transazione, non sul cursore: cosi' un chiamante che
        // la attende sa che le cancellazioni sono davvero confermate, non solo accodate.
        tx.oncomplete = () => resolve(deleted);
        tx.onabort = () => reject(tx.error || new Error('Pulizia tile interrotta'));
    });
}

// Comando manuale "Libera spazio" (51a sessione, decisione di Denis): il tetto per
// singolo download (MAX_TILE_OFFLINE, offline-map.js) non impedisce che PIU' download
// nel tempo si sommino senza limite - le tile esplicite sono APPOSTA immuni dalla pulizia
// automatica (idbEnforceAmbientTileCap), quindi qui serve un cursore che guarda il campo
// `explicit` record per record: l'indice ambientAt esiste solo sulle tile "per caso" e non
// distingue da solo le esplicite vere dagli orfani v1 (ne' explicit ne' ambientAt, vedi
// nota di openCamoscioDB) - un conteggio per differenza (totale - ambientAt) li
// includerebbe per sbaglio, disallineando quello che si mostra da quello che poi si cancella.
async function idbInspectExplicitTiles() {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readonly');
        const request = tx.objectStore('tiles').openCursor();
        let count = 0;
        let bytes = 0;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            if (cursor.value.explicit) {
                count++;
                bytes += (cursor.value.blob && cursor.value.blob.size) || 0;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || new Error('Lettura tile esplicite interrotta'));
        tx.oncomplete = () => resolve({ count, bytes });
    });
}

async function idbClearExplicitTiles() {
    const db = await openCamoscioDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        const request = store.openCursor();
        let deleted = 0;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            if (cursor.value.explicit) {
                store.delete(cursor.primaryKey);
                deleted++;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || new Error('Cancellazione tile esplicite interrotta'));
        tx.oncomplete = () => resolve(deleted);
    });
}

window.openCamoscioDB = openCamoscioDB;
window.idbQueuePoints = idbQueuePoints;
window.idbGetQueuedPoints = idbGetQueuedPoints;
window.idbDeleteQueuedPoints = idbDeleteQueuedPoints;
window.idbGetTile = idbGetTile;
window.idbPutTile = idbPutTile;
window.idbEnsureTileExplicit = idbEnsureTileExplicit;
window.idbEnforceAmbientTileCap = idbEnforceAmbientTileCap;
window.idbInspectExplicitTiles = idbInspectExplicitTiles;
window.idbClearExplicitTiles = idbClearExplicitTiles;
