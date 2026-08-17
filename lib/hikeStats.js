// Punto 64 - estratto da routes/hikes.js (POST /:id/complete, fatta in Fase H) perche' la
// stessa matematica serve ora anche al completamento di GRUPPO: il creatore conferma N
// persone in un colpo solo, e ognuna ha bisogno esattamente delle stesse conseguenze
// (Completion, passo personale, livello esperienza) che prima si applicavano una alla
// volta, per auto-dichiarazione. Stessa idea gia' seguita per calculateHikeTimes() e
// statoBadgePer(): la logica si scrive una volta sola, i chiamanti decidono solo il "chi".
const Completion = require('../models/Completion');
const Hike = require('../models/Hike');
const Notification = require('../models/Notification');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const { passoDaOre } = require('../public/js/cai-tempi.js');

// IPOTESI DI CALCOLO, non un dato dell'utente. Dal 16/08/2026 questi due numeri NON sono
// piu' il default dello schema (models/User.js: default: undefined): un utente senza
// osservazioni vere non ha un passo, e mostrargli 350 m/h come "passo rilevato" e' una
// bugia (vincolo hard 7). Restano qui perche' servono comunque in due punti legittimi:
//  - il riscalamento di averagePaceDown, che non ha mai un'osservazione diretta (sotto);
//  - il tempo previsto di un'escursione (calculateHikeTimes, public/js/profile.js), dove un
//    divisore serve per forza: li' il numero si usa, ma NON si chiama "il tuo passo".
// Fonte unica anche per lo script di manutenzione (scripts/ricalcola-passo-personale.js).
const DEFAULT_PACE_UP = 350;
const DEFAULT_PACE_DOWN = 500;

// Punto 80/A - limiti di plausibilita' per SCARTARE un'osservazione assurda invece di
// lasciarla sporcare la media: un .gpx troncato (registrazione avviata a meta' salita), o
// dimenticato acceso al ritorno in auto, produce un dislivello/ora fuori da qualunque
// cammino umano reale. averagePaceUp e' un DIVISORE in calculateHikeTimes
// (public/js/profile.js): un'osservazione assurda non produce solo un numero sbagliato, ne
// produce uno che sembra una misura vera e non lo e' (vincolo hard 7). Si scarta, non si
// taglia (clampare nasconderebbe il dato assurdo dentro un numero plausibile).
const PACE_UP_MIN = 50;   // m/h - sotto qualunque passo umano reale, anche lentissimo
const PACE_UP_MAX = 1500; // m/h - sopra il record CAI in salita ripida
const ORE_MAX = 24;       // oltre un giorno intero, non e' piu' un tempo di cammino credibile

// L'UNICO punto in cui una misura (dislivello, distanza, ore di SOLO CAMMINO) diventa
// un'osservazione di passo - punto 92, decisione B di Denis. Non si divide piu'
// dislivello/ore: si INVERTE la formula di sintesi CAI (public/js/cai-tempi.js, condivisa
// col browser), perche' la divisione semplice mescola salita, discesa e piano nello stesso
// numero mentre lo standard CAI (400 m/h) descrive la sola salita - un escursionista che
// cammina esattamente come il CAI risultava misurato a ~267 m/h con la vecchia formula,
// sistematicamente piu' lento di quanto fosse davvero, qualunque fosse il suo carico o la
// sua velocita' reale. Con l'inversione, chi cammina esattamente come il CAI viene
// misurato a 400 in salita: la differenza che resta e' vera (zaino, fondo, stanchezza),
// non un artefatto della formula.
// @returns {number|null} null se fuori dai limiti di plausibilita' o fuori dal modello
//   (piu' veloce del solo riferimento in piano - vedi passoDaOre in cai-tempi.js)
function paceUpDaMisura(dislivelloM, distanzaKm, ore) {
    if (!(ore > 0) || ore > ORE_MAX) return null;
    if (!(dislivelloM > 0)) return null; // nessuna prova sul passo IN SALITA
    const paceUp = passoDaOre(dislivelloM, distanzaKm || 0, ore);
    if (paceUp == null || paceUp < PACE_UP_MIN || paceUp > PACE_UP_MAX) return null; // implausibile o fuori modello: si scarta, non si sporca la media
    return paceUp;
}

// Ricostruisce da zero (MAI incrementale) il passo personale di un utente dalle sue tracce
// GPS e dai suoi Completion oggi presenti sul database - punto 80/A, esteso al punto 92.
// Prima esistevano due strade diverse per lo stesso numero: questa funzione (media
// incrementale, un campione alla volta) e scripts/ricalcola-passo-personale.js
// (ricostruzione completa, dimostrata equivalente per induzione). Finche' girava solo a
// mano lo script, la divergenza si richiudeva al prossimo --scrivi; con le rotte di
// aggiunta/cancellazione online (routes/completions.js, routes/tracking.js) la
// ricostruzione gira ONLINE, e la media incrementale non e' invertibile - non c'e' modo di
// "togliere" un campione gia' mescolato dentro senza conoscere esattamente il suo valore
// originale. Un'unica matematica, richiamabile da chiunque cambi le osservazioni
// disponibili: questa.
//
// NON scrive nulla su "user": ritorna {osservazioni, nuovoPaceUp, nuovoPaceDown}, e' il
// chiamante a decidere se e quando applicarli (vedi applyPersonalPace sotto). Necessario
// perche' non tutti i chiamanti devono scrivere quando le osservazioni sono zero - lo
// script di manutenzione lascia invariati gli utenti demo del seed (passo assegnato a mano,
// nessuna prova a giustificarlo): scriverci sopra un --scrivi li cancellerebbe.
//
// ZERO OSSERVAZIONI => nuovoPaceUp/nuovoPaceDown valgono null, NON 350/500 (cambiato il
// 16/08/2026). "Nessuna prova" e "passo di 350 m/h" sono due cose diverse, e questa funzione
// e' l'unico posto che sa distinguerle: restituire il default qui significava che ogni
// chiamante finiva per scrivere un numero inventato addosso a un utente che non aveva mai
// camminato - il difetto segnalato da Denis sulla Dashboard di un account appena registrato.
async function recalculatePersonalPace(userId) {
    // TRACCE — la sorgente principale (punto 92). Niente filtro su status: movingTimeSec lo
    // scrivono solo /import-gpx e /:id/end (routes/tracking.js), che chiudono entrambi la
    // sessione, quindi "ha un tempo di cammino" implica gia' "e' conclusa". Il "-_id" serve
    // all'indice coprente (models/ActiveHikeSession.js): senza, MongoDB caricherebbe i
    // documenti interi (points compreso, il campo piu' pesante) per poi scartarli.
    const tracce = await ActiveHikeSession
        .find({ userId, movingTimeSec: { $gt: 0 }, elevationGainM: { $gt: 0 } })
        .select('-_id elevationGainM distanceKm movingTimeSec hikeId')
        .lean();

    // COMPLETAMENTI — solo con un tempo di cammino vero (decisione 2 del punto 92: i tempi
    // scritti a mano non fanno piu' passo, sparisce il ripiego su actualTimeHours che c'era
    // dal punto 79 in poi).
    const completamenti = await Completion.find({ userId, movingTimeHours: { $gt: 0 } }).select('hikeId movingTimeHours').lean();

    // Un'unica query $in invece di un Hike.findById per completamento: irrilevante alla
    // scala di un utente, ma con le rotte di gruppo (applyHikeCompletionStats chiamata una
    // volta per partecipante confermato, dentro la stessa richiesta HTTP) diventa una query
    // per persona per completamento. .lean() perche' qui serve solo leggere due numeri, non
    // un documento Mongoose completo - stesso principio del vincolo RAM.
    const hikeIds = completamenti.map(c => c.hikeId);
    const hikes = await Hike.find({ _id: { $in: hikeIds } }).select('elevationGain distanceKm').lean();
    const hikeById = new Map(hikes.map(h => [String(h._id), h]));

    // Punto 92, regola anti-doppio-conteggio: dove il collegamento traccia->escursione
    // esiste gia' (hikeId sulla traccia), vince la traccia - e' la misura diretta, il
    // Completion per la stessa escursione non produce una seconda osservazione. Dove il
    // collegamento non c'e' (nessun abbinamento automatico per data: scartato, avrebbe
    // confuso montagne diverse sui dati veri di Denis - stesso errore del punto 32), le due
    // restano indipendenti - decisione 4 di Denis: pesano un po' doppio nella media, ma non
    // producono mai un valore falso.
    //
    // L'insieme si costruisce SOLO dalle tracce che hanno gia' superato paceUpDaMisura (sotto),
    // mai da tracce.filter(...) sui dati grezzi: una traccia implausibile (troncata, dimenticata
    // accesa in auto) ha un hikeId ma NESSUNA osservazione - lasciarla comunque nell'insieme
    // zittirebbe un Completion valido senza che nessuna traccia "vinca" per davvero, il difetto
    // opposto a quello che questa regola vuole evitare (trovato dal test-engineer verificando il
    // punto 92, prima di qualunque uso in produzione).
    const hikeIdConTraccia = new Set();
    const osservazioni = [];

    for (const t of tracce) {
        const paceUp = paceUpDaMisura(t.elevationGainM, t.distanceKm, t.movingTimeSec / 3600);
        if (paceUp == null) continue;
        osservazioni.push({ paceUp, fonte: 'traccia' });
        if (t.hikeId) hikeIdConTraccia.add(String(t.hikeId));
    }

    for (const c of completamenti) {
        if (hikeIdConTraccia.has(String(c.hikeId))) continue; // gia' contata dalla traccia collegata

        const hike = hikeById.get(String(c.hikeId));
        if (!hike) continue; // escursione cancellata

        const paceUp = paceUpDaMisura(hike.elevationGain, hike.distanceKm, c.movingTimeHours);
        if (paceUp == null) continue;
        osservazioni.push({ paceUp, fonte: 'completamento' });
    }

    if (osservazioni.length === 0) {
        return { osservazioni, nuovoPaceUp: null, nuovoPaceDown: null };
    }

    const nuovoPaceUp = Math.round(osservazioni.reduce((s, o) => s + o.paceUp, 0) / osservazioni.length);
    // averagePaceDown non ha una sua osservazione diretta (il sito non la misura mai da
    // sola): resta il default riscalato nella stessa proporzione in cui e' cambiato
    // averagePaceUp - identico al criterio gia' in uso prima di questa funzione.
    const nuovoPaceDown = Math.round(DEFAULT_PACE_DOWN * (nuovoPaceUp / DEFAULT_PACE_UP));

    return { osservazioni, nuovoPaceUp, nuovoPaceDown };
}

// Applica a un documento utente GIA' caricato il risultato di recalculatePersonalPace.
// Esiste per non lasciare a ogni chiamante la parte piu' facile da sbagliare: cosa scrivere
// quando non c'e' niente da scrivere. Zero osservazioni non vuol dire "350": vuol dire che
// il campo non deve esistere, cosi' chi legge (Dashboard, profilo, API) non puo' scambiare
// un'ipotesi di calcolo per una misura.
// set(..., undefined) su un documento Mongoose produce un $unset vero (verificato su
// mongoose 9.8 con $getChanges(): {"$unset":{"averagePaceUp":1,"averagePaceDown":1}}), e
// toJSON smette di esporre il campo - quindi anche la risposta della rotta che ritorna
// "user" dice subito la verita' al frontend, senza un secondo giro.
// NON salva: il salvataggio resta a chi chiama, come per applyHikeCompletionStats.
function applyPersonalPace(user, risultato) {
    if (risultato.nuovoPaceUp == null) {
        user.set('averagePaceUp', undefined);
        user.set('averagePaceDown', undefined);
        return;
    }
    user.averagePaceUp = risultato.nuovoPaceUp;
    user.averagePaceDown = risultato.nuovoPaceDown;
}

// Ricalcola il livello di esperienza dalla cronologia reale, mai autodichiarato - estratta
// perche' ora la stessa soglia serve sia dopo un nuovo completamento sia dopo una
// cancellazione (routes/completions.js, punto 80/A), dove completedHikes/averagePaceUp
// possono anche SCENDERE. Non e' un badge: e' un valore derivato che entra nella
// percezione di difficolta' di un'escursione (idoneita'), quindi puo' retrocedere - un
// "Esperto" ormai senza prove sbaglierebbe nella direzione pericolosa.
// hasRealPaceData: il passo (averagePaceUp) conta per le soglie solo se esiste almeno
// un'osservazione vera dietro - senza questo controllo il valore di default (350, uguale
// alla soglia "Intermedio") promuoverebbe chiunque gia' alla primissima escursione
// completata, pure senza aver mai dichiarato un tempo reale (bug trovato in Fase H).
function recalculateExperienceLevel(user, hasRealPaceData) {
    if (user.completedHikes >= 10 || (hasRealPaceData && user.averagePaceUp >= 500)) {
        user.experienceLevel = 'Esperto';
    } else if (user.completedHikes >= 4 || (hasRealPaceData && user.averagePaceUp >= 350)) {
        user.experienceLevel = 'Intermedio';
    } else {
        user.experienceLevel = 'Principiante';
    }
}

// Ricalcola il passo personale di un utente GIA' caricato e applica subito le conseguenze
// (passo, livello di esperienza), salvando. Punto 92: lo stesso blocco di quattro righe
// (ricalcola, applica, ricalcola livello, salva) viveva gia' due volte identico in
// routes/completions.js prima di aggiungere qui i tre agganci nuovi di routes/tracking.js
// (import-gpx, fine tracciamento, cancellazione traccia) - lezione del punto 18, non farne
// cinque copie. Diversa da applyHikeCompletionStats sopra: qui il salvataggio e' sempre
// immediato (nessun altro campo da accodare nella stessa scrittura, a differenza del
// completamento di gruppo che deve sommarci anche completedHikes).
async function recalculateAndApplyPace(user) {
    const risultato = await recalculatePersonalPace(user._id);
    applyPersonalPace(user, risultato);
    recalculateExperienceLevel(user, risultato.osservazioni.length > 0);
    await user.save();
    return risultato;
}

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

    await Completion.create({
        userId: user._id,
        hikeId: hike._id,
        dateCompleted: new Date(),
        actualTimeHours: actualTimeHours ? Number(actualTimeHours) : null,
        movingTimeHours: (movingTimeHours && Number(movingTimeHours) > 0) ? Number(movingTimeHours) : undefined
    });

    // Punto 80/A: passo personale ricostruito da zero (mai incrementale) - vedi
    // recalculatePersonalPace sopra. Si scrive solo se e' rimasta almeno un'osservazione:
    // il completamento di gruppo (punto 64) non dichiara mai un tempo di default, quindi
    // per un partecipante senza NESSUN tempo reale (ne' ora ne' prima) osservazioni resta
    // vuoto e il passo non deve muoversi. Il guard vale ancora di piu' da quando zero
    // osservazioni significa "togli il campo": un completamento di gruppo su un account demo
    // gli cancellerebbe il passo assegnato a mano invece di lasciarlo dov'e'.
    const risultato = await recalculatePersonalPace(user._id);
    if (risultato.osservazioni.length > 0) {
        applyPersonalPace(user, risultato);
    }

    user.completedHikes = (user.completedHikes || 0) + 1;
    recalculateExperienceLevel(user, risultato.osservazioni.length > 0);

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

module.exports = {
    applyHikeCompletionStats,
    ensureCompletionReminders,
    recalculatePersonalPace,
    applyPersonalPace,
    recalculateExperienceLevel,
    recalculateAndApplyPace,
    paceUpDaMisura,
    DEFAULT_PACE_UP,
    DEFAULT_PACE_DOWN
};
