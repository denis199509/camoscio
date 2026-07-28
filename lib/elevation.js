// ==========================================================================
// PUNTO 33 - LE QUOTE DI UN PERCORSO PROGETTATO.
//
// UN FILE SOLO parla con la fonte delle quote, esattamente come lib/mailer.js e' l'unico
// che parla col servizio email. Non e' un vezzo: e' il motivo per cui cambiare fornitore
// di email (Brevo -> Mailjet, 2026-07-28) e' costato un file solo. Se un domani Open-Meteo
// cambia condizioni o smette, si riscrive questo file e basta.
//
// PERCHE' UNA FONTE ESTERNA E NON UN MODELLO DEL TERRENO SUL DATABASE (misurato il
// 2026-07-28): tenerne uno a 90 m per le quattro regioni costerebbe ~10 MB sui 478 liberi,
// quindi ci starebbe - ma conserverebbe GLI STESSI IDENTICI DATI Copernicus che Open-Meteo
// gia' serve. Ore di estrazione per risparmiare un secondo di attesa.
//
// LICENZA: Open-Meteo e' CC-BY 4.0, il dato e' Copernicus DEM GLO-90. Vanno citati
// entrambi a schermo - lo fa public/js/routeplanner.js. Il sito usa gia' Open-Meteo per il
// meteo, quindi non e' una dipendenza nuova.
// ==========================================================================

const { statisticheTraccia } = require('./gpx');
const { haversineKm } = require('./geometry');

const URL_FONTE = 'https://api.open-meteo.com/v1/elevation';

// TUTTI I NUMERI QUI SOTTO SONO MISURATI, non scelti a occhio. Le misure sono state fatte
// contro DUE escursioni vere dell'utente (Corno Grande 1232 m, Monte Gorzano 1312 m),
// ricalcolando il dislivello con le quote della fonte e confrontandolo col vero.

// Ogni quanto si chiede una quota lungo il percorso.
// NON ALLARGARLO PER RISPARMIARE CHIAMATE: e' stato provato, e il conto non torna.
// Misurato sulle due escursioni vere (scarto rispetto alle quote dell'altimetro):
//     passo  25 m -> +2,6% e +2,9%   (6 chiamate)  <- costante su due montagne: e' questo che
//                                                     rende il numero affidabile
//     passo  50 m -> -4,3% e +2,6%   (3 chiamate)  <- meta' delle chiamate, ma le due tracce
//                                                     non sono piu' d'accordo fra loro
//     passo  75 m -> +40% e +23%     (2 chiamate)  <- qui la lisciatura si annulla (100/75
//     passo 100 m -> +27% e +15%     (2 chiamate)     arrotonda a 1 punto) e il rumore torna
// Tre chiamate risparmiate non valgono un numero che cambia a seconda della montagna.
const PASSO_M = 25;

// LA RIGA PIU' IMPORTANTE DEL FILE. Il dato ha celle da 90 m: chiedendo una quota ogni 25 m
// si legge piu' volte la stessa cella, il profilo oscilla per il solo modo in cui e'
// interpolato, e OGNI OSCILLAZIONE VIENE CONTATA COME SALITA.
// Misurato sul Corno Grande: senza lisciare, 2204 m di dislivello su un percorso che ne ha
// 1173. Il +79%. Ed era instabile: 2204 m a passo 25 m contro 1152 m a passo 200 m, sullo
// STESSO percorso - cioe' un numero che dipendeva dal passo di campionamento invece che
// dalla montagna.
// Lisciando su 100 m (~la cella del dato) prima di contare: 1204 m sul Corno Grande e
// 1287 m sul Gorzano, cioe' +2,6% e +2,9% - uno scarto piccolo e COSTANTE su due montagne
// diverse, che e' il risultato migliore ottenibile.
// NON ALZARE questo valore sperando in un numero piu' liscio: a 175 m si scende a -9%, a
// 275 m a -21%. Oltre la cella del dato non si toglie rumore, si toglie montagna.
const LISCIATURA_M = 100;

// Limite di Open-Meteo per una singola chiamata.
const MAX_PUNTI_PER_CHIAMATA = 100;

// IL TETTO VERO NON E' SULLE CHIAMATE, E' SUI PUNTI. Scoperto misurando il 2026-07-28: la
// fonte comincia a rispondere 429 "Minutely API request limit exceeded" oltre ~600 punti
// chiesti nello stesso minuto, INDIPENDENTEMENTE da come li si raggruppa - cinque chiamate
// da 100 punti pesano quanto cinquecento chiamate da uno.
// Conseguenza pratica che va rispettata: un percorso da 18 km campionato ogni 25 m sono 755
// punti, cioe' un percorso che NON RIUSCIREBBE MAI, a nessuna ora del giorno.
const MAX_PUNTI = 500;   // sotto i 600, per lasciare margine a chi sta progettando insieme a te

// Oltre i 50 m il numero smette di essere costante fra montagne diverse (vedi PASSO_M), e un
// dislivello che dipende da quale montagna hai scelto non e' un dislivello. Percio' il passo
// si allarga fino a qui e non oltre: dopo, si rinuncia e lo si dice.
const PASSO_MASSIMO_M = 50;

// Stessa soglia usata per i file .gpx importati, e deve restare la stessa: due regole
// diverse vorrebbero dire che lo stesso percorso, progettato oppure camminato e poi
// importato, da' due dislivelli diversi. Vive in lib/gpx.js perche' e' li' che si applica.
const { SOGLIA_DISLIVELLO_M } = require('./gpx');

// Un utente sta aspettando davanti allo schermo: meglio niente dislivello che una pagina
// bloccata. Durante le misure la fonte ha risposto 503 una volta e 429 un'altra.
const TIMEOUT_MS = 8000;

// --- GEOMETRIA ---

function distanzeCumulateM(coordinate) {
    const cum = [0];
    for (let i = 1; i < coordinate.length; i++) {
        cum.push(cum[i - 1] + haversineKm(
            coordinate[i - 1][1], coordinate[i - 1][0],
            coordinate[i][1], coordinate[i][0]
        ) * 1000);
    }
    return cum;
}

// Ridisegna la linea con punti equidistanti, interpolando dentro i segmenti. Serve perche'
// i vertici di un sentiero OSM sono fittissimi nelle curve e radi sui rettilinei: chiedere
// le quote sui vertici darebbe piu' peso alle curve, che non c'entrano niente col dislivello.
function campionaLinea(coordinate, passoM) {
    const cum = distanzeCumulateM(coordinate);
    const totaleM = cum[cum.length - 1];
    if (!(totaleM > 0)) return { punti: [], totaleM: 0 };

    const punti = [];
    let seg = 0;
    for (let d = 0; d <= totaleM; d += passoM) {
        while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
        const lungSeg = cum[seg + 1] - cum[seg];
        const t = lungSeg > 0 ? (d - cum[seg]) / lungSeg : 0;
        punti.push([
            coordinate[seg][0] + (coordinate[seg + 1][0] - coordinate[seg][0]) * t,
            coordinate[seg][1] + (coordinate[seg + 1][1] - coordinate[seg][1]) * t
        ]);
    }
    return { punti, totaleM };
}

// Media mobile centrata sulle sole QUOTE (le coordinate non si toccano): toglie dal profilo
// le ondulazioni piu' fini di quanto il dato sappia davvero distinguere. Vedi LISCIATURA_M.
function lisciaQuote(quote, finestraPunti) {
    if (finestraPunti <= 1) return quote.slice();
    const meta = Math.floor(finestraPunti / 2);
    return quote.map((_, i) => {
        let somma = 0, quanti = 0;
        for (let k = Math.max(0, i - meta); k <= Math.min(quote.length - 1, i + meta); k++) {
            somma += quote[k];
            quanti++;
        }
        return somma / quanti;
    });
}

// Quanto fitto campionare QUESTA linea. Si parte dal passo misurato (25 m) e lo si allarga
// solo se serve a stare sotto il tetto dei punti al minuto, mai oltre PASSO_MASSIMO_M.
// In pratica: fino a ~12 km si usano i 25 m buoni, da li' a ~25 km i 50 m, oltre si rinuncia
// (null) invece di dare un numero che non regge.
// Rinunciare e' la scelta giusta e non una resa: 25 km progettati sono gia' oltre la gita in
// giornata, e un dislivello sbagliato su un percorso cosi' e' esattamente il numero che
// manda una persona in montagna impreparata.
function passoPerLinea(coordinate) {
    const cum = distanzeCumulateM(coordinate);
    const lunghezzaM = cum[cum.length - 1];
    for (let passo = PASSO_M; passo <= PASSO_MASSIMO_M; passo *= 2) {
        if (lunghezzaM / passo <= MAX_PUNTI) return passo;
    }
    return null;
}

// --- LA MEMORIA DELLE QUOTE ---
//
// PERCHE' ESISTE, e non era previsto. Il pannello del progettatore RICALCOLA IL PERCORSO A
// OGNI PUNTO AGGIUNTO: chi progetta una gita da cinque tappe fa cinque ricalcoli, cioe' fino
// a 2.500 punti chiesti per un solo percorso. Il tetto orario della fonte e' 5.000: due
// persone che progettano insieme lo esaurirebbero in un pomeriggio, e il dislivello
// sparirebbe proprio mentre lo si sta usando. Misurato il 2026-07-28 sbattendoci contro.
//
// La quota di un punto NON CAMBIA MAI, quindi tenersela e' sempre giusto. E i ricalcoli
// chiedono in gran parte gli STESSI punti: le tappe gia' scelte non si spostano.
//
// STA IN MEMORIA E NON SU MONGODB, di proposito: c'e' il vincolo hard sullo spazio, e questi
// non sono dati dell'utente ma un appunto che si puo' sempre rifare. Se Render riavvia, si
// riparte a chiedere: non si perde niente.
// IL TETTO E' STRETTO APPOSTA. L'altro vincolo hard e' la RAM (512 MB, e un indice tenuto in
// memoria ha gia' fatto cadere il sito una volta): 20.000 quote sono meno di 2 MB, e bastano
// per una quarantina di percorsi progettati.
const MAX_QUOTE_RICORDATE = 20000;
const quoteRicordate = new Map();

// Si arrotonda a 4 decimali, cioe' ~11 metri. Non e' una perdita di precisione: il dato ha
// celle da 90 m e il profilo viene poi lisciato su 100 m, quindi due punti a 11 metri l'uno
// dall'altro hanno per forza la stessa quota. Serve a far combaciare i ricalcoli anche
// quando il campionamento cade un metro piu' in la'.
function chiaveDi(p) {
    return `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
}

function ricorda(p, quota) {
    // Piu' vecchia fuori, come una cache LRU povera: Map conserva l'ordine d'inserimento.
    if (quoteRicordate.size >= MAX_QUOTE_RICORDATE) {
        quoteRicordate.delete(quoteRicordate.keys().next().value);
    }
    quoteRicordate.set(chiaveDi(p), quota);
}

// --- LA FONTE ---

// Un solo gruppo di punti. Torna un array di quote, oppure lancia.
// L'errore porta con se' lo stato HTTP, perche' non tutti gli errori vanno trattati uguale:
// vedi il commento su TROPPE_RICHIESTE piu' sotto.
async function chiediGruppo(gruppo) {
    const latitudini = gruppo.map(p => p[1].toFixed(6)).join(',');
    const longitudini = gruppo.map(p => p[0].toFixed(6)).join(',');
    const risposta = await fetch(`${URL_FONTE}?latitude=${latitudini}&longitude=${longitudini}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!risposta.ok) {
        const errore = new Error(`la fonte delle quote ha risposto ${risposta.status}`);
        errore.stato = risposta.status;
        throw errore;
    }

    const dati = await risposta.json();
    if (!Array.isArray(dati.elevation) || dati.elevation.length !== gruppo.length) {
        throw new Error('risposta della fonte in un formato inatteso');
    }
    return dati.elevation;
}

// 429 = "hai chiesto troppo, rallenta". Su questo NON si riprova: un tetto non si libera in
// mezzo secondo, e insistere peggiora la situazione per tutti - e' un servizio gratuito che
// il progetto usa in due punti diversi. Su un guasto di rete o un 5xx invece un secondo
// tentativo ha senso: sono passeggeri.
const TROPPE_RICHIESTE = 429;

// --- QUELLO CHE USA IL RESTO DEL PROGETTO ---

/**
 * Salita, discesa e fascia di quota di una linea gia' disegnata.
 *
 * NON LANCIA MAI, e non e' una scortesia verso chi chiama: e' la regola presa col punto 34
 * ("un errore di invio NON PUO' far fallire una registrazione"), applicata qui. Progettare
 * un percorso non deve dipendere da un servizio esterno: se le quote non arrivano si torna
 * null, il percorso si disegna lo stesso e il pannello dice che il dislivello non c'e'.
 *
 * @param {Array<[number,number]>} coordinate - la linea, [[lng,lat],...]
 * @returns {Promise<null|{salitaM,discesaM,quotaMinM,quotaMaxM,puntiUsati,passoM}>}
 */
async function quoteDelPercorso(coordinate) {
    try {
        if (!Array.isArray(coordinate) || coordinate.length < 2) return null;

        const passoM = passoPerLinea(coordinate);
        if (passoM === null) return null;   // percorso troppo lungo, vedi passoPerLinea

        const { punti, totaleM } = campionaLinea(coordinate, passoM);
        if (punti.length < 2) return null;

        // Si chiedono SOLO i punti di cui non si sa gia' la quota (vedi la memoria sopra).
        const daChiedere = punti.filter(p => !quoteRicordate.has(chiaveDi(p)));
        for (let i = 0; i < daChiedere.length; i += MAX_PUNTI_PER_CHIAMATA) {
            const gruppo = daChiedere.slice(i, i + MAX_PUNTI_PER_CHIAMATA);
            let parziale;
            try {
                parziale = await chiediGruppo(gruppo);
            } catch (e) {
                if (e.stato === TROPPE_RICHIESTE) throw e;   // vedi TROPPE_RICHIESTE
                // Un solo secondo tentativo: chi aspetta davanti allo schermo non deve
                // pagare tre giri di attesa per un servizio che sta avendo una giornata no.
                await new Promise(r => setTimeout(r, 400));
                parziale = await chiediGruppo(gruppo);
            }
            gruppo.forEach((p, k) => ricorda(p, parziale[k]));
        }

        const quote = punti.map(p => quoteRicordate.get(chiaveDi(p)));

        // Se anche una sola quota manca si rinuncia a tutto: un buco in mezzo al profilo
        // verrebbe letto come un salto, cioe' come dislivello inventato. Meglio nessun
        // numero che un numero sbagliato - e' il vincolo scritto nel punto 33 stesso.
        if (quote.some(q => typeof q !== 'number' || !Number.isFinite(q))) return null;

        // La finestra si misura sempre in METRI di percorso, non in punti: cosi' la
        // lisciatura resta quella misurata (~la cella del dato) anche quando il passo si e'
        // allargato per stare sotto il tetto.
        const lisciate = lisciaQuote(quote, Math.round(LISCIATURA_M / passoM));
        const tuple = punti.map((p, i) => [p[0], p[1], lisciate[i]]);

        const s = statisticheTraccia(tuple, SOGLIA_DISLIVELLO_M, haversineKm);
        return {
            salitaM: s.dislivelloM,
            discesaM: s.discesaM,
            quotaMinM: s.quotaMinM,
            quotaMaxM: s.quotaMaxM,
            puntiUsati: punti.length,
            passoM,
            lunghezzaM: Math.round(totaleM),
            // Il profilo intero, per poter misurare a parte un pezzo di percorso SENZA
            // ribussare alla fonte: serve a dire quanta salita cade sui tratti tirati in
            // linea d'aria, che e' l'informazione che distingue una fatica vera da una
            // attribuita a un tracciato che il sito stesso dice di non seguire.
            profilo: tuple
        };
    } catch (e) {
        console.warn('Quote non disponibili per questo percorso:', e.message);
        return null;
    }
}

module.exports = {
    quoteDelPercorso,
    // esportati per le prove
    campionaLinea,
    lisciaQuote,
    PASSO_M,
    LISCIATURA_M,
    passoPerLinea,
    MAX_PUNTI,
    PASSO_MASSIMO_M,
    // Per le prove: quante quote si stanno ricordando, e come svuotare la memoria.
    quoteRicordate,
    dimenticaQuote: () => quoteRicordate.clear()
};
