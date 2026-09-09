// PROVA BASSO-2 (revisione 35a): il promemoria "non hai ancora completato l'escursione in
// gruppo" (punto 64, ensureCompletionReminders in lib/hikeStats.js) NON deve RISORGERE ogni
// 90 giorni.
//
// Il difetto: le Notification hanno un TTL di 90 giorni (models/Notification.js). La guardia
// anti-doppione e' Notification.findOne({userId, relatedHikeId}); quando il TTL cancella il
// promemoria, la guardia non lo trova piu' e lo RICREA - all'infinito, per ogni escursione
// passata mai chiusa in gruppo. Il fix limita la query alle escursioni scadute negli ultimi
// ~60 giorni (< 90 del TTL): quando il promemoria scade, l'escursione e' gia' fuori.
//
// Prova DIRETTA (niente server): chiama ensureCompletionReminders su un creatorId SINTETICO
// (un ObjectId che non appartiene a nessuno) e crea/cancella Hike e Notification di prova.
// Marca PROVA-BASSO2 + gli _id nati nel run.
//
//   node prove/prova-promemoria-completamento.js      (non serve il server acceso)

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { ensureCompletionReminders } = require('../lib/hikeStats');
const Hike = require('../models/Hike');
const Notification = require('../models/Notification');

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

const gg = (msFa) => {
    const d = new Date(Date.now() - msFa);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const G = 24 * 60 * 60 * 1000;

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const MARCA = `PROVA-BASSO2-${Date.now()}`;
    const creatore = new mongoose.Types.ObjectId(); // sintetico: nessun account vero
    const idsHike = [];

    try {
        // A: scaduta da 100 giorni (oltre la finestra dei 60) - rappresenta un'escursione il
        //    cui promemoria sarebbe gia' stato cancellato dal TTL.
        // B: scaduta da 10 giorni (dentro la finestra) - deve ancora ricevere il promemoria.
        // C: scaduta da 5 giorni ma GIA' chiusa in gruppo (groupCompletedAt) - mai promemoria.
        // D: scaduta da 20 giorni, con un promemoria GIA' presente - non deve duplicarsi.
        const mk = async (nome, giorniFa, extra = {}) => {
            const h = await Hike.create({
                title: `${MARCA}-${nome}`, creatorId: creatore, date: gg(giorniFa * G),
                trailhead: { lat: 42.4, lng: 13.5, name: nome },
                location: { type: 'Point', coordinates: [13.5, 42.4] },
                ...extra
            });
            idsHike.push(h._id);
            return h;
        };
        const A = await mk('A', 100);
        const B = await mk('B', 10);
        await mk('C', 5, { groupCompletedAt: new Date() });
        const D = await mk('D', 20);
        await Notification.create({ userId: creatore, text: 'promemoria pre-esistente D', relatedHikeId: D._id });

        // --- 1. Primo giro ---
        await ensureCompletionReminders(creatore);
        const dopo1 = await Notification.find({ userId: creatore }).lean();
        const perHike = (id) => dopo1.filter(n => String(n.relatedHikeId) === String(id)).length;

        ok('A (100 giorni fa): NESSUN promemoria - fuori dalla finestra dei 60', perHike(A._id) === 0, `trovati ${perHike(A._id)}`);
        ok('B (10 giorni fa): UN promemoria creato', perHike(B._id) === 1, `trovati ${perHike(B._id)}`);
        ok('C (chiusa in gruppo): nessun promemoria', dopo1.every(n => !String(n.text).includes(`${MARCA}-C`)));
        ok('D (promemoria pre-esistente): resta UNO, non duplicato', perHike(D._id) === 1, `trovati ${perHike(D._id)}`);

        // --- 2. Il TTL cancella il promemoria di B (simulato): un secondo giro NON lo fa
        //        risorgere se B nel frattempo e' uscita dalla finestra; DENTRO la finestra si'
        //        (e va bene: il bug era la RINASCITA di roba vecchia, non di roba recente). ---
        await Notification.deleteMany({ userId: creatore, relatedHikeId: B._id });
        await ensureCompletionReminders(creatore);
        ok('B ancora nella finestra: il promemoria si puo\' ricreare (non e\' il bug)',
            (await Notification.countDocuments({ userId: creatore, relatedHikeId: B._id })) === 1);

        // A e' la prova del bug vero: promemoria cancellato dal TTL, escursione vecchia ->
        // NON deve tornare. (Non c'era nessun promemoria per A; il secondo giro non lo crea.)
        ok('A resta senza promemoria anche al secondo giro (niente rinascita)',
            (await Notification.countDocuments({ userId: creatore, relatedHikeId: A._id })) === 0);

        // --- 3. Controprova: senza il limite inferiore (finestra), A riceverebbe il promemoria ---
        const conFinestra = await Hike.find({
            creatorId: creatore, groupCompletedAt: { $exists: false },
            date: { $gte: gg(60 * G), $lt: gg(0) }
        }).lean();
        const senzaFinestra = await Hike.find({
            creatorId: creatore, groupCompletedAt: { $exists: false },
            date: { $lt: gg(0) }
        }).lean();
        ok('la finestra ESCLUDE A, il vecchio filtro no',
            !conFinestra.some(h => String(h._id) === String(A._id))
            && senzaFinestra.some(h => String(h._id) === String(A._id)));

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        try { await Hike.deleteMany({ _id: { $in: idsHike } }); } catch (e) { console.error('cleanup hike:', e.message); }
        try { await Notification.deleteMany({ userId: creatore }); } catch (e) { console.error('cleanup notif:', e.message); }
        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
