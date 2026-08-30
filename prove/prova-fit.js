// Prova di lib/fit.js: parseFit() (punto 114 - importare una traccia .fit, il formato
// nativo di Garmin, senza passare dal .gpx degradato).
//
// I file .fit di prova sono SINTETICI, costruiti qui con il FitEncoder della stessa
// libreria (fit-file-parser): non tocca database ne' rete, non serve il server acceso.
// Il file vero di Denis (fitprova.fit, Corno Grande) e' servito per la verifica dal
// vivo end-to-end, non e' nel repository perche' e' una sua traccia GPS reale.
//
// Si controlla che parseFit:
//  - restituisca ESATTAMENTE la stessa forma di parseGpx (stesse chiavi), cosi' tutto
//    il codice a valle non sa da che formato viene la traccia;
//  - salti i record senza posizione (GPS non agganciato) senza contarli un errore;
//  - erediti la quota mancante, preferisca enhanced_altitude, tenga solo orari crescenti;
//  - rifiuti (con ErroreFit e un messaggio per l'utente) i file rotti/vuoti/senza orari;
//  - produca punti su cui statisticheTraccia e movimentoSecAttendibile (lib/gpx.js)
//    girano senza modifiche.

const { FitEncoder, FitBaseType } = require('fit-file-parser');
const { parseFit, ErroreFit } = require('../lib/fit');
const { statisticheTraccia, movimentoSecAttendibile } = require('../lib/gpx');
const { haversineKm } = require('../lib/geometry');

let passati = 0, falliti = 0;
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Semicirconferenze: e' cosi' che il .fit salva lat/lon. 2^31 / 180 gradi.
const SC = Math.pow(2, 31) / 180;
const T0 = new Date('2026-08-02T06:00:00Z');

// Costruisce un Buffer .fit da una lista di record.
// Ogni record: { dt, lat, lng, alt, ealt } - dt = secondi dall'inizio; lat/lng/alt/ealt
// facoltativi (omessi = campo non scritto in quel record). Se withoutTimestamp e' true,
// il campo timestamp (253) non viene scritto affatto: serve solo al caso "file senza orari".
function encodeFit(records, opts = {}) {
    const enc = new FitEncoder();
    enc.writeMessage(0, [
        { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },                 // file_id.type = activity
        { number: 4, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(T0) }
    ]);
    for (const r of records) {
        const campi = [];
        if (!opts.withoutTimestamp) {
            campi.push({ number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(T0.getTime() + r.dt * 1000)) });
        }
        if (typeof r.lat === 'number') campi.push({ number: 0, size: 4, baseType: FitBaseType.Sint32, value: Math.round(r.lat * SC) });
        if (typeof r.lng === 'number') campi.push({ number: 1, size: 4, baseType: FitBaseType.Sint32, value: Math.round(r.lng * SC) });
        if (typeof r.alt === 'number') campi.push({ number: 2, size: 2, baseType: FitBaseType.Uint16, value: Math.round((r.alt + 500) * 5) });
        if (typeof r.ealt === 'number') campi.push({ number: 78, size: 4, baseType: FitBaseType.Uint32, value: Math.round((r.ealt + 500) * 5) });
        if (campi.length) enc.writeMessage(20, campi); // record
    }
    return Buffer.from(enc.close());
}

// Una camminata dritta a ~1,1 m/s (4 km/h, il passo CAI in piano) campionata ogni secondo,
// che sale di 1 m ogni 10 s. Punto di partenza: Campo Imperatore, dentro l'Abruzzo.
function camminata(nPunti, opts = {}) {
    const LAT0 = 42.44, LNG0 = 13.55;
    const mPerDegLng = 111320 * Math.cos(LAT0 * Math.PI / 180);
    const passoLng = 1.1 / mPerDegLng; // ~1,1 m a Est per secondo
    const rec = [];
    for (let i = 0; i < nPunti; i++) {
        const r = { dt: i, lat: LAT0, lng: LNG0 + i * passoLng };
        if (!opts.noAlt) {
            if (opts.enhanced) r.ealt = 2000 + i / 10;
            else r.alt = 2000 + i / 10;
        }
        rec.push(r);
    }
    return rec;
}

const CHIAVI_ATTESE = ['punti', 'nome', 'inizio', 'fine', 'durataIgnota', 'tipo', 'avvisi'];

(async () => {
    // --- 1. traccia normale: 1 punto/s, 1200 punti (~20 min), con quota ---
    console.log('\n1. Traccia normale (1200 punti a 1 Hz, con quota)');
    {
        const letto = await parseFit(encodeFit(camminata(1200)));
        ok('stesse chiavi di parseGpx', CHIAVI_ATTESE.every(k => k in letto) && Object.keys(letto).length === CHIAVI_ATTESE.length,
            JSON.stringify(Object.keys(letto)));
        ok('durataIgnota = false', letto.durataIgnota === false);
        ok('tipo = traccia', letto.tipo === 'traccia');
        ok('nome = null (il .fit non porta un nome traccia)', letto.nome === null);
        ok(`~1200 punti (${letto.punti.length})`, Math.abs(letto.punti.length - 1200) <= 1);
        ok('inizio = T0', letto.inizio instanceof Date && letto.inizio.getTime() === T0.getTime());
        ok('fine ~= T0 + 1199 s', Math.abs(letto.fine.getTime() - (T0.getTime() + 1199000)) <= 1000);
        ok('primo punto: [lng, lat, quota, sec=0, prec=0]',
            letto.punti[0].length === 5 && letto.punti[0][3] === 0 && letto.punti[0][4] === 0 &&
            Math.abs(letto.punti[0][1] - 42.44) < 1e-4 && Math.abs(letto.punti[0][2] - 2000) <= 1);
        ok('secondi da inizio strettamente crescenti',
            letto.punti.every((p, i) => i === 0 || p[3] > letto.punti[i - 1][3]));
        ok('nessun avviso su un file pulito', letto.avvisi.length === 0, JSON.stringify(letto.avvisi));

        // statisticheTraccia e movimentoSecAttendibile devono girare sui punti di parseFit
        // esattamente come su quelli di parseGpx.
        const st = statisticheTraccia(letto.punti, 10, haversineKm);
        ok(`distanza ~1,32 km (${st.distanzaKm})`, Math.abs(st.distanzaKm - 1.32) < 0.15);
        ok(`dislivello ~120 m (${st.dislivelloM})`, Math.abs(st.dislivelloM - 120) <= 20);
        const mov = movimentoSecAttendibile(letto.punti, haversineKm);
        ok(`movimento misurato (${mov.sec} s) - traccia fitta a 1 Hz, split affidabile`,
            mov.sec > 900 && mov.sec <= 1200, JSON.stringify(mov));
    }

    // --- 2. GPS non ancora agganciato: primi 8 record senza posizione ---
    console.log('\n2. Primi 8 record senza posizione (GPS in aggancio)');
    {
        const rec = camminata(200);
        for (let i = 0; i < 8; i++) { delete rec[i].lat; delete rec[i].lng; }
        const letto = await parseFit(encodeFit(rec));
        ok(`192 punti (200 - 8 saltati) -> ${letto.punti.length}`, letto.punti.length === 192);
        ok('nessun avviso: i record senza GPS sono strutturalmente normali nel .fit',
            letto.avvisi.length === 0, JSON.stringify(letto.avvisi));
        // I secondi partono dal primo punto CON posizione (come parseGpx: inizioMs =
        // primo punto con orario), quindi il primo punto tenuto e' comunque a sec 0.
        ok('il primo punto tenuto e\' a sec 0', letto.punti[0][3] === 0);
        ok('inizio spostato a T0 + 8 s (primo GPS valido)',
            letto.inizio.getTime() === T0.getTime() + 8000, letto.inizio.toISOString());
        ok('la traccia dura ~191 s (199 - 8)', letto.punti[letto.punti.length - 1][3] === 191);
    }

    // --- 3. nessuna quota in tutto il file ---
    console.log('\n3. File senza altitudini');
    {
        const letto = await parseFit(encodeFit(camminata(120, { noAlt: true })));
        ok('avviso "non contiene le altitudini"', letto.avvisi.some(a => /altitudini/i.test(a)), JSON.stringify(letto.avvisi));
        ok('tutte le quote a 0', letto.punti.every(p => p[2] === 0));
        const st = statisticheTraccia(letto.punti, 10, haversineKm);
        ok('quotaMaxM = 0 (non null: la quota c\'e\', vale 0)', st.quotaMaxM === 0, String(st.quotaMaxM));
    }

    // --- 4. enhanced_altitude preferito quando c'e' ---
    console.log('\n4. enhanced_altitude preferito su altitude');
    {
        // enhanced parte da 2000 e sale; se venisse letto altitude (assente) le quote sarebbero 0.
        const letto = await parseFit(encodeFit(camminata(60, { enhanced: true })));
        ok('quota iniziale ~2000 (letta da enhanced_altitude)', Math.abs(letto.punti[0][2] - 2000) <= 1, String(letto.punti[0][2]));
        ok('la quota sale lungo la traccia', letto.punti[letto.punti.length - 1][2] > letto.punti[0][2]);
    }

    // --- 5. orari non crescenti in mezzo alla traccia ---
    console.log('\n5. Record con orario non crescente');
    {
        const rec = camminata(100);
        rec[50].dt = 20;   // torna indietro nel tempo
        rec[51].dt = 20;   // stesso istante di un altro
        const letto = await parseFit(encodeFit(rec));
        ok('i 2 punti fuori ordine sono stati scartati', letto.punti.length === 98, String(letto.punti.length));
        ok('avviso "orario non crescente"', letto.avvisi.some(a => /non crescente/i.test(a)), JSON.stringify(letto.avvisi));
        ok('secondi ancora strettamente crescenti dopo lo scarto',
            letto.punti.every((p, i) => i === 0 || p[3] > letto.punti[i - 1][3]));
    }

    // --- 6. file rotto / non .fit ---
    console.log('\n6. Buffer che non e\' un .fit');
    {
        let errore = null;
        try { await parseFit(Buffer.from('questo non e\' affatto un file fit, e\' solo testo')); }
        catch (e) { errore = e; }
        ok('lancia ErroreFit', errore instanceof ErroreFit, errore && errore.name);
        ok('flag .utente = true (messaggio mostrabile)', errore && errore.utente === true);
        ok('messaggio parla di file .fit non valido', errore && /non sembra un file \.fit/i.test(errore.message), errore && errore.message);
    }

    // --- 7. buffer vuoto ---
    console.log('\n7. Buffer vuoto');
    {
        let errore = null;
        try { await parseFit(Buffer.alloc(0)); } catch (e) { errore = e; }
        ok('lancia ErroreFit "Il file e\' vuoto"', errore instanceof ErroreFit && /vuoto/i.test(errore.message), errore && errore.message);
    }

    // --- 8. una sola posizione valida ---
    console.log('\n8. Un solo record con posizione');
    {
        const rec = camminata(30);
        for (let i = 1; i < rec.length; i++) { delete rec[i].lat; delete rec[i].lng; }
        let errore = null;
        try { await parseFit(encodeFit(rec)); } catch (e) { errore = e; }
        ok('lancia ErroreFit', errore instanceof ErroreFit, errore && errore.message);
        ok('il messaggio dice i numeri (30 record, 1 con posizione)',
            errore && /30/.test(errore.message) && /1 con/i.test(errore.message), errore && errore.message);
    }

    // --- 9. record senza nessun timestamp ---
    console.log('\n9. Record senza orario');
    {
        let errore = null;
        try { await parseFit(encodeFit(camminata(50), { withoutTimestamp: true })); } catch (e) { errore = e; }
        ok('lancia ErroreFit "non hanno un orario leggibile"',
            errore instanceof ErroreFit && /orario leggibile/i.test(errore.message), errore && errore.message);
    }

    console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
    process.exit(falliti === 0 ? 0 : 1);
})().catch(e => { console.error('ERRORE NON GESTITO NELLA PROVA:', e); process.exit(1); });
