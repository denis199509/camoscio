// --- Avvisi delle segnalazioni sentiero (punto 111) ---
//
// Le due situazioni in cui Denis deve decidere:
//   1) un utente normale ha premuto "risolvi" -> notificaRichiestaRisoluzione
//   2) una segnalazione e' scaduta (expiresAt passato)   -> controllaScadenze
//
// In entrambi i casi parte una notifica in campanella. Il DESTINATARIO e' chi ha
// User.receivesReportAlerts (oggi solo Denis, per sua decisione esplicita - vedi
// models/User.js). Questa logica non sa CHI la chiama: la richiesta di risoluzione la
// invoca una rotta, il controllo scadenze un aggancio pigro (o un cron) - cambiare il
// trigger non tocca il testo ne' i destinatari.
//
// FAIL-SAFE: la pagina Moderazione legge dallo stato del database (GET /moderation), non
// dalle notifiche. Se una notifica non parte, la decisione resta comunque visibile e
// prendibile - la notifica e' una spinta, non l'unica copia dello stato.

const User = require('../models/User');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { rinnovo } = require('./scadenzaSegnalazioni');

// Specchio locale di window.CamoscioReportTypes.title (public/js/map.js): quello e' un
// global del browser, non un modulo. Quattro stringhe, si mirrorano.
const ETICHETTA_TIPO = {
    frana: 'Frana / Cedimento',
    ghiaccio: 'Presenza Ghiaccio',
    fontana_secca: 'Sorgente Senz\'Acqua',
    ostacolo: 'Sentiero Ostruito'
};
function etichetta(rep) {
    return ETICHETTA_TIPO[rep.type] || rep.type || 'segnalazione';
}
// Frammento di descrizione, se c'e', per aiutare a riconoscere quale segnalazione.
// escapeHtml lo fa gia' renderNotificationBell in app.js: qui il testo resta grezzo.
function frammento(rep) {
    const d = (rep.description || '').trim();
    return d ? ` («${d.slice(0, 60)}${d.length > 60 ? '…' : ''}»)` : '';
}

function testoRichiestaRisoluzione(rep) {
    return `Un utente ha segnalato come risolta la segnalazione "${etichetta(rep)}"${frammento(rep)}. `
        + `Confermala o tienila ancora dalla pagina Moderazione.`;
}
function testoScadenza(rep) {
    return `La segnalazione "${etichetta(rep)}"${frammento(rep)} è scaduta. `
        + `Rinnovala di altri 90 giorni o toglila dalla pagina Moderazione.`;
}

// Chi riceve gli avvisi. Ripiego RUMOROSO: se nessuno ha receivesReportAlerts, meglio una
// notifica di troppo a un moderatore che zero notifiche a nessuno - il caso "nessuno
// configurato" e' proprio quello in cui il silenzio non si nota.
async function destinatariAvvisi() {
    const scelti = await User.find({ receivesReportAlerts: true }).select('_id').lean();
    if (scelti.length) return scelti;
    console.warn('[reportAlerts] nessun utente con receivesReportAlerts: ripiego sui moderatori');
    return User.find({ canModerateReports: true }).select('_id').lean();
}

// Chiamata dalla rotta POST /:id/resolve-request, UNA volta sola (la guardia atomica sulla
// rotta garantisce che si arrivi qui solo per la prima richiesta).
async function notificaRichiestaRisoluzione(rep) {
    const destinatari = await destinatariAvvisi();
    const testo = testoRichiestaRisoluzione(rep);
    for (const d of destinatari) {
        await Notification.create({ userId: d._id, text: testo, relatedReportId: rep._id });
    }
    return destinatari.length;
}

// Trova le segnalazioni scadute e non ancora notificate, avvisa, e le "timbra"
// (expiryNotifiedAt) perche' il prossimo giro non riavvisi. Il rinnovo azzera il timbro,
// cosi' fra 90 giorni riavvisa da sola. Include anche le 'pending' scadute (decisione di
// Denis: scadono anche quelle mai verificate).
async function controllaScadenze() {
    const scadute = await Report.find({
        expiresAt: { $lte: new Date() },
        expiryNotifiedAt: { $exists: false }
    }).select('_id type description expiresAt status').lean();   // mai la foto
    if (!scadute.length) return { scadute: 0, notificate: 0 };

    const destinatari = await destinatariAvvisi();
    let notificate = 0;
    for (const rep of scadute) {
        // ORDINE: prima la notifica, POI il timbro. Se il timbro fallisse, domani si
        // rinotifica (rumore, recuperabile); se il timbro venisse prima e la notifica
        // fallisse, quella segnalazione non verrebbe piu' segnalata MAI, in silenzio.
        // Stessa direzione gia' scelta in routes/safety.js.
        const testo = testoScadenza(rep);
        for (const d of destinatari) {
            await Notification.create({ userId: d._id, text: testo, relatedReportId: rep._id });
        }
        await Report.updateOne({ _id: rep._id }, { $set: { expiryNotifiedAt: new Date() } });
        notificate++;
    }
    return { scadute: scadute.length, notificate };
}

module.exports = {
    testoRichiestaRisoluzione,
    testoScadenza,
    destinatariAvvisi,
    notificaRichiestaRisoluzione,
    controllaScadenze,
    rinnovo   // ri-esportato: le rotte del punto 111 lo prendono da qui
};
