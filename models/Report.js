const { mongoose } = require('../db/mongo');
const { prossimaScadenza } = require('../lib/scadenzaSegnalazioni');

const reportSchema = new mongoose.Schema({
    type: { type: String, enum: ['frana', 'ghiaccio', 'fontana_secca', 'ostacolo'], required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    description: String,
    // Punto 45: 'pending' finche' un moderatore non la conferma. Il default e' fail-closed
    // per qualunque creazione futura che dimenticasse di specificare lo stato - oggi non
    // cambia nulla in pratica: sia POST /api/reports sia scripts/seed-atlas.js impostano
    // sempre lo stato esplicitamente.
    status: { type: String, enum: ['pending', 'active', 'resolved'], default: 'pending' },
    // Chi ha segnalato: puo' restare vuoto per segnalazioni pre-Fase-C o volutamente anonime
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Punto 45 (foto): Buffer e non stringa base64 (~25% piu' leggero, mai costruito in RAM
    // se non richiesto). select:false come passwordHash - non deve uscire nelle liste
    // (GET /, GET /pending), solo dalla rotta dedicata GET /:id/photo. NON vale pero' per il
    // documento appena creato da Report.create() nella stessa richiesta: va tolta a mano
    // prima di res.json() li' (vedi routes/reports.js).
    photo: { type: Buffer, select: false },
    // Derivato, scritto solo alla creazione: default: undefined come canModerateReports in
    // User.js (vincolo spazio) - la maggioranza delle segnalazioni non ha foto.
    hasPhoto: { type: Boolean, default: undefined },

    // --- (A) Richiesta di risoluzione (punto 111) ---
    // NON e' un nuovo status: la segnalazione resta 'active' e continua a comparire in mappa
    // mentre aspetta la decisione di Denis (il pericolo potrebbe esserci ancora). "Risolvi"
    // fatto da un utente normale valorizza questi due campi e manda una notifica; Denis poi
    // conferma (si cancella) o "tiene ancora" ($unset di entrambi).
    // default: undefined - la maggioranza delle segnalazioni non ha una richiesta aperta.
    resolutionRequestedAt: { type: Date, default: undefined },
    resolutionRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },

    // --- (B) Scadenza esplicita (punto 111) ---
    // Sostituisce la dipendenza dall'indice TTL su createdAt (che sapeva solo cancellare):
    // questo campo si puo' spostare avanti col "Rinnova +90gg". Ha un default VERO e non
    // `undefined`: OGNI segnalazione ne ha una, e un documento senza expiresAt sarebbe
    // invisibile sia al controllo scadenze sia al paracadute TTL (Mongo salta i documenti in
    // cui il campo non e' una data) = immortale in silenzio. Il default a livello di schema
    // copre anche scripts/seed-atlas.js, che crea Report senza passare dalla rotta.
    expiresAt: { type: Date, required: true, default: () => prossimaScadenza() },

    // Guardia anti-doppione: il controllo scadenze gira spesso, la notifica di scadenza si
    // crea UNA volta sola. Il rinnovo lo azzera ($unset), cosi' fra 90 giorni riavvisa.
    // default: undefined - vale solo dopo che una segnalazione e' scaduta senza decisione.
    expiryNotifiedAt: { type: Date, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

// Punto 111: PARACADUTE, non il meccanismo di scadenza. La scadenza vera e' il campo
// `expiresAt` qui sopra + la decisione di Denis (rinnova / togli): alla scadenza parte una
// notifica, non una cancellazione. Fino al 28/08/2026 qui c'era un TTL su `createdAt` (90
// giorni, punti 45/109) che cancellava e basta.
//
// Perche' su `expiresAt` e non su `createdAt`: cosi' si sposta insieme ai rinnovi (+90gg),
// mentre un TTL su `createdAt` ucciderebbe comunque una segnalazione rinnovata 8 volte.
// A 365 giorni: cancella solo cio' che NESSUNO ha piu' toccato per un anno intero DOPO la
// scadenza - e' l'unico limite alla crescita della collezione `reports` (le foto pesano,
// vincolo hard 1). Questo stesso indice serve anche alla query del controllo scadenze
// (lib/reportAlerts.js), quindi non e' un indice in piu'.
//
// SUL DATABASE ESISTENTE la sostituzione (backfill di `expiresAt` + drop di `createdAt_1` +
// create di `expiresAt_1`) la fa la migrazione una tantum
// scripts/scadenza-segnalazioni-esplicita.js, da lanciare DOPO che questo file e' in
// produzione (con `autoIndex` attivo, deployare prima evita che un riavvio ricrei il TTL
// vecchio). Su questo utente Atlas: dropIndex + createIndex, mai `collMod` (negato) -
// trappola in ../camoscio memoria/07-Trappole-Tecniche.md.
reportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
