// MEDIO-2 della revisione 35a: verifica UNA TANTUM che l'indice TTL su `notifications`
// esista DAVVERO su Atlas.
//
// Il rischio: `models/Notification.js` dichiara notificationSchema.index({createdAt:1},
// {expireAfterSeconds: 90gg}). Con autoIndex, Mongoose prova a crearlo all'avvio - ma se su
// `notifications` esistesse gia' un `createdAt_1` SEMPLICE (senza TTL), createIndex
// risponderebbe IndexOptionsConflict (85) e Mongoose lo INGHIOTTE: il TTL non esiste, e il
// commento in lib/accountDeletion.js ("il TTL le fa scadere") diventa una promessa falsa.
//
// SOLO LETTURA: stampa gli indici e basta. Se il TTL manca o ha la soglia sbagliata, la
// riparazione e' dropIndex('createdAt_1') + createIndex(... expireAfterSeconds ...), MAI
// collMod (negato sull'utente Atlas del progetto - vedi allunga-ttl-segnalazioni.js e
// ../camoscio memoria/07-Trappole-Tecniche.md). Quella e' un'azione manuale di Denis.
//
// Uso: node scripts/verifica-indici-notifiche.js

require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');

const ATTESI_SECONDI = 90 * 24 * 60 * 60; // 7.776.000

(async () => {
    await connectMongo();
    const coll = mongoose.connection.db.collection('notifications');

    const indici = await coll.indexes();
    console.log(`Collezione "notifications" - ${await coll.countDocuments({})} documenti\n`);
    console.log('Indici presenti:');
    for (const i of indici) {
        const ttl = (i.expireAfterSeconds !== undefined)
            ? `  [TTL ${i.expireAfterSeconds}s = ${i.expireAfterSeconds / 86400} giorni]`
            : '';
        console.log(`  - ${i.name}: ${JSON.stringify(i.key)}${ttl}`);
    }

    const suCreatedAt = indici.find(i => i.name === 'createdAt_1');
    console.log('\n--- Esito MEDIO-2 ---');
    if (!suCreatedAt) {
        console.log('NON c\'e\' nessun indice createdAt_1. Il TTL delle notifiche NON e\' attivo.');
        console.log('-> il commento in lib/accountDeletion.js e models/Notification.js e\' una promessa non mantenuta.');
        console.log('-> riparazione: avviare il server con autoIndex (crea l\'indice), oppure createIndex a mano.');
    } else if (suCreatedAt.expireAfterSeconds === undefined) {
        console.log('C\'e\' createdAt_1 ma SENZA expireAfterSeconds: e\' un indice semplice, il TTL non c\'e\'.');
        console.log('-> Mongoose non puo\' aggiungerci il TTL (IndexOptionsConflict, inghiottito).');
        console.log(`-> riparazione MANUALE: coll.dropIndex('createdAt_1'); coll.createIndex({createdAt:1},{expireAfterSeconds:${ATTESI_SECONDI}})`);
    } else if (suCreatedAt.expireAfterSeconds !== ATTESI_SECONDI) {
        console.log(`C'e' il TTL ma a ${suCreatedAt.expireAfterSeconds}s (${suCreatedAt.expireAfterSeconds / 86400} giorni), attesi ${ATTESI_SECONDI}s (90).`);
        console.log('-> riparazione MANUALE: dropIndex + createIndex con la soglia giusta.');
    } else {
        console.log('OK: createdAt_1 esiste con expireAfterSeconds = 7776000 (90 giorni). Il TTL e\' attivo.');
    }

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
