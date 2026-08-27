// Pannello di chat generico (punto 55) - condiviso tra la pagina squadra (punto 48) e la
// pagina escursione: stessa lista messaggi, stesso invio, stesso polling ogni 5s. Non sa
// cosa sia una squadra o un'escursione, sa solo disegnare una chat contro un endpoint
// dentro un contenitore - la policy di chi puo' leggere/scrivere resta lato server
// (isSquadMember in routes/squads.js, isHikeParticipant in routes/hikes.js).
//
// Niente id fissi per gli elementi interni: tutte le .page-section restano nel DOM insieme
// (navigateTo in app.js aggiunge/toglie solo la classe "active", non smonta nulla), quindi
// due chat aperte nella stessa sessione avrebbero due nodi con lo stesso id - risolto
// leggendo sempre con box.querySelector(...) scoped al contenitore passato, mai
// document.getElementById su una stringa fissa.

// Rollout traduzione punto 102, quinto lotto (28/08/2026): stringhe interne della chat.
// Il titolo lo passa gia' tradotto chi chiama render({title}) (squadPage.chatTitolo /
// hikePage.chatTitolo, primo lotto). NESSUN onChange: il giro di polling perderebbe la
// posizione di scroll se rilanciato, e i messaggi nuovi escono gia' nella lingua attiva
// (residuo onesto gia' documentato per questa chat in 07-Trappole-Tecniche.md).
// "var", non "const": vedi la nota in cima a i18n.js.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

let chatPollTimer = null;

// { box: elemento dove disegnare, apiBase: es. '/api/squads/ID' o '/api/hikes/ID'
//   (il modulo aggiunge "/messages"), title: es. "Chat di Squadra" }
function renderChatPanel({ box, apiBase, title }) {
    if (chatPollTimer) {
        clearInterval(chatPollTimer);
        chatPollTimer = null;
    }

    const esc = window.escapeHtml;

    box.innerHTML = `
        <div class="chat-box">
            <h5><i data-lucide="message-square"></i> ${esc(title)}</h5>
            <div class="chat-messages">
                <div class="message system">${esc(T('chat.loading') || 'Caricamento messaggi...')}</div>
            </div>
            <form class="chat-send-form">
                <input type="text" placeholder="${esc(T('chat.inputPlaceholder') || 'Scrivi un messaggio...')}" required maxlength="1000">
                <button type="submit" class="btn btn-sm btn-primary">${esc(T('chat.send') || 'Invia')}</button>
            </form>
        </div>
    `;

    box.querySelector(".chat-send-form").addEventListener("submit", (e) => {
        e.preventDefault();
        sendChatMessage(box, apiBase);
    });

    loadChatMessages(box, apiBase);
    chatPollTimer = setInterval(() => {
        // box.closest, non un id di sezione passato a mano: niente da disallineare se
        // domani questo pannello finisce su una terza pagina.
        const section = box.closest(".page-section");
        if (!section || !section.classList.contains("active")) {
            clearInterval(chatPollTimer);
            chatPollTimer = null;
            return;
        }
        loadChatMessages(box, apiBase);
    }, 5000);
}

async function loadChatMessages(box, apiBase) {
    const log = box.querySelector(".chat-messages");
    if (!log) return;
    try {
        const response = await fetch(`${apiBase}/messages`);
        if (!response.ok) return;
        renderChatMessages(await response.json(), log);
    } catch (e) {
        console.error("Errore caricamento messaggi chat:", e);
    }
}

function renderChatMessages(messages, log) {
    const db = window.CamoscioState;
    const esc = window.escapeHtml;
    // Non forzare lo scroll in basso se si e' saliti a leggere i messaggi vecchi - solo
    // se si era gia' in fondo (o vicino), coerente con qualunque chat.
    const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 40;

    if (messages.length === 0) {
        log.innerHTML = `<div class="message system">${esc(T('chat.empty') || 'Nessun messaggio, scrivi il primo.')}</div>`;
    } else {
        log.innerHTML = messages.map(m => {
            const mittente = db.users.find(u => u.id === m.senderId);
            const nome = mittente ? esc(mittente.username) : esc(T('common.utente') || "Utente");
            const isMine = m.senderId === db.currentUser.id;
            return `<div class="message ${isMine ? 'sent' : 'received'}">${isMine ? '' : `<b>${nome}:</b> `}${esc(m.text)}</div>`;
        }).join("");
    }

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

async function sendChatMessage(box, apiBase) {
    const input = box.querySelector(".chat-send-form input");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    try {
        const response = await fetch(`${apiBase}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (response.ok) {
            input.value = "";
            await loadChatMessages(box, apiBase);
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || T('chat.errSend') || "Impossibile inviare il messaggio.", "error");
        }
    } catch (e) {
        console.error("Errore invio messaggio chat:", e);
        window.showToast(T('chat.errSend') || "Impossibile inviare il messaggio.", "error");
    }
}

window.CamoscioChatPanel = { render: renderChatPanel };
