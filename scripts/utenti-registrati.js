// SOLO LETTURA - elenco delle persone registrate sul sito, in ordine di registrazione.
// Non scrive niente, non cancella niente. Serve a Denis per tenere traccia di quando si
// iscrive la gente; NON e' un dato mostrato sul sito.
//
// La data di registrazione NON e' un campo dello schema (sarebbe un doppione, vincolo
// spazio): si ricava dal _id. Ogni ObjectId di MongoDB porta nei primi 4 byte il
// timestamp di quando il documento e' stato creato, cioe' quando l'utente si e' registrato
// (Mongoose genera il _id in quel momento). Retroattivo per tutti, passati e futuri.
//
// Uso:
//   node scripts/utenti-registrati.js            elenco degli utenti veri
//   node scripts/utenti-registrati.js --demo     include anche i 4 account demo
//   node scripts/utenti-registrati.js --csv      output CSV (data,username,email) da incollare
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');

const CON_DEMO = process.argv.includes('--demo');
const CSV = process.argv.includes('--csv');

// Ora locale italiana, non UTC: il fuso e' esplicito nell'etichetta cosi' non c'e' dubbio.
function dataIt(d) {
    return d.toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

(async () => {
    await connectMongo();

    const utenti = await User.find({}, {
        username: 1, email: 1, isDemoAccount: 1, emailVerified: 1,
        experienceLevel: 1, reputation: 1, completedHikes: 1
    }).lean();

    // Ordine di registrazione = ordine dei _id (il timestamp e' il prefisso dell'ObjectId).
    utenti.sort((a, b) => a._id.getTimestamp() - b._id.getTimestamp());

    const veri = utenti.filter(u => !u.isDemoAccount);
    const demo = utenti.filter(u => u.isDemoAccount);
    const daMostrare = CON_DEMO ? utenti : veri;

    if (CSV) {
        console.log('data_registrazione,username,email,demo,email_confermata,livello,reputazione,escursioni_completate');
        for (const u of daMostrare) {
            const campi = [
                dataIt(u._id.getTimestamp()),
                u.username || '',
                u.email || '',
                u.isDemoAccount ? 'si' : 'no',
                u.isDemoAccount ? '-' : (u.emailVerified ? 'si' : 'no'),
                u.experienceLevel || '',
                u.reputation != null ? u.reputation : '',
                u.completedHikes != null ? u.completedHikes : ''
            ].map(v => {
                const s = String(v);
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            });
            console.log(campi.join(','));
        }
        await mongoose.disconnect();
        return;
    }

    console.log(`\nUtenti registrati sul sito (data ricavata dal _id, ora italiana).`);
    console.log(`Totale: ${utenti.length}  -  ${veri.length} persone reali, ${demo.length} account demo.\n`);

    for (const u of daMostrare) {
        const quando = dataIt(u._id.getTimestamp());
        const note = [];
        if (u.isDemoAccount) note.push('demo');
        else if (!u.emailVerified) note.push('email NON confermata');
        const extra = `${u.experienceLevel || '-'}, rep ${u.reputation != null ? u.reputation : '-'}, ${u.completedHikes || 0} esc.`;
        console.log(
            `${quando}   ${(u.username || '(senza nome)').padEnd(22)}${(u.email || '-').padEnd(34)}${extra.padEnd(30)}`
            + (note.length ? '  <- ' + note.join(', ') : '')
        );
    }

    if (!CON_DEMO && demo.length) {
        console.log(`\n(${demo.length} account demo nascosti: ${demo.map(d => d.username).join(', ')}. Aggiungi --demo per vederli.)`);
    }

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
