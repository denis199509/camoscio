// Migrazione una tantum (28/08/2026): porta la scadenza automatica delle segnalazioni
// sentiero (Report) da 30 a 90 giorni. Vedi il commento in models/Report.js.
//
// PERCHE' SERVE UNO SCRIPT: cambiare expireAfterSeconds nello schema non ha effetto su un
// indice TTL gia' creato - al riavvio Mongoose prova a ricrearlo, Atlas risponde
// IndexOptionsConflict e tiene la soglia vecchia, in silenzio.
//
// Il modo pulito sarebbe `collMod` (cambia la soglia sul posto, senza toccare l'indice), ma
// sul nostro utente Atlas quell'azione e' negata (non e' nel ruolo readWrite). Ripiego:
// dropIndex + createIndex, che sono nel ruolo. Per i pochi secondi fra i due comandi il TTL
// non e' applicato - irrilevante: la collezione ha una manciata di documenti recenti, e al
// massimo uno gia' scaduto sopravvivrebbe qualche secondo in piu'.
//
// Le segnalazioni gia' presenti non vengono cancellate: con la soglia nuova quelle piu'
// giovani di 90 giorni restano, spariranno a 90 giorni dalla loro createdAt.
//
// Uso: node scripts/allunga-ttl-segnalazioni.js            (mostra prima/dopo, chiede --scrivi)
//      node scripts/allunga-ttl-segnalazioni.js --scrivi   (applica davvero)
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');

const NUOVI_SECONDI = 90 * 24 * 60 * 60; // 7.776.000
const NOME_INDICE = 'createdAt_1';

(async () => {
    await connectMongo();
    const scrivi = process.argv.includes('--scrivi');
    const coll = mongoose.connection.db.collection('reports');

    const prima = (await coll.indexes()).find(i => i.name === NOME_INDICE);
    if (!prima) {
        console.log(`Indice "${NOME_INDICE}" non trovato sulla collezione "reports". Niente da fare.`);
        await mongoose.disconnect();
        return;
    }
    console.log(`PRIMA: ${NOME_INDICE} expireAfterSeconds = ${prima.expireAfterSeconds} (${prima.expireAfterSeconds / 86400} giorni)`);
    console.log(`Segnalazioni presenti: ${await coll.countDocuments({})}`);

    if (prima.expireAfterSeconds === NUOVI_SECONDI) {
        console.log('Gia\' a 90 giorni, nessuna modifica necessaria.');
        await mongoose.disconnect();
        return;
    }

    if (!scrivi) {
        console.log(`\nDOPO (previsto): expireAfterSeconds = ${NUOVI_SECONDI} (90 giorni)`);
        console.log('NESSUNA SCRITTURA. Rilanciare con --scrivi per applicare.');
        await mongoose.disconnect();
        return;
    }

    await coll.dropIndex(NOME_INDICE);
    console.log(`Indice "${NOME_INDICE}" eliminato. Ricreo con soglia a 90 giorni...`);
    await coll.createIndex({ createdAt: 1 }, { name: NOME_INDICE, expireAfterSeconds: NUOVI_SECONDI });

    const dopo = (await coll.indexes()).find(i => i.name === NOME_INDICE);
    console.log(`\nDOPO: ${NOME_INDICE} expireAfterSeconds = ${dopo.expireAfterSeconds} (${dopo.expireAfterSeconds / 86400} giorni)`);
    console.log(dopo.expireAfterSeconds === NUOVI_SECONDI ? 'OK, applicato.' : 'ATTENZIONE: valore inatteso, controllare a mano.');

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
