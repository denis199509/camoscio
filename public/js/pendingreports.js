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
// Punto 111: riceve il "totale" gia' calcolato dal server (GET /api/reports/moderation):
// da verificare + risoluzioni richieste + scadute. Prima era la lunghezza dell'array
// delle sole 'pending'.
function renderPendingReportsBadge(totale) {
    const badge = document.getElementById("moderation-count-badge");
    if (!badge) return;

    const count = totale || 0;
    if (count > 0) {
        badge.textContent = count > 9 ? "9+" : count;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

// Click handler del triangolo, ed e' anche la funzione richiamata dopo ogni conferma/rifiuto
// per ricaricare la lista. Fetch fresca propria (non riusa window.CamoscioState.moderation,
// che potrebbe risalire alla navigazione precedente): in un pannello dove si decide di
// pubblicare o eliminare per sempre, servono i dati veri in quel momento, non una cache.
// Punto 111: legge GET /api/reports/moderation ({scadute, risoluzioniRichieste,
// daVerificare, totale}). Per ora disegna solo "daVerificare" com'era la vecchia lista;
// le altre due liste e le loro azioni arrivano col passo 9.
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
        if (sectionTitle) sectionTitle.textContent = "Moderazione segnalazioni";
    }

    const box = document.getElementById("pending-reports-list");
    if (!box) return;

    try {
        const res = await fetch("/api/reports/moderation");
        if (!res.ok) throw new Error(`risposta ${res.status}`);
        const moderation = await res.json();
        window.CamoscioState.moderation = moderation;
        renderPendingReportsBadge(moderation.totale);
        renderModerationLists(moderation);
    } catch (e) {
        console.error("Errore nel caricare le segnalazioni da moderare:", e);
        ["moderation-scadute-list", "moderation-risoluzioni-list"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = "";
        });
        box.innerHTML = `<p class="text-muted">${T('pendingReports.erroreCaricamento') || "Impossibile caricare le segnalazioni in attesa."}</p>`;
    }
}

// Punto 111: le tre code della pagina Moderazione. Il corpo delle righe e' identico per
// tutte e tre (renderModerationListBody); cambia la coppia di bottoni in fondo e una riga
// di contesto. L'ordine di priorita' (scadute > risoluzioni > da verificare) lo garantisce
// gia' il server: qui si disegna e basta.
const LISTE_MODERAZIONE = [
    { chiave: 'scadute',              containerId: 'moderation-scadute-list',     vuota: 'pendingReports.nessunaScaduta' },
    { chiave: 'risoluzioniRichieste', containerId: 'moderation-risoluzioni-list', vuota: 'pendingReports.nessunaRisoluzione' },
    { chiave: 'daVerificare',         containerId: 'pending-reports-list',        vuota: 'pendingReports.nessuna' }
];

function renderModerationLists(moderation) {
    LISTE_MODERAZIONE.forEach(({ chiave, containerId, vuota }) => {
        const box = document.getElementById(containerId);
        if (!box) return;
        const reports = (moderation && moderation[chiave]) || [];
        const countEl = document.getElementById(containerId + "-count");
        if (countEl) countEl.textContent = reports.length ? `(${reports.length})` : "";
        renderModerationListBody(reports, chiave, box, vuota);
    });
}

// Corpo di UNA coda. 'kind' e' 'scadute' | 'risoluzioniRichieste' | 'daVerificare':
// decide la coppia di bottoni (bottoniModerazione) e una riga di contesto in piu'. Il
// resto della card (emoji, titolo, descrizione, foto, riga "segnalato da") e' quello del
// punto 45, spostato qui una volta sola invece di ripeterlo per tre liste.
function renderModerationListBody(reports, kind, box, chiaveVuota) {
    if (!box) return;

    if (reports.length === 0) {
        box.innerHTML = `<div class="text-muted small italic text-center" style="padding: 16px;">${T(chiaveVuota) || "Nessuna segnalazione."}</div>`;
        return;
    }

    const esc = window.escapeHtml;
    const db = window.CamoscioState;
    // Data solo-cifre (giorno/mese, ora:minuti): identica in it-IT e en-GB, ma il
    // locale va passato esplicito - toLocaleString([]) segue il browser, non il sito.
    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    const fmtData = (d) => new Date(d).toLocaleString(loc, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    // Estratta in map.js (window.CamoscioReportTypes): quarta occorrenza della stessa mappa
    // tipo->emoji/titolo. titleFor(tipo) da' il titolo nella lingua attiva (chiave
    // map.reportType.*), col ripiego italiano di tipi.title; il guard tiene in piedi la
    // pagina anche se map.js non fosse caricato.
    const tipi = window.CamoscioReportTypes || { emoji: {}, title: {} };
    const nomeUtente = (uid, ripiego) => {
        const u = db.users.find(x => x.id === uid);
        return u ? esc(u.username) : ripiego;
    };

    box.innerHTML = reports.map(rep => {
        const emoji = tipi.emoji[rep.type] || '⚠️';
        const titolo = tipi.titleFor
            ? tipi.titleFor(rep.type)
            : (tipi.title[rep.type] || (T('pendingReports.avvisoFallback') || 'Avviso'));
        const nomeReporter = nomeUtente(rep.reporterId, T('pendingReports.reporterNonDisponibile') || "utente non disponibile");
        const data = fmtData(rep.createdAt);

        // Punto 45 (foto): qui, a differenza dell'elenco pubblico/mappa (solo un'iconcina,
        // vedi map.js), la foto vera serve a decidere - si carica sempre, la card di
        // moderazione E' gia' la vista di dettaglio.
        const fotoHtml = rep.hasPhoto
            ? `<img src="/api/reports/${rep.id}/photo" alt="${T('pendingReports.fotoAlt') || 'Foto della segnalazione'}" class="pending-report-photo">`
            : '';

        const rigaMeta = T('pendingReports.segnalatoDa', nomeReporter, data, rep.lat.toFixed(3), rep.lng.toFixed(3))
            || `Segnalato da ${nomeReporter} il ${data} — coord: ${rep.lat.toFixed(3)}, ${rep.lng.toFixed(3)}`;

        // Riga di contesto in piu', diversa per coda. Su 'risoluzioniRichieste' mostra CHI
        // ha chiesto la risoluzione (GET /moderation lo espone apposta ai soli moderatori,
        // punto 111); su 'scadute' la data di scadenza.
        let rigaExtra = '';
        if (kind === 'risoluzioniRichieste' && rep.resolutionRequestedAt) {
            const chi = nomeUtente(rep.resolutionRequestedBy, T('pendingReports.utenteSconosciuto') || 'un utente');
            rigaExtra = `<div class="text-muted small">${T('pendingReports.risoltaDa', chi, fmtData(rep.resolutionRequestedAt)) || `Segnalata come risolta da ${chi} il ${fmtData(rep.resolutionRequestedAt)}`}</div>`;
        } else if (kind === 'scadute' && rep.expiresAt) {
            rigaExtra = `<div class="text-muted small">${T('pendingReports.scadutaIl', fmtData(rep.expiresAt)) || `Scaduta il ${fmtData(rep.expiresAt)}`}</div>`;
        }

        return `
            <div class="pending-report-item${kind === 'scadute' ? ' pending-report-item--scaduta' : ''}">
                <div class="pending-report-header">
                    <span>${emoji}</span>
                    <strong>${esc(titolo)}</strong>
                </div>
                <p>${esc(rep.description)}</p>
                ${fotoHtml}
                <div class="text-muted small">${rigaMeta}</div>
                ${rigaExtra}
                <div class="form-row-buttons">${bottoniModerazione(rep, kind)}</div>
            </div>
        `;
    }).join("");
}

// La coppia di bottoni per una riga, per coda. Le azioni che CANCELLANO
// (confirmReportResolution / removeExpiredReport / rejectPendingReport) chiedono conferma
// nel loro handler; quelle reversibili (renewReport / keepReportActive / confirmPendingReport)
// no - decisione di Denis.
function bottoniModerazione(rep, kind) {
    const b = (cls, fn, chiave, testoIt) =>
        `<button class="btn btn-sm ${cls}" onclick="${fn}('${rep.id}')">${T(chiave) || testoIt}</button>`;

    if (kind === 'risoluzioniRichieste') {
        return b('btn-secondary', 'keepReportActive', 'pendingReports.tieniAncora', 'Tieni ancora')
             + b('btn-success', 'confirmReportResolution', 'pendingReports.confermaRisoluzione', 'Conferma la risoluzione');
    }
    if (kind === 'scadute') {
        // Una scaduta puo' essere 'active' (si toglie con DELETE /:id/resolve) o 'pending'
        // mai verificata (si rifiuta con DELETE /:id, decisione di Denis: scadono anche quelle).
        const secondo = rep.status === 'pending'
            ? b('btn-danger', 'rejectPendingReport', 'pendingReports.rifiutaEElimina', 'Rifiuta ed elimina')
            : b('btn-danger', 'removeExpiredReport', 'pendingReports.togli', 'Togli');
        return b('btn-secondary', 'renewReport', 'pendingReports.rinnova', 'Rinnova +90gg') + secondo;
    }
    // daVerificare (comportamento del punto 45)
    return b('btn-danger', 'rejectPendingReport', 'pendingReports.rifiuta', 'Rifiuta')
         + b('btn-success', 'confirmPendingReport', 'pendingReports.conferma', 'Conferma');
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

// --- Punto 111: le azioni delle due code nuove (scadute, risoluzioni richieste) ---
//
// Tutte ricaricano la pagina con showPendingReportsPage() a fine azione, come
// confirm/rejectPendingReport qui sopra: la fetch a /moderation e' leggera e per soli
// moderatori, e serve il conteggio vero del triangolo aggiornato subito.

// Un solo posto per "chiama la rotta, poi ricarica o mostra l'errore".
async function azioneModerazione(url, metodo, okMsg, erroreMsg) {
    try {
        const res = await fetch(url, { method: metodo });
        if (res.ok) {
            window.showToast(okMsg, "success");
            await showPendingReportsPage();
        } else {
            const err = await res.json().catch(() => ({}));
            window.showToast(err.error || erroreMsg, "error");
        }
    } catch (e) {
        console.error("Errore azione moderazione:", e);
        window.showToast(erroreMsg, "error");
    }
}

// Conferma obbligatoria prima di azioneModerazione, per le azioni che cancellano.
async function eliminaConConferma(url, msg, btn, okMsg, erroreMsg) {
    const procedi = await window.showConfirmModal(
        msg, btn,
        { cancelLabel: T('common.cancella') || 'Annulla', danger: true }
    );
    if (!procedi) return;
    await azioneModerazione(url, 'DELETE', okMsg, erroreMsg);
}

// Reversibile, niente modale.
async function keepReportActive(id) {
    await azioneModerazione(`/api/reports/${id}/resolve-request`, 'DELETE',
        T('pendingReports.tenutaAncora') || "Segnalazione tenuta attiva: l'utente potrà rifare la richiesta.",
        T('pendingReports.erroreTieniAncora') || "Impossibile tenere la segnalazione.");
}

// Reversibile, niente modale. rinnovo = adesso + 90 giorni (lato server).
async function renewReport(id) {
    await azioneModerazione(`/api/reports/${id}/renew`, 'PATCH',
        T('pendingReports.rinnovata') || "Scadenza spostata a 90 giorni da oggi.",
        T('pendingReports.erroreRinnova') || "Impossibile rinnovare la segnalazione.");
}

// Cancella (segnalazione 'active' con richiesta di risoluzione) -> conferma obbligatoria.
async function confirmReportResolution(id) {
    await eliminaConConferma(`/api/reports/${id}/resolve`,
        T('pendingReports.confermaRisoluzioneMsg') || "Confermi che il pericolo non c'è più? La segnalazione (foto compresa) verrà eliminata per sempre, senza possibilità di recupero.",
        T('pendingReports.confermaRisoluzioneBtn') || "Conferma ed elimina",
        T('pendingReports.risoluzioneConfermata') || "Risoluzione confermata: segnalazione eliminata.",
        T('pendingReports.erroreConfermaRisoluzione') || "Impossibile confermare la risoluzione.");
}

// Cancella (segnalazione 'active' scaduta) -> conferma obbligatoria. Per una 'pending'
// scaduta il bottone e' invece "Rifiuta ed elimina" (rejectPendingReport, DELETE /:id).
async function removeExpiredReport(id) {
    await eliminaConConferma(`/api/reports/${id}/resolve`,
        T('pendingReports.togliMsg') || "Togliere questa segnalazione scaduta? Verrà eliminata per sempre, foto compresa.",
        T('pendingReports.togliBtn') || "Togli ed elimina",
        T('pendingReports.tolta') || "Segnalazione scaduta rimossa.",
        T('pendingReports.erroreTogli') || "Impossibile togliere la segnalazione.");
}

// Cambio lingua (punto 102, settimo lotto): i corpi delle tre liste sono
// costruiti via innerHTML - applyStaticTranslations non li raggiunge, resterebbero
// in italiano sotto gli occhi di chi modera. Se la pagina e' quella aperta, si
// ri-chiama showPendingReportsPage (ri-fetch + ridisegno): fa gia' lo stesso a
// ogni conferma/rifiuto, e la fetch a /api/reports/moderation e' per soli moderatori,
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

// Punto 111: dal click su una notifica di segnalazione sentiero (relatedReportId:
// richiesta di risoluzione o scadenza) alla pagina Moderazione, dove Denis decide.
// Gemello di goToHikeToComplete (social.js) per la campana. Aprire il campanello ha
// gia' segnato tutto letto (punto 81), quindi qui non serve markNotificationRead.
// showPendingReportsPage fa da se' navigateTo + fetch + titolo; il ripiego copre il
// caso (teorico) in cui questo file non fosse caricato.
window.goToReportModeration = function () {
    const dropdown = document.getElementById("notification-dropdown");
    if (dropdown) dropdown.classList.add("hidden");
    if (window.showPendingReportsPage) window.showPendingReportsPage();
    else if (window.navigateTo) window.navigateTo("pending-reports-page");
};

window.setupPendingReportsTriangle = setupPendingReportsTriangle;
window.renderPendingReportsBadge = renderPendingReportsBadge;
window.showPendingReportsPage = showPendingReportsPage;
window.confirmPendingReport = confirmPendingReport;
window.rejectPendingReport = rejectPendingReport;
// Punto 111: azioni delle code "risoluzioni richieste" e "scadute".
window.keepReportActive = keepReportActive;
window.renewReport = renewReport;
window.confirmReportResolution = confirmReportResolution;
window.removeExpiredReport = removeExpiredReport;
