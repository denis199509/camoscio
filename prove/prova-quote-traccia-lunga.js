// PROVA: le statistiche di quota su una traccia LUNGA non fanno cadere la registrazione.
//
// Rilievo URGENTE della revisione 35a (code-reviewer + security-privacy): Math.max(...array)
// e Math.min(...array) vanno in RangeError quando l'array supera ~1,2e5 elementi (lo spread
// esaurisce lo stack degli argomenti - misurato su Node 24). Camoscio dichiara il tracciamento
// multi-day e session.points NON ha un tetto complessivo (MAX_POINTS_PER_BATCH e' solo
// per-invio), quindi ~35 h di registrazione a 1 Hz ci arrivano davvero.
//
// Il punto peggiore era routes/tracking.js (maxAltitudeM del Punto 1): calcolato DENTRO il
// try/catch di POST /:id/end PRIMA del $set status:'ended'. La RangeError lasciava la sessione
// APERTA per sempre, e openSession blocca l'avvio di una nuova -> la funzione di sicurezza si
// autoblocca, senza malizia, alla prima traccia lunga davvero.
//
// Qui si provano le due funzioni PURE che avevano lo stesso spread (statisticheTraccia in
// lib/gpx.js, misureDaSessione in lib/percorso.js). routes/tracking.js usa lo stesso identico
// pattern sulle stesse quote e non e' isolabile dal server: resta coperto per ispezione.
//
//   node prove/prova-quote-traccia-lunga.js      (non serve il server acceso)

const { statisticheTraccia } = require('../lib/gpx');
const { misureDaSessione } = require('../lib/percorso');
const { haversineKm } = require('../lib/geometry');

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Quanti elementi bastano a far scoppiare lo spread SU QUESTO runtime: si misura, non si indovina.
function spreadRompe(n) {
    try { Math.max(...new Array(n).fill(0)); return false; }
    catch (e) { return e instanceof RangeError; }
}

const N = 200000;   // ben oltre la soglia ~1,2e5, non cosi' tanto da rendere la prova lenta

(async () => {
    // --- 0. Controprova d'ambiente: lo spread si rompe DAVVERO, e non a un numero assurdo ---
    console.log('\n0. Ambiente');
    ok(`Math.max(...) va in RangeError con ${N} elementi (spread rotto su questo Node)`, spreadRompe(N));
    ok("...e regge invece con 1000 elementi (non e' un limite arbitrario del test)", !spreadRompe(1000));

    // Traccia sintetica: N punti su una linea quasi retta (Douglas-Peucker la riduce subito, non
    // e' lei sotto prova), quota ciclica 500..1499 con un massimo e un minimo VERI piantati a mano.
    const punti = [];
    for (let i = 0; i < N; i++) {
        punti.push([13.5 + i * 1e-6, 42.4, 500 + (i % 1000), i, 0]);
    }
    punti[Math.floor(N / 2)][2] = 2500;   // il vero massimo
    punti[Math.floor(N / 4)][2] = 42;     // il vero minimo

    // --- 1. lib/gpx.js  statisticheTraccia ---
    console.log('\n1. statisticheTraccia (lib/gpx.js)');
    {
        let st = null, errore = null;
        try { st = statisticheTraccia(punti, 10, haversineKm); }
        catch (e) { errore = e; }
        ok(`statisticheTraccia(${N} punti) non lancia`, errore === null, errore && errore.message);
        ok('quotaMaxM = 2500 (il massimo vero)', st && st.quotaMaxM === 2500, st && String(st.quotaMaxM));
        ok('quotaMinM = 42 (il minimo vero)', st && st.quotaMinM === 42, st && String(st.quotaMinM));
    }

    // --- 2. lib/percorso.js  misureDaSessione (ramo maxDaiPunti: nessun maxAltitudeM sul doc) ---
    console.log('\n2. misureDaSessione (lib/percorso.js)');
    {
        const sessione = {
            points: punti,
            distanceKm: 12.3,           // > 0.05 -> "sostanziale"
            durationSeconds: 6 * 3600,
            elevationGainM: 800,
            movingTimeSec: 5 * 3600,
            // maxAltitudeM assente di proposito: forza il calcolo dai punti (il ramo con lo spread)
        };
        let m = null, errore = null;
        try { m = misureDaSessione(sessione); }
        catch (e) { errore = e; }
        ok(`misureDaSessione(${N} punti, senza maxAltitudeM) non lancia`, errore === null, errore && errore.message);
        ok('maxAltitude = 2500 (calcolato dai punti completi)', m && m.maxAltitude === 2500, m && String(m.maxAltitude));
    }

    // --- 3. Equivalenza su un array piccolo: la reduce da' lo stesso di Math.max/min ---
    console.log('\n3. Equivalenza su una traccia corta');
    {
        const q = [340, 12, 999, 501, 12, 1450, 88];
        const corti = q.map((a, i) => [13.5 + i * 1e-5, 42.4, a, i, 0]);
        const st = statisticheTraccia(corti, 10, haversineKm);
        ok(`quotaMaxM = Math.max = ${Math.max(...q)}`, st.quotaMaxM === Math.max(...q), String(st.quotaMaxM));
        ok(`quotaMinM = Math.min = ${Math.min(...q)}`, st.quotaMinM === Math.min(...q), String(st.quotaMinM));
    }

    console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
    process.exit(falliti === 0 ? 0 : 1);
})().catch(e => { console.error('ERRORE NON GESTITO NELLA PROVA:', e); process.exit(1); });
