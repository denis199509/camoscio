const { MongoStore } = require('connect-mongo');
const { mongoose } = require('./mongo');

// Nome della collezione usata da connect-mongo. E' il suo valore predefinito: se un giorno
// venisse cambiato nella create() qui sotto, va cambiato anche qui.
const COLLEZIONE_SESSIONI = 'sessions';

// Lo store delle sessioni su MongoDB stava scritto in linea dentro server.js. E' stato
// estratto qui (punto 7) perche' serve in due posti: a server.js per il middleware di
// sessione, e a routes/auth.js per chiudere TUTTE le sessioni di un utente quando
// reimposta la password. routes/auth.js non puo' importare server.js - server.js importa
// gia' le rotte, e si girerebbero in tondo.
const sessionStore = MongoStore.create({ mongoUrl: process.env.MONGODB_URI });

// connect-mongo salva il contenuto della sessione dentro il campo "session", che a seconda
// della configurazione e' una stringa JSON (impostazione predefinita, quella in uso qui)
// oppure gia' un oggetto. Si accettano tutti e due invece di dare per scontato quello di
// oggi: se un domani cambiasse l'impostazione, una funzione di sicurezza che smette di
// funzionare IN SILENZIO sarebbe peggio di una che non c'e' mai stata.
function leggiSessione(documento) {
    const grezzo = documento && documento.session;
    if (!grezzo) return null;
    if (typeof grezzo === 'object') return grezzo;
    try {
        return JSON.parse(grezzo);
    } catch {
        return null;
    }
}

/**
 * Chiude tutte le sessioni aperte di un utente, su qualunque dispositivo.
 * Con "tranneSid" si puo' risparmiare quella corrente. Ritorna quante ne ha chiuse.
 *
 * PERCHE' NON USA store.all(): all() di connect-mongo restituisce solo il CONTENUTO delle
 * sessioni, senza il loro identificativo - quindi permette di leggerle ma non di
 * cancellarle. Verificato nel codice della libreria (dist/index.cjs), non dato per
 * scontato. Si legge percio' la collezione, che espone anche l'_id.
 * L'_id di un documento di sessione E' il suo sid (computeStorageId e' l'identita' nella
 * configurazione in uso), quindi cancellare per _id equivale a store.destroy(sid).
 * Il costo di leggerle tutte e' trascurabile: sono le sessioni ATTIVE del sito, non uno
 * storico che cresce - quelle scadute le toglie MongoDB da solo.
 */
async function chiudiTutteLeSessioni(userId, tranneSid = null) {
    const idCercato = String(userId);

    try {
        const collezione = mongoose.connection.collection(COLLEZIONE_SESSIONI);

        // Il filtro lo fa MongoDB, non questo processo: sul database ci sono gia' centinaia
        // di sessioni attive e caricarle tutte in memoria per scartarne quasi tutte sarebbe
        // uno spreco proprio dove lo spazio e' poco (512 MB su Render, ed e' gia' bastato a
        // far cadere il sito una volta, in Fase G).
        // I due rami coprono i due formati possibili del campo "session" - vedi sotto.
        const idPerRegex = idCercato.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const documenti = await collezione.find({
            $or: [
                { 'session.userId': idCercato },                        // salvato come oggetto
                { session: { $regex: `"userId":"${idPerRegex}"` } }      // salvato come stringa JSON
            ]
        }).toArray();

        const daChiudere = documenti
            .filter((doc) => {
                if (tranneSid && doc._id === tranneSid) return false;
                // Si ricontrolla dopo aver letto il documento: la ricerca per testo trova la
                // riga giusta, ma solo leggendo davvero il campo si e' sicuri di non
                // cancellare la sessione di qualcun altro.
                const dati = leggiSessione(doc);
                return !!dati && String(dati.userId) === idCercato;
            })
            .map((doc) => doc._id);

        if (daChiudere.length === 0) return 0;

        const esito = await collezione.deleteMany({ _id: { $in: daChiudere } });
        return esito.deletedCount || 0;
    } catch (e) {
        // Non deve far fallire il cambio password: la password nuova e' gia' salvata, e
        // un errore qui lascerebbe l'utente a credere che il cambio non sia avvenuto.
        // Va pero' visto nel log, perche' vuol dire che qualcuno e' rimasto dentro.
        console.error('Impossibile chiudere le sessioni aperte:', e.message);
        return 0;
    }
}

module.exports = { sessionStore, chiudiTutteLeSessioni, COLLEZIONE_SESSIONI };
