// Ricalcola da zero averagePaceUp/averagePaceDown di ogni utente con almeno un
// completamento con tempo - punto 79. Serve perche' prima di oggi il passo personale si
// costruiva SEMPRE sul tempo totale (pause comprese): chi aveva gia' completato
// un'escursione con un tempo reale porta un valore contaminato dalle sue stesse pause, e
// da solo si correggerebbe solo pian piano, con le prossime escursioni. Denis ha scelto
// invece la correzione immediata (pochi utenti reali, costo quasi nullo).
//
// La matematica vera e propria (RICOSTRUZIONE COMPLETA, MAI INCREMENTALE - rilanciare lo
// script due volte da' lo stesso risultato) vive in lib/hikeStats.js, recalculatePersonalPace:
// punto 80/A, estratta da qui perche' ora la stessa ricostruzione serve anche online, dalle
// rotte che aggiungono o tolgono un .gpx da un Completion gia' esistente
// (routes/completions.js) - un'unica matematica, per non rischiare che le due copie
// divergano in silenzio.
//
// QUESTO SCRIPT NON SCRIVE MAI SU UN UTENTE CON ZERO OSSERVAZIONI: a differenza delle rotte
// online, dove "zero osservazioni" per un utente vero significa davvero "nessuna prova sul
// passo, il campo va tolto", qui significherebbe anche cancellare il passo degli utenti demo
// del seed (scripts/seed-data.json), che hanno un passo assegnato a mano e "completions": []
// apposta - senza prove ma con un valore voluto. recalculatePersonalPace in quel caso torna
// null (dal 16/08/2026, non piu' 350/500): e' compito del chiamante, non della funzione
// condivisa, decidere se applicarlo.
//
// PER SVUOTARE il passo di chi non ha nessuna osservazione dietro c'e' uno script apposta,
// scripts/azzera-passo-non-misurato.js (conguaglio una tantum degli account registrati
// quando lo schema scriveva 350/500 a tutti): due lavori diversi, due script diversi, cosi'
// un --scrivi dato per sbaglio qui non puo' cancellare niente.
//
// Uso: node scripts/ricalcola-passo-personale.js                  (mostra cosa cambierebbe, tutti)
//      node scripts/ricalcola-passo-personale.js --scrivi          (scrive per davvero, tutti)
//      node scripts/ricalcola-passo-personale.js --solo=Username --scrivi   (un utente alla volta,
//        utile per provare prima su un account demo)
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const { recalculatePersonalPace } = require('../lib/hikeStats');

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
        const { osservazioni, nuovoPaceUp, nuovoPaceDown } = await recalculatePersonalPace(user._id);
        if (osservazioni.length === 0) continue; // nessun completamento con un tempo utilizzabile: resta com'e' (vedi nota sopra)

        const cambiato = nuovoPaceUp !== user.averagePaceUp || nuovoPaceDown !== user.averagePaceDown;
        const conMovimento = osservazioni.filter(o => o.conMovimento).length;
        const passoOggi = (user.averagePaceUp == null) ? 'non misurato' : `${user.averagePaceUp}/${user.averagePaceDown}`;
        console.log(
            `${user.username}: ${osservazioni.length} osservazioni (${conMovimento} con tempo di solo cammino) — ` +
            `passo ${passoOggi} -> ${nuovoPaceUp}/${nuovoPaceDown}` +
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
