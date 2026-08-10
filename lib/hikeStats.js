// Punto 64 - estratto da routes/hikes.js (POST /:id/complete, fatta in Fase H) perche' la
// stessa matematica serve ora anche al completamento di GRUPPO: il creatore conferma N
// persone in un colpo solo, e ognuna ha bisogno esattamente delle stesse conseguenze
// (Completion, passo personale, livello esperienza) che prima si applicavano una alla
// volta, per auto-dichiarazione. Stessa idea gia' seguita per calculateHikeTimes() e
// statoBadgePer(): la logica si scrive una volta sola, i chiamanti decidono solo il "chi".
const Completion = require('../models/Completion');
const Hike = require('../models/Hike');
const Notification = require('../models/Notification');

// Applica a UN utente le conseguenze di aver completato un'escursione. "user" e' un
// documento Mongoose gia' caricato, NON ancora salvato - il salvataggio resta a chi chiama,
// cosi' la rotta singola e quella di gruppo restano libere di salvare uno a uno o in serie
// senza che questa funzione debba saperlo.
// "tempi" e' {actualTimeHours, movingTimeHours}: il secondo campo e' facoltativo (punto 79,
// letto da un .gpx abbastanza fitto da separare cammino e pause - vedi lib/gpx.js). Ritorna
// false (nessun Completion creato, nessuna statistica toccata) se questa persona aveva gia'
// un Completion per questa escursione - rispetta cosi' l'indice unico userId+hikeId senza
// sollevare un errore: nel completamento di gruppo non e' un problema, e' il caso normale di
// chi si era gia' auto-completato in passato.
async function applyHikeCompletionStats(user, hike, tempi) {
    const { actualTimeHours, movingTimeHours } = tempi || {};

    const alreadyCompleted = await Completion.findOne({ userId: user._id, hikeId: hike._id });
    if (alreadyCompleted) return false;

    // Quante escursioni PRECEDENTI hanno gia' un tempo reale misurato - non e' detto
    // coincida con completedHikes (si puo' completare un'escursione senza indicare un
    // tempo). Bug trovato in Fase H: usare completedHikes al posto di questo, nella media
    // del passo sotto, trattava anche le escursioni senza tempo come se avessero gia'
    // contribuito, diluendo il valore di default con "campioni" che in realta' non esistono.
    // Conta ogni osservazione temporale, con o senza movingTimeHours: mescola campioni "sul
    // tempo totale" (piu' vecchi, o senza gpx) e "sul solo cammino" (punto 79) nella stessa
    // media - una sottostima nota finche' non arrivano abbastanza completamenti puliti a
    // correggerla da soli, esattamente come oggi con un tempo assente. Un utente reale ha
    // pochissimi completamenti: lo script di ricalcolo (scripts/) e' la via per non aspettare.
    const priorTimedCompletions = await Completion.countDocuments({ userId: user._id, actualTimeHours: { $ne: null } });

    await Completion.create({
        userId: user._id,
        hikeId: hike._id,
        dateCompleted: new Date(),
        actualTimeHours: actualTimeHours ? Number(actualTimeHours) : null,
        movingTimeHours: (movingTimeHours && Number(movingTimeHours) > 0) ? Number(movingTimeHours) : undefined
    });

    // Aggiorna il passo personale (media incrementale) solo se e' stato dichiarato un tempo
    // reale - il completamento di gruppo (punto 64) non ne dichiara mai uno di default: Denis
    // non ha mai parlato di tempo/durata per quel flusso, riguarda solo "chi c'era".
    // REGOLA UNICA (punto 79): si usa il tempo di CAMMINO quando c'e', altrimenti si ripiega
    // sul totale - lo standard CAI con cui questo passo viene confrontato (calculateHikeTimes,
    // public/js/profile.js) e' gia' calcolato senza pause, quindi confrontarlo con un passo
    // "sporcato" dalle pause sarebbe un confronto fra due unita' di misura diverse.
    const oreEffettive = (movingTimeHours && Number(movingTimeHours) > 0) ? Number(movingTimeHours)
        : (actualTimeHours && Number(actualTimeHours) > 0) ? Number(actualTimeHours) : null;
    if (oreEffettive) {
        const observedPaceUp = hike.elevationGain / oreEffettive;

        const newPaceUp = ((user.averagePaceUp * priorTimedCompletions) + observedPaceUp) / (priorTimedCompletions + 1);
        const paceRatio = newPaceUp / user.averagePaceUp;

        user.averagePaceUp = Math.round(newPaceUp);
        user.averagePaceDown = Math.round(user.averagePaceDown * paceRatio);
    }

    user.completedHikes = (user.completedHikes || 0) + 1;

    // Ricalcola il livello di esperienza dalla cronologia reale, mai autodichiarato. Il passo
    // (averagePaceUp) conta solo se esiste almeno un tempo reale misurato (prima o adesso):
    // senza questo controllo il valore di default (350, uguale alla soglia "Intermedio"
    // sotto) promuoveva chiunque gia' alla primissima escursione completata, pure senza aver
    // mai dichiarato un tempo reale (bug trovato in Fase H).
    const hasRealPaceData = priorTimedCompletions > 0 || !!oreEffettive;
    if (user.completedHikes >= 10 || (hasRealPaceData && user.averagePaceUp >= 500)) {
        user.experienceLevel = 'Esperto';
    } else if (user.completedHikes >= 4 || (hasRealPaceData && user.averagePaceUp >= 350)) {
        user.experienceLevel = 'Intermedio';
    } else {
        user.experienceLevel = 'Principiante';
    }

    return true;
}

// Punto 64 - promemoria "il giorno dopo l'escursione, se il creatore non ha ancora fatto il
// completamento di gruppo". Aganciata a GET /api/notifications/:userId invece che a GET
// /api/hikes (che pure sarebbe un candidato, ma e' la rotta piu' chiamata in assoluto lato
// client): li' si scriverebbe sul database ad ogni chiamata anche per chi non ha mai creato
// nulla, e /:userId ha gia' verificato che userId sia proprio quello della sessione - lo
// stesso confine di autorizzazione basta a delimitare la query senza introdurne uno nuovo.
async function ensureCompletionReminders(userId) {
    // Componenti locali, MAI toISOString() (converte in UTC e puo' spostare il giorno vicino
    // alla mezzanotte) - stessa cautela gia' imparata al punto 58. hike.date e' gia' una
    // stringa "YYYY-MM-DD": il confronto e' fra due stringhe, il loro ordine lessicografico
    // coincide con quello cronologico.
    const oggi = new Date();
    const todayStr = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;

    // $lt, MAI $lte: e' esattamente "il giorno DOPO" (un'escursione datata oggi non genera
    // ancora il promemoria) - la ripetizione dell'errore gia' corretto al punto 58 sarebbe
    // usare new Date(hike.date) < new Date(), che segna "passato" dalla mezzanotte dello
    // stesso giorno, ore prima che l'escursione sia anche solo cominciata.
    const scadute = await Hike.find({
        creatorId: userId,
        groupCompletedAt: { $exists: false },
        date: { $lt: todayStr }
    });

    for (const hike of scadute) {
        // SENZA filtrare per "read": deve bloccare la ricreazione anche se l'utente l'ha
        // gia' letta, altrimenti si ricreerebbe un promemoria identico ogni giorno dopo
        // la lettura - esattamente il doppione che relatedHikeId esiste per evitare.
        const giaAvvisato = await Notification.findOne({ userId, relatedHikeId: hike._id });
        if (giaAvvisato) continue;

        // Non "di ieri" alla lettera: la notifica puo' restare li' per giorni prima di
        // essere gestita, e quel testo diventerebbe presto falso.
        await Notification.create({
            userId,
            text: `Non hai ancora completato l'escursione "${hike.title}": conferma chi ha partecipato!`,
            read: false,
            relatedHikeId: hike._id
        });
    }
}

module.exports = { applyHikeCompletionStats, ensureCompletionReminders };
