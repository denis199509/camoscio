// PROVA BASSO-3 (revisione 35a): quando il Dead Man's Switch SCADE e l'invio dell'email ad
// almeno un contatto FALLISCE, i nomi da richiamare a mano restano anche sul documento
// persona (`deadManLastFired`), non solo nella notifica in campanella - che scade col TTL di
// 90 giorni (models/Notification.js), proprio mentre l'utente e' in cammino senza campo.
//
// Prova DIRETTA (niente server): gestisciScadenza non e' raggiungibile da un server spawnato
// perche' li' inviaEmail riesce sempre (chiavi Mailjet vuote -> return true), quindi il ramo
// "fallito" non scatterebbe. Qui si monkeypatcha inviaEmail PRIMA di caricare routes/safety.js
// (che la destruttura al load) e si chiama gestisciScadenza a mano.
//
// Account REALE temporaneo, marca @esempio-di-prova.invalid, cancellato per _id nel finally.
//
//   node prove/prova-deadman-esito-fallito.js      (non serve il server acceso)

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// --- Monkeypatch PRIMA di require('../routes/safety') ---
const mailer = require('../lib/mailer');
const inviaEmailVero = mailer.inviaEmail;
let indirizziCheFalliscono = new Set();
mailer.inviaEmail = async ({ a }) => !indirizziCheFalliscono.has(a);

const { gestisciScadenza, controllaScadenzeHandler } = require('../routes/safety');
const User = require('../models/User');
const Notification = require('../models/Notification');

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const MARCA = Date.now();
    const emailOk = `dm-ok-${MARCA}@esempio-di-prova.invalid`;
    const emailFail = `dm-fail-${MARCA}@esempio-di-prova.invalid`;
    let uid = null;
    let recenteId = null; // secondo account temporaneo della sez. 7, pulito nel finally

    try {
        const u = await User.create({
            username: `PROVA-DM-${MARCA}`,
            email: `prova-dm-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(`pw-${MARCA}`, 10),
            nome: 'Prova', cognome: 'DeadMan', termsAcceptedAt: new Date(), emailVerified: true,
            emergencyContacts: [
                { name: 'Contatto Ok', relationship: 'amico', email: emailOk },
                { name: 'Contatto Fallito', relationship: 'sorella', email: emailFail }
            ],
            // Nasce con scadenza FUTURA (revisione del cumulativo 39a): se nascesse gia'
            // passata e il cron esterno girasse fra User.create e la prima gestisciScadenza a
            // mano, girerebbe sul processo di PRODUZIONE (li' inviaEmail non e' monkeypatchata).
            // La si porta nel passato solo l'istante prima di ogni chiamata, con scadiOra().
            deadManActive: true, deadManExpiresAt: new Date(Date.now() + 3600000)
        });
        uid = u._id;
        const scadiOra = () => User.findByIdAndUpdate(uid, { $set: { deadManExpiresAt: new Date(Date.now() - 60000) } });

        // === 1. Scadenza con UN invio fallito ===
        indirizziCheFalliscono = new Set([emailFail]);
        await scadiOra();
        await gestisciScadenza(await User.findById(uid));
        let db = await User.findById(uid).lean();
        ok('deadManActive rimosso dopo la scadenza', db.deadManActive === undefined);
        ok('deadManExpiresAt rimosso dopo la scadenza', db.deadManExpiresAt === undefined);
        ok('deadManLastFired impostato', !!db.deadManLastFired);
        ok('...con una data (at)', db.deadManLastFired && db.deadManLastFired.at instanceof Date
            && Math.abs(db.deadManLastFired.at.getTime() - Date.now()) < 60000);
        ok('...e SOLO il nome del contatto non raggiunto',
            db.deadManLastFired && JSON.stringify(db.deadManLastFired.contattiNonRaggiunti) === JSON.stringify(['Contatto Fallito']),
            JSON.stringify(db.deadManLastFired && db.deadManLastFired.contattiNonRaggiunti));
        ok('una Notification di esito e\' comunque stata creata', (await Notification.countDocuments({ userId: uid })) === 1);

        // === 2. Scadenza con TUTTI gli invii OK -> nessun deadManLastFired ===
        await User.findByIdAndUpdate(uid, {
            $set: { deadManActive: true, deadManExpiresAt: new Date(Date.now() - 60000) },
            $unset: { deadManLastFired: 1 }
        });
        indirizziCheFalliscono = new Set(); // nessuno fallisce
        await gestisciScadenza(await User.findById(uid));
        db = await User.findById(uid).lean();
        ok('nessun invio fallito -> deadManLastFired resta ASSENTE', db.deadManLastFired === undefined,
            JSON.stringify(db.deadManLastFired));

        // === 3. deadManLastFired e' PRIVATO (ALWAYS_PRIVATE_FIELDS) ===
        // Lo si riscrive e si legge il documento come lo serializza il modello (toJSON globale).
        await User.findByIdAndUpdate(uid, { $set: { deadManLastFired: { at: new Date(), contattiNonRaggiunti: ['Tizio'] } } });
        const serializzato = (await User.findById(uid)).toJSON();
        // toJSON non applica ALWAYS_PRIVATE_FIELDS (quello e' in routes/users.js), ma la
        // struttura dev'esserci per il proprietario. La privacy verso gli ALTRI e' coperta da
        // prova-foto-profilo-privacy.js / prova-lista-utenti-minimizzata.js sul meccanismo
        // condiviso; qui basta verificare che il campo esista e abbia la forma giusta.
        ok('per il proprietario il campo c\'e\' e ha {at, contattiNonRaggiunti}',
            serializzato.deadManLastFired && serializzato.deadManLastFired.at
            && Array.isArray(serializzato.deadManLastFired.contattiNonRaggiunti));

        // === 4. Scadenza SENZA nessun contatto con email -> deadManLastFired con [] ===
        // (revisione del cumulativo 39a) e' l'esito PEGGIORE: non parte niente a nessuno. Prima
        // scadeva col TTL della notifica come gli altri; ora resta sul documento persona.
        await User.findByIdAndUpdate(uid, {
            $set: { deadManActive: true, deadManExpiresAt: new Date(Date.now() + 3600000), emergencyContacts: [] },
            $unset: { deadManLastFired: 1 }
        });
        await scadiOra();
        await gestisciScadenza(await User.findById(uid));
        db = await User.findById(uid).lean();
        ok('nessun contatto: deadManActive comunque rimosso', db.deadManActive === undefined);
        ok('nessun contatto: deadManLastFired IMPOSTATO lo stesso (esito peggiore)', !!db.deadManLastFired);
        ok('nessun contatto: contattiNonRaggiunti = [] (non e\' partito niente a nessuno)',
            db.deadManLastFired && Array.isArray(db.deadManLastFired.contattiNonRaggiunti)
            && db.deadManLastFired.contattiNonRaggiunti.length === 0,
            JSON.stringify(db.deadManLastFired && db.deadManLastFired.contattiNonRaggiunti));

        // === 5. CAS sulla scadenza: se deadManExpiresAt e' cambiato fra la lettura del cron e
        //        la scrittura finale (utente che riarma / fa check-in in quei secondi), il
        //        timer NUOVO non si spegne (revisione del cumulativo 39a, vincolo hard 7). ===
        await User.findByIdAndUpdate(uid, {
            $set: {
                deadManActive: true, deadManExpiresAt: new Date(Date.now() - 60000),
                emergencyContacts: [{ name: 'Contatto Ok', relationship: 'amico', email: emailOk }]
            },
            $unset: { deadManLastFired: 1 }
        });
        indirizziCheFalliscono = new Set();
        const utenteLettoDalCron = await User.findById(uid);          // scadenza vecchia in mano
        const nuovaScadenza = new Date(Date.now() + 7200000);
        await User.findByIdAndUpdate(uid, { $set: { deadManExpiresAt: nuovaScadenza } }); // "riarmo" nel mezzo
        await gestisciScadenza(utenteLettoDalCron);                    // gira sulla scadenza vecchia
        db = await User.findById(uid).lean();
        ok('CAS: il timer riarmato nel frattempo NON e\' stato spento', db.deadManActive === true,
            JSON.stringify({ active: db.deadManActive }));
        ok('CAS: deadManExpiresAt e\' ancora quella nuova (scrittura del cron scartata)',
            db.deadManExpiresAt && Math.abs(new Date(db.deadManExpiresAt).getTime() - nuovaScadenza.getTime()) < 1000,
            JSON.stringify({ exp: db.deadManExpiresAt }));
        // pulizia: lo si spegne per davvero (scadenza allineata) cosi' il finally trova poco da fare
        await User.findByIdAndUpdate(uid, { $unset: { deadManActive: 1, deadManExpiresAt: 1, deadManLastFired: 1 } });

        // === 6. B-4 (revisione 40a): gestisciScadenza con deadManExpiresAt ASSENTE torna
        //        subito, senza scrivere niente (la CAS finale sarebbe un update incondizionato). ===
        await User.findByIdAndUpdate(uid, { $set: { deadManActive: true }, $unset: { deadManExpiresAt: 1, deadManLastFired: 1 } });
        const notifPrima = await Notification.countDocuments({ userId: uid });
        await gestisciScadenza(await User.findById(uid));
        db = await User.findById(uid).lean();
        ok('B-4: senza deadManExpiresAt, gestisciScadenza non tocca deadManActive', db.deadManActive === true);
        ok('B-4: ...e non crea nessuna Notification', await Notification.countDocuments({ userId: uid }) === notifPrima);
        await User.findByIdAndUpdate(uid, { $unset: { deadManActive: 1 } });

        // === 7. M-1 (revisione 40a): la retention vera dei 180 giorni la fa il cron, non solo
        //        il client. controllaScadenzeHandler fa un updateMany su deadManLastFired.at. ===
        await User.findByIdAndUpdate(uid, {
            $set: { deadManLastFired: { at: new Date(Date.now() - 200 * 86400000), contattiNonRaggiunti: ['Vecchio Contatto'] } }
        });
        // un secondo utente con un avviso RECENTE, che NON deve essere spazzato
        const recente = await User.create({
            username: `PROVA-DM-REC-${MARCA}`, email: `prova-dm-rec-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(`pw-${MARCA}`, 10), nome: 'Prova', cognome: 'Recente',
            termsAcceptedAt: new Date(), emailVerified: true,
            deadManLastFired: { at: new Date(Date.now() - 10 * 86400000), contattiNonRaggiunti: ['Recente'] }
        });
        recenteId = recente._id;
        let statusCron = 0, corpoCron = null;
        const resFinto = { json: (x) => { corpoCron = x; }, status(c) { statusCron = c; return this; } };
        // In locale segretoCronValido accetta senza chiave (NODE_ENV !== 'production')
        await controllaScadenzeHandler({ query: {}, get: () => undefined }, resFinto);
        ok('7: controllaScadenzeHandler ha risposto (non 403)', statusCron === 0 && !!corpoCron, JSON.stringify({ statusCron, corpoCron }));
        ok('7: l\'avviso di 200 giorni fa e\' stato spazzato via dal server ($unset)',
            (await User.findById(uid).lean()).deadManLastFired === undefined);
        ok('7: l\'avviso di 10 giorni fa NON e\' stato toccato',
            !!(await User.findById(recente._id).lean()).deadManLastFired);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (uid) {
            try { await User.deleteOne({ _id: uid }); } catch (e) { console.error('cleanup user:', e.message); }
            try { await Notification.deleteMany({ userId: uid }); } catch (e) { console.error('cleanup notif:', e.message); }
        }
        if (recenteId) {
            try { await User.deleteOne({ _id: recenteId }); } catch (e) { console.error('cleanup user recente:', e.message); }
        }
        mailer.inviaEmail = inviaEmailVero;
        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
