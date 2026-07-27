// PUNTO 13 - Estrazione dei dati del LIVELLO i: tutto cio' che si cammina entro 200 m
// dalla rete dei sentieri gia' conosciuti.
//
// Scelto dall'utente il 2026-07-27 dopo le misure, fra sette filtri provati. Perche' questo:
//   - dove un percorso sui sentieri oggi esiste nel 74,9% dei casi, col livello i esiste
//     nel 95,7%;
//   - costa meno della meta' del filtro "prendi tutte le strade" (65 MB contro 103 stimati
//     sulle 4 regioni) a parita' di risultato, perche' non si tira dentro la citta';
//   - e lascia meta' delle reti spezzate (211 pezzi invece di 434 sull'area di prova).
//
// COSA FA, in concreto: per ogni riquadro scarica i way percorribili, tiene solo quelli che
// passano entro 200 m da un sentiero GIA' sul database, e li salva con routingOnly: true.
//
// PERCHE' routingOnly SU TUTTI I NUOVI, anche su quelli che sono sentieri veri (un path
// senza sac_scale E' un sentiero): perche' l'indice in RAM deve restare quello di oggi, che
// e' l'unica dimensione gia' misurata come sicura su Render. Allargare anche l'aggancio del
// GPS e' una decisione separata, che va presa dopo aver misurato la memoria - non di
// straforo insieme a questa. Vedi lib/trailIndex.js.
//
// E' RIPARTIBILE: tiene l'elenco dei riquadri gia' fatti in data/estrazione-progresso.json.
// Se si interrompe (Overpass, la sessione, il PC) si rilancia e riprende da dove era. Con
// --daccapo si ricomincia da zero.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectMongo, mongoose } = require('../db/mongo');
const Trail = require('../models/Trail');
const { celleDiLinea } = require('../lib/trailCells');
const { metersPerDegree } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');

const LATO = 0.2;            // gradi. Misurato: ~6s e ~5 MB a riquadro. A 0,5 va pure, ma un
                             // fallimento costerebbe 34 MB da riscaricare, e Overpass fallisce spesso.
const VICINANZA_M = 200;     // "vicino a un sentiero": due minuti a piedi, la scala di un raccordo
const TIMEOUT_MS = 180000;
const PAUSA_MS = 1500;
const UA = 'Camoscio-App/1.0 (sito escursionismo Marche-Lazio-Abruzzo-Molise; contatto: denis1995.09@gmail.com)';
const SERVER = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
];
const FILE_PROGRESSO = path.join(__dirname, '..', 'data', 'estrazione-progresso.json');
const DACCAPO = process.argv.includes('--daccapo');
const SOLO = (process.argv.find(a => a.startsWith('--solo=')) || '').split('=')[1] || null; // per provare: --solo=3

const dormi = ms => new Promise(r => setTimeout(r, ms));

function leggiProgresso() {
    if (DACCAPO || !fs.existsSync(FILE_PROGRESSO)) return { fatti: [], salvati: 0, saltati: 0 };
    try { return JSON.parse(fs.readFileSync(FILE_PROGRESSO, 'utf8')); }
    catch { return { fatti: [], salvati: 0, saltati: 0 }; }
}
function scriviProgresso(p) {
    fs.writeFileSync(FILE_PROGRESSO, JSON.stringify(p));
}

async function scarica(riquadro) {
    const q = `[out:json][timeout:170];
way["highway"~"^(path|track|bridleway|unclassified|service)$"](${riquadro.sud.toFixed(4)},${riquadro.ovest.toFixed(4)},${riquadro.nord.toFixed(4)},${riquadro.est.toFixed(4)});
out geom;`;
    for (let giro = 1; giro <= 2; giro++) {
        for (const url of SERVER) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            try {
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': UA }, body: q, signal: ctrl.signal });
                const testo = await res.text();
                clearTimeout(timer);
                if (!res.ok || !testo.trim().startsWith('{')) { await dormi(PAUSA_MS); continue; }
                const d = JSON.parse(testo);
                if (d.remark) { await dormi(PAUSA_MS); continue; }
                return (d.elements || []).filter(e => e.id && Array.isArray(e.geometry) && e.geometry.length >= 2);
            } catch (e) { clearTimeout(timer); await dormi(PAUSA_MS); }
        }
        await dormi(giro * 8000);
    }
    return null;
}

(async () => {
    await connectMongo();

    // I sentieri CONOSCIUTI, quelli che il sito ha gia': sono l'ancora del livello i.
    // Si legge solo la geometria, e si tengono in una griglia per il "vicino a" invece che
    // in un elenco da scorrere - sono quasi un milione di punti.
    console.log('Leggo i sentieri conosciuti dal database...');
    const noti = await Trail.find({ routingOnly: { $ne: true } }, { coordinates: 1, wayId: 1, _id: 0 }).lean();
    const wayIdNoti = new Set(noti.map(t => t.wayId));
    console.log(`  ${noti.length.toLocaleString('it-IT')} sentieri conosciuti, ${noti.reduce((s, t) => s + t.coordinates.length, 0).toLocaleString('it-IT')} punti`);

    const { mLat, mLng } = metersPerDegree(42.5);
    const pLat = VICINANZA_M / mLat, pLng = VICINANZA_M / mLng;
    const celleNote = new Set();
    for (const t of noti) for (const p of t.coordinates) celleNote.add(`${Math.floor(p[0] / pLng)},${Math.floor(p[1] / pLat)}`);
    const vicinoANoti = punti => {
        for (const p of punti) {
            const gx = Math.floor(p[0] / pLng), gy = Math.floor(p[1] / pLat);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (celleNote.has(`${gx + dx},${gy + dy}`)) return true;
        }
        return false;
    };

    // I riquadri da interrogare: solo quelli che contengono sentieri conosciuti. Fuori da
    // li' il livello i non aggiungerebbe niente PER DEFINIZIONE, quindi interrogarli
    // sarebbe tempo e banda buttati.
    const riquadri = new Map();
    for (const t of noti) {
        for (const p of t.coordinates) {
            const k = `${Math.floor(p[1] / LATO)},${Math.floor(p[0] / LATO)}`;
            if (!riquadri.has(k)) {
                const [ry, rx] = k.split(',').map(Number);
                riquadri.set(k, { k, sud: ry * LATO, ovest: rx * LATO, nord: (ry + 1) * LATO, est: (rx + 1) * LATO });
            }
        }
    }
    let elenco = [...riquadri.values()];

    const progresso = leggiProgresso();
    const fatti = new Set(progresso.fatti);
    elenco = elenco.filter(r => !fatti.has(r.k));
    if (SOLO) elenco = elenco.slice(0, Number(SOLO));

    console.log(`\nRiquadri da ${LATO}°: ${riquadri.size} in tutto, ${fatti.size} gia' fatti, ${elenco.length} da fare.`);
    if (!elenco.length) { console.log('Niente da fare.'); await mongoose.disconnect(); return; }
    console.log(`Stima: ~${Math.ceil(elenco.length * 8 / 60)} minuti.\n`);

    const inizio = Date.now();
    let salvati = progresso.salvati || 0, saltati = progresso.saltati || 0, falliti = 0;

    for (let n = 0; n < elenco.length; n++) {
        const r = elenco[n];
        const vie = await scarica(r);
        if (vie === null) {
            falliti++;
            console.log(`  [${n + 1}/${elenco.length}] ${r.k}: nessuna risposta, riprovare dopo`);
            continue; // NON si segna come fatto: si riprende al prossimo giro
        }

        const daSalvare = [];
        for (const w of vie) {
            if (wayIdNoti.has(w.id)) continue;             // e' gia' un sentiero conosciuto
            const punti = w.geometry.map(g => [g.lon, g.lat]);
            if (!vicinoANoti(punti)) { saltati++; continue; } // lontano dai sentieri: fuori dal livello i
            // Vincolo delle 4 regioni, come per tutto il resto del progetto.
            const regione = regionForPoint(punti[0][0], punti[0][1]) || regionForPoint(punti[punti.length - 1][0], punti[punti.length - 1][1]);
            if (!regione) { saltati++; continue; }
            daSalvare.push({
                updateOne: {
                    filter: { wayId: w.id },
                    update: {
                        $set: { region: regione, name: (w.tags && w.tags.name) || null, coordinates: punti, cells: celleDiLinea(punti) },
                        // routingOnly SOLO all'inserimento: se un domani questo way diventasse
                        // un sentiero conosciuto, un rilancio non deve declassarlo.
                        $setOnInsert: { routingOnly: true, sacScale: null }
                    },
                    upsert: true
                }
            });
        }

        if (daSalvare.length) {
            for (let i = 0; i < daSalvare.length; i += 500) {
                await Trail.bulkWrite(daSalvare.slice(i, i + 500), { ordered: false });
            }
            salvati += daSalvare.length;
        }

        fatti.add(r.k);
        scriviProgresso({ fatti: [...fatti], salvati, saltati });

        const trascorso = (Date.now() - inizio) / 1000;
        const rimasti = Math.round((trascorso / (n + 1)) * (elenco.length - n - 1) / 60);
        console.log(`  [${n + 1}/${elenco.length}] ${r.k}: ${vie.length} way visti, ${daSalvare.length} salvati | totale ${salvati.toLocaleString('it-IT')} | ~${rimasti} min rimasti`);
        await dormi(PAUSA_MS);
    }

    console.log(`\n=== FATTO ===`);
    console.log(`  tratti nuovi salvati: ${salvati.toLocaleString('it-IT')}`);
    console.log(`  scartati perche' lontani dai sentieri o fuori regione: ${saltati.toLocaleString('it-IT')}`);
    if (falliti) console.log(`  riquadri senza risposta: ${falliti} — RILANCIA lo script, riprende solo da quelli`);
    console.log(`  sentieri sul database ora: ${(await Trail.countDocuments({})).toLocaleString('it-IT')} (di cui ${(await Trail.countDocuments({ routingOnly: true })).toLocaleString('it-IT')} solo per la ricerca del percorso)`);
    console.log(`  tempo: ${Math.round((Date.now() - inizio) / 60000)} minuti`);

    await mongoose.disconnect();
})().catch(e => { console.error('Errore:', e.message, e.stack); process.exit(1); });
