// Pagina di UNA squadra (punto 48) - si apre cliccando una squadra in Tribu' & Squadre
// (vedi public/js/social.js, renderSquadsList). Stesso principio di userprofile.js:
// nessuna voce in barra laterale, la squadra si legge da window.CamoscioState.squads
// (gia' caricata da refreshState - GET /api/squads porta gia' photo/admins) invece di
// fare una fetch in piu' solo per aprire la pagina.

let squadChatPollTimer = null;

function isSquadAdminClient(squad, userId) {
    return squad.creatorId === userId || (squad.admins || []).includes(userId);
}

function isSquadMemberClient(squad, userId) {
    return squad.creatorId === userId || (squad.members || []).includes(userId);
}

async function showSquadPage(squadId) {
    if (!squadId) return;
    if (window.navigateTo) window.navigateTo("squad-page");
    await renderSquadPage(squadId);
}

async function renderSquadPage(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    const headerBox = document.getElementById("squad-page-header");
    const membersBox = document.getElementById("squad-page-members");
    const chatBox = document.getElementById("squad-page-chat");
    if (!headerBox || !membersBox || !chatBox) return;

    if (!squad) {
        headerBox.innerHTML = `<p class="text-muted">Squadra non trovata.</p>`;
        membersBox.innerHTML = "";
        chatBox.innerHTML = "";
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = squad.name;

    const canManage = isSquadAdminClient(squad, db.currentUser.id);
    renderSquadHeader(squad, canManage, headerBox);
    renderSquadMembers(squad, canManage, membersBox);
    renderSquadChat(squad, chatBox);

    if (window.lucide) window.lucide.createIcons();
}

// Solo intestazione ed elenco membri - usata dopo un'azione admin (foto, promuovi,
// rimuovi) per non toccare la chat, che ha un suo giro di polling gia' avviato e non
// deve ripartire da capo (perderebbe la posizione di scroll) ogni volta.
function refreshSquadHeaderAndMembers(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    if (!squad) return;
    const canManage = isSquadAdminClient(squad, db.currentUser.id);
    renderSquadHeader(squad, canManage, document.getElementById("squad-page-header"));
    renderSquadMembers(squad, canManage, document.getElementById("squad-page-members"));
    if (window.lucide) window.lucide.createIcons();
}

function renderSquadHeader(squad, canManage, box) {
    const esc = window.escapeHtml;
    const photoHtml = squad.photo
        ? `<img src="${esc(squad.photo)}" alt="Foto squadra">`
        : "👥";

    box.innerHTML = `
        <div class="photo-upload-row">
            <div class="photo-preview-circle" id="squad-photo-preview">${photoHtml}</div>
            <h3 class="font-bold">${esc(squad.name)}</h3>
        </div>
        ${canManage ? `
            <div class="form-group">
                <label for="squad-photo-input" class="small text-muted">Cambia foto squadra (solo amministratori):</label>
                <input type="file" id="squad-photo-input" accept="image/*">
            </div>
        ` : ""}
    `;

    if (canManage) {
        document.getElementById("squad-photo-input").addEventListener("change", (e) => handleSquadPhotoChange(e, squad.id));
    }
}

function handleSquadPhotoChange(e, squadId) {
    const file = e.target.files[0];
    if (!file) return;
    // Stesso tetto lato client della foto profilo utente (public/js/profile.js):
    // il server valida i byte decodificati (MAX_PHOTO_LENGTH in routes/squads.js).
    if (file.size > 1.5 * 1024 * 1024) {
        window.showToast("Foto troppo grande, scegline una più piccola (max ~1.5MB).", "error");
        e.target.value = "";
        return;
    }
    const reader = new FileReader();
    reader.onload = () => saveSquadPhoto(squadId, reader.result);
    reader.readAsDataURL(file);
}

async function saveSquadPhoto(squadId, dataUrl) {
    try {
        const response = await fetch(`/api/squads/${squadId}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: dataUrl })
        });
        if (response.ok) {
            updateLocalSquad(await response.json());
            refreshSquadHeaderAndMembers(squadId);
            window.showToast("Foto della squadra aggiornata.", "success");
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile cambiare la foto della squadra.", "error");
        }
    } catch (e) {
        console.error("Errore cambio foto squadra:", e);
        window.showToast("Impossibile cambiare la foto della squadra.", "error");
    }
}

function renderSquadMembers(squad, canManage, box) {
    const db = window.CamoscioState;
    const esc = window.escapeHtml;

    const rows = squad.members.map(memberId => {
        const mem = db.users.find(u => u.id === memberId);
        const nome = mem ? esc(mem.username) : "Utente";
        const avatar = mem ? esc(mem.avatar) : "👤";
        const isAdmin = isSquadAdminClient(squad, memberId);
        const isCreator = squad.creatorId === memberId;

        let actionHtml = isAdmin ? `<span class="badge badge-accent">Admin</span>` : "";
        if (canManage && !isCreator) {
            actionHtml += isAdmin
                ? ` <button class="btn btn-sm btn-secondary" onclick="demoteSquadMember('${squad.id}','${memberId}')">Rimuovi admin</button>`
                : ` <button class="btn btn-sm btn-secondary" onclick="promoteSquadMember('${squad.id}','${memberId}')">Rendi admin</button>`;
        }

        return `
            <div class="squad-item">
                <div><h5>${avatar} ${nome}</h5></div>
                <div>${actionHtml}</div>
            </div>
        `;
    }).join("");

    box.innerHTML = `
        <h4><i data-lucide="users"></i> Membri</h4>
        <div class="squads-list">${rows}</div>
    `;
}

async function promoteSquadMember(squadId, userId) {
    try {
        const response = await fetch(`/api/squads/${squadId}/admins/${userId}`, { method: 'POST' });
        if (response.ok) {
            updateLocalSquad(await response.json());
            refreshSquadHeaderAndMembers(squadId);
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile promuovere il membro.", "error");
        }
    } catch (e) {
        console.error("Errore promozione admin squadra:", e);
        window.showToast("Impossibile promuovere il membro.", "error");
    }
}

async function demoteSquadMember(squadId, userId) {
    try {
        const response = await fetch(`/api/squads/${squadId}/admins/${userId}`, { method: 'DELETE' });
        if (response.ok) {
            updateLocalSquad(await response.json());
            refreshSquadHeaderAndMembers(squadId);
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile rimuovere l'amministratore.", "error");
        }
    } catch (e) {
        console.error("Errore rimozione admin squadra:", e);
        window.showToast("Impossibile rimuovere l'amministratore.", "error");
    }
}

function updateLocalSquad(updatedSquad) {
    const db = window.CamoscioState;
    const idx = db.squads.findIndex(s => s.id === updatedSquad.id);
    if (idx !== -1) db.squads[idx] = updatedSquad;
    else db.squads.push(updatedSquad);
}

// Chat di squadra: niente WebSocket (vedi 03-Decisioni-Architetturali.md, punto 48) -
// polling ogni 5s finche' la sezione resta aperta, si ferma da solo al primo giro in cui
// non lo e' piu'. Ricreato ad ogni renderSquadChat (mai lasciato doppio: si ripulisce da
// solo all'inizio della funzione).
function renderSquadChat(squad, box) {
    if (squadChatPollTimer) {
        clearInterval(squadChatPollTimer);
        squadChatPollTimer = null;
    }

    box.innerHTML = `
        <div class="squad-chat-box">
            <h5><i data-lucide="message-square"></i> Chat di Squadra</h5>
            <div class="squad-messages" id="squad-messages-log">
                <div class="message system">Caricamento messaggi...</div>
            </div>
            <form id="squad-send-form" class="squad-send-form">
                <input type="text" id="squad-input-msg" placeholder="Scrivi un messaggio..." required maxlength="1000">
                <button type="submit" class="btn btn-sm btn-primary">Invia</button>
            </form>
        </div>
    `;

    document.getElementById("squad-send-form").addEventListener("submit", (e) => {
        e.preventDefault();
        sendSquadMessage(squad.id);
    });

    loadSquadMessages(squad.id);
    squadChatPollTimer = setInterval(() => {
        const section = document.getElementById("squad-page");
        if (!section || !section.classList.contains("active")) {
            clearInterval(squadChatPollTimer);
            squadChatPollTimer = null;
            return;
        }
        loadSquadMessages(squad.id);
    }, 5000);
}

async function loadSquadMessages(squadId) {
    const log = document.getElementById("squad-messages-log");
    if (!log) return;
    try {
        const response = await fetch(`/api/squads/${squadId}/messages`);
        if (!response.ok) return;
        renderSquadMessages(await response.json(), log);
    } catch (e) {
        console.error("Errore caricamento messaggi squadra:", e);
    }
}

function renderSquadMessages(messages, log) {
    const db = window.CamoscioState;
    const esc = window.escapeHtml;
    // Non forzare lo scroll in basso se si e' saliti a leggere i messaggi vecchi - solo
    // se si era gia' in fondo (o vicino), coerente con qualunque chat.
    const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 40;

    if (messages.length === 0) {
        log.innerHTML = `<div class="message system">Nessun messaggio, scrivi il primo.</div>`;
    } else {
        log.innerHTML = messages.map(m => {
            const mittente = db.users.find(u => u.id === m.senderId);
            const nome = mittente ? esc(mittente.username) : "Utente";
            const isMine = m.senderId === db.currentUser.id;
            return `<div class="message ${isMine ? 'sent' : 'received'}">${isMine ? '' : `<b>${nome}:</b> `}${esc(m.text)}</div>`;
        }).join("");
    }

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

async function sendSquadMessage(squadId) {
    const input = document.getElementById("squad-input-msg");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    try {
        const response = await fetch(`/api/squads/${squadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (response.ok) {
            input.value = "";
            await loadSquadMessages(squadId);
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile inviare il messaggio.", "error");
        }
    } catch (e) {
        console.error("Errore invio messaggio squadra:", e);
        window.showToast("Impossibile inviare il messaggio.", "error");
    }
}

window.showSquadPage = showSquadPage;
window.promoteSquadMember = promoteSquadMember;
window.demoteSquadMember = demoteSquadMember;
