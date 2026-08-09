// Riarma lo scherzo di benvenuto per l'username "Damiano" (vedi models/ScherzoDamiano.js e
// routes/auth.js) dopo una prova di Denis - senza questo script, un account di prova
// registrato per provare il messaggio lo consumerebbe per sempre, e l'amico vero non lo
// vedrebbe piu'.
//
// Uso: node scripts/riarma-scherzo-damiano.js
//
// Da lanciare dopo aver provato lo scherzo con un account di prova ed averlo cancellato,
// prima che l'amico vero si registri.
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const ScherzoDamiano = require('../models/ScherzoDamiano');

(async () => {
    await connectMongo();

    await ScherzoDamiano.updateOne(
        { _id: 'benvenuto-damiano' },
        { $set: { usato: false }, $unset: { usatoIl: 1 } },
        { upsert: true }
    );

    console.log('Scherzo "Damiano" riarmato: scattera\' alla prossima registrazione con quell\'username.');
    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
