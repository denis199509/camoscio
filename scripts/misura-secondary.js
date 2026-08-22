// Punto 98/E (riaperto una terza volta, 21/08/2026) - PRIMA di decidere se includere
// highway=secondary nel livello i, si misura quanto pesa: quante strade secondary cadono
// vicine ai sentieri GIA' conosciuti, per regione e per soglia di distanza. SOLA LETTURA:
// nessuna scrittura sulla collezione Trail, nessuna modifica al filtro vero
// (scripts/fetch-trails-nearby.js). Stesso identico metodo di misura-residential.js, che ha
// gia' guidato la decisione sul tag residential.
//
// Perche' secondary non c'e' gia' nel filtro: mai incluso (nemmeno nei 7 filtri del
// 27/07/2026, ne' quando fu aggiunto residential il 21/08), per lo stesso motivo "reti di
// paese/citta'" - una provinciale collega centri abitati, non solo un casolare isolato. Il
// caso vero che ha riaperto il punto una terza volta: dopo l'aggiunta di residential, il
// percorso vicino Valle Granara passava correttamente sulla strada residenziale ma poi
// tornava a girare largo appena avrebbe dovuto prendere la SP30 - interrogato Overpass sulle
// stesse coordinate vere (41.9086/13.3541), la SP30 (e la SP63 vicina, "Simbriuna") sono
// taggate highway=secondary. Stesso schema di residential: nessuna soglia di distanza
// l'avrebbe mai presa, perche' il dato non viene proprio scaricato da Overpass per quel tag.
//
// A differenza del casolare residential (isolato, 4 strade entro 600 m), le provinciali sono
// spesso proprio come si arriva ai punti di partenza in montagna - il rischio, da verificare
// coi numeri qui, e' che il problema non sia raro come il caso di Valle Granara.
//
// METODO: identico a misura-residential.js - stessa griglia a celle di fetch-trails-nearby.js
// ("vicino a un sentiero noto" = dentro la cella del punto o una delle 8 vicine, cella grande
// quanto la soglia), quindi il numero per soglia e' un limite superiore un po' largo, non una
// distanza esatta - la STESSA approssimazione gia' accettata per il filtro in produzione. Ogni
// way finisce nella soglia PIU' PICCOLA che lo cattura (le soglie sono crescenti): un
// conteggio "entro-200" non include quindi chi e' gia' contato in "entro-150".
//
// RIPARTIBILE come lo script gemello: progresso salvato riquadro per riquadro in
// data/misura-secondary-progresso.json. Interruzione = nessun dato perso, si rilancia e
// riprende. Con --daccapo si riparte da zero.
//
// DIFFERENZA VOLUTA rispetto a misura-residential.js: qui si deduplica per wayId (Set
// "vistiId" salvato nel progresso) prima di contare. Le residential sono strade corte di
// paese, quasi mai a cavallo di due riquadri da 0,2 gradi (~22 km); le secondary sono
// provinciali lunghe, che Overpass ripete per intero in OGNI riquadro che attraversano (way
// in bbox = way intero se anche un solo nodo cade dentro) - senza deduplica lo stesso tratto
// verrebbe ricontato una volta per riquadro attraversato, gonfiando la stima. La
// classificazione per soglia non cambia fra un riquadro e l'altro (la griglia di confronto e'
// costruita una sola volta su TUTTI i sentieri noti, non per riquadro), quindi la prima volta
// che si vede un wayId la sua soglia e' gia' quella giusta e definitiva.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectMongo, mongoose } = require('../db/mongo');
const Trail = require('../models/Trail');
const { metersPerDegree } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');

const LATO = 0.2; // stesso riquadro di fetch-trails-nearby.js
const SOGLIE_M = [150, 200, 500, 800]; // crescenti apposta: vedi nota "ogni way nella soglia piu' piccola"
const TIMEOUT_MS = 180000;
const PAUSA_MS = 1500;
const UA = 'Camoscio-App/1.0 (sito escursionismo Marche-Lazio-Abruzzo-Molise; contatto: denis1995.09@gmail.com)';
const SERVER = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
];
const FILE_PROGRESSO = path.join(__dirname, '..', 'data', 'misura-secondary-progresso.json');
const FILE_REPORT = path.join(__dirname, '..', 'data', 'misura-secondary-report.json');
const DACCAPO = process.argv.includes('--daccapo');
const SOLO = (process.argv.find(a => a.startsWith('--solo=')) || '').split('=')[1] || null; // per provare: --solo=3

const dormi = ms => new Promise(r => setTimeout(r, ms));

function leggiProgresso() {
    if (DACCAPO || !fs.existsSync(FILE_PROGRESSO)) return { fatti: [], perRegioneSoglia: {}, viste: 0, vistiId: [] };
    try {
        const p = JSON.parse(fs.readFileSync(FILE_PROGRESSO, 'utf8'));
        if (!p.vistiId) p.vistiId = [];
        return p;
    }
    catch { return { fatti: [], perRegioneSoglia: {}, viste: 0, vistiId: [] }; }
}
function scriviProgresso(p) {
    fs.writeFileSync(FILE_PROGRESSO, JSON.stringify(p));
}

function scriviReport(perRegioneSoglia, viste) {
    fs.writeFileSync(FILE_REPORT, JSON.stringify({ perRegioneSoglia, viste }, null, 2));
    console.log(`\n=== REPORT (sola lettura, nessuna scrittura sulla collezione Trail) ===`);
    console.log(`Way "highway=secondary" visti dentro le 4 regioni, vicino a sentieri gia' conosciuti: ${viste.toLocaleString('it-IT')}\n`);
    for (const [regione, soglie] of Object.entries(perRegioneSoglia)) {
        console.log(`  ${regione}:`);
        for (const chiave of ['entro-150', 'entro-200', 'entro-500', 'entro-800', 'oltre-800']) {
            if (soglie[chiave]) console.log(`    ${chiave}: ${soglie[chiave]}`);
        }
    }
    console.log(`\nSalvato anche in ${FILE_REPORT}`);
}

async function scarica(riquadro) {
    const q = `[out:json][timeout:170];
way["highway"="secondary"](${riquadro.sud.toFixed(4)},${riquadro.ovest.toFixed(4)},${riquadro.nord.toFixed(4)},${riquadro.est.toFixed(4)});
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
    console.log('SOLA LETTURA: questo script non scrive mai sulla collezione Trail.\n');

    console.log('Leggo i sentieri conosciuti dal database...');
    const noti = await Trail.find({ routingOnly: { $ne: true } }, { coordinates: 1, _id: 0 }).lean();
    console.log(`  ${noti.length.toLocaleString('it-IT')} sentieri conosciuti`);

    const { mLat, mLng } = metersPerDegree(42.5);

    // Una griglia per soglia (celle piu' strette per le soglie piu' piccole).
    const griglie = SOGLIE_M.map(soglia => {
        const pLat = soglia / mLat, pLng = soglia / mLng;
        const celle = new Set();
        for (const t of noti) for (const p of t.coordinates) celle.add(`${Math.floor(p[0] / pLng)},${Math.floor(p[1] / pLat)}`);
        return { soglia, pLat, pLng, celle };
    });
    const vicinoASoglia = (punti, griglia) => {
        for (const p of punti) {
            const gx = Math.floor(p[0] / griglia.pLng), gy = Math.floor(p[1] / griglia.pLat);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (griglia.celle.has(`${gx + dx},${gy + dy}`)) return true;
        }
        return false;
    };

    // Stessi riquadri di fetch-trails-nearby.js: solo dove ci sono gia' sentieri conosciuti.
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
    if (!elenco.length) {
        scriviReport(progresso.perRegioneSoglia, progresso.viste);
        await mongoose.disconnect();
        return;
    }
    console.log(`Stima: ~${Math.ceil(elenco.length * 8 / 60)} minuti.\n`);

    const perRegioneSoglia = progresso.perRegioneSoglia || {};
    let viste = progresso.viste || 0;
    const vistiId = new Set(progresso.vistiId || []);
    let ripetuti = 0; // quante volte un wayId gia' visto e' ricomparso in un altro riquadro
    const inizio = Date.now();

    for (let n = 0; n < elenco.length; n++) {
        const r = elenco[n];
        const vie = await scarica(r);
        if (vie === null) {
            console.log(`  [${n + 1}/${elenco.length}] ${r.k}: nessuna risposta, riprovare dopo`);
            continue; // NON si segna come fatto: si riprende al prossimo giro
        }

        for (const w of vie) {
            if (vistiId.has(w.id)) { ripetuti++; continue; } // stesso way, riquadro diverso: gia' contato
            vistiId.add(w.id);

            const punti = w.geometry.map(g => [g.lon, g.lat]);
            const regione = regionForPoint(punti[0][0], punti[0][1]) || regionForPoint(punti[punti.length - 1][0], punti[punti.length - 1][1]);
            if (!regione) continue; // fuori dalle 4 regioni: la produzione lo scarterebbe comunque

            let soglia = null;
            for (const g of griglie) { if (vicinoASoglia(punti, g)) { soglia = g.soglia; break; } }
            const chiave = soglia === null ? 'oltre-800' : `entro-${soglia}`;

            viste++;
            perRegioneSoglia[regione] = perRegioneSoglia[regione] || {};
            perRegioneSoglia[regione][chiave] = (perRegioneSoglia[regione][chiave] || 0) + 1;
        }

        fatti.add(r.k);
        scriviProgresso({ fatti: [...fatti], perRegioneSoglia, viste, vistiId: [...vistiId] });

        const trascorso = (Date.now() - inizio) / 1000;
        const rimasti = Math.round((trascorso / (n + 1)) * (elenco.length - n - 1) / 60);
        console.log(`  [${n + 1}/${elenco.length}] ${r.k}: ${vie.length} secondary visti | totale unici ${viste.toLocaleString('it-IT')} (${ripetuti.toLocaleString('it-IT')} ripetuti fra riquadri) | ~${rimasti} min rimasti`);
        await dormi(PAUSA_MS);
    }

    console.log(`\nWay ripetuti fra riquadri (stesso wayId, riquadro diverso, gia' scartati dal conteggio): ${ripetuti.toLocaleString('it-IT')}`);
    scriviReport(perRegioneSoglia, viste);
    await mongoose.disconnect();
})().catch(e => { console.error('Errore:', e.message, e.stack); process.exit(1); });
