const { mongoose } = require('../db/mongo');

// PUNTO 13 - Un percorso progettato e messo da parte.
//
// DECISIONE 2 DELL'UTENTE (2026-07-27): bozza PERSONALE riapribile, NON collegata a
// un'escursione e non visibile ai partecipanti. Collegarla a un'escursione sara' semmai un
// passo successivo, e tenerle separate adesso vuol dire non doverle scollegare dopo.
//
// SI SALVANO SOLO I PUNTI SCELTI, NON IL PERCORSO CALCOLATO. E' la scelta che conta qui:
// un percorso di pochi chilometri ha centinaia di coordinate (l'esempio dell'utente ne ha
// 354), mentre i punti scelti sono due o tre. Riaprendo la bozza il percorso si ricalcola
// in poco piu' di un secondo, e c'e' il vincolo hard sullo spazio in cima a cose_da_fare.txt.
// In piu' ha un vantaggio che non si vede subito: se un domani i dati dei sentieri
// migliorano, una bozza riaperta trova il percorso NUOVO - se avessimo salvato la linea
// resterebbe congelata quella vecchia.
// I due totali si salvano lo stesso, ma solo per poterli mostrare nell'ELENCO senza
// ricalcolare tutte le bozze ogni volta che si apre il pannello.
const routeDraftSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    nome: { type: String, required: true, maxlength: 80 },
    // [[lng, lat], ...] nell'ordine in cui l'utente li ha toccati sulla mappa.
    punti: { type: [[Number]], required: true },
    // Spento quando l'utente ha scelto di collegare i punti sempre in linea retta: e' la
    // modalita' che aveva chiesto per le zone senza sentieri mappati. Riaprendo la bozza
    // deve tornare come l'aveva lasciata, altrimenti il percorso ricalcolato sarebbe un altro.
    agganciaAiSentieri: { type: Boolean, default: true },
    // Solo per l'elenco (vedi sopra). Non sono la verita': la verita' si ricalcola.
    metriTotali: { type: Number, default: 0 },
    metriRetta: { type: Number, default: 0 }
}, { timestamps: { createdAt: 'creataIl', updatedAt: false } });

module.exports = mongoose.models.RouteDraft || mongoose.model('RouteDraft', routeDraftSchema);
