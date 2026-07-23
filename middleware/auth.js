// Richiede una sessione valida. L'identita' dell'utente va SEMPRE letta da req.session.userId,
// mai da un campo mandato dal client (body/query/params) - quello puo' essere falsificato.
function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Devi effettuare il login' });
    }
    next();
}

module.exports = { requireAuth };
