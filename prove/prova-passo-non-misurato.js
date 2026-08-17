// PROVA: "non misurato" non e' 350.
//
// Il difetto, segnalato da Denis il 16/08/2026 con uno screenshot di un account REALE appena
// registrato (Scheldon, zero escursioni): la card "Calcolatore Passo & Fatica" della
// Dashboard mostrava "Velocita' Ascesa: 350 m/h, Velocita' Discesa: 500 m/h, Indice Fatica
// 1.14x" e un grafico a barre piene, come se fosse un dato misurato. Non lo era: erano i
// valori di default che models/User.js scriveva addosso a ogni utente nell'istante della
// registrazione. Sue parole: "per un utente Appena registrato senza dati dovrebbe mostrare
// non definito oppure una cosa simile. non possiamo fare ipotesi."
//
// Questa prova sorveglia la regola che ne e' uscita, sui tre livelli in cui vive:
//   - MODELLO: un utente nuovo nasce SENZA il campo (il campo assente = "mai misurato");
//   - DOMINIO: recalculatePersonalPace torna null a zero osservazioni, e applyPersonalPace
//     toglie il campo invece di scriverci un numero inventato;
//   - INTERFACCIA: calculateHikeTimes continua a produrre un tempo previsto (li' un divisore
//     serve per forza) ma dichiara che NON e' "il tuo passo".
//
// Non tocca il database in scrittura: l'unica lettura vera e' un recalculatePersonalPace su
// un id inesistente (zero completamenti per definizione, nessun dato di prova da creare e
// quindi nessuna pulizia da ricordarsi).
//
// Lanciarla:  node prove/prova-passo-non-misurato.js      (non serve il server acceso)

require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const {
    recalculatePersonalPace,
    applyPersonalPace,
    recalculateExperienceLevel,
    DEFAULT_PACE_UP,
    DEFAULT_PACE_DOWN
} = require('../lib/hikeStats');

const RADICE = path.join(__dirname, '..');

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// Carica una funzione di un file del frontend in Node: i file di public/js dichiarano
// funzioni e le appendono a window in fondo, quindi basta un "window" finto - nessun DOM
// coinvolto in calculateHikeTimes. "finestra" e' condivisa fra piu' chiamate: dal punto 92
// profile.js legge window.oreCai da cai-tempi.js, esattamente come nella pagina vera lo
// script di cai-tempi.js gira PRIMA di profile.js (vedi index.html).
const finestra = {};
function daFrontend(file) {
    const sorgente = fs.readFileSync(path.join(RADICE, 'public', 'js', file), 'utf8');
    new Function('window', sorgente)(finestra);
    return finestra;
}

(async () => {
    try {
        console.log('--- 1. MODELLO: un utente nuovo non nasce con un passo addosso ---');

        ok('averagePaceUp non ha piu' + '\' un default numerico nello schema',
            User.schema.path('averagePaceUp').defaultValue === undefined,
            String(User.schema.path('averagePaceUp').defaultValue));
        ok('averagePaceDown non ha piu' + '\' un default numerico nello schema',
            User.schema.path('averagePaceDown').defaultValue === undefined,
            String(User.schema.path('averagePaceDown').defaultValue));

        const nuovo = new User({ username: 'Prova Passo Non Misurato', nome: 'Prova', cognome: 'Prova' });
        const jsonNuovo = nuovo.toJSON();
        ok('un documento utente appena creato NON espone averagePaceUp',
            !Object.prototype.hasOwnProperty.call(jsonNuovo, 'averagePaceUp'), String(jsonNuovo.averagePaceUp));
        ok('un documento utente appena creato NON espone averagePaceDown',
            !Object.prototype.hasOwnProperty.call(jsonNuovo, 'averagePaceDown'), String(jsonNuovo.averagePaceDown));

        const sorgenteModello = fs.readFileSync(path.join(RADICE, 'models', 'User.js'), 'utf8');
        ok('models/User.js non contiene piu' + '\' "default: 350"', !/averagePaceUp:\s*\{[^}]*default:\s*350/.test(sorgenteModello));

        console.log('\n--- 2. DOMINIO: zero osservazioni vale null, non il default ---');

        await connectMongo();
        // Id inesistente: zero Completion per costruzione, nessun dato di prova creato.
        const idInesistente = new mongoose.Types.ObjectId();
        const vuoto = await recalculatePersonalPace(idInesistente);
        ok('nessun completamento => zero osservazioni', vuoto.osservazioni.length === 0, String(vuoto.osservazioni.length));
        ok('nessun completamento => nuovoPaceUp null (NON 350)', vuoto.nuovoPaceUp === null, String(vuoto.nuovoPaceUp));
        ok('nessun completamento => nuovoPaceDown null (NON 500)', vuoto.nuovoPaceDown === null, String(vuoto.nuovoPaceDown));
        ok('i due numeri restano disponibili come IPOTESI di calcolo',
            DEFAULT_PACE_UP === 350 && DEFAULT_PACE_DOWN === 500, `${DEFAULT_PACE_UP}/${DEFAULT_PACE_DOWN}`);

        // Documento "gia' caricato" simulato: nessun salvataggio, si guarda solo cosa
        // scriverebbe sul database.
        const conPasso = new User({ username: 'Prova Con Passo', nome: 'Prova', cognome: 'Prova', averagePaceUp: 350, averagePaceDown: 500 });
        conPasso.isNew = false;
        applyPersonalPace(conPasso, vuoto);
        const modifiche = conPasso.$getChanges();
        ok('applyPersonalPace a zero osservazioni produce un $unset di averagePaceUp',
            !!(modifiche.$unset && modifiche.$unset.averagePaceUp), JSON.stringify(modifiche.$unset || {}));
        ok('applyPersonalPace a zero osservazioni produce un $unset di averagePaceDown',
            !!(modifiche.$unset && modifiche.$unset.averagePaceDown), JSON.stringify(modifiche.$unset || {}));
        ok('e NON scrive 350 al posto suo',
            !(modifiche.$set && modifiche.$set.averagePaceUp), JSON.stringify(modifiche.$set || {}));
        ok('dopo lo svuotamento il documento non espone piu' + '\' il passo',
            !Object.prototype.hasOwnProperty.call(conPasso.toJSON(), 'averagePaceUp'));

        const conMisura = new User({ username: 'Prova Misurato', nome: 'Prova', cognome: 'Prova' });
        conMisura.isNew = false;
        applyPersonalPace(conMisura, { osservazioni: [{ paceUp: 320 }], nuovoPaceUp: 320, nuovoPaceDown: 457 });
        ok('con una misura vera applyPersonalPace scrive il valore in salita', conMisura.averagePaceUp === 320, String(conMisura.averagePaceUp));
        ok('con una misura vera applyPersonalPace scrive il valore in discesa', conMisura.averagePaceDown === 457, String(conMisura.averagePaceDown));

        // La trappola gia' pagata in Fase H: 350 e' anche la soglia di "Intermedio", quindi un
        // default scritto addosso promuoveva chiunque alla prima escursione completata.
        const principiante = { completedHikes: 1, averagePaceUp: undefined };
        recalculateExperienceLevel(principiante, false);
        ok('senza passo misurato una prima escursione NON promuove a Intermedio',
            principiante.experienceLevel === 'Principiante', principiante.experienceLevel);
        const esperto = { completedHikes: 1, averagePaceUp: 600 };
        recalculateExperienceLevel(esperto, true);
        ok('con un passo misurato alto il livello sale come sempre',
            esperto.experienceLevel === 'Esperto', esperto.experienceLevel);

        console.log('\n--- 3. INTERFACCIA: il tempo previsto non si rompe, ma non mente ---');

        daFrontend('cai-tempi.js');
        const { calculateHikeTimes } = daFrontend('profile.js');
        const escursione = { elevationGain: 800, distanceKm: 12 };

        const senzaPasso = calculateHikeTimes(escursione, { username: 'Nuovo' });
        ok('utente senza passo misurato: passoMisurato false', senzaPasso.passoMisurato === false, String(senzaPasso.passoMisurato));
        ok('utente senza passo misurato: il tempo previsto si calcola comunque (nessun NaN)',
            /^\d+h \d+m$/.test(senzaPasso.customText) && !senzaPasso.customText.includes('NaN'), senzaPasso.customText);
        ok('utente senza passo misurato: nessun indice di fatica inventato',
            senzaPasso.fatigueIndex === null, String(senzaPasso.fatigueIndex));

        const conPassoVero = calculateHikeTimes(escursione, { username: 'Veterano', averagePaceUp: 600, averagePaceDown: 850 });
        ok('utente con passo misurato: passoMisurato true', conPassoVero.passoMisurato === true);
        ok('utente con passo misurato: il tempo sul suo passo e' + '\' piu' + '\' veloce del CAI standard',
            conPassoVero.hoursDifference < 0, String(conPassoVero.hoursDifference));
        ok('il tempo CAI standard NON dipende da chi guarda',
            senzaPasso.standardText === conPassoVero.standardText, `${senzaPasso.standardText} / ${conPassoVero.standardText}`);

        console.log('\n--- 4. Il difetto non puo' + '\' rientrare dalla porta di servizio ---');

        const sorgenteApp = fs.readFileSync(path.join(RADICE, 'public', 'js', 'app.js'), 'utf8');
        ok('app.js non scrive piu' + '\' il passo a schermo senza controllarlo',
            !/textContent\s*=\s*usr\.averagePace/.test(sorgenteApp));
        ok('app.js decide le barre del grafico su passoMisurato',
            /passoMisurato\s*\?\s*\[datasetUtente,\s*datasetCai\]\s*:\s*\[datasetCai\]/.test(sorgenteApp));

        const sorgenteHtml = fs.readFileSync(path.join(RADICE, 'public', 'index.html'), 'utf8');
        ok('index.html tiene le unita' + '\' di misura in span nascondibili (niente "— m/h")',
            /id="pace-up-unit"/.test(sorgenteHtml) && /id="pace-index-unit"/.test(sorgenteHtml));
        ok('index.html ha il posto per la nota "passo non ancora misurato"',
            /id="dash-pace-note"/.test(sorgenteHtml));

        const sorgenteSocial = fs.readFileSync(path.join(RADICE, 'public', 'js', 'social.js'), 'utf8');
        ok('la scheda escursione scrive "sul tuo passo" solo con un passo misurato',
            /tempi\.passoMisurato/.test(sorgenteSocial));
    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        await mongoose.disconnect().catch(() => {});
        console.log(`\n  PASSATI: ${passati}   FALLITI: ${falliti}`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
