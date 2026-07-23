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
    weight: Number
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
