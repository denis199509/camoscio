// ==========================================================================
// PUNTO 13 — PROGETTARE IN ANTICIPO IL PERCORSO DI UN'ESCURSIONE
//
// "Poter progettare in anticipo il percorso di una futura escursione scegliendo piu' punti
//  sulla mappa. Il sistema deve collegare automaticamente i punti scelti seguendo i sentieri
//  conosciuti. Se passo per una zona senza sentieri mappati, voglio poter scegliere di NON
//  agganciarmi ai sentieri: in quel caso i punti si collegano in linea d'aria."
//
// LA COSA PIU' IMPORTANTE DI QUESTO FILE non e' disegnare la linea: e' FAR VEDERE DOVE IL
// SISTEMA NON SA GUIDARE. La decisione presa con l'utente il 2026-07-27 e' che dove un
// percorso sui sentieri non esiste si tira una retta automatica, senza chiedere niente e
// senza rifiutare - ma quel tratto deve VEDERSI. Se una retta sembrasse un sentiero, uno
// programmerebbe di passare dove non si passa, e in montagna e' un guaio serio.
// Percio': tratteggio, colore diverso, metri dichiarati e un avviso in chiaro.
//
// IL DISLIVELLO NON C'E', e lo si scrive. I sentieri sul database non hanno la quota (0 su
// 15.228 misurati): per un'escursione da preparare e' forse il dato piu' utile, e tacerlo
// sarebbe peggio che ammetterlo.
// ==========================================================================

(function () {
    // Blu lago della palette di montagna (--accent-blue): il percorso PROGETTATO non deve
    // confondersi con quello REGISTRATO dal vivo, che e' blu chiaro (#7FB5C7, punto 14).
    const COLORE_SENTIERO = '#4C7E90';
    // Rosso mattone (--accent-red): e' il colore che nel resto del sito vuol dire "attenzione".
    const COLORE_RETTA = '#A83B2E';

    let attivo = false;
    let punti = [];              // [[lng,lat], ...] scelti dall'utente
    let ultimoEsito = null;      // la risposta del server, per il salvataggio
    let segnaposti = [];         // marker Leaflet dei punti scelti
    let linee = [];              // polyline Leaflet del percorso disegnato
    let inCalcolo = false;

    const esc = s => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));
    const metri = m => m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;

    // --- disegno sulla mappa ---

    function pulisciDisegno() {
        const mappa = window.mapInstance;
        linee.forEach(l => { try { mappa.removeLayer(l); } catch (e) { } });
        linee = [];
    }

    function pulisciSegnaposti() {
        const mappa = window.mapInstance;
        segnaposti.forEach(s => { try { mappa.removeLayer(s); } catch (e) { } });
        segnaposti = [];
    }

    function disegnaSegnaposti() {
        pulisciSegnaposti();
        const mappa = window.mapInstance;
        if (!mappa || !window.L) return;
        punti.forEach((p, i) => {
            const numero = i + 1;
            const icona = window.L.divIcon({
                className: 'route-point-marker',
                html: `<span>${numero}</span>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const m = window.L.marker([p[1], p[0]], { icon: icona }).addTo(mappa);
            m.bindTooltip(numero === 1 ? 'Partenza' : (numero === punti.length ? 'Arrivo' : `Tappa ${numero}`));
            segnaposti.push(m);
        });
    }

    function disegnaPercorso(esito) {
        pulisciDisegno();
        const mappa = window.mapInstance;
        if (!mappa || !window.L || !esito) return;

        esito.tappe.forEach(t => {
            const latlng = t.coordinate.map(c => [c[1], c[0]]);
            // I due tipi si distinguono a colpo d'occhio: continua e blu il sentiero,
            // tratteggiata e rossa la linea d'aria. Il tratteggio da solo non basterebbe
            // su uno schermo da telefono.
            const linea = window.L.polyline(latlng, t.tipo === 'sentiero'
                ? { color: COLORE_SENTIERO, weight: 5, opacity: 0.9 }
                : { color: COLORE_RETTA, weight: 4, opacity: 0.95, dashArray: '8, 8' }
            ).addTo(mappa);
            linea.bindTooltip(t.tipo === 'sentiero'
                ? `Sui sentieri · ${metri(t.metri)}`
                : `In linea d'aria · ${metri(t.metri)} — ${esc(t.motivo || 'nessun sentiero collega i due punti')}`);
            linee.push(linea);
        });
    }

    // --- pannello ---

    function riquadro() { return document.getElementById('route-planner-body'); }

    function aggiornaPannello() {
        const box = riquadro();
        if (!box) return;

        if (!attivo) {
            box.innerHTML = `
                <p class="small text-muted">Scegli due o piu' punti sulla mappa e il sito li collega seguendo i sentieri conosciuti. Il percorso si salva come bozza tua, non e' collegato a nessuna escursione.</p>
                <button class="btn btn-primary btn-sm" id="btn-rp-avvia" type="button"><i data-lucide="route"></i> Comincia a progettare</button>
                <div id="rp-elenco-bozze"></div>`;
            document.getElementById('btn-rp-avvia').addEventListener('click', avvia);
            elencaBozze();
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        const righe = punti.map((p, i) => `
            <li>
                <span class="rp-num">${i + 1}</span>
                <span class="rp-coord">${p[1].toFixed(5)}, ${p[0].toFixed(5)}</span>
                <button class="rp-del" data-rp-togli="${i}" title="Togli questo punto" aria-label="Togli il punto ${i + 1}"><i data-lucide="x"></i></button>
            </li>`).join('');

        let riepilogo = '';
        if (inCalcolo) {
            riepilogo = `<div class="rp-esito attesa"><i data-lucide="loader"></i> Sto cercando il percorso…</div>`;
        } else if (ultimoEsito) {
            const e = ultimoEsito;
            // L'AVVISO SUI TRATTI IN LINEA D'ARIA e' la ragione per cui questo riquadro
            // esiste: e' il momento in cui l'utente capisce che li' il sito non sa guidare.
            const avviso = e.tappeInRetta > 0
                ? `<div class="rp-avviso">
                       <i data-lucide="triangle-alert"></i>
                       <span><b>${metri(e.metriRetta)} in linea d'aria</b> su ${e.tappeInRetta} ${e.tappeInRetta === 1 ? 'tratto' : 'tratti'}: li' non c'e' nessun sentiero conosciuto che colleghi i punti, quindi la linea rossa tratteggiata NON e' un percorso da seguire. Sul posto valuta tu.</span>
                   </div>`
                : `<div class="rp-tutto-bene"><i data-lucide="circle-check-big"></i> Tutto il percorso segue sentieri conosciuti.</div>`;
            riepilogo = `
                <div class="rp-esito">
                    <div class="rp-totali">
                        <div><strong>${metri(e.metriTotali)}</strong><span>totali</span></div>
                        <div><strong>${metri(e.metriSentiero)}</strong><span>sui sentieri</span></div>
                        <div><strong>${metri(e.metriRetta)}</strong><span>in linea d'aria</span></div>
                    </div>
                    ${avviso}
                    ${esposizioneSolare(e)}
                    <p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i> Il dislivello non si puo' calcolare: i sentieri della mappa non hanno la quota salvata.</p>
                    <button class="btn btn-sm btn-primary" id="btn-rp-salva" type="button"><i data-lucide="save"></i> Salva come bozza</button>
                </div>`;
        }

        box.innerHTML = `
            <p class="small text-muted">Tocca la mappa per aggiungere una tappa.</p>
            <label class="rp-switch">
                <input type="checkbox" id="rp-aggancia" ${aggancia ? 'checked' : ''}>
                <span>Segui i sentieri conosciuti</span>
            </label>
            <p class="small text-muted rp-spiega-switch">Spegnendolo i punti si collegano sempre in linea retta, utile dove non c'e' niente di mappato.</p>
            ${punti.length ? `<ol class="rp-punti">${righe}</ol>` : '<p class="small text-muted">Nessun punto scelto.</p>'}
            <div class="rp-comandi">
                <button class="btn btn-sm btn-secondary" id="btn-rp-annulla-ultimo" type="button" ${punti.length ? '' : 'disabled'}><i data-lucide="undo-2"></i> Togli l'ultimo</button>
                <button class="btn btn-sm btn-secondary" id="btn-rp-svuota" type="button" ${punti.length ? '' : 'disabled'}><i data-lucide="eraser"></i> Svuota</button>
                <button class="btn btn-sm btn-secondary" id="btn-rp-chiudi" type="button"><i data-lucide="x"></i> Chiudi</button>
            </div>
            ${riepilogo}`;

        document.getElementById('rp-aggancia').addEventListener('change', ev => { aggancia = ev.target.checked; calcola(); });
        document.getElementById('btn-rp-annulla-ultimo').addEventListener('click', () => { punti.pop(); dopoModifica(); });
        document.getElementById('btn-rp-svuota').addEventListener('click', () => { punti = []; dopoModifica(); });
        document.getElementById('btn-rp-chiudi').addEventListener('click', chiudi);
        box.querySelectorAll('[data-rp-togli]').forEach(b =>
            b.addEventListener('click', () => { punti.splice(Number(b.getAttribute('data-rp-togli')), 1); dopoModifica(); }));
        const salva = document.getElementById('btn-rp-salva');
        if (salva) salva.addEventListener('click', salvaBozza);

        if (window.lucide) window.lucide.createIcons();
    }

    let aggancia = true;

    // L'ESPOSIZIONE AL SOLE DEL PERCORSO PROGETTATO (chiesta dall'utente il 2026-07-27:
    // "una volta che abbiamo il progetto possiamo proporre l'esposizione solare sul
    // sentiero").
    //
    // Per un'escursione il sito la stima gia' (renderSolarExposureAdvice in map.js), ma da
    // UN SOLO dato: la direzione dal ritrovo all'ultima vetta. Qui si ha molto di piu' -
    // la linea vera del percorso - quindi si guarda l'orientamento di OGNI TRATTO e si
    // dice quanto del cammino guarda a sud e quanto a nord. E' il dato che serve davvero
    // a decidere a che ora partire.
    // NON si inventa niente sul dislivello o sull'ombra degli avvallamenti: senza le quote
    // non si puo' sapere, e sotto e' scritto.
    function esposizioneSolare(e) {
        if (typeof window.calculateBearing !== 'function' || typeof window.bearingToCompassSector !== 'function') return '';

        // Ogni tratto pesa per la sua LUNGHEZZA: mezzo chilometro esposto a sud conta piu'
        // di venti metri girati a nord.
        const versanti = new Map();
        let totale = 0;
        for (const t of e.tappe) {
            for (let i = 1; i < t.coordinate.length; i++) {
                const a = t.coordinate[i - 1], b = t.coordinate[i];
                const dx = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
                const dy = (b[1] - a[1]) * 111320;
                const lung = Math.hypot(dx, dy);
                if (lung < 1) continue;
                const settore = window.bearingToCompassSector(window.calculateBearing(a[1], a[0], b[1], b[0]));
                versanti.set(settore.key, (versanti.get(settore.key) || 0) + lung);
                totale += lung;
            }
        }
        if (!totale) return '';

        const quota = k => Math.round(((versanti.get(k) || 0) / totale) * 100);
        const sud = quota('S') + quota('SE') + quota('SW');
        const nord = quota('N') + quota('NE') + quota('NW');
        const prevalente = [...versanti.entries()].sort((a, b) => b[1] - a[1])[0];
        const etichetta = window.bearingToCompassSector(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].indexOf(prevalente[0]) * 45).label;

        const mese = new Date().getMonth();
        const estate = mese >= 5 && mese <= 8;

        let consiglio;
        if (sud >= 50 && estate) {
            consiglio = `Piu' della meta' del percorso e' rivolta a sud e si scalda presto: in questa stagione conviene partire entro le 7:00, e ricorda che i temporali di calore arrivano dal primo pomeriggio.`;
        } else if (sud >= 50) {
            consiglio = `Piu' della meta' del percorso e' rivolta a sud: prende sole a lungo, il che d'inverno aiuta - la neve si scioglie prima e il fondo e' meno gelato al mattino.`;
        } else if (nord >= 50) {
            consiglio = estate
                ? `Piu' della meta' del percorso e' rivolta a nord: resta piu' fresco anche d'estate, buono per le ore centrali.`
                : `Piu' della meta' del percorso e' rivolta a nord: nei mesi freddi il ghiaccio ci resta a lungo anche col sole. Valuta i ramponcini.`;
        } else {
            consiglio = `Il percorso cambia versante spesso, quindi alterna tratti al sole e all'ombra: nessuna esposizione domina.`;
        }

        return `
            <div class="rp-sole">
                <div class="rp-sole-testa"><i data-lucide="sun"></i> <b>Esposizione al sole</b> · direzione prevalente ${esc(etichetta)}</div>
                <div class="rp-sole-barre">
                    <div><span>${sud}%</span><small>a sud</small></div>
                    <div><span>${nord}%</span><small>a nord</small></div>
                </div>
                <p class="small">${consiglio}</p>
                <p class="small text-muted">Calcolata dall'orientamento del tracciato. Non tiene conto dell'ombra delle pareti vicine, che senza le quote non si puo' sapere.</p>
            </div>`;
    }

    function dopoModifica() {
        disegnaSegnaposti();
        ultimoEsito = null;
        pulisciDisegno();
        aggiornaPannello();
        calcola();
    }

    // --- calcolo ---

    async function calcola() {
        if (punti.length < 2) { aggiornaPannello(); return; }
        inCalcolo = true;
        aggiornaPannello();
        try {
            const res = await fetch('/api/routing/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ punti, agganciaAiSentieri: aggancia })
            });
            const dati = await res.json();
            inCalcolo = false;
            if (!res.ok) {
                ultimoEsito = null;
                pulisciDisegno();
                aggiornaPannello();
                if (window.showToast) window.showToast(dati.error || 'Non e stato possibile calcolare il percorso.', 'error');
                return;
            }
            ultimoEsito = dati;
            disegnaPercorso(dati);
            aggiornaPannello();
        } catch (e) {
            inCalcolo = false;
            ultimoEsito = null;
            aggiornaPannello();
            console.error('Calcolo percorso fallito:', e);
            if (window.showToast) window.showToast('Non è stato possibile contattare il server.', 'error');
        }
    }

    // --- accensione e spegnimento ---

    function avvia() {
        attivo = true;
        punti = [];
        ultimoEsito = null;
        pulisciDisegno();
        pulisciSegnaposti();
        aggiornaPannello();
        const mappa = document.getElementById('map');
        if (mappa) mappa.classList.add('modalita-progetto');
        if (window.showToast) window.showToast('Tocca la mappa per aggiungere le tappe del percorso.', 'success');
    }

    function chiudi() {
        attivo = false;
        punti = [];
        ultimoEsito = null;
        pulisciDisegno();
        pulisciSegnaposti();
        const mappa = document.getElementById('map');
        if (mappa) mappa.classList.remove('modalita-progetto');
        aggiornaPannello();
    }

    // Chiamata da onMapClick in map.js. Restituisce true se il click e' stato usato qui,
    // cosi' la mappa non apre anche il modulo delle segnalazioni.
    function gestisciClickMappa(e) {
        if (!attivo) return false;
        punti.push([e.latlng.lng, e.latlng.lat]);
        dopoModifica();
        return true;
    }

    // --- bozze ---

    async function salvaBozza() {
        if (!ultimoEsito || punti.length < 2) return;
        const nome = window.showPromptModal
            ? await window.showPromptModal('Che nome vuoi dare a questo percorso?', `Percorso del ${new Date().toLocaleDateString('it-IT')}`)
            : `Percorso del ${new Date().toLocaleDateString('it-IT')}`;
        if (!nome) return;
        try {
            const res = await fetch('/api/routing/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, punti, agganciaAiSentieri: aggancia })
            });
            const dati = await res.json();
            if (!res.ok) {
                if (window.showToast) window.showToast(dati.error || 'Non e stato possibile salvare la bozza.', 'error');
                return;
            }
            if (window.showToast) window.showToast('Bozza salvata. La ritrovi qui sotto quando chiudi il progetto.', 'success');
        } catch (e) {
            console.error('Salvataggio bozza fallito:', e);
            if (window.showToast) window.showToast('Non è stato possibile contattare il server.', 'error');
        }
    }

    async function elencaBozze() {
        const box = document.getElementById('rp-elenco-bozze');
        if (!box) return;
        try {
            const res = await fetch('/api/routing/drafts');
            if (!res.ok) return;
            const bozze = await res.json();
            if (!bozze.length) { box.innerHTML = ''; return; }
            box.innerHTML = `
                <h5 class="rp-titolo-bozze">I tuoi percorsi salvati</h5>
                <ul class="rp-bozze">${bozze.map(b => `
                    <li>
                        <button class="rp-apri" data-rp-apri="${esc(b.id)}">
                            <span class="rp-bozza-nome">${esc(b.nome)}</span>
                            <span class="rp-bozza-dati">${b.punti.length} tappe · ${metri(b.metriTotali || 0)}${b.metriRetta ? ` · ${metri(b.metriRetta)} in linea d'aria` : ''}</span>
                        </button>
                        <button class="rp-del" data-rp-cancella="${esc(b.id)}" title="Cancella questa bozza" aria-label="Cancella ${esc(b.nome)}"><i data-lucide="trash-2"></i></button>
                    </li>`).join('')}</ul>`;
            box.querySelectorAll('[data-rp-apri]').forEach(b =>
                b.addEventListener('click', () => apriBozza(bozze.find(x => x.id === b.getAttribute('data-rp-apri')))));
            box.querySelectorAll('[data-rp-cancella]').forEach(b =>
                b.addEventListener('click', () => cancellaBozza(b.getAttribute('data-rp-cancella'))));
            if (window.lucide) window.lucide.createIcons();
        } catch (e) { /* l'elenco resta vuoto: non vale un messaggio d'errore */ }
    }

    async function apriBozza(bozza) {
        if (!bozza) return;
        attivo = true;
        punti = bozza.punti.map(p => [p[0], p[1]]);
        aggancia = bozza.agganciaAiSentieri !== false;
        const mappa = document.getElementById('map');
        if (mappa) mappa.classList.add('modalita-progetto');
        disegnaSegnaposti();
        if (window.mapInstance && punti.length) {
            window.mapInstance.fitBounds(punti.map(p => [p[1], p[0]]), { padding: [40, 40] });
        }
        await calcola();
    }

    async function cancellaBozza(id) {
        const procedi = window.showConfirmModal
            ? await window.showConfirmModal('Cancellare questo percorso salvato?\n\nI punti scelti andranno persi. Le escursioni e le uscite registrate non c\'entrano e non vengono toccate.', 'Cancella')
            : true;
        if (!procedi) return;
        try {
            const res = await fetch(`/api/routing/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                if (window.showToast) window.showToast(d.error || 'Non e stato possibile cancellare.', 'error');
                return;
            }
            if (window.showToast) window.showToast('Percorso cancellato.', 'success');
            elencaBozze();
        } catch (e) {
            if (window.showToast) window.showToast('Non è stato possibile contattare il server.', 'error');
        }
    }

    function initRoutePlanner() {
        if (!document.getElementById('route-planner-body')) return;
        aggiornaPannello();
    }

    // --- "I MIEI PROGETTI" nella pagina "Le mie escursioni" ---
    //
    // Segnalato dall'utente: "una volta creato il progetto dell'escursione non trovo piu'
    // il progetto". Aveva ragione: si vedevano SOLO dentro la scheda della Mappa, cioe'
    // bisognava gia' sapere dov'erano. Un percorso che ci si e' costruiti si cerca nella
    // pagina delle proprie cose, insieme alle proprie escursioni e alle proprie uscite.
    async function renderProgetti() {
        const box = document.getElementById('projects-list');
        if (!box) return;
        let bozze = [];
        try {
            const res = await fetch('/api/routing/drafts');
            if (!res.ok) throw new Error('richiesta fallita');
            bozze = await res.json();
        } catch (e) {
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">Non è stato possibile caricare i tuoi progetti. Riprova più tardi.</div>`;
            return;
        }

        const contatore = document.getElementById('count-projects');
        if (contatore) contatore.textContent = bozze.length;

        if (!bozze.length) {
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">
                Nessun progetto per ora. Vai su <b>Mappa &amp; Sentieri</b>, apri "Progetta un percorso" e tocca i punti che vuoi collegare.
            </div>`;
            return;
        }

        box.innerHTML = `<div class="outings-grid">${bozze.map(b => `
            <div class="outing-card" data-progetto-id="${esc(b.id)}">
                <div class="outing-card-head">
                    <span class="outing-card-title">${esc(b.nome)}</span>
                    <span class="badge badge-accent outing-tag" title="Percorso progettato da te, non ancora fatto"><i data-lucide="route"></i> progetto</span>
                    <button class="outing-card-del" data-prog-del="${esc(b.id)}" title="Cancella questo progetto" aria-label="Cancella ${esc(b.nome)}"><i data-lucide="trash-2"></i></button>
                </div>
                <div class="outing-card-stats">
                    <div><strong>${b.punti.length}</strong><span>tappe</span></div>
                    <div><strong>${metri(b.metriTotali || 0)}</strong><span>lunghezza</span></div>
                    ${b.metriRetta > 0
                        ? `<div title="Tratti dove non esiste un sentiero conosciuto che colleghi i punti"><strong>${metri(b.metriRetta)}</strong><span>in linea d'aria</span></div>`
                        : `<div><strong>✓</strong><span>tutto su sentieri</span></div>`}
                </div>
                <button class="btn btn-sm btn-secondary rp-apri-mappa" data-prog-apri="${esc(b.id)}"><i data-lucide="map"></i> Apri sulla mappa</button>
            </div>`).join('')}</div>`;

        box.querySelectorAll('[data-prog-apri]').forEach(b => b.addEventListener('click', () => {
            const bozza = bozze.find(x => x.id === b.getAttribute('data-prog-apri'));
            // Si passa alla Mappa con lo stesso meccanismo di navigazione del resto del
            // sito, poi si apre la bozza: cosi' il percorso e l'esposizione al sole si
            // vedono dove servono, sulla mappa.
            const voce = document.querySelector('.nav-btn[data-target="map-section"]');
            if (voce) voce.click();
            setTimeout(() => apriBozza(bozza), 400);
        }));
        box.querySelectorAll('[data-prog-del]').forEach(b => b.addEventListener('click', async () => {
            await cancellaBozza(b.getAttribute('data-prog-del'));
            renderProgetti();
        }));

        if (window.lucide) window.lucide.createIcons();
    }

    window.CamoscioRoutePlanner = { gestisciClickMappa, init: initRoutePlanner, renderProgetti };
    window.initRoutePlanner = initRoutePlanner;
    window.renderProgetti = renderProgetti;
})();
