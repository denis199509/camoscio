// Punto 8 di cose_da_fare.txt - trovare il punto di ritrovo per NOME invece che
// scrivendo latitudine e longitudine a mano.
//
// PERCHE' UN PROXY E NON UNA CHIAMATA DIRETTA DAL BROWSER: la policy d'uso di Nominatim
// (nominatim.org/release-docs/latest/api/Search/) impone uno User-Agent che identifichi
// l'applicazione e non piu' di 1 richiesta al secondo COMPLESSIVE. Dal browser lo
// User-Agent non e' impostabile, e ogni visitatore farebbe richieste per conto suo:
// bastano pochi utenti che digitano insieme per farsi bloccare l'IP del server. Qui
// invece tutte le richieste passano da un unico punto, con lo stesso User-Agent gia'
// usato da scripts/fetch-region-boundaries.js, messe in fila una per volta e con una
// memoria dei risultati gia' visti.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { boundaries, regionForPoint } = require('../lib/regions');

// Nomi delle 4 regioni ammesse, letti dai confini reali gia' caricati (invece di
// riscriverli a mano: cosi' restano allineati se un giorno l'ambito cambia).
const REGION_NAMES = Object.keys(boundaries);

// regionForPoint vuole (lng, lat) in quest'ordine - qui si incapsula per non sbagliare.
function isInAnyRegion(lat, lng) {
    return regionForPoint(lng, lat) !== null;
}

const router = express.Router();

const NOMINATIM_USER_AGENT = 'Camoscio-App/1.0 (sito escursionismo Marche-Lazio-Abruzzo-Molise; contatto: denis1995.09@gmail.com)';
const MIN_INTERVAL_MS = 1100; // 1 richiesta al secondo + un margine
const CACHE_MAX = 500;        // in RAM, non su MongoDB: sono dati pubblici e riscaricabili
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --- Coda: mai due richieste a Nominatim nello stesso momento, mai piu' di una al secondo ---
let lastCallAt = 0;
let queueTail = Promise.resolve();

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Accoda una chiamata: ogni richiesta aspetta che finisca la precedente E che sia passato
// abbastanza tempo dall'ultima chiamata vera a Nominatim.
function enqueue(fn) {
    const run = queueTail.then(async () => {
        const attesa = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
        if (attesa > 0) await sleep(attesa);
        lastCallAt = Date.now();
        return fn();
    });
    // La coda prosegue anche se una richiesta fallisce, altrimenti si bloccherebbe per sempre.
    queueTail = run.then(() => { }, () => { });
    return run;
}

// --- Memoria dei risultati gia' visti (chiave -> {scadenza, dati}) ---
const cache = new Map();

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.scadenza) {
        cache.delete(key);
        return null;
    }
    return hit.dati;
}

function cacheSet(key, dati, ttlMs = CACHE_TTL_MS) {
    // Map conserva l'ordine di inserimento: la prima chiave e' la piu' vecchia.
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { scadenza: Date.now() + ttlMs, dati });
}

async function callNominatim(percorso, parametri) {
    const url = `https://nominatim.openstreetmap.org/${percorso}?` + new URLSearchParams(parametri);
    const res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim ha risposto ${res.status}`);
    return res.json();
}

// Nominatim restituisce nomi lunghissimi ("Campo Imperatore, L'Aquila, Abruzzo, 67100,
// Italia"): per l'interfaccia serve un nome corto piu' un contesto leggibile.
function accorcia(display) {
    const parti = (display || '').split(',').map(p => p.trim()).filter(Boolean);
    return {
        nome: parti[0] || '',
        // salta il CAP (tutto cifre) e la nazione finale
        contesto: parti.slice(1, -1).filter(p => !/^\d+$/.test(p)).slice(0, 2).join(', ')
    };
}

// GET /api/geocoding/search?q=Campo Imperatore
// Cerca un luogo per nome. Solo Italia, e i risultati fuori dalle 4 regioni ammesse
// vengono marcati (non scartati: e' piu' utile dire "questo e' fuori zona" che far
// sparire il risultato lasciando l'utente a chiedersi perche' non lo trova).
router.get('/search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 3) {
        return res.status(400).json({ error: 'Scrivi almeno 3 lettere per cercare un luogo.' });
    }
    if (q.length > 120) {
        return res.status(400).json({ error: 'Testo di ricerca troppo lungo.' });
    }

    const chiave = `s:${q.toLowerCase()}`;
    const inCache = cacheGet(chiave);
    if (inCache) return res.json(inCache);

    try {
        const grezzi = await enqueue(() => callNominatim('search', {
            q,
            format: 'jsonv2',
            countrycodes: 'it',
            limit: '8',
            addressdetails: '1'
        }));

        const risultati = grezzi.map(r => {
            const lat = parseFloat(r.lat);
            const lng = parseFloat(r.lon);
            const { nome, contesto } = accorcia(r.display_name);
            return {
                nome: r.name || nome,
                contesto,
                lat,
                lng,
                tipo: r.type || r.class || '',
                inRegione: isInAnyRegion(lat, lng)
            };
        }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));

        // I luoghi dentro le 4 regioni vanno in cima: sono gli unici utilizzabili davvero.
        risultati.sort((a, b) => (b.inRegione ? 1 : 0) - (a.inRegione ? 1 : 0));

        cacheSet(chiave, risultati);
        res.json(risultati);
    } catch (e) {
        console.error('Ricerca luogo fallita:', e.message);
        res.status(502).json({ error: 'Il servizio di ricerca luoghi non risponde. Riprova tra poco.' });
    }
});

// --- Punti di riferimento di montagna (Overpass), come MIGLIORIA OPZIONALE ---
//
// Misurato prima di scegliere questa strada: il reverse geocoding di Nominatim NON e'
// adatto alla montagna. Sul punto di Campo Imperatore restituisce "L'Aquila" (il comune)
// o addirittura il nome di una strada ("SR17bisC"), e sul Corno Grande "variante aerea"
// (un sentiero). Overpass invece, che sa cercare elementi CON NOME entro un raggio,
// restituisce esattamente "Campo Imperatore" a 5 metri e "Corno Grande - Vetta
// Occidentale" a 102 metri - cioe' proprio l'esempio chiesto nel punto 8.
//
// PERCHE' SOLO "OPZIONALE": sempre nella stessa misura, Overpass e' risultato
// inaffidabile - quando risponde impiega ~0,4s, ma va in errore 504 con frequenza alta
// (fino a 36 secondi di attesa prima di arrendersi), su entrambi i server pubblici
// provati. Farci dipendere l'interfaccia significherebbe lasciare l'utente a fissare uno
// spinner. Quindi: si aspetta al massimo OVERPASS_TIMEOUT_MS e, se non risponde in tempo,
// si tiene tranquillamente il risultato di Nominatim. Nessun errore mostrato all'utente.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// 3,5s e non meno: misurato che l'attesa complessiva e' comunque dominata da Nominatim
// (~2,6s, per via della pausa obbligatoria di 1 richiesta al secondo), quindi allargare
// un po' il tetto di Overpass non peggiora quasi mai il tempo totale percepito ma alza
// parecchio le probabilita' di ottenere il nome buono ("Campo Imperatore" invece di
// "Tre Valloni"). Le due ricerche partono insieme, il totale e' il piu' lento dei due.
const OVERPASS_TIMEOUT_MS = 3500;
const LANDMARK_RADIUS_M = 1200;

function overpassQuery(lat, lng) {
    const r = LANDMARK_RADIUS_M;
    // Solo nodi: la stessa query con anche i "way" e' risultata molto piu' lenta, e i
    // punti di riferimento utili (vette, selle, altopiani, rifugi, localita') in OSM
    // sono quasi sempre nodi.
    return `[out:json][timeout:10];
node(around:${r},${lat},${lng})["name"]["natural"~"^(peak|saddle|plateau|volcano)$"];out 15;
node(around:${r},${lat},${lng})["name"]["tourism"~"^(alpine_hut|wilderness_hut)$"];out 10;
node(around:${r},${lat},${lng})["name"]["place"~"^(locality|hamlet|village|town)$"];out 10;`;
}

function distanzaMetri(lat1, lng1, lat2, lng2) {
    return Math.hypot((lat2 - lat1) * 111320, (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180));
}

async function cercaRiferimentoVicino(lat, lng) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
    try {
        const res = await fetch(OVERPASS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', 'User-Agent': NOMINATIM_USER_AGENT },
            body: overpassQuery(lat, lng),
            signal: ctrl.signal
        });
        if (!res.ok) return null;
        const testo = await res.text();
        // Overpass in errore risponde con una pagina XML/HTML, non con JSON.
        if (!testo.trim().startsWith('{')) return null;

        const elementi = (JSON.parse(testo).elements || [])
            .filter(e => e.tags && e.tags.name && Number.isFinite(e.lat) && Number.isFinite(e.lon))
            .map(e => ({
                nome: e.tags.name,
                tipo: e.tags.natural || e.tags.tourism || e.tags.place || '',
                distanzaM: Math.round(distanzaMetri(lat, lng, e.lat, e.lon))
            }))
            .sort((a, b) => a.distanzaM - b.distanzaM);

        return elementi[0] || null;
    } catch (e) {
        return null; // timeout o rete: si prosegue senza, e' solo una miglioria
    } finally {
        clearTimeout(timer);
    }
}

// GET /api/geocoding/reverse?lat=..&lng=..
// Dato un punto scelto sulla mappa, trova il nome del luogo conosciuto piu' vicino.
// Serve alla richiesta esplicita del punto 8: "se il punto scelto e' molto vicino a un
// luogo con un nome noto usare quel nome, piu' facile da capire per un principiante;
// se il punto non ha nessun riferimento vicino, tenere le coordinate come informazione".
router.get('/reverse', requireAuth, async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ error: 'Coordinate non valide.' });
    }

    // Arrotondare a 4 decimali (~11 metri) fa si' che due click quasi nello stesso punto
    // condividano la stessa voce in memoria invece di generare due chiamate ai servizi.
    const chiave = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const inCache = cacheGet(chiave);
    if (inCache) return res.json(inCache);

    const risposta = {
        nome: null,
        contesto: '',
        distanzaM: null,
        fonte: null, // 'riferimento' = punto di interesse vicino | 'area' = zona amministrativa
        inRegione: isInAnyRegion(lat, lng),
        regioniAmmesse: REGION_NAMES
    };

    // Le due ricerche partono INSIEME: Nominatim da' sempre una risposta (lenta ma sicura),
    // Overpass da' quella buona per la montagna (veloce ma inaffidabile). Si aspettano
    // entrambe, ma Overpass ha un tetto di 2,5s oltre il quale si rinuncia in silenzio.
    const [areaEsito, riferimento] = await Promise.all([
        enqueue(() => callNominatim('reverse', {
            lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '15', addressdetails: '1'
        })).catch(() => null),
        cercaRiferimentoVicino(lat, lng)
    ]);

    if (areaEsito) {
        const { nome, contesto } = accorcia(areaEsito.display_name);
        const a = areaEsito.address || {};
        // Si scarta il "name" quando e' una strada: in montagna Nominatim restituisce
        // spesso il nome di una carrareccia, inutile come punto di ritrovo.
        const nomeUtile = areaEsito.category === 'highway' ? null : areaEsito.name;
        risposta.nome = nomeUtile || a.peak || a.hamlet || a.village || a.town ||
            a.city || a.municipality || a.county || nome || null;
        risposta.contesto = contesto;
        if (risposta.nome) risposta.fonte = 'area';
    }

    // Un punto di riferimento vero e proprio (vetta, rifugio, altopiano, localita') batte
    // sempre il nome amministrativo: e' quello che un escursionista riconosce.
    if (riferimento) {
        risposta.nome = riferimento.nome;
        risposta.distanzaM = riferimento.distanzaM;
        risposta.fonte = 'riferimento';
    }

    // Se Overpass ha risposto in tempo il risultato e' quello buono e si tiene a lungo.
    // Se invece e' andato in timeout siamo ripiegati sul nome amministrativo: conservarlo
    // per 24 ore vorrebbe dire congelare il risultato PEGGIORE e impedire per sempre a un
    // tentativo successivo di ottenere il nome giusto. In quel caso si tiene pochi minuti,
    // quel tanto che basta a non ripetere la chiamata se l'utente ritocca lo stesso punto.
    const durata = risposta.fonte === 'riferimento' ? CACHE_TTL_MS : 10 * 60 * 1000;
    cacheSet(chiave, risposta, durata);
    res.json(risposta);
});

module.exports = router;
