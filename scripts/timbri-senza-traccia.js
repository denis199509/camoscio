// SOLO LETTURA per default - diagnostica del punto 108.
//
// Elenca i timbri (Stamp) di un utente distinguendo quelli che hanno DIETRO una traccia
// reale (ActiveHikeSession, registrata o importata da .gpx) passata entro SOGLIA_TIMBRO_M
// dalla vetta, da quelli SENZA: questi ultimi sono i timbri "farmabili col teletrasporto
// GPS" - presi cliccando "TIMBRA" da fermi, prima che routes/stamps.js verificasse
// (vedi cose_da_fare.txt punto 108).
//
// Default: utente "Denis". Cambiabile con --utente=Username.
//
// USO IN DUE TEMPI (deciso da Denis: cancellazione mirata su lista confermata a mano):
//   1) node scripts/timbri-senza-traccia.js
//        elenca e basta, non tocca niente.
//   2) node scripts/timbri-senza-traccia.js --scrivi --stamp=badge_x,badge_y
//        cancella SOLO i timbri badge_x, badge_y di quell'utente (deleteMany filtrato per
//        userId E per stampId). --scrivi senza --stamp non fa niente. Un id che il primo
//        passaggio classifica "con traccia" viene RIFIUTATO, a meno di --forza.
//
// La classificazione e' una fotografia di adesso: se in futuro l'utente importa il .gpx
// di quella salita, il timbro si riprende da solo (assegnaTimbriDallaTraccia).
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const Stamp = require('../models/Stamp');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const { SOGLIA_TIMBRO_M, puntiTimbrabili, distanzaMinimaDaTraccia } = require('../lib/geofenceTimbri');

const argUtente = process.argv.find(a => a.startsWith('--utente='));
const USERNAME = argUtente ? argUtente.slice('--utente='.length) : 'Denis';
const SCRIVI = process.argv.includes('--scrivi');
const FORZA = process.argv.includes('--forza');
const argStamp = process.argv.find(a => a.startsWith('--stamp='));
const STAMP_RICHIESTI = argStamp
    ? argStamp.slice('--stamp='.length).split(',').map(s => s.trim()).filter(Boolean)
    : [];

function descriviSessione(s) {
    if (!s) return '-';
    const quando = s.startedAt ? new Date(s.startedAt).toISOString().slice(0, 10) : s._id.getTimestamp().toISOString().slice(0, 10);
    const tipo = s.importedFrom === 'gpx' ? `.gpx "${s.importedName || 'senza nome'}"` : 'registrata dal vivo';
    return `${tipo}, ${quando}, ${(s.points || []).length} punti`;
}

(async () => {
    await connectMongo();

    const user = await User.findOne({ username: USERNAME });
    if (!user) {
        console.log(`Nessun utente con username "${USERNAME}".`);
        await mongoose.disconnect();
        return;
    }
    console.log(`Utente: ${user.username}  (_id ${user._id})${user.isDemoAccount ? '  [DEMO]' : ''}\n`);

    const [timbri, sessioni, catalogo] = await Promise.all([
        Stamp.find({ userId: user._id }).lean(),
        ActiveHikeSession.find({ userId: user._id })
            .select('points importedFrom importedName startedAt status').lean(),
        puntiTimbrabili()
    ]);
    const perId = new Map(catalogo.map(p => [p.stampId, p]));
    console.log(`${timbri.length} timbri, ${sessioni.length} tracce (registrate o importate), soglia ${SOGLIA_TIMBRO_M} m.\n`);

    const conTraccia = [], senzaTraccia = [], fuoriCatalogo = [];
    for (const t of timbri) {
        const punto = perId.get(t.stampId);
        if (!punto) { fuoriCatalogo.push({ stampId: t.stampId, data: t.dateUnlocked }); continue; }
        let minM = Infinity, sessVicina = null;
        for (const s of sessioni) {
            const d = distanzaMinimaDaTraccia(s.points, punto.lat, punto.lng);
            if (d < minM) { minM = d; sessVicina = s; }
        }
        const rec = { stampId: t.stampId, nome: punto.nome, data: t.dateUnlocked, minM, sessVicina };
        (minM <= SOGLIA_TIMBRO_M ? conTraccia : senzaTraccia).push(rec);
    }

    const dist = m => (m === Infinity ? 'nessuna traccia' : `${Math.round(m)} m`);

    console.log(`=== CON TRACCIA (${conTraccia.length}) ===`);
    for (const r of conTraccia) {
        console.log(`  ${r.stampId.padEnd(24)} ${r.nome}  (timbro ${r.data})`);
        console.log(`      a ${dist(r.minM)} dalla vetta  <-  ${descriviSessione(r.sessVicina)}`);
    }

    console.log(`\n=== SENZA TRACCIA (${senzaTraccia.length})  <<< farmabili col teletrasporto ===`);
    for (const r of senzaTraccia) {
        console.log(`  ${r.stampId.padEnd(24)} ${r.nome}  (timbro ${r.data})`);
        console.log(`      traccia piu' vicina: ${dist(r.minM)}`);
    }

    if (fuoriCatalogo.length) {
        console.log(`\n=== FUORI CATALOGO (${fuoriCatalogo.length}) ===`);
        console.log("  stampId non piu' presenti nel catalogo (badge rinominato/rimosso?). Da valutare a parte, NON inclusi qui sotto.");
        for (const r of fuoriCatalogo) console.log(`  ${r.stampId.padEnd(24)} (timbro ${r.data})`);
    }

    // ---- Cancellazione (solo con --scrivi --stamp=...) ----
    if (!SCRIVI) {
        console.log('\n--- NESSUNA SCRITTURA (diagnostica) ---');
        if (senzaTraccia.length) {
            console.log('Per cancellare quelli senza traccia, dopo aver confermato la lista:');
            console.log(`  node scripts/timbri-senza-traccia.js --utente=${user.username} --scrivi --stamp=${senzaTraccia.map(r => r.stampId).join(',')}`);
        } else {
            console.log('Nessun timbro senza traccia: niente da cancellare.');
        }
        await mongoose.disconnect();
        return;
    }

    if (!STAMP_RICHIESTI.length) {
        console.log('\n--scrivi richiede --stamp=id1,id2,... con la lista confermata. Niente e\' stato cancellato.');
        await mongoose.disconnect();
        return;
    }

    // Guardie: ogni id deve essere un timbro DI QUESTO utente; rifiuta quelli "con traccia".
    const idUtente = new Set(timbri.map(t => t.stampId));
    const idConTraccia = new Set(conTraccia.map(r => r.stampId));
    const nonSuoi = STAMP_RICHIESTI.filter(id => !idUtente.has(id));
    const protetti = STAMP_RICHIESTI.filter(id => idConTraccia.has(id) && !FORZA);
    const daCancellare = STAMP_RICHIESTI.filter(id => idUtente.has(id) && (!idConTraccia.has(id) || FORZA));

    if (nonSuoi.length) console.log(`\nIgnorati (non sono timbri di ${user.username}): ${nonSuoi.join(', ')}`);
    if (protetti.length) console.log(`\nRIFIUTATI (hanno una traccia dietro; usare --forza per insistere): ${protetti.join(', ')}`);
    if (!daCancellare.length) {
        console.log('\nNiente da cancellare dopo le guardie.');
        await mongoose.disconnect();
        return;
    }

    const primaTot = await Stamp.countDocuments({ userId: user._id });
    const esito = await Stamp.deleteMany({ userId: user._id, stampId: { $in: daCancellare } });
    const dopoTot = await Stamp.countDocuments({ userId: user._id });
    console.log(`\nCancellati ${esito.deletedCount} timbri (${daCancellare.join(', ')}).`);
    console.log(`Timbri di ${user.username}: ${primaTot} -> ${dopoTot}.`);

    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
