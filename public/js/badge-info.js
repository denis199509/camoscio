// ==========================================================================
// SCHEDE DESCRITTIVE DEI BADGE LUOGHI — il testo della "i" nel modale immagine.
//
// Chiesto da Denis il 28/08/2026: cliccando un badge si apre l'immagine intera
// (punto 99); in alto a destra una "i" apre queste poche righe sul luogo.
//
// SOLO BROWSER, di proposito: a differenza di badge-points.js (letto anche dal
// server per l'import GPX), qui non c'e' niente che serva fuori dalla pagina.
// Nessun require() lato server, nessun campo su MongoDB - un catalogo fisso in
// piu' che il codice ha gia' per intero.
//
// RESTA ITALIANO, come i nomi di cime e rifugi: e' contenuto, non interfaccia,
// quindi NON entra nel dizionario di i18n.js (stessa scelta del punto 102 per i
// nomi propri di luogo). La "i" non compare nella versione inglese di un testo:
// compare o non compare il pannello, il testo e' sempre quello.
//
// CHIAVE: lo stampId del catalogo (public/js/badge-points.js), stabile, MAI il
// nome - stesso motivo scritto in cima a badge-points.js e a personal-badges.js.
// Un badge senza voce qui semplicemente non mostra la "i" (i badge personali e
// le vette ricavate dalle escursioni non ne hanno una).
//
// Per aggiungerne/allinearne una: una voce qui sotto con la stessa chiave del
// catalogo. Nient'altro.
// ==========================================================================
(function () {
    const CATALOGO = {
        // --- CIME ---
        stamp_gemelli: { // Corno Grande
            nome: 'Corno Grande',
            testo: `La vetta più alta del Gran Sasso e di tutto l'Appennino. Dal Corno Grande, a 2.912 metri, lo sguardo spazia tra le montagne abruzzesi e, nelle giornate limpide, fino al mare Adriatico. Una cima iconica, selvaggia e imperdibile.`
        },
        badge_cornopiccolo: { // Corno Piccolo
            nome: 'Corno Piccolo',
            testo: `Il Corno Piccolo, 2.655 metri, è una delle cime più affascinanti del Gran Sasso. Rocce, creste e pareti imponenti regalano un ambiente spettacolare e un panorama unico sul massiccio e sulle vallate circostanti.`
        },
        badge_amaro: { // Monte Amaro
            nome: 'Monte Amaro',
            testo: `Con i suoi 2.793 metri, Monte Amaro è la cima più alta della Majella e una delle grandi vette dell'Appennino. Un ambiente selvaggio e solitario, dove lunghe creste e panorami sconfinati rendono la salita una vera esperienza di montagna.`
        },
        badge_intermesoli: { // Pizzo Intermesoli
            nome: 'Pizzo Intermesoli',
            testo: `Con i suoi 2.635 metri, Pizzo d'Intermesoli è una delle cime più imponenti del Gran Sasso. Una montagna selvaggia e rocciosa, caratterizzata da creste affilate e panorami spettacolari sul massiccio e sulle vallate abruzzesi.`
        },
        badge_corvo: { // Monte Corvo
            nome: 'Monte Corvo',
            testo: `Con i suoi 2.623 metri, Monte Corvo è una delle vette più selvagge e appartate del Gran Sasso. Circondato da vallate profonde e grandi pendii, offre un ambiente solitario e un panorama spettacolare sulle montagne abruzzesi.`
        },
        badge_camicia: { // Monte Camicia
            nome: 'Monte Camicia',
            testo: `Con i suoi 2.564 metri, il Monte Camicia è una delle vette più suggestive e panoramiche del Gran Sasso. Famoso per la sua imponente parete nord, a picco sulle colline teramane, offre un contrasto unico tra rocce vertiginose e i vasti pascoli di Campo Imperatore, regalando scorci mozzafiato che spaziano fino al mare Adriatico.`
        },
        badge_prena: { // Monte Prena
            nome: 'Monte Prena',
            testo: `Con i suoi 2.561 metri, il Monte Prena è una delle cime più selvagge e frastagliate del Gran Sasso. Caratterizzato da un paesaggio lunare, guglie rocciose e profondi valloni gessosi, offre un'atmosfera quasi primordiale e uno straordinario panorama a 360 gradi che abbraccia il plateau di Campo Imperatore e le vette circostanti.`
        },
        stamp_margherita: { // Monte Vettore
            nome: 'Monte Vettore',
            testo: `Con i suoi 2.476 metri, il Monte Vettore è la cima più alta dei Monti Sibillini e una delle vette più iconiche dell'Appennino centrale. Famoso per le sue imponenti pareti rocciose e per la presenza del leggendario Lago di Pilato incastonato tra le sue vette, offre un ambiente austero e spettacolare con panorami sterminati che spaziano dalla piana di Castelluccio fino al mare Adriatico.`
        },
        badge_gorzano: { // Monte Gorzano
            nome: 'Monte Gorzano',
            testo: `Con i suoi 2.458 metri, il Monte Gorzano è la vetta più alta dei Monti della Laga e dell'intero Lazio. Caratterizzato da morbidi crinali erbosi, profonde vallate e una straordinaria ricchezza d'acqua tra ruscelli e cascate, offre un ambiente incontaminato e solitario con un panorama spettacolare che domina la conca di Amatrice e svela la vicina catena del Gran Sasso.`
        },
        badge_brancastello: { // Monte Brancastello
            nome: 'Monte Brancastello',
            testo: `Con i suoi 2.385 metri, il Monte Brancastello è una panoramica cima del Gran Sasso situata lungo la suggestiva cresta del Sentiero del Centenario. Sospeso tra le vaste distese di Campo Imperatore e gli strapiombi del versante teramano, offre un ambiente aereo e spettacolare da cui la vista spazia sul "paretone" del Corno Grande, sulle cime orientali del massiccio e fino alla costa adriatica.`
        },
        badge_terminillo: { // Monte Terminillo
            nome: 'Monte Terminillo',
            testo: `Con i suoi 2.217 metri, il Monte Terminillo è la cima principale dei Monti Reatini e la "montagna dei romani" per antonomasia. Caratterizzato da imponenti circhi glaciali, vallette aspre e fitte faggete alla base, offre un perfetto equilibrio tra natura selvaggia e tradizione alpinistica, regalando panorami sterminati che spazzano dalla Piana Reatina fino ai massicci del Gran Sasso e del Velino.`
        },
        badge_viglio: { // Monte Viglio
            nome: 'Monte Viglio',
            testo: `Con i suoi 2.156 metri, il Monte Viglio è la cima più alta dei Monti Cantari e una delle vette più panoramiche al confine tra Lazio e Abruzzo. Caratterizzato da una lunga e aerea cresta, rigogliose faggete e suggestive conche glaciali, offre un ambiente montano integro e spettacolare, da cui lo sguardo spazia dai Monti Simbruini fino alla catena del Velino-Sirente e alle montagne del Parco Nazionale d'Abruzzo, Lazio e Molise.`
        },
        badge_miletto: { // Monte Miletto
            nome: 'Monte Miletto',
            testo: `Con i suoi 2.050 metri, il Monte Miletto è la vetta più alta del massiccio del Matese, al confine tra Molise e Campania. Caratterizzato da aspri valloni rocciosi, estese faggete e la vicinanza ai suggestivi altipiani carsici, offre un ambiente solitario e selvaggio da cui la vista spazia in modo spettacolare, abbracciando nelle giornate limpide sia il Mar Tirreno che il Mar Adriatico.`
        },

        // --- RIFUGI E BIVACCHI ---
        badge_jubusciu: { // Bivacco Ju Busciu
            nome: 'Bivacco Ju Busciu',
            testo: `Situato a 2.645 metri sulla Sella di Corno Grande, lo storico Bivacco Ju Busciu è un iconico riparo in pietra incastonato nel cuore roccioso del Gran Sasso. Posizionato in un ambiente austero, aereo e altamente panoramico, rappresenta un punto di riferimento leggendario e una testimonianza storica per gli alpinisti che affrontano le vie più severe ed emozionanti della vetta.`
        },
        badge_fusco: { // Bivacco Carlo Fusco
            nome: 'Bivacco Carlo Fusco',
            testo: `Situato a 2.455 metri sull'Altopiano delle Murelle, nel cuore selvaggio del massiccio della Majella, il Bivacco Carlo Fusco è uno straordinario punto d'appoggio immerso in un paesaggio lunare e solenne. Posizionato lungo l'aerea cresta che conduce verso il Monte Amaro, offre un riparo fondamentale e panorami sconfinati che dominano l'Anfiteatro delle Murelle e le profonde valli circostanti, regalandosi spesso incontri ravvicinati con i camosci d'Abruzzo.`
        },
        stamp_mezzeno: { // Rifugio Franchetti
            nome: 'Rifugio Franchetti',
            testo: `Situato a 2.433 metri nel cuore del Gran Sasso, il Rifugio Franchetti è un iconico nido d'aquila incastonato nella spettacolare conca tra il Corno Grande e il Corno Piccolo. Circondato da imponenti pareti rocciose e affacciato sul vallone del Calderone, rappresenta uno dei punti di appoggio più rinomati dell'Appennino, offrendo un'accoglienza calorosa e panorami mozzafiato che spaziano fino al mare Adriatico.`
        },
        badge_ducadegliabruzzi: { // Rifugio Duca degli Abruzzi
            nome: 'Rifugio Duca degli Abruzzi',
            testo: `Situato a 2.388 metri sulla Cresta del Monte Portella, il Rifugio Duca degli Abruzzi è una delle strutture storiche più celebri del Gran Sasso. Incastonato in una posizione panoramicissima al cospetto di Corno Grande e Corno Piccolo, domina la vasta distesa di Campo Imperatore da un lato e la conca dell'Aquila dall'altro, offrendo un riparo accogliente e un punto strategico d'appoggio per le più belle ascensioni e traversate del massiccio.`
        },
        stamp_gnifetti: { // Rifugio Zilioli
            nome: 'Rifugio Zilioli',
            testo: `Situato a 2.250 metri sulla Sella delle Ciaule, nel cuore del massiccio dei Monti Sibillini, il Rifugio Tito Zilioli è uno storico ed essenziale punto d'appoggio incastonato tra la parete sud del Monte Vettore e la Cima del Redentore. Immerso in un ambiente austero e altamente panoramico che domina la conca del Lago di Pilato e la Piana di Castelluccio, rappresenta il ricovero ideale per gli escursionisti in salita verso la vetta più alta del gruppo.`
        },
        badge_garibaldi: { // Rifugio Garibaldi
            nome: 'Rifugio Garibaldi',
            testo: `Situato a 2.231 metri nella suggestiva Conca del Campo Pericoli, il Rifugio Garibaldi è lo storico "padre" dei rifugi del Gran Sasso, edificato nel 1886. Immerso in un anfiteatro naturale d'alta quota e circondato dalle vette più imponenti del massiccio — dal Corno Grande al Monte Aquila —, offre un punto d'appoggio dal fascino antico e solitario, ideale per chi traversa il cuore roccioso dell'Appennino.`
        },
        badge_rinaldi: { // Rifugio Massimo Rinaldi
            nome: 'Rifugio Massimo Rinaldi',
            testo: `Situato a 2.108 metri sulla vetta del Monte Terminillo, il Rifugio Massimo Rinaldi è un panoramico nido d'aquila affacciato sui dirupi della Sella di Leonessa. Caratterizzato dalla sua inconfondibile struttura circolare, offre un riparo accogliente e una vista a 360 gradi eccezionale, che spazia dall'alta Sabina ai Monti Reatini, spingendosi nelle giornate limpide dal Gran Sasso fino al Mar Tirreno.`
        },
        badge_darcangelo: { // Rifugio Nicola D'Arcangelo
            nome: "Rifugio Nicola D'Arcangelo",
            testo: `Situato a 1.655 metri tra le solitarie e selvagge faggete alle pendici del Monte Corvo, il Rifugio Nicola D'Arcangelo è stato per anni uno storico e suggestivo punto di riferimento nel versante teramano del Gran Sasso. Oggi purtroppo in stato di abbandono, resta una testimonianza malinconica e affascinante dell'ospitalità di quota, immerso in una cornice di profonda quiete dove la natura incontaminata si sta lentamente riprendendo i suoi spazi.`
        },

        // --- SIRENTE-VELINO (aggiunti il 28/08/2026) ---
        badge_velino: { // Monte Velino
            nome: 'Monte Velino',
            testo: `Con i suoi 2.486 metri, il Monte Velino è la terza vetta più alta dell'Appennino e il sovrano dell'omonima catena montuosa. Caratterizzato da una mole imponente e austera, da profondi valloni dirupati e da un ambiente tipicamente alpeste e selvaggio, domina la Piana del Fucino e regala un panorama grandioso a 360 gradi che spazia dal Gran Sasso alla Majella, fino al Mar Tirreno nelle giornate più limpide.`
        },
        badge_cafornia: { // Monte Cafornia
            nome: 'Monte Cafornia',
            testo: `Con i suoi 2.424 metri, il Monte Cafornia è la seconda vetta del massiccio del Velino-Sirente, legata al Monte Velino da un'aerea e spettacolare cresta. Caratterizzato da vertiginosi e ripidi canali che precipita sul versante di Magliano de' Marsi, offre un ambiente d'alta quota aspro e selvaggio, frequentato dal camoscio appenninico e con una vista straordinaria che spazia sulla Piana del Fucino e sull'intero Appennino Centrale.`
        },
        badge_sevice: { // Rifugio Capanna di Sevice
            nome: 'Rifugio Capanna di Sevice',
            testo: `Situato a 2.119 metri nella solitaria conca tra il Monte Velino e il Monte Sevice, il Rifugio Capanna di Sevice è uno dei punti d'appoggio più alti ed essenziali dell'Appennino Centrale. Immerso in un paesaggio d'alta quota aspro e privo di vegetazione, accanto alla preziosa e omonima fonte, offre un riparo vitale e suggestivo per gli escursionisti diretti verso la vetta del Velino o intenti a compiere le grandi traversate del massiccio.`
        }
    };

    function get(stampId) {
        return CATALOGO[stampId] || null;
    }

    window.CamoscioBadgeInfo = { get };
})();
