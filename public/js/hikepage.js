// Pagina di UNA escursione (punto 55) - si apre cliccando "Chat" sulla card di
// un'escursione (vedi public/js/social.js, buildHikeCard). Stesso principio di
// squadpage.js: nessuna voce in barra laterale, l'escursione si legge da
// window.CamoscioState.hikes (gia' caricata da refreshState) invece di fare una fetch in
// piu' solo per aprire la pagina.
//
// V2 UX PASSO 14b: la pagina ha TAB INTERNI (Dettagli / Chat / Carpooling; PASSO 14c
// aggiunge Zaino). Una sola vista per volta via l'attributo data-hp-tab sulla
// <section> (CSS). Il tab Carpooling e' la ex .page-section #carpool, ora legata a
// QUESTA escursione: render pigro alla prima apertura del tab.

// Rollout traduzione punto 102 (22/08/2026). "var", non "const": vedi la nota in
// cima a i18n.js sul perche' (piu' file <script> classici che condividono lo
// stesso scope globale, "const T" ripetuto in due file darebbe SyntaxError).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Ultima escursione aperta, stesso principio di squadIdAperta in squadpage.js:
// un cambio lingua ridisegna SOLO intestazione/partecipanti, mai la chat.
var hikeIdAperta = null;
// Per quale escursione sono gia' stati disegnati i tab pesanti (render pigro: si
// rifanno solo alla prima apertura del tab o se cambia l'escursione).
var carpoolResoPerHikeId = null;
var backpackResoPerHikeId = null;

async function showHikePage(hikeId) {
    if (!hikeId) return;
    if (window.navigateTo) window.navigateTo("hike-page");
    await renderHikePage(hikeId);
}

async function renderHikePage(hikeId) {
    hikeIdAperta = hikeId;
    carpoolResoPerHikeId = null; // escursione cambiata: i tab pesanti vanno rifatti
    backpackResoPerHikeId = null;
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

    // A-1 (security review 21a): Chat / Carpooling / Zaino sono roba di gruppo. Normalmente
    // un non-partecipante non arriva nemmeno qui (il tasto "Chat" sulla card e' gated in
    // social.js), ma showHikePage e' su window - difesa in profondita'. Stessa condizione
    // usata altrove in social.js ("creatore o in participants"). Il gate vero resta lato
    // server (routes/hikes.js): qui si nasconde solo la UI degli altri tab.
    const io = db.currentUser && db.currentUser.id;
    const partecipo = !!io && (hike.creatorId === io || (hike.participants || []).includes(io));
    const hpSection = document.getElementById("hike-page");
    if (hpSection) hpSection.classList.toggle("hp-non-partecipo", !partecipo);

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = hike.title;

    renderHikePageHeader(hike, headerBox);
    renderHikePageParticipants(hike, membersBox);
    window.CamoscioChatPanel.render({ box: chatBox, apiBase: `/api/hikes/${hike.id}`, title: T('hikePage.chatTitolo') || 'Chat Escursione' });

    impostaTabHikePage("dettagli"); // si riparte sempre dal primo tab

    if (window.lucide) window.lucide.createIcons();
}

// Cambia il tab attivo di hike-page. Il filtro visivo e' CSS (data-hp-tab sulla
// <section>); qui si aggiorna l'attributo + la .active sul bottone, e si fa il
// render pigro del Carpooling alla prima apertura per questa escursione.
function impostaTabHikePage(tab) {
    const section = document.getElementById("hike-page");
    if (!section) return;
    if (["dettagli", "chat", "carpool", "backpack"].indexOf(tab) === -1) tab = "dettagli";
    // A-1: un non-partecipante resta sui Dettagli anche chiamando impostaTabHikePage da
    // console o cliccando un bottone (che il CSS gli nasconde). Vedi renderHikePage.
    if (section.classList.contains("hp-non-partecipo") && tab !== "dettagli") tab = "dettagli";
    section.setAttribute("data-hp-tab", tab);
    section.querySelectorAll(".hike-page-tabs .hp-tab").forEach(b => {
        b.classList.toggle("active", b.dataset.hpTab === tab);
    });

    if (tab === "carpool" && hikeIdAperta && carpoolResoPerHikeId !== hikeIdAperta) {
        if (window.renderCarpoolModule) {
            window.renderCarpoolModule(hikeIdAperta);
            carpoolResoPerHikeId = hikeIdAperta;
        }
    }
    if (tab === "backpack" && hikeIdAperta && backpackResoPerHikeId !== hikeIdAperta) {
        if (window.renderBackpackModule) {
            window.renderBackpackModule(hikeIdAperta);
            backpackResoPerHikeId = hikeIdAperta;
        }
    }
    if (window.lucide) window.lucide.createIcons();
}
window.impostaTabHikePage = impostaTabHikePage;

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

// Barra dei tab: un solo listener delegato (la .hike-page-tabs e' statica nell'HTML).
(function () {
    const tabs = document.querySelector(".hike-page-tabs");
    if (!tabs) return;
    tabs.addEventListener("click", function (e) {
        const btn = e.target.closest(".hp-tab");
        if (btn) impostaTabHikePage(btn.dataset.hpTab);
    });
})();

// Cambio lingua: solo intestazione/partecipanti, MAI la chat (stesso motivo di
// squadpage.js) - dati gia' in window.CamoscioState, zero fetch, zero costo.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    const section = document.getElementById('hike-page');
    if (section && section.classList.contains('active') && hikeIdAperta) {
        refreshHikePageHeaderAndMembers(hikeIdAperta);
    }
});
