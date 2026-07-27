// Punto 13 - Riempie il campo "cells" sui sentieri gia' presenti sul database.
//
// Serve una volta sola, per i 24.675 sentieri scaricati prima che il campo esistesse: da
// qui in avanti li scrive gia' scripts/fetch-trails.js. Senza, la ricerca del percorso non
// troverebbe nessun sentiero, perche' interroga proprio per cella.
//
// E' SICURO RILANCIARLO: aggiorna solo i documenti a cui il campo manca, quindi rieseguirlo
// non fa niente. Con --tutti li ricalcola tutti (serve solo se un giorno cambia il PASSO
// della griglia in lib/trailCells.js: in quel caso vanno rifatti TUTTI, altrimenti le celle
// vecchie e quelle nuove non parlano la stessa lingua).
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const Trail = require('../models/Trail');
const { celleDiLinea, PASSO } = require('../lib/trailCells');

const RICALCOLA_TUTTI = process.argv.includes('--tutti');
const LOTTO = 500; // scritture raggruppate: 24.675 update singoli sarebbero minuti di attesa inutile

(async () => {
    await connectMongo();

    const filtro = RICALCOLA_TUTTI ? {} : { cells: { $exists: false } };
    const totale = await Trail.countDocuments(filtro);
    console.log(`Griglia da ${PASSO} gradi. Sentieri da elaborare: ${totale.toLocaleString('it-IT')}${RICALCOLA_TUTTI ? ' (ricalcolo completo)' : ' (solo quelli senza celle)'}`);
    if (totale === 0) {
        console.log('Niente da fare.');
        await mongoose.disconnect();
        return;
    }

    // Cursore e non find() tutto insieme: e' la stessa precauzione di lib/trailIndex.js,
    // dove tenere migliaia di documenti in RAM insieme aveva fatto cadere il sito in Fase G.
    const cursor = Trail.find(filtro, { wayId: 1, coordinates: 1 }).lean().cursor();

    let fatti = 0, senzaCoordinate = 0, celleTotali = 0;
    let operazioni = [];

    const scrivi = async () => {
        if (!operazioni.length) return;
        await Trail.bulkWrite(operazioni, { ordered: false });
        operazioni = [];
    };

    for await (const t of cursor) {
        const celle = celleDiLinea(t.coordinates);
        if (!celle.length) { senzaCoordinate++; continue; }
        celleTotali += celle.length;
        operazioni.push({ updateOne: { filter: { _id: t._id }, update: { $set: { cells: celle } } } });
        fatti++;

        if (operazioni.length >= LOTTO) {
            await scrivi();
            process.stdout.write(`\r  ${fatti.toLocaleString('it-IT')} / ${totale.toLocaleString('it-IT')}`);
        }
    }
    await scrivi();

    console.log(`\r  ${fatti.toLocaleString('it-IT')} / ${totale.toLocaleString('it-IT')} — fatto.`);
    if (senzaCoordinate) console.log(`  ${senzaCoordinate} sentieri saltati perche' senza coordinate valide.`);
    console.log(`  Media di ${(celleTotali / Math.max(1, fatti)).toFixed(1)} celle per sentiero.`);

    const rimasti = await Trail.countDocuments({ cells: { $exists: false } });
    console.log(rimasti === 0
        ? '  Tutti i sentieri hanno le celle.'
        : `  ATTENZIONE: ${rimasti} sentieri sono ancora senza celle.`);

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
