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
// IL DISLIVELLO ORA C'E' (punto 33, 2026-07-28), ma e' una STIMA e va detto. I sentieri sul
// database non hanno la quota (0 su 15.228 misurati), quindi le quote arrivano da un modello
// del terreno interrogato dal server. E' forse il dato piu' utile per capire se un'escursione
// e' alla propria portata: proprio per questo va accompagnato da quanto puo' sbagliare,
// invece di essere presentato come una misura.
// ==========================================================================

(function () {
    // Blu lago della palette di montagna (--accent-blue): il percorso PROGETTATO non deve
    // confondersi con quello REGISTRATO dal vivo, che e' blu chiaro (#7FB5C7, punto 14).
    const COLORE_SENTIERO = '#4C7E90';
    // Rosso mattone (--accent-red): e' il colore che nel resto del sito vuol dire "attenzione".
    const COLORE_RETTA = '#A83B2E';

    // Lo stesso tetto di routes/routing.js. Qui serve per FERMARE il punto di troppo con una
    // spiegazione, invece di lasciar arrivare un 400 che sull'interfaccia sembra un guasto.
    const MAX_PUNTI = 25;

    let attivo = false;
    let punti = [];              // [[lng,lat], ...] scelti dall'utente
    let anello = false;          // il percorso torna al punto 1 (punto 38)
    let ultimoEsito = null;      // la risposta del server, per il salvataggio
    let segnaposti = [];         // marker Leaflet dei punti scelti
    let linee = [];              // polyline Leaflet del percorso disegnato
    let inCalcolo = false;

    // PUNTO 38 - "TORNA ALL'INIZIO", cioe' CHIUDERE L'ANELLO.
    //
    // Richiesta di Denis (2026-07-29), con le sue parole: "serve un tasto che ti riporta al
    // primo punto, che in teoria corrisponde all'inizio del sentiero, quindi dove
    // probabilmente lascero' la macchina".
    //
    // PERCHE' CONTA PIU' DI UN TASTO IN PIU': fino a qui un progetto Campo Imperatore ->
    // Corno Grande mostrava i chilometri e il dislivello della SOLA ANDATA, ma quella strada
    // si fa in tutti e due i versi. Era un numero che sembrava la misura dell'escursione ed
    // era la sua meta' - lo stesso difetto di forma gia' corretto per il dislivello dei
    // percorsi progettati (punto 33) e per il tempo CAI (punto 44).
    //
    // L'ANELLO E' UN INTERRUTTORE, NON UN PUNTO IN PIU' DENTRO "punti", ed e' la decisione
    // che tiene in piedi tutto il resto del file. Aggiungere in coda una copia del punto 1
    // sarebbe stata la strada ovvia, ma: il segnaposto numerato sarebbe finito ESATTAMENTE
    // sopra quello del punto 1, l'elenco avrebbe mostrato due righe con le stesse coordinate,
    // e soprattutto UNA TAPPA AGGIUNTA DOPO AVER CHIUSO L'ANELLO SAREBBE FINITA DOPO IL
    // RITORNO. Con un booleano invece "punti" resta "le tappe che ho scelto": elenco,
    // segnaposti, "Togli l'ultimo", "Svuota" e i cestini continuano a funzionare senza essere
    // toccati, e una tappa nuova si infila da sola PRIMA del ritorno.
    //
    // Il ritorno si chiude qui, in un posto solo, perche' lo usano sia il calcolo sia il
    // salvataggio: due copie della stessa regola divergono sempre, ed e' una trappola gia'
    // pagata su questo progetto (due copie dello stesso blocco, escapeHtml mancante in una).
    function puntiDaPercorrere() {
        return anello && punti.length >= 2 ? [...punti, punti[0]] : punti;
    }

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
        // Ad anello chiuso l'arrivo NON e' l'ultima tappa scelta: e' il punto 1. Un segnaposto
        // in piu' sopra quello di partenza non si vedrebbe nemmeno (stesse coordinate), quindi
        // il ritorno si dice sul segnaposto che c'e' gia'.
        const chiuso = anello && punti.length >= 2;
        punti.forEach((p, i) => {
            const numero = i + 1;
            const partenza = numero === 1;
            const icona = window.L.divIcon({
                className: `route-point-marker${chiuso && partenza ? ' route-point-anello' : ''}`,
                html: `<span>${numero}</span>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const m = window.L.marker([p[1], p[0]], { icon: icona }).addTo(mappa);
            m.bindTooltip(partenza
                ? (chiuso ? 'Partenza e arrivo' : 'Partenza')
                : (!chiuso && numero === punti.length ? 'Arrivo' : `Tappa ${numero}`));
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

        // Il ritorno NON ha un numero e NON ha coordinate proprie: non e' una tappa che si e'
        // scelta, e' il rientro al punto 1. Scriverci sopra le stesse coordinate della riga 1
        // farebbe sembrare che si sia toccato due volte lo stesso posto.
        const chiuso = anello && punti.length >= 2;
        const rigaRitorno = chiuso ? `
            <li class="rp-ritorno">
                <span class="rp-num rp-num-ritorno" aria-hidden="true">&#8629;</span>
                <span class="rp-coord">Ritorno alla partenza</span>
                <button class="rp-del" data-rp-riapri title="Togli il ritorno" aria-label="Togli il ritorno alla partenza"><i data-lucide="x"></i></button>
            </li>` : '';

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
                    ${tipoPercorso(chiuso)}
                    <div class="rp-totali">
                        <div><strong>${metri(e.metriTotali)}</strong><span>totali</span></div>
                        <div><strong>${metri(e.metriSentiero)}</strong><span>sui sentieri</span></div>
                        <div><strong>${metri(e.metriRetta)}</strong><span>in linea d'aria</span></div>
                    </div>
                    ${dislivello(e)}
                    ${avviso}
                    ${esposizioneSolare(e)}
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
            ${punti.length ? `<ol class="rp-punti">${righe}${rigaRitorno}</ol>` : '<p class="small text-muted">Nessun punto scelto.</p>'}
            ${chiuso ? `<p class="small text-muted rp-spiega-anello">Il percorso torna al punto 1, dove hai lasciato la macchina. Il ritorno segue i sentieri come le altre tappe, e i numeri qui sotto comprendono anche lui.</p>` : ''}
            <div class="rp-comandi">
                <button class="btn btn-sm ${chiuso ? 'btn-secondary' : 'btn-primary'}" id="btn-rp-anello" type="button" ${punti.length >= 2 ? '' : 'disabled'}
                        title="${chiuso ? 'Il percorso torna al punto 1: premi per toglierlo' : 'Aggiungi il ritorno al punto 1, dove hai lasciato la macchina'}">
                    <i data-lucide="${chiuso ? 'undo-dot' : 'rotate-ccw'}"></i> ${chiuso ? 'Togli il ritorno' : "Torna all'inizio"}
                </button>
                <button class="btn btn-sm btn-secondary" id="btn-rp-annulla-ultimo" type="button" ${punti.length ? '' : 'disabled'}><i data-lucide="undo-2"></i> Togli l'ultimo</button>
                <button class="btn btn-sm btn-secondary" id="btn-rp-svuota" type="button" ${punti.length ? '' : 'disabled'}><i data-lucide="eraser"></i> Svuota</button>
                <button class="btn btn-sm btn-secondary" id="btn-rp-chiudi" type="button"><i data-lucide="x"></i> Chiudi</button>
            </div>
            ${riepilogo}`;

        document.getElementById('rp-aggancia').addEventListener('change', ev => { aggancia = ev.target.checked; calcola(); });
        document.getElementById('btn-rp-anello').addEventListener('click', () => { anello = !anello; dopoModifica(); });
        document.getElementById('btn-rp-annulla-ultimo').addEventListener('click', () => { punti.pop(); dopoModifica(); });
        // "Svuota" vuol dire ricominciare da capo, quindi spegne anche l'anello: altrimenti il
        // progetto successivo si richiuderebbe da solo alla seconda tappa senza che nessuno
        // l'abbia chiesto. "Togli l'ultimo" invece lo lascia acceso - e' un passo indietro,
        // non un ripensamento.
        document.getElementById('btn-rp-svuota').addEventListener('click', () => { punti = []; anello = false; dopoModifica(); });
        document.getElementById('btn-rp-chiudi').addEventListener('click', chiudi);
        box.querySelectorAll('[data-rp-togli]').forEach(b =>
            b.addEventListener('click', () => { punti.splice(Number(b.getAttribute('data-rp-togli')), 1); dopoModifica(); }));
        const riapri = box.querySelector('[data-rp-riapri]');
        if (riapri) riapri.addEventListener('click', () => { anello = false; dopoModifica(); });
        const salva = document.getElementById('btn-rp-salva');
        if (salva) salva.addEventListener('click', salvaBozza);

        if (window.lucide) window.lucide.createIcons();
    }

    let aggancia = true;

    // PUNTO 38 - DIRE SE I NUMERI COMPRENDONO IL RITORNO.
    //
    // Sono due righe di testo e valgono quanto il tasto. Prima del punto 38 il riquadro
    // scriveva "8,4 km totali" senza dire di cosa: chi legge presume che sia la giornata,
    // mentre erano i chilometri dell'andata. Nessuna delle due frasi qui sotto va oltre cio'
    // che il sito sa davvero - non si dichiara "allora ne farai il doppio", perche' un
    // percorso di sola andata puo' benissimo essere una traversata con il rientro in
    // macchina, e non e' il sito a saperlo.
    function tipoPercorso(chiuso) {
        return chiuso
            ? `<p class="small rp-tipo rp-tipo-anello"><i data-lucide="rotate-ccw"></i><span><b>Anello</b> — i
                   numeri qui sotto comprendono il ritorno al punto&nbsp;1.</span></p>`
            : `<p class="small rp-tipo"><i data-lucide="move-right"></i><span><b>Sola andata</b> — i numeri
                   qui sotto NON comprendono il ritorno al punto&nbsp;1. Se torni da dove sei partito, usa
                   "Torna all'inizio".</span></p>`;
    }

    // Il consiglio "togli il ritorno" si da' SOLO se serve davvero, cioe' se la sola andata
    // sta sotto il limite. Su un percorso che e' gia' lungo per conto suo togliere l'anello
    // non cambierebbe niente, e mandare qualcuno a smontare il proprio progetto per un numero
    // che comunque non arriva e' peggio che tacere.
    // L'andata si ricava esatta, non a meta': l'ultima tappa E' il ritorno.
    const LIMITE_QUOTE_M = 25000;   // 500 punti al passo massimo di 50 m, vedi lib/elevation.js
    function suggerisciTogliereIlRitorno(e) {
        if (!anello || !Array.isArray(e.tappe) || e.tappe.length < 2) return false;
        const ritorno = e.tappe[e.tappe.length - 1];
        return (e.metriTotali - (ritorno.metri || 0)) <= LIMITE_QUOTE_M;
    }

    // PUNTO 33 - SALITA, DISCESA E FASCIA DI QUOTA.
    //
    // Fino al 2026-07-28 qui c'era scritto che il dislivello non si poteva calcolare, ed era
    // vero: i sentieri della mappa non hanno la quota (0 su 15.228). Ora le quote arrivano da
    // un modello del terreno interrogato dal server (lib/elevation.js).
    //
    // TRE COSE CHE QUESTO RIQUADRO DEVE DIRE, e non sono decorazione:
    //  - che e' una STIMA, non una misura fatta sul posto;
    //  - DI QUANTO puo' sbagliare. Il +-5% e' misurato, non messo li' per prudenza generica:
    //    ricalcolando due escursioni vere dell'utente (Corno Grande e Monte Gorzano) con
    //    queste quote sono usciti 1204 e 1287 m contro i 1232 e 1312 registrati sul posto,
    //    cioe' -2%; spostando la linea di 25 m il numero si muove di altri ~10 m;
    //  - da dove viene il dato. Open-Meteo e' CC-BY 4.0 su dati Copernicus: citarli non e'
    //    cortesia, e' la licenza - e questo progetto ha "tutto open source" fra i vincoli hard.
    function dislivello(e) {
        if (!e.dislivelloDisponibile) {
            // Non e' un errore da nascondere: chi progetta un'escursione deve sapere che
            // proprio il numero piu' importante manca, invece di vedere un riquadro assente
            // e dedurne che il percorso sia pianeggiante.
            //
            // PUNTO 38 - E DEVE SAPERE PERCHE'. Fino a qui c'era un messaggio solo, "la fonte
            // non ha risposto... riprova fra poco", che su un percorso oltre i 25 km era
            // falso due volte: la fonte aveva risposto benissimo, e riprovare non serviva a
            // niente perche' il limite e' la lunghezza. Chiudere l'anello raddoppia i
            // chilometri, quindi e' un caso che ora si incontra sul serio.
            return e.motivoDislivello === 'troppo lungo'
                ? `<p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i><span>Questo
                    percorso supera i <b>25 km</b>: su una distanza simile le quote non si possono
                    stimare con abbastanza precisione, quindi il dislivello non viene dato invece di
                    darlo sbagliato. Distanza e tracciato qui sopra sono comunque corretti.${suggerisciTogliereIlRitorno(e)
                        ? ' Se ti serve il numero, togli il ritorno: la sola andata sta nel limite.'
                        : ''}</span></p>`
                : `<p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i><span>Il
                    dislivello non e' disponibile in questo momento: la fonte delle quote non ha risposto.
                    Il percorso qui sopra e' comunque corretto. Riprova fra poco.</span></p>`;
        }

        // Solo se ce n'e' davvero: su un percorso tutto sui sentieri questa riga non serve.
        const inRetta = e.salitaInRettaM > 0
            ? ` Di questi, circa <b>${e.salitaInRettaM} m</b> cadono sui tratti in linea d'aria, dove il percorso e' tirato dritto e non segue nessun sentiero.`
            : '';

        // ATTENZIONE, trappola gia' pagata al punto 18 e scritta anche nel CSS:
        // .rp-nota-dislivello e' display:flex, quindi OGNI FIGLIO diventa una colonna. Il
        // testo qui dentro contiene <b>, <br> e <span>, percio' va tutto dentro UN SOLO
        // figlio - altrimenti su schermo stretto la nota si sbriciola in colonnine, e nessun
        // controllo automatico se ne accorge.
        return `
            <div class="rp-quote">
                <div class="rp-totali">
                    <div><strong>&#9650; ${e.salitaM} m</strong><span>salita</span></div>
                    <div><strong>&#9660; ${e.discesaM} m</strong><span>discesa</span></div>
                    <div><strong>${e.quotaMinM}&ndash;${e.quotaMaxM} m</strong><span>quota</span></div>
                </div>
                <p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i><span>Salita e
                    discesa sono <b>stimate da un modello del terreno</b>, non misurate sul posto:
                    possono sbagliare di circa il 5% (una cinquantina di metri ogni mille di
                    salita).${inRetta}
                    <span class="rp-fonte">Quote: Copernicus DEM via Open-Meteo (CC-BY 4.0).</span></span></p>
            </div>`;
    }

    // L'ESPOSIZIONE AL SOLE DEL PERCORSO PROGETTATO (chiesta dall'utente il 2026-07-27:
    // "una volta che abbiamo il progetto possiamo proporre l'esposizione solare sul
    // sentiero").
    //
    // Per un'escursione il sito la stima gia' (renderSolarExposureAdvice in map.js), ma da
    // UN SOLO dato: la direzione dal ritrovo all'ultima vetta. Qui si ha molto di piu' -
    // la linea vera del percorso - quindi si guarda l'orientamento di OGNI TRATTO e si
    // dice quanto del cammino guarda a sud e quanto a nord. E' il dato che serve davvero
    // a decidere a che ora partire.
    // NON si inventa niente sull'ombra degli avvallamenti: per quella servirebbe sapere cosa
    // c'e' INTORNO al percorso, non solo la sua quota, e non lo si sa. Il dislivello invece
    // c'e' dal punto 33, ed e' nel riquadro qui sopra.
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

    // UNA RISPOSTA VECCHIA NON DEVE POTER SOVRASCRIVERE QUELLA NUOVA.
    //
    // TROVATO GUARDANDO UNA SCHERMATA, non da un controllo automatico: a 390 px il riquadro
    // diceva "Anello" e sotto mostrava 6,6 km con salita 932 m e discesa 221 m, cioe' i numeri
    // della SOLA ANDATA. Su un anello salita e discesa si pareggiano per forza (nella stessa
    // prova, a 1440 px, erano 1491 e 1495).
    //
    // LA CAUSA: premendo "Torna all'inizio" mentre il calcolo precedente e' ancora in volo
    // partono due richieste. Se la prima risponde per SECONDA, il suo esito - quello della
    // sola andata - finisce in ultimoEsito e ci resta, mentre l'etichetta viene disegnata
    // dall'interruttore, che intanto dice "anello". Il riquadro dichiara una cosa e conta
    // l'altra: e' esattamente la bugia che il punto 38 e' venuto a togliere, ricomparsa da
    // un'altra porta.
    //
    // LA CORSA C'ERA GIA' PRIMA (aggiungendo tappe in fretta, o toccando l'interruttore dei
    // sentieri), ma finora produceva solo numeri di un attimo prima. Con l'anello produce una
    // CONTRADDIZIONE, ed e' peggio.
    // Il biglietto numerato costa tre righe: chi torna e non ha piu' il numero buono si tace.
    let giroCalcolo = 0;

    async function calcola() {
        if (punti.length < 2) { giroCalcolo++; aggiornaPannello(); return; }
        const mioGiro = ++giroCalcolo;
        inCalcolo = true;
        aggiornaPannello();
        try {
            const res = await fetch('/api/routing/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ punti: puntiDaPercorrere(), agganciaAiSentieri: aggancia })
            });
            const dati = await res.json();
            // Ne e' partito un altro nel frattempo: questa risposta descrive un percorso che
            // non e' piu' quello a schermo. Si butta in silenzio - non e' un errore, e chi e'
            // arrivato dopo di lei sta gia' aggiornando il riquadro.
            if (mioGiro !== giroCalcolo) return;
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
            // Anche l'errore vale solo per il giro corrente: un guasto di rete su una
            // richiesta ormai superata non deve cancellare un percorso valido a schermo.
            if (mioGiro !== giroCalcolo) return;
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
        anello = false;
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
        anello = false;
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
        // Il tetto si conta sulle tappe DA PERCORRERE, quindi ad anello chiuso il ritorno ne
        // occupa una. Fermarsi qui con una spiegazione e' meglio che lasciar partire la
        // richiesta: dal server tornerebbe un 400 e sull'interfaccia sembrerebbe un guasto.
        if (punti.length + (anello ? 1 : 0) >= MAX_PUNTI) {
            if (window.showToast) window.showToast(
                anello
                    ? `Un percorso puo' avere al massimo ${MAX_PUNTI - 1} tappe piu' il ritorno alla partenza.`
                    : `Un percorso puo' avere al massimo ${MAX_PUNTI} tappe.`,
                'error');
            return true;
        }
        // Ad anello chiuso la tappa nuova si infila PRIMA del ritorno da sola, senza bisogno
        // di codice: il ritorno non sta dentro "punti", lo aggiunge puntiDaPercorrere().
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
                // Si salvano le tappe SCELTE piu' l'interruttore, non il ritorno gia' aggiunto:
                // cosi' riaprendo la bozza si puo' ancora togliere l'anello, e i segnaposti
                // restano quelli che l'utente aveva toccato.
                body: JSON.stringify({ nome, punti, anello, agganciaAiSentieri: aggancia })
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
                            <span class="rp-bozza-dati">${b.punti.length} tappe${b.anello ? ' · anello' : ''} · ${metri(b.metriTotali || 0)}${typeof b.salitaM === 'number' ? ` · ▲ ${b.salitaM} m` : ''}${b.metriRetta ? ` · ${metri(b.metriRetta)} in linea d'aria` : ''}</span>
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
        // Le bozze salvate prima del punto 38 non hanno il campo: sono di sola andata, ed e'
        // giusto che restino tali. Il confronto e' con true e non con "diverso da false".
        anello = bozza.anello === true;
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
                    ${/* Punto 38: senza questo, un anello e una sola andata hanno la stessa scheda,
                          e la lunghezza qui accanto vuol dire due cose diverse. */''}
                    ${b.anello
                        ? `<span class="badge badge-green outing-tag" title="Il percorso torna al punto di partenza: la lunghezza comprende il ritorno"><i data-lucide="rotate-ccw"></i> anello</span>`
                        : `<span class="badge outing-tag" title="Il percorso non torna al punto di partenza: la lunghezza NON comprende il ritorno">sola andata</span>`}
                    <button class="outing-card-del" data-prog-del="${esc(b.id)}" title="Cancella questo progetto" aria-label="Cancella ${esc(b.nome)}"><i data-lucide="trash-2"></i></button>
                </div>
                <div class="outing-card-stats">
                    <div><strong>${b.punti.length}</strong><span>tappe</span></div>
                    <div><strong>${metri(b.metriTotali || 0)}</strong><span>lunghezza</span></div>
                    ${/* Punto 33: si mostra SOLO se la salita e' davvero nota. Il campo manca
                          sulle bozze salvate prima, e su quelle salvate mentre la fonte delle
                          quote non rispondeva: scrivere "0 m" in quei casi direbbe "e' tutto
                          in piano", che e' una bugia proprio sul dato che serve a capire se
                          l'escursione e' alla tua portata. Riaprendola, il numero si calcola. */''}
                    ${typeof b.salitaM === 'number'
                        ? `<div title="Stimata da un modello del terreno, puo' sbagliare di circa il 5%"><strong>▲ ${b.salitaM} m</strong><span>salita</span></div>`
                        : ''}
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
