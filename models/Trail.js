const { mongoose } = require('../db/mongo');
const User = require('./User');

// Fase G - Sentieri reali estratti una tantum da OpenStreetMap (scripts/fetch-trails.js),
// usati per "agganciare" il GPS durante un'escursione. Un documento per ogni "way" OSM.
//
// Coordinate salvate come semplice array di coppie [lng, lat] (niente wrapper GeoJSON
// {type:'LineString',...}: qui il tipo e' sempre lo stesso per ogni documento, ripeterlo
// non aggiunge informazione e spreca spazio - vincolo hard di cose_da_fare.txt).
const trailSchema = new mongoose.Schema({
    wayId: { type: Number, required: true, unique: true }, // ID OSM del "way", usato per l'upsert idempotente
    region: { type: String, enum: User.REGIONI, required: true },
    name: { type: String, default: null },
    sacScale: { type: String, default: null }, // difficolta' OSM (hiking/mountain_hiking/demanding_mountain_hiking/alpine_hiking...)
    coordinates: { type: [[Number]], required: true }, // [[lng, lat], [lng, lat], ...] nell'ordine del sentiero

    // --- Punto 13: progettazione di un percorso su piu' punti ---

    // TRUE solo sui tratti aggiunti per la RICERCA DEL PERCORSO e che NON sono sentieri
    // veri: le carrarecce e le stradine di servizio entro 800 m dalla rete conosciuta
    // (livello i, scelto dall'utente il 2026-07-27 dopo le misure, soglia alzata da 200 a
    // 800 m il 2026-08-21, punto 98/E - vedi scripts/fetch-trails-nearby.js).
    //
    // SERVE A UNA COSA SOLA, ED E' LA PIU' IMPORTANTE DI TUTTO IL PUNTO 13: tenerli
    // FUORI dall'indice in RAM (lib/trailIndex.js). In Fase G l'indice in memoria ha
    // gia' fatto cadere il sito - 512 MB in tutto su Render, picco misurato ~394 MB -
    // e i dati del livello i piu' che raddoppiano il totale. Caricarli rifarebbe
    // l'incidente, in peggio. La ricerca del percorso li legge invece da MongoDB, solo
    // per il riquadro che le serve.
    // Ed e' anche giusto nel merito: il GPS di un escursionista va agganciato ai
    // sentieri veri, non a una strada di servizio che passa li' vicino.
    //
    // default: undefined e scritto SOLO quando e' true - come importedFrom/importedName
    // e come shareable/covers al punto 24. Cosi' i 24.675 sentieri gia' sul database non
    // vanno toccati (niente migrazione) e il campo non occupa spazio dove non dice
    // niente. Chi legge filtra con { routingOnly: { $ne: true } }, che prende
    // correttamente sia i documenti vecchi sia quelli nuovi.
    routingOnly: { type: Boolean, default: undefined },

    // Quale tag OSM ha fatto entrare QUESTO tratto nel livello i, ma SOLO quando non e'
    // uno dei cinque originali (path/track/bridleway/unclassified/service) - punto 98/E,
    // seconda riapertura, 2026-08-21: 'residential' aggiunto al filtro dopo una misura
    // dedicata (scripts/misura-residential.js) che ha trovato ~34% di documenti in piu' a
    // parita' di raggio, in parte reti stradali di paesi veri, non solo scorciatoie isolate
    // come il caso reale che ha portato alla richiesta (Valle Granara).
    // Terza riapertura, 22/08/2026: 'secondary' aggiunto con lo stesso metodo
    // (scripts/misura-secondary.js) per lo stesso caso reale (Valle Granara, ma sulla SP30
    // stavolta) - misurato ~10.814 documenti in piu' sulle 4 regioni, molto meno di
    // residential perche' il filtro di vicinanza da 800 m scarta gia' il 63% dei way
    // secondary trovati vicino a sentieri noti.
    // default: undefined apposta, stesso principio di routingOnly: i tratti dei cinque tag
    // originali (e i 181.197 gia' sul database prima di questo punto) non lo scrivono,
    // quindi non costa spazio dove non serve.
    // Serve a UNA cosa sola: poter tornare indietro in modo pulito e SOLO su un tag
    // (Trail.deleteMany({viaTag:'residential'}), o {viaTag:'secondary'}) se in futuro si
    // scopre che pesa troppo sui percorsi proposti, senza dover reinterrogare Overpass per
    // capire quali documenti erano suoi.
    viaTag: { type: String, default: undefined },

    // Celle di una griglia da 0,1 gradi attraversate dal sentiero, come
    // latIdx * 10000 + lngIdx. Serve a leggere da MongoDB i sentieri di un riquadro:
    // senza, sulla collezione non c'e' NESSUN indice geografico (solo wayId) e la
    // ricerca del percorso dovrebbe scorrere tutto.
    // PERCHE' UNA GRIGLIA E NON UN INDICE 2dsphere: quello vorrebbe un campo GeoJSON,
    // cioe' le coordinate scritte DUE VOLTE, e proprio sui documenti piu' grossi che
    // ci sono - contro il vincolo hard sullo spazio di cose_da_fare.txt. Qui bastano
    // due o tre numeri per sentiero.
    cells: { type: [Number], default: undefined }
}, { timestamps: { createdAt: false, updatedAt: 'fetchedAt' } });

// Multikey su cells: e' la query della ricerca del percorso ({ cells: { $in: [...] } }).
// Insieme a region perche' si cerca sempre dentro le regioni del progetto.
trailSchema.index({ cells: 1 });

module.exports = mongoose.models.Trail || mongoose.model('Trail', trailSchema);
