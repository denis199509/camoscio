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

    // pending-reports-page non e' fra i prettyNames di navigateTo() in app.js (nessuna voce
    // in barra), stesso motivo per cui renderSquadPage/renderHikePage impostano il titolo da
    // soli dopo aver letto l'entita' specifica - qui la pagina e' unica, titolo fisso.
    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = "Segnalazioni da verificare";

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
        box.innerHTML = `<p class="text-muted">Impossibile caricare le segnalazioni in attesa.</p>`;
    }
}

function renderPendingReportsListBody(reports) {
    const box = document.getElementById("pending-reports-list");
    if (!box) return;

    if (reports.length === 0) {
        box.innerHTML = `<div class="text-muted small italic text-center" style="padding: 16px;">Nessuna segnalazione in attesa.</div>`;
        return;
    }

    const esc = window.escapeHtml;
    const db = window.CamoscioState;
    // Estratta in map.js (window.CamoscioReportTypes): terza occorrenza della stessa mappa
    // tipo->emoji/titolo, dopo renderMapMarkers() e renderWazeReportsList() - si fattorizza
    // alla seconda, non si aspetta la terza (stesso principio gia' applicato alla chat
    // condivisa fra pagina squadra ed escursione, punto 55).
    const tipi = window.CamoscioReportTypes || { emoji: {}, title: {} };

    box.innerHTML = reports.map(rep => {
        const emoji = tipi.emoji[rep.type] || '⚠️';
        const titolo = tipi.title[rep.type] || 'Avviso';
        const reporter = db.users.find(u => u.id === rep.reporterId);
        const nomeReporter = reporter ? esc(reporter.username) : "utente non disponibile";
        const data = new Date(rep.createdAt).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        return `
            <div class="pending-report-item">
                <div class="pending-report-header">
                    <span>${emoji}</span>
                    <strong>${esc(titolo)}</strong>
                </div>
                <p>${esc(rep.description)}</p>
                <div class="text-muted small">
                    Segnalato da ${nomeReporter} il ${data} — coord: ${rep.lat.toFixed(3)}, ${rep.lng.toFixed(3)}
                </div>
                <div class="form-row-buttons">
                    <button class="btn btn-sm btn-danger" onclick="rejectPendingReport('${rep.id}')">Rifiuta</button>
                    <button class="btn btn-sm btn-success" onclick="confirmPendingReport('${rep.id}')">Conferma</button>
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
            window.showToast("Segnalazione confermata: ora è visibile a tutti.", "success");
            await showPendingReportsPage();
        } else {
            const err = await res.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile confermare la segnalazione.", "error");
        }
    } catch (e) {
        console.error("Errore conferma segnalazione:", e);
        window.showToast("Impossibile confermare la segnalazione.", "error");
    }
}

// Irreversibile (elimina per sempre, nessuno stato "rifiutato" da recuperare) - merita un
// passaggio di conferma in piu', a differenza di confirmPendingReport sopra.
async function rejectPendingReport(id) {
    const procedi = await window.showConfirmModal(
        "Rifiutare questa segnalazione la elimina per sempre, senza possibilità di recupero. Continuare?",
        "Rifiuta ed elimina"
    );
    if (!procedi) return;

    try {
        const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        if (res.ok) {
            window.showToast("Segnalazione rifiutata ed eliminata.", "success");
            await showPendingReportsPage();
        } else {
            const err = await res.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile rifiutare la segnalazione.", "error");
        }
    } catch (e) {
        console.error("Errore rifiuto segnalazione:", e);
        window.showToast("Impossibile rifiutare la segnalazione.", "error");
    }
}

window.setupPendingReportsTriangle = setupPendingReportsTriangle;
window.renderPendingReportsBadge = renderPendingReportsBadge;
window.showPendingReportsPage = showPendingReportsPage;
window.confirmPendingReport = confirmPendingReport;
window.rejectPendingReport = rejectPendingReport;
