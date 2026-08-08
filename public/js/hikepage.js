// Pagina di UNA escursione (punto 55) - si apre cliccando "Chat" sulla card di
// un'escursione (vedi public/js/social.js, buildHikeCard). Stesso principio di
// squadpage.js: nessuna voce in barra laterale, l'escursione si legge da
// window.CamoscioState.hikes (gia' caricata da refreshState) invece di fare una fetch in
// piu' solo per aprire la pagina. Niente foto ne' ruoli admin, a differenza della pagina
// squadra: qui la chat serve solo ai partecipanti per organizzarsi.

async function showHikePage(hikeId) {
    if (!hikeId) return;
    if (window.navigateTo) window.navigateTo("hike-page");
    await renderHikePage(hikeId);
}

async function renderHikePage(hikeId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    const headerBox = document.getElementById("hike-page-header");
    const membersBox = document.getElementById("hike-page-members");
    const chatBox = document.getElementById("hike-page-chat");
    if (!headerBox || !membersBox || !chatBox) return;

    if (!hike) {
        headerBox.innerHTML = `<p class="text-muted">Escursione non trovata.</p>`;
        membersBox.innerHTML = "";
        chatBox.innerHTML = "";
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = hike.title;

    renderHikePageHeader(hike, headerBox);
    renderHikePageParticipants(hike, membersBox);
    window.CamoscioChatPanel.render({ box: chatBox, apiBase: `/api/hikes/${hike.id}`, title: 'Chat Escursione' });

    if (window.lucide) window.lucide.createIcons();
}

function renderHikePageHeader(hike, box) {
    box.innerHTML = `<h3 class="font-bold">${window.escapeHtml(hike.title)}</h3>`;
}

// Righe .squad-item riusate (generiche, "riga di persona in un elenco", non specifiche di
// squadra) - cliccabili come gli avatar partecipanti gia' presenti sulla card escursione
// (buildHikeCard, social.js).
function renderHikePageParticipants(hike, box) {
    const db = window.CamoscioState;
    const esc = window.escapeHtml;

    const rows = hike.participants.map(pId => {
        const p = db.users.find(u => u.id === pId);
        const nome = p ? esc(p.username) : "Utente";
        const avatar = p ? esc(p.avatar) : "👤";
        return `
            <div class="squad-item" style="cursor:pointer;" onclick="showUserProfile('${pId}')">
                <div><h5>${avatar} ${nome}</h5></div>
            </div>
        `;
    }).join("");

    box.innerHTML = `
        <h4><i data-lucide="users"></i> Partecipanti</h4>
        <div class="squads-list">${rows}</div>
    `;
}

window.showHikePage = showHikePage;
