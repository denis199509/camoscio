// Prova di lib/gpx.js: tempiTraccia() (punto 79 - separare cammino e pause da un .gpx).
// Solo tracce SINTETICHE con un risultato noto per costruzione: non tocca database ne'
// rete, non serve il server acceso. Il file vero di Denis (Castel Madama Escursionismo.gpx)
// e' stato usato a parte per calibrare le soglie, non e' qui perche' non e' un file del
// repository.

const { tempiTraccia } = require('../lib/gpx');
const { haversineKm, metersPerDegree } = require('../lib/geometry');

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}
function vicino(nome, valore, atteso, tolleranza, unita = '') {
    ok(`${nome} (${valore}${unita}, atteso ~${atteso}${unita} ±${tolleranza})`, Math.abs(valore - atteso) <= tolleranza);
}

// Punto di partenza qualunque (Castel Madama, dove Denis ha davvero camminato) - non conta
// dove si e', conta solo la distanza fra i punti generati.
const LAT0 = 42.04, LNG0 = 12.83;
const { mLat, mLng } = metersPerDegree(LAT0);

// Genera punti che si spostano in linea retta a velocita' costante (m/s), campionati ogni
// passoSec secondi, a partire da un istante e una posizione dati. Ritorna anche l'istante e
// la posizione finali, cosi' i test si possono incatenare (camminata poi sosta poi ancora
// camminata) senza ricalcolare a mano dove finisce ogni pezzo.
function camminata(velocitaMs, durataSec, passoSec, partenza) {
    const punti = [];
    let t = partenza.t, lng = partenza.lng, lat = partenza.lat;
    const dLngPerPasso = (velocitaMs * passoSec) / mLng;
    for (let trascorso = 0; trascorso <= durataSec; trascorso += passoSec) {
        punti.push([+lng.toFixed(7), +lat.toFixed(7), 1000, t, 0]);
        t += passoSec;
        lng += dLngPerPasso;
    }
    return { punti, fine: { t, lng, lat } };
}

// Punti fermi con un piccolo rumore GPS che OSCILLA (non deriva in una direzione): un GPS
// vero fermo balla intorno alla stessa posizione, non si allontana. Il pattern alternato
// (+jitter/-jitter) e' deterministico apposta - una prova che a volte fallisce da sola per
// colpa di Math.random() e' peggio di nessuna prova.
function fermo(jitterM, durataSec, passoSec, partenza) {
    const punti = [];
    let t = partenza.t;
    const dLng = jitterM / mLng;
    let i = 0;
    for (let trascorso = 0; trascorso <= durataSec; trascorso += passoSec) {
        const segno = i % 2 === 0 ? 1 : -1;
        punti.push([+(partenza.lng + segno * dLng).toFixed(7), partenza.lat, 1000, t, 0]);
        t += passoSec;
        i++;
    }
    return { punti, fine: { t, lng: partenza.lng, lat: partenza.lat } };
}

function concat(...pezzi) {
    const punti = [];
    for (const p of pezzi) punti.push(...p.punti);
    // punti con lo stesso istante al confine fra due pezzi (l'ultimo dell'uno == il primo
    // dell'altro, e' cosi' apposta per incatenarli senza salti di tempo) si tengono una
    // volta sola, altrimenti secondiDaInizio non sarebbe piu' strettamente crescente.
    const puliti = [punti[0]];
    for (let i = 1; i < punti.length; i++) {
        if (punti[i][3] > puliti[puliti.length - 1][3]) puliti.push(punti[i]);
    }
    return puliti;
}

function invariante(t) {
    return t.movimentoSec + t.pausaSec + t.incertoSec === t.totaleSec;
}

console.log('--- Cammino puro, nessuna sosta ---');
{
    const { punti } = camminata(1.2, 1200, 2, { t: 0, lng: LNG0, lat: LAT0 });
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante movimento+pausa+incerto=totale', invariante(t), JSON.stringify(t));
    ok('attendibile', t.attendibile === true, JSON.stringify(t.motivi));
    vicino('quasi tutto movimento', t.movimentoSec, 1200, 30, 's');
    vicino('pausa quasi zero', t.pausaSec, 0, 30, 's');
}

console.log('\n--- Cammino, sosta di 5 minuti, cammino ---');
{
    const p1 = camminata(1.2, 600, 2, { t: 0, lng: LNG0, lat: LAT0 });
    const p2 = fermo(3, 300, 2, p1.fine);
    const p3 = camminata(1.2, 600, 2, p2.fine);
    const punti = concat(p1, p2, p3);
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('attendibile', t.attendibile === true, JSON.stringify(t.motivi));
    vicino('pausa trovata vicina ai 5 minuti reali', t.pausaSec, 300, 90, 's');
    vicino('movimento vicino ai 20 minuti di cammino reale', t.movimentoSec, 1200, 90, 's');
    ok('trovata almeno una pausa nell\'elenco', t.pause.length >= 1, JSON.stringify(t.pause));
}

console.log('\n--- GPS fermo che DERIVA (rumore), non un cammino lento ---');
{
    // Percorso cumulativo alto (3m ogni 2s per 5 minuti = ~450m, sembrerebbe ~1,5 m/h se
    // letto come distanza/tempo) ma spostamento NETTO quasi zero: e' il caso che la finestra
    // deve distinguere da un cammino vero.
    const { punti } = fermo(3, 300, 2, { t: 0, lng: LNG0, lat: LAT0 });
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    vicino('tutto pausa nonostante il percorso cumulativo alto', t.pausaSec, 300, 60, 's');
    ok('niente scambiato per movimento', t.movimentoSec < 60, `movimentoSec=${t.movimentoSec}`);
}

console.log('\n--- Sosta troppo breve (20s): resta cammino, non e\' una pausa vera ---');
{
    const p1 = camminata(1.2, 300, 2, { t: 0, lng: LNG0, lat: LAT0 });
    const p2 = fermo(3, 20, 2, p1.fine);
    const p3 = camminata(1.2, 300, 2, p2.fine);
    const punti = concat(p1, p2, p3);
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('la sosta di 20s non genera una pausa confermata', t.pausaSec < 60, `pausaSec=${t.pausaSec}`);
}

console.log('\n--- Buco lungo (auto-pause), spostamento netto piccolo: pausa certa ---');
{
    const punti = [
        [LNG0, LAT0, 1000, 0, 0],
        [LNG0 + 0.00003, LAT0, 1000, 20, 0],   // ~2.5m, cammino normale prima del buco
        [LNG0 + 0.00006, LAT0, 1000, 40, 0],
        // buco di 600s (> BUCO_SEC=300), spostamento netto ~5m: l'orologio ha smesso di
        // registrare da fermo, non ha perso il cammino
        [LNG0 + 0.00010, LAT0, 1000, 640, 0],
        [LNG0 + 0.00013, LAT0, 1000, 660, 0],
        [LNG0 + 0.00016, LAT0, 1000, 680, 0]
    ];
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('il buco e\' contato come pausa', t.pausaSec >= 590 && t.pausaSec <= 610, `pausaSec=${t.pausaSec}`);
    ok('niente incerto', t.incertoSec === 0, `incertoSec=${t.incertoSec}`);
}

console.log('\n--- Buco lungo, spostamento netto grande: incerto, non pausa ne\' movimento ---');
{
    const punti = [
        [LNG0, LAT0, 1000, 0, 0],
        [LNG0 + 0.00003, LAT0, 1000, 20, 0],
        [LNG0 + 0.00006, LAT0, 1000, 40, 0],
        // stesso buco di 600s, ma stavolta con 500m di spostamento: segnale perso mentre si
        // continuava a camminare (es. in un canalone), non sappiamo cosa e' successo dentro
        [LNG0 + (500 / mLng), LAT0, 1000, 640, 0],
        [LNG0 + (503 / mLng), LAT0, 1000, 660, 0],
        [LNG0 + (506 / mLng), LAT0, 1000, 680, 0]
    ];
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('il buco finisce in incerto', t.incertoSec >= 590 && t.incertoSec <= 610, `incertoSec=${t.incertoSec}`);
    ok('non contato come pausa', t.pausaSec === 0, `pausaSec=${t.pausaSec}`);
}

console.log('\n--- Campionamento troppo rado: nessun numero, non una stima spacciata per misura ---');
{
    // Un punto ogni 90s (> CAMPIONAMENTO_MEDIO_MAX_SEC=60) per un'ora: 41 punti, oltre il
    // minimo di 30, ma il campionamento da solo basta a rendere la traccia non attendibile.
    const punti = [];
    for (let t = 0, i = 0; t <= 3600; t += 90, i++) {
        punti.push([LNG0 + i * (1.2 * 90 / mLng), LAT0, 1000, t, 0]);
    }
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('NON attendibile', t.attendibile === false);
    ok('il motivo parla del campionamento', t.motivi.some(m => /rado|secondi/.test(m)), JSON.stringify(t.motivi));
}

console.log('\n--- Traccia troppo corta (pochi punti, pochi minuti): nessun numero ---');
{
    const { punti } = camminata(1.2, 45, 5, { t: 0, lng: LNG0, lat: LAT0 });
    const t = tempiTraccia(punti, haversineKm);
    ok('invariante', invariante(t), JSON.stringify(t));
    ok('NON attendibile', t.attendibile === false);
    ok('almeno un motivo scritto', t.motivi.length > 0);
}

console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
process.exit(falliti === 0 ? 0 : 1);
