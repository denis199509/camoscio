const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { inviaEmail, emailAllarmeDeadMan } = require('../lib/mailer');

// Punto 37 (Dead Man's Switch, seconda meta'): il conto alla rovescia vive anche sul server,
// cosi' l'allarme puo' scattare per davvero anche a pagina chiusa. public/js/safety.js tiene
// la SUA copia in localStorage per il conto alla rovescia visivo (funziona offline, si
// aggiorna ogni secondo senza toccare il server) - questa e' l'unica che conta sul serio,
// perche' e' l'unica controllabile mentre la pagina e' chiusa (vedi POST /controlla-scadenze
// sotto, pensata per essere chiamata da un trigger esterno: questo progetto non ha nessuno
// scheduler, vedi il commento gia' in routes/notifications.js).

// Attiva il timer: SOLO il proprietario, richiede un contatto scelto CON un'email salvata
// (il canale dell'allarme). Il client filtra gia' i contatti senza email dal menu (vedi
// popolaContattiEmergenza in safety.js), questo e' il controllo vero - il client si puo'
// sempre aggirare.
router.post('/activate', requireAuth, async (req, res) => {
    try {
        const scadenza = new Date(req.body.expiresAt);
        if (!req.body.expiresAt || isNaN(scadenza.getTime()) || scadenza.getTime() <= Date.now()) {
            return res.status(400).json({ error: 'Scadenza non valida' });
        }
        const indice = Number(req.body.contactIndex);
        if (!Number.isInteger(indice) || indice < 0) {
            return res.status(400).json({ error: 'Contatto non valido' });
        }

        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });

        const contatto = user.emergencyContacts[indice];
        if (!contatto || !contatto.email) {
            return res.status(400).json({ error: 'Scegli un contatto di emergenza che abbia un\'email salvata' });
        }

        await User.findByIdAndUpdate(req.session.userId, {
            deadManActive: true,
            deadManExpiresAt: scadenza,
            deadManContactIndex: indice
        });
        res.json({ ok: true });
    } catch (e) {
        console.error("Errore attivazione Dead Man's Switch:", e);
        res.status(500).json({ error: 'Impossibile attivare il timer sul server' });
    }
});

// Disattiva il timer (check-in): SOLO il proprietario. $unset esplicito e non
// "assegna undefined + save()" - con un default nello schema quest'ultimo non toglierebbe
// davvero il campo (trappola gia' pagata su ActiveHikeSession.openSession, vedi routes/tracking.js).
router.post('/deactivate', requireAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.userId, {
            $unset: { deadManActive: 1, deadManExpiresAt: 1, deadManContactIndex: 1 }
        });
        res.json({ ok: true });
    } catch (e) {
        console.error("Errore disattivazione Dead Man's Switch:", e);
        res.status(500).json({ error: 'Impossibile disattivare il timer sul server' });
    }
});

// Verso dove leggere l'ultima posizione nota di un utente: dalla sessione di tracciamento
// APERTA, se c'e' (indice unico userId+openSession in ActiveHikeSession, quindi al massimo
// una) - e' un dato vero e continuamente aggiornato mentre si cammina, non serve inventare un
// canale nuovo che il client dovrebbe alimentare apposta per il Dead Man's Switch. Se non c'e'
// nessun tracciamento in corso, va detto con onesta' che la posizione non si sa (vincolo hard 7).
async function ultimaPosizioneNota(userId) {
    const sessione = await ActiveHikeSession.findOne({ userId, openSession: true });
    if (!sessione || !sessione.points || !sessione.points.length) {
        return "sconosciuta - nessun tracciamento GPS era attivo al momento della scadenza";
    }
    const ultimo = sessione.points[sessione.points.length - 1];
    const [lng, lat, , , precisione] = ultimo;
    const quando = sessione.lastPointAt
        ? sessione.lastPointAt.toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
        : 'orario sconosciuto';
    return `${lat.toFixed(5)}, ${lng.toFixed(5)} (precisione ${Math.round(precisione || 0)} m, rilevata alle ${quando})`;
}

// Gestisce UN utente scaduto: manda l'email vera se possibile, lascia sempre una Notification
// (cosi' chi ha attivato il timer scopre com'e' andata la prossima volta che apre il sito -
// oggi e' l'unico modo, non essendoci ne' scheduler ne' push in questo progetto), poi
// disattiva. Disattiva SEMPRE, anche se l'invio fallisce: altrimenti lo stesso allarme
// ripartirebbe a ogni giro del cron finche' qualcuno non controlla a mano.
async function gestisciScadenza(user) {
    const contatto = user.emergencyContacts[user.deadManContactIndex];
    const oraAttesa = user.deadManExpiresAt.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    });

    let esito;
    if (!contatto || !contatto.email) {
        // Non dovrebbe succedere (il client non permette di attivare senza), ma l'array dei
        // contatti puo' cambiare fra l'attivazione e la scadenza (es. altra scheda aperta).
        esito = "Il timer di sicurezza è scaduto, ma il contatto scelto non ha (più) un'email salvata: nessun avviso è partito. Aggiorna i tuoi contatti di emergenza.";
        console.error(`Dead Man's Switch scaduto per ${user.username} ma il contatto (indice ${user.deadManContactIndex}) non ha email.`);
    } else {
        const posizioneTesto = await ultimaPosizioneNota(user._id);
        const nomeEscursionista = `${user.nome || ''} ${user.cognome || ''}`.trim() || user.username;
        const { oggetto, testo, html } = emailAllarmeDeadMan({
            nomeContatto: contatto.name,
            nomeEscursionista,
            oraAttesa,
            posizioneTesto
        });
        const inviata = await inviaEmail({ a: contatto.email, oggetto, testo, html });
        esito = inviata
            ? `Il timer di sicurezza è scaduto: è partito un avviso via email a ${contatto.name} (${contatto.email}).`
            : `Il timer di sicurezza è scaduto, ma l'invio dell'email a ${contatto.name} è fallito. Avvisalo/a direttamente se non l'hai già fatto.`;
    }

    await Notification.create({ userId: user._id, text: esito });
    await User.findByIdAndUpdate(user._id, {
        $unset: { deadManActive: 1, deadManExpiresAt: 1, deadManContactIndex: 1 }
    });
}

// Verifica il segreto condiviso. Fail-closed in produzione se non e' configurato (stesso
// principio di indirizzoBaseUtilizzabile in lib/mailer.js): senza, chiunque su internet
// potrebbe far scattare l'invio di allarmi veri chiamando questa rotta a ripetizione. In
// locale invece si accetta senza, per poter provare a mano senza configurare niente.
function segretoCronValido(req) {
    const segreto = process.env.SAFETY_CRON_SECRET;
    if (!segreto) return process.env.NODE_ENV !== 'production';
    const fornito = req.query.chiave || req.get('X-Safety-Cron-Secret');
    return fornito === segreto;
}

// Chiamata da un trigger ESTERNO (nessuno scheduler in questo progetto): un cron non ha una
// sessione utente, quindi NON usa requireAuth ma il segreto condiviso sopra. Idempotente per
// design: chiamarla piu' volte di fila, o piu' volte sullo stesso utente scaduto, non manda
// email doppie - il primo giro che trova un utente scaduto lo disattiva subito.
// Risponde sia a GET sia a POST: non tutti i servizi di ping gratuiti (cron-job.org e simili)
// permettono di scegliere il metodo, e qui non c'e' nessun corpo da leggere - l'azione la fa
// scattare la chiamata stessa, non cosa contiene.
async function controllaScadenzeHandler(req, res) {
    if (!segretoCronValido(req)) {
        return res.status(403).json({ error: 'Non autorizzato' });
    }
    try {
        const scaduti = await User.find({
            deadManActive: true,
            deadManExpiresAt: { $lte: new Date() }
        });

        for (const user of scaduti) {
            await gestisciScadenza(user);
        }
        res.json({ controllati: scaduti.length });
    } catch (e) {
        console.error("Errore controllo scadenze Dead Man's Switch:", e);
        res.status(500).json({ error: 'Errore nel controllo delle scadenze' });
    }
}
router.get('/controlla-scadenze', controllaScadenzeHandler);
router.post('/controlla-scadenze', controllaScadenzeHandler);

module.exports = router;
