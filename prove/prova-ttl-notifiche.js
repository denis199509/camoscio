// PROVA: TTL di 90 giorni sulle Notification.
//
// PERCHE': Notification.text e' una stringa libera generata dal server e spesso contiene il
// nome di un altro utente ("Mario Rossi ha chiesto di..."). scrubAccount cancella le
// notifiche DI chi si elimina, non quelle SU DI LUI nelle liste altrui: senza un limite di
// tempo quel nome resterebbe visibile a tempo indefinito. Il fix e' un indice TTL su
// createdAt (models/Notification.js) - la campanella e' un flusso transitorio.
//
// COSA CONTROLLA: che lo schema dichiari l'indice TTL giusto (chiave createdAt, 90 giorni
// esatti). E' quella dichiarazione che, con autoIndex attivo (vedi models/Report.js, il cui
// TTL su `reports` esiste davvero sul DB - verificato), diventa un indice reale al primo uso
// del modello. Controllo di SOLO SCHEMA: niente server, niente DB, niente indici creati per
// side-effect su Atlas.
//
// Lanciarla:  node prove/prova-ttl-notifiche.js

const GIORNI = 90;
const ATTESO_SECONDI = GIORNI * 24 * 60 * 60; // 7.776.000

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

(async () => {
    try {
        const Notification = require('../models/Notification');

        // schema.indexes() -> [[chiavi, opzioni], ...]
        const indici = Notification.schema.indexes();
        console.log('Indici dichiarati dallo schema Notification:');
        for (const [chiavi, opzioni] of indici) {
            console.log('  ', JSON.stringify(chiavi), JSON.stringify(opzioni || {}));
        }
        console.log('');

        const ttl = indici.find(([chiavi, opzioni]) =>
            chiavi && chiavi.createdAt === 1 && opzioni && typeof opzioni.expireAfterSeconds === 'number');

        ok('esiste un indice TTL sulla chiave createdAt', !!ttl,
            'nessun indice { createdAt: 1 } con expireAfterSeconds');

        ok(`il TTL e' esattamente ${GIORNI} giorni (${ATTESO_SECONDI}s)`,
            !!ttl && ttl[1].expireAfterSeconds === ATTESO_SECONDI,
            ttl ? `trovato ${ttl[1].expireAfterSeconds}s` : '');

        // Il campo createdAt deve esistere sul serio (timestamps) - se qualcuno togliesse
        // `timestamps` lo schema accetterebbe comunque l'indice ma non ci sarebbe niente da
        // far scadere.
        const haCreatedAt = !!Notification.schema.path('createdAt');
        ok('lo schema ha davvero il campo createdAt (timestamps attivi)', haCreatedAt);

        // Nessun altro indice TTL di troppo (una svista di copia-incolla).
        const quantiTtl = indici.filter(([, o]) => o && typeof o.expireAfterSeconds === 'number').length;
        ok('c\'e\' un solo indice TTL, non di piu\'', quantiTtl === 1, `trovati ${quantiTtl}`);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
