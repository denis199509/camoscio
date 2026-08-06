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
    relatedHikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
