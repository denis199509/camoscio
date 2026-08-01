// Ricerca persone per username, voce "Cerca Persone" sotto "Tribù & Squadre" (idea di
// Denis in sessione, 01/08/2026 — non richiesta in anticipo). Nessuna rotta nuova:
// window.CamoscioState.users e' gia' l'elenco completo (GET /api/users, aggiornato da
// refreshState() a ogni cambio sezione). Si cerca SOLO su username: nome/cognome veri
// sono in ALWAYS_PRIVATE_FIELDS (routes/users.js) e non arrivano mai al browser per un
// utente diverso da se stessi - non esiste un'alternativa su cui cercare.

const SOGLIA_RICERCA_PERSONE = 4; // "DaniWoll" - la ricerca parte gia' da "Dani" (confermato con Denis)

function initPeopleSearchModule() {
    const input = document.getElementById("people-search-input");
    if (input) input.addEventListener("input", renderPeopleSearchModule);
}

function renderPeopleSearchModule() {
    const input = document.getElementById("people-search-input");
    const results = document.getElementById("people-search-results");
    const db = window.CamoscioState;
    if (!input || !results || !db.currentUser) return;

    const query = input.value.trim().toLowerCase();
    results.innerHTML = "";

    if (query.length < SOGLIA_RICERCA_PERSONE) {
        results.innerHTML = `<p class="small text-muted">Scrivi almeno ${SOGLIA_RICERCA_PERSONE} lettere per avviare la ricerca.</p>`;
        return;
    }

    // Se stessi esclusi (stesso pattern di populateSquadMembersCheckboxes in social.js):
    // cercare se stessi non serve, "Il Tuo Profilo" esiste gia'. includes() e non
    // startsWith(): gli username reali sono spesso due parole ("Luca TrailRunner"), e la
    // parte piu' distintiva non e' sempre la prima.
    const trovati = db.users.filter(u =>
        u.id !== db.currentUser.id && (u.username || "").toLowerCase().includes(query)
    );

    if (trovati.length === 0) {
        results.innerHTML = `<p class="small text-muted">Nessuna persona trovata.</p>`;
        return;
    }

    trovati.forEach(u => {
        const row = document.createElement("div");
        row.className = "carpool-group-item";
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div class="p-avatar" onclick="showUserProfile('${u.id}')">${u.avatar}</div>
                <b class="user-link" onclick="showUserProfile('${u.id}')">${escapeHtml(u.username)}</b>
            </div>
        `;
        results.appendChild(row);
    });
}

window.initPeopleSearchModule = initPeopleSearchModule;
window.renderPeopleSearchModule = renderPeopleSearchModule;
