// Traduzione IT/EN (punto 102, settimo lotto): 'var T' e non 'const', questo file
// non e' avvolto in una IIFE e condivide lo scope globale con gli altri <script>
// classici - 'const T' darebbe "Identifier 'T' has already been declared" e
// bloccherebbe l'intero file (vedi 07-Trappole-Tecniche.md del vault). Ripiego
// sempre all'italiano gia' scritto qui e nell'HTML: il dizionario ha solo l'EN.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Punto 45: pagina di moderazione delle segnalazioni sentiero - triangolo di attenzione
// nell'header (canale ESCLUSIVO per questo tipo di evento, mai un doppione della campana:
// le notifiche normali restano solo li'), pagina dedicata con conferma/rifiuto. Nessuna voce
// in barra laterale, stesso principio di squadpage.js/userprofile.js: si apre solo cliccando
// il triangolo (vedi index.html, #moderation-triangle-wrapper).
//
// Chi vede il triangolo: solo chi ha canModerateReports=true (oggi solo Denis, in futuro
// anche altri - vedi models/User.js e scripts/set-report-moderator.js). Per chi non ce l'ha
// il wrapper resta "hidden" e NESSUN listener viene agganciato - non solo invisibile, anche
// non riattivabile a mano da devtools (il backend rifiuterebbe comunque con 403, questa e'
// solo una difesa in piu' economica).

function isReportModerator() {
    const user = window.CamoscioState.currentUser;
    return !!(user && user.canModerateReports);
}

// Chiamata da app.js SUBITO dopo checkAuthAndShowGate, prima di initApp()/refreshState():
// currentUser.canModerateReports e' gia' disponibile a quel punto (risposta piena e non
// filtrata di GET /api/auth/me), stesso schema gia' usato per setupEmailVerifyBanner in
// app.js. Collegarsi qui invece che dentro initApp() evita la trappola nota "modulo che si
// aggancia tardi" (bug reale trovato il 26/07 per la navigazione e il 06/08 per il profilo).
function setupPendingReportsTriangle() {
    if (!isReportModerator()) return;

    const wrapper = document.getElementById("moderation-triangle-wrapper");
    const btn = document.getElementById("btn-moderation-triangle");
    if (!wrapper || !btn) return;

    wrapper.classList.remove("hidden");
    btn.addEventListener("click", () => showPendingReportsPage());
}

// Aggiorna solo il contatore del triangolo - mirror della meta' "badge" di
// renderNotificationBell() in app.js (incluso il troncamento "9+"). Chiamata da
// refreshState() ad ogni cambio sezione, solo per chi modera: stessa identica cadenza
// gia' in uso oggi per la campana (nessun polling a intervallo in tutto il progetto).
function renderPendingReportsBadge(pendingReports) {
    const badge = document.getElementById("moderation-count-badge");
    if (!badge) return;

    const count = (pendingReports || []).length;
    if (count > 0) {
        badge.textContent = count > 9 ? "9+" : count;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

// Click handler del triangolo, ed e' anche la funzione richiamata dopo ogni conferma/rifiuto
// per ricaricare la lista. Fetch fresca propria (non riusa window.CamoscioState.pendingReports,
// che potrebbe risalire alla navigazione precedente): in un pannello dove si decide di
// pubblicare o eliminare per sempre, servono i dati veri in quel momento, non una cache.
async function showPendingReportsPage() {
    if (window.navigateTo) window.navigateTo("pending-reports-page");

    // Titolo fisso: ora e' in prettyNames (app.js) e in 'sectionTitle.pending-reports-page'
    // (i18n.js) - updateSectionTitle lo mette e lo rimette da solo a ogni cambio lingua,
    // come #my-profile al terzo lotto. navigateTo() qui sopra lo chiama gia'; questo e' il
    // ripiego se navigateTo non c'e' (stessa guardia difensiva del resto del file).
    if (window.CamoscioUpdateSectionTitle) {
        window.CamoscioUpdateSectionTitle("pending-reports-page");
    } else {
        const sectionTitle = document.getElementById("section-title");
        if (sectionTitle) sectionTitle.textContent = "Segnalazioni da verificare";
    }

    const box = document.getElementById("pending-reports-list");
    if (!box) return;

    try {
        const res = await fetch("/api/reports/pending");
        if (!res.ok) throw new Error(`risposta ${res.status}`);
        const reports = await res.json();
        window.CamoscioState.pendingReports = reports;
        renderPendingReportsBadge(reports);
        renderPendingReportsListBody(reports);
    } catch (e) {
        console.error("Errore nel caricare le segnalazioni in attesa:", e);
        box.innerHTML = `<p class="text-muted">${T('pendingReports.erroreCaricamento') || "Impossibile caricare le segnalazioni in attesa."}</p>`;
    }
}

function renderPendingReportsListBody(reports) {
    const box = document.getElementById("pending-reports-list");
    if (!box) return;

    if (reports.length === 0) {
        box.innerHTML = `<div class="text-muted small italic text-center" style="padding: 16px;">${T('pendingReports.nessuna') || "Nessuna segnalazione in attesa."}</div>`;
        return;
    }

    const esc = window.escapeHtml;
    const db = window.CamoscioState;
    // Data solo-cifre (giorno/mese, ora:minuti): identica in it-IT e en-GB, ma il
    // locale va passato esplicito - toLocaleString([]) segue il browser, non il sito.
    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    // Estratta in map.js (window.CamoscioReportTypes): terza occorrenza della stessa mappa
    // tipo->emoji/titolo, dopo renderMapMarkers() e renderWazeReportsList() - si fattorizza
    // alla seconda, non si aspetta la terza (stesso principio gia' applicato alla chat
    // condivisa fra pagina squadra ed escursione, punto 55).
    // Rollout punto 102, lotto Mappa: titleFor(tipo) restituisce il titolo nella lingua
    // attiva (chiave map.reportType.*), col ripiego italiano di tipi.title - era gia'
    // previsto che i tipi si traducessero "col lotto Mappa" (settimo lotto). Il guard
    // tipi.titleFor tiene in piedi la pagina anche se map.js non fosse caricato.
    const tipi = window.CamoscioReportTypes || { emoji: {}, title: {} };

    box.innerHTML = reports.map(rep => {
        const emoji = tipi.emoji[rep.type] || '⚠️';
        const titolo = tipi.titleFor
            ? tipi.titleFor(rep.type)
            : (tipi.title[rep.type] || (T('pendingReports.avvisoFallback') || 'Avviso'));
        const reporter = db.users.find(u => u.id === rep.reporterId);
        const nomeReporter = reporter ? esc(reporter.username) : (T('pendingReports.reporterNonDisponibile') || "utente non disponibile");
        const data = new Date(rep.createdAt).toLocaleString(loc, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        // Punto 45 (foto): qui, a differenza dell'elenco pubblico/mappa (solo un'iconcina,
        // vedi map.js), la foto vera serve a decidere se confermare o rifiutare - si carica
        // sempre, non solo "aprendo" la segnalazione, perche' la card di moderazione E' gia'
        // la vista di dettaglio.
        const fotoHtml = rep.hasPhoto
            ? `<img src="/api/reports/${rep.id}/photo" alt="${T('pendingReports.fotoAlt') || 'Foto della segnalazione'}" class="pending-report-photo">`
            : '';

        const rigaMeta = T('pendingReports.segnalatoDa', nomeReporter, data, rep.lat.toFixed(3), rep.lng.toFixed(3))
            || `Segnalato da ${nomeReporter} il ${data} — coord: ${rep.lat.toFixed(3)}, ${rep.lng.toFixed(3)}`;

        return `
            <div class="pending-report-item">
                <div class="pending-report-header">
                    <span>${emoji}</span>
                    <strong>${esc(titolo)}</strong>
                </div>
                <p>${esc(rep.description)}</p>
                ${fotoHtml}
                <div class="text-muted small">
                    ${rigaMeta}
                </div>
                <div class="form-row-buttons">
                    <button class="btn btn-sm btn-danger" onclick="rejectPendingReport('${rep.id}')">${T('pendingReports.rifiuta') || 'Rifiuta'}</button>
                    <button class="btn btn-sm btn-success" onclick="confirmPendingReport('${rep.id}')">${T('pendingReports.conferma') || 'Conferma'}</button>
                </div>
            </div>
        `;
    }).join("");
}

// Nessuna conferma extra: e' un'azione meno rischiosa del rifiuto, sempre risolvibile dopo
// col flusso crowdsourced esistente ("risolvi" nella lista pubblica) se pubblicata per errore.
async function confirmPendingReport(id) {
    try {
        const res = await fetch(`/api/reports/${id}/confirm`, { method: 'PATCH' });
        if (res.ok) {
            window.showToast(T('pendingReports.confermata') || "Segnalazione confermata: ora è visibile a tutti.", "success");
            await showPendingReportsPage();
        } else {
            const err = await res.json().catch(() => ({}));
            window.showToast(err.error || T('pendingReports.erroreConferma') || "Impossibile confermare la segnalazione.", "error");
        }
    } catch (e) {
        console.error("Errore conferma segnalazione:", e);
        window.showToast(T('pendingReports.erroreConferma') || "Impossibile confermare la segnalazione.", "error");
    }
}

// Irreversibile (elimina per sempre, nessuno stato "rifiutato" da recuperare) - merita un
// passaggio di conferma in piu', a differenza di confirmPendingReport sopra.
async function rejectPendingReport(id) {
    const procedi = await window.showConfirmModal(
        T('pendingReports.rifiutaConfermaMsg') || "Rifiutare questa segnalazione la elimina per sempre, senza possibilità di recupero. Continuare?",
        T('pendingReports.rifiutaConfermaBtn') || "Rifiuta ed elimina",
        { cancelLabel: T('common.cancella') || 'Annulla', danger: true }
    );
    if (!procedi) return;

    try {
        const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        if (res.ok) {
            window.showToast(T('pendingReports.rifiutata') || "Segnalazione rifiutata ed eliminata.", "success");
            await showPendingReportsPage();
        } else {
            const err = await res.json().catch(() => ({}));
            window.showToast(err.error || T('pendingReports.erroreRifiuto') || "Impossibile rifiutare la segnalazione.", "error");
        }
    } catch (e) {
        console.error("Errore rifiuto segnalazione:", e);
        window.showToast(T('pendingReports.erroreRifiuto') || "Impossibile rifiutare la segnalazione.", "error");
    }
}

// Cambio lingua (punto 102, settimo lotto): il corpo di #pending-reports-list e'
// costruito via innerHTML - applyStaticTranslations non lo raggiunge, resterebbe
// in italiano sotto gli occhi di chi modera. Se la pagina e' quella aperta, si
// ri-chiama showPendingReportsPage (ri-fetch + ridisegno): fa gia' lo stesso a
// ogni conferma/rifiuto, e la fetch a /api/reports/pending e' per soli moderatori,
// leggera. Gate sulla sezione attiva come il <select> recensioni del quinto lotto:
// nessun fetch a vuoto quando la pagina non e' in vista. Il titolo lo rimette gia'
// updateSectionTitle da solo (via prettyNames + sectionTitle.pending-reports-page).
if (window.CamoscioI18n && window.CamoscioI18n.onChange) {
    window.CamoscioI18n.onChange(function () {
        const sec = document.getElementById("pending-reports-page");
        if (sec && sec.classList.contains("active") && isReportModerator()) {
            showPendingReportsPage();
        }
    });
}

window.setupPendingReportsTriangle = setupPendingReportsTriangle;
window.renderPendingReportsBadge = renderPendingReportsBadge;
window.showPendingReportsPage = showPendingReportsPage;
window.confirmPendingReport = confirmPendingReport;
window.rejectPendingReport = rejectPendingReport;
