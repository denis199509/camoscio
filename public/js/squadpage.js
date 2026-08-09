// Pagina di UNA squadra (punto 48) - si apre cliccando una squadra in Tribu' & Squadre
// (vedi public/js/social.js, renderSquadsList). Stesso principio di userprofile.js:
// nessuna voce in barra laterale, la squadra si legge da window.CamoscioState.squads
// (gia' caricata da refreshState - GET /api/squads porta gia' photo/admins) invece di
// fare una fetch in piu' solo per aprire la pagina.
//
// La chat (punto 48, poi condivisa col punto 55) vive in public/js/chatpanel.js.

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
    const joinBox = document.getElementById("squad-page-join");
    const membersBox = document.getElementById("squad-page-members");
    const chatBox = document.getElementById("squad-page-chat");
    if (!headerBox || !membersBox || !chatBox) return;

    if (!squad) {
        headerBox.innerHTML = `<p class="text-muted">Squadra non trovata.</p>`;
        if (joinBox) { joinBox.innerHTML = ""; joinBox.classList.add("hidden"); }
        membersBox.innerHTML = "";
        chatBox.innerHTML = "";
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = squad.name;

    const isMember = isSquadMemberClient(squad, db.currentUser.id);
    const canManage = isSquadAdminClient(squad, db.currentUser.id);
    renderSquadHeader(squad, canManage, headerBox);
    if (joinBox) renderSquadJoinBox(squad, isMember, canManage, joinBox);
    renderSquadMembers(squad, canManage, membersBox);

    // Punto 75: la chat resta riservata ai membri (stesso principio gia' seguito per il
    // tasto Chat di un'escursione, punto 55: visibile/raggiungibile solo a chi partecipa).
    // Senza questo controllo il pannello restava a "Caricamento messaggi..." per sempre -
    // GET /:id/messages risponde 403 a un non membro e chatpanel.js non lo segnala a schermo.
    if (isMember) {
        chatBox.classList.remove("hidden");
        window.CamoscioChatPanel.render({ box: chatBox, apiBase: `/api/squads/${squad.id}`, title: 'Chat di Squadra' });
    } else {
        chatBox.classList.add("hidden");
        chatBox.innerHTML = "";
    }

    if (window.lucide) window.lucide.createIcons();
}

// Solo intestazione, richieste pendenti ed elenco membri - usata dopo un'azione admin
// (foto, promuovi, rimuovi, approva/rifiuta richiesta) per non toccare la chat, che ha un
// suo giro di polling gia' avviato e non deve ripartire da capo (perderebbe la posizione
// di scroll) ogni volta.
function refreshSquadHeaderAndMembers(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    if (!squad) return;
    const isMember = isSquadMemberClient(squad, db.currentUser.id);
    const canManage = isSquadAdminClient(squad, db.currentUser.id);
    renderSquadHeader(squad, canManage, document.getElementById("squad-page-header"));
    const joinBox = document.getElementById("squad-page-join");
    if (joinBox) renderSquadJoinBox(squad, isMember, canManage, joinBox);
    renderSquadMembers(squad, canManage, document.getElementById("squad-page-members"));
    if (window.lucide) window.lucide.createIcons();
}

// Punto 75: le due situazioni non capitano mai insieme alla stessa persona - un
// amministratore e' sempre gia' membro, chi vede il tasto di richiesta non lo e' ancora.
function renderSquadJoinBox(squad, isMember, canManage, box) {
    const esc = window.escapeHtml;
    const db = window.CamoscioState;

    if (canManage) {
        const pending = squad.pendingRequests || [];
        if (pending.length === 0) {
            box.classList.add("hidden");
            box.innerHTML = "";
            return;
        }
        box.classList.remove("hidden");
        // Stesso stile del "Pannello Veto del Capogruppo" gia' usato per le richieste di
        // partecipazione a un'escursione (social.js) - stesse classi, stesso principio.
        const righe = pending.map(id => {
            const u = db.users.find(u => u.id === id);
            const nome = u ? esc(u.username) : "Utente";
            const avatar = u ? esc(u.avatar) : "👤";
            return `
                <div class="veto-request-item">
                    <span>${avatar} <b>${nome}</b></span>
                    <div class="veto-actions">
                        <button class="btn btn-sm btn-success" style="padding:2px 6px;" onclick="approveSquadRequest('${squad.id}','${id}')">Accetta</button>
                        <button class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="declineSquadRequest('${squad.id}','${id}')">Rifiuta</button>
                    </div>
                </div>
            `;
        }).join("");
        box.innerHTML = `
            <div class="veto-management-box">
                <span class="small font-bold text-warning" style="display:block; margin-bottom:6px;"><i data-lucide="shield-alert"></i> Richieste di partecipazione:</span>
                ${righe}
            </div>
        `;
        return;
    }

    if (isMember) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }

    box.classList.remove("hidden");
    const giaRichiesta = (squad.pendingRequests || []).includes(db.currentUser.id);
    box.innerHTML = giaRichiesta
        ? `<p class="small text-muted"><i data-lucide="clock"></i> Richiesta di partecipazione inviata: aspetta la conferma di un amministratore.</p>`
        : `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
               <p class="small text-muted" style="margin:0;">Non fai ancora parte di questa squadra.</p>
               <button class="btn btn-sm btn-primary" onclick="requestJoinSquad('${squad.id}')">Richiesta Partecipazione</button>
           </div>`;
}

async function approveSquadRequest(squadId, userId) {
    try {
        const response = await fetch(`/api/squads/${squadId}/approve/${userId}`, { method: 'POST' });
        if (response.ok) {
            updateLocalSquad(await response.json());
            refreshSquadHeaderAndMembers(squadId);
            if (window.renderOtherSquadsList) window.renderOtherSquadsList();
            if (window.renderSquadsList) window.renderSquadsList();
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile approvare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore approvazione richiesta squadra:", e);
        window.showToast("Impossibile approvare la richiesta.", "error");
    }
}

async function declineSquadRequest(squadId, userId) {
    try {
        const response = await fetch(`/api/squads/${squadId}/pending/${userId}`, { method: 'DELETE' });
        if (response.ok) {
            updateLocalSquad(await response.json());
            refreshSquadHeaderAndMembers(squadId);
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile rifiutare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore rifiuto richiesta squadra:", e);
        window.showToast("Impossibile rifiutare la richiesta.", "error");
    }
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

window.showSquadPage = showSquadPage;
window.promoteSquadMember = promoteSquadMember;
window.demoteSquadMember = demoteSquadMember;
window.approveSquadRequest = approveSquadRequest;
window.declineSquadRequest = declineSquadRequest;
window.updateLocalSquad = updateLocalSquad;
window.refreshSquadHeaderAndMembers = refreshSquadHeaderAndMembers;
