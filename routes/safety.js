const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');
const { inviaEmail, emailAllarmeDeadMan } = require('../lib/mailer');
// A-NUOVO-1 (ri-review sicurezza, 2° giro): tetto agli armamenti del timer per IP.
// MEDIO-1 (revisione sicurezza 28ª): secchio DEDICATO (sicurezzaLimiter), non piu' condiviso
// con le altre scritture - il soccorso non deve poter finire la quota per colpa di chi crea
// escursioni o cancella un account dallo stesso IP/NAT.
const { sicurezzaLimiter, checkinLimiter, presaVisioneLimiter } = require('../middleware/rateLimit');
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
router.post('/activate', requireAuth, sicurezzaLimiter, async (req, res) => {
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
            $set: { deadManActive: true, deadManExpiresAt: scadenza },
            // Nuovo ciclo: l'esito dell'ultimo allarme fallito (BASSO-3) non serve piu'.
            $unset: { deadManLastFired: 1 }
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
// checkinLimiter (revisione del cumulativo 40a): NON sicurezzaLimiter. Un 429 sul check-in fa
// partire un falso allarme di soccorso (disattivaSulServer ritorna res.ok), quindi la quota
// dev'essere della PERSONA e non dell'IP - dietro il wifi di un rifugio un vicino di rete non
// deve poter impedire un disarmo - e larghissima (200/ora). La 39a aveva messo sicurezzaLimiter
// qui per parita' con /activate, ma condividere quel secchio con /ultimo-allarme/visto (che il
// client chiama in fire-and-forget) apriva un modo per bloccare il check-in altrui.
router.post('/deactivate', requireAuth, checkinLimiter, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.userId, {
            // deadManLastFired (BASSO-3): il check-in vale anche come "presa visione"
            // dell'ultimo allarme fallito - e' comunque un $unset innocuo se non c'era.
            $unset: { deadManActive: 1, deadManExpiresAt: 1, deadManLastFired: 1 }
        });
        res.json({ ok: true });
    } catch (e) {
        console.error("Errore disattivazione Dead Man's Switch:", e);
        res.status(500).json({ error: 'Impossibile disattivare il timer sul server' });
    }
});

// "Ho capito" sul riquadro dell'ultimo allarme fallito (BASSO-3). Rotta DEDICATA, NON
// /deactivate (revisione del cumulativo 39a): con due schede aperte, se l'utente riarma il
// timer da un'altra scheda o dal telefono mentre questa mostra ancora il riquadro vecchio, un
// "Ho capito" che passasse da /deactivate spegnerebbe IN SILENZIO il timer appena riarmato
// (restoreDeadManState sincronizza in una direzione sola). Qui si tocca SOLO deadManLastFired:
// il caso peggiore e' un $unset di un campo gia' assente, mai un timer disarmato per sbaglio.
// presaVisioneLimiter (40a): secchio SUO, mai condiviso col check-in (/deactivate) - il client
// chiama questa rotta anche in automatico oltre i 180 giorni, ed e' traffico che non deve poter
// erodere la quota del disarmo.
router.post('/ultimo-allarme/visto', requireAuth, presaVisioneLimiter, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.userId, { $unset: { deadManLastFired: 1 } });
        res.json({ ok: true });
    } catch (e) {
        console.error("Errore presa visione ultimo allarme:", e);
        res.status(500).json({ error: "Impossibile chiudere l'avviso sul server" });
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
// disattiva. Disattiva anche se l'invio fallisce, altrimenti lo stesso allarme ripartirebbe a
// ogni giro del cron - MA solo se e' ancora la scadenza letta dal cron (CAS piu' sotto): se
// l'utente ha riarmato / fatto check-in durante il ciclo di invii, il timer nuovo resta.
async function gestisciScadenza(user) {
    // Senza scadenza la CAS finale sarebbe un update INCONDIZIONATO (Mongoose toglie dal
    // filtro le chiavi undefined). Non raggiungibile oggi (il cron filtra su $lte), esplicito
    // a costo zero.
    if (!user.deadManExpiresAt) return;

    const oraAttesa = user.deadManExpiresAt.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
    });

    // A-3.2: l'allarme va a TUTTI i contatti di emergenza che hanno un'email, non a uno
    // scelto. L'array puo' essere cambiato fra l'attivazione e la scadenza (altra scheda,
    // contatto rimosso): si rilegge qui e basta.
    const raggiungibili = (user.emergencyContacts || []).filter(c => c && c.email);

    let esito;
    const inviati = [];
    const falliti = []; // popolato solo nel ramo else; letto anche sotto per deadManLastFired
    if (!raggiungibili.length) {
        esito = "Il timer di sicurezza è scaduto, ma non hai (più) nessun contatto di emergenza con un'email: nessun avviso è partito. Aggiungi un contatto e ricontrolla i tuoi dati.";
        console.error(`Dead Man's Switch scaduto per ${user.username} ma nessun contatto ha un'email.`);
    } else {
        const posizioneTesto = await ultimaPosizioneNota(user._id);
        const nomeEscursionista = `${user.nome || ''} ${user.cognome || ''}`.trim() || user.username;

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
    // BASSO-3 (revisione 35a): la notifica qui sopra scade col TTL di 90 giorni. Se qualche
    // invio e' FALLITO, i nomi da richiamare a mano vanno tenuti anche sul documento persona
    // (niente TTL) - e' l'unico appiglio se l'utente riapre il sito dopo settimane (proprio il
    // caso in cui il timer scade: era in cammino, senza campo). Lo cancella l'/activate
    // successivo (nuovo ciclo) o "Ho capito" (presa visione).
    // Revisione del cumulativo 39a: si tiene anche l'esito PEGGIORE - nessun contatto con
    // un'email (contattiNonRaggiunti resta []) - che senza questo scadeva col TTL della
    // notifica come tutti gli altri, pur essendo il caso in cui NON e' partito niente a nessuno.
    const aggiornamento = { $unset: { deadManActive: 1, deadManExpiresAt: 1 } };
    if (falliti.length || !raggiungibili.length) {
        aggiornamento.$set = { deadManLastFired: { at: new Date(), contattiNonRaggiunti: falliti } };
    }
    // CAS sulla scadenza (revisione del cumulativo 39a): fra la User.find({deadManActive:true})
    // del cron e questa scrittura sono passati N invii email SINCRONI (secondi, con molti
    // contatti). Se l'utente ha fatto check-in o riarmato in quella finestra, deadManExpiresAt
    // sul DB e' cambiato: NON si deve spegnere il timer nuovo (vincolo hard 7 - "spento in
    // silenzio"). Gli invii gia' partiti non si annullano, ma il timer fresco sopravvive, e
    // l'/activate ha gia' fatto il suo $unset di deadManLastFired.
    await User.findOneAndUpdate(
        { _id: user._id, deadManExpiresAt: user.deadManExpiresAt },
        aggiornamento
    );
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
            try {
                await gestisciScadenza(user);
            } catch (e) {
                // Un utente che va storto (timeout Atlas su Notification.create, un campo non
                // valido) NON deve annullare l'allarme degli ALTRI scaduti di questo giro: il
                // cron esterno passa ogni N minuti, e' l'unico giro che hanno. Per l'utente
                // fallito le email possono essere gia' partite ma deadManActive resta true ->
                // il giro dopo ritenta (i contatti potrebbero ricevere due volte le coordinate:
                // meno peggio di un allarme mai partito).
                console.error("Scadenza Dead Man's Switch non gestita per un utente:", user && user._id, e && e.message);
            }
        }

        // Retention vera dei nomi di terzi in deadManLastFired (revisione del cumulativo 40a):
        // il tetto a 180 giorni in public/js/safety.js e' solo di RENDERING - scatta se e
        // quando l'utente riapre la pagina Sicurezza, e dipende dall'orologio del suo telefono.
        // Chi non torna piu' (proprio lo scenario di BASSO-3) si terrebbe i nomi dei contatti a
        // tempo indeterminato, anche nell'export dati. updateMany e NON un indice TTL: un TTL su
        // quel campo cancellerebbe l'intero documento User.
        const limite180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const puliti = await User.updateMany(
            { 'deadManLastFired.at': { $lt: limite180 } },
            { $unset: { deadManLastFired: 1 } }
        );

        res.json({ controllati: scaduti.length, avvisiScaduti: puliti.modifiedCount });
    } catch (e) {
        console.error("Errore controllo scadenze Dead Man's Switch:", e);
        res.status(500).json({ error: 'Errore nel controllo delle scadenze' });
    }
}
router.get('/controlla-scadenze', controllaScadenzeHandler);
router.post('/controlla-scadenze', controllaScadenzeHandler);

module.exports = router;
// Esportati per le prove dirette (prove/prova-deadman-esito-fallito.js): gestisciScadenza
// non e' provabile da un server spawnato perche' li' inviaEmail riesce sempre (chiavi
// Mailjet vuote -> ritorna true), quindi il ramo "invio fallito" (BASSO-3) non scatterebbe mai.
module.exports.gestisciScadenza = gestisciScadenza;
module.exports.controllaScadenzeHandler = controllaScadenzeHandler;
