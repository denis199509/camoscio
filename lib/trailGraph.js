// ==========================================================================
// PUNTO 13 — RICERCA DI UN PERCORSO LUNGO I SENTIERI CONOSCIUTI
//
// "Sulla pagina Mappa, scegliere piu' punti in sequenza e vederli collegati seguendo i
//  sentieri conosciuti, con la possibilita' di NON agganciarsi ai sentieri dove non ce ne
//  sono di mappati."
//
// TRE SCELTE DI FONDO, tutte prese per motivi misurati e non per gusto:
//
// 1) SI LEGGE DA MONGODB A RICHIESTA, non da un indice globale tenuto in RAM.
//    In Fase G l'indice in memoria ha gia' fatto cadere il sito (512 MB in tutto su
//    Render, picco misurato ~394 MB), e i dati del punto 13 piu' che raddoppiano il
//    totale. In piu' cosi' funziona anche in MARCHE e MOLISE, che sono sul database ma
//    non vengono caricate in memoria (ACTIVE_REGIONS in lib/trailIndex.js).
//    Il costo e' una lettura per ogni tappa, misurata sotto il secondo su un riquadro
//    da 12 km di lato.
//
// 2) UN NODO PER COORDINATA ESATTA. Due sentieri che si incontrano su un nodo OSM hanno
//    coordinate IDENTICHE - verificato: sul database sono salvate a precisione piena, non
//    arrotondate. Quindi la topologia vera si ricostruisce dalla sola geometria, senza
//    aver bisogno degli id dei nodi OSM che il modello Trail non salva.
//
// 3) TETTI SU TUTTO, e quando si superano NON si sbaglia: si dice "non trovato", che e'
//    gia' il caso previsto (retta automatica, decisione dell'utente). Una ricerca che
//    esplora senza limiti su un server da 512 MB e' il modo di ripetere l'incidente.
// ==========================================================================

const Trail = require('../models/Trail');
const { haversineKm, metersPerDegree } = require('./geometry');
const { celleDiRiquadro } = require('./trailCells');
const { quoteDelPercorso } = require('./elevation');                 // punto 33
const { statisticheTraccia, SOGLIA_DISLIVELLO_M } = require('./gpx'); // punto 33

// Quanto lontano puo' stare un punto scelto dall'utente dal sentiero piu' vicino perche'
// abbia senso dire "parte da li'". Oltre, quella tappa diventa una retta: e' il
// comportamento concordato, non un errore.
// 300 m e non meno: su una mappa da telefono il dito non e' preciso, e le misure del
// 2026-07-27 mostrano agganci reali fra 0 e 48 m sui punti veri (Campo Imperatore, Sella
// di Monte Aquila). Il margine serve al dito, non ai dati.
const TOLLERANZA_AGGANCIO_M = 300;

// Tetti di sicurezza. Superarli non e' un errore da segnalare: e' un "non trovato".
const MAX_NODI = 400000;        // misurato: un riquadro da 12 km di lato ne ha ~66.000
const MAX_ESPLORATI = 300000;   // quanti nodi l'A* puo' aprire prima di arrendersi
const MAX_LATO_RIQUADRO_GRADI = 0.6; // ~60 km: oltre, non e' piu' una tappa di un'escursione

// --- coda di priorita' (heap binario) ---
// Scritta a mano, come Douglas-Peucker e la geometria: e' una ventina di righe e evita una
// dipendenza in piu' (stesso criterio con cui in Fase G si e' tolto @turf/turf).
class Coda {
    constructor() { this.v = []; }
    get vuota() { return this.v.length === 0; }
    push(nodo, costo) {
        this.v.push({ nodo, costo });
        let i = this.v.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.v[p].costo <= this.v[i].costo) break;
            [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
            i = p;
        }
    }
    pop() {
        const primo = this.v[0];
        const ultimo = this.v.pop();
        if (this.v.length) {
            this.v[0] = ultimo;
            let i = 0;
            for (;;) {
                const s = 2 * i + 1, d = s + 1;
                let m = i;
                if (s < this.v.length && this.v[s].costo < this.v[m].costo) m = s;
                if (d < this.v.length && this.v[d].costo < this.v[m].costo) m = d;
                if (m === i) break;
                [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
                i = m;
            }
        }
        return primo;
    }
}

const chiaveDi = (lng, lat) => `${lng.toFixed(7)},${lat.toFixed(7)}`;

// Il riquadro che contiene due punti, allargato quanto basta perche' il percorso possa
// uscire dalla linea che li unisce: un sentiero che gira attorno a un costone puo'
// allontanarsi parecchio dalla retta, e cercarlo in un riquadro stretto vorrebbe dire non
// trovarlo e tirare una retta al suo posto.
function riquadroPerTappa(da, a) {
    const margine = Math.max(
        0.02, // ~2 km: sotto questo un riquadro e' cosi' stretto da tagliare qualunque giro
        Math.hypot(a[0] - da[0], a[1] - da[1]) * 0.75
    );
    return {
        ovest: Math.min(da[0], a[0]) - margine,
        est: Math.max(da[0], a[0]) + margine,
        sud: Math.min(da[1], a[1]) - margine,
        nord: Math.max(da[1], a[1]) + margine
    };
}

// Legge da MongoDB i sentieri che attraversano il riquadro. Solo le coordinate: name,
// sacScale e il resto qui non servono e sono banda sprecata.
async function caricaRiquadro(riquadro) {
    if ((riquadro.est - riquadro.ovest) > MAX_LATO_RIQUADRO_GRADI ||
        (riquadro.nord - riquadro.sud) > MAX_LATO_RIQUADRO_GRADI) {
        return null; // troppo grande: il chiamante tira la retta
    }
    const celle = celleDiRiquadro(riquadro);
    const sentieri = await Trail.find({ cells: { $in: celle } }, { coordinates: 1, _id: 0 }).lean();
    return sentieri.map(s => s.coordinates);
}

// Grafo: nodo = coordinata esatta, arco = coppia di punti consecutivi di un sentiero,
// peso = metri. Le posizioni stanno in un array piatto e i nodi sono numeri interi, non
// stringhe: con centinaia di migliaia di nodi la differenza di memoria e' quella gia'
// misurata in Fase G fra 450 MB e 247 (vedi lib/trailIndex.js).
function costruisciGrafo(linee) {
    const indiceDi = new Map(); // chiave testuale -> indice numerico del nodo
    const lng = [], lat = [];
    const archi = [];           // per nodo: array di [nodoVicino, metri]

    const nodo = (x, y) => {
        const k = chiaveDi(x, y);
        let i = indiceDi.get(k);
        if (i === undefined) {
            i = lng.length;
            indiceDi.set(k, i);
            lng.push(x); lat.push(y);
            archi.push([]);
        }
        return i;
    };

    for (const linea of linee) {
        let precedente = -1;
        for (const p of linea) {
            if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { precedente = -1; continue; }
            if (lng.length >= MAX_NODI) return null; // tetto raggiunto: si rinuncia
            const corrente = nodo(p[0], p[1]);
            if (precedente >= 0 && precedente !== corrente) {
                const metri = haversineKm(lat[precedente], lng[precedente], lat[corrente], lng[corrente]) * 1000;
                archi[precedente].push([corrente, metri]);
                archi[corrente].push([precedente, metri]);
            }
            precedente = corrente;
        }
    }
    return { lng, lat, archi, quanti: lng.length };
}

// Il nodo piu' vicino a un punto, entro la tolleranza. Griglia invece di scorrere tutto:
// con 400.000 nodi e piu' tappe, scorrere sarebbe la parte piu' lenta di tutto.
function costruisciRicerca(grafo) {
    const latRif = grafo.quanti ? grafo.lat[0] : 42;
    const { mLat, mLng } = metersPerDegree(latRif);
    const pLat = TOLLERANZA_AGGANCIO_M / mLat, pLng = TOLLERANZA_AGGANCIO_M / mLng;
    const celle = new Map();
    for (let i = 0; i < grafo.quanti; i++) {
        const k = `${Math.floor(grafo.lng[i] / pLng)},${Math.floor(grafo.lat[i] / pLat)}`;
        let a = celle.get(k);
        if (!a) { a = []; celle.set(k, a); }
        a.push(i);
    }
    return function nodoPiuVicino(punto) {
        const cx = Math.floor(punto[0] / pLng), cy = Math.floor(punto[1] / pLat);
        let migliore = -1, distanza = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const i of celle.get(`${cx + dx},${cy + dy}`) || []) {
                    const d = haversineKm(punto[1], punto[0], grafo.lat[i], grafo.lng[i]) * 1000;
                    if (d < distanza) { distanza = d; migliore = i; }
                }
            }
        }
        return distanza <= TOLLERANZA_AGGANCIO_M ? { nodo: migliore, distanzaM: distanza } : null;
    };
}

// A* con la distanza in linea d'aria come stima: non sovrastima mai la distanza vera lungo
// i sentieri (che e' sempre >= la retta), quindi il percorso trovato e' il piu' corto -
// non "uno che va bene".
function cercaCammino(grafo, partenza, arrivo) {
    const costo = new Map([[partenza, 0]]);
    const daDove = new Map();
    const chiusi = new Set();
    const coda = new Coda();

    const stima = i => haversineKm(grafo.lat[i], grafo.lng[i], grafo.lat[arrivo], grafo.lng[arrivo]) * 1000;
    coda.push(partenza, stima(partenza));

    let esplorati = 0;
    while (!coda.vuota) {
        const { nodo } = coda.pop();
        if (chiusi.has(nodo)) continue;
        chiusi.add(nodo);
        if (++esplorati > MAX_ESPLORATI) return null;

        if (nodo === arrivo) {
            const percorso = [];
            let k = arrivo;
            while (k !== undefined) { percorso.push([grafo.lng[k], grafo.lat[k]]); k = daDove.get(k); }
            percorso.reverse();
            return { percorso, metri: Math.round(costo.get(arrivo)), esplorati };
        }

        const g = costo.get(nodo);
        for (const [vicino, metri] of grafo.archi[nodo]) {
            if (chiusi.has(vicino)) continue;
            const nuovo = g + metri;
            if (nuovo < (costo.get(vicino) ?? Infinity)) {
                costo.set(vicino, nuovo);
                daDove.set(vicino, nodo);
                coda.push(vicino, nuovo + stima(vicino));
            }
        }
    }
    return null; // i due punti non sono nella stessa rete: e' il 4,3% dei casi misurati
}

// UNA TAPPA su un grafo GIA' costruito. Restituisce SEMPRE qualcosa, mai un errore: dove
// il percorso sui sentieri non esiste si torna una retta ben dichiarata. E' la decisione
// presa dall'utente il 2026-07-27 - il percorso si completa sempre, ma il tratto in linea
// d'aria deve VEDERSI, ed e' il campo "tipo" a permettere all'interfaccia di segnalarlo.
function tappaSuGrafo(da, a, grafo, cerca) {
    const rettaM = Math.round(haversineKm(da[1], da[0], a[1], a[0]) * 1000);
    const retta = motivo => ({ tipo: 'retta', coordinate: [da, a], metri: rettaM, motivo });

    if (!grafo) return retta('nessun sentiero mappato in zona');
    const p = cerca(da), q = cerca(a);
    if (!p) return retta('il punto di partenza e\' lontano da ogni sentiero');
    if (!q) return retta('il punto di arrivo e\' lontano da ogni sentiero');
    if (p.nodo === q.nodo) return retta('i due punti cadono sullo stesso punto del sentiero');

    const esito = cercaCammino(grafo, p.nodo, q.nodo);
    if (!esito) return retta('nessun sentiero collega i due punti');

    // Si riattaccano gli estremi scelti dall'utente: il percorso deve partire da DOVE HA
    // TOCCATO LUI, non dal nodo del sentiero, altrimenti sulla mappa la linea comincia
    // staccata dal segnaposto e sembra un difetto.
    return {
        tipo: 'sentiero',
        coordinate: [da, ...esito.percorso, a],
        metri: esito.metri + Math.round(p.distanzaM + q.distanzaM),
        agganciopartenzaM: Math.round(p.distanzaM),
        aggancioArrivoM: Math.round(q.distanzaM)
    };
}

// Una tappa sola, caricando i sentieri per lei. Usata quando l'insieme dei punti e' troppo
// grande per stare in un riquadro unico.
async function collegaDuePunti(da, a, { agganciaAiSentieri = true } = {}) {
    if (!agganciaAiSentieri) {
        return { tipo: 'retta', coordinate: [da, a], metri: Math.round(haversineKm(da[1], da[0], a[1], a[0]) * 1000), motivo: 'scelta' };
    }
    const linee = await caricaRiquadro(riquadroPerTappa(da, a));
    if (linee === null) {
        return { tipo: 'retta', coordinate: [da, a], metri: Math.round(haversineKm(da[1], da[0], a[1], a[0]) * 1000), motivo: 'tappa troppo lunga' };
    }
    const grafo = linee.length ? costruisciGrafo(linee) : null;
    return tappaSuGrafo(da, a, grafo, grafo ? costruisciRicerca(grafo) : null);
}

// L'INTERO PERCORSO su piu' punti.
//
// SI CARICA UNA VOLTA SOLA per tutti i punti, non una per tappa. Misurato: una tappa sola
// costa ~1,6 secondi, quasi tutti spesi a leggere da MongoDB e a costruire il grafo. Con
// cinque punti, una lettura per tappa farebbero otto secondi di attesa per un lavoro che
// si fa una volta - e i riquadri di tappe consecutive si sovrappongono quasi sempre,
// quindi si rileggerebbero gli stessi sentieri piu' volte.
// Se l'insieme dei punti e' troppo largo per un riquadro solo si torna al modo tappa per
// tappa, che regge qualunque distanza.
async function progettaPercorso(punti, opzioni = {}) {
    const { agganciaAiSentieri = true } = opzioni;
    const tappe = [];

    if (!agganciaAiSentieri) {
        for (let i = 1; i < punti.length; i++) tappe.push(await collegaDuePunti(punti[i - 1], punti[i], opzioni));
    } else {
        const complessivo = punti.reduce((r, p) => ({
            ovest: Math.min(r.ovest, p[0]), est: Math.max(r.est, p[0]),
            sud: Math.min(r.sud, p[1]), nord: Math.max(r.nord, p[1])
        }), { ovest: Infinity, est: -Infinity, sud: Infinity, nord: -Infinity });
        // Stesso margine di una tappa singola, calcolato sulla diagonale di tutto l'insieme.
        const margine = Math.max(0.02, Math.hypot(complessivo.est - complessivo.ovest, complessivo.nord - complessivo.sud) * 0.75);
        const riquadro = {
            ovest: complessivo.ovest - margine, est: complessivo.est + margine,
            sud: complessivo.sud - margine, nord: complessivo.nord + margine
        };

        const linee = await caricaRiquadro(riquadro);
        if (linee === null) {
            // Troppo largo per una lettura sola: tappa per tappa.
            for (let i = 1; i < punti.length; i++) tappe.push(await collegaDuePunti(punti[i - 1], punti[i], opzioni));
        } else {
            const grafo = linee.length ? costruisciGrafo(linee) : null;
            const cerca = grafo ? costruisciRicerca(grafo) : null;
            for (let i = 1; i < punti.length; i++) tappe.push(tappaSuGrafo(punti[i - 1], punti[i], grafo, cerca));
        }
    }

    const metriSentiero = tappe.filter(t => t.tipo === 'sentiero').reduce((s, t) => s + t.metri, 0);
    const metriRetta = tappe.filter(t => t.tipo === 'retta').reduce((s, t) => s + t.metri, 0);

    const quote = await dislivelloDelleTappe(tappe, opzioni);

    return {
        tappe,
        metriTotali: metriSentiero + metriRetta,
        metriSentiero,
        metriRetta,
        tappeInRetta: tappe.filter(t => t.tipo === 'retta').length,
        // I sentieri sul database NON hanno la quota (0 su 15.228): fino al punto 33 qui non
        // si restituiva nessun dislivello, e si diceva. Ora le quote arrivano da un modello
        // del terreno (lib/elevation.js), che e' una STIMA - per questo il campo resta e puo'
        // ancora essere false: quando la fonte non risponde si torna a dire che non c'e'.
        dislivelloDisponibile: !!quote,
        ...(quote || {})
    };
}

// La lunghezza vera della polilinea di una tappa. NON si usa t.metri: per una tappa sui
// sentieri quel numero comprende anche i due tratti di aggancio agli estremi, quindi non
// corrisponde alla linea disegnata, ed e' sulla linea disegnata che si misurano le quote.
function lunghezzaPolilineaM(coordinate) {
    let m = 0;
    for (let i = 1; i < coordinate.length; i++) {
        m += haversineKm(coordinate[i - 1][1], coordinate[i - 1][0], coordinate[i][1], coordinate[i][0]) * 1000;
    }
    return m;
}

// PUNTO 33 - salita, discesa e fascia di quota del percorso appena progettato.
//
// NON LANCIA MAI: se la fonte delle quote non risponde si torna null e il percorso resta
// esattamente quello di prima. E' la regola presa col punto 34 - progettare un percorso non
// puo' dipendere da un servizio esterno.
async function dislivelloDelleTappe(tappe, opzioni = {}) {
    if (opzioni.saltaQuote) return null;   // usato dalle prove per il caso "fonte guasta"
    if (!tappe.length) return null;

    // I punti di giunzione fra due tappe restano duplicati di proposito: un segmento di
    // lunghezza zero non sposta niente nel campionamento, e cosi' le lunghezze delle singole
    // tappe restano esatte, il che serve per ritrovarle dentro il profilo.
    const linea = [];
    for (const t of tappe) linea.push(...t.coordinate);

    const esito = await quoteDelPercorso(linea);
    if (!esito) return null;

    // Quanta della salita cade sui tratti tirati in linea d'aria. Si calcola sul profilo GIA'
    // scaricato, senza nessuna chiamata in piu'.
    // E' un "circa" ed e' giusto chiamarlo cosi': la regola della salita guarda quanto si e'
    // saliti sopra l'ultimo avvallamento, quindi i pezzi misurati separatamente non fanno la
    // somma esatta del totale. Serve a rispondere a una domanda pratica - "questa fatica e'
    // sul sentiero o sul tratto che mi stai dicendo di non seguire?" - non a far quadrare i conti.
    let salitaInRettaM = 0;
    let daM = 0;
    for (const t of tappe) {
        const lung = lunghezzaPolilineaM(t.coordinate);
        if (t.tipo === 'retta' && lung > 0) {
            const da = Math.floor(daM / esito.passoM);
            const a = Math.min(esito.profilo.length - 1, Math.ceil((daM + lung) / esito.passoM));
            if (a - da >= 1) {
                salitaInRettaM += statisticheTraccia(esito.profilo.slice(da, a + 1), SOGLIA_DISLIVELLO_M, haversineKm).dislivelloM;
            }
        }
        daM += lung;
    }

    return {
        salitaM: esito.salitaM,
        discesaM: esito.discesaM,
        quotaMinM: esito.quotaMinM,
        quotaMaxM: esito.quotaMaxM,
        salitaInRettaM: Math.round(salitaInRettaM)
    };
}

module.exports = {
    progettaPercorso,
    collegaDuePunti,
    riquadroPerTappa,
    caricaRiquadro,
    costruisciGrafo,
    costruisciRicerca,
    cercaCammino,
    TOLLERANZA_AGGANCIO_M,
    MAX_NODI,
    MAX_LATO_RIQUADRO_GRADI
};
