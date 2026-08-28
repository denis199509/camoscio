// Punto 111 - Abilita (o revoca) la ricezione degli avvisi sulle segnalazioni sentiero per
// un utente, identificato per username.
//
// Gli avvisi sono: "un utente ha chiesto la risoluzione di una segnalazione" e "una
// segnalazione e' scaduta". Il destinatario decide se confermare, tenere ancora, rinnovare
// o togliere dalla pagina Moderazione.
//
// NON e' lo stesso di canModerateReports (scripts/set-report-moderator.js): quello dice CHI
// PUO' decidere, questo dice A CHI ARRIVA la notifica. Oggi entrambi solo Denis, ma
// separati apposta (vedi models/User.js e 03-Decisioni-Architetturali.md).
// Nessuna interfaccia: si scrive con questo script.
//
// Uso:
//   node scripts/set-report-alerts.js <username>            -> abilita
//   node scripts/set-report-alerts.js <username> --revoca   -> revoca
//
// Username case-sensitive (il campo non ha lowercase:true in models/User.js).
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');

const username = process.argv[2];
const revoca = process.argv.includes('--revoca');

(async () => {
    if (!username) {
        console.error('Manca lo username. Uso: node scripts/set-report-alerts.js <username> [--revoca]');
        process.exit(1);
    }

    await connectMongo();

    const utente = await User.findOne({ username });
    if (!utente) {
        console.error(`Nessun utente trovato con username "${username}".`);
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log(`Trovato: ${utente.username} (id ${utente.id}) - receivesReportAlerts attuale: ${utente.receivesReportAlerts || false}`);

    if (revoca) {
        // $unset e mai {receivesReportAlerts: false}: stessa regola di spazio degli altri
        // campi opzionali dello schema (default: undefined, non scrivere "no" esplicito).
        await User.updateOne({ _id: utente._id }, { $unset: { receivesReportAlerts: 1 } });
        console.log(`Avvisi segnalazioni REVOCATI a ${utente.username}.`);
    } else {
        await User.updateOne({ _id: utente._id }, { $set: { receivesReportAlerts: true } });
        console.log(`Avvisi segnalazioni ATTIVATI per ${utente.username}: ricevera' le notifiche di risoluzione richiesta e scadenza.`);
    }

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
