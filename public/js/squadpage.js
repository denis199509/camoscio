// Pagina di UNA squadra (punto 48) - si apre cliccando una squadra in Tribu' & Squadre
// (vedi public/js/social.js, renderSquadsList). Stesso principio di userprofile.js:
// nessuna voce in barra laterale, la squadra si legge da window.CamoscioState.squads
// (gia' caricata da refreshState - GET /api/squads porta gia' admins/membri) invece di
// fare una fetch in piu' solo per aprire la pagina. Unica eccezione dalla 28ª: la FOTO,
// che GET /api/squads non porta piu' (MEDIO-3) - la carica caricaFotoSquadra qui sotto.
//
// La chat (punto 48, poi condivisa col punto 55) vive in public/js/chatpanel.js.

// Rollout traduzione punto 102 (22/08/2026). "var", non "const": vedi la nota in
// cima a i18n.js sul perche' (piu' file <script> classici che condividono lo
// stesso scope globale, "const T" ripetuto in due file darebbe SyntaxError).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Ultima squadra aperta, per poter aggiornare SOLO intestazione/membri/richieste
// a un cambio lingua (vedi CamoscioI18n.onChange in fondo al file) senza toccare
// la chat: chatpanel.js ha un suo giro di polling avviato che perderebbe la
// posizione di scroll se richiamato di nuovo (stessa lezione gia' scritta per
// refreshSquadHeaderAndMembers, qui applicata anche al cambio lingua).
var squadIdAperta = null;

// MEDIO-3 (revisione sicurezza 28ª): GET /api/squads non porta piu' la foto (era un data URL
// fino a 2 MB caricato per OGNI squadra a OGNI refreshState di OGNI utente - RAM finita su
// Render). La pagina della singola squadra la chiede a parte (GET /api/squads/:id/photo) e la
// tiene qui, per squadId: cosi' sopravvive ai refreshState che rimpiazzano l'oggetto dentro
// CamoscioState.squads.
var fotoSquadraPerId = {};

async function caricaFotoSquadra(squadId) {
    try {
        const r = await fetch(`/api/squads/${squadId}/photo`);
        if (!r.ok) return; // 404 se la squadra e' sparita (la rotta e' solo requireAuth): resta il segnaposto
        const { photo } = await r.json();
        fotoSquadraPerId[squadId] = photo || null;
        if (squadIdAperta === squadId) refreshSquadHeaderAndMembers(squadId);
    } catch (e) {
        // La foto non e' essenziale: senza, l'intestazione mostra il segnaposto 👥.
        console.error("Foto squadra non caricata:", e);
    }
}

function isSquadAdminClient(squad, userId) {
    return squad.creatorId === userId || (squad.admins || []).includes(userId);
}

function isSquadMemberClient(squad, userId) {
    return squad.creatorId === userId || (squad.members || []).includes(userId);
}

async function showSquadPage(squadId) {
    if (!squadId) return;
    if (window.navigateTo) window.navigateTo("squad-page", null, { entita: squadId });
    await renderSquadPage(squadId);
}

async function renderSquadPage(squadId) {
    squadIdAperta = squadId;
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    const headerBox = document.getElementById("squad-page-header");
    const joinBox = document.getElementById("squad-page-join");
    const membersBox = document.getElementById("squad-page-members");
    const chatBox = document.getElementById("squad-page-chat");
    if (!headerBox || !membersBox || !chatBox) return;

    if (!squad) {
        headerBox.innerHTML = `<p class="text-muted">${window.escapeHtml(T('squadPage.nonTrovata') || 'Squadra non trovata.')}</p>`;
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
    // MEDIO-3: la foto arriva da una rotta a sé. Fire-and-forget: quando risponde,
    // caricaFotoSquadra ridisegna l'intestazione da solo (solo se è ancora questa la aperta).
    caricaFotoSquadra(squadId);

    // Punto 75: la chat resta riservata ai membri (stesso principio gia' seguito per il
    // tasto Chat di un'escursione, punto 55: visibile/raggiungibile solo a chi partecipa).
    // Senza questo controllo il pannello restava a "Caricamento messaggi..." per sempre -
    // GET /:id/messages risponde 403 a un non membro e chatpanel.js non lo segnala a schermo.
    if (isMember) {
        chatBox.classList.remove("hidden");
        window.CamoscioChatPanel.render({ box: chatBox, apiBase: `/api/squads/${squad.id}`, title: T('squadPage.chatTitolo') || 'Chat di Squadra' });
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
    // Punto 102, trovato provando dal vivo: updateSectionTitle (app.js) sovrascrive
    // #section-title a ogni cambio lingua usando prettyNames[id] - che per
    // "squad-page" non esiste, quindi tornerebbe a "Camoscio" invece del nome vero
    // della squadra. Va rimesso qui ogni volta (innocuo quando la chiamata arriva
    // da un'azione admin: squad.name non cambia da quelle azioni).
    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = squad.name;
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
        const inviti = squad.pendingInvites || [];
        if (pending.length === 0 && inviti.length === 0) {
            box.classList.add("hidden");
            box.innerHTML = "";
            return;
        }
        box.classList.remove("hidden");
        // Stesso stile del "Pannello Veto del Capogruppo" gia' usato per le richieste di
        // partecipazione a un'escursione (social.js) - stesse classi, stesso principio.
        const righeRichieste = pending.map(id => {
            const u = db.users.find(u => u.id === id);
            const nome = u ? esc(u.username) : esc(T('common.utente') || 'Utente');
            const avatar = u ? esc(u.avatar) : "👤";
            return `
                <div class="veto-request-item">
                    <span>${avatar} <b>${nome}</b></span>
                    <div class="veto-actions">
                        <button class="btn btn-sm btn-success" style="padding:2px 6px;" onclick="approveSquadRequest('${squad.id}','${id}')">${esc(T('squadPage.accetta') || 'Accetta')}</button>
                        <button class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="declineSquadRequest('${squad.id}','${id}')">${esc(T('squadPage.rifiuta') || 'Rifiuta')}</button>
                    </div>
                </div>
            `;
        }).join("");
        // 27ª: inviti in attesa - SOLA LETTURA (decide l'invitato) + "annulla" per l'admin.
        const righeInviti = inviti.map(id => {
            const u = db.users.find(u => u.id === id);
            const nome = u ? esc(u.username) : esc(T('common.utente') || 'Utente');
            const avatar = u ? esc(u.avatar) : "👤";
            return `
                <div class="veto-request-item">
                    <span>${avatar} <b>${nome}</b> <span class="small text-muted">${esc(T('squadPage.invitatoInAttesa') || 'invitato, in attesa')}</span></span>
                    <div class="veto-actions">
                        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="annullaInvitoSquadra('${squad.id}','${id}')">${esc(T('squadPage.annullaInvito') || 'Annulla')}</button>
                    </div>
                </div>
            `;
        }).join("");
        box.innerHTML = `
            <div class="veto-management-box">
                ${pending.length ? `<span class="small font-bold text-warning" style="display:block; margin-bottom:6px;"><i data-lucide="shield-alert"></i> ${esc(T('squadPage.richiestePartecipazione') || 'Richieste di partecipazione:')}</span>${righeRichieste}` : ''}
                ${inviti.length ? `<span class="small font-bold text-muted" style="display:block; margin:${pending.length ? '10px' : '0'} 0 6px;"><i data-lucide="mail"></i> ${esc(T('squadPage.invitiInAttesa') || 'Inviti in attesa:')}</span>${righeInviti}` : ''}
            </div>
        `;
        return;
    }

    // 27ª: sei stato INVITATO a questa squadra -> Accetta / Rifiuta.
    if (!isMember && (squad.pendingInvites || []).includes(db.currentUser.id)) {
        box.classList.remove("hidden");
        box.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <p class="small text-muted" style="margin:0;">${esc(T('squadPage.seiInvitato') || 'Sei stato invitato in questa squadra.')}</p>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm btn-success" onclick="rispondiInvitoSquadra('${squad.id}', true)">${esc(T('social.acceptSquadInvite') || 'Accetta')}</button>
                    <button class="btn btn-sm btn-danger" onclick="rispondiInvitoSquadra('${squad.id}', false)">${esc(T('social.declineSquadInvite') || 'Rifiuta')}</button>
                </div>
            </div>`;
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
        ? `<p class="small text-muted"><i data-lucide="clock"></i> ${esc(T('squadPage.richiestaInviata') || 'Richiesta di partecipazione inviata: aspetta la conferma di un amministratore.')}</p>`
        : `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
               <p class="small text-muted" style="margin:0;">${esc(T('squadPage.nonMembro') || 'Non fai ancora parte di questa squadra.')}</p>
               <button class="btn btn-sm btn-primary" onclick="requestJoinSquad('${squad.id}')">${esc(T('squadPage.richiediPartecipazione') || 'Richiesta Partecipazione')}</button>
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
            window.showToast(err.error || T('squadPage.erroreApprovazione') || "Impossibile approvare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore approvazione richiesta squadra:", e);
        window.showToast(T('squadPage.erroreApprovazione') || "Impossibile approvare la richiesta.", "error");
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
            window.showToast(err.error || T('squadPage.erroreRifiuto') || "Impossibile rifiutare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore rifiuto richiesta squadra:", e);
        window.showToast(T('squadPage.erroreRifiuto') || "Impossibile rifiutare la richiesta.", "error");
    }
}

function renderSquadHeader(squad, canManage, box) {
    const esc = window.escapeHtml;
    // MEDIO-3: la foto non arriva piu' dentro l'oggetto squad (GET /api/squads). Ripiego su
    // quella caricata a parte da caricaFotoSquadra; squad.photo resta come primo posto per il
    // caso "appena cambiata" (la risposta di PUT /:id/photo la contiene ancora).
    const foto = squad.photo || fotoSquadraPerId[squad.id];
    const photoHtml = foto
        ? `<img src="${esc(foto)}" alt="${esc(T('squadPage.fotoAlt') || 'Foto squadra')}">`
        : "👥";

    box.innerHTML = `
        <div class="photo-upload-row">
            <div class="photo-preview-circle" id="squad-photo-preview">${photoHtml}</div>
            <h3 class="font-bold">${esc(squad.name)}</h3>
        </div>
        ${canManage ? `
            <div class="form-group">
                <label for="squad-photo-input" class="small text-muted">${esc(T('squadPage.cambiaFoto') || 'Cambia foto squadra (solo amministratori):')}</label>
                <input type="file" id="squad-photo-input" accept="image/*">
            </div>
        ` : ""}
    `;

    if (canManage) {
        document.getElementById("squad-photo-input").addEventListener("change", (e) => handleSquadPhotoChange(e, squad.id));
    }
}

// MEDIO-3 residuo (follow-up revisione sicurezza): prima si mandava il file scelto cosi'
// com'e' (fino a 1.5 MB), qui si comprime lato client come gia' fa il FAB foto di una
// segnalazione (map.js) - stesso modulo, stesso schema: comprimi() ridimensiona e ricodifica
// SEMPRE in JPEG (public/js/imagecompress.js), quindi il server ora accetta solo JPEG
// (routes/squads.js). 20 scritture/ora x un payload molto piu' piccolo di prima abbassa di
// molto il tetto di riempimento Atlas nel caso peggiore (un admin che manda la foto piu'
// grande possibile ad ogni chiamata), senza cambiare il limiter stesso.
async function handleSquadPhotoChange(e, squadId) {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = window.CamoscioImageCompress
        ? await window.CamoscioImageCompress.comprimi(file)
        : null;
    e.target.value = "";
    if (!dataUrl) {
        window.showToast(T('squadPage.fotoNonElaborata') || "Non è stato possibile elaborare la foto scelta.", "error");
        return;
    }
    await saveSquadPhoto(squadId, dataUrl);
}

async function saveSquadPhoto(squadId, dataUrl) {
    try {
        const response = await fetch(`/api/squads/${squadId}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: dataUrl })
        });
        if (response.ok) {
            const aggiornata = await response.json();
            updateLocalSquad(aggiornata);
            // Tieni allineata anche la cache per-id (MEDIO-3): un refreshState successivo
            // rimpiazza l'oggetto squad SENZA foto, e senza questo l'anteprima tornerebbe a 👥.
            fotoSquadraPerId[squadId] = aggiornata.photo || null;
            refreshSquadHeaderAndMembers(squadId);
            window.showToast(T('squadPage.fotoAggiornata') || "Foto della squadra aggiornata.", "success");
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || T('squadPage.erroreFoto') || "Impossibile cambiare la foto della squadra.", "error");
        }
    } catch (e) {
        console.error("Errore cambio foto squadra:", e);
        window.showToast(T('squadPage.erroreFoto') || "Impossibile cambiare la foto della squadra.", "error");
    }
}

function renderSquadMembers(squad, canManage, box) {
    const db = window.CamoscioState;
    const esc = window.escapeHtml;

    const rows = squad.members.map(memberId => {
        const mem = db.users.find(u => u.id === memberId);
        const nome = mem ? esc(mem.username) : esc(T('common.utente') || 'Utente');
        const avatar = mem ? esc(mem.avatar) : "👤";
        const isAdmin = isSquadAdminClient(squad, memberId);
        const isCreator = squad.creatorId === memberId;

        let actionHtml = isAdmin ? `<span class="badge badge-accent">Admin</span>` : "";
        if (canManage && !isCreator) {
            actionHtml += isAdmin
                ? ` <button class="btn btn-sm btn-secondary" onclick="demoteSquadMember('${squad.id}','${memberId}')">${esc(T('squadPage.rimuoviAdmin') || 'Rimuovi admin')}</button>`
                : ` <button class="btn btn-sm btn-secondary" onclick="promoteSquadMember('${squad.id}','${memberId}')">${esc(T('squadPage.rendiAdmin') || 'Rendi admin')}</button>`;
            actionHtml += ` <button class="btn btn-sm btn-danger" style="padding:2px 8px;" title="${esc(T('squadPage.rimuoviMembro') || 'Rimuovi dalla squadra')}" onclick="rimuoviMembroSquadra('${squad.id}','${memberId}')">✕</button>`;
        }

        return `
            <div class="squad-item">
                <div><h5>${avatar} ${nome}</h5></div>
                <div>${actionHtml}</div>
            </div>
        `;
    }).join("");

    // 27ª: la porta d'uscita. Vale per QUALUNQUE membro, creatore compreso (in quel caso la
    // conferma avvisa che la squadra passa a un altro).
    const sonoMembro = isSquadMemberClient(squad, db.currentUser.id);

    box.innerHTML = `
        <h4><i data-lucide="users"></i> ${esc(T('squadPage.membri') || 'Membri')}</h4>
        <div class="squads-list">${rows}</div>
        ${sonoMembro ? `<div style="margin-top:10px;"><button class="btn btn-sm btn-secondary" onclick="lasciaSquadra('${squad.id}')"><i data-lucide="log-out"></i> ${esc(T('squadPage.lasciaSquadra') || 'Lascia la squadra')}</button></div>` : ''}
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
            window.showToast(err.error || T('squadPage.errorePromozione') || "Impossibile promuovere il membro.", "error");
        }
    } catch (e) {
        console.error("Errore promozione admin squadra:", e);
        window.showToast(T('squadPage.errorePromozione') || "Impossibile promuovere il membro.", "error");
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
            window.showToast(err.error || T('squadPage.erroreRimozioneAdmin') || "Impossibile rimuovere l'amministratore.", "error");
        }
    } catch (e) {
        console.error("Errore rimozione admin squadra:", e);
        window.showToast(T('squadPage.erroreRimozioneAdmin') || "Impossibile rimuovere l'amministratore.", "error");
    }
}

function updateLocalSquad(updatedSquad) {
    const db = window.CamoscioState;
    const idx = db.squads.findIndex(s => s.id === updatedSquad.id);
    if (idx !== -1) db.squads[idx] = updatedSquad;
    else db.squads.push(updatedSquad);
}

// --- 27ª: consenso squadra ------------------------------------------------------

async function annullaInvitoSquadra(squadId, userId) {
    try {
        const r = await fetch(`/api/squads/${squadId}/invites/${userId}`, { method: 'DELETE' });
        if (r.ok) { updateLocalSquad(await r.json()); refreshSquadHeaderAndMembers(squadId); }
        else {
            const e = await r.json().catch(() => ({}));
            window.showToast(e.error || T('squadPage.erroreAnnullaInvito') || "Impossibile annullare l'invito.", "error");
        }
    } catch (e) {
        console.error("Errore annullamento invito squadra:", e);
        window.showToast(T('squadPage.erroreAnnullaInvito') || "Impossibile annullare l'invito.", "error");
    }
}

async function rimuoviMembroSquadra(squadId, userId) {
    const msg = T('squadPage.confermaRimuoviMembro') || 'Rimuovere questa persona dalla squadra?';
    const proc = window.showConfirmModal ? await window.showConfirmModal(msg) : window.confirm(msg);
    if (!proc) return;
    await eseguiUscitaSquadra(squadId, userId, false);
}

async function lasciaSquadra(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    if (!squad) return;
    const io = db.currentUser.id;
    const altri = (squad.members || []).filter(m => m !== io);
    const righe = [T('squadPage.lasciaConfermaBase') || 'Vuoi lasciare questa squadra?'];
    if (altri.length === 0) righe.push(T('squadPage.lasciaUltimoMembro') || 'Sei l\'ultimo membro: la squadra e la sua chat spariranno.');
    else if (squad.creatorId === io) righe.push(T('squadPage.lasciaCreatore') || 'Hai creato tu la squadra: passerà al membro più anziano.');
    const proc = window.showConfirmModal
        ? await window.showConfirmModal(righe.join('\n\n'), T('squadPage.lasciaSquadra') || 'Lascia la squadra')
        : window.confirm(righe.join('\n'));
    if (!proc) return;
    await eseguiUscitaSquadra(squadId, io, true);
}

async function eseguiUscitaSquadra(squadId, userId, sonoIo) {
    try {
        const r = await fetch(`/api/squads/${squadId}/members/${userId}`, { method: 'DELETE' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
            window.showToast(body.error || T('common.erroreServer') || 'Non è stato possibile completare l\'operazione.', "error");
            return;
        }
        await (window.refreshState ? window.refreshState() : Promise.resolve());
        if (window.renderSquadsList) window.renderSquadsList();
        if (window.renderOtherSquadsList) window.renderOtherSquadsList();
        if (window.renderNavSquadre) window.renderNavSquadre();
        const spariita = body.sciolta || !(window.CamoscioState.squads || []).some(s => s.id === squadId);
        if (sonoIo && spariita) {
            if (window.navigateTo) window.navigateTo('social');
            window.showToast(T('squadPage.uscito') || 'Hai lasciato la squadra.', "success");
        } else {
            refreshSquadHeaderAndMembers(squadId);
            if (sonoIo) window.showToast(T('squadPage.uscito') || 'Hai lasciato la squadra.', "success");
        }
    } catch (e) {
        console.error("Errore uscita/rimozione dalla squadra:", e);
        window.showToast(T('common.erroreServer') || 'Non è stato possibile completare l\'operazione.', "error");
    }
}

window.showSquadPage = showSquadPage;
window.promoteSquadMember = promoteSquadMember;
window.demoteSquadMember = demoteSquadMember;
window.approveSquadRequest = approveSquadRequest;
window.declineSquadRequest = declineSquadRequest;
window.annullaInvitoSquadra = annullaInvitoSquadra;
window.rimuoviMembroSquadra = rimuoviMembroSquadra;
window.lasciaSquadra = lasciaSquadra;
window.updateLocalSquad = updateLocalSquad;
window.refreshSquadHeaderAndMembers = refreshSquadHeaderAndMembers;

// Cambio lingua: solo intestazione/richieste/membri, MAI la chat (vedi la nota
// su squadIdAperta piu' sopra) - dati gia' in window.CamoscioState, zero fetch,
// zero costo. Non fa nulla se la pagina squadra non e' quella aperta al momento.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    const section = document.getElementById('squad-page');
    if (section && section.classList.contains('active') && squadIdAperta) {
        refreshSquadHeaderAndMembers(squadIdAperta);
    }
});
