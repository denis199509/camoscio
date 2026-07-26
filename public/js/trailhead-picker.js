// Punto 8 di cose_da_fare.txt - scelta del punto di ritrovo per NOME o dalla MAPPA,
// invece di scrivere latitudine e longitudine a mano.
//
// Due strade, come richiesto:
//  1) si scrive un nome ("Campo Imperatore") e il sistema lo trova;
//  2) si preme l'icona della mappa, si apre la mappa vera e si sceglie il punto col dito.
// In entrambi i casi, se vicino c'e' un luogo con un nome conosciuto quel nome diventa il
// riferimento (piu' comprensibile delle coordinate per chi comincia); se non c'e' niente
// intorno restano le coordinate, con un pulsante per copiarle e incollarle su Google Maps.
//
// Le chiamate ai servizi di ricerca passano SEMPRE dal nostro server (/api/geocoding/*),
// mai direttamente dal browser: vedi il commento in cima a routes/geocoding.js per il
// perche' (policy Nominatim sullo User-Agent e limite di 1 richiesta al secondo).

let pickerMap = null;          // mappa Leaflet della finestra di scelta
let pickerMarker = null;
let pickerPoint = null;        // { lat, lng, nome, contesto }
let searchDebounce = null;
let searchSeq = 0;             // scarta le risposte arrivate fuori ordine

const MIN_CHARS = 3;
const DEBOUNCE_MS = 450;       // non una richiesta per tastierata: si aspetta la pausa

// --- Stato del punto scelto, mostrato sotto la barra di ricerca ---

function setTrailhead(lat, lng, nome, contesto, distanzaM) {
    pickerPoint = { lat, lng, nome, contesto };

    document.getElementById('hike-trailhead-lat').value = lat;
    document.getElementById('hike-trailhead-lng').value = lng;

    // Il campo "come chiamare il ritrovo" si compila da solo ma resta modificabile:
    // il nome trovato in automatico e' un suggerimento, non un obbligo.
    const campoNome = document.getElementById('hike-trailhead-name');
    if (campoNome && nome) campoNome.value = nome;

    const box = document.getElementById('trailhead-chosen');
    const nomeEl = document.getElementById('trailhead-chosen-name');
    const ctxEl = document.getElementById('trailhead-chosen-context');
    const coordEl = document.getElementById('trailhead-chosen-coords-text');

    if (nome) {
        nomeEl.textContent = nome;
        // "a 102 m" spiega che il nome e' un riferimento vicino, non il punto esatto:
        // senza questa precisazione sembrerebbe che il ritrovo sia proprio li'.
        const vicinanza = (typeof distanzaM === 'number' && distanzaM > 0) ? ` (a ${distanzaM} m dal punto scelto)` : '';
        ctxEl.textContent = (contesto || '') + vicinanza;
    } else {
        // Caso previsto dal punto 8: nessun riferimento nei dintorni.
        nomeEl.textContent = 'Punto senza riferimenti vicini';
        ctxEl.textContent = 'Nessun luogo conosciuto nei paraggi: restano valide le coordinate qui sotto.';
    }

    coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    box.classList.remove('hidden');

    mostraAvvisoRegione(lat, lng);
}

// Le escursioni si possono creare solo dentro Marche, Lazio, Abruzzo, Molise: meglio
// dirlo subito qui che far fallire l'invio del modulo alla fine.
function mostraAvvisoRegione(lat, lng) {
    const avviso = document.getElementById('trailhead-warning');
    if (!avviso) return;
    const dentro = !window.CamoscioIsInRegion || window.CamoscioIsInRegion(lat, lng);
    if (dentro) {
        avviso.classList.add('hidden');
        avviso.textContent = '';
    } else {
        avviso.textContent = 'Attenzione: questo punto è fuori dalle regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise). Scegline uno all\'interno per poter pubblicare l\'escursione.';
        avviso.classList.remove('hidden');
    }
}

function resetTrailhead() {
    pickerPoint = null;
    const lat = document.getElementById('hike-trailhead-lat');
    const lng = document.getElementById('hike-trailhead-lng');
    if (lat) lat.value = '';
    if (lng) lng.value = '';
    const box = document.getElementById('trailhead-chosen');
    if (box) box.classList.add('hidden');
    const avviso = document.getElementById('trailhead-warning');
    if (avviso) avviso.classList.add('hidden');
    const risultati = document.getElementById('trailhead-search-results');
    if (risultati) risultati.classList.add('hidden');
    const ricerca = document.getElementById('hike-trailhead-search');
    if (ricerca) ricerca.value = '';
}

// --- Ricerca per nome ---

async function cercaLuogo(testo) {
    const box = document.getElementById('trailhead-search-results');
    const mio = ++searchSeq;

    box.innerHTML = '<div class="trailhead-result-item text-muted">Sto cercando…</div>';
    box.classList.remove('hidden');

    try {
        const res = await fetch(`/api/geocoding/search?q=${encodeURIComponent(testo)}`);
        if (mio !== searchSeq) return; // e' gia' partita una ricerca piu' recente
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            box.innerHTML = `<div class="trailhead-result-item text-muted">${escapeHtml(err.error || 'Ricerca non riuscita.')}</div>`;
            return;
        }

        const risultati = await res.json();
        if (mio !== searchSeq) return;

        if (!risultati.length) {
            box.innerHTML = '<div class="trailhead-result-item text-muted">Nessun luogo trovato. Prova con un nome diverso, oppure scegli il punto sulla mappa.</div>';
            return;
        }

        box.innerHTML = risultati.map((r, i) => `
            <button type="button" class="trailhead-result-item" data-indice="${i}">
                <span class="trailhead-result-name">${escapeHtml(r.nome)}</span>
                <span class="small text-muted">${escapeHtml(r.contesto || '')}${r.inRegione ? '' : ' — fuori zona'}</span>
            </button>
        `).join('');

        box.querySelectorAll('[data-indice]').forEach(btn => {
            btn.addEventListener('click', () => {
                const r = risultati[parseInt(btn.dataset.indice, 10)];
                setTrailhead(r.lat, r.lng, r.nome, r.contesto);
                document.getElementById('hike-trailhead-search').value = r.nome;
                box.classList.add('hidden');
            });
        });
    } catch (e) {
        if (mio !== searchSeq) return;
        console.error('Ricerca luogo fallita:', e);
        box.innerHTML = '<div class="trailhead-result-item text-muted">Ricerca non riuscita. Controlla la connessione.</div>';
    }
}

// --- Scelta dalla mappa ---

function apriMappaScelta() {
    const modal = document.getElementById('map-picker-modal');
    modal.classList.remove('hidden');

    // La mappa si crea la prima volta che serve, non al caricamento della pagina:
    // e' dentro una finestra nascosta, e Leaflet creato in un contenitore invisibile
    // memorizza dimensioni sbagliate (stesso problema gia' incontrato al punto 11).
    if (!pickerMap) {
        const b = window.CAMOSCIO_REGION_BOUNDS;
        pickerMap = L.map('map-picker', {
            maxBounds: [[b.minLat, b.minLng], [b.maxLat, b.maxLng]],
            maxBoundsViscosity: 1.0,
            minZoom: 7
        }).setView([42.62, 13.40], 9);

        const factory = window.createOfflineTileLayer || L.tileLayer;
        factory('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18
        }).addTo(pickerMap);

        pickerMap.on('click', e => scegliPuntoSullaMappa(e.latlng.lat, e.latlng.lng));
    }

    // Se un punto era gia' stato scelto (o cercato per nome) si riparte da li'.
    if (pickerPoint) {
        pickerMap.setView([pickerPoint.lat, pickerPoint.lng], 14);
        disegnaMarker(pickerPoint.lat, pickerPoint.lng);
        mostraInfoScelta(pickerPoint.nome, pickerPoint.lat, pickerPoint.lng);
    }

    // Necessario ogni volta: la finestra era display:none fino a un istante fa.
    setTimeout(() => pickerMap.invalidateSize(), 120);
}

function disegnaMarker(lat, lng) {
    if (pickerMarker) {
        pickerMarker.setLatLng([lat, lng]);
    } else {
        pickerMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'trailhead-picker-marker',
                html: '<div style="font-size:2rem;filter:drop-shadow(0 0 5px rgba(193,102,46,0.9));">📍</div>',
                iconSize: [32, 32],
                iconAnchor: [16, 30]
            })
        }).addTo(pickerMap);
    }
}

function mostraInfoScelta(nome, lat, lng, distanzaM, inCorso) {
    const elNome = document.getElementById('map-picker-name');
    const elCoord = document.getElementById('map-picker-coords');
    const btn = document.getElementById('btn-confirm-map-point');

    if (inCorso) {
        elNome.textContent = 'Cerco un riferimento vicino…';
    } else if (nome) {
        elNome.textContent = nome + (typeof distanzaM === 'number' && distanzaM > 0 ? ` (a ${distanzaM} m)` : '');
    } else {
        elNome.textContent = 'Punto senza riferimenti vicini';
    }
    elCoord.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    // Si puo' confermare subito, senza aspettare il nome: le coordinate bastano gia'.
    btn.disabled = false;
}

let sceltaSeq = 0;

async function scegliPuntoSullaMappa(lat, lng) {
    const mio = ++sceltaSeq;
    disegnaMarker(lat, lng);
    // Le coordinate si mostrano SUBITO; il nome arriva dopo (la ricerca del riferimento
    // puo' impiegare qualche secondo) senza bloccare nulla.
    mostraInfoScelta(null, lat, lng, null, true);
    pickerPoint = { lat, lng, nome: null, contesto: '' };

    try {
        const res = await fetch(`/api/geocoding/reverse?lat=${lat}&lng=${lng}`);
        if (mio !== sceltaSeq) return; // l'utente ha gia' toccato un altro punto
        const dati = res.ok ? await res.json() : {};
        pickerPoint = { lat, lng, nome: dati.nome || null, contesto: dati.contesto || '', distanzaM: dati.distanzaM };
        mostraInfoScelta(dati.nome, lat, lng, dati.distanzaM);
    } catch (e) {
        if (mio !== sceltaSeq) return;
        console.error('Ricerca del riferimento vicino fallita:', e);
        mostraInfoScelta(null, lat, lng);
    }
}

function confermaPuntoMappa() {
    if (!pickerPoint) return;
    setTrailhead(pickerPoint.lat, pickerPoint.lng, pickerPoint.nome, pickerPoint.contesto, pickerPoint.distanzaM);
    const ricerca = document.getElementById('hike-trailhead-search');
    if (ricerca && pickerPoint.nome) ricerca.value = pickerPoint.nome;
    document.getElementById('map-picker-modal').classList.add('hidden');
}

async function copiaCoordinate() {
    if (!pickerPoint) return;
    const testo = `${pickerPoint.lat.toFixed(5)}, ${pickerPoint.lng.toFixed(5)}`;
    try {
        await navigator.clipboard.writeText(testo);
        window.showToast(`Coordinate copiate: ${testo}`, 'success');
    } catch (e) {
        // navigator.clipboard non c'e' su connessioni non sicure o browser vecchi
        window.showToast(`Coordinate del ritrovo: ${testo}`, 'info');
    }
}

// --- Avvio ---

function initTrailheadPicker() {
    const ricerca = document.getElementById('hike-trailhead-search');
    const risultati = document.getElementById('trailhead-search-results');
    const btnMappa = document.getElementById('btn-open-map-picker');
    const btnChiudi = document.getElementById('map-picker-close');
    const btnConferma = document.getElementById('btn-confirm-map-point');
    const btnCopia = document.getElementById('btn-copy-coords');

    if (ricerca) {
        ricerca.addEventListener('input', () => {
            const testo = ricerca.value.trim();
            clearTimeout(searchDebounce);
            if (testo.length < MIN_CHARS) {
                searchSeq++; // annulla eventuali risposte in arrivo
                risultati.classList.add('hidden');
                return;
            }
            searchDebounce = setTimeout(() => cercaLuogo(testo), DEBOUNCE_MS);
        });

        // Invio non deve inviare tutto il modulo mentre si sta cercando un luogo
        ricerca.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(searchDebounce);
                const testo = ricerca.value.trim();
                if (testo.length >= MIN_CHARS) cercaLuogo(testo);
            }
        });
    }

    if (btnMappa) btnMappa.addEventListener('click', apriMappaScelta);
    if (btnChiudi) btnChiudi.addEventListener('click', () => {
        document.getElementById('map-picker-modal').classList.add('hidden');
    });
    if (btnConferma) btnConferma.addEventListener('click', confermaPuntoMappa);
    if (btnCopia) btnCopia.addEventListener('click', copiaCoordinate);

    if (window.lucide) window.lucide.createIcons();
}

window.initTrailheadPicker = initTrailheadPicker;
window.resetTrailheadPicker = resetTrailhead;
window.getChosenTrailhead = () => pickerPoint;
