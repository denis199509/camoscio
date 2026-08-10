// Global map variables
window.mapInstance = null;
let userGpsMarker = null;
let hikePolyline = null;
let trailheadMarker = null; // Marker del punto di ritrovo dell'escursione attiva (vedi loadActiveHikeOnMap)
let reportMarkersGroup = null;
let peakMarkersGroup = null;

// Punto 45: mappa tipo segnalazione -> emoji/titolo, usata da renderMapMarkers(),
// renderWazeReportsList() qui sotto e da public/js/pendingreports.js. Estratta qui (invece di
// una terza copia in pendingreports.js) perche' il progetto fattorizza gia' alla seconda
// occorrenza, non aspetta la terza (stesso principio della chat condivisa, punto 55).
window.CamoscioReportTypes = {
    emoji: { frana: '⚠️', ghiaccio: '❄️', fontana_secca: '💧', ostacolo: '🌲' },
    title: {
        frana: 'Frana / Cedimento',
        ghiaccio: 'Presenza Ghiaccio',
        fontana_secca: 'Sorgente Senz\'Acqua',
        ostacolo: 'Sentiero Ostruito'
    }
};
let activeHikePath = []; // Array di coordinate per il sentiero attivo
let liveTrackPolyline = null; // Percorso REALMENTE registrato durante un tracciamento GPS live (Fase F)

// Punto 26 di cose_da_fare.txt - il puntino blu della posizione reale.
// Fino a oggi sulla mappa c'era SOLO il segnaposto 🥾 trascinabile (posizione simulata,
// ferma a Campo Imperatore finche' non la si trascina) e si muoveva da solo unicamente
// durante una registrazione. Chi apriva la mappa aspettandosi il puntino di Google Maps non
// lo trovava, perche' non e' mai esistito. Questi due livelli sono quel puntino: sono SOLO
// visivi e non toccano ne' il tracciamento ne' i timbri delle vette.
let posDotMarker = null;      // il puntino
let posAccuracyCircle = null; // il cerchio della precisione dichiarata dal telefono
let posLayerGroup = null;
let posFollowEnabled = false; // il puntino ricentra la mappa mentre ci si muove
// Blu deciso, DIVERSO dal #7FB5C7 della traccia registrata (vedi resetLiveTrackPolyline):
// se fossero lo stesso colore, sulla mappa non si capirebbe piu' quale e' la strada gia'
// fatta e quale il punto in cui ci si trova adesso.
const POS_DOT_COLOR = '#2F7FD6';

// Punto 11 di cose_da_fare.txt - "la mappa mi segue".
// Il marker in realta' seguiva GIA' il GPS: misurato dal vivo (telefono emulato, GPS
// simulato in cammino) TUTTI gli aggiornamenti arrivavano, la posizione cambiava e la
// distanza veniva registrata. Il problema e' che la mappa resta allo zoom iniziale 9,
// dove tutta l'Italia centrale sta in uno schermo: a quella scala 1 pixel vale ~227
// metri, quindi 700 metri camminati spostavano il segnaposto di 3 pixel - visivamente
// fermo. Trascinandolo a mano invece si copriva mezzo schermo = decine di km, e sembrava
// l'unica cosa che "funzionasse".
// Da qui la correzione: all'avvio di una registrazione la mappa si porta sulla posizione
// vera a uno zoom da camminata e poi la insegue ad ogni fix.
let liveFollowEnabled = false;
let liveViewNeedsInitialCenter = false; // il primo fix "salta" sul posto, i successivi scorrono
const LIVE_FOLLOW_ZOOM = 16; // ~2 metri per pixel: un passo si vede

// Ambito geografico attuale della demo: Lazio, Molise, Abruzzo, Marche ("per ora", vedi nota owner).
// Rettangolo di riserva usato SOLO se per qualche motivo non si riescono a caricare i confini
// reali dal server (vedi ensureRegionBoundaries) - da Fase G in poi la fonte di verita' sono
// i poligoni reali in data/region-boundaries.json, serviti da GET /api/regions/boundaries.
window.CAMOSCIO_REGION_BOUNDS = { minLat: 40.8, maxLat: 43.9, minLng: 11.4, maxLng: 15.2 };

// Stile della mappa base (punto 39): OpenTopoMap al posto di OSM standard, perche' il
// sito non disegna i propri sentieri (servono solo ad agganciare il GPS e a costruire i
// percorsi, vedi trailIndex.js/trailGraph.js) - senza curve di livello e sentieri veri
// sul fondo, quella di OSM standard e' quasi vuota in montagna. Misurato il 2026-07-29
// sulla tile di Campo Imperatore (15/17618/12109): 32 KB contro 13,8 di OSM standard,
// vedi la stima aggiornata in estimateOfflineDownloadSize (offline-map.js).
// Condiviso con trailhead-picker.js (la mini-mappa per scegliere ritrovo/meteo, script
// caricato dopo questo): un solo posto dove cambiare provider, non due URL da tenere
// allineate a mano.
window.CAMOSCIO_TILE_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
window.CAMOSCIO_TILE_OPTIONS = {
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17, // OpenTopoMap non ha tile oltre lo zoom 17 (OSM standard arrivava a 18)
    styleId: 'opentopo' // usato da tileKey() in offline-map.js: non mescolare la cache offline con tile di uno stile diverso
};

// Coordinate di default (Campo Imperatore, Gran Sasso - Abruzzo)
const defaultCenter = [42.62, 13.40];
window.userSimulatedLocation = { lat: 42.4423, lng: 13.5581 }; // Partenza da Campo Imperatore di default

// Ray-casting su un singolo anello [[lng,lat],...] - stessa identica logica di
// lib/geometry.js lato server (duplicata qui perche' il frontend non ha un bundler/modulo
// condiviso col backend, stesso criterio gia' in uso per altre piccole funzioni geometriche
// come calculateDistance).
function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInGeojson(lng, lat, geojson) {
    const ringsSets = geojson.type === 'Polygon' ? [geojson.coordinates] : geojson.coordinates;
    for (const rings of ringsSets) {
        let inside = false;
        for (const ring of rings) {
            if (pointInRing(lng, lat, ring)) inside = !inside;
        }
        if (inside) return true;
    }
    return false;
}

// Vero confine geografico (Fase G): true se il punto e' dentro una delle 4 regioni reali.
// Finche' i confini reali non sono ancora arrivati dal server, usa il rettangolo di riserva
// per non lasciare la validazione completamente aperta nel frattempo.
window.CamoscioIsInRegion = function (lat, lng) {
    if (window.CAMOSCIO_REGIONS_GEOJSON) {
        for (const region of Object.values(window.CAMOSCIO_REGIONS_GEOJSON)) {
            if (pointInGeojson(lng, lat, region)) return true;
        }
        return false;
    }
    const b = window.CAMOSCIO_REGION_BOUNDS;
    return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
};

// Scarica una volta sola per pagina i confini regionali reali (Fase G) dal server, e
// aggiorna anche il rettangolo di riserva perche' racchiuda per bene i confini veri
// (serve solo come limite morbido di trascinamento della mappa Leaflet, che richiede
// per forza un rettangolo: la validazione vera e propria usa i poligoni, non questo).
async function ensureRegionBoundaries() {
    if (window.CAMOSCIO_REGIONS_GEOJSON) return;
    try {
        const res = await fetch('/api/regions/boundaries');
        const geojson = await res.json();
        window.CAMOSCIO_REGIONS_GEOJSON = geojson;

        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const region of Object.values(geojson)) {
            const ringsSets = region.type === 'Polygon' ? [region.coordinates] : region.coordinates;
            for (const rings of ringsSets) {
                for (const ring of rings) {
                    for (const [lng, lat] of ring) {
                        if (lat < minLat) minLat = lat;
                        if (lat > maxLat) maxLat = lat;
                        if (lng < minLng) minLng = lng;
                        if (lng > maxLng) maxLng = lng;
                    }
                }
            }
        }
        window.CAMOSCIO_REGION_BOUNDS = { minLat, maxLat, minLng, maxLng };
    } catch (e) {
        console.error('Errore nel caricare i confini regionali reali, resto sul rettangolo approssimativo:', e);
    }
}

async function initMapModule() {
    // I confini reali servono gia' per il maxBounds qui sotto: si aspetta il loro
    // caricamento (una singola richiesta di rete leggera, ~65KB) prima di creare la mappa.
    await ensureRegionBoundaries();

    // Inizializza la mappa Leaflet, vincolata all'ambito geografico corrente
    const b = window.CAMOSCIO_REGION_BOUNDS;
    window.mapInstance = L.map('map', {
        maxBounds: [[b.minLat, b.minLng], [b.maxLat, b.maxLng]],
        maxBoundsViscosity: 1.0,
        minZoom: 7
    }).setView(defaultCenter, 9);

    // Carica i tiles da OpenTopoMap, Open Source (punto 39, vedi CAMOSCIO_TILE_URL sopra).
    // Layer "offline-aware" (Fase F, vedi public/js/offline-map.js): usa la cache
    // IndexedDB quando disponibile invece di riscaricare sempre dalla rete, e salva
    // ogni tile vista per l'uso offline futuro.
    const tileLayerFactory = window.createOfflineTileLayer || L.tileLayer;
    window.CamoscioTileLayer = tileLayerFactory(window.CAMOSCIO_TILE_URL, window.CAMOSCIO_TILE_OPTIONS).addTo(window.mapInstance);

    // Gruppi di marker per poterli pulire e ricreare facilmente
    reportMarkersGroup = L.layerGroup().addTo(window.mapInstance);
    peakMarkersGroup = L.layerGroup().addTo(window.mapInstance);

    // Crea il marker GPS dell'utente trascinabile (Simulazione)
    createUserGpsMarker();

    // Event listener per il click sulla mappa (per Waze crowdsourcing)
    window.mapInstance.on('click', onMapClick);

    // Se l'utente trascina la mappa a mano durante una registrazione, smette di essere
    // inseguito (altrimenti non potrebbe guardarsi intorno: ad ogni fix GPS la mappa
    // gli tornerebbe sotto i piedi). 'dragstart' scatta solo per il trascinamento umano,
    // non per i panTo/setView fatti dal codice: e' proprio la distinzione che serve qui.
    window.mapInstance.on('dragstart', () => {
        if (liveFollowEnabled) {
            liveFollowEnabled = false;
            updateRecenterButton();
        }
        // Stesso ragionamento per il puntino blu (punto 26): chi sposta la mappa con un dito
        // vuole guardare piu' in la', non essere riportato indietro al fix successivo.
        posFollowEnabled = false;
    });

    // Cambio di dimensioni della finestra o rotazione del telefono: senza questo Leaflet
    // continua a usare le misure vecchie e la mappa resta tagliata (rilevante ora che su
    // schermo stretto il layout si impila, vedi @media in styles.css - punto 9).
    window.addEventListener('resize', () => {
        if (window.mapInstance) window.mapInstance.invalidateSize();
    });

    // Carica i marker dei report Waze e i sentieri
    renderMapMarkers();

    // Inizializza eventi dei form
    setupMapForms();

    // Punto 26 - il puntino blu si disegna qui ogni volta che arriva una posizione, da
    // qualunque fonte (watch del modulo geolocation o fix del tracciamento in corso).
    if (window.CamoscioGeo) {
        window.CamoscioGeo.onPosizione(aggiornaPuntinoPosizione);

        // Se la sezione Mappa e' GIA' aperta quando initMapModule finisce, il puntino va
        // acceso adesso: nessuno passera' piu' da navigateTo. E' la stessa finestra temporale
        // del bug gia' documentato in cronologia.txt (interfaccia visibile ma moduli non ancora
        // pronti), che su Render - dove il servizio gratuito si risveglia con calma - dura
        // abbastanza da incontrarla davvero.
        const sezione = document.getElementById('map-section');
        if (sezione && sezione.classList.contains('active')) {
            window.CamoscioGeo.accendi(true);
        }
    }
}

// Crea e gestisce il marker della posizione GPS simulata
function createUserGpsMarker() {
    const userIcon = L.divIcon({
        className: 'user-gps-leaflet-marker',
        html: `<div style="font-size: 2rem; filter: drop-shadow(0 0 5px rgba(193,102,46,0.8));">🥾</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    userGpsMarker = L.marker([userSimulatedLocation.lat, userSimulatedLocation.lng], {
        draggable: true,
        icon: userIcon
    }).addTo(window.mapInstance);

    userGpsMarker.bindTooltip("<b>Tu (Tracciamento GPS)</b><br>Trascina il marker per spostarti sui sentieri", {
        permanent: false,
        direction: 'top'
    });

    // Quando l'utente sposta il marker, controlliamo il geofencing delle vette
    userGpsMarker.on('dragend', function (event) {
        const position = userGpsMarker.getLatLng();
        window.userSimulatedLocation = { lat: position.lat, lng: position.lng };
        
        // Se il modulo mesh simulator radar è attivo, aggiorna la posizione anche lì
        if (window.updateRadarPosition) {
            window.updateRadarPosition(userSimulatedLocation);
        }

        checkGeofencing(position.lat, position.lng);
    });
}

// Sposta il marker GPS via codice (usato quando si clicca su una cima o trailhead)
function teleportUserGps(lat, lng) {
    window.userSimulatedLocation = { lat, lng };
    if (userGpsMarker) {
        userGpsMarker.setLatLng([lat, lng]);
        window.mapInstance.panTo([lat, lng]);
        checkGeofencing(lat, lng);
    }
}

// Aggiorna la posizione del marker con un fix GPS REALE durante un tracciamento live
// (Fase F): a differenza di teleportUserGps NON ricentra la mappa ad ogni fix (arriva
// un aggiornamento ogni pochi secondi, ricentrare sempre impedirebbe all'utente di
// guardarsi intorno sulla mappa mentre cammina).
function updateLiveGpsPosition(lat, lng, recenter = false) {
    window.userSimulatedLocation = { lat, lng };
    if (!userGpsMarker) {
        createUserGpsMarker();
    }
    userGpsMarker.setLatLng([lat, lng]);

    // Con l'inseguimento attivo la mappa scorre da sola dietro al segnaposto: e' questo
    // che mancava al punto 11 (vedi commento in cima al file). Resta comunque possibile
    // guardarsi intorno: appena si trascina la mappa a mano l'inseguimento si spegne
    // (evento 'dragstart', vedi initMapModule) e compare il tasto "Ricentra su di me".
    if (window.mapInstance && (recenter || liveFollowEnabled)) {
        if (liveViewNeedsInitialCenter) {
            // Primo fix della registrazione: si arriva qui con la mappa ancora sulla vista
            // panoramica di partenza. Un panTo animato attraverserebbe mezza regione a
            // zoom 16 (lentissimo e inutile): meglio saltare direttamente sul posto.
            liveViewNeedsInitialCenter = false;
            window.mapInstance.setView([lat, lng], Math.max(window.mapInstance.getZoom(), LIVE_FOLLOW_ZOOM));
        } else {
            window.mapInstance.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
    }
    checkGeofencing(lat, lng);
}

// Inizio di una registrazione dal vivo: porta la mappa sulla posizione reale a uno zoom
// utile a piedi e accende l'inseguimento.
function beginLiveGpsView(lat, lng) {
    if (!window.mapInstance) return;

    // La mappa Leaflet viene creata all'avvio dell'app, quando la sezione Mappa e' ancora
    // display:none: in quel caso Leaflet memorizza dimensioni sbagliate finche' non riceve
    // un invalidateSize(). Finora quell'invalidateSize arrivava SOLO navigando alla Mappa
    // dalla barra laterale (app.js), ma una registrazione puo' partire da qualunque
    // sezione tramite il pulsante flottante: senza questa riga la mappa resterebbe
    // disallineata proprio durante l'escursione.
    window.mapInstance.invalidateSize();

    liveFollowEnabled = true;

    // Durante una registrazione VERA il segnaposto non deve piu' essere trascinabile:
    // trascinarlo significherebbe falsificare a mano la propria posizione mentre il GPS
    // la sta registrando (ed e' esattamente cio' che confondeva, vedi punto 11).
    if (userGpsMarker && userGpsMarker.dragging) userGpsMarker.dragging.disable();
    if (userGpsMarker) {
        userGpsMarker.unbindTooltip();
        userGpsMarker.bindTooltip("<b>Tu</b><br>Posizione GPS reale, registrazione in corso", {
            permanent: false, direction: 'top'
        });
    }

    if (typeof lat === 'number' && typeof lng === 'number') {
        liveViewNeedsInitialCenter = false;
        window.mapInstance.setView([lat, lng], Math.max(window.mapInstance.getZoom(), LIVE_FOLLOW_ZOOM));
    } else {
        // Nessuna posizione ancora nota (si e' appena premuto "Comincia registrazione" e il
        // primo fix GPS deve ancora arrivare): ci pensera' updateLiveGpsPosition.
        liveViewNeedsInitialCenter = true;
    }
    updateRecenterButton();
}

// Fine registrazione: si torna al comportamento normale (marker trascinabile per la
// simulazione/esplorazione, nessun inseguimento).
function endLiveGpsView() {
    liveFollowEnabled = false;
    if (userGpsMarker && userGpsMarker.dragging) userGpsMarker.dragging.enable();
    if (userGpsMarker) {
        userGpsMarker.unbindTooltip();
        userGpsMarker.bindTooltip("<b>Tu (Tracciamento GPS)</b><br>Trascina il marker per spostarti sui sentieri", {
            permanent: false, direction: 'top'
        });
    }
    updateRecenterButton();
}

// Riaccende l'inseguimento dopo che l'utente si e' guardato intorno spostando la mappa.
function recenterOnLiveGps() {
    liveFollowEnabled = true;
    const p = window.userSimulatedLocation;
    if (window.mapInstance && p) {
        window.mapInstance.setView([p.lat, p.lng], Math.max(window.mapInstance.getZoom(), LIVE_FOLLOW_ZOOM));
    }
    updateRecenterButton();
}

// Il tasto "Ricentra su di me" ha senso solo mentre una registrazione e' in corso E
// l'utente ha spostato la mappa per conto suo.
function updateRecenterButton() {
    const btn = document.getElementById('btn-map-recenter');
    if (!btn) return;
    const recording = !!(window.CamoscioTrackingIsRecording && window.CamoscioTrackingIsRecording());
    btn.classList.toggle('hidden', !(recording && !liveFollowEnabled));
}

// --- Punto 26: il puntino blu della posizione reale ---
//
// Volutamente separato dal segnaposto 🥾: quello resta trascinabile (serve a simulare di
// essere a una vetta per provare i timbri, vedi checkGeofencing) e verrebbe reso inutilizzabile
// se il GPS glielo spostasse sotto le dita ad ogni fix. Qui invece si mostra e basta.

function aggiornaPuntinoPosizione(lat, lng, precisioneM) {
    if (!window.mapInstance) return;

    if (!posLayerGroup) {
        posLayerGroup = L.layerGroup().addTo(window.mapInstance);
    }

    // Il cerchio si disegna con la precisione VERA dichiarata dal telefono, non con un
    // raggio fisso: in montagna passa spesso da 5 a 60 metri, e far credere a una precisione
    // che non c'e' e' peggio che non mostrare niente, proprio nella schermata dove uno decide
    // dove mettere i piedi. Se il telefono non la dichiara, il cerchio non si disegna.
    const raggio = (typeof precisioneM === 'number' && precisioneM > 0) ? precisioneM : null;

    const primoFix = !posDotMarker;

    if (primoFix) {
        posAccuracyCircle = L.circle([lat, lng], {
            radius: raggio || 0,
            color: POS_DOT_COLOR,
            weight: 1,
            opacity: 0.5,
            fillColor: POS_DOT_COLOR,
            fillOpacity: 0.15,
            interactive: false // il cerchio non deve rubare i click destinati alla mappa
        }).addTo(posLayerGroup);

        posDotMarker = L.circleMarker([lat, lng], {
            radius: 7,
            color: '#FFFFFF',   // bordo bianco: si stacca sia dal verde dei boschi che dal grigio delle rocce
            weight: 3,
            fillColor: POS_DOT_COLOR,
            fillOpacity: 1,
            interactive: false
        }).addTo(posLayerGroup);
    } else {
        posDotMarker.setLatLng([lat, lng]);
        posAccuracyCircle.setLatLng([lat, lng]);
        posAccuracyCircle.setRadius(raggio || 0);
    }

    posAccuracyCircle.setStyle({ opacity: raggio ? 0.5 : 0, fillOpacity: raggio ? 0.15 : 0 });

    // Durante una registrazione l'inseguimento e' gia' di beginLiveGpsView/updateLiveGpsPosition
    // (punto 11): due inseguimenti insieme farebbero litigare due panTo sullo stesso fix.
    const registrando = !!(window.CamoscioTrackingIsRecording && window.CamoscioTrackingIsRecording());

    // Al PRIMO fix la mappa va portata sul puntino, altrimenti non serve a niente: la mappa
    // nasce a zoom 9 con tutta l'Italia centrale in uno schermo, e il puntino resta un
    // granello fuori dallo schermo. E' lo stesso inganno del punto 11 ("il segnaposto non si
    // muove": si muoveva, ma di tre pixel).
    // Si sposta la vista SOLO se la mappa e' ancora sulla panoramica di partenza (zoom <= 10):
    // se l'utente ha ingrandito una zona, o e' arrivato qui dal tasto "Mappa" di una scheda
    // escursione che ha appena inquadrato il percorso, il puntino non deve rubargli la vista.
    // Ci si centra UNA VOLTA, senza accendere l'inseguimento. Sono due cose diverse e va
    // tenuta la distinzione: chi apre la mappa vuole vedere dove si trova, ma non vuole una
    // mappa che gli scorre sotto le dita mentre guarda il sentiero piu' avanti. Da qui in
    // poi l'inseguimento lo si chiede col tasto della posizione.
    // (In piu', accenderlo qui renderebbe il PRIMO tocco del tasto uno spegnimento - vedi
    // useRealGpsPosition -, cioe' esattamente il contrario di quello che uno si aspetta.)
    if (primoFix && !registrando && window.mapInstance.getZoom() <= 10) {
        window.mapInstance.setView([lat, lng], LIVE_FOLLOW_ZOOM);
        return;
    }

    if (posFollowEnabled && !registrando) {
        window.mapInstance.panTo([lat, lng], { animate: true, duration: 0.5 });
    }
}

function rimuoviPuntinoPosizione() {
    if (posLayerGroup) {
        posLayerGroup.clearLayers();
        window.mapInstance.removeLayer(posLayerGroup);
    }
    posLayerGroup = null;
    posDotMarker = null;
    posAccuracyCircle = null;
    posFollowEnabled = false;
}

// Porta la mappa sul puntino. Usa lo stesso zoom da camminata del punto 11: piu' lontano di
// cosi' (la mappa nasce a zoom 9) un passo si sposta di frazioni di pixel e sembra tutto fermo.
function centraSuPuntino() {
    const p = window.CamoscioGeo && window.CamoscioGeo.ultimaPosizione();
    if (!p || !window.mapInstance) return false;
    posFollowEnabled = true;
    window.mapInstance.setView([p.lat, p.lng], Math.max(window.mapInstance.getZoom(), LIVE_FOLLOW_ZOOM));
    return true;
}

// Percorso REALMENTE registrato durante un'escursione dal vivo (Fase F) - stile diverso
// dal percorso "pianificato" (hikePolyline, verde) per restare distinguibili se visibili insieme.
function resetLiveTrackPolyline() {
    if (liveTrackPolyline) {
        window.mapInstance.removeLayer(liveTrackPolyline);
    }
    // Punto 14 di cose_da_fare.txt: il percorso realmente camminato si disegna con una
    // linea BLU CHIARA continua (prima era arancione tratteggiata). Il tratteggio faceva
    // sembrare la traccia "provvisoria"; qui invece sono i punti dove si e' passati
    // davvero. Blu chiaro = schiarita di --accent-blue (#4C7E90, blu lago alpino della
    // palette montagna, vedi :root in styles.css e --accent-blue-light li' accanto):
    // resta in famiglia con la palette e si stacca bene dal verde del percorso
    // pianificato e dall'arancione degli accenti.
    liveTrackPolyline = L.polyline([], {
        color: '#7FB5C7',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(window.mapInstance);
}

function addLiveTrackPoint(lat, lng) {
    if (!liveTrackPolyline) resetLiveTrackPolyline();
    liveTrackPolyline.addLatLng([lat, lng]);
}

function clearLiveTrackPolyline() {
    if (liveTrackPolyline) {
        window.mapInstance.removeLayer(liveTrackPolyline);
        liveTrackPolyline = null;
    }
}

// Rileva se il marker GPS è vicino a vette o rifugi per sbloccare i timbri
function checkGeofencing(lat, lng) {
    const db = window.CamoscioState;
    let foundNearPeak = null;
    let distance = Infinity;

    // PUNTO 18: i punti timbrabili arrivano dal catalogo dei badge, non piu' solo dalle
    // vette elencate dentro le escursioni. Il catalogo COMPRENDE gia' quelle vette (vedi
    // catalogo() in badges.js), quindi non si perde niente di quello che si sbloccava
    // prima; si aggiungono le cime e i rifugi della pagina Badge, che altrimenti sarebbero
    // rimasti impossibili da conquistare - un badge che il sito mostra ma che non si puo'
    // prendere e' una promessa che non puo' mantenere.
    // Se badges.js non fosse caricato si torna alle sole vette delle escursioni, cioe' al
    // comportamento di prima: meglio meno timbri che una schermata mappa rotta.
    const puntiTimbrabili = window.CamoscioBadges
        ? window.CamoscioBadges.puntiTimbrabili()
        : (db.hikes || []).flatMap(h => h.peaks || []);

    puntiTimbrabili.forEach(peak => {
        const dist = calculateDistance(lat, lng, peak.lat, peak.lng);
        // Il piu' vicino, non l'ultimo trovato: con piu' punti in elenco (rifugio e cima
        // possono stare a poche centinaia di metri, es. Franchetti e Corno Grande) l'ordine
        // dell'array avrebbe deciso quale timbro proporre.
        if (dist < 150 && dist < distance) { // Distanza in metri per sbloccare (150m)
            foundNearPeak = peak;
            distance = dist;
        }
    });

    if (foundNearPeak) {
        const stampId = foundNearPeak.stampId;
        const alreadyHasStamp = db.stamps.some(s => s.stampId === stampId);

        if (alreadyHasStamp) {
            userGpsMarker.bindPopup(`
                <div style="color: white; font-family: inherit;">
                    <h5 style="margin: 0 0 6px 0;">📍 ${foundNearPeak.name}</h5>
                    <p style="font-size: 0.8rem; margin: 0;">Hai già collezionato questo timbro del passaporto!</p>
                </div>
            `).openPopup();
        } else {
            userGpsMarker.bindPopup(`
                <div style="color: white; font-family: inherit; text-align: center;">
                    <h4 style="margin: 0 0 4px 0;">🎉 Vetta Raggiunta!</h4>
                    <h5 style="margin: 0 0 8px 0; color: #C1662E;">${foundNearPeak.name} (${foundNearPeak.altitude}m)</h5>
                    <p style="font-size: 0.8rem; margin: 0 0 10px 0;">Sei a soli ${Math.round(distance)}m dalla cima.</p>
                    <button class="btn btn-sm btn-primary" onclick="unlockStampDirectly('${stampId}', '${foundNearPeak.name}')">TIMBRA PASSAPORTO</button>
                </div>
            `).openPopup();
        }
    } else {
        userGpsMarker.closePopup();
    }
}

// Funzione globale per poter essere chiamata dal popup Leaflet
window.unlockStampDirectly = async function(stampId, peakName) {
    const usr = window.CamoscioState.currentUser;
    if (!usr) return;

    try {
        const response = await fetch('/api/stamps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: usr.id, stampId })
        });
        
        if (response.ok) {
            // Rinfresca lo stato globale
            await window.CamoscioState.stamps.push({
                userId: usr.id,
                stampId,
                dateUnlocked: new Date().toISOString().split('T')[0]
            });
            
            userGpsMarker.bindPopup(`
                <div style="color: white; text-align: center;">
                    <h4>Timbro Sbloccato! 🏆</h4>
                    <p style="font-size: 0.8rem; margin-top: 6px;">Il passaporto delle vette per <b>${peakName}</b> è stato timbrato con successo!</p>
                </div>
            `).openPopup();

            // Aggiorna la dashboard se aperta
            if (document.getElementById("dashboard").classList.contains("active")) {
                window.renderDashboardStamps();
            }
        }
    } catch (e) {
        console.error("Errore nello sblocco del timbro:", e);
    }
};

// Calcolo distanza tramite formula Haversine (Open Source standard)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // raggio terrestre in metri
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// Click sulla mappa per segnalare anomalia (Waze)
function onMapClick(e) {
    // Punto 13: mentre si sta progettando un percorso, il click sulla mappa serve ad
    // aggiungere una tappa, non ad aprire il modulo delle segnalazioni. Il progettista
    // dice lui se ha preso il click: cosi' i due usi della mappa non si pestano i piedi
    // e qui non serve sapere niente di come funziona.
    if (window.CamoscioRoutePlanner && window.CamoscioRoutePlanner.gestisciClickMappa(e)) return;

    const formContainer = document.getElementById("waze-form-container");
    if (!formContainer) return;

    formContainer.classList.remove("hidden");
    
    // Memorizza le coordinate cliccate nei campi temporanei o negli attributi del form
    formContainer.setAttribute("data-clicked-lat", e.latlng.lat);
    formContainer.setAttribute("data-clicked-lng", e.latlng.lng);

    // Sposta la visualizzazione della mappa leggermente per far spazio
    window.mapInstance.panTo(e.latlng);
}

// Configura i form relativi alla mappa
function setupMapForms() {
    // Form Waze
    const form = document.getElementById("waze-report-form");
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formContainer = document.getElementById("waze-form-container");
            const lat = parseFloat(formContainer.getAttribute("data-clicked-lat"));
            const lng = parseFloat(formContainer.getAttribute("data-clicked-lng"));
            
            const type = document.getElementById("waze-type").value;
            const desc = document.getElementById("waze-desc").value;

            if (isNaN(lat) || isNaN(lng)) return;

            try {
                const response = await fetch('/api/reports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, lat, lng, description: desc })
                });

                if (response.ok) {
                    form.reset();
                    formContainer.classList.add("hidden");

                    // Punto 45: non e' piu' pubblicata subito (status 'pending' lato server) -
                    // vincolo hard "niente promesse che il sito non puo' mantenere", chi segnala
                    // deve saperlo subito, non scoprirlo non vedendola comparire in mappa.
                    window.showToast("Segnalazione inviata: comparirà in mappa dopo una verifica.", "success");

                    // Ricarica i marker
                    await refreshState();
                    renderMapMarkers();
                    renderWazeReportsList();
                }
            } catch (e) {
                console.error("Errore nell'invio del report:", e);
            }
        });
    }

    const btnCancel = document.getElementById("btn-waze-cancel");
    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            document.getElementById("waze-form-container").classList.add("hidden");
        });
    }

    // Punto 27 - qui c'erano i due tasti fissi "Gran Sasso" e "Monte Vettore" del riquadro
    // meteo. Non sceglievano affatto un punto meteo: caricavano l'escursione col titolo
    // corrispondente, e il meteo si aggiornava di rimbalzo da loadActiveHikeOnMap. Il
    // risultato era che il meteo si poteva vedere solo su quei due posti.
    // Ora il punto lo si sceglie con una barra di ricerca (vedi weather.js), e caricare
    // un'escursione sulla mappa resta possibile dalle sue schede (social.js -> loadActiveHikeOnMap),
    // che continua ad aggiornare il meteo esattamente come prima.

    // Pulsante posizione GPS reale (aggiuntivo, il marker trascinabile resta il sistema principale)
    const btnRealGps = document.getElementById("btn-use-real-gps");
    if (btnRealGps) {
        btnRealGps.addEventListener("click", useRealGpsPosition);
    }
}

// Punto 26 - il tasto in alto a destra e' quello che l'utente preme aspettandosi di vedere
// "dove sono": e' diventato il comando del puntino blu, invece di aggiungere un terzo
// pulsante flottante che su uno schermo da 390px avrebbe affollato l'angolo.
// Un solo tasto, tre situazioni - lo stesso giro delle app di mappe, che si impara premendo
// invece di doverlo spiegare:
//  - spento              -> accende, chiede il permesso (o spiega come si sblocca) e centra;
//  - acceso, mappa spostata a mano -> ricentra sul puntino;
//  - acceso e gia' centrato        -> spegne il puntino.
// In tutti i casi porta il segnaposto 🥾 sulla posizione reale UNA VOLTA SOLA, come faceva
// prima: cosi' il geofencing delle vette continua a funzionare identico, senza pero' litigare
// col trascinamento manuale (che invece un inseguimento continuo renderebbe impossibile).
async function useRealGpsPosition() {
    const btn = document.getElementById("btn-use-real-gps");
    if (!window.CamoscioGeo) return;

    if (window.CamoscioGeo.isAcceso() && window.CamoscioGeo.ultimaPosizione()) {
        if (posFollowEnabled) {
            window.CamoscioGeo.spegni();
        } else {
            centraSuPuntino(); // l'utente si era guardato intorno: riportalo su di se'
        }
        return;
    }

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader"></i> Localizzazione in corso...`;
    if (window.lucide) window.lucide.createIcons();

    // automatico=false: qui l'utente ha chiesto esplicitamente la posizione, quindi si puo'
    // far comparire il riquadro del permesso e, se e' bloccato, la guida per sbloccarlo.
    const acceso = await window.CamoscioGeo.accendi(false);

    btn.disabled = false;
    btn.innerHTML = originalLabel;
    if (window.lucide) window.lucide.createIcons();
    aggiornaTastoPosizione(window.CamoscioGeo.isAcceso());

    if (!acceso) return;

    // Il primo fix puo' arrivare qualche istante dopo: si aspetta quello per centrare, invece
    // di lasciare la mappa dov'era facendo credere che il tasto non abbia fatto niente.
    const posizione = window.CamoscioGeo.ultimaPosizione();
    if (posizione) {
        centraSuPuntino();
        teleportUserGps(posizione.lat, posizione.lng);
    } else {
        attendiPrimoFix();
    }
}

// Aspetta il primo fix per centrare la mappa, ma non all'infinito: se il GPS non aggancia si
// dice, invece di lasciare l'utente a fissare una mappa che non si muove.
function attendiPrimoFix() {
    let fatto = false;
    let disiscrivi = null;

    const chiudi = () => {
        fatto = true;
        if (disiscrivi) disiscrivi();
    };

    const scadenza = setTimeout(() => {
        if (fatto) return;
        chiudi();
        window.showToast("Sto ancora cercando il segnale GPS: appena arriva, il puntino comparirà da solo.", "info");
    }, 6000);

    disiscrivi = window.CamoscioGeo.onPosizione((lat, lng) => {
        if (fatto) return;
        chiudi();
        clearTimeout(scadenza);
        centraSuPuntino();
        teleportUserGps(lat, lng);
    });
}

// Stato visibile del tasto. Lo sfondo pieno scuro non e' un vezzo: i pulsanti appoggiati
// sopra la mappa non possono usare il semitrasparente di .btn-secondary, che sulle tile
// chiare di OpenStreetMap diventa illeggibile (difetto gia' trovato e corretto una volta,
// vedi il commento accanto a .map-gps-real-btn in styles.css).
function aggiornaTastoPosizione(acceso) {
    const btn = document.getElementById("btn-use-real-gps");
    if (!btn) return;
    btn.classList.toggle("is-active", !!acceso);
    btn.innerHTML = acceso
        ? `<i data-lucide="locate-fixed"></i> La mia posizione`
        : `<i data-lucide="locate"></i> Dove sono`;
    btn.title = acceso
        ? "La tua posizione è sulla mappa: tocca per ricentrarti, tocca di nuovo da centrato per nasconderla"
        : "Mostra la tua posizione reale sulla mappa";
    if (window.lucide) window.lucide.createIcons();
}

// Disegna sulla mappa TUTTI i punti che fanno scattare un timbro (cime e rifugi del
// catalogo dei badge, punto 18).
//
// Perche' esiste questa funzione: lo stesso blocco era scritto DUE VOLTE, in
// renderMapMarkers e in loadHikeOnMap, e le due copie avevano gia' cominciato a
// divergere - in una il nome della vetta passava da escapeHtml, nell'altra finiva
// dentro innerHTML cosi' com'era. Un nome di vetta arriva dal database e lo scrive il
// creatore dell'escursione: e' esattamente il buco XSS chiuso ovunque in Fase H,
// rimasto aperto in quella copia perche' era una copia. Una funzione sola non puo'
// avere questo problema.
//
// Perche' ora si disegnano tutti i punti e non solo le vette dell'escursione attiva:
// sono i punti del PASSAPORTO, non tappe del percorso. Prima meta' dei badge sarebbe
// stata invisibile proprio sulla mappa dove la si conquista, e trascinando il
// segnaposto sarebbe comparso un "Vetta Raggiunta!" in un punto dove non c'era niente
// da vedere.
function drawStampablePoints() {
    if (!peakMarkersGroup) return;
    peakMarkersGroup.clearLayers();

    const db = window.CamoscioState;
    const punti = window.CamoscioBadges
        ? window.CamoscioBadges.puntiTimbrabili()
        : (db.hikes || []).flatMap(h => h.peaks || []);

    punti.forEach(peak => {
        if (!Number.isFinite(peak.lat) || !Number.isFinite(peak.lng)) return;

        const peakIcon = L.divIcon({
            className: 'peak-leaflet-marker',
            html: `<div style="font-size: 1.6rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #4C7E90; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">🏔️</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([peak.lat, peak.lng], { icon: peakIcon });
        const isUnlocked = db.stamps.some(s => s.stampId === peak.stampId);

        marker.bindPopup(`
            <div style="color: white; font-family: inherit; text-align: center;">
                <h5 style="margin: 0 0 4px 0;">📍 ${escapeHtml(peak.name)}</h5>
                ${Number.isFinite(peak.altitude)
                    ? `<p style="font-size: 0.8rem; margin: 0 0 6px 0;">Altitudine: <b>${peak.altitude}m</b></p>`
                    : ''}
                <span class="badge ${isUnlocked ? 'badge-green' : 'badge-accent'}">
                    ${isUnlocked ? 'Timbro Collezionato ✓' : 'Timbro non Sbloccato'}
                </span>
                <br><br>
                <button class="btn btn-sm btn-secondary" onclick="teleportUserGps(${peak.lat}, ${peak.lng})">Teletrasporta GPS qui</button>
            </div>
        `);

        peakMarkersGroup.addLayer(marker);
    });
}

// Render dei marker sulla mappa (Waze reports + Vette e Rifugi)
function renderMapMarkers() {
    if (!window.mapInstance) return;

    // Svuota i gruppi precedenti
    reportMarkersGroup.clearLayers();
    peakMarkersGroup.clearLayers();

    const db = window.CamoscioState;

    // Disegna pericoli Waze
    db.reports.forEach(rep => {
        if (rep.status !== 'active') return;

        const emoji = window.CamoscioReportTypes.emoji[rep.type] || '⚠️';
        const title = window.CamoscioReportTypes.title[rep.type] || 'Avviso';

        const customIcon = L.divIcon({
            className: 'waze-leaflet-marker',
            html: `<div style="font-size: 1.8rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #A83B2E; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">${emoji}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        const marker = L.marker([rep.lat, rep.lng], { icon: customIcon });
        
        marker.bindPopup(`
            <div style="color: white; font-family: inherit;">
                <h5 style="margin: 0 0 4px 0; color: #A83B2E;">${title}</h5>
                <p style="font-size: 0.8rem; margin: 0 0 8px 0;">${escapeHtml(rep.description)}</p>
                <span class="small text-muted">Segnalato il: ${new Date(rep.createdAt).toLocaleDateString()}</span>
            </div>
        `);
        
        reportMarkersGroup.addLayer(marker);
    });

    // Disegna cime e rifugi timbrabili (vedi drawStampablePoints)
    drawStampablePoints();
}

// Render della lista segnalazioni nella sidebar mappa
function renderWazeReportsList() {
    const container = document.getElementById("waze-list-container");
    if (!container) return;

    const db = window.CamoscioState;
    container.innerHTML = "";

    const activeReports = db.reports.filter(r => r.status === 'active');

    if (activeReports.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessuna segnalazione attiva sui sentieri.</div>`;
        return;
    }

    activeReports.forEach(rep => {
        const item = document.createElement("div");
        item.className = "waze-item";

        const emoji = window.CamoscioReportTypes.emoji[rep.type] || '⚠️';

        item.innerHTML = `
            <span>${emoji}</span>
            <div class="waze-item-desc">
                <strong>${escapeHtml(rep.description)}</strong>
                <div class="text-muted small">Coord: ${rep.lat.toFixed(3)}, ${rep.lng.toFixed(3)}</div>
            </div>
            <button class="waze-item-resolve" onclick="resolveReportDirectly('${rep.id}')" title="Risolvi segnalazione">✓</button>
        `;
        container.appendChild(item);
    });
}

// Segna un report come risolto sul server (aggiorna l'originale, non ne crea uno nuovo)
window.resolveReportDirectly = async function(reportId) {
    const db = window.CamoscioState;
    const index = db.reports.findIndex(r => r.id === reportId);
    if (index !== -1) {
        db.reports[index].status = 'resolved';
        try {
            await fetch(`/api/reports/${reportId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'resolved' })
            });
        } catch(e) {}

        renderMapMarkers();
        renderWazeReportsList();
    }
};

// Carica e disegna un percorso specifico sulla mappa
function loadActiveHikeOnMap(hikeId) {
    if (!window.mapInstance) return;

    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    // Questa è ora l'escursione attiva anche per Zaino Intelligente e Carpooling
    db.activeHikeId = hikeId;

    // Centra mappa sul ritrovo
    window.mapInstance.setView([hike.trailhead.lat, hike.trailhead.lng], 13);

    // Pulisce sentiero precedente
    if (hikePolyline) {
        window.mapInstance.removeLayer(hikePolyline);
    }

    // Segna il punto di ritrovo deciso per l'escursione - prima la mappa si limitava a
    // centrarsi li' sopra senza mostrare alcun segnaposto. Stesso stile gia' in uso per
    // vette (drawStampablePoints) e segnalazioni (renderMapMarkers): cerchio scuro con
    // l'emoji dentro, via L.divIcon.
    if (trailheadMarker) {
        window.mapInstance.removeLayer(trailheadMarker);
    }
    if (Number.isFinite(hike.trailhead.lat) && Number.isFinite(hike.trailhead.lng)) {
        const trailheadIcon = L.divIcon({
            className: 'trailhead-leaflet-marker',
            html: `<div style="font-size: 1.6rem; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50%; border: 1.5px solid #4C7A44; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">📍</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        trailheadMarker = L.marker([hike.trailhead.lat, hike.trailhead.lng], { icon: trailheadIcon })
            .addTo(window.mapInstance)
            .bindPopup(`
                <div style="color: white; font-family: inherit; text-align: center;">
                    <h5 style="margin: 0 0 4px 0;">📍 Punto di ritrovo</h5>
                    ${hike.trailhead.name ? `<span>${escapeHtml(hike.trailhead.name)}</span>` : ''}
                </div>
            `)
            .openPopup();
    }

    // Genera un percorso fittizio ma sensato attorno al trailhead
    // Per far vedere l'algoritmo di esposizione solare, creiamo segmenti Nord e Sud
    const centerLat = hike.trailhead.lat;
    const centerLng = hike.trailhead.lng;

    activeHikePath = [
        [centerLat - 0.02, centerLng - 0.02], // Base
        [centerLat - 0.01, centerLng - 0.015], // Salita versante Nord (Ombreggiato)
        [centerLat, centerLng], // Rifugio / Punto intermedio
        [centerLat + 0.01, centerLng + 0.01], // Cresta soleggiata
        [centerLat + 0.02, centerLng + 0.015] // Cima (Versante Sud)
    ];

    // Se l'utente vuole l'esposizione solare, coloriamo il sentiero in modo speciale
    // Altrimenti lo coloriamo di verde foresta standard
    hikePolyline = L.polyline(activeHikePath, {
        color: '#4C7A44',
        weight: 6,
        opacity: 0.8
    }).addTo(window.mapInstance);

    // Sposta il marker GPS dell'utente alla partenza
    teleportUserGps(activeHikePath[0][0], activeHikePath[0][1]);

    // Rigenera i marker dei punti timbrabili (era la seconda copia dello stesso blocco,
    // quella dove il nome della vetta non passava da escapeHtml - vedi drawStampablePoints)
    drawStampablePoints();

    // Aggiorna consigli esposizione solare nella sidebar della mappa
    renderSolarExposureAdvice(hike);
    
    // Trigger aggiornamento meteo multi-quota
    if (window.fetchWeatherForCoords) {
        window.fetchWeatherForCoords(hike.trailhead.lat, hike.trailhead.lng, hike.title);
    }
}

// Calcola l'orientamento iniziale (bearing) in gradi (0-360) da un punto A ad un punto B
function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = deg => deg * Math.PI / 180;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const bearingRad = Math.atan2(y, x);

    return (bearingRad * 180 / Math.PI + 360) % 360;
}

// Classifica un orientamento in uno degli 8 settori cardinali
function bearingToCompassSector(bearing) {
    const sectors = [
        { label: "Nord", key: "N" }, { label: "Nord-Est", key: "NE" },
        { label: "Est", key: "E" }, { label: "Sud-Est", key: "SE" },
        { label: "Sud", key: "S" }, { label: "Sud-Ovest", key: "SW" },
        { label: "Ovest", key: "W" }, { label: "Nord-Ovest", key: "NW" }
    ];
    const index = Math.round(bearing / 45) % 8;
    return sectors[index];
}

// Algoritmo di consiglio esposizione solare: orientamento reale trailhead->cima + stagione,
// generalizzato a qualunque escursione (non più legato a id fissi). Un vero calcolo di pendenza
// da modello digitale del terreno resta fuori scope: qui si usa l'orientamento come proxy.
function renderSolarExposureAdvice(hike) {
    const adviceBox = document.getElementById("sun-advice-box");
    if (!adviceBox) return;

    const month = new Date().getMonth(); // 0 = Gen, 6 = Lug
    const isSummer = (month >= 5 && month <= 8); // Giugno - Settembre

    if (!hike.peaks || hike.peaks.length === 0) {
        adviceBox.className = "sun-advice-box info";
        adviceBox.innerHTML = `Nessuna vetta registrata per questo percorso: impossibile stimare l'orientamento del versante. Valuta comunque partenze anticipate nei mesi estivi per evitare le ore più calde.`;
        return;
    }

    // Usa l'orientamento verso l'ultima cima registrata (tipicamente la vetta principale)
    const summit = hike.peaks[hike.peaks.length - 1];
    const bearing = calculateBearing(hike.trailhead.lat, hike.trailhead.lng, summit.lat, summit.lng);
    const sector = bearingToCompassSector(bearing);
    const isNorthFacing = ["N", "NE", "NW"].includes(sector.key);
    const isGlacierRisk = hike.maxAltitude > 3500;

    let html = "";
    if (isGlacierRisk) {
        adviceBox.className = "sun-advice-box summer";
        html = `<strong>❄️ Alta Quota: Riflesso Ghiacciaio Elevato (versante ${sector.label})</strong><br>
            A quota superiore a 3500m l'esposizione solare è massima. Obbligo di occhiali da sole categoria 4 e crema protettiva. Attenzione al riscaldamento del ghiacciaio dalle ore 12:00 che rende instabili i ponti di neve.`;
    } else if (isSummer && !isNorthFacing) {
        adviceBox.className = "sun-advice-box summer";
        html = `<strong>☀️ Consiglio Estivo: Versante ${sector.label}, esposizione elevata</strong><br>
            Il percorso verso la cima è orientato a ${sector.label} e si scalda rapidamente nelle ore centrali. Si raccomanda la partenza entro le 07:00 per evitare colpi di calore e attenzione al rischio fulmini pomeridiano.`;
    } else if (isSummer && isNorthFacing) {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>🌲 Consiglio Estivo: Versante ${sector.label}, più ombreggiato</strong><br>
            Il percorso verso la cima è orientato a ${sector.label}: resta più fresco anche nelle ore centrali, ma può trattenere neve o ghiaccio residuo più a lungo negli avvallamenti. Portare comunque protezione solare per i tratti allo scoperto.`;
    } else if (!isSummer && !isNorthFacing) {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>❄️ Consiglio Stagionale: Versante ${sector.label}, massimizza la luce</strong><br>
            Si consiglia di effettuare la salita nelle ore centrali (10:00 - 14:00) sfruttando il versante ${sector.label} per beneficiare del soleggiamento.`;
    } else {
        adviceBox.className = "sun-advice-box info";
        html = `<strong>❄️ Consiglio Stagionale: Versante ${sector.label}, rischio ghiaccio</strong><br>
            Il percorso verso la cima è orientato a ${sector.label}, poco soleggiato in questa stagione: valuta ramponcini/bastoncini e un rientro non troppo tardivo per il rischio di ghiaccio improvviso.`;
    }

    adviceBox.innerHTML = html;
}

// Collegamento globale per inizializzatore
window.renderMapMarkers = renderMapMarkers;
window.renderWazeReportsList = renderWazeReportsList;
window.loadActiveHikeOnMap = loadActiveHikeOnMap;
window.teleportUserGps = teleportUserGps;
window.updateLiveGpsPosition = updateLiveGpsPosition;
window.resetLiveTrackPolyline = resetLiveTrackPolyline;
window.addLiveTrackPoint = addLiveTrackPoint;
window.clearLiveTrackPolyline = clearLiveTrackPolyline;
window.beginLiveGpsView = beginLiveGpsView;
window.endLiveGpsView = endLiveGpsView;
window.recenterOnLiveGps = recenterOnLiveGps;
window.updateRecenterButton = updateRecenterButton;
// Punto 26 - puntino blu della posizione reale
window.rimuoviPuntinoPosizione = rimuoviPuntinoPosizione;
window.aggiornaTastoPosizione = aggiornaTastoPosizione;
window.centraSuPuntino = centraSuPuntino;
