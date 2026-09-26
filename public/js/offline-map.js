// Fase F - Mappa offline: cache delle tile della mappa (oggi OpenTopoMap, vedi
// CAMOSCIO_TILE_URL in map.js) in IndexedDB (vedi idb.js) + un layer Leaflet che le usa
// al posto di riscaricarle sempre dalla rete. Nessuna libreria nuova: si sovrascrive
// semplicemente createTile, stessa tecnica dei plugin "leaflet offline" piu' diffusi.
//
// Comportamento: OGNI tile vista dal vivo (online) viene salvata in cache automaticamente,
// non solo quelle scaricate in anticipo col pulsante dedicato - cosi' qualunque zona gia'
// vista resta disponibile anche se il segnale sparisce durante l'escursione.

const OFFLINE_MIN_ZOOM = 12;
const OFFLINE_MAX_ZOOM = 16;
const TILE_DOWNLOAD_CONCURRENCY = 6;
// ALTO (verifica generale, blocco 3, 45a sessione) e corretto qui (46a): il ramo di
// ripiego (nessuna escursione selezionata, public/js/tracking.js) usava l'intero
// riquadro visibile della mappa come area da scaricare - misurato 145.650 tile/~4,5GB a
// zoom 9 da telefono, 837.854/~26GB a zoom 7 da desktop, verso un servizio gratuito la
// cui policy vieta il bulk download. Un'area di escursione vera (getHikeBounds), anche
// generosa (un traverso di piu' giorni su ~20km), resta sotto i 3.000 tile: 6.000 (~190MB)
// lascia ampio margine per un uso vero e blocca comunque di netto il caso di abuso.
const MAX_TILE_OFFLINE = 6000;

// MEDIO (verifica generale, blocco 3, 45a sessione), deciso con Denis il 15/09: tetto
// SEPARATO da MAX_TILE_OFFLINE sopra, e apposta piu' basso - questo vale solo per le tile
// viste "per caso" navigando la mappa (createTile qui sotto), mai per quelle scaricate
// apposta (downloadOfflineMapForBounds, protette in idb.js tramite explicit:true). E'
// comodita', non necessita' come un download esplicito prima di un'escursione, quindi ha
// senso tenerla piu' stretta.
const MAX_AMBIENT_TILES = 4000;
// Ricontrolla il tetto ogni tot tile "per caso" salvate, non ad ogni singola - altrimenti
// una volta raggiunto il tetto ogni tile vista scorrendo la mappa pagherebbe il costo di
// una scansione della cache. idbEnforceAmbientTileCap conta prima di scandire, quindi il
// costo di un controllo che non trova nulla da fare resta comunque basso.
const AMBIENT_CLEANUP_EVERY = 100;
let ambientPutsSinceCleanup = 0;
let ambientCleanupInFlight = false;
// Il contatore sopra vive solo in memoria e riparte da zero a ogni caricamento pagina: una
// sessione breve (apri l'app, guarda la mappa, chiudi - o la scheda scaricata dal sistema
// durante un'escursione) potrebbe non arrivare mai a 100. Questo flag forza UN controllo
// anche alla prima tile "per caso" salvata in ogni sessione, oltre a quello ogni 100.
let primoControlloAmbientFatto = false;

function forzaPuliziaTileAmbient() {
    // Non accodare scansioni: se una e' gia' in corso, quella in arrivo aspettera' il
    // prossimo giro (il contatore NON si azzera qui sotto) invece di far serializzare piu'
    // transazioni readwrite sullo stesso store, che ritarderebbe anche il disegno delle tile.
    if (ambientCleanupInFlight) return;
    ambientCleanupInFlight = true;
    ambientPutsSinceCleanup = 0;
    idbEnforceAmbientTileCap(MAX_AMBIENT_TILES)
        .catch(() => {})
        .finally(() => { ambientCleanupInFlight = false; });
}

function maybeCleanupAmbientTiles() {
    ambientPutsSinceCleanup++;
    if (!primoControlloAmbientFatto) {
        primoControlloAmbientFatto = true;
        forzaPuliziaTileAmbient();
        return;
    }
    if (ambientPutsSinceCleanup < AMBIENT_CLEANUP_EVERY) return;
    forzaPuliziaTileAmbient();
}

function lon2tileX(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tileY(lat, zoom) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom));
}

// Punto 39: la chiave include lo STILE (osm/opentopo/...), non solo z/x/y - altrimenti,
// con due mappe attive nella storia del progetto, la stessa coordinata scaricata da uno
// stile servirebbe (sbagliata) al posto dell'altro. Le tile gia' in cache con la vecchia
// chiave a 3 pezzi restano semplicemente orfane, mai piu' cercate: nessuna migrazione,
// e' un costo accettato (vedi cose_da_fare.txt punto 39).
function tileKey(z, x, y, styleId) {
    return `${styleId}/${z}/${x}/${y}`;
}

function setTileImgFromBlob(tile, blob) {
    const objectUrl = URL.createObjectURL(blob);
    tile.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
    tile.src = objectUrl;
}

const OfflineAwareTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        const url = this.getTileUrl(coords);
        const key = tileKey(coords.z, coords.x, coords.y, this.options.styleId);

        idbGetTile(key).then(cachedBlob => {
            if (cachedBlob) {
                setTileImgFromBlob(tile, cachedBlob);
                done(null, tile);
                return;
            }

            // Un solo fetch di rete per tile: la stessa risposta serve sia per mostrarla
            // subito sia per salvarla in cache, invece di scaricarla due volte.
            fetch(url).then(response => {
                if (!response.ok) throw new Error('Tile non disponibile: ' + url);
                return response.blob();
            }).then(blob => {
                idbPutTile(key, blob).catch(err => {
                    // Quota del browser piena: e' anche il momento in cui la coda dei punti
                    // GPS rischia di non riuscire piu' a scrivere - non si aspetta il
                    // contatore, si pulisce subito.
                    if (err && err.name === 'QuotaExceededError') forzaPuliziaTileAmbient();
                });
                maybeCleanupAmbientTiles();
                setTileImgFromBlob(tile, blob);
                done(null, tile);
            }).catch(err => {
                done(err, tile);
            });
        }).catch(() => {
            // IndexedDB non disponibile per qualche motivo: la mappa resta comunque
            // utilizzabile online, solo senza cache offline.
            tile.src = url;
            done(null, tile);
        });

        return tile;
    }
});

function createOfflineTileLayer(urlTemplate, options) {
    return new OfflineAwareTileLayer(urlTemplate, options);
}

// Area rettangolare intorno a un'escursione (trailhead + vette) con un margine, usata
// per il download offline mirato. Senza vette registrate, margine piu' ampio sul solo trailhead.
function getHikeBounds(hike) {
    const lats = [hike.trailhead.lat];
    const lngs = [hike.trailhead.lng];
    (hike.peaks || []).forEach(p => { lats.push(p.lat); lngs.push(p.lng); });

    const pad = (hike.peaks && hike.peaks.length > 0) ? 0.03 : 0.05;
    return L.latLngBounds(
        [Math.min(...lats) - pad, Math.min(...lngs) - pad],
        [Math.max(...lats) + pad, Math.max(...lngs) + pad]
    );
}

// Il rettangolo di tile (x/y min/max) coperto da bounds a UN livello di zoom - unica fonte
// per la lista vera (listTilesForBounds) e per il conteggio veloce (countTilesForBounds):
// due formule separate per la stessa cosa divergerebbero prima o poi in silenzio (lezione
// gia' pagata piu' volte in questo progetto, vedi 07-Trappole-Tecniche).
function tileRangeAtZoom(bounds, z) {
    return {
        xMin: lon2tileX(bounds.getWest(), z),
        xMax: lon2tileX(bounds.getEast(), z),
        // Y cresce verso Sud nello schema delle tile: la latitudine massima da' la Y minima
        yMin: lat2tileY(bounds.getNorth(), z),
        yMax: lat2tileY(bounds.getSouth(), z)
    };
}

// ALTO (verifica generale, blocco 3, 45a sessione) e corretto qui (46a): la sola
// aritmetica del rettangolo (nessun array), cosi' stimare la dimensione di un download
// enorme non costringe a materializzarne prima la lista intera solo per contarla (misurato
// 10-54MB di heap sul caso peggiore - la settima occorrenza di questo stesso pattern nel
// progetto).
function countTilesForBounds(bounds, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM) {
    let totale = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
        const { xMin, xMax, yMin, yMax } = tileRangeAtZoom(bounds, z);
        totale += (xMax - xMin + 1) * (yMax - yMin + 1);
    }
    return totale;
}

function listTilesForBounds(bounds, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM) {
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
        const { xMin, xMax, yMin, yMax } = tileRangeAtZoom(bounds, z);
        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                tiles.push({ z, x, y });
            }
        }
    }
    return tiles;
}

function estimateOfflineDownloadSize(bounds) {
    const count = countTilesForBounds(bounds);
    // Punto 39: 32 KB/tile, misurato il 2026-07-29 su OpenTopoMap (Campo Imperatore,
    // 15/17618/12109) - era 20 (stima per OSM standard, piu' leggero ma quasi vuoto
    // in montagna). Il numero che conta e' quello vero della mappa che si scarica
    // davvero, non una stima prudente scollegata dallo stile attivo.
    const estimatedKb = count * 32;
    return {
        tileCount: count,
        estimatedMb: Math.round((estimatedKb / 1024) * 10) / 10,
        troppoGrande: count > MAX_TILE_OFFLINE
    };
}

// Scarica in anticipo (mentre c'e' ancora connessione) tutte le tile di un'area, con un
// numero limitato di richieste in parallelo (non di piu' di quante il browser stesso ne
// aprirebbe scorrendo la mappa a mano).
async function downloadOfflineMapForBounds(bounds, onProgress) {
    const tileLayer = window.CamoscioTileLayer;
    if (!tileLayer) throw new Error('Layer della mappa non ancora inizializzato');

    // ALTO (verifica generale, blocco 3, 45a sessione) e corretto qui (46a): ricontrollato
    // qui, non solo dove si mostra la stima al chiamante - questa funzione e' l'unica che
    // scarica per davvero, e non deve fidarsi che chi la chiama abbia gia' controllato.
    // Il conteggio veloce (nessun array) evita di materializzare la lista intera prima di
    // scoprire che va comunque rifiutata.
    if (countTilesForBounds(bounds) > MAX_TILE_OFFLINE) {
        throw new Error(`Area troppo grande per il download offline (oltre ${MAX_TILE_OFFLINE} porzioni di mappa): scegli un'escursione specifica o un'area piu' piccola.`);
    }

    const tiles = listTilesForBounds(bounds);
    let completed = 0;
    let failed = 0;
    // BASSO-2 (revisione 51a, chiuso nella 59a): quota del browser piena. Prima finiva nel
    // catch generico come una tile "non riuscita": il download continuava a chiedere a
    // OpenTopoMap centinaia di tile che non poteva piu' salvare e chiudeva con il toast verde
    // "Mappa offline pronta: 120/800". Ora alla prima quota piena si ferma - e' anche lo
    // spazio che serve alla coda dei punti GPS, non va consumato fino all'ultimo byte - e il
    // chiamante lo dice all'utente, indicando "Libera spazio".
    let spazioEsaurito = false;

    async function downloadOne(coords) {
        const key = tileKey(coords.z, coords.x, coords.y, tileLayer.options.styleId);
        // Controllo e promozione IN UNA SOLA operazione (idb.js): separarli lascerebbe una
        // finestra in cui una pulizia della cache puo' cancellare la tile fra il "c'e' gia'"
        // e la promozione a esplicita - il download la darebbe per protetta senza esserlo,
        // e "Mappa offline pronta: N/N tile" direbbe il falso.
        let giaProtetta = false;
        try {
            giaProtetta = await idbEnsureTileExplicit(key);
        } catch (e) {
            giaProtetta = false; // errore nel controllo: si tenta comunque il download
        }
        if (!giaProtetta) {
            const url = tileLayer.getTileUrl(coords);
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error('Tile non disponibile');
                const blob = await response.blob();
                await idbPutTile(key, blob, true); // explicit: protetta dalla pulizia automatica
            } catch (e) {
                if (e && e.name === 'QuotaExceededError') spazioEsaurito = true;
                failed++;
            }
        }
        completed++;
        if (onProgress) onProgress(completed, tiles.length, failed);
    }

    let cursor = 0;
    async function worker() {
        while (cursor < tiles.length && !spazioEsaurito) {
            await downloadOne(tiles[cursor++]);
        }
    }

    await Promise.all(Array.from({ length: TILE_DOWNLOAD_CONCURRENCY }, worker));
    // salvate = quelle davvero sul dispositivo: con spazioEsaurito il giro si ferma prima
    // della fine, quindi total - failed conterebbe anche le tile mai tentate.
    return { total: tiles.length, failed, salvate: completed - failed, spazioEsaurito };
}

window.createOfflineTileLayer = createOfflineTileLayer;
window.getHikeBounds = getHikeBounds;
window.estimateOfflineDownloadSize = estimateOfflineDownloadSize;
window.downloadOfflineMapForBounds = downloadOfflineMapForBounds;
