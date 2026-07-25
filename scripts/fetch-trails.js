// Fase G - Scarica UNA TANTUM (poi si rilancia solo per aggiornare la mappa dei sentieri,
// non ad ogni avvio del server) i sentieri di montagna REALI delle 4 regioni da
// OpenStreetMap tramite Overpass API, un servizio pubblico e gratuito. Nessun Python,
// nessuna libreria XML (vedi leggimi.txt sul motivo per cui "osmtogeojson" non e' stata
// installata): si chiede direttamente a Overpass l'output nativo in JSON ("out geom;",
// che include gia' le coordinate di ogni nodo del sentiero, non solo i loro ID) e lo si
// trasforma a mano nel formato compatto usato dal modello Trail.
//
// Cosa conta come "sentiero di montagna reale" qui (non i marciapiedi cittadini, che in
// OSM sono quasi sempre taggati highway=footway, ESCLUSO di proposito):
//   - highway=path / track / bridleway CON sac_scale presente (classificazione ufficiale
//     di difficolta' escursionistica del CAI/alpina), OPPURE
//   - qualunque way che sia membro di una relation route=hiking (rete sentieristica CAI
//     numerata), anche se il singolo tratto non ha sac_scale.
//
// Uso: node scripts/fetch-trails.js
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const Trail = require('../models/Trail');

const REGIONS = ['Marche', 'Lazio', 'Abruzzo', 'Molise'];
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_S = 180;
const FETCH_TIMEOUT_MS = (OVERPASS_TIMEOUT_S + 60) * 1000; // margine oltre al timeout richiesto al server Overpass
const PAUSE_BETWEEN_REGIONI_MS = 5000; // buon uso di un servizio pubblico gratuito condiviso
const MAX_RETRY = 3;

// Overpass (dietro Apache) risponde 406 "Not Acceptable" alle richieste senza uno
// User-Agent che identifichi il chiamante - stessa policy di Nominatim in
// scripts/fetch-region-boundaries.js, qui dimenticata alla prima stesura.
const OVERPASS_USER_AGENT = 'Camoscio-App/1.0 (sito escursionismo Marche-Lazio-Abruzzo-Molise; contatto: denis1995.09@gmail.com)';

function overpassQuery(regionName) {
    return `
[out:json][timeout:${OVERPASS_TIMEOUT_S}];
area["name"="${regionName}"]["admin_level"="4"]["boundary"="administrative"]->.regione;
(
  way["highway"~"^(path|track|bridleway)$"]["sac_scale"](area.regione);
  relation["route"="hiking"](area.regione)->.reti;
  way(r.reti)["highway"~"^(path|track|bridleway)$"];
);
out geom;
`.trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOverpassQuery(query) {
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(OVERPASS_URL, {
                method: 'POST',
                body: 'data=' + encodeURIComponent(query),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': OVERPASS_USER_AGENT,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timer);

            if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
                throw new Error(`Overpass temporaneamente occupato (HTTP ${res.status})`);
            }
            if (!res.ok) {
                throw new Error(`Overpass ha risposto HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
            }
            return await res.json();
        } catch (e) {
            clearTimeout(timer);
            if (attempt === MAX_RETRY) throw e;
            const waitMs = attempt * 15000;
            console.log(`  Tentativo ${attempt} fallito (${e.message}), riprovo tra ${waitMs / 1000}s...`);
            await sleep(waitMs);
        }
    }
}

// "out geom" restituisce per ogni way un array way.geometry di {lat, lon} gia' nell'ordine
// del sentiero: e' l'equivalente nativo JSON di quello che altrimenti richiederebbe
// osmtogeojson (scartata per una vulnerabilita' di sicurezza nella sua dipendenza XML,
// vedi leggimi.txt), senza bisogno di risolvere gli ID dei nodi in un secondo passaggio.
function wayToTrailDoc(way, region) {
    if (!Array.isArray(way.geometry)) return null;

    const coordinates = [];
    for (const node of way.geometry) {
        if (!node || typeof node.lat !== 'number' || typeof node.lon !== 'number') continue;
        coordinates.push([node.lon, node.lat]);
    }
    if (coordinates.length < 2) return null;

    return {
        wayId: way.id,
        region,
        name: (way.tags && way.tags.name) || null,
        sacScale: (way.tags && way.tags.sac_scale) || null,
        coordinates
    };
}

(async () => {
    await connectMongo();

    let totalWays = 0, totalPoints = 0;

    for (const region of REGIONS) {
        console.log(`\nInterrogo Overpass per i sentieri di montagna di ${region}...`);
        const data = await runOverpassQuery(overpassQuery(region));

        const ways = Array.isArray(data.elements) ? data.elements.filter(el => el.type === 'way') : [];
        const docs = ways.map(w => wayToTrailDoc(w, region)).filter(Boolean);

        if (docs.length === 0) {
            console.log(`  Nessun sentiero trovato per ${region} (verifica il nome regione/connessione).`);
        } else {
            const ops = docs.map(doc => ({
                updateOne: { filter: { wayId: doc.wayId }, update: { $set: doc }, upsert: true }
            }));
            const result = await Trail.bulkWrite(ops);
            const points = docs.reduce((sum, d) => sum + d.coordinates.length, 0);
            totalWays += docs.length;
            totalPoints += points;
            console.log(`  ${region}: ${docs.length} sentieri (${points} punti totali) - ` +
                `${result.upsertedCount} nuovi, ${result.modifiedCount} aggiornati`);
        }

        if (region !== REGIONS[REGIONS.length - 1]) await sleep(PAUSE_BETWEEN_REGIONI_MS);
    }

    console.log(`\nFatto: ${totalWays} sentieri, ${totalPoints} punti in totale su MongoDB (collezione Trail).`);
    await mongoose.disconnect();
})().catch(err => {
    console.error('Errore estrazione sentieri:', err.message);
    process.exit(1);
});
