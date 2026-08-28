// Traduzione IT/EN (punto 102, sesto lotto): 'var T' e non 'const', questo file
// non e' avvolto in una IIFE e condivide lo scope globale con gli altri <script>
// classici - 'const T' darebbe "Identifier 'T' has already been declared" e
// bloccherebbe l'intero file (vedi 07-Trappole-Tecniche.md del vault). Ripiego
// sempre all'italiano gia' scritto qui e nell'HTML: il dizionario ha solo l'EN.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Virgola italiana o punto inglese per i kg della ripartizione pesi. NON si
// chiama "formattaDecimale": quel nome e' gia' un global di userprofile.js (non
// avvolto in IIFE) che fa .toFixed(1) e, caricando dopo questo file, vincerebbe
// (vedi 07-Trappole-Tecniche.md sul collo di bottiglia dei <script> classici che
// condividono lo scope globale). Qui servono due decimali.
function formattaKg(n) {
    const testo = (n || 0).toFixed(2);
    const lang = window.CamoscioI18n && window.CamoscioI18n.getLang();
    return lang === 'en' ? testo : testo.replace('.', ',');
}

// Traduzione per la SOLA visualizzazione del vocabolario fisso nostro (nomi
// oggetti generati dalle regole, categorie, generi). Il valore vero - quello che
// raggruppa e, soprattutto, quello con cui chiaveSpuntato costruisce la chiave
// localStorage dello stato spuntato - resta SEMPRE la stringa italiana passata
// qui: cambiare lingua non deve mai far perdere un oggetto gia' spuntato. Un
// nome del template escursione o un oggetto personale aggiunto a mano (testo
// dell'utente) non e' nel dizionario -> T() torna null -> si ripiega al nome originale.
function nomeOggettoTradotto(nome) { return T('backpack.item.' + nome) || nome; }
function catLabel(cat) { return T('backpack.cat.' + cat) || cat; }
function genereLabel(g) { return T('backpack.genere.' + g) || g; }

// Inizializzatore del modulo zaino
function initBackpackModule() {
    setupBackpackEvents();
    renderBackpackModule();
}

function setupBackpackEvents() {
    const btnGenerate = document.getElementById("btn-generate-backpack");
    if (btnGenerate) {
        btnGenerate.addEventListener("click", () => {
            generateChecklistFromInputs();
        });
    }

    // Punto 25 - dichiarare un oggetto che porti tu per il gruppo, con la sua portata.
    const btnAdd = document.getElementById("btn-add-shared-item");
    if (btnAdd) btnAdd.addEventListener("click", aggiungiOggettoCondiviso);

    // Punto 47 - stessa cosa ma per gli oggetti PERSONALI, e il tasto di conferma finale.
    const btnAddPersonal = document.getElementById("btn-add-personal-item");
    if (btnAddPersonal) btnAddPersonal.addEventListener("click", aggiungiOggettoPersonale);

    const btnConfirm = document.getElementById("btn-confirm-backpack");
    if (btnConfirm) btnConfirm.addEventListener("click", confermaZaino);
}

// Punto 23 di cose_da_fare.txt (prima meta') - lo zaino deve partire da una escursione MIA.
//
// Prima qui c'era "db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]": in mancanza
// di una scelta esplicita prendeva LA PRIMA ESCURSIONE DEL DATABASE, di chiunque essa fosse,
// e ne mostrava perfino la lista degli oggetti condivisi e la ripartizione dei pesi fra
// persone mai viste. Ora si guarda solo fra le proprie, e se non ce ne sono si mostra lo
// zaino personale invece di quello di uno sconosciuto.
function escursioneDiRiferimento() {
    const db = window.CamoscioState;
    if (!db.currentUser) return null;

    // Stessi criteri della pagina "Le mie escursioni" (punto 10): organizzate da me + quelle
    // a cui partecipo. Riusare quella funzione, invece di riscrivere i confronti, evita che
    // un domani "mia escursione" voglia dire due cose diverse in due punti del sito.
    const mie = window.classificaMieEscursioni
        ? (() => { const c = window.classificaMieEscursioni(); return c.create.concat(c.partecipo); })()
        : [];

    // Se l'utente ha scelto un'escursione (es. dal pulsante "Mappa" di una scheda) vale solo
    // se e' davvero sua: altrimenti si tornerebbe a mostrare lo zaino di un altro.
    const scelta = mie.find(h => h.id === db.activeHikeId);
    if (scelta) return scelta;

    // Altrimenti la PROSSIMA in programma: e' quella per cui uno sta preparando lo zaino.
    // Le date sono stringhe "YYYY-MM-DD" (vedi models/Hike.js), quindi si ordinano da sole.
    const oggi = new Date().toISOString().slice(0, 10);
    const future = mie.filter(h => h.date && h.date >= oggi).sort((a, b) => a.date.localeCompare(b.date));
    if (future.length) return future[0];

    // Nessuna in programma: si prende comunque la piu' recente fra le proprie, se c'e'.
    const passate = mie.filter(h => h.date).sort((a, b) => b.date.localeCompare(a.date));
    return passate[0] || null;
}

// =====================================================================
// PUNTI 24 e 25: oggetti PERSONALI contro oggetti CONDIVISIBILI
// =====================================================================
//
// Prima questa distinzione non esisteva: OGNI articolo del template dell'escursione
// veniva marcato isShared e finiva nella ripartizione dei pesi. Il risultato era che il
// sistema "assegnava a Marco" il guscio impermeabile e la giacca antivento - cioe'
// proponeva che una persona sola portasse la giacca di tutti. Sulle due escursioni gia'
// sul database succedeva davvero: "Guscio impermeabile" e "Giacca antivento" stavano
// nella stessa lista di "Fornello a gas" e "Kit Primo Soccorso".
//
// Regola: un oggetto PERSONALE lo deve avere ognuno e compare nella lista di tutti; un
// oggetto CONDIVISIBILE lo porta uno per tutti, si assegna e si pesa.

// Oggetti che NON vanno MAI considerati condivisibili per quanto "da gruppo" possano
// sembrare. Elencati per primi apposta, e controllati prima del catalogo: in valanga
// l'ARTVA, la pala e la sonda servono a OGNI singola persona, e uno solo per comitiva e'
// inutile - chi resta sepolto non lo sta portando. Stesso discorso per casco, imbrago,
// ramponi e piccozza, che vanno della propria misura.
const SEMPRE_PERSONALI = /\bartva\b|\bpala\b|\bsonda\b|casco|imbrag|rampon|piccozz|scarpon/i;

// Catalogo delle cose che si dividono. Serve a due cose: classificare gli oggetti GIA'
// salvati sul database, che non hanno il campo shareable (cosi' non serve nessuna
// migrazione), e raggrupparli per "genere" quando si conta la portata al punto 25 -
// due tende diverse devono sommare i loro posti, e per farlo devono sapere di essere
// entrambe tende.
const CATALOGO_CONDIVISIBILI = [
    // Le forme sono elencate per esteso invece di usare un "tend\w*" generico: la prima
    // versione era /\btend[ae]\b/ e NON riconosceva "tendina", parola normalissima. Il
    // difetto non era estetico - due tende finivano in gruppi diversi e non sommavano i
    // posti, cioe' saltava proprio il conto per cui la portata esiste. Trovato dalla prova.
    { genere: 'tenda',          test: /\btend(a|e|ina|ine|one|oni)\b|canadese|\btunnel\b/i, copreDiDefault: 2 },
    { genere: 'cucina',         test: /fornell|bombol|\bgas\b|pentol|gavett|caffettier|padell/i },
    { genere: 'primo soccorso', test: /primo\s*soccorso|kit\s*medic|farmac/i },
    { genere: 'corda',          test: /\bcord[ae]\b|spezzone/i },
    { genere: 'acqua',          test: /filtr\w*\s*(per\s*)?(l')?acqua|depurator|potabilizz/i },
    { genere: 'navigazione',    test: /\bcartin\w+|\bmapp\w+\s*(cartace|topografic)|bussol|altimetr/i },
    { genere: 'riparo',         test: /\btelo\b|\btarp\b/i },
    { genere: 'luce da campo',  test: /lanterna/i }
];

function generePerNome(nome) {
    const voce = CATALOGO_CONDIVISIBILI.find(v => v.test.test(nome));
    // Senza corrispondenza il genere e' il nome stesso: due oggetti chiamati uguale
    // sommano comunque la loro portata, cosa che serve per "due tende da 2 posti".
    return voce ? voce.genere : nome.trim().toLowerCase();
}

// Ritorna { condivisibile, genere, copre }. Il campo salvato sull'oggetto vince sempre
// sul catalogo: il catalogo e' un ripiego ragionevole, non un'autorita'.
function classificaOggetto(item) {
    const nome = String(item.name || '');
    const copreSalvato = Number(item.covers) > 0 ? Number(item.covers) : null;

    if (typeof item.shareable === 'boolean') {
        return {
            condivisibile: item.shareable,
            genere: item.shareable ? generePerNome(nome) : null,
            copre: item.shareable ? copreSalvato : null
        };
    }

    if (SEMPRE_PERSONALI.test(nome)) return { condivisibile: false, genere: null, copre: null };

    const voce = CATALOGO_CONDIVISIBILI.find(v => v.test.test(nome));
    if (voce) {
        return {
            genere: voce.genere,
            condivisibile: true,
            // La portata predefinita si applica SOLO alla tenda, dove un numero di posti
            // esiste sempre. Per un fornello non ha senso inventarne una: quello basta al
            // gruppo e basta.
            copre: copreSalvato || voce.copreDiDefault || null
        };
    }

    // Nel dubbio, personale. E' il verso giusto in cui sbagliare: al massimo si porta in
    // due una cosa che bastava a uno, mentre il contrario vuol dire arrivare in cima
    // convinti che il fornello ce l'abbia qualcun altro.
    return { condivisibile: false, genere: null, copre: null };
}

// Chi fa parte del gruppo. Unione di partecipanti e creatore, senza doppioni: oggi il
// creatore risulta gia' fra i partecipanti, ma dipendere da quella coincidenza vorrebbe
// dire rompersi in silenzio il giorno che cambia.
function gruppoDi(hike) {
    if (!hike) return [];
    const elenco = (hike.participants || []).map(String);
    const creatore = String(hike.creatorId || '');
    if (creatore && !elenco.includes(creatore)) elenco.push(creatore);
    return elenco;
}

// Punto 23, seconda meta': gli oggetti condivisi compaiono SOLO quando c'e' davvero
// qualcuno con cui dividerli. Da soli, "chi porta il fornello" e' una domanda senza senso.
function eDiGruppo(hike) {
    return gruppoDi(hike).length >= 2;
}

// Punto 25: la portata basta per il gruppo?
// Generalizzato oltre le tende, come chiesto: vale per qualunque oggetto condiviso che
// copre un numero limitato di persone. Gli oggetti dello stesso genere sommano i posti,
// quindi "una tenda da 3 + una da 2" fa 5 e basta per quattro persone.
function verificaCoperture(condivisi, personeNelGruppo) {
    const perGenere = new Map();
    condivisi.forEach(o => {
        if (!o.copre) return; // senza portata dichiarata si assume che basti per tutti
        const g = perGenere.get(o.genere) || { posti: 0, nomi: [] };
        g.posti += o.copre;
        g.nomi.push(o.name);
        perGenere.set(o.genere, g);
    });

    const avvisi = [];
    perGenere.forEach((g, genere) => {
        if (g.posti < personeNelGruppo) {
            avvisi.push({
                genere,
                posti: g.posti,
                servono: personeNelGruppo,
                mancano: personeNelGruppo - g.posti,
                nomi: g.nomi
            });
        }
    });
    return avvisi;
}

// Renderizza il modulo zaino in base all'escursione attiva o a input dell'utente
function renderBackpackModule() {
    const hike = escursioneDiRiferimento();

    renderWeightDistribution(hike);
    mostraEscursioneDiRiferimento(hike);

    if (hike) {
        generateChecklistFromHike(hike);
    } else {
        // Zaino PERSONALE: nessuna escursione di gruppo, quindi nessun oggetto condiviso e
        // nessuna ripartizione dei pesi. La stagione la si ricava da oggi, e la pioggia non
        // si da' per scontata.
        const altitudine = parseInt(document.getElementById("backpack-altitude").value) || 1500;
        applyBackpackRules(stagioneDaData(null, altitudine), altitudine, "giornata", false, null);
        nascondiNotaPioggia();
    }
}

function nascondiNotaPioggia() {
    const box = document.getElementById("backpack-weather-note");
    if (box) box.classList.add("hidden");
    ultimaNotaPioggia = { visibile: false, pioggia: null, hike: null };
}

// Stagione ricavata dalla data vera dell'escursione (prima era scritta "estate" e basta).
// La soglia di quota non e' un dettaglio: a 2000 metri sull'Appennino centrale, neve e
// ghiaccio ci sono da novembre ad aprile, mentre in valle negli stessi mesi si cammina in
// pile. Usare i soli mesi "da calendario" manderebbe in montagna a marzo senza ramponi.
function stagioneDaData(dataISO, altitudine) {
    const d = dataISO ? new Date(dataISO + 'T12:00:00') : new Date();
    if (Number.isNaN(d.getTime())) return "estate";
    const mese = d.getMonth() + 1;

    const altaQuota = (altitudine || 0) >= 2000;
    const mesiInvernali = altaQuota ? [11, 12, 1, 2, 3, 4] : [12, 1, 2];

    if (mesiInvernali.includes(mese)) return "inverno";
    if ([6, 7, 8].includes(mese)) return "estate";
    return "autunno-primavera";
}

// Previsione di pioggia VERA per il giorno dell'escursione, invece di darla sempre per
// scontata come prima ("const rainExpected = true").
// Ritorna true / false / null, dove null vuol dire "non lo so": le previsioni esistono solo
// per i prossimi giorni, e per un'escursione fra due mesi nessuno puo' saperlo. In quel caso
// non si forza niente nello zaino e lo si dice, invece di inventare.
async function pioggiaPrevista(hike) {
    if (!hike || !hike.date || !hike.trailhead) return null;

    const oggi = new Date().toISOString().slice(0, 10);
    if (hike.date < oggi) return null; // gia' passata: la previsione non ha senso

    const giorniMancanti = (new Date(hike.date + 'T12:00:00') - new Date(oggi + 'T12:00:00')) / 86400000;
    if (giorniMancanti > 14) return null; // oltre l'orizzonte delle previsioni

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${hike.trailhead.lat}&longitude=${hike.trailhead.lng}` +
            `&daily=precipitation_probability_max&start_date=${hike.date}&end_date=${hike.date}&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const dati = await res.json();
        const prob = dati.daily && dati.daily.precipitation_probability_max && dati.daily.precipitation_probability_max[0];
        if (typeof prob !== 'number') return null;
        // Sopra il 40% conviene avere la mantella nello zaino: sotto, portarla sempre vuol
        // dire abituarsi a ignorare l'avviso proprio il giorno che serve.
        return prob >= 40;
    } catch (e) {
        console.warn("Impossibile leggere la previsione di pioggia per l'escursione:", e);
        return null;
    }
}

// Genera checklist basata direttamente sui dettagli dell'escursione selezionata
async function generateChecklistFromHike(hike) {
    const stagione = stagioneDaData(hike.date, hike.maxAltitude);

    // Si disegna SUBITO con quello che si sa gia' (stagione e quota, che non dipendono dalla
    // rete), e la pioggia si aggiunge quando la previsione arriva: in montagna la connessione
    // e' quello che e', e una lista che non compare finche' non risponde un server esterno
    // sarebbe peggio di una lista senza la riga della mantella.
    // Nessun campo "durata" esiste ancora sull'escursione: resta "giornata" (vedi models/Hike.js).
    applyBackpackRules(stagione, hike.maxAltitude, "giornata", false, hike);
    aggiornaFormDaEscursione(stagione, hike.maxAltitude, false);

    const pioggia = await pioggiaPrevista(hike);
    if (pioggia === null) {
        mostraNotaPioggia(null, hike);
        return;
    }
    applyBackpackRules(stagione, hike.maxAltitude, "giornata", pioggia, hike);
    aggiornaFormDaEscursione(stagione, hike.maxAltitude, pioggia);
    mostraNotaPioggia(pioggia, hike);
}

// Il modulo qui accanto deve dire la stessa cosa della lista, altrimenti mostra i suoi
// valori predefiniti mentre la checklist ne usa altri, e non si capisce da dove esca cosa.
function aggiornaFormDaEscursione(stagione, altitudine, pioggia) {
    const campoStagione = document.getElementById("backpack-season");
    const campoQuota = document.getElementById("backpack-altitude");
    const campoPioggia = document.getElementById("backpack-rain-expected");
    if (campoStagione) campoStagione.value = stagione;
    if (campoQuota && typeof altitudine === 'number') campoQuota.value = altitudine;
    if (campoPioggia) campoPioggia.checked = !!pioggia;
}

// Genera checklist in base alle scelte manuali del form
function generateChecklistFromInputs() {
    const season = document.getElementById("backpack-season").value;
    const altitude = parseInt(document.getElementById("backpack-altitude").value);
    const duration = document.getElementById("backpack-duration").value;
    const rainExpected = document.getElementById("backpack-rain-expected").checked;

    // Scelte fatte a mano: la nota sulla previsione va tolta, altrimenti resterebbe a
    // raccontare un meteo che non c'entra piu' con la lista appena generata.
    nascondiNotaPioggia();

    applyBackpackRules(season, altitude, duration, rainExpected, null);
}

// =====================================================================
// PUNTO 47: oggetti PERSONALI aggiunti a mano + conferma finale
// =====================================================================
//
// Gli oggetti personali non sono MAI stati un elenco salvato da qualche parte, a
// differenza di quelli condivisi (hike.backpackTemplate sul server): escono da una
// REGOLA (stagione/quota/durata/pioggia in applyBackpackRules) ricalcolata a ogni
// apertura della pagina. Un oggetto aggiunto a mano non e' una regola - si salva in
// locale, stessa idea gia' in uso per lo stato spuntato di ogni oggetto (localStorage,
// per escursione e per utente). Vale anche per lo zaino "personale" senza
// nessun'escursione (hikeId 'generic'): la chiave funziona uguale in entrambi i casi.

function chiaveUtenteZaino() {
    const db = window.CamoscioState;
    return db.currentUser ? db.currentUser.id : 'anon';
}

// Stessa chiave usata per lo stato spuntato in renderChecklistUI: estratta qui perche'
// serve anche a confermaZaino, per non ricalcolarla in due posti in due modi leggermente
// diversi (e' il tipo di doppione che nasconde un difetto in una sola copia).
function chiaveSpuntato(hikeId, userId, nomeOggetto) {
    return `backpack_item_${hikeId || 'generic'}_${userId}_${nomeOggetto.replace(/\s+/g, '_')}`;
}

function leggiOggettiPersonali(hikeId) {
    try {
        const grezzo = localStorage.getItem(`backpack_personal_extra_${hikeId || 'generic'}_${chiaveUtenteZaino()}`);
        const elenco = grezzo ? JSON.parse(grezzo) : [];
        return Array.isArray(elenco) ? elenco : [];
    } catch (e) {
        return [];
    }
}

function salvaOggettiPersonali(hikeId, elenco) {
    localStorage.setItem(`backpack_personal_extra_${hikeId || 'generic'}_${chiaveUtenteZaino()}`, JSON.stringify(elenco));
}

// Aggiunge un oggetto alla PROPRIA lista (non al gruppo). Gemella di
// aggiungiOggettoCondiviso, ma piu' semplice: niente portata, niente server - si
// rigenera da sola a ogni renderBackpackModule() perche' applyBackpackRules la rilegge.
async function aggiungiOggettoPersonale() {
    const nome = document.getElementById("personal-item-name").value.trim();
    const peso = parseInt(document.getElementById("personal-item-weight").value, 10);

    if (!nome) {
        window.showToast(T('backpack.js.scriviCosa') || "Scrivi che cosa porti.", "error");
        return;
    }
    if (!Number.isFinite(peso) || peso <= 0) {
        window.showToast(T('backpack.js.mettiPeso') || "Metti un peso in grammi.", "error");
        return;
    }

    const hike = escursioneDiRiferimento();
    const hikeId = (hike && hike.id) || 'generic';

    const elenco = leggiOggettiPersonali(hikeId);
    elenco.push({ name: nome, weight: peso });
    salvaOggettiPersonali(hikeId, elenco);

    document.getElementById("personal-item-name").value = "";
    document.getElementById("personal-item-weight").value = "";

    renderBackpackModule();
    window.showToast(T('backpack.js.aggiuntoTua') || "Aggiunto alla tua lista.", "success");
}

// Ultimo elenco disegnato + per quale escursione: serve a confermaZaino per sapere QUALI
// oggetti sono obbligatori adesso, senza ricostruire la lista una seconda volta con una
// logica che potrebbe scostarsi da quella vera (lo stesso principio del punto 38: due
// calcoli della stessa cosa in punti diversi finiscono per dire cose diverse).
let ultimoRenderZaino = { items: [], hikeId: 'generic' };

// Ultimi input passati ad applyBackpackRules da una render vera: servono
// all'onChange del cambio lingua per ridisegnare la checklist tradotta senza
// rifare il fetch meteo di open-meteo (vedi in fondo al file). Insieme, lo stato
// corrente della nota meteo, per riscriverla nella lingua nuova senza rifetch.
let ultimoInputZaino = null;
let ultimaNotaPioggia = { visibile: false, pioggia: null, hike: null };

// Tasto finale (punto 47): non e' un applauso, controlla davvero che tutto quello che le
// regole hanno reso OBBLIGATORIO sia gia' spuntato prima di dire che lo zaino e' pronto.
function confermaZaino() {
    const { items, hikeId } = ultimoRenderZaino;
    const userId = chiaveUtenteZaino();

    const mancanti = items.filter(item => item.mandatory &&
        localStorage.getItem(chiaveSpuntato(hikeId, userId, item.name)) !== 'true');

    if (mancanti.length > 0) {
        const elenco = mancanti.map(i => nomeOggettoTradotto(i.name)).join(', ');
        window.showToast(T('backpack.js.mancaObbligatorio', elenco) || `Manca ancora da spuntare l'obbligatorio: ${elenco}.`, "error");
        return;
    }

    localStorage.setItem(`backpack_confirmed_${hikeId || 'generic'}_${userId}`, 'true');
    mostraZainoConfermato(hikeId);
    window.showToast(T('backpack.js.zainoConfermatoToast') || "Zaino confermato: hai tutto l'obbligatorio!", "success");
}

// Mostra il banner se questo zaino (per QUESTA escursione, o quello generico) e' gia'
// stato confermato in precedenza - altrimenti ricaricando la pagina la conferma data
// prima sparirebbe senza motivo.
function mostraZainoConfermato(hikeId) {
    const banner = document.getElementById("backpack-confirmed-banner");
    if (!banner) return;
    const confermato = localStorage.getItem(`backpack_confirmed_${hikeId || 'generic'}_${chiaveUtenteZaino()}`) === 'true';
    banner.classList.toggle("hidden", !confermato);
}

// Core Algoritmo: Applica i vincoli ambientali e meteo per generare gli articoli dello zaino.
//
// L'ultimo parametro era "customTemplate + hikeId", cioe' due pezzi della stessa escursione
// passati separatamente. Dal punto 24 qui serve sapere anche QUANTI SONO nel gruppo (per
// decidere se gli oggetti condivisi hanno senso) e chi ne fa parte: passare l'escursione
// intera evita di aggiungere un terzo e un quarto parametro che dicono la stessa cosa.
// hike puo' essere null: e' il caso dello zaino personale e delle scelte fatte a mano.
function applyBackpackRules(season, altitude, duration, rainExpected, hike) {
    const db = window.CamoscioState;
    const isHighAltitude = altitude >= 2500;
    const hikeId = (hike && hike.id) || 'generic';

    // Ultimi input di una render vera: l'onChange del cambio lingua li rigioca
    // per ridisegnare la checklist tradotta SENZA rifare il fetch meteo (vedi in
    // fondo al file). Questo e' l'unico imbuto sincrono che disegna la lista.
    ultimoInputZaino = { season, altitude, duration, rainExpected, hike };

    // 1. Inizializziamo una lista base di articoli indispensabili
    let items = [
        { name: "Scarponi da trekking", category: "Abbigliamento", mandatory: true, weight: 1200 },
        { name: "Acqua (almeno 1.5 Litri)", category: "Alimentazione", mandatory: true, weight: 1500 },
        { name: "Snack energetici / Pranzo", category: "Alimentazione", mandatory: true, weight: 600 },
        { name: "Fischietto di emergenza", category: "Sicurezza / Emergenza", mandatory: true, weight: 50 },
        { name: "Coperta termica alluminata", category: "Sicurezza / Emergenza", mandatory: true, weight: 100 },
        { name: "Borraccia vuota extra", category: "Alimentazione", mandatory: false, weight: 150 }
    ];

    // 2. Aggiunge articoli specifici in base alle regole hard dell'altitudine e meteo
    const rulesAlert = document.getElementById("backpack-rules-alert");
    const rulesBadge = document.getElementById("backpack-badge-rules");
    
    let alertMsg = [];
    
    if (isHighAltitude) {
        rulesBadge.textContent = T('backpack.js.badgeAltaQuota') || "Quota > 2500m";
        rulesBadge.className = "badge badge-red";

        items.push({ name: "Ramponcini di sicurezza", category: "Attrezzatura", mandatory: true, weight: 400 });
        items.push({ name: "Guscio antivento termico (Goretex)", category: "Abbigliamento", mandatory: true, weight: 500 });
        items.push({ name: "Guanti e berretto caldi", category: "Abbigliamento", mandatory: true, weight: 200 });

        alertMsg.push(T('backpack.js.alertQuota') || "Quota sopra i 2500m: <strong>Guscio Termico</strong> e <strong>Ramponcini</strong> sono stati forzati nello zaino!");
    } else {
        rulesBadge.textContent = T('backpack.js.badgeQuotaStd') || "Quota Standard";
        rulesBadge.className = "badge badge-green";

        items.push({ name: "K-Way o giacca leggera", category: "Abbigliamento", mandatory: false, weight: 250 });
    }

    if (rainExpected) {
        items.push({ name: "Mantella impermeabile / Poncho", category: "Abbigliamento", mandatory: true, weight: 350 });
        items.push({ name: "Coprizaino impermeabile", category: "Attrezzatura", mandatory: true, weight: 100 });
        items.push({ name: "Sacchetti stagni per indumenti", category: "Attrezzatura", mandatory: false, weight: 50 });

        alertMsg.push(T('backpack.js.alertPioggia') || "Previsione Pioggia: <strong>Mantella Impermeabile</strong> obbligatoria!");
    }

    // Regole stagionali
    if (season === "inverno") {
        items.push({ name: "Cramponi classici da ghiaccio", category: "Attrezzatura", mandatory: true, weight: 950 });
        items.push({ name: "Ghette da neve", category: "Abbigliamento", mandatory: true, weight: 300 });
        items.push({ name: "Thermos per bevande calde", category: "Alimentazione", mandatory: true, weight: 700 });
        items.push({ name: "Piumino leggero extra", category: "Abbigliamento", mandatory: true, weight: 450 });
    } else if (season === "estate") {
        items.push({ name: "Crema solare protettiva", category: "Sicurezza / Emergenza", mandatory: true, weight: 100 });
        items.push({ name: "Cappellino da sole", category: "Abbigliamento", mandatory: true, weight: 80 });
        items.push({ name: "Sali minerali di scorta", category: "Alimentazione", mandatory: false, weight: 50 });
    }

    // Regole di durata escursione
    if (duration === "plurigiorno") {
        items.push({ name: "Sacco a pelo confort 0°C", category: "Attrezzatura", mandatory: true, weight: 1100 });
        items.push({ name: "Materassino isolante", category: "Attrezzatura", mandatory: true, weight: 450 });
        items.push({ name: "Torcia frontale + batterie", category: "Sicurezza / Emergenza", mandatory: true, weight: 150 });
        items.push({ name: "Powerbank per cellulare", category: "Sicurezza / Emergenza", mandatory: true, weight: 250 });
        items.push({ name: "Articoli per igiene personale", category: "Igiene", mandatory: false, weight: 300 });
    }

    // --- Punti 23 (seconda meta'), 24 e 25: gli articoli del template dell'escursione ---
    //
    // Prima finivano TUTTI qui dentro marcati isShared, giacche comprese. Ora ognuno viene
    // classificato: i personali entrano nella lista di chiunque come tutti gli altri, i
    // condivisibili solo se c'e' davvero un gruppo con cui dividerli.
    const template = (hike && hike.backpackTemplate) || [];
    const diGruppo = eDiGruppo(hike);
    const condivisi = [];

    template.forEach(tItem => {
        const { condivisibile, genere, copre } = classificaOggetto(tItem);

        if (!condivisibile) {
            // Personale: lo porta ognuno. Niente "Porta: Marco", niente ripartizione pesi.
            items.push({
                name: tItem.name,
                category: tItem.category,
                mandatory: tItem.mandatory,
                weight: tItem.weight,
                isShared: false
            });
            return;
        }

        // Condivisibile ma si e' da soli: si mostra lo stesso, perche' se vai in tenda da
        // solo la tenda ti serve comunque - ma come oggetto TUO, senza "chi lo porta" e
        // senza ripartizione, che a un gruppo di uno non dicono niente (punto 23).
        if (!diGruppo) {
            items.push({
                name: tItem.name,
                category: tItem.category,
                mandatory: tItem.mandatory,
                weight: tItem.weight,
                isShared: false
            });
            return;
        }

        const oggetto = {
            name: tItem.name,
            category: tItem.category,
            mandatory: tItem.mandatory,
            weight: tItem.weight,
            assignedTo: tItem.assignedTo,
            isShared: true,
            copre,
            genere
        };
        items.push(oggetto);
        condivisi.push(oggetto);
    });

    // Punto 25 - l'avviso sulla portata si calcola qui, dove si sa gia' quali oggetti sono
    // condivisi e con quanti posti, invece di rifare la classificazione altrove.
    mostraAvvisiCopertura(diGruppo ? verificaCoperture(condivisi, gruppoDi(hike).length) : [],
                          gruppoDi(hike).length);

    // Mostra avvisi regole a schermo
    if (rulesAlert) {
        if (alertMsg.length > 0) {
            rulesAlert.classList.remove("hidden");
            rulesAlert.innerHTML = `<i data-lucide="alert-triangle"></i> <span>${alertMsg.join(" | ")}</span>`;
        } else {
            rulesAlert.classList.add("hidden");
        }
    }

    // Punto 47 - le proprie aggiunte a mano, sopra a quelle dettate dalle regole.
    // Non obbligatorie: sono una scelta personale, non un vincolo del posto o del meteo.
    leggiOggettiPersonali(hikeId).forEach(extra => {
        items.push({ name: extra.name, category: "Aggiunte da te", mandatory: false, weight: extra.weight, isShared: false });
    });

    renderChecklistUI(items, hikeId);
    if (window.lucide) window.lucide.createIcons();
}

// Disegna la lista zaino suddivisa per categorie
function renderChecklistUI(items, hikeId) {
    const container = document.getElementById("backpack-categories-container");
    if (!container) return;

    // Punto 47: memorizzata per confermaZaino, e il banner si aggiorna qui perche' e' il
    // punto in cui si sa gia' se e' cambiata l'escursione di riferimento.
    ultimoRenderZaino = { items, hikeId };
    mostraZainoConfermato(hikeId);

    container.innerHTML = "";

    // Raggruppa per categoria
    const categories = {};
    items.forEach(item => {
        if (!categories[item.category]) {
            categories[item.category] = [];
        }
        categories[item.category].push(item);
    });

    for (const catName in categories) {
        const catBox = document.createElement("div");
        catBox.className = "backpack-category";
        
        // catDomKey resta sul nome IT originale: e' un id del DOM usato subito
        // qui sotto, non deve dipendere dalla lingua. Solo il titolo si traduce.
        const catDomKey = catName.replace(/[^a-zA-Z0-9]/g, '');
        catBox.innerHTML = `
            <h5>${escapeHtml(catLabel(catName))}</h5>
            <div class="backpack-list-items" id="cat-items-${catDomKey}">
                <!-- Articoli caricati qui -->
            </div>
        `;
        container.appendChild(catBox);

        const itemsContainer = document.getElementById(`cat-items-${catDomKey}`);
        
        categories[catName].forEach((item, index) => {
            const itemRow = document.createElement("div");
            itemRow.className = "backpack-item-row";

            // Stato spuntato salvato in local storage, isolato per escursione e per utente
            const storageKey = chiaveSpuntato(hikeId, chiaveUtenteZaino(), item.name);
            const isChecked = localStorage.getItem(storageKey) === 'true';

            // Stringa per oggetti condivisi.
            // Punto 25 - se l'oggetto ha una portata dichiarata la si scrive accanto: chi
            // guarda la lista deve poter vedere "tenda (3 posti)" e contare le teste da
            // solo, senza fidarsi ciecamente dell'avviso automatico.
            let assignmentLabel = "";
            if (item.isShared) {
                const db = window.CamoscioState;
                if (item.copre) {
                    assignmentLabel += `<span class="item-covers">${T('backpack.js.posti', item.copre) || (item.copre + ' post' + (item.copre === 1 ? 'o' : 'i'))}</span>`;
                }
                if (item.assignedTo) {
                    const assignee = db.users.find(u => u.id === item.assignedTo);
                    const name = assignee ? assignee.username.split(" ")[0] : (T('backpack.js.qualcuno') || "Qualcuno");
                    assignmentLabel += `<span class="item-assigned">${T('backpack.js.portaLabel') || 'Porta:'} ${escapeHtml(name)}</span>`;
                } else {
                    assignmentLabel += `<span class="item-assigned" style="color:var(--accent-orange)">${T('backpack.js.daAssegnare') || 'Da Assegnare'}</span>`;
                }
            }

            itemRow.innerHTML = `
                <div class="backpack-item-left ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" id="check-${catDomKey}-${index}" ${isChecked ? 'checked' : ''}>
                    <span>${escapeHtml(nomeOggettoTradotto(item.name))}</span>
                </div>
                <div class="backpack-item-right">
                    ${item.mandatory ? `<span class="item-mandatory-tag">${T('backpack.js.obbligatorioTag') || 'OBBLIGATORIO'}</span>` : ''}
                    ${assignmentLabel}
                    <span class="text-muted small">${item.weight}g</span>
                </div>
            `;

            // Aggiungi click listener sul checkbox
            const checkbox = itemRow.querySelector("input[type='checkbox']");
            checkbox.addEventListener("change", (e) => {
                const checked = e.target.checked;
                localStorage.setItem(storageKey, checked ? 'true' : 'false');
                
                const leftDiv = itemRow.querySelector(".backpack-item-left");
                if (checked) {
                    leftDiv.classList.add("checked");
                } else {
                    leftDiv.classList.remove("checked");
                }
            });

            itemsContainer.appendChild(itemRow);
        });
    }
}

// Riquadro in cima allo zaino: per QUALE escursione e' questa lista. Prima non c'era, e
// siccome il sistema sceglieva da solo (perfino un'escursione di un altro) non c'era modo di
// accorgersene guardando lo schermo.
function mostraEscursioneDiRiferimento(hike) {
    const box = document.getElementById("backpack-hike-context");
    if (!box) return;

    if (!hike) {
        box.className = "backpack-context-box personale";
        box.innerHTML = `<strong>${T('backpack.js.zainoPersonaleTitolo') || 'Zaino personale'}</strong>
            <span class="small">${T('backpack.js.zainoPersonaleDesc') || "Non hai escursioni in programma: questa e' la lista delle tue cose. Iscriviti a un'escursione per vedere anche gli oggetti da dividere col gruppo."}</span>`;
        return;
    }

    const db = window.CamoscioState;
    const mia = hike.creatorId === (db.currentUser || {}).id;
    // Data col nome del mese: locale en-GB (EN) / it-IT, come le altre date estese.
    const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    box.className = "backpack-context-box";
    box.innerHTML = `<strong>${T('backpack.js.zainoPerLabel') || 'Zaino per:'} ${escapeHtml(hike.title)}</strong>
        <span class="small">${hike.date ? new Date(hike.date + 'T12:00:00').toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }) : (T('backpack.js.dataNonIndicata') || 'data non indicata')}
        · ${T('backpack.js.quotaMassimaLabel') || 'quota massima'} ${hike.maxAltitude || '?'} m · ${mia ? (T('backpack.js.organizzataDaTe') || 'organizzata da te') : (T('backpack.js.aCuiPartecipi') || 'a cui partecipi')}</span>`;
}

// Nota sulla previsione di pioggia. Il caso "non lo so" va detto, non nascosto: e' la
// differenza fra "non pioverà" e "è troppo presto per saperlo", e cambia cosa metti in zaino.
function mostraNotaPioggia(pioggia, hike) {
    const box = document.getElementById("backpack-weather-note");
    if (!box) return;

    ultimaNotaPioggia = { visibile: true, pioggia: pioggia, hike: hike };
    box.classList.remove("hidden");
    if (pioggia === null) {
        const troppoLontana = hike && hike.date && hike.date > new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        box.textContent = troppoLontana
            ? (T('backpack.js.meteoTroppoLontano') || "Previsioni non ancora disponibili: mancano più di due settimane. Ricontrolla lo zaino nei giorni prima di partire.")
            : (T('backpack.js.meteoNonDisp') || "Previsioni meteo non disponibili per questa data: la lista non tiene conto della pioggia.");
        return;
    }
    box.textContent = pioggia
        ? (T('backpack.js.meteoPioggia') || "Previsione: pioggia probabile il giorno dell'escursione. Mantella e coprizaino sono stati resi obbligatori.")
        : (T('backpack.js.meteoSereno') || "Previsione: giornata senza pioggia. L'attrezzatura antipioggia non è stata forzata nella lista.");
}

// Punto 25 - avviso quando un oggetto condiviso non basta per tutti.
// Esempio dell'utente, alla lettera: "porto io una tenda da 3 posti ma siamo in 4 -> la
// tenda non basta". Il messaggio dice quanto manca, non solo che c'e' un problema: e' la
// differenza fra un avviso che si puo' risolvere e uno che si impara a ignorare.
function mostraAvvisiCopertura(avvisi, personeNelGruppo) {
    const box = document.getElementById("backpack-coverage-alert");
    if (!box) return;

    if (!avvisi || !avvisi.length) {
        box.classList.add("hidden");
        box.innerHTML = "";
        return;
    }

    const righe = avvisi.map(a => {
        // Con un oggetto solo si scrive il suo nome e basta (nome del template =
        // testo dell'utente, non tradotto). Con piu' oggetti serve il "genere"
        // (vocabolario nostro, tradotto per la sola visualizzazione).
        const intestazione = a.nomi.length === 1
            ? escapeHtml(a.nomi[0])
            : `${escapeHtml(genereLabel(a.genere))} (${a.nomi.map(n => escapeHtml(n)).join(" + ")})`;

        const posti = T('backpack.js.posti', a.posti) || `${a.posti} post${a.posti === 1 ? 'o' : 'i'}`;
        const mancano = a.mancano === 1
            ? (T('backpack.js.neManca') || `Ne manca <strong>1</strong>`)
            : (T('backpack.js.neMancano', a.mancano) || `Ne mancano <strong>${a.mancano}</strong>`);

        return T('backpack.js.coperturaRiga', intestazione, posti, personeNelGruppo, mancano) ||
            `<li><strong>${intestazione}</strong>: ${posti} per ${personeNelGruppo} persone.
            ${mancano}: serve qualcosa di più grande, oppure un altro da aggiungere.</li>`;
    }).join("");

    box.classList.remove("hidden");
    box.innerHTML = `<i data-lucide="alert-triangle"></i>
        <div><strong>${T('backpack.js.nonBastaPerTutti') || 'Non basta per tutti'}</strong><ul>${righe}</ul></div>`;
    if (window.lucide) window.lucide.createIcons();
}

// Renderizza il widget di suddivisione pesi tra i membri del gruppo.
//
// PUNTI 23/24 - due difetti corretti qui. Il primo: si ripartivano TUTTI gli articoli del
// template, giacche comprese, come se una persona sola dovesse portare l'antivento di
// tutti. Ora entrano solo gli oggetti davvero condivisibili. Il secondo: la ripartizione
// compariva anche per un'escursione con un solo partecipante, dove non c'e' niente da
// ripartire.
function renderWeightDistribution(hike) {
    const container = document.getElementById("backpack-weight-distribution");
    const box = document.getElementById("backpack-add-shared");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (!hike) {
        container.innerHTML = `<p class="small text-muted">${T('backpack.js.wdNessunaGruppo') || "Nessuna escursione di gruppo in programma: non c'è nulla da ripartire."}</p>`;
        if (box) box.classList.add("hidden");
        return;
    }

    const membri = gruppoDi(hike);
    if (!eDiGruppo(hike)) {
        container.innerHTML = `<p class="small text-muted">${T('backpack.js.wdSoloTu') || "A questa escursione per ora ci sei solo tu: non c'è nessuno con cui dividere il peso. Gli oggetti da dividere compaiono quando si iscrive qualcun altro."}</p>`;
        if (box) box.classList.add("hidden");
        return;
    }

    // Solo gli oggetti condivisibili: sono gli unici che ha senso assegnare a qualcuno.
    const condivisi = (hike.backpackTemplate || [])
        .map((item, indice) => ({ item, indice, ...classificaOggetto(item) }))
        .filter(o => o.condivisibile);

    if (box) box.classList.remove("hidden");

    if (!condivisi.length) {
        container.innerHTML = `<p class="small text-muted">${T('backpack.js.wdNessunOggetto') || "Nessun oggetto da dividere in questa escursione. Se porti qualcosa che serve a tutti (tenda, fornello, kit di primo soccorso) aggiungilo qui sotto."}</p>`;
        return;
    }

    const pesi = {};
    membri.forEach(pId => { pesi[pId] = 0; });
    condivisi.forEach(o => {
        const a = String(o.item.assignedTo || '');
        if (a && pesi[a] !== undefined) pesi[a] += (o.item.weight || 0);
    });

    membri.forEach(pId => {
        const user = db.users.find(u => u.id === pId);
        if (!user) return;

        const riga = document.createElement("div");
        riga.className = "weight-dist-item";

        const kg = formattaKg(pesi[pId] / 1000);
        const daAssegnare = condivisi.filter(o => String(o.item.assignedTo || '') !== pId);

        // value = o.item.name (nome del template): lo usa reassignSharedGear per
        // ritrovare l'oggetto. Testo del template = contenuto utente, non tradotto.
        const opzioni = daAssegnare.map(o =>
            `<option value="${escapeHtml(o.item.name)}">${escapeHtml(o.item.name)} (${o.item.weight}g)</option>`
        ).join('');

        riga.innerHTML = `
            <span>${user.avatar} ${escapeHtml(user.username)}</span>
            <div style="display:flex; align-items:center; gap: 10px;">
                <select onchange="reassignSharedGear('${hike.id}', '${pId}', this.value)" class="user-select-dropdown" style="padding: 2px 4px; font-size: 0.75rem;">
                    <option value="">${T('backpack.js.assegnaOggetto') || 'Assegna oggetto...'}</option>
                    ${opzioni}
                </select>
                <strong>${kg} kg</strong>
            </div>
        `;
        container.appendChild(riga);
    });
}

// Punto 25 - dichiarare un oggetto che porti tu per tutti, con la sua portata.
// Senza questo la richiesta non starebbe in piedi: prima del blocco 3 NESSUNA schermata
// permetteva di aggiungere un articolo alla lista dell'escursione (i due template esistenti
// arrivavano dallo script di popolamento), quindi "porto io una tenda da 3 posti" non si
// poteva dire in nessun modo.
async function aggiungiOggettoCondiviso() {
    const hike = escursioneDiRiferimento();
    if (!hike) return;

    const nome = document.getElementById("shared-item-name").value.trim();
    const peso = parseInt(document.getElementById("shared-item-weight").value, 10);
    const copreGrezzo = document.getElementById("shared-item-covers").value.trim();
    const copre = copreGrezzo === "" ? null : parseInt(copreGrezzo, 10);

    if (!nome) {
        window.showToast(T('backpack.js.scriviCosa') || "Scrivi che cosa porti.", "error");
        return;
    }
    if (!Number.isFinite(peso) || peso <= 0) {
        window.showToast(T('backpack.js.mettiPesoCarico') || "Metti un peso in grammi, serve per dividere il carico.", "error");
        return;
    }
    if (copre !== null && (!Number.isFinite(copre) || copre < 1)) {
        window.showToast(T('backpack.js.portataMin') || "La portata deve essere almeno 1 persona, oppure lasciala vuota.", "error");
        return;
    }

    const db = window.CamoscioState;
    const io = db.currentUser ? db.currentUser.id : null;
    if (!io) return;

    const btn = document.getElementById("btn-add-shared-item");
    const etichetta = btn.textContent;
    btn.disabled = true;
    btn.textContent = T('common.salvataggio') || "Salvataggio…";

    // Si manda il template COMPLETO col nuovo in fondo. Il server pretende che gli
    // articoli gia' presenti restino identici e che quelli aggiunti siano a carico di chi
    // li aggiunge (canNonCreatorEditBackpack in routes/hikes.js): appendere in coda e
    // assegnare a se stessi e' esattamente quello che si aspetta.
    const nuovo = {
        name: nome,
        category: "Attrezzatura di gruppo",
        mandatory: true,
        weight: peso,
        assignedTo: io,
        shareable: true
    };
    if (copre !== null) nuovo.covers = copre;

    const template = (hike.backpackTemplate || []).concat([nuovo]);

    try {
        const res = await fetch(`/api/hikes/${hike.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backpackTemplate: template })
        });
        if (!res.ok) throw new Error('Rifiutato dal server');

        document.getElementById("shared-item-name").value = "";
        document.getElementById("shared-item-weight").value = "";
        document.getElementById("shared-item-covers").value = "";

        await refreshState();
        renderBackpackModule();
        window.showToast(T('backpack.js.aggiuntoGruppo') || "Aggiunto. Lo porti tu per il gruppo.", "success");
    } catch (e) {
        console.error("Impossibile aggiungere l'oggetto condiviso:", e);
        window.showToast(T('backpack.js.erroreAggiunta') || "Non sono riuscito ad aggiungerlo. Riprova.", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = etichetta;
    }
}

// Riassegna un equipaggiamento condiviso ad un altro partecipante
window.reassignSharedGear = async function(hikeId, newAssigneeId, itemName) {
    if (!itemName) return;
    const db = window.CamoscioState;
    const hikeIndex = db.hikes.findIndex(h => h.id === hikeId);
    if (hikeIndex === -1) return;

    const hike = db.hikes[hikeIndex];
    const gearIndex = hike.backpackTemplate.findIndex(item => item.name === itemName);
    if (gearIndex !== -1) {
        hike.backpackTemplate[gearIndex].assignedTo = newAssigneeId;

        // Invia aggiornamento al database locale del server Express
        try {
            await fetch(`/api/hikes/${hikeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backpackTemplate: hike.backpackTemplate })
            });

            // Rinfresca la UI
            await refreshState();
            renderWeightDistribution(hike);
            generateChecklistFromHike(hike);
        } catch(e) {
            console.error("Errore nel salvare la ripartizione dei pesi:", e);
        }
    }
};

// Cambio lingua (punto 102, sesto lotto): la checklist, la ripartizione pesi e il
// riquadro dell'escursione sono costruiti via innerHTML - applyStaticTranslations
// non li raggiunge, resterebbero in italiano sotto gli occhi. Si ridisegnano, ma
// SENZA rifare il fetch meteo di open-meteo: si rigiocano gli ultimi input veri
// (ultimoInputZaino, catturati nell'imbuto sincrono applyBackpackRules) e si
// riscrive la nota meteo con l'ultimo valore gia' noto. Stessa logica della
// Dashboard al terzo lotto: ridisegna, non rifetch. Solo se #backpack e' attiva
// (navigateTo lo ridisegna comunque all'ingresso), come renderCompletate.
if (window.CamoscioI18n && window.CamoscioI18n.onChange) {
    window.CamoscioI18n.onChange(function () {
        const sec = document.getElementById("backpack");
        if (!sec || !sec.classList.contains("active") || !ultimoInputZaino) return;
        const i = ultimoInputZaino;
        renderWeightDistribution(i.hike);
        mostraEscursioneDiRiferimento(i.hike);
        applyBackpackRules(i.season, i.altitude, i.duration, i.rainExpected, i.hike);
        if (ultimaNotaPioggia.visibile) {
            mostraNotaPioggia(ultimaNotaPioggia.pioggia, ultimaNotaPioggia.hike);
        }
    });
}

window.initBackpackModule = initBackpackModule;
window.renderBackpackModule = renderBackpackModule;
