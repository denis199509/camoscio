// ==========================================================================
// FORMULA DI SINTESI CAI — l'unica copia, letta dal browser E dal server.
//
// Fino al punto 92 viveva SOLO in public/js/profile.js (calculateHikeTimes), e il server
// non ne aveva bisogno: il passo personale si misurava come semplice dislivello/ore.
// Quell'agente ha trovato il difetto che ha reso necessario questo file: un escursionista
// che cammina ESATTAMENTE come lo standard CAI (400 m/h in salita, discesa e piano contati
// a parte) veniva MISURATO a ~267 m/h con la divisione semplice, perche' il denominatore
// contiene tutta l'uscita (salita+discesa+piano) mentre i 400 CAI descrivono la sola
// salita - un difetto strutturale che sottostima chiunque, sempre, indipendentemente da
// quanto vada piano o veloce davvero.
//
// La correzione (decisione di Denis, punto 92): invece di misurare come "dislivello/ore
// totali", ci si chiede "quale passo di salita, messo nella stessa formula CAI, avrebbe
// predetto ESATTAMENTE il tempo impiegato?" - e' l'inverso della formula, non una seconda
// formula: passoDaOre(oreCai(d, s, p), d, s) === p per costruzione.
//
// STESSO GIRO DI SCATOLE di public/js/badge-points.js (letto dal server con require(),
// dal browser con <script>): un'unica copia, mai due formule che possono divergere in
// silenzio - la lezione del punto 18.
// ==========================================================================

(function (contenuto) {
    const esportato = contenuto();
    if (typeof module === 'object' && module.exports) {
        module.exports = esportato;                 // server (CommonJS)
    } else if (typeof window !== 'undefined') {
        // "window" e' un identificatore DICHIARATO qui, mai self/this: nel browser vero
        // window E' il global, ma nelle prove che caricano questo file con
        // new Function('window', sorgente)(finestra) (public/js/profile.js lo fa gia' per
        // badge-points.js in un contesto simile) "window" e' un parametro finto, e self/this
        // dentro una funzione chiamata cosi' punterebbero al global vero di Node, non al
        // parametro - scrivendo il valore nel posto sbagliato.
        Object.assign(window, esportato);
    }
})(function () {

    // Standard CAI: 400 m/h in salita, 600 m/h in discesa (mai calcolata qui: nessuno dei
    // due lati misura mai una velocita' di discesa diretta), 4 km/h in piano.
    const PASSO_SALITA_CAI = 400;
    const VELOCITA_PIANO_KMH = 4;

    // Formula di sintesi CAI: le ore di dislivello e le ore di sviluppo (piano) non si
    // sommano - la piu' lunga conta intera, l'altra solo per meta' (si presume che salita
    // e piano si intreccino nello stesso percorso, non che si accodino uno all'altro).
    function oreCai(dislivelloM, distanzaKm, passoSalitaMh) {
        const passo = passoSalitaMh > 0 ? passoSalitaMh : PASSO_SALITA_CAI;
        const tVert = dislivelloM / passo;
        const tFlat = distanzaKm / VELOCITA_PIANO_KMH;
        return Math.max(tVert, tFlat) + Math.min(tVert, tFlat) / 2;
    }

    // L'INVERSO: quale passo di salita, dentro oreCai(), avrebbe predetto esattamente "ore"
    // per questo dislivello/distanza? E' la conversione misura->osservazione del punto 92
    // (usata da lib/hikeStats.js:paceUpDaMisura, che applica anche i limiti di
    // plausibilita' - qui vive solo la matematica).
    //
    // F = ore "in piano" di riferimento. Se ore <= F, il cammino e' stato piu' veloce del
    // solo riferimento in piano: si e' fuori dal regime che la formula sa descrivere (non
    // si puo' dire quanta parte del tempo era salita), si restituisce null invece di un
    // numero che sembra una misura e non lo e'.
    // Il ramo dipende da quale dei due addendi (tVert o tFlat) era il maggiore in oreCai():
    // se tVert >= tFlat (ore >= 1.5*F, cioe' tVert = ore - tFlat/2 = ore - F/2), altrimenti
    // tFlat era il maggiore e tVert = 2*(ore - F).
    function passoDaOre(dislivelloM, distanzaKm, ore) {
        const F = distanzaKm / VELOCITA_PIANO_KMH;
        if (!(ore > F)) return null;
        const tVert = (ore >= 1.5 * F) ? (ore - F / 2) : 2 * (ore - F);
        if (!(tVert > 0)) return null;
        return dislivelloM / tVert;
    }

    return { oreCai, passoDaOre, PASSO_SALITA_CAI, VELOCITA_PIANO_KMH };
});
