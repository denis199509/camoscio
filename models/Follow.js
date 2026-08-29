const { mongoose } = require('../db/mongo');

// Punto 113 - "Segui" una persona. Unidirezionale e senza conferma, stile Instagram/Twitter
// (decisione di Denis del 29/08/2026): seguire non chiede il permesso a nessuno.
//
// COLLEZIONE DEDICATA, non due array (following/followers) su User. Un array su cui si fa
// $push va scritto su OGNI documento utente anche di chi non segue nessuno (per il push la
// chiave deve esistere): e' il campo scritto a vuoto che il vincolo hard sullo spazio
// vieta, e default: undefined non si applica a un array che deve accettare push. Una
// join-collection minuscola con indice unico composto e' invece gia' la forma del progetto
// per RouteBookmark {userId, hikeId} e Stamp {userId, stampId}.
const followSchema = new mongoose.Schema({
    followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // chi segue
    followingId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }   // chi e' seguito
}, { timestamps: { createdAt: true, updatedAt: false } });
// createdAt tenuto: una chiave sola, utile per ordinare "seguiti di recente". updatedAt no,
// un follow non si modifica (stessa scelta di models/Notification.js).

// Un utente segue un altro una sola volta. L'indice regge anche: "chi seguo" (find per
// followerId), il toggle del tasto Segui (findOne sulla coppia) e il prefisso della query
// del feed (punto 113, passo 5).
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
// "chi mi segue" (find per followingId) e il contatore seguaci sul profilo.
followSchema.index({ followingId: 1 });

module.exports = mongoose.models.Follow || mongoose.model('Follow', followSchema);
