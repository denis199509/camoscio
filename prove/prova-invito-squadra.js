// PROVA "INVITA A GITA" (bug segnalato da Denis) + l'approvazione manuale che si poteva
// scavalcare.
//
// I DUE DIFETTI SORVEGLIATI QUI:
//  1) "Invita a Gita" da una squadra ricorrente sceglieva l'escursione bersaglio DA SOLA
//     (db.activeHikeId - che appartiene a Zaino/Carpooling/Mappa - o la prima del database):
//     ha davvero invitato una squadra a un'escursione GIA' COMPLETATA. Ora l'escursione la
//     sceglie l'utente fra quelle ancora aperte (mieEscursioniAperte, public/js/social.js),
//     e il server rifiuta comunque qualunque tocco a participants su un'escursione chiusa
//     (409, EDIT_LOCKED_FIELDS in routes/hikes.js).
//  2) hike.manualApproval non era MAI controllato lato server: chi non e' il creatore poteva
//     iscrivere altri (o se stesso) DIRETTAMENTE fra i partecipanti, scavalcando
//     l'approvazione dell'organizzatore. La regola viveva solo nel client.
//
// DUE SEZIONI, per due motivi diversi:
//  - Sezione A, SENZA server e SENZA database: carica public/js/social.js in un contesto
//    finto (vm) e prova le due funzioni che decidono, cioe' il difetto 1 dove vive davvero -
//    quale escursione e' un bersaglio legittimo, e su quale campo si scrive. Il server non
//    puo' provarlo: la scelta sbagliata avveniva prima della richiesta HTTP.
//    document.getElementById risponde SOLO per i tre id del riquadro di invito e null per
//    tutti gli altri: cosi' renderHikesList/renderMyHikes/renderSquadsList escono subito da
//    sole (lo fanno gia' quando il loro contenitore non c'e'), senza dover ricostruire mezza
//    pagina in un finto DOM - una prova che si rompe al primo ritocco dell'interfaccia non
//    starebbe provando l'invito.
//  - Sezione B, COL SERVER VERO (ne avvia uno suo) e richieste HTTP con cookie: il difetto 2,
//    che e' di autorizzazione e quindi si prova solo dal lato che decide davvero.
//
// ACCOUNT: quattro demo (login senza password). A organizza, B e' un partecipante che invita,
// C e' chi viene invitato/propone se stesso, D e' un secondo invitato. Nessun account vero.
// Tutto cio' che la prova crea (2 escursioni, i Completion del completamento di gruppo, le
// notifiche nate durante la prova) viene tolto nel finally, filtrato per id.
//
// Lanciarla:  node prove/prova-invito-squadra.js   (non serve un server gia' acceso, ne avvia uno suo)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const mongoose = require('mongoose');

const PORTA = 3109;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();
// Data nel FUTURO di proposito: una data passata farebbe nascere il promemoria "non hai
// ancora completato l'escursione" (ensureCompletionReminders, chiamata da GET
// /api/notifications/:userId - che questa prova usa per leggere il testo della notifica),
// cioe' un residuo generato dalla prova stessa. Viene comunque ripulito, ma meglio non crearlo.
const DATA_FUTURA = '2026-12-05';

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dettaglio}`); }
}

// =====================================================================================
// SEZIONE A - le due funzioni del client che scelgono (nessun server, nessun database)
// =====================================================================================

function elementoFinto() {
    return {
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        addEventListener() {}, removeEventListener() {},
        innerHTML: '', textContent: '', value: '', checked: false,
        style: {}, dataset: {}, children: [], hidden: false,
        querySelector() { return null; }, querySelectorAll() { return []; },
        appendChild() {}, remove() {}, focus() {}, click() {}, closest() { return null; },
        setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {}
    };
}

// Carica social.js in un contesto isolato e restituisce {contesto, chiamateFetch, toast}.
// Ogni caso si ricarica il suo, cosi' nessuno eredita lo stato del precedente (invitoSquadId
// e' una variabile di modulo): l'ordine di esecuzione non deve poter cambiare l'esito.
function caricaSocial(statoIniziale, rispostaFetch) {
    const chiamateFetch = [];
    const toast = [];
    const idRiquadro = ['invite-squad-modal', 'invite-squad-name', 'invite-squad-hike-list'];
    const elementi = {};
    idRiquadro.forEach(id => { elementi[id] = elementoFinto(); });

    const contesto = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        document: {
            getElementById: id => (idRiquadro.includes(id) ? elementi[id] : null),
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => elementoFinto(),
            addEventListener() {},
            body: elementoFinto()
        },
        fetch: async (url, opzioni) => {
            chiamateFetch.push({ url, opzioni, corpo: opzioni && opzioni.body ? JSON.parse(opzioni.body) : null });
            const r = rispostaFetch || { ok: true, status: 200, corpo: {} };
            return { ok: r.ok, status: r.status, json: async () => r.corpo };
        },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: {}, location: { href: '' },
        // definita in app.js, non in social.js: resta lo stub (nessuna dichiarazione la copre)
        refreshState: async () => { if (statoIniziale.alRefresh) statoIniziale.alRefresh(contesto.window.CamoscioState); }
    };
    contesto.window = contesto;
    contesto.window.CamoscioState = statoIniziale.stato;
    contesto.window.escapeHtml = s => String(s == null ? '' : s);
    contesto.window.showToast = (m, t) => toast.push({ testo: m, tipo: t });
    contesto.window.showAlertModal = async m => { toast.push({ testo: m, tipo: 'alert' }); };
    contesto.window.getEligibilityBadge = () => ({ eligible: true, badge: '', reason: '' });
    contesto.window.lucide = null;

    vm.createContext(contesto);
    vm.runInContext(fs.readFileSync(__dirname + '/../public/js/social.js', 'utf8'), contesto, { filename: 'social.js' });
    return { contesto, chiamateFetch, toast, elementi };
}

function statoBase(extra) {
    return Object.assign({
        currentUser: { id: 'io', username: 'Io Prova' },
        users: [
            { id: 'io', username: 'Io Prova' }, { id: 'altro', username: 'Altro Prova' },
            { id: 'amico1', username: 'Amico Uno' }, { id: 'amico2', username: 'Amico Due' }
        ],
        squads: [{ id: 'sq', name: 'Squadra Di Prova', creatorId: 'io', members: ['io', 'amico1', 'amico2'] }],
        completions: [], bookmarks: [], reviews: [], notifications: [], stamps: [],
        hikes: []
    }, extra);
}

function escursioneFinta(id, campi) {
    return Object.assign({
        id, title: 'Escursione ' + id, date: DATA_FUTURA,
        creatorId: 'altro', participants: ['altro'], pendingApproval: [],
        tribeTags: [], peaks: [], difficulty: 'Principiante'
    }, campi);
}

async function sezioneA() {
    console.log('\n--- SEZIONE A: quale escursione e\' un bersaglio legittimo, e su quale campo si scrive ---');

    // --- A1. mieEscursioniAperte: chi entra nell'elenco e chi no ---
    const hikes = [
        escursioneFinta('mia-aperta', { creatorId: 'io', participants: ['io'] }),
        escursioneFinta('mia-chiusa', { creatorId: 'io', participants: ['io'], groupCompletedAt: '2026-06-02T10:00:00Z' }),
        escursioneFinta('altrui-partecipo', { participants: ['altro', 'io'] }),
        escursioneFinta('altrui-chiusa-partecipo', { participants: ['altro', 'io'], groupCompletedAt: '2026-05-02T10:00:00Z' }),
        escursioneFinta('altrui-solo-in-attesa', { pendingApproval: ['io'] }),
        escursioneFinta('altrui-estranea', {}),
        escursioneFinta('mia-passata-non-chiusa', { creatorId: 'io', participants: ['io'], date: '2026-01-10' })
    ];
    const { contesto } = caricaSocial({ stato: statoBase({ hikes }) });
    const aperte = contesto.mieEscursioniAperte().map(h => h.id);

    ok('un\'escursione GIA\' COMPLETATA non e\' proponibile come bersaglio di un invito (il difetto segnalato)',
        !aperte.includes('mia-chiusa') && !aperte.includes('altrui-chiusa-partecipo'), `elenco: ${aperte.join(', ')}`);
    ok('un\'escursione aperta organizzata da me e\' proponibile', aperte.includes('mia-aperta'), aperte.join(', '));
    ok('un\'escursione aperta altrui a cui partecipo e\' proponibile', aperte.includes('altrui-partecipo'), aperte.join(', '));
    ok('un\'escursione dove sono solo IN ATTESA non e\' proponibile (il server la rifiuterebbe sempre)',
        !aperte.includes('altrui-solo-in-attesa'), aperte.join(', '));
    ok('un\'escursione di cui non faccio parte non e\' proponibile', !aperte.includes('altrui-estranea'), aperte.join(', '));
    ok('passato il giorno previsto un\'escursione NON e\' piu\' proponibile per un invito (Denis 02/09/2026: rivista la scelta di non guardare la data - il confronto fra stringhe di calendario e\' sicuro, non e\' la trappola del punto 58)',
        !aperte.includes('mia-passata-non-chiusa'), aperte.join(', '));
    ok('nessun\'altra escursione finisce nell\'elenco', aperte.length === 2, `${aperte.length}: ${aperte.join(', ')}`);

    // --- A2. una completata NON e' piu' raggiungibile nemmeno chiamando la conferma a mano ---
    {
        const stato = statoBase({ hikes: [escursioneFinta('chiusa', { participants: ['altro', 'io'], groupCompletedAt: '2026-05-02T10:00:00Z' })] });
        const { contesto: c, chiamateFetch } = caricaSocial({ stato });
        c.inviteSquadToHike('sq');
        await c.confermaInvitoSquadra('chiusa');
        ok('confermare l\'invito su un\'escursione chiusa non manda NESSUNA richiesta al server',
            chiamateFetch.length === 0, `richieste: ${chiamateFetch.length}`);
    }

    // --- A3. escursione altrui con approvazione manuale: si PROPONE, non si iscrive ---
    {
        const hike = escursioneFinta('h', { participants: ['altro', 'io'], manualApproval: true, pendingApproval: ['gia-in-attesa'] });
        const { contesto, chiamateFetch, toast } = caricaSocial({ stato: statoBase({ hikes: [hike] }) });
        contesto.inviteSquadToHike('sq');
        await contesto.confermaInvitoSquadra('h');

        ok('invito su escursione altrui ad approvazione manuale: una sola richiesta al server', chiamateFetch.length === 1,
            `richieste: ${chiamateFetch.length}`);
        const corpo = chiamateFetch[0] ? chiamateFetch[0].corpo : {};
        ok('...e scrive su pendingApproval, mai su participants',
            Object.keys(corpo).length === 1 && Object.keys(corpo)[0] === 'pendingApproval', JSON.stringify(corpo));
        ok('...portandosi dietro chi era gia\' in attesa, senza cancellarlo',
            (corpo.pendingApproval || []).includes('gia-in-attesa'), JSON.stringify(corpo));
        ok('...e aggiungendo i membri della squadra non ancora coinvolti',
            (corpo.pendingApproval || []).includes('amico1') && (corpo.pendingApproval || []).includes('amico2'), JSON.stringify(corpo));
        ok('...senza reinserire chi e\' gia\' partecipante',
            (corpo.pendingApproval || []).filter(id => id === 'io').length === 0, JSON.stringify(corpo));
        const msg = (toast.find(t => t.tipo === 'success') || {}).testo || '';
        ok('il messaggio finale non promette l\'iscrizione che dipende dall\'organizzatore',
            msg.includes('solo se') && !msg.includes('aggiunta a'), msg);
    }

    // --- A4. sulla MIA escursione, anche con approvazione manuale, aggiungo direttamente ---
    {
        const hike = escursioneFinta('h', { creatorId: 'io', participants: ['io'], manualApproval: true });
        const { contesto, chiamateFetch } = caricaSocial({ stato: statoBase({ hikes: [hike] }) });
        contesto.inviteSquadToHike('sq');
        await contesto.confermaInvitoSquadra('h');
        const corpo = chiamateFetch[0] ? chiamateFetch[0].corpo : {};
        ok('sulla propria escursione l\'organizzatore aggiunge direttamente ai partecipanti',
            Object.keys(corpo).length === 1 && Array.isArray(corpo.participants) &&
            corpo.participants.includes('amico1') && corpo.participants.includes('io'), JSON.stringify(corpo));
    }

    // --- A5. escursione altrui SENZA approvazione manuale: comportamento di sempre ---
    {
        const hike = escursioneFinta('h', { participants: ['altro', 'io'] });
        const { contesto, chiamateFetch } = caricaSocial({ stato: statoBase({ hikes: [hike] }) });
        contesto.inviteSquadToHike('sq');
        await contesto.confermaInvitoSquadra('h');
        const corpo = chiamateFetch[0] ? chiamateFetch[0].corpo : {};
        ok('senza approvazione manuale l\'invito aggiunge direttamente ai partecipanti (comportamento di sempre)',
            Object.keys(corpo).length === 1 && Array.isArray(corpo.participants) &&
            corpo.participants.includes('amico1') && corpo.participants.includes('amico2'), JSON.stringify(corpo));
        ok('...senza perdere per strada chi partecipava gia\'',
            (corpo.participants || []).includes('altro') && (corpo.participants || []).includes('io'), JSON.stringify(corpo));
    }

    // --- A6. l'escursione si chiude MENTRE il riquadro e' aperto: niente richiesta ---
    {
        const hike = escursioneFinta('h', { participants: ['altro', 'io'] });
        const { contesto, chiamateFetch, toast } = caricaSocial({
            stato: statoBase({ hikes: [hike] }),
            // confermaInvitoSquadra rilegge lo stato PRIMA di decidere: qui si simula che nel
            // frattempo l'organizzatore abbia chiuso l'escursione.
            alRefresh: stato => { stato.hikes[0].groupCompletedAt = '2026-08-18T10:00:00Z'; }
        });
        contesto.inviteSquadToHike('sq');
        await contesto.confermaInvitoSquadra('h');
        ok('se l\'escursione si chiude mentre il riquadro e\' aperto, l\'invito non parte',
            chiamateFetch.length === 0, `richieste: ${chiamateFetch.length}`);
        ok('...e l\'utente viene avvisato invece di restare a guardare un elenco falso',
            toast.some(t => t.tipo === 'error'), JSON.stringify(toast));
    }

    // --- A7. tutti gia' dentro: nessuna richiesta inutile ---
    {
        const hike = escursioneFinta('h', { participants: ['altro', 'io', 'amico1'], pendingApproval: ['amico2'] });
        const { contesto, chiamateFetch } = caricaSocial({ stato: statoBase({ hikes: [hike] }) });
        contesto.inviteSquadToHike('sq');
        await contesto.confermaInvitoSquadra('h');
        ok('con tutta la squadra gia\' iscritta o in attesa non parte nessuna richiesta',
            chiamateFetch.length === 0, `richieste: ${chiamateFetch.length}`);
    }
}

// =====================================================================================
// SEZIONE B - autorizzazione vera, col server acceso
// =====================================================================================

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

// Le sessioni stanno su MongoDB Atlas (connect-mongo): la risposta di demo-login torna PRIMA
// che la sessione sia leggibile, e la richiesta subito dopo si prenderebbe un 401 che non e'
// un difetto del sito. Si aspetta una condizione VERA (GET /api/auth/me), mai un tempo fisso.
async function loginDemo(userId) {
    const accesso = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    const cookie = (accesso.headers.getSetCookie ? accesso.headers.getSetCookie() : [accesso.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');

    for (let i = 0; i < 40; i++) {
        const me = await chiama('GET', '/api/auth/me', null, cookie);
        if (me.status === 200 && me.corpo && String(me.corpo._id || me.corpo.id) === String(userId)) return cookie;
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('la sessione demo non e\' mai diventata leggibile: ' + userId);
}

const ids = lista => (lista || []).map(String);

(async () => {
    try {
        await sezioneA();
    } catch (e) {
        console.error('\nERRORE NELLA SEZIONE A:', e);
        falliti++;
        fallimenti.push('la sezione A e\' andata in errore');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        escursioni: await mongoose.connection.collection('hikes').countDocuments(),
        notifiche: await mongoose.connection.collection('notifications').countDocuments(),
        completamenti: await mongoose.connection.collection('completions').countDocuments()
    };
    console.log('\nConteggi di partenza:', partenza);

    let server;
    let logServer = '';
    let h1 = null, h2 = null;          // le due escursioni create dalla prova
    let demoIds = [];                  // i quattro account usati, per la pulizia
    let notificheDiPrima = new Set();  // per togliere SOLO le notifiche nate qui
    const statoUtenti = new Map();     // per rimettere gli account demo come erano

    const CAMPI_STAT = ['completedHikes', 'experienceLevel', 'averagePaceUp', 'averagePaceDown'];

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
        console.log('\n--- SEZIONE B: chi puo\' modificare la lista partecipanti, e quando ---');
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        // --- B0. quattro account demo ---
        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno quattro account demo disponibili', Array.isArray(elenco) && elenco.length >= 4, `trovati ${elenco.length}`);
        const [A, B, C, D] = [elenco[2].id, elenco[1].id, elenco[3].id, elenco[0].id];
        demoIds = [A, B, C, D];
        const nomeDi = id => (elenco.find(u => u.id === id) || {}).username || id;
        console.log(`     (A organizza=${nomeDi(A)}, B invita=${nomeDi(B)}, C invitato=${nomeDi(C)}, D invitato=${nomeDi(D)})`);

        for (const id of demoIds) {
            const u = await mongoose.connection.collection('users').findOne({ _id: new mongoose.Types.ObjectId(id) });
            const foto = {};
            CAMPI_STAT.forEach(c => { if (u && u[c] !== undefined) foto[c] = u[c]; });
            statoUtenti.set(id, foto);
            const nots = await mongoose.connection.collection('notifications')
                .find({ userId: new mongoose.Types.ObjectId(id) }).project({ _id: 1 }).toArray();
            nots.forEach(n => notificheDiPrima.add(String(n._id)));
        }

        const cookieA = await loginDemo(A);
        const cookieB = await loginDemo(B);
        const cookieC = await loginDemo(C);

        const leggiHike = async (cookie, id) => {
            const r = await chiama('GET', '/api/hikes', null, cookie);
            return (Array.isArray(r.corpo) ? r.corpo : []).find(h => String(h._id || h.id) === String(id)) || null;
        };
        const notificheDi = async cookie => {
            const chi = await chiama('GET', '/api/auth/me', null, cookie);
            const r = await chiama('GET', `/api/notifications/${chi.corpo._id || chi.corpo.id}`, null, cookie);
            return Array.isArray(r.corpo) ? r.corpo : [];
        };

        // --- B1. A crea l'escursione AD APPROVAZIONE MANUALE e ci mette dentro B ---
        const creazione = await chiama('POST', '/api/hikes', {
            title: `PROVA-INVITO-${MARCA}`,
            difficulty: 'Principiante',
            date: DATA_FUTURA,
            manualApproval: true,
            tribeTags: [],
            trailhead: { lat: 42.45, lng: 13.55, name: `Prova-invito-${MARCA}` }
        }, cookieA);
        h1 = creazione.corpo && (creazione.corpo._id || creazione.corpo.id);
        ok('escursione ad approvazione manuale creata', creazione.status === 200 && !!h1, JSON.stringify(creazione.corpo));
        // Se questa cade, tutti i controlli sotto non provano piu' niente: senza manualApproval
        // le richieste che devono dare 403 passerebbero legittimamente.
        ok('l\'escursione ha davvero manualApproval attivo', !!(creazione.corpo && creazione.corpo.manualApproval),
            JSON.stringify(creazione.corpo && creazione.corpo.manualApproval));

        const conB = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B] }, cookieA);
        ok('l\'organizzatore puo\' aggiungere B fra i partecipanti', conB.status === 200 && ids(conB.corpo.participants).includes(String(B)),
            JSON.stringify(conB.corpo && conB.corpo.participants));

        // --- B2. un partecipante NON creatore prova a ISCRIVERE un altro direttamente ---
        const invitoDiretto = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B, C] }, cookieB);
        ok('un partecipante non puo\' iscrivere un altro scavalcando l\'approvazione dell\'organizzatore (403)',
            invitoDiretto.status === 403, `status ${invitoDiretto.status}: ${invitoDiretto.testo}`);
        let stato = await leggiHike(cookieA, h1);
        ok('...e l\'invitato non e\' finito comunque fra i partecipanti',
            stato && !ids(stato.participants).includes(String(C)), JSON.stringify(stato && stato.participants));

        // --- B3. un estraneo prova a ISCRIVERE SE STESSO direttamente ---
        const autoIscrizione = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B, C] }, cookieC);
        ok('non ci si iscrive da soli a un\'escursione ad approvazione manuale (403)',
            autoIscrizione.status === 403, `status ${autoIscrizione.status}: ${autoIscrizione.testo}`);

        // --- B4. chiedere resta permesso: nessuna regressione sull'iscrizione normale ---
        const richiesta = await chiama('PUT', `/api/hikes/${h1}`, { pendingApproval: [C] }, cookieC);
        ok('chiedere di partecipare resta permesso a chiunque (200)', richiesta.status === 200,
            `status ${richiesta.status}: ${richiesta.testo}`);
        ok('...e la richiesta finisce in attesa, non fra i partecipanti',
            ids(richiesta.corpo.pendingApproval).includes(String(C)) && !ids(richiesta.corpo.participants).includes(String(C)),
            JSON.stringify(richiesta.corpo && { p: richiesta.corpo.participants, a: richiesta.corpo.pendingApproval }));
        const notificheChiesta = await notificheDi(cookieA);
        ok('l\'organizzatore viene avvisato che quella persona HA CHIESTO di partecipare',
            notificheChiesta.some(n => n.text.includes(String(MARCA)) && n.text.includes('ha chiesto di partecipare') && n.text.includes(nomeDi(C))),
            JSON.stringify(notificheChiesta.filter(n => n.text.includes(String(MARCA))).map(n => n.text)));

        // --- B5. chi e' in attesa non si approva da solo ---
        const autoApprovazione = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B, C], pendingApproval: [] }, cookieC);
        ok('chi e\' in attesa non puo\' approvarsi da solo spostandosi fra i partecipanti (403)',
            autoApprovazione.status === 403, `status ${autoApprovazione.status}: ${autoApprovazione.testo}`);
        stato = await leggiHike(cookieA, h1);
        ok('...e resta in attesa dov\'era', stato && ids(stato.pendingApproval).includes(String(C)) &&
            !ids(stato.participants).includes(String(C)), JSON.stringify(stato && { p: stato.participants, a: stato.pendingApproval }));

        // --- B6. un partecipante PROPONE un altro (l'invito squadra vero e proprio) ---
        const proposta = await chiama('PUT', `/api/hikes/${h1}`, { pendingApproval: [C, D] }, cookieB);
        ok('un partecipante puo\' PROPORRE un altro all\'organizzatore (200)', proposta.status === 200,
            `status ${proposta.status}: ${proposta.testo}`);
        ok('...e il proposto finisce in attesa, mai direttamente fra i partecipanti',
            ids(proposta.corpo.pendingApproval).includes(String(D)) && !ids(proposta.corpo.participants).includes(String(D)),
            JSON.stringify(proposta.corpo && { p: proposta.corpo.participants, a: proposta.corpo.pendingApproval }));

        const notifiche = await notificheDi(cookieA);
        const suD = notifiche.filter(n => n.text.includes(String(MARCA)) && n.text.includes(nomeDi(D)));
        ok('l\'organizzatore riceve una notifica per la persona proposta', suD.length === 1,
            `${suD.length}: ${JSON.stringify(suD.map(n => n.text))}`);
        ok('...che NON dice "ha chiesto di partecipare" di chi non ha chiesto niente',
            suD.length === 1 && !suD[0].text.includes('ha chiesto di partecipare'), JSON.stringify(suD.map(n => n.text)));
        ok('...e dice invece chi lo ha proposto', suD.length === 1 && suD[0].text.includes(nomeDi(B)) &&
            suD[0].text.includes('propone'), JSON.stringify(suD.map(n => n.text)));

        // --- B7. invitare non vuol dire decidere: nessuna rimozione da parte di un non creatore ---
        const rifiutoAltrui = await chiama('PUT', `/api/hikes/${h1}`, { pendingApproval: [] }, cookieB);
        ok('un partecipante non puo\' rifiutare al posto dell\'organizzatore le richieste in attesa (403)',
            rifiutoAltrui.status === 403, `status ${rifiutoAltrui.status}: ${rifiutoAltrui.testo}`);
        const cacciata = await chiama('PUT', `/api/hikes/${h1}`, { participants: [B] }, cookieB);
        ok('un partecipante non puo\' cacciare un altro dall\'escursione (403)',
            cacciata.status === 403, `status ${cacciata.status}: ${cacciata.testo}`);

        // --- B8. escursione SENZA approvazione manuale: l'invito diretto continua a funzionare ---
        const creazione2 = await chiama('POST', '/api/hikes', {
            title: `PROVA-INVITO-LIBERA-${MARCA}`,
            difficulty: 'Principiante',
            date: DATA_FUTURA,
            manualApproval: false,
            tribeTags: [],
            trailhead: { lat: 42.45, lng: 13.55, name: `Prova-invito-libera-${MARCA}` }
        }, cookieA);
        h2 = creazione2.corpo && (creazione2.corpo._id || creazione2.corpo.id);
        ok('seconda escursione (iscrizione libera) creata', creazione2.status === 200 && !!h2, JSON.stringify(creazione2.corpo));
        await chiama('PUT', `/api/hikes/${h2}`, { participants: [A, B] }, cookieA);

        const invitoLibero = await chiama('PUT', `/api/hikes/${h2}`, { participants: [A, B, C] }, cookieB);
        ok('senza approvazione manuale un partecipante puo\' ancora invitare direttamente (200, comportamento di sempre)',
            invitoLibero.status === 200, `status ${invitoLibero.status}: ${invitoLibero.testo}`);
        ok('...e l\'invitato entra davvero fra i partecipanti',
            invitoLibero.status === 200 && ids(invitoLibero.corpo.participants).includes(String(C)),
            JSON.stringify(invitoLibero.corpo && invitoLibero.corpo.participants));

        const attesaSenzaApprovazione = await chiama('PUT', `/api/hikes/${h2}`, { pendingApproval: [D] }, cookieB);
        ok('senza approvazione manuale un partecipante non mette nessuno in attesa (403)',
            attesaSenzaApprovazione.status === 403, `status ${attesaSenzaApprovazione.status}: ${attesaSenzaApprovazione.testo}`);

        // --- B9. chiusura di gruppo: le richieste in attesa si azzerano ---
        const primaDellaChiusura = await leggiHike(cookieA, h1);
        ok('prima della chiusura ci sono davvero richieste in attesa da azzerare',
            primaDellaChiusura && ids(primaDellaChiusura.pendingApproval).length > 0,
            JSON.stringify(primaDellaChiusura && primaDellaChiusura.pendingApproval));

        const chiusura = await chiama('POST', `/api/hikes/${h1}/complete-group`, { confirmedUserIds: [A, B] }, cookieA);
        ok('completamento di gruppo accettato', chiusura.status === 200, `status ${chiusura.status}: ${chiusura.testo}`);
        ok('chiudendo l\'escursione le richieste in attesa spariscono',
            chiusura.status === 200 && ids(chiusura.corpo.pendingApproval).length === 0,
            JSON.stringify(chiusura.corpo && chiusura.corpo.pendingApproval));
        const dopoChiusura = await mongoose.connection.collection('hikes')
            .findOne({ _id: new mongoose.Types.ObjectId(h1) });
        ok('...anche sul database, non solo nella risposta',
            dopoChiusura && (dopoChiusura.pendingApproval || []).length === 0,
            JSON.stringify(dopoChiusura && dopoChiusura.pendingApproval));

        // --- B10. su un'escursione chiusa la lista partecipanti non si tocca piu' ---
        const modificaCreatore = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B, C] }, cookieA);
        ok('nemmeno l\'organizzatore puo\' cambiare i partecipanti di un\'escursione conclusa (409)',
            modificaCreatore.status === 409, `status ${modificaCreatore.status}: ${modificaCreatore.testo}`);
        ok('...con il messaggio che spiega perche\'',
            modificaCreatore.corpo && /gi.* completata/i.test(modificaCreatore.corpo.error || ''),
            JSON.stringify(modificaCreatore.corpo));

        const modificaAltri = await chiama('PUT', `/api/hikes/${h1}`, { participants: [A, B, C] }, cookieB);
        ok('e nemmeno un partecipante (409, l\'invito squadra finito su un\'escursione chiusa)',
            modificaAltri.status === 409, `status ${modificaAltri.status}: ${modificaAltri.testo}`);

        const dopoITentativi = await leggiHike(cookieA, h1);
        ok('la lista partecipanti dell\'escursione conclusa e\' rimasta quella confermata',
            dopoITentativi && ids(dopoITentativi.participants).length === 2 &&
            ids(dopoITentativi.participants).includes(String(A)) && ids(dopoITentativi.participants).includes(String(B)),
            JSON.stringify(dopoITentativi && dopoITentativi.participants));

        // --- B11. e nemmeno una richiesta NUOVA su un'escursione chiusa ---
        // Nessuno potrebbe piu' accettarla o rifiutarla: PUT rifiuta ogni tocco a participants
        // (sopra) e il pannello Veto dell'organizzatore e' nascosto sulle escursioni chiuse.
        // Resterebbe una notifica per una decisione che non si puo' prendere.
        // 409 e non un 403 qualunque, di proposito: deve fermarsi perche' l'escursione e'
        // CHIUSA (EDIT_LOCKED_FIELDS), non per un caso fortunato dei permessi - col codice del
        // 18/08/2026 mattina questa dava 403 solo quando l'approvazione manuale era spenta, e
        // 200 quando era accesa. Il motivo del rifiuto fa parte di cio' che si sorveglia.
        const attesaSuChiusa = await chiama('PUT', `/api/hikes/${h1}`, { pendingApproval: [D] }, cookieB);
        ok('su un\'escursione conclusa non si possono nemmeno proporre nuovi nomi (409)',
            attesaSuChiusa.status === 409, `status ${attesaSuChiusa.status}: ${attesaSuChiusa.testo}`);
        ok('...con lo stesso messaggio delle altre modifiche a escursione conclusa',
            attesaSuChiusa.corpo && /gi.* completata/i.test(attesaSuChiusa.corpo.error || ''),
            JSON.stringify(attesaSuChiusa.corpo));
        const dopoLaProposta = await mongoose.connection.collection('hikes')
            .findOne({ _id: new mongoose.Types.ObjectId(h1) });
        ok('...e la lista delle richieste in attesa resta vuota',
            dopoLaProposta && (dopoLaProposta.pendingApproval || []).length === 0,
            JSON.stringify(dopoLaProposta && dopoLaProposta.pendingApproval));

    } catch (e) {
        // L'errore si stampa QUI, prima del finally: un process.exit dentro il finally
        // ucciderebbe il .catch e la prova morirebbe senza dire niente.
        console.error('\nERRORE DELLA PROVA:', e);
        if (logServer) console.error('--- ultime righe del server di prova ---\n' + logServer.split('\n').slice(-15).join('\n'));
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // --- Pulizia, sempre filtrata per id ---
        const oid = id => new mongoose.Types.ObjectId(id);

        // 1. i Completion nati dal completamento di gruppo, e le conseguenze sugli account demo
        //    (completedHikes/experienceLevel/passo): senza questo la prova lascerebbe l'account
        //    demo peggio di come l'ha trovato a ogni lancio - stesso residuo gia' pagato in
        //    prova-punto77.js. Qui si RIMETTE la fotografia presa prima, invece di ricalcolare:
        //    e' l'unico modo di essere sicuri di restituire esattamente lo stato di partenza.
        for (const id of [h1, h2].filter(Boolean)) {
            await mongoose.connection.collection('completions').deleteMany({ hikeId: oid(id) }).catch(() => {});
        }
        for (const [id, foto] of statoUtenti) {
            const set = {}, unset = {};
            CAMPI_STAT.forEach(c => { if (foto[c] === undefined) unset[c] = ''; else set[c] = foto[c]; });
            const aggiornamento = {};
            if (Object.keys(set).length) aggiornamento.$set = set;
            if (Object.keys(unset).length) aggiornamento.$unset = unset;
            if (Object.keys(aggiornamento).length) {
                await mongoose.connection.collection('users').updateOne({ _id: oid(id) }, aggiornamento).catch(() => {});
            }
        }

        // 2. le escursioni della prova
        for (const id of [h1, h2].filter(Boolean)) {
            await mongoose.connection.collection('hikes').deleteOne({ _id: oid(id) }).catch(() => {});
        }

        // 3. le notifiche NATE durante la prova: si tolgono per differenza rispetto alla
        //    fotografia iniziale, cosi' non si puo' toccare niente di preesistente.
        for (const id of demoIds) {
            const nots = await mongoose.connection.collection('notifications')
                .find({ userId: oid(id) }).project({ _id: 1 }).toArray().catch(() => []);
            const nuove = nots.map(n => n._id).filter(x => !notificheDiPrima.has(String(x)));
            if (nuove.length) {
                await mongoose.connection.collection('notifications').deleteMany({ _id: { $in: nuove } }).catch(() => {});
            }
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            escursioni: await mongoose.connection.collection('hikes').countDocuments(),
            notifiche: await mongoose.connection.collection('notifications').countDocuments(),
            completamenti: await mongoose.connection.collection('completions').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna escursione di prova rimasta sul database', fine.escursioni === partenza.escursioni, `${partenza.escursioni} -> ${fine.escursioni}`);
        ok('nessuna notifica di prova rimasta sul database', fine.notifiche === partenza.notifiche, `${partenza.notifiche} -> ${fine.notifiche}`);
        ok('nessun completamento di prova rimasto sul database', fine.completamenti === partenza.completamenti, `${partenza.completamenti} -> ${fine.completamenti}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
