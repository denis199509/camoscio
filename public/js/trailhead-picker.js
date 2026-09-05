// Punto 8 di cose_da_fare.txt - scelta di un punto per NOME o dalla MAPPA, invece di
// scrivere latitudine e longitudine a mano.
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
//
// DAL PUNTO 27 questo file e' diviso in due: sopra il componente riusabile
// (CamoscioPlaceSearch), sotto il suo primo utente, il punto di ritrovo dell'escursione.
// Il motivo e' che il meteo multi-quota ha chiesto la stessa identica barra di ricerca, e
// due copie della stessa logica sarebbero divergite alla prima correzione - stesso criterio
// gia' seguito al punto 10 estraendo buildHikeCard.

const MIN_CHARS = 3;
const DEBOUNCE_MS = 450;       // non una richiesta per tastierata: si aspetta la pausa

// =====================================================================
// COMPONENTE RIUSABILE
// =====================================================================

// Collega una barra di ricerca luoghi a un contenitore di risultati.
// Ogni barra ha il PROPRIO stato (attesa e numero di sequenza): tenerli in comune farebbe
// annullare i risultati di una barra a chi sta scrivendo nell'altra.
function attachSearch({ input, results, onPick }) {
    if (!input || !results) return;

    let debounce = null;
    let seq = 0;

    async function cerca(testo) {
        const mio = ++seq;

        results.innerHTML = '<div class="trailhead-result-item text-muted">Sto cercando…</div>';
        results.classList.remove('hidden');

        try {
            const res = await fetch(`/api/geocoding/search?q=${encodeURIComponent(testo)}`);
            if (mio !== seq) return; // e' gia' partita una ricerca piu' recente
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                results.innerHTML = `<div class="trailhead-result-item text-muted">${escapeHtml(err.error || 'Ricerca non riuscita.')}</div>`;
                return;
            }

            const risultati = await res.json();
            if (mio !== seq) return;

            if (!risultati.length) {
                results.innerHTML = '<div class="trailhead-result-item text-muted">Nessun luogo trovato. Prova con un nome diverso, oppure scegli il punto sulla mappa.</div>';
                return;
            }

            results.innerHTML = risultati.map((r, i) => `
                <button type="button" class="trailhead-result-item" data-indice="${i}">
                    <span class="trailhead-result-name">${escapeHtml(r.nome)}</span>
                    <span class="small text-muted">${escapeHtml(r.contesto || '')}${r.inRegione ? '' : ' — fuori zona'}</span>
                </button>
            `).join('');

            results.querySelectorAll('[data-indice]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const r = risultati[parseInt(btn.dataset.indice, 10)];
                    results.classList.add('hidden');
                    input.value = r.nome;
                    onPick(r);
                });
            });
        } catch (e) {
            if (mio !== seq) return;
            console.error('Ricerca luogo fallita:', e);
            results.innerHTML = '<div class="trailhead-result-item text-muted">Ricerca non riuscita. Controlla la connessione.</div>';
        }
    }

    input.addEventListener('input', () => {
        const testo = input.value.trim();
        clearTimeout(debounce);
        if (testo.length < MIN_CHARS) {
            seq++; // annulla eventuali risposte in arrivo
            results.classList.add('hidden');
            return;
        }
        debounce = setTimeout(() => cerca(testo), DEBOUNCE_MS);
    });

    // Invio non deve inviare tutto il modulo mentre si sta cercando un luogo
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(debounce);
            const testo = input.value.trim();
            if (testo.length >= MIN_CHARS) cerca(testo);
        }
    });
}

// Nome del luogo conosciuto piu' vicino a un punto. Il server mette insieme Nominatim e
// Overpass e decide lui quale nome e' migliore (vedi routes/geocoding.js).
async function cercaRiferimento(lat, lng) {
    try {
        const res = await fetch(`/api/geocoding/reverse?lat=${lat}&lng=${lng}`);
        return res.ok ? await res.json() : {};
    } catch (e) {
        console.error('Ricerca del riferimento vicino fallita:', e);
        return {};
    }
}

// --- Mappa a schermo intero per scegliere un punto col dito ---

let pickerMap = null;
let pickerMarker = null;
let puntoModale = null;   // punto attualmente toccato nella finestra
let onConfirmModale = null;
let sceltaSeq = 0;

function apriMappaScelta({ titolo, suggerimento, punto, onConfirm } = {}) {
    const modal = document.getElementById('map-picker-modal');
    onConfirmModale = onConfirm || null;
    puntoModale = punto || null;

    // Titolo e spiegazione cambiano a seconda di chi apre la finestra: la stessa mappa serve
    // a scegliere il ritrovo di un'escursione e il punto di cui vedere il meteo.
    const elTitolo = document.getElementById('map-picker-title');
    const elHint = document.getElementById('map-picker-hint');
    if (elTitolo && titolo) elTitolo.textContent = titolo;
    if (elHint && suggerimento) elHint.textContent = suggerimento;

    modal.classList.remove('hidden');
    window.apriModaleStorico('map-picker-modal', chiudiMappaScelta);

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

        // Stessa mappa base della mappa principale (punto 39): CAMOSCIO_TILE_URL/OPTIONS
        // sono definite in map.js, caricato prima di questo script.
        const factory = window.createOfflineTileLayer || L.tileLayer;
        factory(window.CAMOSCIO_TILE_URL, window.CAMOSCIO_TILE_OPTIONS).addTo(pickerMap);

        pickerMap.on('click', e => scegliPuntoSullaMappa(e.latlng.lat, e.latlng.lng));
    }

    // Se un punto era gia' stato scelto (o cercato per nome) si riparte da li'.
    if (puntoModale) {
        pickerMap.setView([puntoModale.lat, puntoModale.lng], 14);
        disegnaMarker(puntoModale.lat, puntoModale.lng);
        mostraInfoScelta(puntoModale.nome, puntoModale.lat, puntoModale.lng, puntoModale.distanzaM);
    } else {
        mostraInfoScelta(null, null, null, null, false, true);
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

function mostraInfoScelta(nome, lat, lng, distanzaM, inCorso, vuoto) {
    const elNome = document.getElementById('map-picker-name');
    const elCoord = document.getElementById('map-picker-coords');
    const btn = document.getElementById('btn-confirm-map-point');

    if (vuoto) {
        elNome.textContent = 'Nessun punto scelto';
        elCoord.textContent = '';
        btn.disabled = true;
        return;
    }

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

async function scegliPuntoSullaMappa(lat, lng) {
    const mio = ++sceltaSeq;
    disegnaMarker(lat, lng);
    // Le coordinate si mostrano SUBITO; il nome arriva dopo (la ricerca del riferimento
    // puo' impiegare qualche secondo) senza bloccare nulla.
    mostraInfoScelta(null, lat, lng, null, true);
    puntoModale = { lat, lng, nome: null, contesto: '' };

    const dati = await cercaRiferimento(lat, lng);
    if (mio !== sceltaSeq) return; // l'utente ha gia' toccato un altro punto
    puntoModale = { lat, lng, nome: dati.nome || null, contesto: dati.contesto || '', distanzaM: dati.distanzaM };
    mostraInfoScelta(dati.nome, lat, lng, dati.distanzaM);
}

// Chiusura vera (nascondere e basta): registrata come "chiudi" del modale
// (apriModaleStorico sopra) e usata da entrambi i punti di chiusura (conferma, tasto X)
// tramite chiudiModaleStorico, cosi' un Indietro fisico e una chiusura a mano consumano
// la STESSA entry di cronologia.
function chiudiMappaScelta() {
    document.getElementById('map-picker-modal').classList.add('hidden');
}

function confermaPuntoMappa() {
    if (!puntoModale) return;
    const scelto = puntoModale;
    window.chiudiModaleStorico('map-picker-modal', chiudiMappaScelta);
    if (onConfirmModale) onConfirmModale(scelto);
}

async function copiaCoordinate(lat, lng) {
    const testo = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
        await navigator.clipboard.writeText(testo);
        window.showToast(`Coordinate copiate: ${testo}`, 'success');
    } catch (e) {
        // navigator.clipboard non c'e' su connessioni non sicure o browser vecchi
        window.showToast(`Coordinate del punto: ${testo}`, 'info');
    }
}

window.CamoscioPlaceSearch = {
    attachSearch,
    openMapPicker: apriMappaScelta,
    cercaRiferimento,
    copiaCoordinate
};

// =====================================================================
// PRIMO UTENTE: il punto di ritrovo dell'escursione (punto 8)
// =====================================================================

let pickerPoint = null;        // { lat, lng, nome, contesto }

function setTrailhead(lat, lng, nome, contesto, distanzaM) {
    pickerPoint = { lat, lng, nome, contesto, distanzaM };

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

function initTrailheadPicker() {
    attachSearch({
        input: document.getElementById('hike-trailhead-search'),
        results: document.getElementById('trailhead-search-results'),
        onPick: r => setTrailhead(r.lat, r.lng, r.nome, r.contesto)
    });

    const btnMappa = document.getElementById('btn-open-map-picker');
    if (btnMappa) {
        btnMappa.addEventListener('click', () => apriMappaScelta({
            titolo: 'Scegli il punto di ritrovo',
            suggerimento: "Tocca la mappa nel punto dove vi trovate. Se vicino c'è un luogo conosciuto, il suo nome verrà usato come riferimento.",
            punto: pickerPoint,
            onConfirm: p => {
                setTrailhead(p.lat, p.lng, p.nome, p.contesto, p.distanzaM);
                const ricerca = document.getElementById('hike-trailhead-search');
                if (ricerca && p.nome) ricerca.value = p.nome;
            }
        }));
    }

    const btnChiudi = document.getElementById('map-picker-close');
    if (btnChiudi) btnChiudi.addEventListener('click', () => {
        window.chiudiModaleStorico('map-picker-modal', chiudiMappaScelta);
    });

    const btnConferma = document.getElementById('btn-confirm-map-point');
    if (btnConferma) btnConferma.addEventListener('click', confermaPuntoMappa);

    const btnCopia = document.getElementById('btn-copy-coords');
    if (btnCopia) btnCopia.addEventListener('click', () => {
        if (pickerPoint) copiaCoordinate(pickerPoint.lat, pickerPoint.lng);
    });

    if (window.lucide) window.lucide.createIcons();
}

window.initTrailheadPicker = initTrailheadPicker;
window.resetTrailheadPicker = resetTrailhead;
window.getChosenTrailhead = () => pickerPoint;
// Punto 54: serve per precompilare il ritrovo quando si apre il modulo in modifica.
window.setChosenTrailhead = setTrailhead;
