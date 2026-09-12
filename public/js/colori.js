// Gemello JS di :root (public/css/styles.css) per i colori della palette che finiscono
// dentro Leaflet e Chart.js: quelle librerie vogliono una stringa colore vera, non un
// var(--...) CSS. Prima ognuno di questi valori era ricopiato a mano in map.js / app.js /
// routeplanner.js / hikepage.js / outingpage.js / weather.js, ognuno col suo commento per
// ricordarsi da dove venisse (Audit visivo C3, 36a sessione). Adesso stanno qui una volta
// sola: se cambia :root, cambiare anche qui.
// Caricato per PRIMO fra i moduli client - routeplanner.js lo legge gia' in un const a
// livello di modulo.
window.CAMOSCIO_COLORI = Object.freeze({
    arancio:        '#C1662E',   // --accent-orange
    verde:          '#4C7A44',   // --accent-green
    rosso:          '#A83B2E',   // --accent-red
    blu:            '#4C7E90',   // --accent-blue        - percorso "da seguire" / progettato
    bluChiaro:      '#7FB5C7',   // --accent-blue-light  - traccia registrata dal vivo
    testoSecondario: '#A8A090'   // --color-text-secondary - assi/legenda Chart.js (Denis: era
                                  // rimasto sul grigio freddo #9CA3AF della vecchia palette)
});
