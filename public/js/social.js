function initSocialModule() {
    setupSocialEvents();
    setupDiaryForm();
    setupVoiceRecorder();
    renderSocialModule();
    renderHikesList();
}

function setupSocialEvents() {
    // Form inserimento obiettivo di allenamento
    const formGoal = document.getElementById("training-goal-form");
    if (formGoal) {
        formGoal.addEventListener("submit", async (e) => {
            e.preventDefault();
            const goal = document.getElementById("user-training-goal").value;
            await saveTrainingGoal(goal);
        });
    }

    // Bottone apertura modal escursione
    const btnOpenModal = document.getElementById("btn-open-create-hike");
    const btnCloseModal = document.getElementById("btn-close-hike-modal");
    const modal = document.getElementById("create-hike-modal");

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener("click", () => {
            modal.classList.remove("hidden");
            // Imposta la data minima a oggi
            document.getElementById("hike-date").min = new Date().toISOString().split("T")[0];
        });
    }

    if (btnCloseModal && modal) {
        btnCloseModal.addEventListener("click", () => {
            modal.classList.add("hidden");
        });
    }

    // Form creazione escursione
    const formHike = document.getElementById("create-hike-form");
    if (formHike) {
        formHike.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitCreateHike();
        });
    }

    // Form creazione squadra ricorrente
    const btnOpenSquadForm = document.getElementById("btn-open-create-squad");
    const btnCloseSquadForm = document.getElementById("btn-close-squad-form");
    const squadFormBox = document.getElementById("create-squad-form-box");

    if (btnOpenSquadForm && squadFormBox) {
        btnOpenSquadForm.addEventListener("click", () => {
            squadFormBox.classList.remove("hidden");
            populateSquadMembersCheckboxes();
        });
    }

    if (btnCloseSquadForm && squadFormBox) {
        btnCloseSquadForm.addEventListener("click", () => {
            squadFormBox.classList.add("hidden");
        });
    }

    const formSquad = document.getElementById("create-squad-form");
    if (formSquad) {
        formSquad.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitCreateSquad();
        });
    }

    // Form invio recensioni anonime obbligatorie
    const formReview = document.getElementById("peer-review-form");
    if (formReview) {
        formReview.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitAnonymousReview();
        });
    }

    // Filtri dinamici nella pagina escursioni
    const filterDiff = document.getElementById("filter-difficulty");
    const filterTribeContainer = document.getElementById("filter-tribe-checkboxes");
    const filterGoal = document.getElementById("filter-goal");

    if (filterDiff) filterDiff.addEventListener("change", renderHikesList);
    if (filterTribeContainer) filterTribeContainer.addEventListener("change", renderHikesList);
    if (filterGoal) filterGoal.addEventListener("input", renderHikesList);
}

// Renderizza la UI del modulo social
function renderSocialModule() {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    if (!usr) return;

    // Carica l'obiettivo di allenamento dell'utente
    document.getElementById("user-training-goal").value = usr.trainingGoal || "";

    // Calcola e disegna i match sugli obiettivi
    renderGoalMatches(usr);

    // Disegna le squadre ricorrenti
    renderSquadsList();

    // Popola i target delle recensioni (altri utenti escluse se stessi)
    populateReviewTargets();

    // Disegna il Diario di Viaggio
    renderDiaryTimeline();
}

// Disegna l'elenco delle escursioni filtrate
function renderHikesList() {
    const container = document.getElementById("hikes-list-container");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const diffFilter = document.getElementById("filter-difficulty").value;
    const tribeFilters = Array.from(document.querySelectorAll("input[name='filter-tribe-tag']:checked")).map(cb => cb.value);
    const goalFilter = document.getElementById("filter-goal").value.toLowerCase().trim();

    // Filtra la lista. Più tag Tribù selezionati = AND (l'escursione deve averli tutti), non OR
    const filteredHikes = db.hikes.filter(h => {
        if (diffFilter !== "all" && h.difficulty !== diffFilter) return false;
        if (tribeFilters.length > 0 && !tribeFilters.every(tag => h.tribeTags.includes(tag))) return false;
        if (goalFilter && (!h.description.toLowerCase().includes(goalFilter) && !h.title.toLowerCase().includes(goalFilter))) return false;
        return true;
    });

    if (filteredHikes.length === 0) {
        container.innerHTML = `<div class="glass-card text-center py-5 text-muted col-span-2">Nessuna escursione trovata con i filtri inseriti.</div>`;
        return;
    }

    filteredHikes.forEach(hike => {
        const creator = db.users.find(u => u.id === hike.creatorId);
        const creatorName = creator ? creator.username : "Escursionista";
        const isCreatorMe = hike.creatorId === currentUser.id;

        // Calcola tempi (standard CAI vs Personalizzati)
        const times = window.calculateHikeTimes(hike, currentUser);
        
        // Verifica idoneità fisica
        const eligibility = window.getEligibilityBadge(hike, currentUser);

        // Preferito sentiero
        const isBookmarked = db.bookmarks.some(b => b.userId === currentUser.id && b.hikeId === hike.id);

        // Trova compagno per questo percorso specifico: mostrato solo se anche io l'ho salvato,
        // per scoprire chi altro ha lo stesso interesse su QUESTO sentiero (non un match generico)
        let trailMatchHtml = "";
        if (isBookmarked) {
            const otherBookmarkers = db.bookmarks
                .filter(b => b.hikeId === hike.id && b.userId !== currentUser.id)
                .map(b => db.users.find(u => u.id === b.userId))
                .filter(Boolean);
            if (otherBookmarkers.length > 0) {
                const names = otherBookmarkers.map(u => `<b>${u.username.split(" ")[0]}</b>`).join(" e ");
                trailMatchHtml = `<div class="trail-match-line small"><i data-lucide="star"></i> Anche ${names} ${otherBookmarkers.length === 1 ? "ha" : "hanno"} messo questo sentiero nei preferiti.</div>`;
            }
        }

        const card = document.createElement("div");
        card.className = "glass-card hike-card";

        // Costruzione partecipanti
        const participantsHtml = hike.participants.map(pId => {
            const pUser = db.users.find(u => u.id === pId);
            if (!pUser) return "";
            const isLocalExpert = pUser.localExpert && pUser.localExpert.active;
            const expertTitlePart = isLocalExpert ? ` — Esperto locale: ${pUser.localExpert.area}` : "";
            return `
                <div class="p-avatar ${pUser.kycVerified ? 'verified' : ''} ${isLocalExpert ? 'local-expert' : ''}" title="${pUser.username} (Rep: ${pUser.reputation}%)${expertTitlePart}">
                    ${pUser.avatar}
                </div>
            `;
        }).join("");

        // Bottone Iscrizione / Stato partecipazione
        let actionBtnHtml = "";
        const isParticipant = hike.participants.includes(currentUser.id);
        const isPending = hike.pendingApproval.includes(currentUser.id);

        if (isCreatorMe) {
            actionBtnHtml = `<span class="badge badge-accent">Organizzatore</span>`;
        } else if (isParticipant) {
            actionBtnHtml = `<span class="badge badge-green">Partecipi ✓</span>`;
        } else if (isPending) {
            actionBtnHtml = `<span class="badge badge-primary">In attesa approvazione...</span>`;
        } else {
            actionBtnHtml = `<button class="btn btn-sm btn-primary" onclick="joinHikeRequest('${hike.id}', ${eligibility.eligible})">Iscriviti</button>`;
        }

        // Segna come completata: solo per un partecipante, dopo la data dell'escursione, una volta sola
        let completionBtnHtml = "";
        const hasCompletedThisHike = db.completions.some(c => c.userId === currentUser.id && c.hikeId === hike.id);
        if (isParticipant && new Date(hike.date) < new Date()) {
            completionBtnHtml = hasCompletedThisHike
                ? `<span class="badge badge-green">Escursione Completata ✓</span>`
                : `<button class="btn btn-sm btn-success" onclick="markHikeCompleted('${hike.id}')">Segna come completata</button>`;
        }

        // Pannello Veto del Capogruppo (solo per l'organizzatore)
        let vetoSectionHtml = "";
        if (isCreatorMe && hike.pendingApproval && hike.pendingApproval.length > 0) {
            const pendingItemsHtml = hike.pendingApproval.map(pendingId => {
                const pendingUser = db.users.find(u => u.id === pendingId);
                if (!pendingUser) return "";
                
                return `
                    <div class="veto-request-item">
                        <span>${pendingUser.avatar} <b>${pendingUser.username}</b> (Rep: ${pendingUser.reputation}%, ${pendingUser.experienceLevel})</span>
                        <div class="veto-actions">
                            <button class="btn btn-sm btn-success" style="padding:2px 6px;" onclick="approveParticipant('${hike.id}', '${pendingId}')">Accetta</button>
                            <button class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="declineParticipant('${hike.id}', '${pendingId}')">Rifiuta</button>
                        </div>
                    </div>
                `;
            }).join("");

            vetoSectionHtml = `
                <div class="veto-management-box">
                    <span class="small font-bold text-warning" style="display:block; margin-bottom:6px;"><i data-lucide="shield-alert"></i> Richieste Pendenti (Veto):</span>
                    ${pendingItemsHtml}
                </div>
            `;
        }

        card.innerHTML = `
            <span class="badge badge-primary hike-difficulty-badge">${hike.difficulty}</span>
            <h4 style="color:#FFF; margin-bottom: 4px;">${hike.title}</h4>
            <p class="small text-muted" style="margin-bottom: 8px;">Organizzato da: <b>${creatorName}</b> ${creator && creator.kycVerified ? '🔹' : ''}</p>
            
            <p class="small text-secondary" style="line-height:1.4; height: 60px; overflow:hidden; text-overflow:ellipsis;">${hike.description}</p>
            
            <div class="hike-meta-row">
                <div class="hike-meta-item">
                    <span>Dislivello D+</span>
                    <strong>${hike.elevationGain}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>Quota Max</span>
                    <strong>${hike.maxAltitude}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>Distanza</span>
                    <strong>${hike.distanceKm} km</strong>
                </div>
            </div>

            <div style="background: rgba(0,0,0,0.15); padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 0.8rem;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span>Tempo CAI Standard:</span>
                    <strong>${times.standardText}</strong>
                </div>
                <div style="display:flex; justify-content:space-between; color:var(--accent-blue)">
                    <span>Il tuo Tempo Personalizzato:</span>
                    <strong>${times.customText}</strong>
                </div>
            </div>

            <div class="tag-list">
                ${hike.tribeTags.map(t => `<span class="tag">${t}</span>`).join("")}
                <span class="badge ${eligibility.class}">${eligibility.text}</span>
            </div>

            <div class="participants-section">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="small text-muted">Partecipanti (${hike.participants.length}):</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="loadHikeOnMapDirectly('${hike.id}')" title="Vedi sentiero sulla mappa">Mappa</button>
                        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="toggleBookmark('${hike.id}')" title="${isBookmarked ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">
                            ${isBookmarked ? '★' : '☆'}
                        </button>
                    </div>
                </div>
                <div class="participants-avatars">${participantsHtml}</div>
            </div>

            ${trailMatchHtml}
            ${vetoSectionHtml}

            <div style="display:flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 12px;">
                ${completionBtnHtml}
                ${actionBtnHtml}
            </div>
        `;
        container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
}

// Richiesta iscrizione con avviso se inesperto
window.joinHikeRequest = async function(hikeId, isEligible) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    if (!isEligible) {
        const confirmJoin = await window.showConfirmModal("⚠️ ATTENZIONE: Questa escursione richiede un passo superiore al tuo attuale storico rilevato.\n\nVuoi comunque inviare una richiesta al capogruppo e discuterne in chat?");
        if (!confirmJoin) return;
    }

    // Se l'approvazione è automatica va direttamente in partecipanti, altrimenti va in pending (Veto)
    if (hike.manualApproval) {
        if (!hike.pendingApproval.includes(db.currentUser.id)) {
            hike.pendingApproval.push(db.currentUser.id);
        }
    } else {
        if (!hike.participants.includes(db.currentUser.id)) {
            hike.participants.push(db.currentUser.id);
        }
    }

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participants: hike.participants,
                pendingApproval: hike.pendingApproval
            })
        });

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nell'iscrizione:", e);
    }
};

// Notifica l'esito (accettato/rifiutato) di una richiesta di iscrizione
async function notifyParticipantDecision(userId, text) {
    try {
        await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, text })
        });
    } catch (e) {
        console.error("Errore nell'invio della notifica:", e);
    }
}

// Accetta partecipante (Veto Capogruppo)
window.approveParticipant = async function(hikeId, userId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    hike.pendingApproval = hike.pendingApproval.filter(id => id !== userId);
    if (!hike.participants.includes(userId)) {
        hike.participants.push(userId);
    }

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participants: hike.participants,
                pendingApproval: hike.pendingApproval
            })
        });

        await notifyParticipantDecision(userId, `La tua richiesta per "${hike.title}" è stata accettata! Sei ufficialmente tra i partecipanti.`);

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nell'approvazione:", e);
    }
};

// Rifiuta partecipante (Veto Capogruppo)
window.declineParticipant = async function(hikeId, userId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    hike.pendingApproval = hike.pendingApproval.filter(id => id !== userId);

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pendingApproval: hike.pendingApproval
            })
        });

        await notifyParticipantDecision(userId, `La tua richiesta per "${hike.title}" non è stata accettata dal capogruppo questa volta.`);

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nel rifiutare il partecipante:", e);
    }
};

// Carica escursione ed apre la mappa
window.loadHikeOnMapDirectly = function(hikeId) {
    const btnMapNav = document.getElementById("btn-nav-map");
    if (btnMapNav) {
        btnMapNav.click(); // Naviga
        setTimeout(() => {
            window.loadActiveHikeOnMap(hikeId);
        }, 300);
    }
};

// Aggiunge o rimuove sentiero dai preferiti (Rileva chi ha interesse comune)
window.toggleBookmark = async function(hikeId) {
    const db = window.CamoscioState;
    const userId = db.currentUser.id;

    try {
        await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, hikeId })
        });
        
        await refreshState();
        renderHikesList();
        renderSocialModule(); // Aggiorna match sentieri
    } catch(e) {
        console.error("Errore nel salvare il preferito:", e);
    }
};

// --- CREAZIONE ESCURSIONE ---

async function submitCreateHike() {
    const db = window.CamoscioState;
    const title = document.getElementById("hike-title").value;
    const description = document.getElementById("hike-desc").value;
    const difficulty = document.getElementById("hike-diff").value;
    const date = document.getElementById("hike-date").value;
    const maxAltitude = parseInt(document.getElementById("hike-alt").value);
    const elevationGain = parseInt(document.getElementById("hike-elev").value);
    const distanceKm = parseFloat(document.getElementById("hike-dist").value);
    const lat = parseFloat(document.getElementById("hike-trailhead-lat").value);
    const lng = parseFloat(document.getElementById("hike-trailhead-lng").value);
    const name = document.getElementById("hike-trailhead-name").value;
    const manualApproval = document.getElementById("hike-approval").value === "true";

    // Vincolo hard: il ritrovo deve trovarsi nell'ambito geografico corrente (Lazio/Molise/Abruzzo/Marche)
    const bounds = window.CAMOSCIO_REGION_BOUNDS;
    if (bounds && (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng)) {
        window.showToast("Il punto di ritrovo inserito è fuori dall'ambito geografico attuale della demo (Lazio, Molise, Abruzzo, Marche). Inserisci coordinate all'interno di queste regioni.", "error");
        return;
    }

    // Raccoglie i tag selezionati
    const tags = [];
    document.querySelectorAll("input[name='hike-tags']:checked").forEach(cb => {
        tags.push(cb.value);
    });

    const payload = {
        title,
        description,
        difficulty,
        date,
        maxAltitude,
        elevationGain,
        distanceKm,
        trailhead: { lat, lng, name },
        tribeTags: tags,
        manualApproval,
        creatorId: db.currentUser.id
    };

    try {
        const response = await fetch('/api/hikes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            document.getElementById("create-hike-modal").classList.add("hidden");
            document.getElementById("create-hike-form").reset();
            
            await refreshState();
            renderHikesList();
            if (window.populateHikeSelects) window.populateHikeSelects();
        }
    } catch(e) {
        console.error("Errore creazione escursione:", e);
    }
}

// --- OBIETTIVI COMUNI ---

async function saveTrainingGoal(goal) {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    usr.trainingGoal = goal;

    try {
        await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainingGoal: goal })
        });

        await refreshState();
        renderSocialModule();
    } catch (e) {
        console.error("Errore salvataggio obiettivo:", e);
    }
}

function renderGoalMatches(currentUser) {
    const container = document.getElementById("goal-matches-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (!currentUser.trainingGoal) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Inserisci un obiettivo per trovare compagni di allenamento.</div>`;
        return;
    }

    const matches = db.users.filter(u => 
        u.id !== currentUser.id && 
        u.trainingGoal && 
        u.trainingGoal.toLowerCase().trim() === currentUser.trainingGoal.toLowerCase().trim()
    );

    if (matches.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessun escursionista ha lo stesso obiettivo al momento.</div>`;
        return;
    }

    matches.forEach(m => {
        const item = document.createElement("div");
        item.className = "goal-match-item";
        item.innerHTML = `
            <span>${m.avatar} <b>${m.username}</b> si allena per: <strong style="color:var(--accent-orange)">${m.trainingGoal}</strong></span>
            <button class="btn btn-sm btn-secondary" onclick="inviteToSquadDirectly('${m.id}')">Invita in Squadra</button>
        `;
        container.appendChild(item);
    });
}

window.inviteToSquadDirectly = function(peerId) {
    const btnOpenSquad = document.getElementById("btn-open-create-squad");
    if (btnOpenSquad) {
        btnOpenSquad.click();
        // Spunta l'utente nel checkbox della creazione
        setTimeout(() => {
            const cb = document.querySelector(`input[name='squad-member'][value='${peerId}']`);
            if (cb) cb.checked = true;
        }, 100);
    }
};

// --- SQUADRE RICORRENTI ---

function renderSquadsList() {
    const container = document.getElementById("squads-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const mySquads = db.squads.filter(s => s.creatorId === currentUser.id || s.members.includes(currentUser.id));

    if (mySquads.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessuna squadra fissa creata.</div>`;
        return;
    }

    mySquads.forEach(squad => {
        const item = document.createElement("div");
        item.className = "squad-item";

        const membersAvatars = squad.members.map(mId => {
            const mem = db.users.find(u => u.id === mId);
            return mem ? mem.avatar : "👤";
        }).join(" ");

        // Se sono l'organizzatore, posso fare "Invita a Gita" (automaticamente riempie partecipanti escursione)
        let actionBtn = "";
        if (squad.creatorId === currentUser.id) {
            actionBtn = `<button class="btn btn-sm btn-success" onclick="inviteSquadToHike('${squad.id}')">Invita a Gita</button>`;
        } else {
            actionBtn = `<span class="badge badge-primary">Membro</span>`;
        }

        item.innerHTML = `
            <div>
                <h5>👥 ${squad.name}</h5>
                <div class="squad-members-row">${membersAvatars}</div>
            </div>
            <div>
                ${actionBtn}
            </div>
        `;
        container.appendChild(item);
    });
}

// Popola le spunte per includere membri nella squadra
function populateSquadMembersCheckboxes() {
    const container = document.getElementById("squad-members-checkboxes");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    db.users.forEach(u => {
        if (u.id === currentUser.id) return;

        const label = document.createElement("label");
        label.innerHTML = `
            <input type="checkbox" name="squad-member" value="${u.id}">
            <span>${u.avatar} ${u.username}</span>
        `;
        container.appendChild(label);
    });
}

// Crea la squadra sul server
async function submitCreateSquad() {
    const db = window.CamoscioState;
    const name = document.getElementById("squad-name").value;
    const memberIds = [db.currentUser.id];

    document.querySelectorAll("input[name='squad-member']:checked").forEach(cb => {
        memberIds.push(cb.value);
    });

    try {
        const response = await fetch('/api/squads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, creatorId: db.currentUser.id, members: memberIds })
        });

        if (response.ok) {
            document.getElementById("create-squad-form-box").classList.add("hidden");
            document.getElementById("create-squad-form").reset();
            
            await refreshState();
            renderSquadsList();
        }
    } catch(e) {
        console.error("Errore creazione squadra:", e);
    }
}

// Invita tutta la squadra all'escursione attiva (Lago Gemelli)
window.inviteSquadToHike = async function(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    const hike = db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]; // Escursione attiva, o la prima disponibile

    if (!squad || !hike) return;

    // Aggiungi tutti i membri della squadra all'escursione
    squad.members.forEach(mId => {
        if (!hike.participants.includes(mId)) {
            hike.participants.push(mId);
        }
    });

    try {
        await fetch(`/api/hikes/${hike.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participants: hike.participants })
        });

        window.showToast(`Squadra "${squad.name}" invitata correttamente alla gita "${hike.title}"!`, "success");
        
        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore invito squadra:", e);
    }
};

// --- RECENSIONI ANONIME OBBLIGATORIE ---

// Popola gli utenti recensibili: solo co-partecipanti di escursioni condivise e già concluse
// (non più "chiunque nel sistema") - le opzioni sono coppie escursione+utente perché la stessa
// persona può essere stata compagna di più uscite passate.
function populateReviewTargets() {
    const select = document.getElementById("review-target");
    if (!select) return;

    const db = window.CamoscioState;
    select.innerHTML = "";

    const pastSharedHikes = db.hikes.filter(h =>
        new Date(h.date) < new Date() && h.participants.includes(db.currentUser.id)
    );

    const options = [];
    pastSharedHikes.forEach(hike => {
        hike.participants.forEach(pId => {
            if (pId === db.currentUser.id) return;
            const user = db.users.find(u => u.id === pId);
            if (!user) return;
            options.push({ hikeId: hike.id, hikeTitle: hike.title, user });
        });
    });

    if (options.length === 0) {
        select.innerHTML = `<option value="" disabled selected>Nessuna escursione passata condivisa da recensire</option>`;
        return;
    }

    options.forEach(opt => {
        const el = document.createElement("option");
        el.value = `${opt.hikeId}::${opt.user.id}`;
        el.textContent = `${opt.user.avatar} ${opt.user.username} (${opt.hikeTitle})`;
        select.appendChild(el);
    });
}

// Invia recensione anonima al server
async function submitAnonymousReview() {
    const selection = document.getElementById("review-target").value;
    if (!selection) return;
    const [hikeId, targetUserId] = selection.split("::");

    const punctuality = document.getElementById("rate-punctuality").value;
    const equipment = document.getElementById("rate-equipment").value;
    const respect = document.getElementById("rate-respect").value;
    const comment = document.getElementById("review-comment").value;
    const db = window.CamoscioState;

    try {
        const response = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // reviewerId e hikeId servono SOLO lato server per l'hash anti-duplicati:
            // non vengono mai salvati né restituiti nel record di recensione visibile.
            body: JSON.stringify({ targetUserId, punctuality, equipment, respect, comment, reviewerId: db.currentUser.id, hikeId })
        });

        if (response.ok) {
            window.showToast("Feedback inviato con successo! La recensione rimarrà al 100% anonima nel sistema.", "success");
            document.getElementById("peer-review-form").reset();

            await refreshState();
            renderSocialModule();
        } else {
            const err = await response.json();
            window.showToast(err.error || "Non è stato possibile inviare la recensione.", "error");
        }
    } catch(e) {
        console.error("Errore invio recensione:", e);
    }
}

// --- DIARIO DI VIAGGIO COLLABORATIVO ---

// Timeline a scorrimento orizzontale ("Reel" interattivo), raggruppata per escursione
function renderDiaryTimeline() {
    const container = document.getElementById("diary-timeline-container");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (db.diaries.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-4">Nessun diario di viaggio registrato. Aggiungi il primo!</div>`;
        return;
    }

    // Raggruppa le note per escursione, più recenti prima all'interno di ciascun gruppo
    const groups = {};
    [...db.diaries]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach(entry => {
            const key = entry.hikeId || "generic";
            if (!groups[key]) groups[key] = [];
            groups[key].push(entry);
        });

    Object.keys(groups).forEach(hikeId => {
        const hike = db.hikes.find(h => h.id === hikeId);
        const groupBox = document.createElement("div");
        groupBox.className = "diary-timeline-hike-group";

        const filmstrip = document.createElement("div");
        filmstrip.className = "diary-timeline-filmstrip";

        groups[hikeId].forEach(entry => {
            const user = db.users.find(u => u.id === entry.userId);
            const name = user ? user.username.split(" ")[0] : "Escursionista";
            const avatar = user ? user.avatar : "👤";

            const item = document.createElement("div");
            item.className = "timeline-item";

            item.innerHTML = `
                <div class="timeline-header">
                    <span>${avatar} <b>${name}</b></span>
                    <span>${new Date(entry.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div class="timeline-body">
                    <p>${entry.textNote}</p>
                    ${entry.mediaUrl ? `<img src="${entry.mediaUrl}" alt="Media Diario">` : ''}
                    ${entry.audioNoteUrl ? `<audio controls src="${entry.audioNoteUrl}"></audio>` : ''}
                </div>
            `;
            filmstrip.appendChild(item);
        });

        groupBox.innerHTML = `<h6>${hike ? hike.title : "Altre note"}</h6>`;
        groupBox.appendChild(filmstrip);
        container.appendChild(groupBox);
    });
}

// Stato della registrazione vocale corrente (URL già caricato sul server, pronto per essere allegato alla nota)
let pendingVoiceNoteUrl = null;
let activeMediaRecorder = null;

// Configura il pulsante di registrazione nota vocale (MediaRecorder, standard web aperto)
function setupVoiceRecorder() {
    const btn = document.getElementById("btn-record-voice-note");
    const status = document.getElementById("voice-note-status");
    if (!btn) return;

    if (!navigator.mediaDevices || !window.MediaRecorder) {
        btn.disabled = true;
        if (status) status.textContent = "Registrazione audio non supportata da questo browser.";
        return;
    }

    btn.addEventListener("click", async () => {
        if (activeMediaRecorder && activeMediaRecorder.state === "recording") {
            activeMediaRecorder.stop();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            activeMediaRecorder = new MediaRecorder(stream);

            activeMediaRecorder.ondataavailable = (e) => chunks.push(e.data);

            activeMediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                btn.classList.remove("recording");
                btn.innerHTML = `<i data-lucide="mic"></i> Registra nota vocale`;
                if (window.lucide) window.lucide.createIcons();
                if (status) status.textContent = "Caricamento nota vocale...";

                const blob = new Blob(chunks, { type: activeMediaRecorder.mimeType || "audio/webm" });
                const base64 = await blobToBase64(blob);

                try {
                    const response = await fetch('/api/uploads/audio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audioBase64: base64, mimeType: blob.type })
                    });
                    const result = await response.json();
                    if (response.ok) {
                        pendingVoiceNoteUrl = result.url;
                        if (status) status.textContent = "✓ Nota vocale pronta, verrà allegata al salvataggio.";
                    } else {
                        if (status) status.textContent = result.error || "Errore nel caricamento della nota vocale.";
                    }
                } catch (e) {
                    console.error("Errore nel caricamento della nota vocale:", e);
                    if (status) status.textContent = "Errore nel caricamento della nota vocale.";
                }
            };

            activeMediaRecorder.start();
            btn.classList.add("recording");
            btn.innerHTML = `<i data-lucide="square"></i> Ferma registrazione`;
            if (window.lucide) window.lucide.createIcons();
            if (status) status.textContent = "Registrazione in corso...";
        } catch (e) {
            console.error("Errore nell'accesso al microfono:", e);
            if (status) status.textContent = "Permesso microfono negato o non disponibile.";
        }
    });
}

// Converte un Blob audio in stringa base64 (senza il prefisso data:...;base64,)
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Aggiunge una nota al diario collaborativo
function setupDiaryForm() {
    const addDiaryForm = document.getElementById("add-diary-form");
    if (!addDiaryForm) return;

    addDiaryForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const db = window.CamoscioState;
        const hikeId = document.getElementById("diary-hike-select").value;
        const textNote = document.getElementById("diary-text").value;
        const mediaUrl = document.getElementById("diary-img").value;
        const lat = parseFloat(document.getElementById("diary-lat").value);
        const lng = parseFloat(document.getElementById("diary-lng").value);

        const payload = {
            hikeId,
            userId: db.currentUser.id,
            textNote,
            mediaUrl,
            audioNoteUrl: pendingVoiceNoteUrl,
            lat,
            lng
        };

        try {
            const response = await fetch('/api/diaries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                document.getElementById("diary-text").value = "";
                pendingVoiceNoteUrl = null;
                const status = document.getElementById("voice-note-status");
                if (status) status.textContent = "";

                await refreshState();
                renderDiaryTimeline();
            }
        } catch(e) {
            console.error("Errore inserimento diario:", e);
        }
    });
}

window.initSocialModule = initSocialModule;
window.renderSocialModule = renderSocialModule;
window.renderHikesList = renderHikesList;
