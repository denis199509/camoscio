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
        { stampId: 'stamp_gemelli',     nome: 'Corno Grande',             tipo: 'cima',    quota: 2912, lat: 42.46930, lng: 13.56550, zona: 'Gran Sasso',       regione: 'Abruzzo', emoji: '⛺'  },
        { stampId: 'stamp_margherita',  nome: 'Monte Vettore',            tipo: 'cima',    quota: 2476, lat: 42.82441, lng: 13.27497, zona: 'Monti Sibillini',  regione: 'Marche',  emoji: '👑'  },
        { stampId: 'badge_amaro',       nome: 'Monte Amaro',              tipo: 'cima',    quota: 2793, lat: 42.08633, lng: 14.08591, zona: 'Maiella',          regione: 'Abruzzo', emoji: '🗻'  },
        { stampId: 'badge_gorzano',     nome: 'Monte Gorzano',            tipo: 'cima',    quota: 2458, lat: 42.61822, lng: 13.39560, zona: 'Monti della Laga', regione: 'Abruzzo', emoji: '⛰️' },
        { stampId: 'badge_terminillo',  nome: 'Monte Terminillo',         tipo: 'cima',    quota: 2217, lat: 42.47330, lng: 12.99736, zona: 'Terminillo',       regione: 'Lazio',   emoji: '🏔️' },
        { stampId: 'badge_miletto',     nome: 'Monte Miletto',            tipo: 'cima',    quota: 2050, lat: 41.44962, lng: 14.37209, zona: 'Matese',           regione: 'Molise',  emoji: '🌄'  },

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
        { stampId: 'stamp_mezzeno',     nome: 'Rifugio Franchetti',       tipo: 'rifugio', quota: 2433, lat: 42.47711, lng: 13.56522, zona: 'Gran Sasso',       regione: 'Abruzzo', emoji: '🧗',  icona: 'img/badge-luoghi/rifugio-franchetti.png' },
        { stampId: 'stamp_gnifetti',    nome: 'Rifugio Zilioli',          tipo: 'rifugio', quota: 2250, lat: 42.81740, lng: 13.26850, zona: 'Monti Sibillini',  regione: 'Marche',  emoji: '❄️', icona: 'img/badge-luoghi/rifugio-zilioli.png' },
        { stampId: 'badge_pomilio',     nome: 'Rifugio Bruno Pomilio',    tipo: 'rifugio', quota: 1930, lat: 42.16084, lng: 14.13258, zona: 'Maiella',          regione: 'Abruzzo', emoji: '🛖'  },
        { stampId: 'badge_ciuffarella', nome: 'Rifugio Pino Ciuffarella', tipo: 'rifugio', quota: 1770, lat: 41.79662, lng: 13.50140, zona: 'Monti Ernici',     regione: 'Lazio',   emoji: '🏕️' },
        // Punto 91: rifugio nuovo nel catalogo, non solo un cambio icona - non c'era
        // nessuna voce precedente ne' nel catalogo fisso ne' fra le vette di un'escursione
        // (verificato sul database prima di aggiungerlo). Coordinate incrociate fra il sito
        // ufficiale del rifugio e prenotarifugi.cai.it (differenza fra i due: ~5 metri),
        // non da Nominatim - stesso criterio del punto 1 in cima al file. Regione confermata
        // con lib/regions.js (Abruzzo). Quota 2388 m coincide con quella dichiarata da
        // entrambe le fonti.
        { stampId: 'badge_ducadegliabruzzi', nome: 'Rifugio Duca degli Abruzzi', tipo: 'rifugio', quota: 2388, lat: 42.44812, lng: 13.55204, zona: 'Gran Sasso', regione: 'Abruzzo', emoji: '🏠', icona: 'img/badge-luoghi/rifugio-duca-degli-abruzzi.png' }
    ];
});
