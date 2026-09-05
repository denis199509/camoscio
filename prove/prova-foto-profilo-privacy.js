// PROVA: MEDIO, follow-up revisione sicurezza - profilePhoto e' select:false a schema
// (models/User.js), fuori da GET /api/users (lista) e da GET /api/users/:id (singolo) per
// chiunque, in QUALUNQUE privacySetting - stessa asimmetria RAM gia' chiusa su Squad.photo
// (MEDIO-3, 28ª: a 600 utenti con foto e' un rischio OOM su Render 512 MB). A differenza
// della foto squadra pero' profilePhoto e' un PRIVACY_GATED_FIELDS: la nuova
// GET /api/users/:id/photo deve applicare la STESSA regola di serializeUserForViewer
// (Pubblico/SoloAmici/Privato), non un semplice requireAuth - altrimenti riaprirebbe di
// nascosto un buco privacy gia' chiuso li'.
//
// Lanciarla:  node prove/prova-foto-profilo-privacy.js   (avvia un server suo sulla 3132)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3132;
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

const jpegMagic = Buffer.from([0xFF, 0xD8, 0xFF]);
const fintoJpeg = (bytesExtra = 200) =>
    'data:image/jpeg;base64,' + Buffer.concat([jpegMagic, Buffer.alloc(bytesExtra, 'A')]).toString('base64');

function corpoRegistrazione(suffix, extra) {
    return Object.assign({
        nome: 'Prova', cognome: `FotoPrivacy${suffix}`,
        email: `prova-foto-privacy-${MARCA}-${suffix}@esempio-di-prova.invalid`,
        password: 'PasswordDiProva1!', username: `provafotoprivacy${MARCA}${suffix}`,
        ageRange: '30-39', termsAccepted: true,
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
        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        console.log('\nSetup: 5 account di prova + una squadra fittizia (fixture diretta)');

        const foto = fintoJpeg();
        const registra = async (suffix, extra) => {
            const r = await chiama('POST', '/api/auth/register', corpoRegistrazione(suffix, extra));
            const id = r.corpo && (r.corpo.id || r.corpo._id);
            if (id) idsUtenti.push(new mongoose.Types.ObjectId(id));
            return { id, cookie: r.cookie, corpo: r.corpo };
        };

        const pub = await registra('pub', { privacySetting: 'Pubblico', profilePhoto: foto });
        const priv = await registra('priv', { privacySetting: 'Privato', profilePhoto: foto });
        const ami = await registra('ami', { privacySetting: 'SoloAmici', profilePhoto: foto });
        const amico = await registra('amico', {});
        const estraneo = await registra('estraneo', {});
        ok('le 5 registrazioni sono riuscite', [pub, priv, ami, amico, estraneo].every(u => u.id), JSON.stringify({ pub, priv, ami, amico, estraneo }));

        // Fixture diretta (bypassa l'inviter+accept flow, non serve provarlo qui): "ami" e
        // "amico" nella stessa squadra, cosi' areSquadmates() li riconosce.
        const squadFixture = await Squadre.insertOne({
            name: `PROVA-FOTO-PRIVACY-${MARCA}`,
            creatorId: new mongoose.Types.ObjectId(ami.id),
            members: [new mongoose.Types.ObjectId(ami.id), new mongoose.Types.ObjectId(amico.id)],
            admins: [new mongoose.Types.ObjectId(ami.id)]
        });
        idsSquadre.push(squadFixture.insertedId);

        console.log('\n1. GET /api/users (lista): profilePhoto MAI presente, per nessuno');

        const lista = await chiama('GET', '/api/users', undefined, estraneo.cookie);
        ok('GET /api/users -> 200', lista.status === 200);
        const trovaInLista = (id) => (lista.corpo || []).find(u => String(u.id) === String(id));
        ok('...il Pubblico in lista NON ha profilePhoto (nemmeno lui)', (() => { const u = trovaInLista(pub.id); return u && !('profilePhoto' in u); })(), JSON.stringify(trovaInLista(pub.id)));
        ok('...il Privato in lista NON ha profilePhoto', (() => { const u = trovaInLista(priv.id); return u && !('profilePhoto' in u); })());
        ok('...il SoloAmici in lista NON ha profilePhoto', (() => { const u = trovaInLista(ami.id); return u && !('profilePhoto' in u); })());

        console.log('\n2. GET /api/users/:id (singolo): stessa esclusione, anche sul proprio id');

        const singoloAltrui = await chiama('GET', `/api/users/${pub.id}`, undefined, estraneo.cookie);
        ok('GET /api/users/:id (Pubblico, da un estraneo) -> 200 senza profilePhoto', singoloAltrui.status === 200 && !('profilePhoto' in (singoloAltrui.corpo || {})), JSON.stringify(singoloAltrui.corpo));

        const singoloProprio = await chiama('GET', `/api/users/${pub.id}`, undefined, pub.cookie);
        ok('GET /api/users/:id sul PROPRIO id -> 200 senza profilePhoto (serve la rotta dedicata anche per se stessi)', singoloProprio.status === 200 && !('profilePhoto' in (singoloProprio.corpo || {})), JSON.stringify(singoloProprio.corpo));

        console.log('\n3. GET /api/users/:id/photo: la stessa regola privacy di serializeUserForViewer');

        const rPub = await chiama('GET', `/api/users/${pub.id}/photo`, undefined, estraneo.cookie);
        ok('Pubblico, letto da un estraneo -> 200 con la foto vera', rPub.status === 200 && rPub.corpo.photo === foto, JSON.stringify(rPub.corpo));

        const rPriv = await chiama('GET', `/api/users/${priv.id}/photo`, undefined, estraneo.cookie);
        ok('Privato, letto da un estraneo -> 403', rPriv.status === 403, JSON.stringify(rPriv.corpo));

        const rAmiEstraneo = await chiama('GET', `/api/users/${ami.id}/photo`, undefined, estraneo.cookie);
        ok('SoloAmici, letto da un estraneo (non compagno di squadra) -> 403', rAmiEstraneo.status === 403, JSON.stringify(rAmiEstraneo.corpo));

        const rAmiAmico = await chiama('GET', `/api/users/${ami.id}/photo`, undefined, amico.cookie);
        ok('SoloAmici, letto dal compagno di squadra vero -> 200 con la foto vera', rAmiAmico.status === 200 && rAmiAmico.corpo.photo === foto, JSON.stringify(rAmiAmico.corpo));

        const rPrivSelf = await chiama('GET', `/api/users/${priv.id}/photo`, undefined, priv.cookie);
        ok('Privato, letto da SE STESSO -> 200 con la foto vera (self-override, come serializeUserForViewer)', rPrivSelf.status === 200 && rPrivSelf.corpo.photo === foto, JSON.stringify(rPrivSelf.corpo));

        const rInesistente = await chiama('GET', `/api/users/${new mongoose.Types.ObjectId()}/photo`, undefined, estraneo.cookie);
        ok('id inesistente -> 404', rInesistente.status === 404, JSON.stringify(rInesistente.corpo));

        const rAnonimo = await fetch(BASE + `/api/users/${pub.id}/photo`);
        ok('senza sessione -> 401', rAnonimo.status === 401);

        console.log('\n4. GET /api/auth/me continua a portare la propria foto (rotta a se\', documento singolo)');

        const me = await chiama('GET', '/api/auth/me', undefined, pub.cookie);
        ok('GET /api/auth/me -> 200 con profilePhoto', me.status === 200 && me.corpo.profilePhoto === foto, JSON.stringify(me.corpo));

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
