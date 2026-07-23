const { mongoose } = require('../db/mongo');

const routeBookmarkSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', required: true }
});

// Un utente puo' salvare lo stesso sentiero una sola volta (prima era un controllo .some() a mano)
routeBookmarkSchema.index({ userId: 1, hikeId: 1 }, { unique: true });

module.exports = mongoose.models.RouteBookmark || mongoose.model('RouteBookmark', routeBookmarkSchema);
