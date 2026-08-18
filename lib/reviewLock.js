// Unica definizione della stringa da hashare per il blocco anti-doppia-recensione
// (ReviewLock.lockHash) - usata sia da POST /api/reviews (che scrive il lock) sia da
// POST /api/reviews/gia-recensite (che lo legge, punto 98/B). Se questa stringa fosse
// scritta due volte, un domani divergerebbero in silenzio (es. un .trim() aggiunto da
// un lato solo) e il blocco anti-doppione si riaprirebbe senza che nessun test se ne
// accorga - lezione già pagata altrove nel progetto per lo stesso identico motivo.
const crypto = require('crypto');

function calcolaLockHash(reviewerId, targetUserId, hikeId) {
    return crypto.createHash('sha256')
        .update(`${String(reviewerId)}|${String(targetUserId)}|${String(hikeId)}`)
        .digest('hex');
}

module.exports = { calcolaLockHash };
