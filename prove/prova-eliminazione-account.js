// PROVA DEL PUNTO A-3.4 (eliminazione account) - CP1: richiesta + grazia + ripristino.
//
// COSA CONTROLLA, in breve: che la RICHIESTA di eliminazione (DELETE /api/users/me)
//  - sia rifiutata sugli account demo, con la password sbagliata, e se l'utente ha
//    escursioni in programma organizzate da lui (blocco deciso con Denis);
//  - accettata, pseudonimizzi SUBITO l'account per tutti ("Account eliminato"), disarmi
//    il Dead Man's Switch, chiuda le sessioni, e riassegni gli amministratori delle
//    squadre di cui era l'unico admin (o le sciolga se non ha altri membri);
//  - il login entro i 30 giorni ANNULLI l'eliminazione (ripristino).
// Lo SCRUB definitivo (giorno 30) e' CP2, non e' provato qui.
//
// Account REALI temporanei creati dritti sul database (come prova-punto37.js): A =
// quello da eliminare, B = un osservatore. Tutto cancellato nel finally, filtrato per id.
//
// Lanciarla:  node prove/prova-eliminazione-account.js   (avvia un server suo)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PORTA = 3140;
const BASE = `http://localhost:${PORTA}`;
const SEGRETO_SCRUB = 'segreto-scrub-di-prova-A34';
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
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: corpoRisposta, testo };
}

function cookieDa(resp) {
    const raw = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [resp.headers.get('set-cookie')];
    return raw.filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

async function login(email, password) {
    const r = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return { status: r.status, cookie: cookieDa(r), corpo: await r.json().catch(() => null) };
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const Hike = require('../models/Hike');
    const Squad = require('../models/Squad');
    const SquadMessage = require('../models/SquadMessage');
    const RouteBookmark = require('../models/RouteBookmark');
    const Notification = require('../models/Notification');
    const RouteDraft = require('../models/RouteDraft');
    const SavedRoute = require('../models/SavedRoute');
    const ActiveHikeSession = require('../models/ActiveHikeSession');
    const Follow = require('../models/Follow');
    const PasswordReset = require('../models/PasswordReset');
    const { creaToken } = require('../lib/tokens');

    const partenza = {
        utenti: await mongoose.connection.collection('users').countDocuments(),
        hike: await mongoose.connection.collection('hikes').countDocuments(),
        squadre: await mongoose.connection.collection('squads').countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server, logServer = '';
    const ids = { A: null, B: null, hikeFutura: null, hikePassata: null, squadConMembri: null, squadVuota: null, sessioneA: null };

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA),
                ACCOUNT_SCRUB_SECRET: SEGRETO_SCRUB,
                MAILJET_API_KEY: '', MAILJET_SECRET_KEY: '', MAIL_SENDER_EMAIL: ''
            })
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

        // --- Setup: due account reali (A da eliminare, B osservatore) ---
        const pwdA = `pw-A-${MARCA}-Xk`;
        const pwdB = `pw-B-${MARCA}-Xk`;
        const A = await User.create({
            username: `PROVA-DEL-A-${MARCA}`, email: `prova-del-a-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwdA, 10), nome: 'Anna', cognome: 'DelA',
            termsAcceptedAt: new Date(), emailVerified: true
        });
        const B = await User.create({
            username: `PROVA-DEL-B-${MARCA}`, email: `prova-del-b-${MARCA}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwdB, 10), nome: 'Bruno', cognome: 'DelB',
            termsAcceptedAt: new Date(), emailVerified: true
        });
        ids.A = String(A._id); ids.B = String(B._id);
        let pwdCorrenteA = pwdA; // il recupero password (parte 9b) la cambia

        const accA = await login(A.email, pwdA);
        const accB = await login(B.email, pwdB);
        ok('login A e B riusciti', accA.status === 200 && accB.status === 200, `A ${accA.status} B ${accB.status}`);
        const cookieA = accA.cookie, cookieB = accB.cookie;

        // --- 1. Account demo: DELETE /api/users/me -> 403 ---
        const demo = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        if (Array.isArray(demo) && demo.length) {
            const accDemo = await fetch(BASE + '/api/auth/demo-login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: demo[0].id || demo[0]._id })
            });
            const cookieDemo = cookieDa(accDemo);
            const rDemo = await chiama('DELETE', '/api/users/me', { password: 'qualsiasi' }, cookieDemo);
            ok('un account demo non si puo\' eliminare (403)', rDemo.status === 403, `status ${rDemo.status}`);
        } else {
            ok('un account demo non si puo\' eliminare (403)', true, '(nessun demo sul db, saltato)');
        }

        // --- 2. Senza sessione -> 401 ---
        const senzaSessione = await chiama('DELETE', '/api/users/me', { password: pwdA }, null);
        ok('eliminare senza sessione viene rifiutato (401)', senzaSessione.status === 401, `status ${senzaSessione.status}`);

        // --- 3. Password sbagliata -> 401, account intatto ---
        const pwSbagliata = await chiama('DELETE', '/api/users/me', { password: 'non-e-questa' }, cookieA);
        ok('password sbagliata viene rifiutata (401)', pwSbagliata.status === 401, `status ${pwSbagliata.status}`);
        ok('dopo la password sbagliata l\'account non e\' in eliminazione',
            !(await User.findById(A._id)).pendingDeletionAt);

        // --- 4. Blocco: escursione in programma organizzata da A -> 409 con l'elenco ---
        const domani = new Date(Date.now() + 36 * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
        const ieri = new Date(Date.now() - 36 * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
        // location con coordinate valide: c'e' un indice 2dsphere su Hike.location e un
        // sottodocumento con solo { type:'Point' } lo fa rifiutare all'inserimento.
        const loc = { type: 'Point', coordinates: [12.5, 42.0] };
        const hikeF = await Hike.create({ title: `Uscita futura di prova ${MARCA}`, creatorId: A._id, date: domani, location: loc });
        const hikeP = await Hike.create({ title: `Uscita passata di prova ${MARCA}`, creatorId: A._id, date: ieri, location: loc });
        ids.hikeFutura = String(hikeF._id); ids.hikePassata = String(hikeP._id);

        const bloccato = await chiama('DELETE', '/api/users/me', { password: pwdA }, cookieA);
        ok('con un\'escursione in programma l\'eliminazione e\' bloccata (409)', bloccato.status === 409, `status ${bloccato.status}`);
        ok('la risposta elenca l\'escursione che blocca',
            !!bloccato.corpo && Array.isArray(bloccato.corpo.escursioni)
            && bloccato.corpo.escursioni.some(h => String(h.id) === ids.hikeFutura),
            JSON.stringify(bloccato.corpo));
        ok('un\'escursione PASSATA non blocca (non e\' nell\'elenco)',
            !!bloccato.corpo && !bloccato.corpo.escursioni.some(h => String(h.id) === ids.hikePassata));
        ok('dopo il blocco l\'account non e\' in eliminazione',
            !(await User.findById(A._id)).pendingDeletionAt);

        // Si "conclude" l'escursione futura (come farebbe l'organizzatore): non blocca piu'.
        await Hike.findByIdAndUpdate(hikeF._id, { groupCompletedAt: new Date() });

        // --- 5. Setup squadre + Dead Man's Switch + roba che lo SCRUB dovra' ripulire ---
        const sqM = await Squad.create({ name: `Squadra con membri ${MARCA}`, creatorId: A._id, members: [B._id] });
        const sqV = await Squad.create({ name: `Squadra vuota ${MARCA}`, creatorId: A._id, members: [] });
        ids.squadConMembri = String(sqM._id); ids.squadVuota = String(sqV._id);
        await SquadMessage.create({ squadId: sqV._id, senderId: A._id, text: 'ciao' });

        // Geometria privata + traccia con punti + follow in entrambe le direzioni: lo scrub
        // (parte 13) deve cancellare draft/saved/follow e SVUOTARE i punti della traccia.
        await RouteDraft.create({ userId: A._id, nome: 'bozza di prova', punti: [[12.5, 42.0], [12.6, 42.1]] });
        await SavedRoute.create({ userId: A._id, nome: 'percorso di prova', punti: [[12.5, 42.0], [12.6, 42.1]] });
        const sessA = await ActiveHikeSession.create({
            userId: A._id, status: 'ended', startedAt: new Date(Date.now() - 7200000),
            points: [[12.5, 42.0, 100, 0, 5], [12.6, 42.1, 120, 600, 5]], publishedAt: new Date(), caption: 'bella uscita'
        });
        ids.sessioneA = String(sessA._id);
        await Follow.create({ followerId: A._id, followingId: B._id });
        await Follow.create({ followerId: B._id, followingId: A._id });

        await User.findByIdAndUpdate(A._id, { deadManActive: true, deadManExpiresAt: new Date(Date.now() + 3600 * 1000) });

        const eliminazione = await chiama('DELETE', '/api/users/me', { password: pwdA }, cookieA);
        ok('la richiesta di eliminazione e\' accettata (200 ok)',
            eliminazione.status === 200 && eliminazione.corpo && eliminazione.corpo.ok === true, JSON.stringify(eliminazione.corpo));

        const Adopo = await User.findById(A._id);
        ok('pendingDeletionAt e\' stato scritto', !!Adopo.pendingDeletionAt);
        ok('deletionScrubAt e\' ~30 giorni dopo',
            !!Adopo.deletionScrubAt
            && Math.abs(Adopo.deletionScrubAt - Adopo.pendingDeletionAt - 30 * 24 * 3600 * 1000) < 5000);
        ok('deletedAt NON e\' ancora impostato (scrub e\' CP2)', Adopo.deletedAt === undefined);
        ok('il Dead Man\'s Switch e\' stato disarmato',
            Adopo.deadManActive === undefined && Adopo.deadManExpiresAt === undefined);

        // --- 6. Pseudonimizzazione immediata, vista da B ---
        const listaB = await chiama('GET', '/api/users', null, cookieB);
        const AinLista = (listaB.corpo || []).find(u => String(u.id) === ids.A);
        ok('nella lista utenti A compare come "Account eliminato"',
            !!AinLista && AinLista.deleted === true && AinLista.username === 'Account eliminato', JSON.stringify(AinLista));
        ok('...senza nessun dato personale (nome/email/cognome assenti)',
            !!AinLista && AinLista.nome === undefined && AinLista.email === undefined && AinLista.cognome === undefined);

        const dettA = await chiama('GET', `/api/users/${ids.A}`, null, cookieB);
        ok('anche GET /api/users/:id lo pseudonimizza',
            dettA.status === 200 && dettA.corpo && dettA.corpo.deleted === true && dettA.corpo.username === 'Account eliminato',
            JSON.stringify(dettA.corpo));

        // --- 7. Sessione di A chiusa ---
        const meVecchiaSessione = await chiama('GET', '/api/auth/me', null, cookieA);
        ok('la vecchia sessione di A e\' rifiutata (401)', meVecchiaSessione.status === 401, `status ${meVecchiaSessione.status}`);

        // --- 7b. Un account in eliminazione non e' seguibile (chiude la catena verso le
        //         sue tracce via GET /api/tracking/sessions/:id/points) ---
        const seguiEliminato = await chiama('POST', `/api/follow/${ids.A}`, null, cookieB);
        ok('seguire un account in eliminazione viene rifiutato (404)', seguiEliminato.status === 404, `status ${seguiEliminato.status}`);

        // --- 8. Squadre: admin riassegnato / squadra vuota sciolta ---
        const sqMdopo = await Squad.findById(sqM._id);
        ok('la squadra con un membro esiste ancora', !!sqMdopo);
        ok('...e il membro superstite (B) e\' diventato admin',
            !!sqMdopo && sqMdopo.admins.some(a => String(a) === ids.B), JSON.stringify(sqMdopo && sqMdopo.admins));
        ok('...il creatorId NON e\' stato cambiato (resta storico)',
            !!sqMdopo && String(sqMdopo.creatorId) === ids.A);
        const sqVdopo = await Squad.findById(sqV._id);
        ok('la squadra senza altri membri e\' stata sciolta', !sqVdopo);
        ok('...e i suoi messaggi con lei', (await SquadMessage.countDocuments({ squadId: sqV._id })) === 0);

        // --- 9. Login entro i 30 giorni = ripristino ---
        const rientro = await login(A.email, pwdA);
        ok('A puo\' ancora fare login (entro la grazia)', rientro.status === 200, `status ${rientro.status}`);
        ok('...e la risposta segnala che l\'eliminazione e\' stata annullata',
            !!rientro.corpo && rientro.corpo.eliminazioneAnnullata === true, JSON.stringify(rientro.corpo));
        ok('...senza esporre pendingDeletionAt/deletionScrubAt',
            !!rientro.corpo && rientro.corpo.pendingDeletionAt === undefined && rientro.corpo.deletionScrubAt === undefined);

        const Arientrato = await User.findById(A._id);
        ok('sul database pendingDeletionAt e deletionScrubAt sono spariti',
            Arientrato.pendingDeletionAt === undefined && Arientrato.deletionScrubAt === undefined);

        const listaBdopo = await chiama('GET', '/api/users', null, cookieB);
        const AinListaDopo = (listaBdopo.corpo || []).find(u => String(u.id) === ids.A);
        ok('A torna visibile col suo vero nome',
            !!AinListaDopo && !AinListaDopo.deleted && AinListaDopo.username === A.username, JSON.stringify(AinListaDopo));

        // Nota documentata: il ripristino NON de-riassegna gli admin di squadra.
        ok('(atteso) B resta admin della squadra anche dopo il ripristino di A',
            (await Squad.findById(sqM._id)).admins.some(a => String(a) === ids.B));

        // --- 9b. Anche il RECUPERO PASSWORD (non solo il login) annulla l'eliminazione.
        //         E' il caso di chi non ricorda la password: senza, userebbe il link,
        //         crederebbe di aver rientrato, e 30 giorni dopo perderebbe i dati. ---
        const rieliminaPerReset = await chiama('DELETE', '/api/users/me', { password: pwdCorrenteA }, rientro.cookie);
        ok('A ri-eliminato per la prova del reset (200)', rieliminaPerReset.status === 200, `status ${rieliminaPerReset.status}`);
        const tokenReset = await creaToken(PasswordReset, A._id);
        const nuovaPwA = `pw-A2-${MARCA}-Zz`;
        const reset = await chiama('POST', '/api/auth/reset-password', { token: tokenReset, password: nuovaPwA }, null);
        ok('reset-password su un account in eliminazione risponde 200', reset.status === 200, JSON.stringify(reset.corpo));
        const AdopoReset = await User.findById(A._id);
        ok('...e ANNULLA l\'eliminazione (pendingDeletionAt sparito)', AdopoReset.pendingDeletionAt === undefined);
        pwdCorrenteA = nuovaPwA;
        const loginNuovaPw = await login(A.email, pwdCorrenteA);
        ok('...e la password nuova funziona', loginNuovaPw.status === 200, `status ${loginNuovaPw.status}`);

        // ============ CP2: lo SCRUB definitivo (giorno 30) ============
        // --- 10. Ri-elimina A (niente escursioni future: hikeF e' stata conclusa) + un
        //         paio di righe SOLO-private che lo scrub deve cancellare ---
        await RouteBookmark.create({ userId: A._id, hikeId: hikeP._id });
        await Notification.create({ userId: A._id, text: 'notifica di prova' });
        const cookieA3 = (await login(A.email, pwdCorrenteA)).cookie;
        const rieliminazione = await chiama('DELETE', '/api/users/me', { password: pwdCorrenteA }, cookieA3);
        ok('A puo\' essere ri-eliminato dopo il ripristino (200)',
            rieliminazione.status === 200 && rieliminazione.corpo && rieliminazione.corpo.ok === true, JSON.stringify(rieliminazione.corpo));

        // --- 11. La rotta dello scrub: segreto obbligatorio ---
        const scrubSenzaSegreto = await chiama('POST', '/api/users/scrub-eliminati', null, null);
        ok('scrub-eliminati senza segreto viene rifiutato (403)', scrubSenzaSegreto.status === 403, `status ${scrubSenzaSegreto.status}`);
        const scrubSegretoSbagliato = await chiama('POST', '/api/users/scrub-eliminati?chiave=sbagliato', null, null);
        ok('scrub-eliminati col segreto sbagliato viene rifiutato (403)', scrubSegretoSbagliato.status === 403, `status ${scrubSegretoSbagliato.status}`);

        // --- 12. Simula il tempo che passa: retrodata deletionScrubAt, poi il ping vero ---
        await User.findByIdAndUpdate(A._id, { deletionScrubAt: new Date(Date.now() - 60000) });
        const scrub = await chiama('GET', `/api/users/scrub-eliminati?chiave=${SEGRETO_SCRUB}`, null, null);
        ok('scrub-eliminati col segreto giusto risponde 200', scrub.status === 200, JSON.stringify(scrub.corpo));
        ok('...e riporta almeno un account scrubato', scrub.corpo && scrub.corpo.scrubati >= 1, JSON.stringify(scrub.corpo));

        // --- 13. Cosa e' sparito e cosa e' rimasto ---
        const Ascrubato = await User.findById(A._id).select('+passwordHash');
        ok('deletedAt e\' stato scritto', !!Ascrubato.deletedAt);
        ok('pendingDeletionAt e deletionScrubAt sono spariti',
            Ascrubato.pendingDeletionAt === undefined && Ascrubato.deletionScrubAt === undefined);
        ok('email e passwordHash sono spariti',
            Ascrubato.email === undefined && Ascrubato.passwordHash === undefined);
        ok('nome/cognome sono SEGNAPOSTO (non undefined: il doc resta valido per i .save() altrui)',
            Ascrubato.nome === 'Utente' && Ascrubato.cognome === 'eliminato' && Ascrubato.completedHikes === 0);
        ok('username e\' diventato il token stabile "utente-eliminato-<id>"',
            Ascrubato.username === `utente-eliminato-${ids.A}`, Ascrubato.username);
        ok('le righe solo-private sono state cancellate (segnalibri, notifiche)',
            (await RouteBookmark.countDocuments({ userId: A._id })) === 0
            && (await Notification.countDocuments({ userId: A._id })) === 0);
        ok('progetti e percorsi salvati di A sono stati cancellati',
            (await RouteDraft.countDocuments({ userId: A._id })) === 0
            && (await SavedRoute.countDocuments({ userId: A._id })) === 0);
        const sessAscrub = await ActiveHikeSession.findById(ids.sessioneA);
        ok('la traccia di A resta MA senza polilinea, didascalia e pubblicazione',
            !!sessAscrub && Array.isArray(sessAscrub.points) && sessAscrub.points.length === 0
            && sessAscrub.publishedAt === undefined && (sessAscrub.caption === undefined || sessAscrub.caption === null),
            JSON.stringify({ p: sessAscrub && sessAscrub.points.length, pub: sessAscrub && sessAscrub.publishedAt }));
        ok('i follow di A (entrambe le direzioni) sono stati cancellati',
            (await Follow.countDocuments({ $or: [{ followerId: A._id }, { followingId: A._id }] })) === 0);
        ok('i CONTENUTI restano: l\'escursione creata da A e\' ancora sul database',
            !!(await Hike.findById(hikeP._id)) && String((await Hike.findById(hikeP._id)).creatorId) === ids.A);
        const dettAscrub = await chiama('GET', `/api/users/${ids.A}`, null, cookieB);
        ok('GET /api/users/:id lo mostra ancora come "Account eliminato" (ora via deletedAt)',
            dettAscrub.status === 200 && dettAscrub.corpo && dettAscrub.corpo.deleted === true, JSON.stringify(dettAscrub.corpo));

        // --- 14. Idempotenza + niente piu' login ---
        const scrubBis = await chiama('POST', `/api/users/scrub-eliminati?chiave=${SEGRETO_SCRUB}`, null, null);
        ok('un secondo giro di scrub non ri-processa A',
            scrubBis.status === 200 && (!scrubBis.corpo.scrubati || scrubBis.corpo.scrubati === 0), JSON.stringify(scrubBis.corpo));
        const deletedAtPrima = Ascrubato.deletedAt.getTime();
        ok('...e non cambia il deletedAt gia\' scritto',
            (await User.findById(A._id)).deletedAt.getTime() === deletedAtPrima);
        const loginDopoScrub = await login(A.email, pwdCorrenteA);
        ok('dopo lo scrub A non puo\' piu\' fare login (401)', loginDopoScrub.status === 401, `status ${loginDopoScrub.status}`);

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        // Pulizia: tutto NOSTRO (creato in questo run), filtrato per id.
        const oid = s => { try { return new mongoose.Types.ObjectId(s); } catch { return null; } };
        for (const key of ['A', 'B']) if (ids[key]) {
            const u = oid(ids[key]);
            await User.deleteOne({ _id: u }).catch(() => {});
            await mongoose.connection.collection('routebookmarks').deleteMany({ userId: u }).catch(() => {});
            await mongoose.connection.collection('notifications').deleteMany({ userId: u }).catch(() => {});
            await mongoose.connection.collection('routedrafts').deleteMany({ userId: u }).catch(() => {});
            await mongoose.connection.collection('savedroutes').deleteMany({ userId: u }).catch(() => {});
            await mongoose.connection.collection('activehikesessions').deleteMany({ userId: u }).catch(() => {});
            await mongoose.connection.collection('follows').deleteMany({ $or: [{ followerId: u }, { followingId: u }] }).catch(() => {});
            await mongoose.connection.collection('passwordresets').deleteMany({ userId: u }).catch(() => {});
        }
        for (const key of ['hikeFutura', 'hikePassata']) if (ids[key]) await mongoose.connection.collection('hikes').deleteOne({ _id: oid(ids[key]) }).catch(() => {});
        for (const key of ['squadConMembri', 'squadVuota']) if (ids[key]) {
            await mongoose.connection.collection('squads').deleteOne({ _id: oid(ids[key]) }).catch(() => {});
            await mongoose.connection.collection('squadmessages').deleteMany({ squadId: oid(ids[key]) }).catch(() => {});
        }

        const fine = {
            utenti: await mongoose.connection.collection('users').countDocuments(),
            hike: await mongoose.connection.collection('hikes').countDocuments(),
            squadre: await mongoose.connection.collection('squads').countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna hike di prova rimasta', fine.hike === partenza.hike, `${partenza.hike} -> ${fine.hike}`);
        ok('nessuna squadra di prova rimasta', fine.squadre === partenza.squadre, `${partenza.squadre} -> ${fine.squadre}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
