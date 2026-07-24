// Fase F - Mappa offline: cache delle tile OpenStreetMap in IndexedDB (vedi idb.js) + un
// layer Leaflet che le usa al posto di riscaricarle sempre dalla rete. Nessuna libreria
// nuova: si sovrascrive semplicemente createTile, stessa tecnica dei plugin "leaflet
// offline" piu' diffusi.
//
// Comportamento: OGNI tile vista dal vivo (online) viene salvata in cache automaticamente,
// non solo quelle scaricate in anticipo col pulsante dedicato - cosi' qualunque zona gia'
// vista resta disponibile anche se il segnale sparisce durante l'escursione.

const OFFLINE_MIN_ZOOM = 12;
const OFFLINE_MAX_ZOOM = 16;
const TILE_DOWNLOAD_CONCURRENCY = 6;

function lon2tileX(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tileY(lat, zoom) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom));
}

function tileKey(z, x, y) {
    return `${z}/${x}/${y}`;
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
        const key = tileKey(coords.z, coords.x, coords.y);

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
                idbPutTile(key, blob).catch(() => {});
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

function listTilesForBounds(bounds, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM) {
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
        const xMin = lon2tileX(bounds.getWest(), z);
        const xMax = lon2tileX(bounds.getEast(), z);
        // Y cresce verso Sud nello schema delle tile: la latitudine massima da' la Y minima
        const yMin = lat2tileY(bounds.getNorth(), z);
        const yMax = lat2tileY(bounds.getSouth(), z);

        for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
                tiles.push({ z, x, y });
            }
        }
    }
    return tiles;
}

function estimateOfflineDownloadSize(bounds) {
    const count = listTilesForBounds(bounds).length;
    const estimatedKb = count * 20; // stima prudente: aree di montagna hanno poco dettaglio, tile leggere
    return { tileCount: count, estimatedMb: Math.round((estimatedKb / 1024) * 10) / 10 };
}

// Scarica in anticipo (mentre c'e' ancora connessione) tutte le tile di un'area, con un
// numero limitato di richieste in parallelo (non di piu' di quante il browser stesso ne
// aprirebbe scorrendo la mappa a mano).
async function downloadOfflineMapForBounds(bounds, onProgress) {
    const tileLayer = window.CamoscioTileLayer;
    if (!tileLayer) throw new Error('Layer della mappa non ancora inizializzato');

    const tiles = listTilesForBounds(bounds);
    let completed = 0;
    let failed = 0;

    async function downloadOne(coords) {
        const key = tileKey(coords.z, coords.x, coords.y);
        const already = await idbGetTile(key);
        if (!already) {
            const url = tileLayer.getTileUrl(coords);
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error('Tile non disponibile');
                const blob = await response.blob();
                await idbPutTile(key, blob);
            } catch (e) {
                failed++;
            }
        }
        completed++;
        if (onProgress) onProgress(completed, tiles.length, failed);
    }

    let cursor = 0;
    async function worker() {
        while (cursor < tiles.length) {
            await downloadOne(tiles[cursor++]);
        }
    }

    await Promise.all(Array.from({ length: TILE_DOWNLOAD_CONCURRENCY }, worker));
    return { total: tiles.length, failed };
}

window.createOfflineTileLayer = createOfflineTileLayer;
window.getHikeBounds = getHikeBounds;
window.estimateOfflineDownloadSize = estimateOfflineDownloadSize;
window.downloadOfflineMapForBounds = downloadOfflineMapForBounds;
