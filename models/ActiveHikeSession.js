const { mongoose } = require('../db/mongo');

// Fase F - Tracciamento GPS live. Collezione volutamente SEPARATA da "hikes": un
// aggiornamento continuo del percorso durante l'escursione non deve mai poter
// sovrascrivere per errore gli altri dati dell'escursione (titolo, partecipanti...).
//
// Ogni punto e' salvato come tupla compatta [lng, lat, altitudineMetri, secondiDaInizio,
// precisioneMetri] invece che come oggetto con chiavi ripetute per ogni punto: stesso
// contenuto, molto meno spazio (vincolo hard di cose_da_fare.txt).
const activeHikeSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', default: null },
    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
    startedAt: { type: Date, required: true, default: Date.now },
    lastPointAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    // Totali incrementali: aggiornati ad ogni gruppo di punti ricevuto invece di essere
    // ricalcolati dall'inizio ogni volta (fondamentale per restare performanti anche
    // su un'escursione di piu' ore con migliaia di punti).
    distanceKm: { type: Number, default: 0 },
    elevationGainM: { type: Number, default: 0 },
    // La quota piu' bassa vista da quando si sta salendo: e' l'UNICO pezzo di memoria che
    // serve per applicare dal vivo la stessa regola del dislivello usata per i file .gpx.
    // Quella regola guarda quanto si e' saliti in tutto sopra l'ultimo avvallamento, non il
    // salto fra due punti consecutivi - e sembrava impossibile da usare qui, perche' dal
    // vivo i punti arrivano a gruppi e non si puo' guardare tutta la traccia insieme.
    // Si puo' invece: alla regola basta ricordare due numeri, il totale (elevationGainM) e
    // questo. Tenendoli sulla sessione, il conto fatto gruppo per gruppo da' ESATTAMENTE lo
    // stesso risultato di una passata sola su tutta la traccia.
    // default: undefined perche' il primo gruppo di punti la imposta, e perche' un campo
    // scritto quando non serve e' spazio buttato (vincolo hard).
    elevationRefM: { type: Number, default: undefined },
    points: { type: [[Number]], default: [] },
    // Presente (sempre true) solo mentre la sessione e' aperta (active/paused); rimosso
    // alla chiusura (vedi POST /:id/end). Serve per l'indice unico parziale sotto: un
    // utente non puo' avere due tracciamenti aperti insieme, e la stessa query serve
    // anche per "riprendi dopo ricaricamento" (GET /api/tracking/active).
    // NIENT'ALTRO default qui di proposito: /start lo imposta esplicitamente a true in
    // fase di creazione. Con un default a livello di schema, Mongoose lo rimetterebbe
    // a true ogni volta che legge un documento a cui e' stato tolto con $unset, facendo
    // sembrare "ancora aperta" (nella risposta JSON, non nel database) anche una
    // sessione gia' conclusa da tempo.
    openSession: { type: Boolean },
    // Tempo totale gia' passato in pausa + il momento in cui e' iniziata la pausa corrente
    // (null se non in pausa): serve per escludere le pause dal calcolo della durata, cosi'
    // il passo medio a fine escursione non viene falsato da una sosta lunga (es. pranzo).
    pausedMs: { type: Number, default: 0 },
    pausedAt: { type: Date, default: null },
    // Fase G: punti recenti non ancora agganciati a nessun sentiero noto, in attesa di
    // capire se e' solo rumore GPS momentaneo o un tratto davvero non mappato (vedi
    // snapAndBufferPoints in routes/tracking.js) - vuoto quasi sempre, si riempie solo
    // durante un tratto fuori sentiero e si svuota appena si torna su uno conosciuto.
    offTrailBuffer: { type: [[Number]], default: [] },

    // --- Punto 15: tracce arrivate da un file .gpx invece che dal GPS del telefono ---
    // default: undefined e NON null/false, stesso criterio di shareable/covers al punto 24:
    // con un default vero Mongoose scriverebbe il campo su OGNI sessione registrata dal
    // vivo, che sono la stragrande maggioranza e a cui non aggiunge niente. C'e' il vincolo
    // hard sullo spazio in cima a cose_da_fare.txt.
    // Serve a due cose: contare quanti file un utente ha caricato nel mese (il tetto sta in
    // routes/tracking.js) e dire a schermo quali uscite sono importate invece che
    // registrate - due cose diverse che e' giusto non far sembrare uguali.
    importedFrom: { type: String, enum: ['gpx'], default: undefined },
    // Punto 15 -> 115: il NOME dell'uscita. All'import prende il <name> del file .gpx quando
    // c'e' (il .fit non ne ha uno, punto 114); da lì in poi il proprietario può cambiarlo
    // (PATCH /sessions/:id/name, o al momento della pubblicazione) - serve perché un nome
    // auto-generato da un orologio è spesso illeggibile ("Move 2026-... Trail running") e
    // perché senza, in elenco e nel feed l'uscita è solo una data. Vale per QUALSIASI
    // uscita, anche quelle registrate dal vivo (non solo le importate). NON è il nome del
    // file caricato (spesso un codice tipo "activity_1234567.gpx"). Assente = si mostra la
    // data. default: undefined, scritto solo quando c'e' davvero un nome (vincolo spazio).
    importedName: { type: String, default: undefined, maxlength: 120 },
    // Presente (true) solo sulle tracce importate da un file SENZA gli orari dei punti,
    // accettate su decisione dell'utente del 2026-07-27 invece di essere respinte.
    // Di queste uscite si sanno distanza e dislivello - che stanno nel file e sono veri -
    // ma NON la durata, e quindi nemmeno la velocita'. Il campo serve a una cosa sola ma
    // essenziale: farle SALTARE dal tempo totale e dalla velocita' media in
    // GET /api/tracking/totals. Senza, una durata pari a zero entrerebbe nella somma e
    // gonfierebbe la velocita' media di tutto lo storico - che era esattamente la ragione
    // per cui prima questi file venivano rifiutati.
    // default: undefined come importedFrom/importedName e come shareable/covers al punto
    // 24: scritto solo dove serve, mai sulle sessioni normali (vincolo hard sullo spazio).
    durationUnknown: { type: Boolean, default: undefined },

    // --- Punto 92: tempo di SOLO CAMMINO, separato dalle pause ---
    // Calcolato UNA VOLTA SOLA, al momento dell'import o della fine tracciamento, sui punti
    // COMPLETI (prima di simplifyTrack) - mai piu' ricalcolato dopo. Non e' recuperabile in
    // seguito: dopo la semplificazione (~8m) il campionamento scende a 130-230 secondi/punto,
    // troppo rado per lib/gpx.js:tempiTraccia (soglia 60s) - verificato su tutte e 7 le
    // tracce vere di Denis, avrebbe dato zero osservazioni.
    // ASSENTE = non misurabile (traccia troppo rada, troppo corta, o senza orari), MAI zero:
    // default undefined come importedFrom/durationUnknown, vincolo hard sullo spazio. Una
    // traccia creata prima di questo campo e' assente per lo stesso motivo (non c'e' modo di
    // distinguerla da una "non attendibile" spendendo altro spazio, e non serve: l'_id
    // contiene gia' il momento di creazione).
    movingTimeSec: { type: Number, default: undefined },

    // --- Punto 113: uscita pubblicata nel feed dei follower ---
    // publishedAt assente = non nel feed. Presente = visibile a chi segue l'autore, e ordina
    // il feed (piu' recente prima). Spubblicare fa $unset di entrambi - MAI assegnare
    // undefined e save(), stessa trappola gia' annotata su openSession qui sopra.
    // caption e' testo scritto dall'utente: non si traduce (punto 102), a schermo sempre via
    // escapeHtml. default: undefined su entrambi (vincolo hard sullo spazio, come
    // importedFrom/durationUnknown qui sopra: scritti solo sulle poche uscite dove servono).
    // Indice PARZIALE su publishedAt: passo 5.
    publishedAt: { type: Date, default: undefined },
    caption: { type: String, default: undefined, maxlength: 500 }
});

activeHikeSessionSchema.index(
    { userId: 1, openSession: 1 },
    { unique: true, partialFilterExpression: { openSession: true } }
);

// Punto 92: indice COPRENTE per recalculatePersonalPace (lib/hikeStats.js), che legge solo
// le tracce con un tempo di movimento misurato. Senza, MongoDB caricherebbe i documenti
// INTERI (points compreso, il campo piu' pesante) per poi scartare i campi non richiesti -
// e quella funzione gira una volta per partecipante dentro complete-group (routes/hikes.js),
// quindi il costo si moltiplica dentro una sola richiesta HTTP. Parziale (solo le tracce con
// movingTimeSec > 0: oggi 7 documenti in tutto) perche' un indice non parziale conterrebbe
// ogni sessione mai registrata, per niente - stesso principio dell'indice unico sopra.
// Per restare coprente la query non deve MAI proiettare _id (non e' nell'indice) ne'
// filtrare su status: movingTimeSec lo scrivono solo /import-gpx e /:id/end, che chiudono
// entrambi la sessione, quindi "ha un tempo di cammino" implica gia' "e' conclusa".
activeHikeSessionSchema.index(
    { userId: 1, movingTimeSec: 1, elevationGainM: 1, distanceKm: 1, hikeId: 1 },
    { partialFilterExpression: { movingTimeSec: { $gt: 0 } } }
);

// Punto 113: la query del feed - le uscite pubblicate di un gruppo di autori ($in su
// userId), ordinate per publishedAt decrescente. PARZIALE come i due indici qui sopra
// (openSession, movingTimeSec): le uscite pubblicate sono una piccola frazione, un indice
// pieno porterebbe un'entrata per ogni sessione mai registrata, per niente.
activeHikeSessionSchema.index(
    { userId: 1, publishedAt: -1 },
    { partialFilterExpression: { publishedAt: { $exists: true } } }
);

// Durata calcolata dal dato reale (ultimo punto ricevuto), non dall'orologio di sistema:
// se il telefono perde segnale o il browser viene chiuso, il tempo "conta" solo fino
// all'ultimo aggiornamento davvero arrivato. Il tempo in pausa (passato e, se la sessione
// e' in pausa proprio ora, anche quello in corso) viene escluso dal totale.
activeHikeSessionSchema.virtual('durationSeconds').get(function () {
    if (!this.startedAt) return 0;
    const end = this.endedAt || this.lastPointAt || new Date();

    let pausedTotalMs = this.pausedMs || 0;
    if (this.pausedAt && !this.endedAt) {
        pausedTotalMs += (Date.now() - this.pausedAt.getTime());
    }

    return Math.max(0, Math.round((end.getTime() - this.startedAt.getTime() - pausedTotalMs) / 1000));
});

// Non salvata su disco: si ricava da distanza e durata gia' salvate, non serve un campo dedicato.
activeHikeSessionSchema.virtual('avgSpeedKmh').get(function () {
    const hours = this.durationSeconds / 3600;
    if (!hours) return 0;
    return Math.round((this.distanceKm / hours) * 10) / 10;
});

module.exports = mongoose.models.ActiveHikeSession || mongoose.model('ActiveHikeSession', activeHikeSessionSchema);
