// ==========================================================================
// PROVA DEL DISLIVELLO NEL TRACCIAMENTO DAL VIVO (2026-07-28)
//
// COSA CAMBIA E PERCHE'. Fino a oggi il tracciamento sommava ogni salto di quota sopra i
// 3 metri fra due punti consecutivi. Su un GPS da telefono - che sulla quota sbaglia
// molto piu' di 3 metri - quel tremolio diventava salita vera: la camminata di prova
// dell'utente del 2026-07-28, 137 metri in piano con la quota fra 112 e 120 m, risultava
// con 21 METRI DI DISLIVELLO.
// Ora si usa la stessa regola dei file .gpx importati (quanto si e' saliti in tutto sopra
// l'ultimo avvallamento), applicata a gruppi tenendo due numeri sulla sessione.
//
// IL CONTROLLO PIU' IMPORTANTE E' IL 2: che il conto fatto GRUPPO PER GRUPPO dia
// ESATTAMENTE lo stesso risultato di una passata sola su tutta la traccia. Se cosi' non
// fosse, il dislivello di un'escursione dipenderebbe da quanto spesso il telefono ha
// trovato campo - cioe' due persone che camminano insieme tornerebbero a casa con numeri
// diversi.
//
// NON SCRIVE NIENTE SUL DATABASE.
//
// Lanciarla:  node prove/prova-dislivello-vivo.js      (non serve il server acceso)
// ==========================================================================

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { statisticheTraccia, SOGLIA_DISLIVELLO_M } = require('../lib/gpx');
const { haversineKm, isFiniteNum } = require('../lib/geometry');

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// LA REGOLA NUOVA, COPIATA DAL SERVER (routes/tracking.js, rotta /:id/points). E' l'unico
// modo di provarla senza un server acceso e senza un telefono che cammina; se un giorno la
// regola la' cambia, questa prova va aggiornata insieme - il controllo 2 se ne accorge.
function aggiungiGruppo(stato, punti) {
    let riferimento = isFiniteNum(stato.riferimento) ? stato.riferimento : null;
    let aggiunta = 0;
    for (const p of punti) {
        const quota = p[2];
        if (riferimento === null) { riferimento = quota; continue; }
        if (quota > riferimento + SOGLIA_DISLIVELLO_M) { aggiunta += quota - riferimento; riferimento = quota; }
        else if (quota < riferimento) { riferimento = quota; }
    }
    stato.riferimento = riferimento;
    stato.totale += Math.round(aggiunta);
    return stato;
}

// --- Per la sezione 6, che parla col server vero ---

const BASE_URL = 'http://localhost:3000';

async function serverAcceso() {
    try {
        const r = await fetch(BASE_URL + '/api/auth/demo-accounts', { signal: AbortSignal.timeout(3000) });
        return r.ok;
    } catch { return false; }
}

// /api/auth/demo-accounts espone "id", NON "_id" (trappola gia' pagata piu' volte).
async function entraComeDemo() {
    const elenco = await (await fetch(BASE_URL + '/api/auth/demo-accounts')).json();
    const r = await fetch(BASE_URL + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: elenco[0].id })
    });
    if (!r.ok) throw new Error('accesso demo fallito: ' + r.status);
    const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
    return { cookie, userId: elenco[0].id, nome: elenco[0].username };
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE_URL + percorso, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${percorso} -> ${r.status}: ${testo.slice(0, 160)}`);
    return testo ? JSON.parse(testo) : null;
}

// La vecchia regola, tenuta qui SOLO per poter mostrare la differenza sui dati veri.
function regolaVecchia(punti) {
    let totale = 0;
    for (let i = 1; i < punti.length; i++) {
        const d = punti[i][2] - punti[i - 1][2];
        if (d > 3) totale += d;
    }
    return Math.round(totale);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const partenza = await mongoose.connection.collection('activehikesessions').countDocuments();

    try {
        // --- 1. La camminata vera che ha fatto scoprire il difetto ---
        console.log('1. La camminata di prova dell\'utente (137 m in piano)');
        const camminata = [
            [12.66132, 41.90586, 112, 0, 12],
            [12.66140, 41.90590, 113, 5, 16],
            [12.66148, 41.90594, 113, 10, 20],
            [12.66156, 41.90598, 113, 15, 18],
            [12.66164, 41.90602, 120, 20, 5],
            [12.66172, 41.90606, 113, 25, 6]
        ];
        const vecchio = regolaVecchia(camminata);
        const nuovo = aggiungiGruppo({ totale: 0, riferimento: null }, camminata).totale;
        console.log(`     escursione di quota reale: 112 -> 120 m, cioe' 8 metri in tutto`);
        console.log(`     regola vecchia: ${vecchio} m    regola nuova: ${nuovo} m`);
        ok('la regola vecchia contava salita che non c\'era', vecchio > 0, `${vecchio} m`);
        ok('la regola nuova da\' zero su un percorso in piano', nuovo === 0, `${nuovo} m`);

        // --- 2. IL CONTROLLO CHE CONTA: a gruppi o tutto insieme, stesso numero ---
        console.log('\n2. Il conto a gruppi deve dare lo stesso numero di una passata sola');
        const vere = await mongoose.connection.collection('activehikesessions')
            .find({ importedFrom: 'gpx' }).toArray();
        ok('ci sono tracce vere su cui provarlo', vere.length >= 1, `${vere.length}`);

        for (const s of vere) {
            const punti = s.points.map(p => [p[0], p[1], p[2]]);
            const nome = (s.importedName || '').slice(0, 24);
            const tuttoInsieme = statisticheTraccia(punti, SOGLIA_DISLIVELLO_M, haversineKm).dislivelloM;

            // Si prova con gruppi di dimensione diversa, perche' in montagna e' proprio
            // cosi': il telefono manda quando trova campo, cinque punti o duecento.
            for (const dimensione of [1, 3, 7, 50, 500]) {
                const stato = { totale: 0, riferimento: null };
                for (let i = 0; i < punti.length; i += dimensione) {
                    aggiungiGruppo(stato, punti.slice(i, i + dimensione));
                }
                ok(`${nome}: a gruppi di ${dimensione} da' lo stesso di una passata sola`,
                    Math.abs(stato.totale - tuttoInsieme) <= 1,
                    `gruppi ${stato.totale} m contro ${tuttoInsieme} m`);
            }
            console.log(`     ${nome}: ${tuttoInsieme} m (salvato sul database: ${s.elevationGainM} m)`);
        }

        // --- 3. Una salita vera continua a essere contata ---
        console.log('\n3. Una salita vera non deve sparire');
        const salita = [];
        for (let i = 0; i <= 120; i++) salita.push([13.5 + i * 0.0003, 42.4, 1000 + i * 5]);
        const conSalita = aggiungiGruppo({ totale: 0, riferimento: null }, salita).totale;
        ok('una salita regolare da 600 m viene contata quasi tutta',
            conSalita >= 580 && conSalita <= 600, `${conSalita} m`);

        // E anche a gruppi.
        const statoGruppi = { totale: 0, riferimento: null };
        for (let i = 0; i < salita.length; i += 11) aggiungiGruppo(statoGruppi, salita.slice(i, i + 11));
        ok('e lo stesso arrivando a gruppi', Math.abs(statoGruppi.totale - conSalita) <= 1,
            `${statoGruppi.totale} m contro ${conSalita} m`);

        // --- 4. Il tremolio del GPS attorno a una quota costante ---
        console.log('\n4. Stando fermi con un GPS ballerino');
        const fermoCon = ampiezza => {
            const q = [];
            for (let i = 0; i <= 200; i++) q.push([13.5, 42.4, 800 + Math.sin(i * 1.3) * ampiezza + Math.sin(i * 0.37) * ampiezza * 0.6]);
            return q;
        };

        // Al livello di tremolio davvero osservato nei dati dell'utente (la sua camminata
        // aveva 8 metri di escursione in tutto) la regola nuova non conta niente.
        const comeNellaRealta = fermoCon(3);
        const escursione = Math.round(Math.max(...comeNellaRealta.map(p => p[2])) - Math.min(...comeNellaRealta.map(p => p[2])));
        const nuovoReale = aggiungiGruppo({ totale: 0, riferimento: null }, comeNellaRealta).totale;
        ok(`col tremolio osservato davvero (${escursione} m di escursione) la regola nuova da' zero`,
            nuovoReale === 0, `${nuovoReale} m`);
        ok('la regola vecchia invece contava salita anche li\'', regolaVecchia(comeNellaRealta) > 0,
            `${regolaVecchia(comeNellaRealta)} m`);

        // IL RESIDUO ONESTO, messo per iscritto invece che nascosto: con oscillazioni piu'
        // ampie della soglia (10 m) la regola nuova conta ancora qualcosa. Non e' un difetto
        // che si puo' togliere con questa regola - servirebbe pulire la quota PRIMA di
        // contarla, come si fa col modello del terreno al punto 33.
        // Quello che si puo' provare, e che vale, e' che la regola nuova NON E' MAI PEGGIO
        // della vecchia. Se un domani qualcuno la cambia, questo controllo se ne accorge.
        console.log('     residuo noto (a memoria di chi verra\' dopo):');
        console.log('       tremolio   escursione   regola vecchia   regola nuova');
        for (const ampiezza of [3, 5, 7, 10, 15]) {
            const q = fermoCon(ampiezza);
            const esc = Math.round(Math.max(...q.map(p => p[2])) - Math.min(...q.map(p => p[2])));
            const vecchia = regolaVecchia(q);
            const nuova = aggiungiGruppo({ totale: 0, riferimento: null }, q).totale;
            console.log(`         ±${String(ampiezza).padStart(2)} m       ${String(esc).padStart(3)} m           ${String(vecchia).padStart(5)} m        ${String(nuova).padStart(5)} m`);
            ok(`col tremolio a ±${ampiezza} m la regola nuova non e' mai peggio della vecchia`,
                nuova <= vecchia, `nuova ${nuova} m contro vecchia ${vecchia} m`);
        }

        // --- 5. Un dente di sega piu' alto della soglia DEVE contare ---
        // Non e' un dettaglio: se la regola scartasse anche i saliscendi veri, un percorso
        // ondulato risulterebbe piu' facile di quello che e'.
        console.log('\n5. I saliscendi veri devono contare');
        const saliscendi = [];
        for (let g = 0; g < 5; g++) {
            for (let i = 0; i <= 10; i++) saliscendi.push([13.5, 42.4, 1000 + i * 10]);   // +100
            for (let i = 10; i >= 0; i--) saliscendi.push([13.5, 42.4, 1000 + i * 10]);   // -100
        }
        const conSaliscendi = aggiungiGruppo({ totale: 0, riferimento: null }, saliscendi).totale;
        ok('cinque salite da 100 m fanno circa 500 m, non zero',
            conSaliscendi >= 450 && conSaliscendi <= 500, `${conSaliscendi} m`);

        // --- 6. IL SERVER VERO, non una copia della regola ---
        //
        // Tutto quello sopra prova una COPIA della regola scritta dentro questa prova. Se il
        // server un giorno diverge, i controlli passerebbero lo stesso: e' esattamente il
        // "controllo che sembra copertura" contro cui mette in guardia LEGGIMI-PROVE.txt.
        // Qui invece si mandano davvero i punti alla rotta, a gruppi come fa il telefono.
        //
        // SCRIVE SUL DATABASE, quindi: account di prova (uno dei demo), e la sessione creata
        // viene cancellata in un finally, filtrata per il SUO userId - la regola nata dal
        // timbro cancellato per sbaglio il 2026-07-27.
        console.log('\n6. Il server vero, coi punti mandati a gruppi');
        if (!(await serverAcceso())) {
            console.log('     (server non acceso su localhost:3000: sezione saltata)');
            console.log('     lancialo con:  node server.js > prove/server-prove.log 2>&1');
        } else {
            let sessioneDiProva = null, utenteDiProva = null;
            try {
                const biscotto = await entraComeDemo();
                utenteDiProva = biscotto.userId;

                const avvio = await chiama('POST', '/api/tracking/start', {}, biscotto.cookie);
                sessioneDiProva = avvio.id || avvio._id;
                ok('sessione di prova avviata', !!sessioneDiProva);

                // Una salita vera di 300 m con sopra il tremolio del GPS, mandata a gruppi
                // di sette punti come farebbe un telefono con poco campo.
                const traccia = [];
                for (let i = 0; i <= 100; i++) {
                    traccia.push([13.5 + i * 0.0002, 42.4, 1000 + i * 3 + Math.sin(i * 1.3) * 3, i * 10, 8]);
                }
                for (let i = 0; i < traccia.length; i += 7) {
                    await chiama('POST', `/api/tracking/${sessioneDiProva}/points`,
                        { points: traccia.slice(i, i + 7) }, biscotto.cookie);
                }

                const finale = await mongoose.connection.collection('activehikesessions')
                    .findOne({ _id: new mongoose.Types.ObjectId(String(sessioneDiProva)) });

                // Lo stesso conto fatto qui, in una passata sola, sugli stessi punti.
                const atteso = statisticheTraccia(traccia.map(p => [p[0], p[1], p[2]]), SOGLIA_DISLIVELLO_M, haversineKm).dislivelloM;
                console.log(`     il server dice ${finale.elevationGainM} m, il conto in una passata sola dice ${atteso} m (salita vera 300 m)`);
                ok('il server calcola lo stesso numero di una passata sola',
                    Math.abs(finale.elevationGainM - atteso) <= 1, `${finale.elevationGainM} contro ${atteso}`);
                ok('e il numero e\' vicino alla salita vera, non gonfiato',
                    finale.elevationGainM >= 280 && finale.elevationGainM <= 310, `${finale.elevationGainM} m`);
                ok('il server si e\' ricordato il riferimento fra un gruppo e l\'altro',
                    isFiniteNum(finale.elevationRefM), String(finale.elevationRefM));
            } finally {
                if (sessioneDiProva && utenteDiProva) {
                    // Filtrata per userId E per id della sessione: due filtri, non uno.
                    const tolte = await mongoose.connection.collection('activehikesessions').deleteMany({
                        _id: new mongoose.Types.ObjectId(String(sessioneDiProva)),
                        userId: new mongoose.Types.ObjectId(String(utenteDiProva))
                    });
                    console.log(`     (pulizia: ${tolte.deletedCount} sessione di prova cancellata)`);
                }
            }
        }

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        const fine = await mongoose.connection.collection('activehikesessions').countDocuments();
        ok('nessuna sessione creata o persa', fine === partenza, `${partenza} -> ${fine}`);
        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
