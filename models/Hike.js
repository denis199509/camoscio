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
    departureCity: String,
    distanceKm: Number,
    pricePerPassenger: Number
}, { _id: false });

const backpackItemSchema = new mongoose.Schema({
    name: String,
    category: String,
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
    title: { type: String, required: true },
    description: String,
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
    carpool: {
        fuelPrice: Number,
        fuelConsumption: Number,
        tollCost: Number,
        drivers: [driverSchema]
    },
    backpackTemplate: [backpackItemSchema]
});

hikeSchema.index({ location: '2dsphere' });

module.exports = mongoose.models.Hike || mongoose.model('Hike', hikeSchema);
