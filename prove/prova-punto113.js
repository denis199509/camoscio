// PROVA DEL PUNTO 113 - parte social: Segui, Feed, pagina uscita, "mi piace", "crea percorso".
//
// Copre i passi 1-9 del piano (.claude/plans/ok-adesso-ci-dovremmo-dreamy-castle.md):
//   1. Follow  - modello {followerId,followingId} + rotte /api/follow (POST/DELETE/GET/counts),
//      no auto-follow, idempotente, indici (unico composto + {followingId}).
//   4. Pubblicazione - POST /sessions/:id/publish|unpublish: solo autore, solo 'ended',
//      $set+$unset, spubblicare NON azzera i "mi piace".
//   5. Feed - GET /api/feed: solo le uscite pubblicate di chi segui, MAI i points, cursore
//      ?before=, le TUE uscite non nel TUO feed, like in batch (likeCount/likedByMe).
//   6. Pagina uscita - guardia autore-o-follower (404 non 403 se non pubblicata) su
//      GET /sessions/:id/meta e /points; /points e' l'unica rotta con la geometria,
//      ?scopo=mini semplifica; /meta porta likeCount/likedByMe.
//   7. "Mi piace" - POST/DELETE /sessions/:id/like (toggle, idempotente, contatore),
//      cascata Like.deleteMany nel DELETE della sessione, notifica all'autore SOLO al primo
//      like di quella persona (mai a se stessi, mai su unlike), relatedSessionId sulla notifica.
//   8. SavedRoute - POST /api/routing/saved-routes (guardia autore-o-follower, forma:
//      solo [lng,lat], origineUsername, totali, quotaMaxM, NIENTE sessionId), GET/DELETE,
//      tetto 429, controllo regioni; INDIPENDENZA: cancellata l'uscita sorgente, il percorso resta.
//   9. Hike routeSource.kind:'saved' - POST/PUT /api/hikes: i numeri atterrano dal SavedRoute,
//      routeSource resta solo un'etichetta (no savedRouteId, no dislivelloManuale), i numeri
//      restano se il SavedRoute viene cancellato; traccia senza quote -> 422 richiedeQuote ->
//      retry con quoteManuali -> dislivelloManuale:true.
//   + indici delle tre collezioni nuove (Follow, Like, SavedRoute) e il parziale su ActiveHikeSession.
//
// I passi 2-3 (tasto "Segui" nel profilo, liste in Tribu' & Squadre) e la parte UI del 9
// ("percorso da seguire" = linea di riferimento, nessun avviso di fuori-percorso) sono lato
// client, verificati dal vivo, non qui.
//
// CONTROPROVA (passo 10): questa stessa prova sul codice PRIMA del punto 113 (git worktree
// sul commit b6a771c^ ... in realta' sul commit che precede i passi 1-6) fa cadere le sezioni
// che dipendono dalle rotte nuove (/api/follow, /api/feed, /sessions/:id/like, ecc., tutte
// 404). Dettaglio ed esito in LEGGIMI-PROVE.txt.
//
// Lanciarla:  node prove/prova-punto113.js   (avvia un server suo sulla 3113)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const PORTA = 3113;
const BASE = `http://localhost:${PORTA}`;
const MARCA = 'PROVA-113-' + Date.now();

let passati = 0, falliti = 0;
const fallimenti = [];
function ok(nome, condizione, dettaglio = '') {
    if (condizione) { passati++; console.log(`  [ok]    ${nome}`); }
    else { falliti++; fallimenti.push(nome); console.log(`  [FALLITO] ${nome}   ${dettaglio}`); }
}

async function chiama(metodo, percorso, corpo, cookie) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const testo = await r.text();
    let corpo2 = null;
    try { corpo2 = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: corpo2, testo };
}
async function loginDemo(userId) {
    const a = await fetch(BASE + '/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return (a.headers.getSetCookie ? a.headers.getSetCookie() : [a.headers.get('set-cookie')])
        .filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

// Traccia finta plausibile sul Gran Sasso. conQuote=false mette null come terza colonna
// (una traccia .gpx importata senza elevazione): serve al ramo "quote a mano" del passo 9.
function tracciaFinta(n, conQuote) {
    const pts = [];
    let lng = 13.556, lat = 42.468, alt = 1300;
    for (let i = 0; i < n; i++) {
        pts.push([+lng.toFixed(5), +lat.toFixed(5), conQuote ? Math.round(alt) : null, i * 30, 5]);
        lng += 0.0005; lat += 0.00035; alt += (i < n * 0.65 ? 7 : -4);
    }
    return pts;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = mongoose.connection.collection('users');
    const sessions = mongoose.connection.collection('activehikesessions');
    const follows = mongoose.connection.collection('follows');
    const likes = mongoose.connection.collection('likes');
    const savedroutes = mongoose.connection.collection('savedroutes');
    const hikes = mongoose.connection.collection('hikes');
    const notifiche = mongoose.connection.collection('notifications');
    const oid = s => new mongoose.Types.ObjectId(s);

    const partenza = {
        utenti: await users.countDocuments(),
        sessioni: await sessions.countDocuments(),
        follows: await follows.countDocuments(),
        likes: await likes.countDocuments(),
        savedroutes: await savedroutes.countDocuments(),
        hikes: await hikes.countDocuments(),
        notifiche: await notifiche.countDocuments()
    };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let idA, idB, idC, oidA, oidB, oidC;
    const sessioniCreate = [];   // _id (stringa) - per la pulizia
    const savedRouteIds = [];
    const hikeIds = [];
    const followCoppie = [];      // {f, t} da ripulire

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, { PORT: String(PORTA) })
        });

        let pronto = false;
        for (let i = 0; i < 60 && !pronto; i++) {
            await new Promise(r => setTimeout(r, 500));
            try { await fetch(BASE + '/api/auth/demo-accounts'); pronto = true; } catch { /* attesa */ }
        }
        ok('il server di prova e\' partito', pronto);
        if (!pronto) throw new Error('il server di prova non risponde');

        const elenco = await (await fetch(BASE + '/api/auth/demo-accounts')).json();
        ok('almeno tre account demo', Array.isArray(elenco) && elenco.length >= 3, `${elenco.length}`);
        idA = elenco[0].id; idB = elenco[1].id; idC = elenco[2].id;
        oidA = oid(idA); oidB = oid(idB); oidC = oid(idC);
        const cookieA = await loginDemo(idA);
        const cookieB = await loginDemo(idB);
        const cookieC = await loginDemo(idC);
        console.log(`     (A=${elenco[0].username}, B=${elenco[1].username}, C=${elenco[2].username})`);

        // helper: crea una ActiveHikeSession conclusa (di default pubblicata) per un utente
        async function creaSessione(userId, { pubblicata = true, conQuote = true, n = 120, caption } = {}) {
            const pts = tracciaFinta(n, conQuote);
            const alt = pts.map(p => p[2]).filter(x => typeof x === 'number');
            const doc = {
                userId: oid(userId), hikeId: null, status: 'ended',
                startedAt: new Date(Date.now() - 4 * 3600e3), endedAt: new Date(Date.now() - 2 * 3600e3),
                lastPointAt: new Date(Date.now() - 2 * 3600e3),
                distanceKm: 8.4, elevationGainM: conQuote ? 540 : 0, points: pts,
                importedFrom: 'gpx', importedName: MARCA + '-' + Math.random().toString(36).slice(2, 7)
            };
            if (pubblicata) { doc.publishedAt = new Date(); if (caption) doc.caption = caption; }
            const r = await sessions.insertOne(doc);
            sessioniCreate.push(r.insertedId.toString());
            return { id: r.insertedId.toString(), maxAlt: alt.length ? Math.max(...alt) : undefined };
        }
        async function segui(follower, cookieFollower, target) {
            const r = await chiama('POST', '/api/follow/' + target, null, cookieFollower);
            followCoppie.push({ f: follower, t: target });
            return r;
        }

        // ============================================================
        console.log('\n1. Follow: /api/follow POST/DELETE/GET/counts, no auto-follow, idempotente');
        // stato pulito per la coppia A->B
        await follows.deleteOne({ followerId: oidA, followingId: oidB });

        const noSelf = await chiama('POST', '/api/follow/' + idA, null, cookieA);
        ok('POST /api/follow su se stessi -> 400', noSelf.status === 400, `status ${noSelf.status}`);

        const fake = await chiama('POST', '/api/follow/' + new mongoose.Types.ObjectId(), null, cookieA);
        ok('POST /api/follow su un id inesistente -> 404', fake.status === 404, `status ${fake.status}`);

        const seg1 = await segui(idA, cookieA, idB);
        ok('A segue B -> 200 success', seg1.status === 200 && seg1.corpo && seg1.corpo.success === true, JSON.stringify(seg1.corpo));
        ok('esiste UN documento Follow A->B', await follows.countDocuments({ followerId: oidA, followingId: oidB }) === 1);

        const seg2 = await chiama('POST', '/api/follow/' + idB, null, cookieA);
        ok('A segue B di nuovo -> 200 (idempotente)', seg2.status === 200, `status ${seg2.status}`);
        ok('sempre UN solo documento Follow A->B (no doppioni)', await follows.countDocuments({ followerId: oidA, followingId: oidB }) === 1);

        const following = await chiama('GET', '/api/follow/following', null, cookieA);
        ok('GET /api/follow/following elenca B', Array.isArray(following.corpo) && following.corpo.some(f => String(f.followingId) === idB));
        const followers = await chiama('GET', '/api/follow/followers', null, cookieB);
        ok('GET /api/follow/followers (di B) elenca A', Array.isArray(followers.corpo) && followers.corpo.some(f => String(f.followerId) === idA));

        const counts = await chiama('GET', '/api/follow/counts/' + idB, null, cookieC);
        ok('GET /api/follow/counts/:idB -> { followers>=1, following>=0 }',
            counts.status === 200 && counts.corpo && counts.corpo.followers >= 1 && typeof counts.corpo.following === 'number', JSON.stringify(counts.corpo));

        const unfollow = await chiama('DELETE', '/api/follow/' + idB, null, cookieA);
        ok('DELETE /api/follow/:idB -> 200', unfollow.status === 200, `status ${unfollow.status}`);
        ok('nessun documento Follow A->B dopo il DELETE', await follows.countDocuments({ followerId: oidA, followingId: oidB }) === 0);
        const unfollowDiNuovo = await chiama('DELETE', '/api/follow/' + idB, null, cookieA);
        ok('DELETE ripetuto -> 200 (idempotente)', unfollowDiNuovo.status === 200);

        // ============================================================
        console.log('\n2. Pubblicare / togliere un\'uscita dal feed (POST /sessions/:id/publish|unpublish)');
        const sNonPub = await creaSessione(idA, { pubblicata: false });
        const pubAltrui = await chiama('POST', `/api/tracking/sessions/${sNonPub.id}/publish`, {}, cookieB);
        ok('B pubblica un\'uscita di A -> 403', pubAltrui.status === 403, `status ${pubAltrui.status}`);

        const pubOk = await chiama('POST', `/api/tracking/sessions/${sNonPub.id}/publish`, { caption: '  ' + MARCA + ' caption  ' }, cookieA);
        ok('A pubblica la propria uscita -> 200', pubOk.status === 200, JSON.stringify(pubOk.corpo));
        const dPub = await sessions.findOne({ _id: oid(sNonPub.id) });
        ok('publishedAt e\' una Date', dPub.publishedAt instanceof Date);
        ok('caption salvata e "trimmata"', dPub.caption === MARCA + ' caption', JSON.stringify(dPub.caption));

        const unpub = await chiama('POST', `/api/tracking/sessions/${sNonPub.id}/unpublish`, null, cookieA);
        ok('A spubblica -> 200', unpub.status === 200);
        const dUnpub = await sessions.findOne({ _id: oid(sNonPub.id) });
        ok('publishedAt ASSENTE dopo unpublish (non null)', !('publishedAt' in dUnpub));
        ok('caption ASSENTE dopo unpublish', !('caption' in dUnpub));

        // ripubblico senza didascalia: la vecchia caption non deve restare
        await chiama('POST', `/api/tracking/sessions/${sNonPub.id}/publish`, { caption: 'x' }, cookieA);
        const rep2 = await chiama('POST', `/api/tracking/sessions/${sNonPub.id}/publish`, {}, cookieA);
        ok('ri-pubblicare senza caption -> 200', rep2.status === 200);
        ok('caption ASSENTE dopo ri-pubblicazione senza testo', !('caption' in (await sessions.findOne({ _id: oid(sNonPub.id) }))));

        // ============================================================
        console.log('\n3. Feed: GET /api/feed - solo chi segui, MAI i points, le tue uscite fuori, cursore');
        await segui(idA, cookieA, idB);
        const sB1 = await creaSessione(idB, { caption: MARCA + ' uno' });
        await new Promise(r => setTimeout(r, 15));
        const sB2 = await creaSessione(idB, { caption: MARCA + ' due' });
        const sA1 = await creaSessione(idA); // di A stesso: NON deve comparire nel feed di A

        const feedA = await chiama('GET', '/api/feed', null, cookieA);
        ok('GET /api/feed -> 200 con items[]', feedA.status === 200 && Array.isArray(feedA.corpo.items), JSON.stringify(feedA.corpo && Object.keys(feedA.corpo)));
        const idsFeedA = feedA.corpo.items.map(i => i.id);
        ok('nel feed di A ci sono le due uscite di B', idsFeedA.includes(sB1.id) && idsFeedA.includes(sB2.id), JSON.stringify(idsFeedA));
        ok('NON c\'e\' l\'uscita di A stesso', !idsFeedA.includes(sA1.id));
        ok('gli item del feed NON contengono "points"', feedA.corpo.items.every(i => i.points === undefined));
        ok('gli item del feed NON contengono "offTrailBuffer"', feedA.corpo.items.every(i => i.offTrailBuffer === undefined));
        ok('ordine per publishedAt decrescente (la piu\' recente prima)', idsFeedA.indexOf(sB2.id) < idsFeedA.indexOf(sB1.id));
        // Solo gli item creati QUI (sB1/sB2): il feed puo' contenere anche uscite vere di
        // utenti che l'account demo segue davvero (es. un'uscita pubblicata da Denis con un
        // "mi piace" reale) - "ogni item ha likeCount 0" era fragile contro il DB condiviso.
        const mieiItem = feedA.corpo.items.filter(i => i.id === sB1.id || i.id === sB2.id);
        ok('gli item di prova portano likeCount (0) e likedByMe (false)',
            mieiItem.length === 2 && mieiItem.every(i => i.likeCount === 0 && i.likedByMe === false),
            JSON.stringify(mieiItem.map(i => ({ id: i.id, lc: i.likeCount, lbm: i.likedByMe }))));

        const feedC = await chiama('GET', '/api/feed', null, cookieC);
        ok('C non segue nessuno -> feed vuoto', feedC.status === 200 && feedC.corpo.items.length === 0, JSON.stringify(feedC.corpo));

        // cursore: ?before = publishedAt della prima -> torna solo la piu' vecchia
        const primaPub = feedA.corpo.items[0].publishedAt;
        const feedPag = await chiama('GET', '/api/feed?before=' + encodeURIComponent(primaPub), null, cookieA);
        ok('?before=<piu recente> esclude quella e torna la piu\' vecchia',
            feedPag.status === 200 && feedPag.corpo.items.map(i => i.id).includes(sB1.id) && !feedPag.corpo.items.map(i => i.id).includes(sB2.id),
            JSON.stringify(feedPag.corpo.items.map(i => i.id)));

        // ============================================================
        console.log('\n4. Pagina uscita: guardia autore-o-follower su /meta e /points (404 non 403 se non pubblicata)');
        const sB3pub = await creaSessione(idB, { caption: MARCA + ' tre' });
        const sB4nonPub = await creaSessione(idB, { pubblicata: false });

        const metaAutore = await chiama('GET', `/api/tracking/sessions/${sB3pub.id}/meta`, null, cookieB);
        ok('autore -> /meta 200', metaAutore.status === 200, `status ${metaAutore.status}`);
        ok('/meta NON contiene points', metaAutore.corpo && metaAutore.corpo.points === undefined);
        ok('/meta porta likeCount e likedByMe', metaAutore.corpo && metaAutore.corpo.likeCount === 0 && metaAutore.corpo.likedByMe === false, JSON.stringify(metaAutore.corpo && { lc: metaAutore.corpo.likeCount, lbm: metaAutore.corpo.likedByMe }));

        const metaFollower = await chiama('GET', `/api/tracking/sessions/${sB3pub.id}/meta`, null, cookieA);
        ok('follower (A segue B) -> /meta 200', metaFollower.status === 200, `status ${metaFollower.status}`);

        const metaEstraneo = await chiama('GET', `/api/tracking/sessions/${sB3pub.id}/meta`, null, cookieC);
        ok('estraneo (C non segue B) su un\'uscita PUBBLICATA -> 403', metaEstraneo.status === 403, `status ${metaEstraneo.status}`);

        const metaNonPub = await chiama('GET', `/api/tracking/sessions/${sB4nonPub.id}/meta`, null, cookieC);
        ok('non-autore su un\'uscita NON pubblicata -> 404 (non 403: non si rivela che esiste)', metaNonPub.status === 404, `status ${metaNonPub.status}`);
        const pointsNonPub = await chiama('GET', `/api/tracking/sessions/${sB4nonPub.id}/points`, null, cookieA);
        ok('/points su un\'uscita non pubblicata, da non-autore -> 404', pointsNonPub.status === 404, `status ${pointsNonPub.status}`);

        const pointsFollower = await chiama('GET', `/api/tracking/sessions/${sB3pub.id}/points`, null, cookieA);
        ok('follower -> /points 200 con "punti"', pointsFollower.status === 200 && Array.isArray(pointsFollower.corpo.punti) && pointsFollower.corpo.punti.length > 2, JSON.stringify(pointsFollower.corpo && Object.keys(pointsFollower.corpo)));
        const pointsMini = await chiama('GET', `/api/tracking/sessions/${sB3pub.id}/points?scopo=mini`, null, cookieA);
        ok('?scopo=mini semplifica (meno punti della risposta piena)', pointsMini.corpo.punti.length <= pointsFollower.corpo.punti.length, `${pointsMini.corpo.punti.length} <= ${pointsFollower.corpo.punti.length}`);
        const dArchivio = await sessions.findOne({ _id: oid(sB3pub.id) });
        ok('il dato d\'archivio NON e\' stato toccato da ?scopo=mini', dArchivio.points.length === pointsFollower.corpo.punti.length);

        // ============================================================
        console.log('\n5. "Mi piace": toggle + contatore + idempotenza + cascata + notifica all\'autore');
        const nNotifPrima = await notifiche.countDocuments({ userId: oidB, relatedSessionId: oid(sB3pub.id) });

        const like1 = await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/like`, null, cookieA);
        ok('A mette like -> 200 { likeCount:1, likedByMe:true }',
            like1.status === 200 && like1.corpo.likeCount === 1 && like1.corpo.likedByMe === true, JSON.stringify(like1.corpo));
        const like2 = await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/like`, null, cookieA);
        ok('A rimette like -> contatore resta 1 (idempotente)', like2.corpo.likeCount === 1, JSON.stringify(like2.corpo));
        ok('un solo documento Like per (A, sessione)', await likes.countDocuments({ userId: oidA, sessionId: oid(sB3pub.id) }) === 1);

        const nNotifDopo = await notifiche.countDocuments({ userId: oidB, relatedSessionId: oid(sB3pub.id) });
        ok('B (autore) ha ESATTAMENTE 1 notifica nuova per il like', nNotifDopo - nNotifPrima === 1, `${nNotifPrima} -> ${nNotifDopo}`);
        const notif = await notifiche.find({ userId: oidB, relatedSessionId: oid(sB3pub.id) }).sort({ createdAt: -1 }).limit(1).next();
        ok('il testo della notifica parla di "mi piace"', /mi piace/i.test(notif && notif.text || ''), notif && notif.text);
        ok('la notifica porta relatedSessionId (click-through alla pagina uscita)', notif && String(notif.relatedSessionId) === sB3pub.id);

        // like a se stessi: nessuna notifica
        const nSelfPrima = await notifiche.countDocuments({ userId: oidB, relatedSessionId: oid(sB3pub.id) });
        const likeSelf = await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/like`, null, cookieB);
        ok('B mette like alla PROPRIA uscita -> 200', likeSelf.status === 200 && likeSelf.corpo.likeCount === 2, JSON.stringify(likeSelf.corpo));
        ok('nessuna notifica per il like a se stessi', await notifiche.countDocuments({ userId: oidB, relatedSessionId: oid(sB3pub.id) }) === nSelfPrima);

        // unlike: nessuna notifica, contatore -1
        const unlike = await chiama('DELETE', `/api/tracking/sessions/${sB3pub.id}/like`, null, cookieA);
        ok('A toglie il like -> 200 { likeCount:1, likedByMe:false }',
            unlike.status === 200 && unlike.corpo.likeCount === 1 && unlike.corpo.likedByMe === false, JSON.stringify(unlike.corpo));
        ok('la notifica gia\' inviata NON viene cancellata da unlike', await notifiche.countDocuments({ userId: oidB, relatedSessionId: oid(sB3pub.id) }) === nSelfPrima);

        // estraneo non puo' mettere like (guardia)
        const likeEstraneo = await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/like`, null, cookieC);
        ok('C (non segue B) non puo\' mettere like -> 403/404', likeEstraneo.status === 403 || likeEstraneo.status === 404, `status ${likeEstraneo.status}`);

        // spubblicare NON azzera i like
        await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/unpublish`, null, cookieB);
        ok('dopo unpublish il Like di B (self) e\' ancora li\'', await likes.countDocuments({ sessionId: oid(sB3pub.id) }) === 1);
        await chiama('POST', `/api/tracking/sessions/${sB3pub.id}/publish`, {}, cookieB); // ripubblico per le sezioni dopo

        // cascata: cancellare la sessione toglie i suoi Like
        const sCascata = await creaSessione(idB);
        await segui(idA, cookieA, idB); // gia' segue, idempotente
        await chiama('POST', `/api/tracking/sessions/${sCascata.id}/like`, null, cookieA);
        ok('c\'e\' 1 Like sulla sessione da cancellare', await likes.countDocuments({ sessionId: oid(sCascata.id) }) === 1);
        const delCascata = await chiama('DELETE', `/api/tracking/sessions/${sCascata.id}`, null, cookieB);
        ok('B cancella la sessione -> 200', delCascata.status === 200, `status ${delCascata.status}`);
        ok('cascata: 0 Like dopo la cancellazione della sessione', await likes.countDocuments({ sessionId: oid(sCascata.id) }) === 0);

        // ============================================================
        console.log('\n6. SavedRoute: POST /api/routing/saved-routes (guardia + forma), GET/DELETE, tetto, indipendenza');
        const sConQuote = await creaSessione(idB, { conQuote: true, n: 150 });
        await segui(idA, cookieA, idB);

        const srNome = await chiama('POST', '/api/routing/saved-routes', { sessionId: sConQuote.id }, cookieA);
        ok('POST senza nome -> 400', srNome.status === 400, `status ${srNome.status}`);
        const srEstraneo = await chiama('POST', '/api/routing/saved-routes', { sessionId: sConQuote.id, nome: MARCA + ' ko' }, cookieC);
        ok('C (non segue B) crea un percorso da una traccia di B -> 403/404', srEstraneo.status === 403 || srEstraneo.status === 404, `status ${srEstraneo.status}`);

        const srOk = await chiama('POST', '/api/routing/saved-routes', { sessionId: sConQuote.id, nome: MARCA + ' percorso' }, cookieA);
        ok('A (follower) crea il percorso -> 200', srOk.status === 200, JSON.stringify(srOk.corpo));
        const SR = srOk.corpo;
        if (SR && SR.id) savedRouteIds.push(SR.id);
        ok('punti presenti e ognuno e\' [lng,lat] (2 numeri: quota/tempo scartati)',
            Array.isArray(SR.punti) && SR.punti.length >= 2 && SR.punti.every(p => Array.isArray(p) && p.length === 2), JSON.stringify(SR.punti && SR.punti[0]));
        ok('punti <= tetto MAX_PUNTI_PERCORSO (400)', SR.punti.length <= 400, `${SR.punti.length}`);
        ok('origineUserId = autore della traccia (B)', String(SR.origineUserId) === idB, SR.origineUserId);
        ok('origineUsername valorizzato', typeof SR.origineUsername === 'string' && SR.origineUsername.length > 0, SR.origineUsername);
        ok('distanzaKm e dislivelloM copiati (numeri)', typeof SR.distanzaKm === 'number' && typeof SR.dislivelloM === 'number', JSON.stringify({ d: SR.distanzaKm, disl: SR.dislivelloM }));
        ok('quotaMaxM calcolata dai punti (traccia con quote)', typeof SR.quotaMaxM === 'number' && SR.quotaMaxM > 1200, SR.quotaMaxM);
        ok('NESSUN sessionId salvato sul SavedRoute (indipendenza)', SR.sessionId === undefined, JSON.stringify(Object.keys(SR)));

        const srList = await chiama('GET', '/api/routing/saved-routes', null, cookieA);
        ok('GET /api/routing/saved-routes lo elenca', Array.isArray(srList.corpo) && srList.corpo.some(x => x.id === SR.id));
        const srListC = await chiama('GET', '/api/routing/saved-routes', null, cookieC);
        ok('C non vede il percorso di A (sola lettura dei propri)', Array.isArray(srListC.corpo) && !srListC.corpo.some(x => x.id === SR.id));

        // INDIPENDENZA: cancello la sessione sorgente, il percorso resta e si legge ancora
        const delSorgente = await chiama('DELETE', `/api/tracking/sessions/${sConQuote.id}`, null, cookieB);
        ok('B cancella l\'uscita sorgente -> 200', delSorgente.status === 200);
        const srDopo = await chiama('GET', '/api/routing/saved-routes', null, cookieA);
        ok('il SavedRoute RESTA dopo la cancellazione dell\'uscita sorgente', srDopo.corpo.some(x => x.id === SR.id));

        // tetto MAX_PERCORSI_SALVATI = 50: riempio a 50 via DB, il 51esimo via HTTP -> 429
        const sPerTetto = await creaSessione(idB);
        await segui(idA, cookieA, idB);
        const filler = [];
        const daA = await savedroutes.countDocuments({ userId: oidA });
        for (let i = daA; i < 50; i++) {
            filler.push({ userId: oidA, nome: MARCA + ' filler ' + i, punti: [[13.5, 42.4], [13.51, 42.41]], creatoIl: new Date() });
        }
        if (filler.length) await savedroutes.insertMany(filler);
        const tetto = await chiama('POST', '/api/routing/saved-routes', { sessionId: sPerTetto.id, nome: MARCA + ' il 51esimo' }, cookieA);
        ok('51esimo percorso salvato -> 429 (tetto MAX_PERCORSI_SALVATI)', tetto.status === 429, `status ${tetto.status}`);

        // C prova a cancellare il percorso di A (SR, ancora vivo) -> 404 (stessa risposta di "non esiste")
        const srDelC = await chiama('DELETE', '/api/routing/saved-routes/' + SR.id, null, cookieC);
        ok('C non puo\' cancellare un percorso di A -> 404', srDelC.status === 404, `status ${srDelC.status}`);
        ok('...e il percorso di A e\' ancora li\'', (await savedroutes.countDocuments({ _id: oid(SR.id) })) === 1);

        const srDel = await chiama('DELETE', '/api/routing/saved-routes/' + SR.id, null, cookieA);
        ok('DELETE /api/routing/saved-routes/:id (proprio) -> 200', srDel.status === 200);
        ok('DELETE ripetuto sullo stesso id -> 404', (await chiama('DELETE', '/api/routing/saved-routes/' + SR.id, null, cookieA)).status === 404);

        // tolgo i filler: la sezione 7 crea altri SavedRoute per A e altrimenti sbatterebbe sul tetto.
        await savedroutes.deleteMany({ userId: oidA, nome: new RegExp('^' + MARCA + ' filler ') });

        // ============================================================
        console.log('\n7. Hike routeSource.kind:\'saved\': i numeri atterrano, restano, e il ripiego quote-a-mano');
        const sHike = await creaSessione(idB, { conQuote: true, n: 140 });
        await segui(idA, cookieA, idB);
        const srPerHike = await chiama('POST', '/api/routing/saved-routes', { sessionId: sHike.id, nome: MARCA + ' per hike' }, cookieA);
        const SRH = srPerHike.corpo;
        if (SRH && SRH.id) savedRouteIds.push(SRH.id);

        const trailhead = { lat: 42.468, lng: 13.556, name: MARCA + ' ritrovo' };
        const creaHike = await chiama('POST', '/api/hikes', {
            title: MARCA + ' escursione', description: 'x', difficulty: 'Intermedio', date: '2027-05-10',
            routeSource: { kind: 'saved', savedRouteId: SRH.id }, trailhead, tribeTags: [], manualApproval: false, creatorId: idA
        }, cookieA);
        ok('POST /api/hikes kind:saved -> ok', creaHike.status === 200 || creaHike.status === 201, `status ${creaHike.status} ${JSON.stringify(creaHike.corpo)}`);
        const HK = creaHike.corpo;
        if (HK && HK.id) hikeIds.push(HK.id);
        ok('Hike.maxAltitude = SavedRoute.quotaMaxM', HK.maxAltitude === Math.round(SRH.quotaMaxM), `${HK.maxAltitude} vs ${SRH.quotaMaxM}`);
        ok('Hike.elevationGain = SavedRoute.dislivelloM', HK.elevationGain === Math.round(SRH.dislivelloM), `${HK.elevationGain} vs ${SRH.dislivelloM}`);
        ok('Hike.distanceKm valorizzata', typeof HK.distanceKm === 'number' && HK.distanceKm > 0, HK.distanceKm);
        ok('Hike.routeSource = { kind:"saved", nome } - solo etichetta', HK.routeSource && HK.routeSource.kind === 'saved' && HK.routeSource.nome === (MARCA + ' per hike'), JSON.stringify(HK.routeSource));
        ok('Hike.routeSource NON porta savedRouteId ne\' dislivelloManuale', HK.routeSource && HK.routeSource.savedRouteId === undefined && !HK.routeSource.dislivelloManuale);

        // indipendenza: cancello il SavedRoute, i numeri sulla Hike restano
        await chiama('DELETE', '/api/routing/saved-routes/' + SRH.id, null, cookieA);
        const hkDopo = await hikes.findOne({ _id: oid(HK.id) });
        ok('i numeri + l\'etichetta della Hike restano dopo la cancellazione del SavedRoute',
            hkDopo && hkDopo.maxAltitude === Math.round(SRH.quotaMaxM) && hkDopo.routeSource && hkDopo.routeSource.nome === (MARCA + ' per hike'));

        const badId = await chiama('POST', '/api/hikes', {
            title: MARCA + ' ko2', description: 'x', difficulty: 'Intermedio', date: '2027-05-11',
            routeSource: { kind: 'saved', savedRouteId: new mongoose.Types.ObjectId().toString() }, trailhead, tribeTags: [], manualApproval: false, creatorId: idA
        }, cookieA);
        ok('kind:saved con savedRouteId inesistente -> 400', badId.status === 400, `status ${badId.status}`);

        // traccia senza quote -> 422 richiedeQuote -> retry con quoteManuali
        const sNoQuote = await creaSessione(idB, { conQuote: false, n: 90 });
        await segui(idA, cookieA, idB);
        const srNoQuote = await chiama('POST', '/api/routing/saved-routes', { sessionId: sNoQuote.id, nome: MARCA + ' senza quote' }, cookieA);
        const SRNQ = srNoQuote.corpo;
        if (SRNQ && SRNQ.id) savedRouteIds.push(SRNQ.id);
        ok('SavedRoute da una traccia senza quote NON ha quotaMaxM', SRNQ.quotaMaxM === undefined, SRNQ.quotaMaxM);

        const hk422 = await chiama('POST', '/api/hikes', {
            title: MARCA + ' nq', description: 'x', difficulty: 'Principiante', date: '2027-05-12',
            routeSource: { kind: 'saved', savedRouteId: SRNQ.id }, trailhead, tribeTags: [], manualApproval: false, creatorId: idA
        }, cookieA);
        ok('kind:saved da una traccia senza quote -> 422 richiedeQuote', hk422.status === 422 && hk422.corpo && hk422.corpo.richiedeQuote === true, JSON.stringify(hk422.corpo));

        const hkRetry = await chiama('POST', '/api/hikes', {
            title: MARCA + ' nq2', description: 'x', difficulty: 'Principiante', date: '2027-05-12',
            routeSource: { kind: 'saved', savedRouteId: SRNQ.id, quoteManuali: { maxAltitude: 900, elevationGain: 250 } },
            trailhead, tribeTags: [], manualApproval: false, creatorId: idA
        }, cookieA);
        ok('retry con quoteManuali -> ok, numeri scritti a mano', (hkRetry.status === 200 || hkRetry.status === 201) && hkRetry.corpo.maxAltitude === 900 && hkRetry.corpo.elevationGain === 250, JSON.stringify(hkRetry.corpo && { alt: hkRetry.corpo.maxAltitude }));
        ok('Hike.routeSource.dislivelloManuale = true', hkRetry.corpo.routeSource && hkRetry.corpo.routeSource.dislivelloManuale === true, JSON.stringify(hkRetry.corpo && hkRetry.corpo.routeSource));
        if (hkRetry.corpo && hkRetry.corpo.id) hikeIds.push(hkRetry.corpo.id);

        // PUT: agganciare un percorso salvato a un'escursione esistente
        const sPut = await creaSessione(idB, { conQuote: true, n: 100 });
        await segui(idA, cookieA, idB);
        const srPut = await chiama('POST', '/api/routing/saved-routes', { sessionId: sPut.id, nome: MARCA + ' per put' }, cookieA);
        if (srPut.corpo && srPut.corpo.id) savedRouteIds.push(srPut.corpo.id);
        const hkManuale = await chiama('POST', '/api/hikes', {
            title: MARCA + ' manuale', description: 'x', difficulty: 'Intermedio', date: '2027-06-01',
            maxAltitude: 1000, elevationGain: 300, distanceKm: 5, routeSource: null, trailhead, tribeTags: [], manualApproval: false, creatorId: idA
        }, cookieA);
        if (hkManuale.corpo && hkManuale.corpo.id) hikeIds.push(hkManuale.corpo.id);
        const putRes = await chiama('PUT', '/api/hikes/' + hkManuale.corpo.id, { routeSource: { kind: 'saved', savedRouteId: srPut.corpo.id } }, cookieA);
        ok('PUT /api/hikes kind:saved -> 200', putRes.status === 200, `status ${putRes.status}`);
        const hkPut = await hikes.findOne({ _id: oid(hkManuale.corpo.id) });
        ok('PUT: routeSource.kind="saved" e maxAltitude aggiornato dal percorso',
            hkPut && hkPut.routeSource && hkPut.routeSource.kind === 'saved' && hkPut.maxAltitude === Math.round(srPut.corpo.quotaMaxM),
            JSON.stringify(hkPut && { k: hkPut.routeSource && hkPut.routeSource.kind, alt: hkPut.maxAltitude }));

        // ============================================================
        console.log('\n8. Indici delle collezioni nuove + il parziale su activehikesessions');
        const idxFollow = await follows.indexes();
        ok('Follow: indice UNICO su {followerId:1, followingId:1}',
            idxFollow.some(i => i.unique && i.key && i.key.followerId === 1 && i.key.followingId === 1), JSON.stringify(idxFollow.map(i => i.key)));
        ok('Follow: indice su {followingId:1}', idxFollow.some(i => i.key && i.key.followingId === 1 && !i.key.followerId));

        const idxLike = await likes.indexes();
        ok('Like: indice UNICO su {userId:1, sessionId:1}',
            idxLike.some(i => i.unique && i.key && i.key.userId === 1 && i.key.sessionId === 1), JSON.stringify(idxLike.map(i => i.key)));
        ok('Like: indice su {sessionId:1}', idxLike.some(i => i.key && i.key.sessionId === 1 && !i.key.userId));

        const idxSR = await savedroutes.indexes();
        ok('SavedRoute: indice su {userId:1}', idxSR.some(i => i.key && i.key.userId === 1));

        const idxSess = await sessions.indexes();
        const parz = idxSess.find(i => i.key && i.key.userId === 1 && i.key.publishedAt === -1);
        ok('ActiveHikeSession: indice {userId:1, publishedAt:-1} PARZIALE su publishedAt',
            parz && parz.partialFilterExpression && parz.partialFilterExpression.publishedAt && parz.partialFilterExpression.publishedAt.$exists === true,
            JSON.stringify(parz && parz.partialFilterExpression));

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++; fallimenti.push('la prova stessa e\' andata in errore: ' + e.message);
    } finally {
        if (server) server.kill();

        // Pulizia mirata: tutto per marca/_id nati in questo run (nessun dato vero combacia).
        for (const id of sessioniCreate) await sessions.deleteOne({ _id: oid(id) }).catch(() => {});
        await sessions.deleteMany({ importedName: new RegExp('^' + MARCA) }).catch(() => {});
        await likes.deleteMany({ sessionId: { $in: sessioniCreate.map(oid) } }).catch(() => {});
        await savedroutes.deleteMany({ nome: new RegExp('^' + MARCA) }).catch(() => {});
        await hikes.deleteMany({ title: new RegExp('^' + MARCA) }).catch(() => {});
        if (sessioniCreate.length) {
            await notifiche.deleteMany({ relatedSessionId: { $in: sessioniCreate.map(oid) } }).catch(() => {});
        }
        // POST /api/hikes fa scattare la notifica "nuova escursione di squadra" ai membri
        // delle squadre di A (account demo collegato a una squadra vera - trappola nota):
        // quelle non hanno relatedSessionId, si prendono per il titolo della hike (con MARCA,
        // un timestamp: nessun dato vero combacia).
        await notifiche.deleteMany({ text: new RegExp(MARCA) }).catch(() => {});
        for (const { f, t } of followCoppie) {
            await follows.deleteOne({ followerId: oid(f), followingId: oid(t) }).catch(() => {});
        }

        const fine = {
            utenti: await users.countDocuments(),
            sessioni: await sessions.countDocuments(),
            follows: await follows.countDocuments(),
            likes: await likes.countDocuments(),
            savedroutes: await savedroutes.countDocuments(),
            hikes: await hikes.countDocuments(),
            notifiche: await notifiche.countDocuments()
        };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente creato o perso', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);
        ok('nessuna sessione di prova rimasta', fine.sessioni === partenza.sessioni, `${partenza.sessioni} -> ${fine.sessioni}`);
        ok('nessun follow di prova rimasto', fine.follows === partenza.follows, `${partenza.follows} -> ${fine.follows}`);
        ok('nessun like di prova rimasto', fine.likes === partenza.likes, `${partenza.likes} -> ${fine.likes}`);
        ok('nessun SavedRoute di prova rimasto', fine.savedroutes === partenza.savedroutes, `${partenza.savedroutes} -> ${fine.savedroutes}`);
        ok('nessuna escursione di prova rimasta', fine.hikes === partenza.hikes, `${partenza.hikes} -> ${fine.hikes}`);
        ok('nessuna notifica di prova rimasta', fine.notifiche === partenza.notifiche, `${partenza.notifiche} -> ${fine.notifiche}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
