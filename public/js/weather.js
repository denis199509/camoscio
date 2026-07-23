function initWeatherModule() {
    // Di default, carica il meteo per la prima escursione (Gran Sasso)
    fetchWeatherForCoords(42.4691, 13.5595, "Corno Grande");
}

// Interroga Open-Meteo per recuperare i parametri atmosferici
async function fetchWeatherForCoords(lat, lng, placeName) {
    const container = document.getElementById("weather-details-container");
    if (!container) return;

    container.innerHTML = `<div class="text-center py-4"><span class="blink">Interrogazione API Meteo...</span></div>`;

    // Utilizziamo le API Open-Meteo (Open Source, senza chiavi API necessarie)
    // Richiediamo temperatura a 2m, velocità vento a 10m, probabilità precipitazioni e indice CAPE (instabilità fulmini)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,wind_speed_10m,precipitation_probability,cape&forecast_days=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Errore API Meteo");
        
        const data = await response.json();
        renderWeatherData(data, placeName);
    } catch (e) {
        console.warn("Impossibile caricare il meteo reale. Utilizzo dati meteo alpini simulati offline.", e);
        renderSimulatedWeatherData(placeName);
    }
}

// Elabora e renderizza i dati reali ricevuti dall'API
function renderWeatherData(data, placeName) {
    const container = document.getElementById("weather-details-container");
    if (!container) return;

    // Otteniamo l'ora corrente per estrarre l'indice dell'orario odierno
    const currentHour = new Date().getHours();
    
    // Parametri base della stazione meteo di griglia (solitamente a quota valle)
    const gridTemp = data.hourly.temperature_2m[currentHour];
    const gridWind = data.hourly.wind_speed_10m[currentHour];
    const rainProb = data.hourly.precipitation_probability[currentHour];
    const capeValue = data.hourly.cape ? data.hourly.cape[currentHour] : 0; // J/kg

    // Altitudine della griglia di default (stimata a 600m se non indicata)
    const stationAlt = 600;

    // Definiamo 3 quote significative per l'escursione
    const altitudes = [
        { name: "Fondo Valle", elevation: 800 },
        { name: "Quota Media (Rifugio)", elevation: 1800 },
        { name: "Cima / Cresta", elevation: 2500 }
    ];

    let html = `<h5 style="margin-bottom: 8px; color: #FFF;">Ritrovo: ${placeName}</h5>`;
    html += `<div style="font-size: 0.8rem; margin-bottom: 12px; color: var(--color-text-secondary);">Precipitazioni: <b>${rainProb}%</b> | Instabilità CAPE: <b>${Math.round(capeValue)} J/kg</b></div>`;

    altitudes.forEach(alt => {
        // 1. Calcolo Gradiente Termico Verticale (Lapse Rate): circa -0.65°C ogni 100 metri
        const altDifference = alt.elevation - stationAlt;
        const lapseRate = -0.0065; // °C al metro
        const calculatedTemp = gridTemp + (altDifference * lapseRate);

        // 2. Calcolo Vento di Alta Quota: il vento cresce con l'altezza dovuto alla minore frizione terrestre
        // Applichiamo una formula esponenziale semplificata di gradiente del vento
        const heightFactor = Math.pow(alt.elevation / Math.max(1, stationAlt), 0.22);
        const calculatedWind = gridWind * heightFactor;

        html += `
            <div class="weather-alt-row">
                <div class="weather-alt-name">
                    ${alt.name} <span class="text-muted" style="font-weight: normal; font-size: 0.75rem;">(${alt.elevation}m)</span>
                </div>
                <div class="weather-alt-info">
                    <span class="temp-text">${calculatedTemp.toFixed(1)}°C</span>
                    <span class="wind-text">💨 ${calculatedWind.toFixed(1)} km/h</span>
                </div>
            </div>
        `;
    });

    // 3. Calcolo rischio fulmini (CAPE > 500 e pioggia > 30% oppure CAPE > 1000)
    let lightningRisk = false;
    let riskMessage = "";

    if (capeValue > 1000) {
        lightningRisk = true;
        riskMessage = "PERICOLO ELEVATO: Fortissima instabilità convettiva. Rischio temporali violenti e fulmini imminenti nel pomeriggio!";
    } else if (capeValue > 400 && rainProb > 30) {
        lightningRisk = true;
        riskMessage = "RISCHIO FULMINI: Alta umidità con instabilità. Possibilità di celle temporalesche in quota.";
    }

    if (lightningRisk) {
        html += `
            <div class="lightning-alert blink">
                <i data-lucide="zap" style="color:#EF4444; fill:#EF4444; width:16px; height:16px;"></i>
                <span>${riskMessage}</span>
            </div>
        `;
        
        // Simula la notifica Push del browser (Notifica di Emergenza)
        triggerLightningPushNotification(riskMessage);
    } else {
        html += `
            <div class="lightning-alert" style="background: rgba(16, 185, 129, 0.15); border-color: var(--accent-green); color: #A7F3D0;">
                <i data-lucide="check-circle" style="color:var(--accent-green); width:16px; height:16px;"></i>
                <span>Nessun rischio fulmini rilevato per le prossime ore.</span>
            </div>
        `;
    }

    container.innerHTML = html;
    
    // Aggiorna icone lucide iniettate
    if (window.lucide) window.lucide.createIcons();
}

// Simulatore offline in caso di mancanza connessione internet
function renderSimulatedWeatherData(placeName) {
    const container = document.getElementById("weather-details-container");
    if (!container) return;

    // Dati estivi realistici simulati
    const mockData = {
        hourly: {
            temperature_2m: Array(24).fill(22.5),
            wind_speed_10m: Array(24).fill(12.0),
            precipitation_probability: Array(24).fill(45), // 45% pioggia
            cape: Array(24).fill(650) // Instabilità da fulmini
        }
    };

    renderWeatherData(mockData, placeName + " (Simulato Offline)");
}

// Notifica Push di emergenza (simulata nel browser)
function triggerLightningPushNotification(message) {
    // Chiede il permesso e invia notifica HTML5 se supportato
    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("Camoscio Safety Alert", {
                body: message
            });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification("Camoscio Safety Alert", {
                        body: message,
                        icon: "🏔️"
                    });
                }
            });
        }
    }
}

window.fetchWeatherForCoords = fetchWeatherForCoords;
window.initWeatherModule = initWeatherModule;
window.renderWeatherData = renderWeatherData;
