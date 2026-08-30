const { mongoose } = require('../db/mongo');

// Punto 113 - "Mi piace" su un'uscita pubblicata nel feed (emoji montagna, decisione 8 di
// Denis del 29/08/2026): contatore accumulabile, un like per utente, toggle. Nessuna lista
// di chi ha messo like a schermo.
//
// COLLEZIONE DEDICATA con indice unico composto, come Follow {followerId,followingId} e
// RouteBookmark {userId,hikeId}: e' la forma del progetto per un "questo utente <-> quella
// cosa". NIENTE contatore denormalizzato su ActiveHikeSession: la riga per-utente serve
// comunque (per sapere "l'ho messo io"), e un secondo numero da tenere allineato a mano
// andrebbe fuori sync. countDocuments su indice, a questa scala, e' sempre esatto.
const likeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },       // chi mette like
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveHikeSession', required: true } // l'uscita
}, { timestamps: { createdAt: true, updatedAt: false } });
// createdAt tenuto (una chiave sola, utile per ordinare); updatedAt no, un like non si
// modifica - stessa scelta di models/Follow.js e models/Notification.js.

// Un utente mette like a un'uscita una sola volta: l'indice regge anche il toggle (findOne
// sulla coppia) e il "l'ho messo io" nel batch del feed (passo 5).
likeSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
// Contatore per una singola uscita (pagina uscita) + l'aggregate del feed + la cascata
// Like.deleteMany({sessionId}) quando l'uscita viene cancellata.
likeSchema.index({ sessionId: 1 });

module.exports = mongoose.models.Like || mongoose.model('Like', likeSchema);
