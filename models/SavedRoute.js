const { mongoose } = require('../db/mongo');

// PUNTO 113, passo 8 - un percorso COPIATO dalla traccia di un'uscita, per riusarlo.
// "Crea percorso" sulla pagina di un'uscita (decisioni 4-5 di Denis del 29/08/2026): la
// linea si rivede sulla mappa, si allega a una propria escursione futura, e si segue dal
// vivo SOLO come linea disegnata (nessun avviso di fuori-percorso - vincolo 7).
//
// NON e' un RouteDraft. RouteDraft dichiara in testa al file: "si salvano solo i punti
// scelti (2-25 cliccati), mai la polyline, si ricalcola all'apertura". Una traccia copiata
// e' l'opposto: nessun waypoint scelto, una linea vera gia' camminata, niente da
// ricalcolare - forzarla dentro RouteDraft romperebbe ogni invariante di routeplanner.js
// (apriBozza -> /api/routing/plan, che accetta 2-25 punti).
//
// INDIPENDENTE DALL'USCITA SORGENTE: si copia la geometria alla creazione e NON si salva
// nessun sessionId. Se l'autore cancella o spubblica l'uscita, o si smette di seguirlo, il
// percorso salvato resta.
//
// DISCIPLINA SPAZIO (unico posto dove il progetto persiste una polyline vera):
// - simplifyTrack piu' grezzo (~18 m) degli ~8 m d'archivio: una linea DA SEGUIRE non
//   serve di precisione topografica;
// - solo [lng, lat] per punto, si scartano quota/tempo/precisione (~40% di byte in meno);
// - tetto MAX_PUNTI_PERCORSO sui punti e MAX_PERCORSI_SALVATI sui documenti per utente
//   (specchio di MAX_BOZZE), entrambi in routes/routing.js.
const savedRouteSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    nome: { type: String, required: true, maxlength: 80 },
    // [[lng, lat], ...] - la traccia copiata, gia' semplificata e ridotta a due numeri.
    punti: { type: [[Number]], required: true },
    // Chi ha camminato la traccia da cui questo percorso e' stato copiato. origineUsername
    // tenuto a parte perche' l'etichetta "da DaniWoll" resti leggibile anche se quell'account
    // cambia nome o sparisce - stesso motivo per cui altrove si conservano i nomi accanto
    // agli id. default: undefined (vincolo spazio): un percorso disegnato a mano un domani
    // non li avrebbe.
    origineUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    origineUsername: { type: String, default: undefined },
    // Copiati dall'uscita alla creazione, SOLO per l'elenco "I miei progetti" (evita di
    // ricalcolarli a ogni apertura del pannello) e, al passo 9, per il ramo "quote a mano"
    // del punto 93 quando quotaMaxM manca. default: undefined come i totali di RouteDraft:
    // assente vuol dire "non si sa", non "zero".
    distanzaKm: { type: Number, default: undefined },
    dislivelloM: { type: Number, default: undefined },
    quotaMaxM: { type: Number, default: undefined }
}, { timestamps: { createdAt: 'creatoIl', updatedAt: false } });

module.exports = mongoose.models.SavedRoute || mongoose.model('SavedRoute', savedRouteSchema);
