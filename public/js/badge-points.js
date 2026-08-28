// ==========================================================================
// CATALOGO DEI PUNTI TIMBRABILI — l'unica copia, letta dal browser E dal server.
//
// PERCHE' QUESTO FILE ESISTE. Fino al 2026-07-27 il catalogo stava dentro
// public/js/badges.js, cioe' solo nel browser, e bastava: i timbri si sbloccavano
// unicamente col geofencing della Mappa, che gira li'. Poi l'utente ha chiesto che
// importando una traccia .gpx i badge conquistati vengano assegnati da soli - e
// l'importazione la fa il SERVER, che di questo elenco non sapeva niente.
//
// La strada facile sarebbe stata copiarne una versione in lib/. Non si e' fatto per la
// lezione pagata al punto 18 e scritta in cronologia.txt: "quando lo stesso blocco compare
// due volte, la differenza fra le due copie e' quasi sempre un difetto rimasto aperto in
// una sola" - li' era un escapeHtml mancante, cioe' un buco XSS sopravvissuto alla Fase H
// proprio perche' era una copia. Qui divergere vorrebbe dire una cosa precisa e brutta:
// un badge che la pagina mostra e che l'importazione non sa assegnare, o il contrario.
//
// Quindi UNA copia sola, in un file che sanno leggere entrambi:
//  - il browser lo carica con <script> e trova window.CAMOSCIO_BADGE_POINTS;
//  - il server fa require('../public/js/badge-points.js') e riceve lo stesso array.
// Il giro di scatole qui sotto serve solo a questo. Non c'e' nessun passo di
// compilazione in questo progetto (niente bundler, e' una scelta di sempre), e il
// browser ha bisogno dell'elenco SUBITO, non dopo una chiamata di rete: badges.js lo usa
// mentre disegna e map.js ad ogni fix GPS. Un endpoint da interrogare avrebbe voluto dire
// rendere asincrono del codice che non ha motivo di esserlo.
//
// DUE COSE DA SAPERE PRIMA DI TOCCARE QUESTO ELENCO:
//
// 1) GLI stampId NON SI CAMBIANO MAI. Sono la chiave con cui i timbri stanno salvati sul
//    database (collezione Stamp): rinominarne uno farebbe sparire dal passaporto i timbri
//    che gli utenti hanno gia' preso. I quattro codici storici (stamp_gemelli,
//    stamp_margherita, stamp_mezzeno, stamp_gnifetti) sono nomi rimasti da una demo alpina
//    di prima del progetto e non c'entrano niente con i luoghi appenninici che indicano
//    oggi. Restano cosi' per questo motivo, non per distrazione.
//
// 2) LE COORDINATE DEVONO ESSERE VERE, cercate su Overpass per TAG (natural=peak,
//    tourism=alpine_hut) e verificate con lib/regions.js che cadano dentro le quattro
//    regioni. Nominatim non va bene per la montagna, nemmeno cercando per nome: 7 ricerche
//    su 13 a vuoto, fra cui Monte Amaro e Monte Vettore (misurato al punto 18).
//    E non e' pignoleria: la soglia per timbrare e' 150 metri, quindi una coordinata
//    sbagliata di poco rende il badge impossibile da prendere anche stando in vetta.
// ==========================================================================

(function (radice, contenuto) {
    if (typeof module === 'object' && module.exports) {
        module.exports = contenuto();              // server (CommonJS)
    } else {
        radice.CAMOSCIO_BADGE_POINTS = contenuto(); // browser
    }
})(typeof self !== 'undefined' ? self : this, function () {
    return [
        // --- CIME ---
        // COORDINATE CORRETTE IL 2026-07-27. Le quattro voci storiche avevano coordinate
        // ereditate dalla vecchia demo alpina (per le due cime: quelle scritte dentro le
        // escursioni sul database), mai verificate. Cercate su Overpass sono risultate
        // sbagliate di 493 m il Corno Grande, 2.440 m il Rifugio Franchetti e 744 m il
        // Bivacco Zilioli - cioe' MOLTO oltre i 150 metri della soglia per timbrare.
        // Erano quindi tre badge che il sito mostrava e che stando nel posto vero NON si
        // potevano prendere: lo stesso difetto che il punto 18 aveva chiuso per i badge
        // nuovi, rimasto aperto proprio su quelli piu' vecchi.
        // Che i luoghi previsti fossero quelli giusti lo conferma la quota: 2912, 2476 e
        // 2433 metri coincidono esattamente con quelle di OSM. Erano sbagliate solo le
        // posizioni. Gli stampId NON sono stati toccati (vedi punto 1 in cima al file).
        // Icone (18/08/2026, stesso meccanismo del punto 91 per i rifugi): sei file forniti
        // da Denis in public/img/badge-luoghi/, emoji lasciata com'era - resta il ripiego se
        // l'immagine manca o non carica (schedaBadge in badges.js). Nessuna coordinata o
        // quota toccata: le cifre disegnate sulle icone sono decorative (illustrazioni, non
        // fonti verificate), non la base per un numero del catalogo.
        { stampId: 'stamp_gemelli',     nome: 'Corno Grande',             tipo: 'cima',    quota: 2912, lat: 42.46930, lng: 13.56550, zona: 'Gran Sasso',       regione: 'Abruzzo', emoji: '⛺',  icona: 'img/badge-luoghi/corno-grande.png' },
        { stampId: 'stamp_margherita',  nome: 'Monte Vettore',            tipo: 'cima',    quota: 2476, lat: 42.82441, lng: 13.27497, zona: 'Monti Sibillini',  regione: 'Marche',  emoji: '👑',  icona: 'img/badge-luoghi/monte-vettore.png' },
        { stampId: 'badge_amaro',       nome: 'Monte Amaro',              tipo: 'cima',    quota: 2793, lat: 42.08633, lng: 14.08591, zona: 'Maiella',          regione: 'Abruzzo', emoji: '🗻',  icona: 'img/badge-luoghi/monte-amaro.png' },
        { stampId: 'badge_gorzano',     nome: 'Monte Gorzano',            tipo: 'cima',    quota: 2458, lat: 42.61822, lng: 13.39560, zona: 'Monti della Laga', regione: 'Abruzzo', emoji: '⛰️', icona: 'img/badge-luoghi/monte-gorzano.png' },
        { stampId: 'badge_terminillo',  nome: 'Monte Terminillo',         tipo: 'cima',    quota: 2217, lat: 42.47330, lng: 12.99736, zona: 'Terminillo',       regione: 'Lazio',   emoji: '🏔️', icona: 'img/badge-luoghi/monte-terminillo.png' },
        { stampId: 'badge_miletto',     nome: 'Monte Miletto',            tipo: 'cima',    quota: 2050, lat: 41.44962, lng: 14.37209, zona: 'Matese',           regione: 'Molise',  emoji: '🌄',  icona: 'img/badge-luoghi/monte-miletto.png' },

        // Otto voci nuove (18/08/2026), stesso criterio del punto 1 in cima al file: coordinate
        // e quote confermate su Overpass (natural=peak), non prese dalle icone. Sette su otto
        // sono risultate identiche fino alla quinta cifra decimale ai dati dati da Denis, quota
        // compresa - le cifre disegnate sulle icone (anche loro identiche) sono quindi corrette
        // per coincidenza, non per essere una fonte affidabile in generale (vedi Bivacco Ju
        // Busciu subito sotto, dove NON coincidono).
        { stampId: 'badge_cornopiccolo',  nome: 'Corno Piccolo',        tipo: 'cima', quota: 2655, lat: 42.47913, lng: 13.55998, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🪨',  icona: 'img/badge-luoghi/corno-piccolo.png' },
        { stampId: 'badge_brancastello',  nome: 'Monte Brancastello',   tipo: 'cima', quota: 2385, lat: 42.44736, lng: 13.63990, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🏞️', icona: 'img/badge-luoghi/monte-brancastello.png' },
        { stampId: 'badge_camicia',       nome: 'Monte Camicia',        tipo: 'cima', quota: 2564, lat: 42.43922, lng: 13.71842, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🌋',  icona: 'img/badge-luoghi/monte-camicia.png' },
        { stampId: 'badge_corvo',         nome: 'Monte Corvo',          tipo: 'cima', quota: 2623, lat: 42.47918, lng: 13.49352, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🐦‍⬛', icona: 'img/badge-luoghi/monte-corvo.png' },
        { stampId: 'badge_prena',         nome: 'Monte Prena',          tipo: 'cima', quota: 2561, lat: 42.44227, lng: 13.68282, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🏕️', icona: 'img/badge-luoghi/monte-prena.png' },
        // OSM registra questa vetta come "Pizzo d'Intermesoli" (con l'apostrofo): il nome
        // mostrato resta "Pizzo Intermesoli", come scritto da Denis e come titola la voce
        // Wikipedia collegata allo stesso nodo OSM (it:Pizzo Intermesoli) - stessa scelta gia'
        // fatta per Rifugio Zilioli (nome d'uso invece del nome tecnico OSM).
        { stampId: 'badge_intermesoli',   nome: 'Pizzo Intermesoli',    tipo: 'cima', quota: 2635, lat: 42.47253, lng: 13.52724, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🙏',  icona: 'img/badge-luoghi/pizzo-intermesoli.png' },
        { stampId: 'badge_viglio',        nome: 'Monte Viglio',         tipo: 'cima', quota: 2156, lat: 41.88476, lng: 13.37388, zona: 'Monti Simbruini', regione: 'Lazio', emoji: '🕊️', icona: 'img/badge-luoghi/monte-viglio.png' },

        // Due cime nuove (2026-08-28), gruppo del Velino - prime voci del catalogo per la zona
        // Sirente-Velino. Coordinate e quota da Overpass (natural=peak): node 26863998 Monte
        // Velino (ele 2486) e node 1911867131 Monte Cafornia (ele 2424), identiche alle cifre
        // disegnate sulle icone fornite da Denis. Regione confermata con lib/regions.js
        // (Abruzzo), stesso criterio delle otto voci sopra.
        { stampId: 'badge_velino',        nome: 'Monte Velino',         tipo: 'cima', quota: 2486, lat: 42.14704, lng: 13.38166, zona: 'Sirente-Velino', regione: 'Abruzzo', emoji: '🏔️', icona: 'img/badge-luoghi/monte-velino.png' },
        { stampId: 'badge_cafornia',      nome: 'Monte Cafornia',       tipo: 'cima', quota: 2424, lat: 42.14306, lng: 13.39526, zona: 'Sirente-Velino', regione: 'Abruzzo', emoji: '⛰️', icona: 'img/badge-luoghi/monte-cafornia.png' },

        // --- RIFUGI ---
        // Anche queste due corrette il 2026-07-27, vedi la nota sopra. In OSM il secondo
        // e' registrato come "Bivacco Tito Zilioli" (wilderness_hut, 2253 m): il nome
        // mostrato resta "Rifugio Zilioli", che e' come lo chiamano in zona ed e' quello
        // che gli utenti vedono gia' nel passaporto.
        //
        // "icona" (punto 91, 18/08/2026): facoltativa, un file in public/img/badge-luoghi/
        // invece dell'emoji - emoji resta scritta comunque, e' il ripiego se un giorno
        // l'immagine manca o non carica (vedi schedaBadge in badges.js). Tre rifugi finora,
        // scelti da Denis: gli altri restano a emoji finche' non arrivano altre icone.
        //
        // Zilioli, quota 2250 (non 2253 come sopra): corretta il 18/08/2026 su richiesta
        // esplicita di Denis, per farla coincidere col numero scritto sull'icona nuova
        // (badge-luoghi/rifugio-zilioli.png dice "2250 m"). 2253 resta il dato OSM del
        // "Bivacco Tito Zilioli" (nota qui sopra) - i tre metri di scarto non vengono da un
        // errore trovato in nessuna delle due fonti, e' una scelta di quale numero mostrare.
        // NON "correggerla" di nuovo a 2253 ricontrollando OSM: e' gia' successo il contrario
        // una volta in questo file (vedi nota in cima), qui la richiesta va nella direzione
        // opposta ed e' voluta.
        //
        // Coordinate di entrambi i rifugi RIFINITE il 2026-08-28 su lettura DMS fornita da
        // Denis (Franchetti 42°28'37.4"N 13°33'54.3"E -> 42.47706 / 13.56508; Zilioli
        // 42°49'02.3"N 13°16'06.2"E -> 42.81731 / 13.26839): spostamento ~13 m ciascuna
        // rispetto ai valori del 2026-07-27, ben dentro i 150 m della soglia per timbrare
        // sia prima sia dopo. Quota NON toccata.
        { stampId: 'stamp_mezzeno',     nome: 'Rifugio Franchetti',       tipo: 'rifugio', quota: 2433, lat: 42.47706, lng: 13.56508, zona: 'Gran Sasso',       regione: 'Abruzzo', emoji: '🧗',  icona: 'img/badge-luoghi/rifugio-franchetti.png' },
        { stampId: 'stamp_gnifetti',    nome: 'Rifugio Zilioli',          tipo: 'rifugio', quota: 2250, lat: 42.81731, lng: 13.26839, zona: 'Monti Sibillini',  regione: 'Marche',  emoji: '❄️', icona: 'img/badge-luoghi/rifugio-zilioli.png' },
        // Rifugio Bruno Pomilio TOLTO il 18/08/2026, sostituito da Denis con questo bivacco -
        // stampId nuovo (badge_fusco), non badge_pomilio riusato: sono due luoghi diversi, e
        // lo stampId e' la chiave con cui i timbri stanno sul database (vedi punto 1 in cima
        // al file) - nessun utente reale aveva ancora preso badge_pomilio (verificato sul
        // database prima di toglierlo), quindi non resta nessun timbro orfano.
        // Coordinate date da Denis, confermate identiche (fino alla sesta cifra decimale) da
        // https://www.escursionismo.it/rifugi-bivacchi/fusco-carlo-16068 - non indovinate,
        // stesso criterio del punto 1 in cima al file. Quota 2455 m dalla fonte ufficiale del
        // parco (https://www.parcomajella.it/bivacco-fusco-1.htm), 2450 m su escursionismo.it -
        // scarto di 5 m fra le due fonti, si usa quella ufficiale. Regione confermata con
        // lib/regions.js (Abruzzo).
        { stampId: 'badge_fusco',       nome: 'Bivacco Carlo Fusco',      tipo: 'rifugio', quota: 2455, lat: 42.11519,  lng: 14.12139, zona: 'Maiella',          regione: 'Abruzzo', emoji: '🛖',  icona: 'img/badge-luoghi/bivacco-carlo-fusco.png' },
        // Bivacco Ju Busciu (18/08/2026): l'UNICA voce di questa sessione le cui coordinate
        // NON sono state confermate in modo indipendente - Overpass non ha nessun punto con
        // questo nome (ne' "Busciu" ne' "Bafile") nella zona del Gran Sasso, quindi non si e'
        // potuto incrociare come per le altre dieci voci aggiunte oggi. L'unica fonte con
        // coordinate trovata (Wikipedia, "Bivacco Andrea Bafile", 42.468622/13.571847, 2669 m)
        // e' ~730 m da quelle date da Denis - e potrebbe riferirsi a una struttura diversa: le
        // fonti web distinguono "Ju Busciu" (il vecchio bivacco del 1949) dal bivacco Bafile
        // attuale. Denis ha scelto esplicitamente di usare le sue coordinate (fonte diretta,
        // probabile GPX) invece di quelle di Wikipedia - quota presa dall'icona (2645 m, dentro
        // l'intervallo 2645-2669 m riportato dalle fonti web per questo luogo). Se il badge
        // dovesse risultare impossibile da prendere stando sul posto vero, e' il primo sospetto.
        { stampId: 'badge_jubusciu',    nome: 'Bivacco Ju Busciu',        tipo: 'rifugio', quota: 2645, lat: 42.47294,  lng: 13.56525, zona: 'Gran Sasso',       regione: 'Abruzzo', emoji: '🪨',  icona: 'img/badge-luoghi/bivacco-ju-busciu.png' },
        // Rifugio Pino Ciuffarella ELIMINATO il 18/08/2026 su richiesta di Denis - stessa
        // verifica fatta per Pomilio qui sopra, nessun utente reale aveva ancora preso
        // badge_ciuffarella. Nessuna sostituzione: la voce sparisce e basta, il totale badge
        // scende di uno.
        // Punto 91: rifugio nuovo nel catalogo, non solo un cambio icona - non c'era
        // nessuna voce precedente ne' nel catalogo fisso ne' fra le vette di un'escursione
        // (verificato sul database prima di aggiungerlo). Coordinate incrociate fra il sito
        // ufficiale del rifugio e prenotarifugi.cai.it (differenza fra i due: ~5 metri),
        // non da Nominatim - stesso criterio del punto 1 in cima al file. Regione confermata
        // con lib/regions.js (Abruzzo). Quota 2388 m coincide con quella dichiarata da
        // entrambe le fonti.
        { stampId: 'badge_ducadegliabruzzi', nome: 'Rifugio Duca degli Abruzzi', tipo: 'rifugio', quota: 2388, lat: 42.44812, lng: 13.55204, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🏠', icona: 'img/badge-luoghi/rifugio-duca-degli-abruzzi.png' },

        // Tre rifugi nuovi (18/08/2026), coordinate/quote confermate su Overpass
        // (tourism=alpine_hut), stesso criterio delle otto voci sopra.
        { stampId: 'badge_garibaldi',   nome: 'Rifugio Garibaldi',        tipo: 'rifugio', quota: 2230, lat: 42.46075, lng: 13.55035, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🎖️', icona: 'img/badge-luoghi/rifugio-garibaldi.png' },
        // Denis lo aveva scritto "D'Archangelo": il nome reale, confermato su OSM (operatore
        // CAI Isola del Gran Sasso) e su piu' fonti web, e' "D'Arcangelo" senza H - corretto
        // qui su conferma esplicita di Denis. Quota OSM 1655 m (una fonte web indipendente
        // dice 1665 m, 10 m di scarto) - molto lontana dai 2235 m decorativi sull'icona,
        // ulteriore conferma che quei numeri non vanno mai presi per buoni da soli.
        { stampId: 'badge_darcangelo',  nome: "Rifugio Nicola D'Arcangelo", tipo: 'rifugio', quota: 1655, lat: 42.45959, lng: 13.59243, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🛏️', icona: 'img/badge-luoghi/rifugio-nicola-darcangelo.png' },
        { stampId: 'badge_rinaldi',     nome: 'Rifugio Massimo Rinaldi',  tipo: 'rifugio', quota: 2108, lat: 42.46736, lng: 12.99001, zona: 'Terminillo',  regione: 'Lazio',   emoji: '📡',  icona: 'img/badge-luoghi/rifugio-massimo-rinaldi.png' },
        // Rifugio Capanna di Sevice (2026-08-28), stesso gruppo del Velino. Overpass way
        // 528333729 (tourism=alpine_hut, operator "G.E.V. Magliano de' Marsi"), ele 2119 m =
        // cifra sull'icona. Toponimo "Sevice" confermato da altri tre oggetti OSM sulla stessa
        // dorsale (Monte di Sevice, Fonte di Sevice, Vallone di Sevice). Regione confermata
        // con lib/regions.js (Abruzzo).
        { stampId: 'badge_sevice',      nome: 'Rifugio Capanna di Sevice', tipo: 'rifugio', quota: 2119, lat: 42.16080, lng: 13.36700, zona: 'Sirente-Velino', regione: 'Abruzzo', emoji: '🛖', icona: 'img/badge-luoghi/rifugio-capanna-di-sevice.png' }
    ];
});
