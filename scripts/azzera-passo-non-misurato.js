// CONGUAGLIO: toglie averagePaceUp/averagePaceDown agli utenti REALI che non hanno nessuna
// osservazione vera dietro quel numero.
//
// PERCHE' SERVE - fino al 16/08/2026 models/User.js scriveva 350/500 addosso a ogni utente
// nell'istante stesso della registrazione. Sul database quel numero e' indistinguibile da un
// passo misurato per davvero, e la Dashboard lo mostrava come "Velocita' Ascesa: 350 m/h"
// con tanto di grafico a barre piene a un account con zero escursioni (segnalato da Denis su
// un account reale appena registrato). Lo schema ora nasce senza il campo, ma chi si era
// gia' registrato prima se lo porta scritto addosso: quello lo sistema questo script.
//
// CHI NON VIENE MAI TOCCATO:
//  - i 4 account demo del seed (isDemoAccount: true), che hanno un passo assegnato a mano e
//    "completions": [] APPOSTA, per simulare un utente esperto senza inventare una
//    cronologia finta - scelta gia' presa e approvata, vedi 03-Decisioni-Architetturali.md
//    del vault (punto 80/A). Il filtro e' esplicito qui sotto, non affidato all'ordine dei
//    controlli;
//  - chi ha almeno un'osservazione vera: per lui il numero e' una misura, e resta.
//
// COSA CONTA COME "OSSERVAZIONE VERA": non lo decide questo script. Lo chiede a
// recalculatePersonalPace (lib/hikeStats.js), la stessa e unica funzione usata dalle rotte
// online e dallo script di ricalcolo - una seconda definizione qui dentro sarebbe la solita
// matematica duplicata che prima o poi diverge in silenzio (punto 80/A).
//
// E' RILANCIABILE: al secondo giro non trova piu' niente da fare (i campi sono gia' assenti).
//
// Uso: node scripts/azzera-passo-non-misurato.js                 (mostra cosa cambierebbe)
//      node scripts/azzera-passo-non-misurato.js --scrivi         (scrive per davvero)
//      node scripts/azzera-passo-non-misurato.js --solo=Username --scrivi   (un utente solo)
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const { recalculatePersonalPace } = require('../lib/hikeStats');

(async () => {
    await connectMongo();
    const scrivi = process.argv.includes('--scrivi');
    const soloArg = process.argv.find(a => a.startsWith('--solo='));
    const soloUsername = soloArg ? soloArg.slice('--solo='.length) : null;

    const filtro = soloUsername ? { username: soloUsername } : {};
    const utenti = await User.find(filtro).select('username isDemoAccount averagePaceUp averagePaceDown completedHikes');
    if (soloUsername && utenti.length === 0) {
        console.log(`Nessun utente con username "${soloUsername}".`);
        await mongoose.disconnect();
        return;
    }

    let daSvuotare = 0, demoProtetti = 0, conMisura = 0, giaAPosto = 0;

    for (const user of utenti) {
        const haCampo = user.averagePaceUp != null || user.averagePaceDown != null;

        if (user.isDemoAccount) {
            if (haCampo) {
                demoProtetti++;
                console.log(`  [demo, NON toccato] ${user.username}: ${user.averagePaceUp}/${user.averagePaceDown}`);
            }
            continue;
        }

        const { osservazioni } = await recalculatePersonalPace(user._id);
        if (osservazioni.length > 0) {
            conMisura++;
            continue; // il numero e' una misura vera: si tiene
        }
        if (!haCampo) {
            giaAPosto++;
            continue; // gia' senza passo scritto: niente da fare (script rilanciabile)
        }

        daSvuotare++;
        console.log(
            `  [da svuotare] ${user.username}: ${user.averagePaceUp}/${user.averagePaceDown} ` +
            `con 0 osservazioni vere (completedHikes: ${user.completedHikes})`
        );
        if (scrivi) {
            // $unset esplicito, non un documento salvato con i campi a undefined: e'
            // inequivocabile e non dipende da come Mongoose tratta un campo assegnato a
            // undefined (stessa scelta gia' fatta in routes/completions.js per movingTimeHours).
            await User.updateOne({ _id: user._id }, { $unset: { averagePaceUp: '', averagePaceDown: '' } });
        }
    }

    console.log(
        `\n${daSvuotare} utenti reali con un passo senza nessuna prova dietro.` +
        (scrivi ? ' Campo rimosso sul database.' : ' NESSUNA SCRITTURA (rilanciare con --scrivi per applicare davvero).')
    );
    console.log(`(${conMisura} con misure vere lasciati come sono, ${demoProtetti} demo protetti, ${giaAPosto} gia' a posto.)`);
    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
