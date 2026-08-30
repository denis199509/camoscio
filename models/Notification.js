const { mongoose } = require('../db/mongo');

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    read: { type: Boolean, default: false },
    // Punto 64: collega una notifica alla sua escursione, SOLO dove serve (il promemoria di
    // completamento di gruppo). Prima nessuna notifica aveva un modo di collegarsi a
    // un'altra entita' ne' esisteva un controllo anti-doppione da nessuna parte (verificato
    // con grep su tutto il repo) - serve a non ricreare lo stesso promemoria ad ogni
    // caricamento delle notifiche, finche' il creatore non completa il gruppo.
    // default: undefined, vincolo spazio: le notifiche di sempre non ne hanno bisogno.
    relatedHikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', default: undefined },

    // Punto 111: come relatedHikeId, ma per una segnalazione sentiero. Serve a due cose:
    // (1) il click sulla notifica apre la pagina Moderazione invece di limitarsi a segnarla
    // letta (aggancio in app.js renderNotificationBell); (2) diagnosi - da una notifica si
    // risale alla segnalazione. NON e' la guardia anti-doppione: quella e'
    // Report.expiryNotifiedAt. default: undefined, vincolo spazio.
    relatedReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: undefined },

    // Punto 113: come i due qui sopra, ma per un'uscita pubblicata. Nasce da un "mi piace"
    // ricevuto: il click sulla notifica apre la pagina dell'uscita (goToOutingFromNotification
    // in outingpage.js, ramo nuovo in app.js renderNotificationBell). NON e' una guardia
    // anti-doppione - quella e' l'indice unico su Like: la notifica si crea solo al primo
    // like di quella persona su quell'uscita. default: undefined, vincolo spazio.
    relatedSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveHikeSession', default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
