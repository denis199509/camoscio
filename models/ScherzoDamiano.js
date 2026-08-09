// Scherzo per un amico di Denis (di nome Damiano): un messaggio a sorpresa mostrato una
// sola volta, alla registrazione dell'account con quel nome. Non e' un permesso ne' un
// dato dell'utente: un solo documento fisso (_id noto) che fa da interruttore "gia'
// scattato / non ancora" - vedi routes/auth.js e scripts/riarma-scherzo-damiano.js.
const mongoose = require('mongoose');

const scherzoDamianoSchema = new mongoose.Schema({
    _id: { type: String },
    usato: { type: Boolean, default: false },
    usatoIl: { type: Date }
});

const ScherzoDamiano = mongoose.models.ScherzoDamiano || mongoose.model('ScherzoDamiano', scherzoDamianoSchema);
module.exports = ScherzoDamiano;
