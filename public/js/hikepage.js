// Pagina di UNA escursione (punto 55) - si apre cliccando "Chat" sulla card di
// un'escursione (vedi public/js/social.js, buildHikeCard). Stesso principio di
// squadpage.js: nessuna voce in barra laterale, l'escursione si legge da
// window.CamoscioState.hikes (gia' caricata da refreshState) invece di fare una fetch in
// piu' solo per aprire la pagina. Niente foto ne' ruoli admin, a differenza della pagina
// squadra: qui la chat serve solo ai partecipanti per organizzarsi.

// Rollout traduzione punto 102 (22/08/2026). "var", non "const": vedi la nota in
// cima a i18n.js sul perche' (piu' file <script> classici che condividono lo
// stesso scope globale, "const T" ripetuto in due file darebbe SyntaxError).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Ultima escursione aperta, stesso principio di squadIdAperta in squadpage.js:
// un cambio lingua ridisegna SOLO intestazione/partecipanti, mai la chat.
var hikeIdAperta = null;

async function showHikePage(hikeId) {
    if (!hikeId) return;
    if (window.navigateTo) window.navigateTo("hike-page");
    await renderHikePage(hikeId);
}

async function renderHikePage(hikeId) {
    hikeIdAperta = hikeId;
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    const headerBox = document.getElementById("hike-page-header");
    const membersBox = document.getElementById("hike-page-members");
    const chatBox = document.getElementById("hike-page-chat");
    if (!headerBox || !membersBox || !chatBox) return;

    if (!hike) {
        headerBox.innerHTML = `<p class="text-muted">${window.escapeHtml(T('hikePage.nonTrovata') || 'Escursione non trovata.')}</p>`;
        membersBox.innerHTML = "";
        chatBox.innerHTML = "";
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = hike.title;

    renderHikePageHeader(hike, headerBox);
    renderHikePageParticipants(hike, membersBox);
    window.CamoscioChatPanel.render({ box: chatBox, apiBase: `/api/hikes/${hike.id}`, title: T('hikePage.chatTitolo') || 'Chat Escursione' });

    if (window.lucide) window.lucide.createIcons();
}

// Solo intestazione + partecipanti, senza la chat - richiamabile da sola dal
// cambio lingua (vedi CamoscioI18n.onChange in fondo al file), stesso principio
// di refreshSquadHeaderAndMembers in squadpage.js.
function refreshHikePageHeaderAndMembers(hikeId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;
    // Punto 102, stessa correzione di refreshSquadHeaderAndMembers in squadpage.js:
    // updateSectionTitle (app.js) sovrascriverebbe #section-title con "Camoscio"
    // a ogni cambio lingua (nessuna voce "hike-page" in prettyNames).
    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = hike.title;
    renderHikePageHeader(hike, document.getElementById("hike-page-header"));
    renderHikePageParticipants(hike, document.getElementById("hike-page-members"));
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
        const nome = p ? esc(p.username) : esc(T('common.utente') || 'Utente');
        const avatar = p ? esc(p.avatar) : "👤";
        return `
            <div class="squad-item" style="cursor:pointer;" onclick="showUserProfile('${pId}')">
                <div><h5>${avatar} ${nome}</h5></div>
            </div>
        `;
    }).join("");

    box.innerHTML = `
        <h4><i data-lucide="users"></i> ${esc(T('hikePage.partecipanti') || 'Partecipanti')}</h4>
        <div class="squads-list">${rows}</div>
    `;
}

window.showHikePage = showHikePage;

// Cambio lingua: solo intestazione/partecipanti, MAI la chat (stesso motivo di
// squadpage.js) - dati gia' in window.CamoscioState, zero fetch, zero costo.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    const section = document.getElementById('hike-page');
    if (section && section.classList.contains('active') && hikeIdAperta) {
        refreshHikePageHeaderAndMembers(hikeIdAperta);
    }
});
