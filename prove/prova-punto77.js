// PROVA DEL PUNTO 77: un'escursione CONCLUSA (hike.groupCompletedAt, stesso segnale gia'
// usato dal punto 76) deve sparire da GET /api/hikes per chi non vi ha partecipato, restando
// visibile a chi vi ha partecipato. Un'escursione ancora PROGRAMMATA resta visibile a tutti,
// come sempre (nessuna regressione sul comportamento di sempre).
//
// Tre account demo: A (organizzatore, resta partecipante), B (si iscrive ma NON viene
// confermato al completamento di gruppo - deve sparirgli), C (non si iscrive mai, resta
// spettatore esterno per tutta la prova).
//
// Lanciarla:  node prove/prova-punto77.js      (non serve un server gia' acceso, ne avvia uno suo)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3104;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let corpoRisposta = null;
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* risposta non-JSON */ }
    return { status: r.status, corpo: corpoRisposta, testo };
}

async function loginDemo(userId) {
    const accesso = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

function vedeEscursione(risposta, hikeId) {
    return Array.isArray(risposta.corpo) && risposta.corpo.some(h => h.id === hikeId || h._id === hikeId);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        escursioni: await mongoose.connection.collection('hikes').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let logServer = '';
    let hikeId = null;

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, { PORT: String(PORTA) })
        });
        server.stdout.on('data', d => { logServer += d.toString(); });
        server.stderr.on('data', d => { logServer += d.toString(); });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* non ancora */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        // --- 1. Tre account demo: A organizza, B si iscrive e poi resta fuori dalla
        //        conferma di gruppo, C non si iscrive mai ---
        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno tre account demo disponibili', Array.isArray(elenco) && elenco.length >= 3, `trovati ${elenco.length}`);
        const idA = elenco[0].id, idB = elenco[1].id, idC = elenco[2].id;
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        const cookieC = await loginDemo(idC);
        console.log(`     (account demo: A=${elenco[0].username}, B=${elenco[1].username}, C=${elenco[2].username})`);

        // --- 2. A crea l'escursione (coordinate in Abruzzo, gia' usate da altre prove) ---
        const creazione = await chiama('POST', '/api/hikes', {
            title: `PROVA-77-${MARCA}`,
            difficulty: 'Principiante',
            date: '2026-08-01',
            tribeTags: [],
            trailhead: { lat: 42.45, lng: 13.55, name: `Prova-77-${MARCA}` }
        }, cookieA);
        ok('creazione escursione accettata', creazione.status === 200, JSON.stringify(creazione.corpo));
        hikeId = creazione.corpo && (creazione.corpo.id || creazione.corpo._id);
        ok('escursione creata con un id', !!hikeId);

        // --- 3. B si iscrive (A, creatore, la aggiunge direttamente ai partecipanti) ---
        const iscrizione = await chiama('PUT', `/api/hikes/${hikeId}`, { participants: [idA, idB] }, cookieA);
        ok('B iscritto come partecipante', iscrizione.status === 200 &&
            (iscrizione.corpo.participants || []).map(String).includes(String(idB)), JSON.stringify(iscrizione.corpo));

        // --- 4. ANCORA PROGRAMMATA: visibile a tutti, C compreso (nessuna regressione) ---
        const primaA = await chiama('GET', '/api/hikes', null, cookieA);
        const primaB = await chiama('GET', '/api/hikes', null, cookieB);
        const primaC = await chiama('GET', '/api/hikes', null, cookieC);
        ok('escursione ancora programmata visibile ad A (creatore)', vedeEscursione(primaA, hikeId));
        ok('escursione ancora programmata visibile a B (partecipante)', vedeEscursione(primaB, hikeId));
        ok('escursione ancora programmata visibile a C (estraneo)', vedeEscursione(primaC, hikeId));

        // --- 5. A conferma il completamento di gruppo, ma SOLO per se stesso: B non viene
        //        confermato presente (torna fuori dai partecipanti, hike.participants=[A]) ---
        const completamento = await chiama('POST', `/api/hikes/${hikeId}/complete-group`,
            { confirmedUserIds: [idA] }, cookieA);
        ok('completamento di gruppo accettato', completamento.status === 200, JSON.stringify(completamento.corpo));
        ok('groupCompletedAt valorizzato', !!(completamento.corpo && completamento.corpo.groupCompletedAt));

        // --- 6. CONCLUSA: resta visibile solo a chi ha partecipato per davvero (A) ---
        const dopoA = await chiama('GET', '/api/hikes', null, cookieA);
        const dopoB = await chiama('GET', '/api/hikes', null, cookieB);
        const dopoC = await chiama('GET', '/api/hikes', null, cookieC);
        ok('escursione conclusa resta visibile ad A (partecipante confermato)', vedeEscursione(dopoA, hikeId));
        ok('escursione conclusa SPARISCE per B (iscritto ma non confermato presente)', !vedeEscursione(dopoB, hikeId));
        ok('escursione conclusa SPARISCE per C (mai stato partecipante)', !vedeEscursione(dopoC, hikeId));

        // --- 7. Nessuna regressione sulla chat: B non era mai stato un vero "partecipante
        //        finale", quindi la protezione gia' esistente (isHikeParticipant, punto 55)
        //        continua a negargli i messaggi esattamente come prima di questo punto ---
        const messaggiComeB = await chiama('GET', `/api/hikes/${hikeId}/messages`, null, cookieB);
        ok('B resta escluso dalla chat dopo la conclusione (403, comportamento gia' + '\' esistente)',
            messaggiComeB.status === 403, `status ${messaggiComeB.status}`);

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // Cleanup mirato per id, mai una deleteMany generica.
        if (hikeId) await mongoose.connection.collection('hikes').deleteOne({ _id: new mongoose.Types.ObjectId(hikeId) }).catch(() => {});

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            escursioni: await mongoose.connection.collection('hikes').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna escursione di prova rimasta sul database', fine.escursioni === partenza.escursioni, `${partenza.escursioni} -> ${fine.escursioni}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
