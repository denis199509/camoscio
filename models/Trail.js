const { mongoose } = require('../db/mongo');
const User = require('./User');

// Fase G - Sentieri reali estratti una tantum da OpenStreetMap (scripts/fetch-trails.js),
// usati per "agganciare" il GPS durante un'escursione. Un documento per ogni "way" OSM.
//
// Coordinate salvate come semplice array di coppie [lng, lat] (niente wrapper GeoJSON
// {type:'LineString',...}: qui il tipo e' sempre lo stesso per ogni documento, ripeterlo
// non aggiunge informazione e spreca spazio - vincolo hard di cose_da_fare.txt).
const trailSchema = new mongoose.Schema({
    wayId: { type: Number, required: true, unique: true }, // ID OSM del "way", usato per l'upsert idempotente
    region: { type: String, enum: User.REGIONI, required: true },
    name: { type: String, default: null },
    sacScale: { type: String, default: null }, // difficolta' OSM (hiking/mountain_hiking/demanding_mountain_hiking/alpine_hiking...)
    coordinates: { type: [[Number]], required: true } // [[lng, lat], [lng, lat], ...] nell'ordine del sentiero
}, { timestamps: { createdAt: false, updatedAt: 'fetchedAt' } });

module.exports = mongoose.models.Trail || mongoose.model('Trail', trailSchema);
