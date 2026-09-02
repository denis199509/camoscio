const { mongoose } = require('../db/mongo');

const peakSchema = new mongoose.Schema({
    name: String,
    lat: Number,
    lng: Number,
    altitude: Number,
    stampId: String
}, { _id: false });

const driverSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    seats: Number,
    // maxlength: A-2 della security review 21a - senza un tetto, un client che chiama la
    // rotta a mano puo' scrivere stringhe enormi qui e riempire i 512 MB di Atlas. 100 e'
    // largo per un "comune / zona di partenza" vero.
    departureCity: { type: String, maxlength: 100 },
    distanceKm: Number,
    pricePerPassenger: Number,
    // Trovato per strada al punto 98/C (non richiesto all'epoca, annotato per dopo): il
    // frontend ("Sali a Bordo", joinCarpoolGroup in public/js/carpool.js) scrive gia' su
    // questo campo, e canNonCreatorEditCarpool (routes/hikes.js) gestisce gia' i permessi
    // giusti (solo se stesso) - ma senza dichiararlo qui Mongoose lo scartava in silenzio a
    // ogni salvataggio, quindi il passeggero spariva al primo refreshState().
    passengers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: undefined }
}, { _id: false });

const backpackItemSchema = new mongoose.Schema({
    // maxlength: A-2 della security review 21a - stesso motivo di driverSchema.departureCity,
    // un articolo dello zaino ha un nome corto, 80 e' gia' abbondante.
    name: { type: String, maxlength: 80 },
    // maxlength: A-NUOVO-4 residuo (3° giro) - `category` era l'ultimo campo testo dei
    // sotto-doc zaino senza tetto. Etichetta corta ("Cucina", "Sicurezza"): 40 e' largo.
    // Come per `name`, sui findByIdAndUpdate il controllo vero e' nella rotta (routes/hikes.js).
    category: { type: String, maxlength: 40 },
    mandatory: Boolean,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    weight: Number,

    // --- Punto 24 di cose_da_fare.txt: personale o condivisibile ---
    // Un oggetto PERSONALE lo deve avere ognuno (giacca, acqua, cibo): dividerlo fra i
    // membri non ha senso, e infatti la ripartizione dei pesi lo faceva - arrivando a
    // "assegnare" a una persona sola la giacca di tutti.
    // Un oggetto CONDIVISIBILE lo porta uno per tutti (fornello, tenda, kit di primo
    // soccorso), e li' la ripartizione serve davvero.
    //
    // default: undefined e NON false, di proposito. Con false Mongoose scriverebbe il
    // campo su OGNI oggetto di OGNI escursione anche quando non aggiunge niente, e c'e'
    // il vincolo hard sullo spazio in cima a cose_da_fare.txt. Quando manca, la
    // classificazione la fa il catalogo per parole chiave in public/js/backpack.js:
    // cosi' gli oggetti gia' salvati continuano a funzionare senza nessuna migrazione.
    shareable: { type: Boolean, default: undefined },

    // --- Punto 25: quante persone copre ---
    // Serve agli oggetti condivisi che bastano per un numero limitato di persone: una
    // tenda da 3 posti non copre un gruppo di 4. Vale in generale, non solo per le tende.
    // Assente = copre tutti (un fornello basta al gruppo, non ha una "portata").
    covers: { type: Number, default: undefined, min: 1 }
}, { _id: false });

const hikeSchema = new mongoose.Schema({
    // maxlength: A-NUOVO-4 della ri-review sicurezza (2° giro). title/description erano gli
    // unici campi testo di Hike senza tetto, ed e' da li' che si riempirebbero i 512 MB di
    // Atlas (POST /api/hikes). Qui Hike.create() li applica davvero (a differenza dei
    // sotto-documenti degli array su findByIdAndUpdate - vedi routes/hikes.js).
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 2000 },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    difficulty: {
        type: String,
        enum: ['Principiante', 'Intermedio', 'Esperto']
    },
    maxAltitude: Number,
    distanceKm: Number,
    elevationGain: Number,
    date: String, // "YYYY-MM-DD", stesso formato usato oggi dal frontend
    tribeTags: [String],
    manualApproval: { type: Boolean, default: false },
    // Escursione di piu' giorni (rifugio/tenda): la decide il CREATORE in creazione/modifica.
    // Sblocca nel tab Zaino di hike-page la sezione "Zaino condivisibile" (tenda per N,
    // ripartizione dei pesi fra il gruppo). Assente = escursione in giornata: lo zaino resta
    // solo la lista personale privata di ognuno. default: undefined e NON false di proposito -
    // con false Mongoose scriverebbe il campo su OGNI documento anche quando non aggiunge
    // informazione, e c'e' il vincolo hard sullo spazio MongoDB (vedi 02-Vincoli-Hard del vault).
    multiDay: { type: Boolean, default: undefined },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pendingApproval: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    trailhead: {
        lat: Number,
        lng: Number,
        name: String
    },
    // Stessa posizione del trailhead, in formato GeoJSON: abilita ricerche "escursioni vicine a me"
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: undefined } // [lng, lat]
    },
    peaks: [peakSchema],
    // --- Punto 43: percorso reale al posto di quota/dislivello/distanza scritti a mano ---
    // Assente = tutto scritto a mano dal creatore, comportamento di sempre (l'inserimento
    // manuale resta, per richiesta esplicita). Presente, e' la PROVA che i tre numeri qui
    // sopra sono stati CALCOLATI da un progetto o da una traccia importata, non dichiarati -
    // stessa distinzione gia' fatta per importedFrom/importedName su ActiveHikeSession.
    // Non e' un riferimento vivo (niente draftId salvato): solo un'etichetta, presa una
    // volta al momento del calcolo - se la bozza viene poi cancellata i tre numeri restano
    // comunque validi. Serve anche al punto 44: senza un percorso reale il tempo previsto
    // resta "non disponibile".
    routeSource: {
        type: new mongoose.Schema({
            // 'saved' (punto 113 passo 9): un percorso copiato da una traccia altrui
            // (models/SavedRoute.js). Come 'draft'/'gpx' e' solo un'etichetta presa una
            // volta - i tre numeri qui sopra restano validi anche se poi il SavedRoute
            // viene cancellato.
            kind: { type: String, enum: ['draft', 'gpx', 'saved'], required: true },
            nome: { type: String, required: true },
            // Il progetto c'e' e il tracciato/la distanza vengono da lui, ma quota massima e
            // dislivello li ha scritti il creatore perche' la fonte delle quote non
            // rispondeva (o il percorso era oltre i 25 km, dove la fonte non si puo' usare).
            // Assente = tutto calcolato, come sempre - stesso principio di default undefined
            // gia' seguito da questo stesso sotto-schema (vincolo hard sullo spazio).
            dislivelloManuale: { type: Boolean, default: undefined }
        }, { _id: false }),
        default: undefined
    },
    carpool: {
        fuelPrice: Number,
        fuelConsumption: Number,
        tollCost: Number,
        drivers: [driverSchema]
    },
    backpackTemplate: [backpackItemSchema],
    // Punto 64: valorizzato quando il CREATORE conferma il completamento di gruppo (tasto
    // "Completa escursione", POST /:id/complete-group) - risponde a "il creatore ha gia'
    // fatto la conferma di gruppo?", cosa diversa da "esiste un Completion" (che puo' essere
    // vero anche senza che il creatore abbia mai usato quel tasto, per auto-dichiarazione).
    // Serve sia a nascondere il tasto dopo l'uso sia a fermare il promemoria del giorno dopo.
    groupCompletedAt: { type: Date, default: undefined }
});

hikeSchema.index({ location: '2dsphere' });

module.exports = mongoose.models.Hike || mongoose.model('Hike', hikeSchema);
