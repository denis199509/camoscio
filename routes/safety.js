const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { inviaEmail, emailAllarmeDeadMan } = require('../lib/mailer');
// A-NUOVO-1 (ri-review sicurezza, 2° giro): tetto agli armamenti del timer per IP.
const { scritturaLimiter } = require('../middleware/rateLimit');
// Segreto condiviso per il trigger esterno (nessuno scheduler nel progetto). Estratto in
// lib/cronSecret.js perche' serve la stessa logica anche allo scrub degli account
// eliminati (routes/users.js), con una variabile d'ambiente sua.
const { segretoCronValido } = require('../lib/cronSecret');

// Punto 37 (Dead Man's Switch, seconda meta'): il conto alla rovescia vive anche sul server,
// cosi' l'allarme puo' scattare per davvero anche a pagina chiusa. public/js/safety.js tiene
// la SUA copia in localStorage per il conto alla rovescia visivo (funziona offline, si
// aggiorna ogni secondo senza toccare il server) - questa e' l'unica che conta sul serio,
// perche' e' l'unica controllabile mentre la pagina e' chiusa (vedi POST /controlla-scadenze
// sotto, pensata per essere chiamata da un trigger esterno: questo progetto non ha nessuno
// scheduler, vedi il commento gia' in routes/notifications.js).

// Attiva il timer: SOLO il proprietario. A-3.2 (revisione sicurezza 21a): alla scadenza
// l'allarme va a TUTTI i contatti di emergenza che hanno un'email (il canale dell'allarme),
// non a uno scelto - quindi qui basta che ce ne sia almeno uno raggiungibile. Il client
// disabilita gia' il tasto quando non ce n'e' nessuno (renderContattiEmergenza in
// safety.js), questo e' il controllo vero - il client si puo' sempre aggirare.
router.post('/activate', requireAuth, scritturaLimiter, async (req, res) => {
    try {
        const scadenza = new Date(req.body.expiresAt);
        if (!req.body.expiresAt || isNaN(scadenza.getTime()) || scadenza.getTime() <= Date.now()) {
            return res.status(400).json({ error: 'Scadenza non valida' });
        }

        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });

        // A-NUOVO-1: gli account demo entrano senza password e sono condivisi da chiunque -
        // il Dead Man's Switch su un account cosi' non ha senso funzionale, ed e' il primo
        // anello della catena "armo il timer con N contatti finti e uso l'invio come relay".
        if (user.isDemoAccount) {
            return res.status(403).json({ error: 'Il timer di sicurezza non è disponibile sugli account demo' });
        }

        const raggiungibili = (user.emergencyContacts || []).filter(c => c && c.email);
        if (!raggiungibili.length) {
            return res.status(400).json({ error: "Aggiungi un contatto di emergenza con un'email prima di attivare il timer" });
        }

        await User.findByIdAndUpdate(req.session.userId, {
            deadManActive: true,
            deadManExpiresAt: scadenza
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
            $unset: { deadManActive: 1, deadManExpiresAt: 1 }
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
    const oraAttesa = user.deadManExpiresAt.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    });

    // A-3.2: l'allarme va a TUTTI i contatti di emergenza che hanno un'email, non a uno
    // scelto. L'array puo' essere cambiato fra l'attivazione e la scadenza (altra scheda,
    // contatto rimosso): si rilegge qui e basta.
    const raggiungibili = (user.emergencyContacts || []).filter(c => c && c.email);

    let esito;
    if (!raggiungibili.length) {
        esito = "Il timer di sicurezza è scaduto, ma non hai (più) nessun contatto di emergenza con un'email: nessun avviso è partito. Aggiungi un contatto e ricontrolla i tuoi dati.";
        console.error(`Dead Man's Switch scaduto per ${user.username} ma nessun contatto ha un'email.`);
    } else {
        const posizioneTesto = await ultimaPosizioneNota(user._id);
        const nomeEscursionista = `${user.nome || ''} ${user.cognome || ''}`.trim() || user.username;

        const inviati = [];
        const falliti = [];
        for (const contatto of raggiungibili) {
            // A-3.2: ogni destinatario sa chi sono gli ALTRI contatti avvisati, cosi' puo'
            // coordinarsi (se uno non risponde o non riesce a chiamare il 112, si muove un altro).
            const altriContatti = raggiungibili.filter(c => c !== contatto).map(c => c.name);
            const { oggetto, testo, html } = emailAllarmeDeadMan({
                nomeContatto: contatto.name,
                nomeEscursionista,
                oraAttesa,
                posizioneTesto,
                altriContatti
            });
            const ok = await inviaEmail({ a: contatto.email, oggetto, testo, html });
            (ok ? inviati : falliti).push(contatto.name);
        }

        // BASSO (ri-review sicurezza, 2° giro): la Notification resta per sempre e finisce
        // nell'export - non ci si mettono i nomi dei contatti quando e' andato tutto bene
        // (dato di terzi che sopravvive alla rimozione del contatto). I nomi restano solo
        // nel caso di FALLIMENTO, dove servono all'utente per sapere chi avvisare a mano.
        if (inviati.length && !falliti.length) {
            esito = `Il timer di sicurezza è scaduto: è partito un avviso via email ai tuoi contatti di emergenza (${inviati.length}).`;
        } else if (inviati.length) {
            esito = `Il timer di sicurezza è scaduto: avviso partito a ${inviati.length} contatti, ma l'invio a ${falliti.join(', ')} è fallito. Avvisali/e direttamente se non l'hai già fatto.`;
        } else {
            esito = `Il timer di sicurezza è scaduto, ma l'invio dell'email a ${falliti.join(', ')} è fallito. Avvisali/e direttamente se non l'hai già fatto.`;
        }
    }

    await Notification.create({ userId: user._id, text: esito });
    await User.findByIdAndUpdate(user._id, {
        $unset: { deadManActive: 1, deadManExpiresAt: 1 }
    });
}

// Chiamata da un trigger ESTERNO (nessuno scheduler in questo progetto): un cron non ha una
// sessione utente, quindi NON usa requireAuth ma il segreto condiviso (lib/cronSecret.js,
// variabile SAFETY_CRON_SECRET). Idempotente per design: chiamarla piu' volte di fila, o
// piu' volte sullo stesso utente scaduto, non manda email doppie - il primo giro che trova
// un utente scaduto lo disattiva subito.
// Risponde sia a GET sia a POST: non tutti i servizi di ping gratuiti (cron-job.org e simili)
// permettono di scegliere il metodo, e qui non c'e' nessun corpo da leggere - l'azione la fa
// scattare la chiamata stessa, non cosa contiene.
async function controllaScadenzeHandler(req, res) {
    if (!segretoCronValido(req, 'SAFETY_CRON_SECRET')) {
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
