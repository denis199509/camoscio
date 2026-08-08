// Punto 45 - Abilita (o revoca) il permesso di moderare le segnalazioni sentiero per un
// utente, identificato per username.
//
// Non esiste nessuna interfaccia per assegnare questo permesso (deciso insieme al campo
// stesso, vedi models/User.js): oggi lo ha un solo utente, in futuro se ne aggiungeranno
// altri rilanciando semplicemente questo script con uno username diverso.
//
// Uso:
//   node scripts/set-report-moderator.js <username>            -> abilita
//   node scripts/set-report-moderator.js <username> --revoca   -> revoca
//
// Username case-sensitive (il campo non ha lowercase:true in models/User.js).
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');

const username = process.argv[2];
const revoca = process.argv.includes('--revoca');

(async () => {
    if (!username) {
        console.error('Manca lo username. Uso: node scripts/set-report-moderator.js <username> [--revoca]');
        process.exit(1);
    }

    await connectMongo();

    const utente = await User.findOne({ username });
    if (!utente) {
        console.error(`Nessun utente trovato con username "${username}".`);
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log(`Trovato: ${utente.username} (id ${utente.id}) - canModerateReports attuale: ${utente.canModerateReports || false}`);

    if (revoca) {
        // $unset e mai {canModerateReports: false}: stessa regola di spazio degli altri
        // campi opzionali dello schema (default: undefined, non scrivere "no" esplicito).
        await User.updateOne({ _id: utente._id }, { $unset: { canModerateReports: 1 } });
        console.log(`Permesso REVOCATO a ${utente.username}.`);
    } else {
        await User.updateOne({ _id: utente._id }, { $set: { canModerateReports: true } });
        console.log(`Permesso CONCESSO a ${utente.username}: ora puo' confermare/rifiutare le segnalazioni sentiero.`);
    }

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
