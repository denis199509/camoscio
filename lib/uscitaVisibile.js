const { mongoose } = require('../db/mongo');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const Follow = require('../models/Follow');

// PUNTO 113 - chi puo' vedere un'uscita pubblicata (decisione 6 di Denis del 29/08/2026):
// l'autore sempre; gli altri SOLO se l'uscita e' pubblicata E la seguono. 404 (non 403)
// quando non e' pubblicata: a chi non e' l'autore non si rivela nemmeno che l'uscita
// esiste. Restituisce { sessione } oppure { errore: {status, body} }.
//
// Vive qui, e non dentro una rotta, perche' la usano DUE file: le rotte di lettura di
// un'uscita (GET /sessions/:id/meta|/points, POST /sessions/:id/like - routes/tracking.js) e
// la creazione di un percorso da quella traccia (POST /api/routing/saved-routes -
// routes/routing.js, passo 8). Due copie della stessa guardia divergerebbero in silenzio:
// e' una trappola gia' pagata su questo progetto (due copie di un blocco, escapeHtml
// mancante in una sola).
async function guardiaUscitaVisibile(sessionId, viewerId, campi) {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        return { errore: { status: 400, body: { error: 'Identificativo non valido.' } } };
    }
    const sessione = await ActiveHikeSession.findById(sessionId).select(campi);
    if (!sessione) return { errore: { status: 404, body: { error: 'Questa uscita non esiste.' } } };

    if (String(sessione.userId) === String(viewerId)) return { sessione };

    if (!sessione.publishedAt) {
        return { errore: { status: 404, body: { error: 'Questa uscita non esiste.' } } };
    }
    if (!(await Follow.exists({ followerId: viewerId, followingId: sessione.userId }))) {
        return { errore: { status: 403, body: { error: 'Puoi vedere questa uscita solo se segui chi l\'ha pubblicata.' } } };
    }
    return { sessione };
}

module.exports = { guardiaUscitaVisibile };
