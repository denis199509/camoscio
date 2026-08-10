// Ricalcola da zero averagePaceUp/averagePaceDown di ogni utente con almeno un
// completamento con tempo - punto 79. Serve perche' prima di oggi il passo personale si
// costruiva SEMPRE sul tempo totale (pause comprese): chi aveva gia' completato
// un'escursione con un tempo reale porta un valore contaminato dalle sue stesse pause, e
// da solo si correggerebbe solo pian piano, con le prossime escursioni. Denis ha scelto
// invece la correzione immediata (pochi utenti reali, costo quasi nullo).
//
// RICOSTRUZIONE COMPLETA, MAI INCREMENTALE: rilanciare lo script due volte da' lo stesso
// risultato (idempotente) - non applica correzioni sopra correzioni, ricalcola da capo
// ogni volta usando solo i Completion esistenti sul database.
//
// La media e' equivalente, punto per punto, a quello che applyHikeCompletionStats
// (lib/hikeStats.js) avrebbe prodotto applicando i completamenti in ordine, PARTENDO DAI
// VALORI DI DEFAULT dello schema (350/500): la media incrementale che quella funzione usa
// converge alla media aritmetica semplice delle osservazioni, indipendentemente
// dall'ordine - dimostrabile per induzione sulla stessa formula. averagePaceDown non ha una
// sua osservazione diretta (il sito non la misura mai da sola): resta esattamente il valore
// di default riscalato nella stessa proporzione con cui e' cambiato averagePaceUp - identica
// alla catena di riscalature che applyHikeCompletionStats fa una alla volta.
//
// Uso: node scripts/ricalcola-passo-personale.js                  (mostra cosa cambierebbe, tutti)
//      node scripts/ricalcola-passo-personale.js --scrivi          (scrive per davvero, tutti)
//      node scripts/ricalcola-passo-personale.js --solo=Username --scrivi   (un utente alla volta,
//        utile per provare prima su un account demo)
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const Completion = require('../models/Completion');
const Hike = require('../models/Hike');

const DEFAULT_PACE_UP = 350;
const DEFAULT_PACE_DOWN = 500;

(async () => {
    await connectMongo();
    const scrivi = process.argv.includes('--scrivi');
    const soloArg = process.argv.find(a => a.startsWith('--solo='));
    const soloUsername = soloArg ? soloArg.slice('--solo='.length) : null;

    const utenti = soloUsername ? await User.find({ username: soloUsername }) : await User.find({});
    if (soloUsername && utenti.length === 0) {
        console.log(`Nessun utente con username "${soloUsername}".`);
        await mongoose.disconnect();
        return;
    }
    let toccati = 0;

    for (const user of utenti) {
        const completamenti = await Completion.find({ userId: user._id });
        if (completamenti.length === 0) continue;

        const osservazioni = [];
        for (const c of completamenti) {
            const oreEffettive = (c.movingTimeHours && c.movingTimeHours > 0) ? c.movingTimeHours
                : (c.actualTimeHours && c.actualTimeHours > 0) ? c.actualTimeHours : null;
            if (!oreEffettive) continue;

            const hike = await Hike.findById(c.hikeId).select('elevationGain title');
            if (!hike) continue; // escursione cancellata nel frattempo: non c'e' piu' un dislivello a cui riferirsi

            osservazioni.push({
                paceUp: hike.elevationGain / oreEffettive,
                conMovimento: !!(c.movingTimeHours && c.movingTimeHours > 0)
            });
        }

        if (osservazioni.length === 0) continue; // nessun completamento con un tempo utilizzabile: resta com'e'

        const nuovoPaceUp = Math.round(osservazioni.reduce((s, o) => s + o.paceUp, 0) / osservazioni.length);
        const nuovoPaceDown = Math.round(DEFAULT_PACE_DOWN * (nuovoPaceUp / DEFAULT_PACE_UP));

        const cambiato = nuovoPaceUp !== user.averagePaceUp || nuovoPaceDown !== user.averagePaceDown;
        const conMovimento = osservazioni.filter(o => o.conMovimento).length;
        console.log(
            `${user.username}: ${osservazioni.length} osservazioni (${conMovimento} con tempo di solo cammino) — ` +
            `passo ${user.averagePaceUp}/${user.averagePaceDown} -> ${nuovoPaceUp}/${nuovoPaceDown}` +
            (cambiato ? '' : '  (invariato)')
        );

        if (cambiato) {
            toccati++;
            if (scrivi) {
                await User.updateOne({ _id: user._id }, { averagePaceUp: nuovoPaceUp, averagePaceDown: nuovoPaceDown });
            }
        }
    }

    console.log(`\n${toccati} utenti con un passo da correggere.` + (scrivi ? ' Scritto sul database.' : ' NESSUNA SCRITTURA (rilanciare con --scrivi per applicare davvero).'));
    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
