// Recupero dell'accesso senza secondo fattore (opzione C). Blocco 5 del piano 2FA:
// C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md (sez. 1b).
//
// STA IN UN FILE A SE' e NON dentro lib/tokens.js: quel file ha un contratto omogeneo -
// token usa-e-getta a durata FISSA dalla creazione - e infilarci l'eccezione lo renderebbe
// meno leggibile proprio dove serve chiarezza. Qui la validita' e' un INTERVALLO CHE
// COMINCIA NEL FUTURO ([maturaIl, maturaIl + finestra]) e il "crea" deve essere idempotente.
// Il *principio* di lib/tokens.js invece si copia pari pari, ed e' il piu' importante: la
// scadenza si ricontrolla NEL CODICE, l'indice TTL fa solo le pulizie.

const crypto = require('crypto');
const { impronta } = require('./tokens');
const AccountRecovery = require('../models/AccountRecovery');

const MS_GIORNO = 24 * 60 * 60 * 1000;

// 256 bit, base64url (il token finisce dentro un indirizzo web). Identico a generaToken() di
// lib/tokens.js - copiato di proposito e non importato, per la ragione in testa al file.
function generaToken() {
    return crypto.randomBytes(32).toString('base64url');
}

// Cutoff sotto cui un recupero e' scaduto per davvero (oltre maturaIl + la finestra), anche
// se il TTL non l'ha ancora spazzato via (revisione del cumulativo 42a): senza, nella manciata
// di secondi/minuti prima della spazzata un recupero MORTO restava "vivo" per le due funzioni
// qui sotto - avviaOTrovaRecupero rispondeva "gia' in corso" con una maturaIl nel PASSATO
// invece di aprirne uno nuovo, e recuperoVivoDi mostrava lo stesso fantasma sul banner.
function dataLimiteVivo() {
    return new Date(Date.now() - AccountRecovery.DURATA_FINESTRA_GIORNI * MS_GIORNO);
}

// Avvia un recupero, OPPURE restituisce quello gia' in corso. A prova di doppio clic e di
// due schede: NON "leggi, poi crea", ma un findOneAndUpdate con upsert. Il filtro prende
// solo un recupero VIVO (non annullato, non completato); $setOnInsert scrive tutto e SOLO
// se e' un inserimento vero. Si guarda lastErrorObject.updatedExisting per sapere se c'era.
//
// NON creaToken() di lib/tokens.js: quello fa deleteMany({userId}) PRIMA di creare - su
// AccountRecovery vorrebbe dire che ogni nuova richiesta cancella il recupero in corso e fa
// RIPARTIRE l'attesa da zero, il modo piu' silenzioso per svuotare il meccanismo (un
// attaccante che ri-avvia il recupero ogni giorno non arriverebbe mai a maturazione... ma
// nemmeno il proprietario legittimo).
//
// Resta scoperta la sola corsa VERAMENTE simultanea (due upsert nello stesso giro, prima che
// il primo abbia scritto: nessun indice unique su userId puo' impedirlo, perche' i recuperi
// annullati/completati restano nella collezione). Il peggio che fa NON e' innocuo: due
// AccountRecovery vivi per lo stesso utente, entrambi maturano. Mitigato invece che chiuso
// (revisione del cumulativo 42a, ALTO-3): /recovery/cancel e /2fa/disable annullano TUTTI i
// vivi in un colpo solo (updateMany, non updateOne, in routes/auth.js) e recuperoVivoDi() qui
// sotto sceglie sempre il piu' vicino a maturare se per un istante ne resta piu' di uno.
//
// -> { recupero, token, gia:false }    se e' NUOVO: token = quello in chiaro appena generato
// -> { recupero, token:null, gia:true } se ne esisteva gia' uno: del vecchio abbiamo solo
//                                        l'impronta, il token in chiaro non e' recuperabile
async function avviaOTrovaRecupero(userId) {
    const token = generaToken();
    const ora = new Date();
    const maturaIl = new Date(ora.getTime() + AccountRecovery.DURATA_ATTESA_GIORNI * MS_GIORNO);

    const esito = await AccountRecovery.findOneAndUpdate(
        {
            userId, annullatoIl: { $exists: false }, completatoIl: { $exists: false },
            maturaIl: { $gte: dataLimiteVivo() }
        },
        {
            $setOnInsert: {
                userId,
                tokenHash: impronta(token),
                createdAt: ora,
                maturaIl,
                // esplicito: la default `function () { return this.maturaIl }` dello schema
                // non e' affidabile durante un upsert (this non e' il documento).
                expiresAt: maturaIl
            }
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, setDefaultsOnInsert: false }
    );

    const eraGiaLi = !!(esito.lastErrorObject && esito.lastErrorObject.updatedExisting);
    return {
        recupero: esito.value,
        token: eraGiaLi ? null : token,
        gia: eraGiaLi
    };
}

// NON trovaValido() di lib/tokens.js: quello misura l'eta' da createdAt contro una durata
// fissa. Qui la validita' e' un intervallo che comincia nel futuro. Ritorna il documento
// solo se: esiste, non annullato, non completato, e maturaIl <= adesso <= maturaIl+finestra.
// Lo STATO distinto serve al client per dire "questo link funzionera' dal <data>" invece di
// "link non valido" (che sarebbe falso e farebbe buttare via un link ancora buono).
// -> { stato, recupero?, maturaIl? }
//    stato: 'ok' | 'assente' | 'annullato' | 'completato' | 'nonMaturo' | 'scaduto'
async function trovaRecuperoUtilizzabile(token) {
    if (typeof token !== 'string' || token.length < 20) return { stato: 'assente' };
    const rec = await AccountRecovery.findOne({ tokenHash: impronta(token) });
    if (!rec) return { stato: 'assente' };
    if (rec.annullatoIl) return { stato: 'annullato', maturaIl: rec.maturaIl };
    if (rec.completatoIl) return { stato: 'completato', maturaIl: rec.maturaIl };

    const ora = Date.now();
    const matura = new Date(rec.maturaIl).getTime();
    if (ora < matura) return { stato: 'nonMaturo', recupero: rec, maturaIl: rec.maturaIl };
    if (ora > matura + AccountRecovery.DURATA_FINESTRA_GIORNI * MS_GIORNO) {
        return { stato: 'scaduto', maturaIl: rec.maturaIl };
    }
    return { stato: 'ok', recupero: rec, maturaIl: rec.maturaIl };
}

// Il recupero VIVO (non annullato, non completato) piu' vicino a maturare. Lo usano il
// banner (GET /recovery/status) e l'annullamento. Per progetto ne esiste di norma al piu'
// uno; sort({maturaIl:1}) e' la difesa contro la corsa rara di avviaOTrovaRecupero() qui
// sopra, che puo' lasciarne due vivi per un istante - meglio mostrare (e annullare) quello
// che conta davvero, il piu' imminente, che uno scelto a caso dall'ordine naturale di Mongo.
async function recuperoVivoDi(userId) {
    return AccountRecovery.findOne({
        userId,
        annullatoIl: { $exists: false },
        completatoIl: { $exists: false },
        maturaIl: { $gte: dataLimiteVivo() }
    }).sort({ maturaIl: 1 });
}

module.exports = { avviaOTrovaRecupero, trovaRecuperoUtilizzabile, recuperoVivoDi };
