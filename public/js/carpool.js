function initCarpoolModule() {
    setupCarpoolEvents();
    renderCarpoolModule();
}

function setupCarpoolEvents() {
    // Bottone ricalcolo spese generico
    const btnCalc = document.getElementById("btn-calculate-expenses");
    if (btnCalc) {
        btnCalc.addEventListener("click", () => {
            calculateGenericExpenses();
        });
    }

    // Form salvataggio indirizzo partenza
    const formPrivacy = document.getElementById("privacy-address-form");
    if (formPrivacy) {
        formPrivacy.addEventListener("submit", async (e) => {
            e.preventDefault();
            const homeCity = document.getElementById("user-home-city").value;
            await saveUserHomeCity(homeCity);
        });
    }

    // Form offerta passaggio auto
    const formOffer = document.getElementById("offer-carpool-form");
    if (formOffer) {
        formOffer.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitCarpoolOffer();
        });
    }
}

// Renderizza la UI del modulo carpooling
async function renderCarpoolModule() {
    const db = window.CamoscioState;
    const currentHike = db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]; // Escursione scelta dall'utente, o la prima disponibile

    // Popola select escursioni nel form offerta passaggi
    populateHikeSelects();

    if (!currentHike) return;

    // Rileva e disegna gli abbinamenti di carpooling e la privacy
    renderAddressPrivacyMatch(currentHike);

    // Disegna la lista dei conducenti attivi per l'escursione corrente
    renderDriversList(currentHike);
}

// Popola la select delle escursioni disponibili per cui offrire/cercare passaggi
function populateHikeSelects() {
    const select = document.getElementById("offer-hike-select");
    const diarySelect = document.getElementById("diary-hike-select");
    if (!select) return;

    const db = window.CamoscioState;
    select.innerHTML = "";
    if (diarySelect) diarySelect.innerHTML = "";

    db.hikes.forEach(h => {
        const opt = document.createElement("option");
        opt.value = h.id;
        opt.textContent = `${h.title} (${new Date(h.date).toLocaleDateString()})`;
        select.appendChild(opt);

        if (diarySelect) {
            const optD = opt.cloneNode(true);
            diarySelect.appendChild(optD);
        }
    });
}

// Ricalcolo spese viaggio del pannello generico
function calculateGenericExpenses() {
    const dist = parseFloat(document.getElementById("calc-dist").value) || 0;
    const cons = parseFloat(document.getElementById("calc-consumption").value) || 0;
    const price = parseFloat(document.getElementById("calc-fuel-price").value) || 0;
    const toll = parseFloat(document.getElementById("calc-toll").value) || 0;
    const extra = parseFloat(document.getElementById("calc-extra").value) || 0;
    const pass = parseInt(document.getElementById("calc-passengers").value) || 1;

    // Calcolo: (km / 100) * Consumo * PrezzoCarburante
    const fuelCost = (dist / 100) * cons * price;
    const totalCost = fuelCost + toll + extra;
    const costPerPerson = totalCost / pass;

    document.getElementById("res-fuel-cost").textContent = `€ ${fuelCost.toFixed(2)}`;
    document.getElementById("res-total-cost").textContent = `€ ${totalCost.toFixed(2)}`;
    document.getElementById("res-share-cost").textContent = `€ ${costPerPerson.toFixed(2)}`;
}

// Algoritmo Privacy Partenza da Casa & Accoppiamento Automatico
async function renderAddressPrivacyMatch(hike) {
    const statusBox = document.getElementById("privacy-match-status");
    if (!statusBox) return;

    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    // Vediamo se l'utente corrente ha inserito una città/zona di partenza
    // In questo mock memorizziamo la partenza in un oggetto globale o nel profilo utente nel DB
    const myHomeCity = currentUser.homeCity || localStorage.getItem(`home_city_${currentUser.id}`) || "";
    document.getElementById("user-home-city").value = myHomeCity;

    if (!myHomeCity) {
        statusBox.className = "privacy-status isolated";
        statusBox.innerHTML = `
            <i data-lucide="shield-alert"></i>
            <span>Nessuna zona di partenza inserita. Inserisci la tua zona per trovare compagni vicini.</span>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    // Otteniamo gli indirizzi degli altri partecipanti dell'escursione corrente
    const matches = [];
    
    hike.participants.forEach(pId => {
        if (pId === currentUser.id) return; // Escludo me stesso

        const user = db.users.find(u => u.id === pId);
        if (!user) return;

        const otherHomeCity = user.homeCity || localStorage.getItem(`home_city_${pId}`) || "";
        
        // Verifica se c'è corrispondenza di stringa (es. "Milano Loreto" e "Milano Lambrate" contengono entrambe "Milano")
        const isMatch = checkCityMatch(myHomeCity, otherHomeCity);
        if (isMatch && otherHomeCity) {
            matches.push({ user, city: otherHomeCity });
        }
    });

    if (matches.length > 0) {
        statusBox.className = "privacy-status matching";
        
        const matchedNames = matches.map(m => `<b>${m.user.username.split(" ")[0]}</b> (${m.city})`).join(", ");
        statusBox.innerHTML = `
            <i data-lucide="check-circle" style="color:var(--accent-green)"></i>
            <span><strong>CORRISPONDENZA PARTENZA TROVATA!</strong> Anche tu e ${matchedNames} partiti dalla stessa zona. Potete viaggiare insieme!</span>
        `;
    } else {
        statusBox.className = "privacy-status isolated";
        statusBox.innerHTML = `
            <i data-lucide="shield"></i>
            <span><strong>Posizione protetta:</strong> Stai partendo da <i>"${myHomeCity}"</i>. Attualmente nessun altro partecipante parte dalla tua zona. La tua partenza rimarrà nascosta per motivi di privacy.</span>
        `;
    }

    if (window.lucide) window.lucide.createIcons();
}

// Funzione helper per verificare se due indirizzi corrispondono (es. stessa città)
function checkCityMatch(city1, city2) {
    const clean1 = city1.toLowerCase().trim();
    const clean2 = city2.toLowerCase().trim();
    
    if (clean1 === clean2) return true;
    
    // Controlla se una parola principale (es. Milano, Bergamo, Roma) è contenuta in entrambe
    const words1 = clean1.split(/\s+/);
    const words2 = clean2.split(/\s+/);
    
    // Vediamo se ci sono parole comuni lunghe più di 3 lettere (escludendo via, viale, etc.)
    const exclude = ["via", "viale", "piazza", "corso", "alto", "basso", "nord", "sud"];
    for (let w1 of words1) {
        if (w1.length > 3 && !exclude.includes(w1)) {
            if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
                return true;
            }
        }
    }
    return false;
}

// Salva la città di partenza dell'utente e sincronizza il server
async function saveUserHomeCity(city) {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    if (!usr) return;

    localStorage.setItem(`home_city_${usr.id}`, city);
    usr.homeCity = city;

    try {
        await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ homeCity: city })
        });
        
        await refreshState();
        renderCarpoolModule();
    } catch(e) {
        console.error("Errore nel salvataggio della città di partenza:", e);
    }
}

// Offri un passaggio (aggiungi me come autista)
async function submitCarpoolOffer() {
    const db = window.CamoscioState;
    const hikeId = document.getElementById("offer-hike-select").value;
    const city = document.getElementById("offer-city").value;
    const seats = parseInt(document.getElementById("offer-seats").value);
    const distanceKm = parseFloat(document.getElementById("offer-distance").value) || 120;

    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    const newDriver = {
        userId: db.currentUser.id,
        seats,
        departureCity: city,
        distanceKm,
        pricePerPassenger: 0, // Sarà ricalcolato in base alle spese effettive divisi i passeggeri
        passengers: []
    };

    // Pulisce vecchie offerte dello stesso utente per l'escursione
    hike.carpool.drivers = hike.carpool.drivers.filter(d => d.userId !== db.currentUser.id);
    hike.carpool.drivers.push(newDriver);

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ carpool: hike.carpool })
        });

        document.getElementById("offer-city").value = "";
        
        await refreshState();
        renderCarpoolModule();
    } catch(e) {
        console.error("Errore nell'offrire il carpooling:", e);
    }
}

// Disegna l'elenco delle vetture disponibili per l'escursione attiva
function renderDriversList(hike) {
    const container = document.getElementById("hike-carpools-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (!hike.carpool.drivers || hike.carpool.drivers.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-3">Nessuna auto disponibile registrata per questa gita. Offri tu il primo passaggio!</div>`;
        return;
    }

    hike.carpool.drivers.forEach(driver => {
        const driverUser = db.users.find(u => u.id === driver.userId);
        if (!driverUser) return;

        const isMe = driver.userId === db.currentUser.id;
        
        // Calcola quota carburante + autostrada pro capite per questa macchina
        // Distanza dichiarata dall'autista al momento dell'offerta (A/R), consumo/pedaggio presi dall'escursione
        const distance = driver.distanceKm || 120;
        const consumption = hike.carpool.fuelConsumption || 7;
        const fuelPrice = hike.carpool.fuelPrice || 1.85;
        const toll = hike.carpool.tollCost || 0;
        
        const totCarCost = ((distance / 100) * consumption * fuelPrice) + toll;
        const totalPassengers = 1 + (driver.passengers ? driver.passengers.length : 0);
        const splitCost = totCarCost / totalPassengers;

        const item = document.createElement("div");
        item.className = "carpool-group-item";

        let passengerListHtml = "";
        if (driver.passengers && driver.passengers.length > 0) {
            passengerListHtml = driver.passengers.map(pId => {
                const passUser = db.users.find(u => u.id === pId);
                const name = passUser ? passUser.username.split(" ")[0] : "Passeggero";
                const avatar = passUser ? passUser.avatar : "👤";
                return `<span class="badge badge-primary" title="${passUser ? passUser.username : ''}">${avatar} ${name}</span>`;
            }).join(" ");
        } else {
            passengerListHtml = `<span class="text-muted small italic">Nessun passeggero a bordo</span>`;
        }

        // Bottone Azione: Unisciti o Esci
        let actionBtnHtml = "";
        const isPassenger = driver.passengers && driver.passengers.includes(db.currentUser.id);

        if (isMe) {
            actionBtnHtml = `<span class="badge badge-accent">La tua Auto</span>`;
        } else if (isPassenger) {
            actionBtnHtml = `<button class="btn btn-sm btn-danger" onclick="leaveCarpoolGroup('${hike.id}', '${driver.userId}')">Abbandona Auto</button>`;
        } else {
            const seatsLeft = driver.seats - (driver.passengers ? driver.passengers.length : 0);
            if (seatsLeft > 0) {
                actionBtnHtml = `<button class="btn btn-sm btn-success" onclick="joinCarpoolGroup('${hike.id}', '${driver.userId}')">Sali a Bordo</button>`;
            } else {
                actionBtnHtml = `<span class="badge badge-red">Auto Piena</span>`;
            }
        }

        const seatsLeft = driver.seats - (driver.passengers ? driver.passengers.length : 0);

        item.innerHTML = `
            <div class="carpool-group-header">
                <strong>🚗 Conducente: ${driverUser.username}</strong>
                <span>Posti liberi: <b>${seatsLeft}/${driver.seats}</b></span>
            </div>
            <div class="text-muted small">Partenza da: <b>${driver.departureCity}</b> | Costo stimato passeggero: <strong style="color:var(--accent-green)">€ ${splitCost.toFixed(2)}</strong></div>
            <div style="margin: 10px 0;">
                <span class="small text-muted" style="display:block; margin-bottom:4px;">Equipaggio:</span>
                <div class="carpool-passengers">${passengerListHtml}</div>
            </div>
            <div style="display:flex; justify-content: flex-end; margin-top:8px;">
                ${actionBtnHtml}
            </div>
        `;

        container.appendChild(item);
    });
}

// Sali a bordo del carpooling di un amico
window.joinCarpoolGroup = async function(hikeId, driverId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    const driver = hike.carpool.drivers.find(d => d.userId === driverId);
    if (!driver) return;

    if (!driver.passengers) driver.passengers = [];
    
    // Evita duplicati
    if (!driver.passengers.includes(db.currentUser.id)) {
        driver.passengers.push(db.currentUser.id);
        
        // Rimuove l'utente da qualsiasi altra auto della stessa escursione per evitare doppioni
        hike.carpool.drivers.forEach(d => {
            if (d.userId !== driverId && d.passengers) {
                d.passengers = d.passengers.filter(pId => pId !== db.currentUser.id);
            }
        });

        try {
            await fetch(`/api/hikes/${hikeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carpool: hike.carpool })
            });

            await refreshState();
            renderCarpoolModule();
        } catch(e) {
            console.error("Errore nell'unirsi al carpooling:", e);
        }
    }
};

// Lascia il carpooling di un amico
window.leaveCarpoolGroup = async function(hikeId, driverId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    const driver = hike.carpool.drivers.find(d => d.userId === driverId);
    if (!driver) return;

    if (driver.passengers) {
        driver.passengers = driver.passengers.filter(pId => pId !== db.currentUser.id);

        try {
            await fetch(`/api/hikes/${hikeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carpool: hike.carpool })
            });

            await refreshState();
            renderCarpoolModule();
        } catch(e) {
            console.error("Errore nell'abbandonare il carpooling:", e);
        }
    }
};

window.initCarpoolModule = initCarpoolModule;
window.renderCarpoolModule = renderCarpoolModule;
window.populateHikeSelects = populateHikeSelects;
