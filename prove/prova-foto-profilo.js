// PROVA: User.profilePhoto (registrazione + PUT /api/users/:id) valida ora i byte VERI della
// foto (magic byte JPEG) e la dimensione decodificata - stesso buco gia' chiuso su
// Squad.photo (MEDIO-2/MEDIO-3 residuo, follow-up revisione sicurezza), stavolta ALTO perche'
// la superficie e' piu' esposta: PUT /api/users/:id (nessun limiter dedicato prima) e
// POST /api/auth/register (authLimiter salta le richieste RIUSCITE, skipSuccessfulRequests).
//
// Lanciarla:  node prove/prova-foto-profilo.js     (avvia un server suo sulla 3130)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3130;
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
const nonImmagine = 'data:image/jpeg;base64,' + Buffer.from('non e\' un\'immagine, solo testo').toString('base64');
const pngVero = 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200, 'A')
]).toString('base64');

function corpoRegistrazione(suffix, extra) {
    return Object.assign({
        nome: 'Prova', cognome: `FotoProfilo${suffix}`,
        email: `prova-foto-profilo-${MARCA}-${suffix}@esempio-di-prova.invalid`,
        password: 'PasswordDiProva1!', username: `provafotoprofilo${MARCA}${suffix}`,
        ageRange: '30-39', termsAccepted: true,
        emergencyContacts: [{ name: 'Contatto Di Prova', relationship: 'Prova', email: 'contatto-di-prova@esempio-di-prova.invalid' }]
    }, extra);
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Utenti = mongoose.connection.collection('users');
    const partenza = { utenti: await Utenti.countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, log = '';
    const idsDiProva = [];

    try {
        server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: Object.assign({}, process.env, { PORT: String(PORTA) }) });
        server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) { await new Promise(r => setTimeout(r, 500)); try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /**/ } }
        ok('server di prova partito', pronto);
        if (!pronto) throw new Error('server non risponde');

        console.log('\n1. POST /api/auth/register: byte veri della foto');

        const conByteFinti = await chiama('POST', '/api/auth/register', corpoRegistrazione('a', { profilePhoto: nonImmagine }));
        ok('registrazione con byte senza firma JPEG -> 400', conByteFinti.status === 400, JSON.stringify(conByteFinti.corpo));
        const nataA = await Utenti.findOne({ email: `prova-foto-profilo-${MARCA}-a@esempio-di-prova.invalid` });
        ok('...e l\'account NON e\' stato creato', !nataA);

        const conPng = await chiama('POST', '/api/auth/register', corpoRegistrazione('b', { profilePhoto: pngVero }));
        ok('registrazione con un PNG vero (non JPEG) -> 400', conPng.status === 400, JSON.stringify(conPng.corpo));

        // Un solo byte oltre MAX_PHOTO_BYTES (614400), non migliaia in piu': con un margine
        // grosso la stringa base64 supera anche MAX_PHOTO_LENGTH e scatta il pre-controllo
        // di lunghezza invece di quello sui byte decodificati - non proverebbe il ramo giusto
        // (finestra di ~57 byte fra i due tetti, giro agente BASSO-2).
        const troppoGrande = 'data:image/jpeg;base64,' + Buffer.concat([jpegMagic, Buffer.alloc(614398)]).toString('base64');
        const conTroppoGrande = await chiama('POST', '/api/auth/register', corpoRegistrazione('c', { profilePhoto: troppoGrande }));
        ok('registrazione con foto oltre il tetto (byte decodificati, non la stringa) -> 400', conTroppoGrande.status === 400, `status ${conTroppoGrande.status}`);

        const conFotoVera = await chiama('POST', '/api/auth/register', corpoRegistrazione('d', { profilePhoto: fintoJpeg() }));
        ok('registrazione con una firma JPEG vera -> 200', conFotoVera.status === 200, JSON.stringify(conFotoVera.corpo));
        const cookieD = conFotoVera.cookie;
        const idD = conFotoVera.corpo && (conFotoVera.corpo.id || conFotoVera.corpo._id);
        if (idD) idsDiProva.push(idD);
        ok('...e la foto e\' salvata sul documento', conFotoVera.corpo && conFotoVera.corpo.profilePhoto === fintoJpeg());

        const senzaFoto = await chiama('POST', '/api/auth/register', corpoRegistrazione('e', {}));
        ok('registrazione senza foto (facoltativa) -> 200 comunque', senzaFoto.status === 200, JSON.stringify(senzaFoto.corpo));
        const idE = senzaFoto.corpo && (senzaFoto.corpo.id || senzaFoto.corpo._id);
        if (idE) idsDiProva.push(idE);

        console.log('\n2. PUT /api/users/:id: stesso controllo sulla modifica profilo');

        const putByteFinti = await chiama('PUT', `/api/users/${idD}`, { profilePhoto: nonImmagine }, cookieD);
        ok('PUT con byte senza firma JPEG -> 400', putByteFinti.status === 400, JSON.stringify(putByteFinti.corpo));
        const dopoRifiuto = await Utenti.findOne({ _id: new mongoose.Types.ObjectId(idD) });
        ok('...e la foto precedente resta quella valida', dopoRifiuto.profilePhoto === fintoJpeg());

        const secondaFotoVera = fintoJpeg(300);
        const putFotoVera = await chiama('PUT', `/api/users/${idD}`, { profilePhoto: secondaFotoVera }, cookieD);
        ok('PUT con una firma JPEG vera -> 200', putFotoVera.status === 200, JSON.stringify(putFotoVera.corpo && putFotoVera.corpo.error));
        ok('...e la foto e\' aggiornata', putFotoVera.corpo && putFotoVera.corpo.profilePhoto === secondaFotoVera);

        const putRimuovi = await chiama('PUT', `/api/users/${idD}`, { profilePhoto: null }, cookieD);
        ok('PUT profilePhoto:null (rimozione) -> 200, non passa dalla validazione', putRimuovi.status === 200, JSON.stringify(putRimuovi.corpo && putRimuovi.corpo.error));

    } catch (e) {
        console.error('\nERRORE DURANTE LA PROVA:', e);
        falliti++;
    } finally {
        if (server) server.kill();
        for (const id of idsDiProva) {
            await Utenti.deleteOne({ _id: new mongoose.Types.ObjectId(id) }).catch(() => {});
        }
        const fine = { utenti: await Utenti.countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, JSON.stringify({ partenza, fine }));

        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:', fallimenti);
        await mongoose.disconnect();
        process.exit(falliti === 0 ? 0 : 1);
    }
})();
