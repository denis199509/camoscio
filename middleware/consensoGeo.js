// A-3.1 (ri-review sicurezza, 2° giro): quando l'utente revoca il consenso alla
// geolocalizzazione (interruttore in #settings), il server DEVE smettere di raccoglierla -
// non basta nascondere i pulsanti nell'interfaccia. Sotto GDPR il ritiro del consenso ferma
// il trattamento, non solo l'etichetta.
//
// Si applica alle rotte di routes/tracking.js che AVVIANO una registrazione o SALVANO
// posizioni (/start, /:id/points, /:id/resume). Le rotte che FERMANO il tracciamento
// (/pause, /end) non vanno mai bloccate. Gli account demo entrano senza registrarsi: per
// loro non c'e' un consenso vero da rispettare.
const User = require('../models/User');

module.exports = async function richiedeConsensoGeo(req, res, next) {
    try {
        const u = await User.findById(req.session.userId).select('geolocationConsent isDemoAccount');
        if (!u) return res.status(401).json({ error: 'Devi effettuare il login' });
        if (!u.geolocationConsent && !u.isDemoAccount) {
            return res.status(403).json({
                error: 'Consenso alla geolocalizzazione non attivo. Riattivalo in Impostazioni per registrare il percorso.'
            });
        }
        next();
    } catch (e) {
        console.error('Errore controllo consenso geolocalizzazione:', e);
        res.status(500).json({ error: 'Errore interno' });
    }
};
