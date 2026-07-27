// Punto 13 - Griglia geografica sui sentieri, per poterli leggere da MongoDB "solo quelli
// di questa zona" senza scorrere tutta la collezione.
//
// PERCHE' UNA GRIGLIA E NON UN INDICE 2dsphere DI MONGODB: un indice geografico vero
// richiede un campo GeoJSON, cioe' le coordinate del sentiero scritte UNA SECONDA VOLTA,
// e proprio sui documenti piu' grossi della collezione (un sentiero ha in media 40 punti,
// alcuni ne hanno centinaia). Con 24.675 sentieri oggi e piu' del doppio dopo il punto 13
// sarebbero decine di MB in cambio di niente che qui serva: non servono query "entro N
// metri" ne' ordinamenti per distanza, serve solo "dammi i sentieri di questo riquadro".
// Due o tre numeri per sentiero fanno la stessa cosa. E' il vincolo hard sullo spazio
// scritto in cima a cose_da_fare.txt.
//
// La cella e' 0,1 gradi: circa 11 km in latitudine e 8 in longitudine alle nostre
// latitudini. E' la stessa dimensione usata per le misure del 2026-07-27, dove 36 celle
// campionate hanno risposto senza un solo errore.

const PASSO = 0.1;

// Gli scostamenti servono solo a non avere mai indici negativi, cosi' la cella e' un
// numero intero positivo e piccolo (per le nostre quattro regioni sta sotto i 15 milioni).
// Non si usa una stringa "y,x" di proposito: un numero occupa 8 byte fissi, una stringa
// del genere ne occupa quasi il doppio fra caratteri e intestazione, moltiplicati per
// due-tre celle per ogni sentiero.
const OFF_LAT = 1000;
const OFF_LNG = 2000;

function cellaDi(lng, lat) {
    const y = Math.floor(lat / PASSO) + OFF_LAT;
    const x = Math.floor(lng / PASSO) + OFF_LNG;
    return y * 10000 + x;
}

// Le celle attraversate da una linea [[lng,lat], ...].
//
// NON basta prendere la cella di ogni punto: fra due punti consecutivi lontani (un rettilineo
// lungo con pochi vertici, che in OSM capita) la linea puo' ATTRAVERSARE una cella senza
// avere nessun vertice dentro. Quel sentiero risulterebbe assente proprio nella cella in cui
// passa, e la ricerca del percorso lo salterebbe senza dire niente. Quindi si campiona anche
// lungo il segmento, a passi piu' fitti della cella.
function celleDiLinea(coordinate) {
    const celle = new Set();
    if (!Array.isArray(coordinate) || coordinate.length === 0) return [];

    for (let i = 0; i < coordinate.length; i++) {
        const [lng, lat] = coordinate[i];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        celle.add(cellaDi(lng, lat));

        if (i === 0) continue;
        const [lngPrec, latPrec] = coordinate[i - 1];
        if (!Number.isFinite(lngPrec) || !Number.isFinite(latPrec)) continue;

        const passi = Math.ceil(Math.max(Math.abs(lng - lngPrec), Math.abs(lat - latPrec)) / (PASSO / 2));
        for (let s = 1; s < passi; s++) {
            const f = s / passi;
            celle.add(cellaDi(lngPrec + (lng - lngPrec) * f, latPrec + (lat - latPrec) * f));
        }
    }
    return [...celle];
}

// Tutte le celle che coprono un riquadro, per la query
// { cells: { $in: celleDiRiquadro(...) } }.
// Si allarga di UNA cella per lato: un sentiero utile puo' entrare nel riquadro da fuori, e
// perderlo vorrebbe dire non trovare un percorso che esiste.
function celleDiRiquadro({ ovest, sud, est, nord }) {
    const celle = [];
    const y0 = Math.floor(sud / PASSO) - 1, y1 = Math.floor(nord / PASSO) + 1;
    const x0 = Math.floor(ovest / PASSO) - 1, x1 = Math.floor(est / PASSO) + 1;
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            celle.push((y + OFF_LAT) * 10000 + (x + OFF_LNG));
        }
    }
    return celle;
}

module.exports = { PASSO, cellaDi, celleDiLinea, celleDiRiquadro };
