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

// Punto 23 di cose_da_fare.txt (prima meta') - lo zaino deve partire da una escursione MIA.
//
// Prima qui c'era "db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]": in mancanza
// di una scelta esplicita prendeva LA PRIMA ESCURSIONE DEL DATABASE, di chiunque essa fosse,
// e ne mostrava perfino la lista degli oggetti condivisi e la ripartizione dei pesi fra
// persone mai viste. Ora si guarda solo fra le proprie, e se non ce ne sono si mostra lo
// zaino personale invece di quello di uno sconosciuto.
function escursioneDiRiferimento() {
    const db = window.CamoscioState;
    if (!db.currentUser) return null;

    // Stessi criteri della pagina "Le mie escursioni" (punto 10): organizzate da me + quelle
    // a cui partecipo. Riusare quella funzione, invece di riscrivere i confronti, evita che
    // un domani "mia escursione" voglia dire due cose diverse in due punti del sito.
    const mie = window.classificaMieEscursioni
        ? (() => { const c = window.classificaMieEscursioni(); return c.create.concat(c.partecipo); })()
        : [];

    // Se l'utente ha scelto un'escursione (es. dal pulsante "Mappa" di una scheda) vale solo
    // se e' davvero sua: altrimenti si tornerebbe a mostrare lo zaino di un altro.
    const scelta = mie.find(h => h.id === db.activeHikeId);
    if (scelta) return scelta;

    // Altrimenti la PROSSIMA in programma: e' quella per cui uno sta preparando lo zaino.
    // Le date sono stringhe "YYYY-MM-DD" (vedi models/Hike.js), quindi si ordinano da sole.
    const oggi = new Date().toISOString().slice(0, 10);
    const future = mie.filter(h => h.date && h.date >= oggi).sort((a, b) => a.date.localeCompare(b.date));
    if (future.length) return future[0];

    // Nessuna in programma: si prende comunque la piu' recente fra le proprie, se c'e'.
    const passate = mie.filter(h => h.date).sort((a, b) => b.date.localeCompare(a.date));
    return passate[0] || null;
}

// Renderizza il modulo zaino in base all'escursione attiva o a input dell'utente
function renderBackpackModule() {
    const hike = escursioneDiRiferimento();

    renderWeightDistribution(hike);
    mostraEscursioneDiRiferimento(hike);

    if (hike) {
        generateChecklistFromHike(hike);
    } else {
        // Zaino PERSONALE: nessuna escursione di gruppo, quindi nessun oggetto condiviso e
        // nessuna ripartizione dei pesi. La stagione la si ricava da oggi, e la pioggia non
        // si da' per scontata.
        const altitudine = parseInt(document.getElementById("backpack-altitude").value) || 1500;
        applyBackpackRules(stagioneDaData(null, altitudine), altitudine, "giornata", false, [], 'generic');
        nascondiNotaPioggia();
    }
}

function nascondiNotaPioggia() {
    const box = document.getElementById("backpack-weather-note");
    if (box) box.classList.add("hidden");
}

// Stagione ricavata dalla data vera dell'escursione (prima era scritta "estate" e basta).
// La soglia di quota non e' un dettaglio: a 2000 metri sull'Appennino centrale, neve e
// ghiaccio ci sono da novembre ad aprile, mentre in valle negli stessi mesi si cammina in
// pile. Usare i soli mesi "da calendario" manderebbe in montagna a marzo senza ramponi.
function stagioneDaData(dataISO, altitudine) {
    const d = dataISO ? new Date(dataISO + 'T12:00:00') : new Date();
    if (Number.isNaN(d.getTime())) return "estate";
    const mese = d.getMonth() + 1;

    const altaQuota = (altitudine || 0) >= 2000;
    const mesiInvernali = altaQuota ? [11, 12, 1, 2, 3, 4] : [12, 1, 2];

    if (mesiInvernali.includes(mese)) return "inverno";
    if ([6, 7, 8].includes(mese)) return "estate";
    return "autunno-primavera";
}

// Previsione di pioggia VERA per il giorno dell'escursione, invece di darla sempre per
// scontata come prima ("const rainExpected = true").
// Ritorna true / false / null, dove null vuol dire "non lo so": le previsioni esistono solo
// per i prossimi giorni, e per un'escursione fra due mesi nessuno puo' saperlo. In quel caso
// non si forza niente nello zaino e lo si dice, invece di inventare.
async function pioggiaPrevista(hike) {
    if (!hike || !hike.date || !hike.trailhead) return null;

    const oggi = new Date().toISOString().slice(0, 10);
    if (hike.date < oggi) return null; // gia' passata: la previsione non ha senso

    const giorniMancanti = (new Date(hike.date + 'T12:00:00') - new Date(oggi + 'T12:00:00')) / 86400000;
    if (giorniMancanti > 14) return null; // oltre l'orizzonte delle previsioni

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${hike.trailhead.lat}&longitude=${hike.trailhead.lng}` +
            `&daily=precipitation_probability_max&start_date=${hike.date}&end_date=${hike.date}&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const dati = await res.json();
        const prob = dati.daily && dati.daily.precipitation_probability_max && dati.daily.precipitation_probability_max[0];
        if (typeof prob !== 'number') return null;
        // Sopra il 40% conviene avere la mantella nello zaino: sotto, portarla sempre vuol
        // dire abituarsi a ignorare l'avviso proprio il giorno che serve.
        return prob >= 40;
    } catch (e) {
        console.warn("Impossibile leggere la previsione di pioggia per l'escursione:", e);
        return null;
    }
}

// Genera checklist basata direttamente sui dettagli dell'escursione selezionata
async function generateChecklistFromHike(hike) {
    const stagione = stagioneDaData(hike.date, hike.maxAltitude);

    // Si disegna SUBITO con quello che si sa gia' (stagione e quota, che non dipendono dalla
    // rete), e la pioggia si aggiunge quando la previsione arriva: in montagna la connessione
    // e' quello che e', e una lista che non compare finche' non risponde un server esterno
    // sarebbe peggio di una lista senza la riga della mantella.
    // Nessun campo "durata" esiste ancora sull'escursione: resta "giornata" (vedi models/Hike.js).
    applyBackpackRules(stagione, hike.maxAltitude, "giornata", false, hike.backpackTemplate, hike.id);
    aggiornaFormDaEscursione(stagione, hike.maxAltitude, false);

    const pioggia = await pioggiaPrevista(hike);
    if (pioggia === null) {
        mostraNotaPioggia(null, hike);
        return;
    }
    applyBackpackRules(stagione, hike.maxAltitude, "giornata", pioggia, hike.backpackTemplate, hike.id);
    aggiornaFormDaEscursione(stagione, hike.maxAltitude, pioggia);
    mostraNotaPioggia(pioggia, hike);
}

// Il modulo qui accanto deve dire la stessa cosa della lista, altrimenti mostra i suoi
// valori predefiniti mentre la checklist ne usa altri, e non si capisce da dove esca cosa.
function aggiornaFormDaEscursione(stagione, altitudine, pioggia) {
    const campoStagione = document.getElementById("backpack-season");
    const campoQuota = document.getElementById("backpack-altitude");
    const campoPioggia = document.getElementById("backpack-rain-expected");
    if (campoStagione) campoStagione.value = stagione;
    if (campoQuota && typeof altitudine === 'number') campoQuota.value = altitudine;
    if (campoPioggia) campoPioggia.checked = !!pioggia;
}

// Genera checklist in base alle scelte manuali del form
function generateChecklistFromInputs() {
    const season = document.getElementById("backpack-season").value;
    const altitude = parseInt(document.getElementById("backpack-altitude").value);
    const duration = document.getElementById("backpack-duration").value;
    const rainExpected = document.getElementById("backpack-rain-expected").checked;

    // Scelte fatte a mano: la nota sulla previsione va tolta, altrimenti resterebbe a
    // raccontare un meteo che non c'entra piu' con la lista appena generata.
    nascondiNotaPioggia();

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
        
        const catDomKey = catName.replace(/[^a-zA-Z0-9]/g, '');
        catBox.innerHTML = `
            <h5>${escapeHtml(catName)}</h5>
            <div class="backpack-list-items" id="cat-items-${catDomKey}">
                <!-- Articoli caricati qui -->
            </div>
        `;
        container.appendChild(catBox);

        const itemsContainer = document.getElementById(`cat-items-${catDomKey}`);
        
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
                    assignmentLabel = `<span class="item-assigned">Porta: ${escapeHtml(name)}</span>`;
                } else {
                    assignmentLabel = `<span class="item-assigned" style="color:var(--accent-orange)">Da Assegnare</span>`;
                }
            }

            itemRow.innerHTML = `
                <div class="backpack-item-left ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" id="check-${catDomKey}-${index}" ${isChecked ? 'checked' : ''}>
                    <span>${escapeHtml(item.name)}</span>
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

// Riquadro in cima allo zaino: per QUALE escursione e' questa lista. Prima non c'era, e
// siccome il sistema sceglieva da solo (perfino un'escursione di un altro) non c'era modo di
// accorgersene guardando lo schermo.
function mostraEscursioneDiRiferimento(hike) {
    const box = document.getElementById("backpack-hike-context");
    if (!box) return;

    if (!hike) {
        box.className = "backpack-context-box personale";
        box.innerHTML = `<strong>Zaino personale</strong>
            <span class="small">Non hai escursioni in programma: questa e' la lista delle tue cose.
            Iscriviti a un'escursione per vedere anche gli oggetti da dividere col gruppo.</span>`;
        return;
    }

    const db = window.CamoscioState;
    const mia = hike.creatorId === (db.currentUser || {}).id;
    box.className = "backpack-context-box";
    box.innerHTML = `<strong>Zaino per: ${escapeHtml(hike.title)}</strong>
        <span class="small">${hike.date ? new Date(hike.date + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : 'data non indicata'}
        · quota massima ${hike.maxAltitude || '?'} m · ${mia ? 'organizzata da te' : 'a cui partecipi'}</span>`;
}

// Nota sulla previsione di pioggia. Il caso "non lo so" va detto, non nascosto: e' la
// differenza fra "non pioverà" e "è troppo presto per saperlo", e cambia cosa metti in zaino.
function mostraNotaPioggia(pioggia, hike) {
    const box = document.getElementById("backpack-weather-note");
    if (!box) return;

    box.classList.remove("hidden");
    if (pioggia === null) {
        const troppoLontana = hike && hike.date && hike.date > new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        box.textContent = troppoLontana
            ? "Previsioni non ancora disponibili: mancano più di due settimane. Ricontrolla lo zaino nei giorni prima di partire."
            : "Previsioni meteo non disponibili per questa data: la lista non tiene conto della pioggia.";
        return;
    }
    box.textContent = pioggia
        ? "Previsione: pioggia probabile il giorno dell'escursione. Mantella e coprizaino sono stati resi obbligatori."
        : "Previsione: giornata senza pioggia. L'attrezzatura antipioggia non è stata forzata nella lista.";
}

// Renderizza il widget di suddivisione pesi tra gli amici della gita
function renderWeightDistribution(hike) {
    const container = document.getElementById("backpack-weight-distribution");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    // Senza un'escursione di gruppo non c'e' niente da dividere: prima si finiva qui con
    // l'escursione di un estraneo e si vedevano i nomi dei suoi partecipanti.
    if (!hike) {
        container.innerHTML = `<p class="small text-muted">Nessuna escursione di gruppo in programma: non c'è nulla da ripartire.</p>`;
        return;
    }

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
            <span>${user.avatar} ${escapeHtml(user.username)}</span>
            <div style="display:flex; align-items:center; gap: 10px;">
                <!-- Assegnatore rapido oggetti condivisi -->
                <select onchange="reassignSharedGear('${hike.id}', '${pId}', this.value)" class="user-select-dropdown" style="padding: 2px 4px; font-size: 0.75rem;">
                    <option value="">Assegna oggetto...</option>
                    ${hike.backpackTemplate.filter(item => !item.assignedTo || item.assignedTo !== pId).map(item => `
                        <option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${item.weight}g)</option>
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
