// Migrazione del punto 111: dalla scadenza-per-cancellazione (indice TTL su Report.createdAt)
// alla scadenza-per-decisione (campo Report.expiresAt spostabile).
//
// COSA FA, in quest'ordine (non invertibile):
//   1. legge e stampa lo stato (documenti, quanti senza expiresAt, indici createdAt_1 /
//      expiresAt_1);
//   2. BACKFILL: expiresAt = createdAt + 90 giorni sui documenti che non ce l'hanno.
//      E' esattamente la data in cui il vecchio TTL li avrebbe cancellati: nessun salto di
//      comportamento;
//   3. verifica di sicurezza: se resta anche un solo documento senza expiresAt, SI FERMA e
//      NON tocca gli indici (un documento senza expiresAt e' invisibile al controllo
//      scadenze e al paracadute: immortale in silenzio);
//   4. crea l'indice paracadute expiresAt_1 (TTL a 365 giorni - vedi sotto);
//   5. POI droppa createdAt_1. Creare-prima-cancellare-dopo tiene sempre >= 1 paracadute.
//
// PARACADUTE a 365 giorni, su expiresAt e NON su createdAt: si sposta insieme ai rinnovi
// ("Rinnova +90gg"), mentre un TTL su createdAt ucciderebbe comunque una segnalazione
// rinnovata piu' volte. Cancella solo cio' che nessuno tocca per un anno INTERO dopo la
// scadenza - e' l'unico limite alla crescita della collezione reports (le foto pesano,
// vincolo hard 1). Su questo Atlas si fa dropIndex + createIndex, mai collMod (negato).
//
// PRIMA DI LANCIARLO CON --scrivi: il deploy che RIMUOVE la riga
// `reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: ... })` da models/Report.js
// deve essere GIA' in produzione. Con autoIndex attivo (nessun syncIndexes nel progetto),
// se quella riga c'e' ancora il primo riavvio di Render ricrea createdAt_1 sopra questo
// lavoro, in silenzio.
//
// Uso:
//   node scripts/scadenza-segnalazioni-esplicita.js            dry-run: mostra cosa farebbe
//   node scripts/scadenza-segnalazioni-esplicita.js --scrivi   applica davvero
// Idempotente: rilanciato dopo, riconosce che e' gia' fatto e non fa nulla.

require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');

const GIORNI = 90;
const MS_90_GIORNI = GIORNI * 24 * 60 * 60 * 1000;
const PARACADUTE_SECONDI = 365 * 24 * 60 * 60;

function fmtIndice(idx) {
    if (!idx) return '(assente)';
    const ttl = typeof idx.expireAfterSeconds === 'number'
        ? `  TTL ${idx.expireAfterSeconds}s (${(idx.expireAfterSeconds / 86400).toFixed(0)} giorni)`
        : '';
    return `${idx.name}  key=${JSON.stringify(idx.key)}${ttl}`;
}

(async () => {
    await connectMongo();
    const scrivi = process.argv.includes('--scrivi');
    const coll = mongoose.connection.db.collection('reports');

    // --- 1. Stato di partenza ---
    const totale = await coll.countDocuments({});
    const senzaExpiresAt = await coll.countDocuments({ expiresAt: { $exists: false } });
    let indici = await coll.indexes();
    const idxCreatedAt = indici.find(i => i.name === 'createdAt_1');
    const idxExpiresAt = indici.find(i => i.name === 'expiresAt_1');

    console.log('=== PRIMA ===');
    console.log(`Segnalazioni totali        : ${totale}`);
    console.log(`Senza campo expiresAt      : ${senzaExpiresAt}`);
    console.log(`Indice createdAt_1         : ${fmtIndice(idxCreatedAt)}`);
    console.log(`Indice expiresAt_1         : ${fmtIndice(idxExpiresAt)}`);

    const backfillFatto = senzaExpiresAt === 0;
    const indiciAPosto = !idxCreatedAt && idxExpiresAt && idxExpiresAt.expireAfterSeconds === PARACADUTE_SECONDI;
    if (backfillFatto && indiciAPosto) {
        console.log('\nGia\' migrato: nessun documento senza expiresAt, createdAt_1 assente, expiresAt_1 a 365 giorni. Niente da fare.');
        await mongoose.disconnect();
        return;
    }

    // --- Anteprima di cosa cambierebbe ---
    console.log('\n=== COSA FAREBBE ===');
    console.log(`1) BACKFILL: expiresAt = createdAt + ${GIORNI} giorni su ${senzaExpiresAt} documenti`);
    if (senzaExpiresAt > 0) {
        const esempi = await coll.find({ expiresAt: { $exists: false } })
            .project({ createdAt: 1, status: 1, type: 1 }).limit(5).toArray();
        for (const d of esempi) {
            const scad = new Date(new Date(d.createdAt).getTime() + MS_90_GIORNI);
            console.log(`     ${d._id}  ${d.type}/${d.status}  creata ${new Date(d.createdAt).toISOString().slice(0, 10)}  ->  scade ${scad.toISOString().slice(0, 10)}`);
        }
        if (senzaExpiresAt > 5) console.log(`     ... e altri ${senzaExpiresAt - 5}`);
    }
    console.log(`2) crea indice expiresAt_1 con TTL a ${PARACADUTE_SECONDI}s (365 giorni) ${idxExpiresAt ? '[gia\' presente]' : ''}`);
    console.log(`3) droppa indice createdAt_1 ${idxCreatedAt ? '' : '[gia\' assente]'}`);

    if (!scrivi) {
        console.log('\n--- DRY-RUN: nessuna scrittura. Rilanciare con --scrivi per applicare. ---');
        console.log('Ricorda: il deploy che rimuove la riga reportSchema.index({createdAt:1},...) deve essere gia\' in produzione.');
        await mongoose.disconnect();
        return;
    }

    // --- 2. Backfill ---
    console.log('\n=== APPLICO ===');
    if (senzaExpiresAt > 0) {
        const r = await coll.updateMany(
            { expiresAt: { $exists: false } },
            [{ $set: { expiresAt: { $add: ['$createdAt', MS_90_GIORNI] } } }]
        );
        console.log(`1) backfill: ${r.modifiedCount} documenti aggiornati`);
    } else {
        console.log('1) backfill: niente da fare (0 documenti senza expiresAt)');
    }

    // --- 3. Verifica di sicurezza: nessun documento deve restare senza expiresAt ---
    const rimasti = await coll.countDocuments({ expiresAt: { $exists: false } });
    if (rimasti !== 0) {
        console.error(`\nSTOP: ${rimasti} documenti ancora senza expiresAt dopo il backfill. NON tocco gli indici.`);
        console.error('Un documento senza expiresAt sarebbe invisibile al controllo scadenze e al paracadute. Indagare a mano.');
        await mongoose.disconnect();
        process.exit(1);
    }
    console.log('2) verifica: 0 documenti senza expiresAt, ok');

    // --- 4. Crea il paracadute expiresAt_1 (prima di droppare l'altro) ---
    await coll.createIndex({ expiresAt: 1 }, { name: 'expiresAt_1', expireAfterSeconds: PARACADUTE_SECONDI });
    console.log('3) indice expiresAt_1 creato (o gia\' presente identico)');

    // --- 5. POI droppa createdAt_1 ---
    if (idxCreatedAt) {
        try {
            await coll.dropIndex('createdAt_1');
            console.log('4) indice createdAt_1 droppato');
        } catch (e) {
            if (e.codeName === 'IndexNotFound' || /index not found/i.test(e.message)) {
                console.log('4) indice createdAt_1 gia\' assente');
            } else {
                throw e;
            }
        }
    } else {
        console.log('4) indice createdAt_1 gia\' assente');
    }

    // --- 6. Stato finale ---
    indici = await coll.indexes();
    console.log('\n=== DOPO ===');
    console.log(`Senza campo expiresAt      : ${await coll.countDocuments({ expiresAt: { $exists: false } })}`);
    console.log(`Indice createdAt_1         : ${fmtIndice(indici.find(i => i.name === 'createdAt_1'))}`);
    console.log(`Indice expiresAt_1         : ${fmtIndice(indici.find(i => i.name === 'expiresAt_1'))}`);

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
