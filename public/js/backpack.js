// Inizializzatore del modulo zaino
function initBackpackModule() {
    setupBackpackEvents();
    renderBackpackModule();
}

function setupBackpackEvents() {
    const btnGenerate = document.getElementById("btn-generate-backpack");
    if (btnGenerate) {
        btnGenerate.addEventListener("click", () => {
            generateChecklistFromInputs();
        });
    }
}

// Renderizza il modulo zaino in base all'escursione attiva o a input dell'utente
function renderBackpackModule() {
    const db = window.CamoscioState;

    // Usa l'escursione scelta dall'utente (es. dal pulsante "Mappa" di una card); in mancanza, la prima disponibile
    const activeHike = db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0];
    if (!activeHike) return;

    // Popola i pesi condivisi per i partecipanti dell'escursione
    renderWeightDistribution(activeHike);

    // Genera la lista zaino di default per l'altitudine e meteo dell'escursione
    generateChecklistFromHike(activeHike);
}

// Genera checklist basata direttamente sui dettagli dell'escursione selezionata
function generateChecklistFromHike(hike) {
    const isHighAltitude = hike.maxAltitude >= 2500;
    
    // Simula previsione pioggia leggendo i dati meteo correnti (di default assume pioggia se impostato)
    const rainExpected = true; 
    
    const season = "estate"; // Assumi estate per l'escursione di default (Gran Sasso)
    const duration = "giornata";

    applyBackpackRules(season, hike.maxAltitude, duration, rainExpected, hike.backpackTemplate, hike.id);
}

// Genera checklist in base alle scelte manuali del form
function generateChecklistFromInputs() {
    const season = document.getElementById("backpack-season").value;
    const altitude = parseInt(document.getElementById("backpack-altitude").value);
    const duration = document.getElementById("backpack-duration").value;
    const rainExpected = document.getElementById("backpack-rain-expected").checked;

    applyBackpackRules(season, altitude, duration, rainExpected, [], 'generic');
}

// Core Algoritmo: Applica i vincoli ambientali e meteo per generare gli articoli dello zaino
function applyBackpackRules(season, altitude, duration, rainExpected, customTemplate, hikeId) {
    const db = window.CamoscioState;
    const isHighAltitude = altitude >= 2500;

    // 1. Inizializziamo una lista base di articoli indispensabili
    let items = [
        { name: "Scarponi da trekking", category: "Abbigliamento", mandatory: true, weight: 1200 },
        { name: "Acqua (almeno 1.5 Litri)", category: "Alimentazione", mandatory: true, weight: 1500 },
        { name: "Snack energetici / Pranzo", category: "Alimentazione", mandatory: true, weight: 600 },
        { name: "Fischietto di emergenza", category: "Sicurezza / Emergenza", mandatory: true, weight: 50 },
        { name: "Coperta termica alluminata", category: "Sicurezza / Emergenza", mandatory: true, weight: 100 },
        { name: "Borraccia vuota extra", category: "Alimentazione", mandatory: false, weight: 150 }
    ];

    // 2. Aggiunge articoli specifici in base alle regole hard dell'altitudine e meteo
    const rulesAlert = document.getElementById("backpack-rules-alert");
    const rulesBadge = document.getElementById("backpack-badge-rules");
    
    let alertMsg = [];
    
    if (isHighAltitude) {
        rulesBadge.textContent = "Quota > 2500m";
        rulesBadge.className = "badge badge-red";
        
        items.push({ name: "Ramponcini di sicurezza", category: "Attrezzatura", mandatory: true, weight: 400 });
        items.push({ name: "Guscio antivento termico (Goretex)", category: "Abbigliamento", mandatory: true, weight: 500 });
        items.push({ name: "Guanti e berretto caldi", category: "Abbigliamento", mandatory: true, weight: 200 });
        
        alertMsg.push("Quota sopra i 2500m: <strong>Guscio Termico</strong> e <strong>Ramponcini</strong> sono stati forzati nello zaino!");
    } else {
        rulesBadge.textContent = "Quota Standard";
        rulesBadge.className = "badge badge-green";
        
        items.push({ name: "K-Way o giacca leggera", category: "Abbigliamento", mandatory: false, weight: 250 });
    }

    if (rainExpected) {
        items.push({ name: "Mantella impermeabile / Poncho", category: "Abbigliamento", mandatory: true, weight: 350 });
        items.push({ name: "Coprizaino impermeabile", category: "Attrezzatura", mandatory: true, weight: 100 });
        items.push({ name: "Sacchetti stagni per indumenti", category: "Attrezzatura", mandatory: false, weight: 50 });
        
        alertMsg.push("Previsione Pioggia: <strong>Mantella Impermeabile</strong> obbligatoria!");
    }

    // Regole stagionali
    if (season === "inverno") {
        items.push({ name: "Cramponi classici da ghiaccio", category: "Attrezzatura", mandatory: true, weight: 950 });
        items.push({ name: "Ghette da neve", category: "Abbigliamento", mandatory: true, weight: 300 });
        items.push({ name: "Thermos per bevande calde", category: "Alimentazione", mandatory: true, weight: 700 });
        items.push({ name: "Piumino leggero extra", category: "Abbigliamento", mandatory: true, weight: 450 });
    } else if (season === "estate") {
        items.push({ name: "Crema solare protettiva", category: "Sicurezza / Emergenza", mandatory: true, weight: 100 });
        items.push({ name: "Cappellino da sole", category: "Abbigliamento", mandatory: true, weight: 80 });
        items.push({ name: "Sali minerali di scorta", category: "Alimentazione", mandatory: false, weight: 50 });
    }

    // Regole di durata escursione
    if (duration === "plurigiorno") {
        items.push({ name: "Sacco a pelo confort 0°C", category: "Attrezzatura", mandatory: true, weight: 1100 });
        items.push({ name: "Materassino isolante", category: "Attrezzatura", mandatory: true, weight: 450 });
        items.push({ name: "Torcia frontale + batterie", category: "Sicurezza / Emergenza", mandatory: true, weight: 150 });
        items.push({ name: "Powerbank per cellulare", category: "Sicurezza / Emergenza", mandatory: true, weight: 250 });
        items.push({ name: "Articoli per igiene personale", category: "Igiene", mandatory: false, weight: 300 });
    }

    // Aggiungi articoli condivisi assegnati a me o generici presenti nel template dell'escursione
    if (customTemplate && customTemplate.length > 0) {
        customTemplate.forEach(tItem => {
            // Controlliamo se è assegnato all'utente corrente
            const currentUserId = db.currentUser ? db.currentUser.id : "";
            const isAssignedToMe = tItem.assignedTo === currentUserId;
            
            items.push({
                name: tItem.name,
                category: tItem.category,
                mandatory: tItem.mandatory,
                weight: tItem.weight,
                assignedTo: tItem.assignedTo,
                isShared: true
            });
        });
    }

    // Mostra avvisi regole a schermo
    if (rulesAlert) {
        if (alertMsg.length > 0) {
            rulesAlert.classList.remove("hidden");
            rulesAlert.innerHTML = `<i data-lucide="alert-triangle"></i> <span>${alertMsg.join(" | ")}</span>`;
        } else {
            rulesAlert.classList.add("hidden");
        }
    }

    renderChecklistUI(items, hikeId);
    if (window.lucide) window.lucide.createIcons();
}

// Disegna la lista zaino suddivisa per categorie
function renderChecklistUI(items, hikeId) {
    const container = document.getElementById("backpack-categories-container");
    if (!container) return;

    container.innerHTML = "";

    // Raggruppa per categoria
    const categories = {};
    items.forEach(item => {
        if (!categories[item.category]) {
            categories[item.category] = [];
        }
        categories[item.category].push(item);
    });

    for (const catName in categories) {
        const catBox = document.createElement("div");
        catBox.className = "backpack-category";
        
        catBox.innerHTML = `
            <h5>${catName}</h5>
            <div class="backpack-list-items" id="cat-items-${catName.replace(/\s+/g, '')}">
                <!-- Articoli caricati qui -->
            </div>
        `;
        container.appendChild(catBox);

        const itemsContainer = document.getElementById(`cat-items-${catName.replace(/\s+/g, '')}`);
        
        categories[catName].forEach((item, index) => {
            const itemRow = document.createElement("div");
            itemRow.className = "backpack-item-row";

            // Stato spuntato salvato in local storage, isolato per escursione e per utente
            const db = window.CamoscioState;
            const userId = db.currentUser ? db.currentUser.id : 'anon';
            const storageKey = `backpack_item_${hikeId || 'generic'}_${userId}_${item.name.replace(/\s+/g, '_')}`;
            const isChecked = localStorage.getItem(storageKey) === 'true';

            // Stringa per oggetti condivisi
            let assignmentLabel = "";
            if (item.isShared) {
                const db = window.CamoscioState;
                if (item.assignedTo) {
                    const assignee = db.users.find(u => u.id === item.assignedTo);
                    const name = assignee ? assignee.username.split(" ")[0] : "Qualcuno";
                    assignmentLabel = `<span class="item-assigned">Porta: ${name}</span>`;
                } else {
                    assignmentLabel = `<span class="item-assigned" style="color:var(--accent-orange)">Da Assegnare</span>`;
                }
            }

            itemRow.innerHTML = `
                <div class="backpack-item-left ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" id="check-${catName.replace(/\s+/g, '')}-${index}" ${isChecked ? 'checked' : ''}>
                    <span>${item.name}</span>
                </div>
                <div class="backpack-item-right">
                    ${item.mandatory ? '<span class="item-mandatory-tag">OBBLIGATORIO</span>' : ''}
                    ${assignmentLabel}
                    <span class="text-muted small">${item.weight}g</span>
                </div>
            `;

            // Aggiungi click listener sul checkbox
            const checkbox = itemRow.querySelector("input[type='checkbox']");
            checkbox.addEventListener("change", (e) => {
                const checked = e.target.checked;
                localStorage.setItem(storageKey, checked ? 'true' : 'false');
                
                const leftDiv = itemRow.querySelector(".backpack-item-left");
                if (checked) {
                    leftDiv.classList.add("checked");
                } else {
                    leftDiv.classList.remove("checked");
                }
            });

            itemsContainer.appendChild(itemRow);
        });
    }
}

// Renderizza il widget di suddivisione pesi tra gli amici della gita
function renderWeightDistribution(hike) {
    const container = document.getElementById("backpack-weight-distribution");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    // Calcola il peso assegnato a ciascun partecipante dell'escursione in base alla lista zaino comune
    const weights = {};
    
    // Inizializza a zero per tutti i partecipanti
    hike.participants.forEach(pId => {
        weights[pId] = 0;
    });

    // Somma i pesi degli oggetti condivisi nel template dell'escursione
    hike.backpackTemplate.forEach(item => {
        if (item.assignedTo && weights[item.assignedTo] !== undefined) {
            weights[item.assignedTo] += item.weight;
        }
    });

    // Mostra per ogni partecipante il peso totale
    hike.participants.forEach(pId => {
        const user = db.users.find(u => u.id === pId);
        if (!user) return;

        const itemRow = document.createElement("div");
        itemRow.className = "weight-dist-item";

        const weightKg = (weights[pId] / 1000).toFixed(2);

        itemRow.innerHTML = `
            <span>${user.avatar} ${user.username}</span>
            <div style="display:flex; align-items:center; gap: 10px;">
                <!-- Assegnatore rapido oggetti condivisi -->
                <select onchange="reassignSharedGear('${hike.id}', '${pId}', this.value)" class="user-select-dropdown" style="padding: 2px 4px; font-size: 0.75rem;">
                    <option value="">Assegna oggetto...</option>
                    ${hike.backpackTemplate.filter(item => !item.assignedTo || item.assignedTo !== pId).map(item => `
                        <option value="${item.name}">${item.name} (${item.weight}g)</option>
                    `).join('')}
                </select>
                <strong>${weightKg} kg</strong>
            </div>
        `;
        container.appendChild(itemRow);
    });
}

// Riassegna un equipaggiamento condiviso ad un altro partecipante
window.reassignSharedGear = async function(hikeId, newAssigneeId, itemName) {
    if (!itemName) return;
    const db = window.CamoscioState;
    const hikeIndex = db.hikes.findIndex(h => h.id === hikeId);
    if (hikeIndex === -1) return;

    const hike = db.hikes[hikeIndex];
    const gearIndex = hike.backpackTemplate.findIndex(item => item.name === itemName);
    if (gearIndex !== -1) {
        hike.backpackTemplate[gearIndex].assignedTo = newAssigneeId;

        // Invia aggiornamento al database locale del server Express
        try {
            await fetch(`/api/hikes/${hikeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backpackTemplate: hike.backpackTemplate })
            });

            // Rinfresca la UI
            await refreshState();
            renderWeightDistribution(hike);
            generateChecklistFromHike(hike);
        } catch(e) {
            console.error("Errore nel salvare la ripartizione dei pesi:", e);
        }
    }
};

window.initBackpackModule = initBackpackModule;
window.renderBackpackModule = renderBackpackModule;
