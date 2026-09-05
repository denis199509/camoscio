// PROVA: M-4, follow-up revisione sicurezza (31a) - GET /api/users (lista) caricava
// ALWAYS_PRIVATE_FIELDS (email/emergencyContacts/birthDate/homeCity/nome/cognome/...) per
// INTERO per ogni utente, per poi cancellarli in JS dentro serializeUserForViewer - non un
// rischio OOM come la foto (sono stringhe corte), ma minimizzazione mancata: i contatti di
// emergenza sono dati di TERZE PERSONE mai transitate in RAM per un buon motivo. Verifica
// anche il secondo pezzo dello stesso punto (l'N+1 di areSquadmates, una query Squad per
// ogni utente SoloAmici incontrato, ora un insieme precalcolato una volta sola): qui si
// verifica il COMPORTAMENTO (chi deve vedere cosa), non il conteggio delle query - il
// server di prova gira in un processo a se', non osservabile dal test.
//
// ATTENZIONE: il "prima" e il "dopo" NON differiscono nel JSON che il client vede - gia'
// PRIMA di questo fix serializeUserForViewer cancellava ALWAYS_PRIVATE_FIELDS in JS per ogni
// utente non-self, quindi la fuga non arrivava mai al client. Il fix riguarda SOLO cosa il
// server porta in RAM prima di scartarlo (i contatti di emergenza di terze persone che non
// hanno mai acconsentito a stare nel database) - invisibile da fuori per costruzione. Le
// sezioni 1-3 (via HTTP, server vero) restano un test di NON REGRESSIONE valido sul refactor
// (self che non perde i propri campi, SoloAmici che segue ancora l'insieme precalcolato), ma
// da sole passerebbero identiche anche sul codice di prima - verificato con una controprova
// che infatti torna verde. La sezione 0 (diretta sul driver, senza server) e' quella che
// dimostra il meccanismo vero: con la stessa proiezione usata da GET /api/users, il campo
// non arriva nemmeno nel documento Mongoose, non solo nascosto dopo.
//
// Lanciarla:  node prove/prova-lista-utenti-minimizzata.js   (avvia un server suo sulla 3133)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3133;
const BASE = `http://localhost:${PORTA}`;
const MARCA = Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, cond, dett = '') {
    if (cond) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome} ${dett}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let c = null; try { c = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    const cookieRisposta = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
        .filter(Boolean).map(x => x.split(';')[0]).join('; ');
    return { status: r.status, corpo: c, cookie: cookieRisposta };
}

const CAMPI_SEMPRE_PRIVATI = ['email', 'emergencyContacts', 'birthDate', 'homeCity', 'nome', 'cognome'];

function corpoRegistrazione(suffix, extra) {
    return Object.assign({
        nome: `ProvaNome${suffix}`, cognome: `ProvaCognome${suffix}`,
        email: `prova-lista-utenti-${MARCA}-${suffix}@esempio-di-prova.invalid`,
        password: 'PasswordDiProva1!', username: `provalistautenti${MARCA}${suffix}`,
        ageRange: '30-39', termsAccepted: true, homeCity: `ProvaCitta${suffix}`,
        emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
    }, extra);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const Squadre = mongoose.connection.collection('squads');
    const partenza = { utenti: await Utenti.countDocuments(), squadre: await Squadre.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    const idsUtenti = [];
    const idsSquadre = [];

    try {
        console.log('0. GET /api/users, invocata DIRETTAMENTE (stesso processo, nessun server spawnato): la query verso gli ALTRI usa davvero una proiezione che esclude i campi');

        // Le sezioni 1-3 (via HTTP, server vero in un processo a se') non possono dimostrare
        // la minimizzazione: il JSON che il client vede e' IDENTICO prima e dopo (gia' prima
        // serializeUserForViewer cancellava questi campi in JS). Qui invece si chiama
        // l'handler VERO della rotta nello stesso processo del test, cosi' si puo'
        // intercettare mongoose.Query.prototype.select e vedere con quale oggetto viene
        // davvero chiamato - non una proiezione reinventata dal test, quella usata dal codice.
        const mongooseDiretto = require('mongoose');
        const usersRouter = require('../routes/users');
        const layer = usersRouter.stack.find(l => l.route && l.route.path === '/users' && l.route.methods.get);
        if (!layer) throw new Error('rotta GET /users non trovata nel router (rinominata?)');
        const handlerListaUtenti = layer.route.stack[layer.route.stack.length - 1].handle;

        const chiamateSelect = [];
        const originaleSelect = mongooseDiretto.Query.prototype.select;
        mongooseDiretto.Query.prototype.select = function (arg) {
            chiamateSelect.push(arg);
            return originaleSelect.call(this, arg);
        };
        let corpoRisposta = null;
        try {
            const req = { session: { userId: String(new mongoose.Types.ObjectId()) } };
            const res = { json: (c) => { corpoRisposta = c; } };
            await handlerListaUtenti(req, res);
        } finally {
            mongooseDiretto.Query.prototype.select = originaleSelect;
        }

        // BASSO (giro agente): corpoRisposta e' la lista VERA di ogni utente reale sul
        // database (chiamata diretta, non filtrata da un finto MARCA) - in caso di
        // fallimento non va stampata per intero (nomi/bio/username veri), solo la lunghezza.
        ok('la chiamata diretta risponde (nessuna eccezione)', Array.isArray(corpoRisposta), `tipo: ${typeof corpoRisposta}, lunghezza: ${corpoRisposta && corpoRisposta.length}`);
        const proiezioneUsata = chiamateSelect.find(arg => arg && typeof arg === 'object' && CAMPI_SEMPRE_PRIVATI.every(c => arg[c] === 0));
        ok('...e chiama .select() con un oggetto che esclude OGNI campo sempre-privato',
            !!proiezioneUsata, JSON.stringify(chiamateSelect));

        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        console.log('\nSetup: 4 account di prova + una squadra fittizia (fixture diretta)');

        const registra = async (suffix, extra) => {
            const r = await chiama('POST', '/api/auth/register', corpoRegistrazione(suffix, extra));
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) idsUtenti.push(new mongoose.Types.ObjectId(id));
            return { id, cookie: r.cookie, corpo: r.corpo };
        };

        const me = await registra('me', {});
        // homeCity non e' accettato in registrazione (a differenza di bio/privacySetting) -
        // lo si scrive con un PUT separato, come farebbe davvero l'utente da Impostazioni.
        await chiama('PUT', `/api/users/${me.id}`, { homeCity: 'ProvaCittame' }, me.cookie);
        const pub = await registra('pub', { privacySetting: 'Pubblico', bio: 'Bio pubblica di prova' });
        const amico = await registra('amico', { privacySetting: 'SoloAmici', bio: 'Bio di un compagno di squadra' });
        const estraneoSA = await registra('estraneosa', { privacySetting: 'SoloAmici', bio: 'Bio di uno SoloAmici estraneo' });
        ok('le 4 registrazioni sono riuscite', [me, pub, amico, estraneoSA].every(u => u.id), JSON.stringify({ me, pub, amico, estraneoSA }));

        // Fixture diretta (bypassa l'inviter+accept flow, non serve provarlo qui): "me" e
        // "amico" nella stessa squadra, cosi' il nuovo squadmateSetFor() li riconosce.
        const squadFixture = await Squadre.insertOne({
            name: `PROVA-LISTA-UTENTI-${MARCA}`,
            creatorId: new mongoose.Types.ObjectId(me.id),
            members: [new mongoose.Types.ObjectId(me.id), new mongoose.Types.ObjectId(amico.id)],
            admins: [new mongoose.Types.ObjectId(me.id)]
        });
        idsSquadre.push(squadFixture.insertedId);

        console.log('\n1. GET /api/users: campi sempre-privati ASSENTI per gli altri, PRESENTI su se stessi');

        const lista = await chiama('GET', '/api/users', undefined, me.cookie);
        ok('GET /api/users -> 200', lista.status === 200);
        const trova = (id) => (lista.corpo || []).find(u => String(u.id) === String(id));

        const vocePub = trova(pub.id);
        ok('la scheda di un altro utente esiste in lista', !!vocePub, JSON.stringify(lista.corpo && lista.corpo.map(u => u.id)));
        for (const campo of CAMPI_SEMPRE_PRIVATI) {
            ok(`...altrui, "${campo}" ASSENTE`, !!vocePub && !(campo in vocePub), JSON.stringify(vocePub));
        }

        const vocePropria = trova(me.id);
        ok('la propria scheda esiste in lista', !!vocePropria);
        for (const campo of CAMPI_SEMPRE_PRIVATI) {
            ok(`...la PROPRIA, "${campo}" PRESENTE (currentUser non deve perderlo)`, !!vocePropria && (campo in vocePropria), JSON.stringify(vocePropria));
        }
        ok('...la propria email e\' quella vera', !!vocePropria && vocePropria.email === corpoRegistrazione('me').email, JSON.stringify(vocePropria && vocePropria.email));
        ok('...il proprio homeCity e\' quello vero', !!vocePropria && vocePropria.homeCity === 'ProvaCittame', JSON.stringify(vocePropria && vocePropria.homeCity));

        console.log('\n2. GET /api/users: PRIVACY_GATED_FIELDS seguono ancora SoloAmici/compagno di squadra (via l\'insieme precalcolato)');

        const voceAmico = trova(amico.id);
        ok('compagno di squadra vero: bio VISIBILE', !!voceAmico && voceAmico.bio === 'Bio di un compagno di squadra', JSON.stringify(voceAmico));
        for (const campo of CAMPI_SEMPRE_PRIVATI) {
            ok(`...ma resta un "altro utente": "${campo}" ASSENTE anche per lui`, !!voceAmico && !(campo in voceAmico));
        }

        const voceEstraneoSA = trova(estraneoSA.id);
        ok('SoloAmici SENZA squadra in comune: bio NASCOSTA', !!voceEstraneoSA && !('bio' in voceEstraneoSA), JSON.stringify(voceEstraneoSA));

        console.log('\n3. GET /api/users/:id (rotta a bersaglio singolo, non toccata): stesso comportamento di sempre');

        const singolo = await chiama('GET', `/api/users/${pub.id}`, undefined, me.cookie);
        ok('GET /api/users/:id -> 200 senza campi sempre-privati', singolo.status === 200 && CAMPI_SEMPRE_PRIVATI.every(c => !(c in (singolo.corpo || {}))), JSON.stringify(singolo.corpo));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of idsSquadre) await Squadre.deleteOne({ _id: id }).catch(() => {});
        for (const id of idsUtenti) await Utenti.deleteOne({ _id: id }).catch(() => {});
        const fine = { utenti: await Utenti.countDocuments(), squadre: await Squadre.countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessun dato di prova rimasto', fine.utenti === partenza.utenti && fine.squadre === partenza.squadre, JSON.stringify({ partenza, fine }));

        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:', fallimenti);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
