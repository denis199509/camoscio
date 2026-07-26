// Meteo multi-quota del punto scelto.
//
// Punto 27 di cose_da_fare.txt: prima si potevano vedere SOLO due posti (Corno Grande e
// Monte Vettore, con le coordinate scritte qui dentro) e non c'era modo di cambiarli. Ora il
// punto si sceglie con la stessa barra di ricerca del punto di ritrovo di un'escursione
// (punto 8), riusandone il componente - vedi CamoscioPlaceSearch in trailhead-picker.js.

// Punto da cui si parte la prima volta in assoluto. E' il RITROVO di Campo Imperatore, non
// la vetta del Corno Grande come prima: le tre quote si calcolano a salire dal punto scelto,
// quindi partendo da una vetta (2673 m) la terza riga finiva a 3473 m, una quota che in
// Appennino non esiste. Partendo dal ritrovo (2134 m) la terza riga cade a 2934 m, cioe'
// praticamente in vetta al Corno Grande (2912 m) - che e' l'informazione che serve davvero
// a chi deve decidere se salire.
const PUNTO_PREDEFINITO = { lat: 42.4423, lng: 13.5581, nome: "Campo Imperatore" };

// L'ultimo punto guardato si ricorda nel browser e NON sul database: e' una preferenza di
// comodita', pubblica e sempre riottenibile: metterla su MongoDB consumerebbe spazio in
// cambio di niente (vincolo hard del progetto).
const CHIAVE_MEMORIA = 'camoscio_punto_meteo';

let puntoMeteo = null;

function leggiPuntoRicordato() {
    try {
        const grezzo = localStorage.getItem(CHIAVE_MEMORIA);
        if (!grezzo) return null;
        const p = JSON.parse(grezzo);
        if (typeof p.lat === 'number' && typeof p.lng === 'number') return p;
    } catch (e) {
        // localStorage non disponibile (navigazione privata su alcuni browser) o dato
        // rovinato: non e' un errore da mostrare, si riparte semplicemente dal predefinito.
    }
    return null;
}

function ricordaPunto(p) {
    try {
        localStorage.setItem(CHIAVE_MEMORIA, JSON.stringify(p));
    } catch (e) {
        // Vedi sopra: se non si puo' scrivere, pazienza.
    }
}

function initWeatherModule() {
    const ricordato = leggiPuntoRicordato();
    const p = ricordato || PUNTO_PREDEFINITO;
    fetchWeatherForCoords(p.lat, p.lng, p.nome);

    const campo = document.getElementById('weather-point-search');
    // Se si riparte da un punto gia' scelto, la barra lo mostra: altrimenti resterebbe vuota
    // mentre sotto compare il meteo di un posto, e non si capirebbe di dove sono quei numeri.
    if (campo && ricordato && ricordato.nome) campo.value = ricordato.nome;

    // Il componente di ricerca puo' non esserci (pagine diverse da index.html): il meteo
    // deve continuare a funzionare lo stesso, solo senza poter cambiare punto.
    if (!window.CamoscioPlaceSearch) return;

    window.CamoscioPlaceSearch.attachSearch({
        input: campo,
        results: document.getElementById('weather-search-results'),
        onPick: r => fetchWeatherForCoords(r.lat, r.lng, r.nome)
    });

    const btnMappa = document.getElementById('btn-open-weather-map-picker');
    if (btnMappa) {
        btnMappa.addEventListener('click', () => window.CamoscioPlaceSearch.openMapPicker({
            titolo: 'Scegli il punto del meteo',
            suggerimento: 'Tocca la mappa nel punto che ti interessa: temperature e vento vengono calcolati per quella zona, alle diverse quote.',
            punto: puntoMeteo,
            onConfirm: p2 => {
                fetchWeatherForCoords(p2.lat, p2.lng, p2.nome);
                if (campo) campo.value = p2.nome || '';
            }
        }));
    }

    const btnQui = document.getElementById('btn-weather-here');
    if (btnQui) btnQui.addEventListener('click', meteoDoveMiTrovo);
}

// "Meteo dove mi trovo": si appoggia al puntino blu del punto 26, cosi' il permesso di
// posizione e la guida per sbloccarlo sono gestiti in un posto solo.
async function meteoDoveMiTrovo() {
    if (!window.CamoscioGeo) return;

    const btn = document.getElementById('btn-weather-here');
    const etichetta = btn ? btn.innerHTML : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader"></i> Cerco la posizione...`;
        if (window.lucide) window.lucide.createIcons();
    }

    const ripristina = () => {
        if (!btn) return;
        btn.disabled = false;
        btn.innerHTML = etichetta;
        if (window.lucide) window.lucide.createIcons();
    };

    let posizione = window.CamoscioGeo.ultimaPosizione();
    if (!posizione) {
        // accendi(false) chiede il permesso se serve e, se e' bloccato, mostra la guida per
        // sbloccarlo: qui non si deve duplicare nessuno di quei messaggi.
        const acceso = await window.CamoscioGeo.accendi(false);
        if (!acceso) {
            ripristina();
            return;
        }
        posizione = window.CamoscioGeo.ultimaPosizione();
    }

    if (!posizione) {
        // Permesso concesso ma primo fix non ancora arrivato: si aspetta quello invece di
        // dire che non ha funzionato.
        const disiscrivi = window.CamoscioGeo.onPosizione((lat, lng) => {
            disiscrivi();
            ripristina();
            usaPosizionePerMeteo(lat, lng);
        });
        setTimeout(() => {
            if (!window.CamoscioGeo.ultimaPosizione()) {
                disiscrivi();
                ripristina();
                window.showToast("Non sono ancora riuscito a leggere la posizione. Riprova fra qualche secondo, all'aperto.", "info");
            }
        }, 8000);
        return;
    }

    ripristina();
    usaPosizionePerMeteo(posizione.lat, posizione.lng);
}

// Il nome del posto in cui ci si trova lo si chiede al server (stesso servizio del punto 8):
// "Meteo a Campo Imperatore" dice molto piu' di "Meteo a 42.44, 13.55". Il meteo pero' parte
// SUBITO con le coordinate, senza aspettare il nome: la ricerca del riferimento puo'
// impiegare qualche secondo e non c'e' motivo di far attendere il dato che serve davvero.
async function usaPosizionePerMeteo(lat, lng) {
    fetchWeatherForCoords(lat, lng, "La mia posizione");

    if (!window.CamoscioPlaceSearch) return;
    const dati = await window.CamoscioPlaceSearch.cercaRiferimento(lat, lng);
    if (!dati || !dati.nome) return;
    // Solo se nel frattempo l'utente non ha gia' scelto un altro punto.
    if (puntoMeteo && puntoMeteo.lat === lat && puntoMeteo.lng === lng) {
        fetchWeatherForCoords(lat, lng, dati.nome);
        const campo = document.getElementById('weather-point-search');
        if (campo) campo.value = dati.nome;
    }
}

// Interroga Open-Meteo per recuperare i parametri atmosferici
async function fetchWeatherForCoords(lat, lng, placeName) {
    const container = document.getElementById("weather-details-container");
    if (!container) return;

    puntoMeteo = { lat, lng, nome: placeName };
    ricordaPunto(puntoMeteo);

    container.innerHTML = `<div class="text-center py-4"><span class="blink">Interrogazione API Meteo...</span></div>`;

    // Utilizziamo le API Open-Meteo (Open Source, senza chiavi API necessarie)
    // Richiediamo temperatura a 2m, velocità vento a 10m, probabilità precipitazioni e indice CAPE (instabilità fulmini)
    //
    // timezone=auto aggiunto col punto 27: senza, Open-Meteo risponde in GMT e l'ora corrente
    // veniva letta dall'orario locale su una serie in GMT. D'estate in Italia sono due ore di
    // scarto, cioe' si mostrava il meteo di due ore prima proprio nelle ore in cui i temporali
    // si formano.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,wind_speed_10m,precipitation_probability,cape&forecast_days=1&timezone=auto`;

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

    // ALTITUDINE VERA della cella di griglia, che Open-Meteo restituisce nella stessa
    // risposta. Prima era SUPPOSTA a 600 m: con un solo punto fisso era una semplificazione
    // accettabile, ma dal punto 27 il punto lo sceglie l'utente e quella supposizione
    // diventerebbe un errore vero e proprio - la temperatura di ogni quota si calcola a
    // partire da qui, quindi sbagliare la base sposta tutti e tre i valori insieme.
    const stationAlt = (typeof data.elevation === 'number') ? data.elevation : 600;

    // Le tre quote seguono il punto scelto invece di essere fisse a 800/1800/2500: su un
    // punto d'alta quota come Campo Imperatore (2130 m) le vecchie quote fisse avrebbero
    // mostrato un "Fondo Valle" 1300 metri PIU' IN BASSO del posto che si sta guardando.
    //
    // Perche' +400 e +800 e non salti piu' larghi: e' il dislivello vero di una giornata in
    // Appennino centrale. Dal ritrovo del Corno Grande (2119 m misurati) si arriva cosi' a
    // 2919 m, cioe' praticamente in vetta (2912 m). Con +1000 si sarebbe mostrata una quota
    // di 3119 m, che in queste quattro regioni non esiste da nessuna parte.
    const altitudes = [
        { name: "Punto scelto", elevation: Math.round(stationAlt) },
        { name: "Salita", elevation: Math.round(stationAlt + 400) },
        { name: "Cresta / Vetta", elevation: Math.round(stationAlt + 800) }
    ];

    let html = `<h5 style="margin-bottom: 8px; color: #FFF;">${escapeHtml(placeName)}</h5>`;
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
                <i data-lucide="zap" style="color:#A83B2E; fill:#A83B2E; width:16px; height:16px;"></i>
                <span>${riskMessage}</span>
            </div>
        `;

        // Simula la notifica Push del browser (Notifica di Emergenza)
        triggerLightningPushNotification(riskMessage);
    } else {
        html += `
            <div class="lightning-alert" style="background: rgba(76, 122, 68, 0.15); border-color: var(--accent-green); color: #B8CBA8;">
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
        // Quota di riferimento plausibile per l'Appennino centrale: senza, i dati simulati
        // ricadrebbero sul valore di riserva e le quote mostrate non avrebbero relazione col
        // punto scelto.
        elevation: 1200,
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
