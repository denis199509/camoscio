// PROVA M-5: contatti di emergenza, aggiunta/rimozione ATOMICA.
//
// COSA CONTROLLA, in breve: che due schede aperte sulla stessa lista di contatti non si
// annullino piu' le modifiche a vicenda. Prima l'unica via era PUT /api/users/:id, che
// riscriveva TUTTO l'array emergencyContacts: l'ultima scheda a salvare vinceva, e un
// contatto tolto da una scheda "resuscitava" per via del salvataggio dell'altra (dati di un
// terzo che non ha acconsentito - A-3.2). Ora POST/DELETE /api/users/:id/emergency-contacts
// fanno $push / $pull della SOLA voce toccata, per contenuto (lo schema ha _id:false).
//
// IL CUORE DELLA PROVA e' la sezione "RACE": simula due schede - una aggiornata, una con la
// lista vecchia - che cancellano contatti DIVERSI, e verifica che le due cancellazioni si
// COMPONGANO invece di sovrascriversi (nessun contatto che ritorna).
//
// Account REALE temporaneo (come prova-punto37.js: i contatti di emergenza non si toccano
// sui demo), creato dritto sul DB e cancellato per _id nel finally. Marca @esempio-di-prova.invalid.
//
// Lanciarla:  node prove/prova-contatti-emergenza.js   (ne avvia un server suo sulla 3136)

require('dotenv').config({ path: __dirname + '/../.env' });
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PORTA = 3136;
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
    try { corpoRisposta = testo ? JSON.parse(testo) : null; } catch { /* non-JSON */ }
    return { status: r.status, corpo: corpoRisposta, testo };
}

// nomi -> elenco di soli name, per confronti leggibili
const nomi = (arr) => (arr || []).map(c => c.name).sort();

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');

    const partenza = { utenti: await mongoose.connection.collection('users').countDocuments() };
    console.log('Conteggi di partenza:', partenza, '\n');

    let server;
    let logServer = '';
    let idA = null, idB = null; // due account veri temporanei

    try {
        server = spawn(process.execPath, ['server.js'], {
            cwd: __dirname + '/..',
            env: Object.assign({}, process.env, {
                PORT: String(PORTA),
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

        // --- Impianto: due account veri, accesso ---
        const pwd = `pw-${MARCA}-Xk`;
        const mkUser = async (suffisso) => User.create({
            username: `PROVA-EC-${MARCA}-${suffisso}`,
            email: `prova-ec-${MARCA}-${suffisso}@esempio-di-prova.invalid`,
            passwordHash: bcrypt.hashSync(pwd, 10),
            nome: 'Prova', cognome: 'Contatti', termsAcceptedAt: new Date(), emailVerified: true
        });
        const uA = await mkUser('a'); idA = String(uA._id);
        const uB = await mkUser('b'); idB = String(uB._id);

        const login = async (email) => {
            const r = await fetch(BASE + '/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: pwd })
            });
            return (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')])
                .filter(Boolean).map(c => c.split(';')[0]).join('; ');
        };
        const cookieA = await login(uA.email);
        const cookieB = await login(uB.email);
        ok('accesso ai due account di prova riuscito', !!cookieA && !!cookieB);

        const em = (n) => `ec-${MARCA}-${n}@esempio-di-prova.invalid`;

        // === 1. POST: aggiunta atomica ===
        let r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'Anna', relationship: 'sorella', email: em('anna') }, cookieA);
        ok('POST aggiunge un contatto (200)', r.status === 200, JSON.stringify(r.corpo));
        ok('la risposta contiene il contatto nuovo', r.corpo && nomi(r.corpo.emergencyContacts).join() === 'Anna');

        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'Bruno', relationship: 'amico', email: em('bruno') }, cookieA);
        ok('POST aggiunge un SECONDO contatto senza toccare il primo', r.status === 200
            && nomi(r.corpo.emergencyContacts).join() === 'Anna,Bruno', JSON.stringify(r.corpo));

        // === 2. POST: validazione ===
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'SenzaMail', relationship: 'x' }, cookieA);
        ok('POST rifiuta un contatto senza email (400)', r.status === 400, JSON.stringify(r.corpo));

        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: '', relationship: 'x', email: em('vuoto') }, cookieA);
        ok('POST rifiuta un contatto senza nome (400)', r.status === 400, JSON.stringify(r.corpo));

        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'MailStorta', relationship: 'x', email: 'non-una-mail' }, cookieA);
        ok('POST rifiuta un\'email senza @ (400)', r.status === 400, JSON.stringify(r.corpo));

        // Item 6 della revisione 35a: validator.isEmail, non includes('@'). "x@y" e "a@"
        // passavano il vecchio controllo e fallivano solo alla scadenza del timer.
        for (const mail of ['x@y', 'a@', '@esempio.it', 'due@@chiocciole.it']) {
            r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
                { name: 'Storta', relationship: 'x', email: mail }, cookieA);
            ok(`POST rifiuta l'email malformata ${JSON.stringify(mail)} (400)`, r.status === 400, JSON.stringify(r.corpo));
        }

        // === 3. POST: tetto di 5 ===
        // ne ha gia' 2 (Anna, Bruno): 3 buoni -> 5, il quarto (=sesto) deve fallire.
        for (const n of ['C3', 'C4', 'C5']) {
            r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
                { name: n, relationship: 'x', email: em(n) }, cookieA);
            ok(`POST accetta il contatto ${n} (sotto il tetto)`, r.status === 200, JSON.stringify(r.corpo));
        }
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'C6', relationship: 'x', email: em('c6') }, cookieA);
        ok('POST rifiuta il SESTO contatto (tetto di 5, 400)', r.status === 400, JSON.stringify(r.corpo));
        const dopoTetto = await User.findById(idA);
        ok('sul DB restano esattamente 5 contatti', (dopoTetto.emergencyContacts || []).length === 5);

        // === 4. POST: 403 sull'account di un altro ===
        r = await chiama('POST', `/api/users/${idB}/emergency-contacts`,
            { name: 'Intruso', relationship: 'x', email: em('intruso') }, cookieA);
        ok('POST sull\'account di un altro utente viene rifiutato (403)', r.status === 403, JSON.stringify(r.corpo));

        // === 5. DELETE: per contenuto, una sola voce ===
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Bruno', relationship: 'amico', email: em('bruno') }, cookieA);
        ok('DELETE toglie il contatto indicato (200)', r.status === 200
            && !nomi(r.corpo.emergencyContacts).includes('Bruno'), JSON.stringify(r.corpo));
        ok('gli altri 4 contatti restano', nomi(r.corpo.emergencyContacts).length === 4);

        // === 6. DELETE: idempotente (due schede tolgono lo STESSO contatto) ===
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Bruno', relationship: 'amico', email: em('bruno') }, cookieA);
        ok('DELETE di un contatto gia\' rimosso e\' un no-op (200, non 404)', r.status === 200);
        ok('...e la lista resta di 4', nomi(r.corpo.emergencyContacts).length === 4);

        r = await chiama('DELETE', `/api/users/${idB}/emergency-contacts`,
            { name: 'x', relationship: 'x', email: 'x@x.x' }, cookieA);
        ok('DELETE sull\'account di un altro utente viene rifiutato (403)', r.status === 403);

        // === 7. RACE: due schede, viste diverse, contatti diversi -> si compongono ===
        // Reset pulito a [A, B, C] scritto dritto sul DB.
        await User.findByIdAndUpdate(idA, { emergencyContacts: [
            { name: 'RA', relationship: 'x', email: em('ra') },
            { name: 'RB', relationship: 'x', email: em('rb') },
            { name: 'RC', relationship: 'x', email: em('rc') }
        ] });

        // Scheda 1 (aggiornata) toglie RB.
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'RB', relationship: 'x', email: em('rb') }, cookieA);
        ok('RACE: scheda 1 toglie RB', r.status === 200 && nomi(r.corpo.emergencyContacts).join() === 'RA,RC');

        // Scheda 2 ha ancora in mente [RA, RB, RC] e ora toglie RC. Manda i dati della SUA
        // voce RC, non l'intero array: RB NON deve tornare.
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'RC', relationship: 'x', email: em('rc') }, cookieA);
        ok('RACE: scheda 2 (vista vecchia) toglie RC', r.status === 200);
        ok('RACE: RB NON e\' resuscitato', !nomi(r.corpo.emergencyContacts).includes('RB'));
        ok('RACE: RC e\' stato tolto', !nomi(r.corpo.emergencyContacts).includes('RC'));
        ok('RACE: RA e\' sopravvissuto (le due cancellazioni si sono composte)',
            nomi(r.corpo.emergencyContacts).join() === 'RA', JSON.stringify(r.corpo));

        // === 8. PUT /api/users/:id non tocca piu' i contatti (M-5, whitelist) ===
        const primaDellaPut = await User.findById(idA);
        r = await chiama('PUT', `/api/users/${idA}`, {
            bio: 'cambio bio ok',
            emergencyContacts: [{ name: 'FORZATO', relationship: 'x', email: em('forzato') }]
        }, cookieA);
        ok('PUT /users/:id risponde 200 (aggiorna la bio)', r.status === 200);
        const dopoLaPut = await User.findById(idA);
        ok('PUT /users/:id ha cambiato la bio', dopoLaPut.bio === 'cambio bio ok');
        ok('PUT /users/:id NON ha toccato emergencyContacts (ignorato dalla whitelist)',
            JSON.stringify(nomi(dopoLaPut.emergencyContacts)) === JSON.stringify(nomi(primaDellaPut.emergencyContacts))
            && !nomi(dopoLaPut.emergencyContacts).includes('FORZATO'),
            JSON.stringify(dopoLaPut.emergencyContacts));

        // === 9. POST: niente doppioni (item 8 della revisione 35a) ===
        await User.findByIdAndUpdate(idA, { emergencyContacts: [] });
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'Dup', relationship: 'zio', email: em('dup') }, cookieA);
        ok('POST: primo inserimento di "Dup" -> 200', r.status === 200);
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'Dup', relationship: 'zio', email: em('dup') }, cookieA);
        ok('POST: lo STESSO contatto una seconda volta -> 409', r.status === 409, JSON.stringify(r.corpo));
        const dopoDup = await User.findById(idA);
        ok('sul DB "Dup" c\'e\' una volta sola', (dopoDup.emergencyContacts || []).filter(c => c.name === 'Dup').length === 1);
        // ...ma email diversa = contatto diverso, si aggiunge
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'Dup', relationship: 'zio', email: em('dup2') }, cookieA);
        ok('POST: stesso nome/relazione ma email diversa -> 200 (contatto distinto)', r.status === 200, JSON.stringify(r.corpo));

        // === 10. POST: phone vuoto NON viene scritto (item 8, vincolo spazio) ===
        await User.findByIdAndUpdate(idA, { emergencyContacts: [] });
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'NoTel', relationship: 'x', email: em('notel'), phone: '' }, cookieA);
        ok('POST con phone:"" -> 200', r.status === 200);
        r = await chiama('POST', `/api/users/${idA}/emergency-contacts`,
            { name: 'NoTel2', relationship: 'x', email: em('notel2'), phone: '   ' }, cookieA);
        ok('POST con phone di soli spazi -> 200', r.status === 200);
        const dopoTel = await User.findById(idA).lean();
        ok('nessuno dei due contatti ha il campo phone sul sotto-documento',
            (dopoTel.emergencyContacts || []).every(c => c.phone === undefined),
            JSON.stringify(dopoTel.emergencyContacts));

        // === 11. DELETE: omonimi, uno SENZA email (MEDIO-3 / item 3) ===
        // I contatti senza email sono legacy (pre-16/08/2026): validaUnContatto non ne accetta
        // piu' via POST, quindi si scrivono dritti sul DB come farebbe un dato vecchio.
        await User.findByIdAndUpdate(idA, { emergencyContacts: [
            { name: 'Anna', relationship: 'sorella' },                    // niente email (legacy)
            { name: 'Anna', relationship: 'sorella', email: em('anna') }, // omonima, con email
            { name: 'Zeno', relationship: 'amico', email: em('zeno') }
        ] });
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Anna', relationship: 'sorella' }, cookieA); // niente email nel corpo
        ok('DELETE "Anna sorella" senza email -> 200', r.status === 200, JSON.stringify(r.corpo));
        const dopoOmonimi = await User.findById(idA).lean();
        const anne = (dopoOmonimi.emergencyContacts || []).filter(c => c.name === 'Anna');
        ok('resta UNA "Anna" (quella con email non e\' stata portata via)', anne.length === 1, JSON.stringify(anne));
        ok('la "Anna" rimasta e\' quella CON email', anne[0] && anne[0].email === em('anna'), JSON.stringify(anne[0]));
        ok('"Zeno" non e\' stato toccato', (dopoOmonimi.emergencyContacts || []).some(c => c.name === 'Zeno'));
        // e ora si toglie anche quella con email, passandola nel corpo
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Anna', relationship: 'sorella', email: em('anna') }, cookieA);
        ok('DELETE "Anna sorella" con email -> 200, nessuna Anna resta', r.status === 200
            && !nomi(r.corpo.emergencyContacts).includes('Anna'), JSON.stringify(r.corpo));

        // === 12. DELETE: un filtro non-stringa nel corpo non pesca niente (guardia String()) ===
        await User.findByIdAndUpdate(idA, { emergencyContacts: [
            { name: 'Fisso', relationship: 'x', email: em('fisso') }
        ] });
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: { $ne: null }, relationship: { $ne: null }, email: { $ne: null } }, cookieA);
        ok('DELETE con {$ne:null} al posto dei nomi -> 400 (li ferma la type guard: typeof !== "string")',
            r.status === 400, JSON.stringify(r.corpo));
        const dopoIniezione = await User.findById(idA).lean();
        ok('...e il contatto "Fisso" e\' ancora li\'', (dopoIniezione.emergencyContacts || []).some(c => c.name === 'Fisso'));

        // === 13. POST: due richieste in parallelo al tetto -> una passa, una no, 5 sul DB ===
        await User.findByIdAndUpdate(idA, { emergencyContacts: [
            { name: 'P1', relationship: 'x', email: em('p1') },
            { name: 'P2', relationship: 'x', email: em('p2') },
            { name: 'P3', relationship: 'x', email: em('p3') },
            { name: 'P4', relationship: 'x', email: em('p4') }
        ] });
        const [g1, g2] = await Promise.all([
            chiama('POST', `/api/users/${idA}/emergency-contacts`, { name: 'G1', relationship: 'x', email: em('g1') }, cookieA),
            chiama('POST', `/api/users/${idA}/emergency-contacts`, { name: 'G2', relationship: 'x', email: em('g2') }, cookieA)
        ]);
        const esiti = [g1.status, g2.status].sort();
        ok('due POST concorrenti al tetto: uno 200 e uno 400', esiti.join() === '200,400', JSON.stringify(esiti));
        const dopoGara = await User.findById(idA).lean();
        ok('sul DB restano ESATTAMENTE 5 contatti (il tetto ha retto la corsa)',
            (dopoGara.emergencyContacts || []).length === 5, String((dopoGara.emergencyContacts || []).length));

        // === 14. DELETE toglie il nome anche da deadManLastFired.contattiNonRaggiunti
        //         (revisione del cumulativo 39a): e' il dato di un terzo, non deve
        //         sopravvivere alla rimozione del contatto ne' finire nell'export GDPR. ===
        await User.findByIdAndUpdate(idA, {
            $set: {
                emergencyContacts: [
                    { name: 'Mario', relationship: 'amico', email: em('mario') },
                    { name: 'Anna', relationship: 'sorella', email: em('anna') }
                ],
                deadManLastFired: { at: new Date(), contattiNonRaggiunti: ['Mario', 'Anna'] }
            }
        });
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Mario', relationship: 'amico', email: em('mario') }, cookieA);
        ok('DELETE "Mario" -> 200', r.status === 200, JSON.stringify(r.corpo));
        let dm = (await User.findById(idA).lean()).deadManLastFired;
        ok('"Mario" tolto anche da deadManLastFired.contattiNonRaggiunti',
            dm && JSON.stringify(dm.contattiNonRaggiunti) === JSON.stringify(['Anna']),
            JSON.stringify(dm && dm.contattiNonRaggiunti));
        ok('deadManLastFired c\'e\' ancora (l\'elenco non e\' vuoto)', !!dm && !!dm.at);

        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Anna', relationship: 'sorella', email: em('anna') }, cookieA);
        ok('DELETE "Anna" (l\'ultimo non-raggiunto) -> 200', r.status === 200);
        dm = (await User.findById(idA).lean()).deadManLastFired;
        ok('svuotato l\'elenco -> deadManLastFired $unset per intero (niente { at } orfano)',
            dm === undefined, JSON.stringify(dm));

        // 14b: un DELETE che non tocca nessun non-raggiunto lascia deadManLastFired intatto
        await User.findByIdAndUpdate(idA, {
            $set: {
                emergencyContacts: [{ name: 'Boh', relationship: 'x', email: em('boh') }],
                deadManLastFired: { at: new Date(), contattiNonRaggiunti: ['QualcunAltro'] }
            }
        });
        r = await chiama('DELETE', `/api/users/${idA}/emergency-contacts`,
            { name: 'Boh', relationship: 'x', email: em('boh') }, cookieA);
        ok('14b: DELETE "Boh" -> 200', r.status === 200);
        dm = (await User.findById(idA).lean()).deadManLastFired;
        ok('14b: deadManLastFired intatto (il nome tolto non era fra i non-raggiunti)',
            dm && JSON.stringify(dm.contattiNonRaggiunti) === JSON.stringify(['QualcunAltro']),
            JSON.stringify(dm));

    } catch (e) {
        console.error('\nERRORE DELLA PROVA:', e);
        falliti++;
        fallimenti.push('la prova stessa e\' andata in errore');
    } finally {
        if (server) server.kill();

        for (const id of [idA, idB]) {
            if (!id) continue;
            try { await User.deleteOne({ _id: new mongoose.Types.ObjectId(id) }); } catch (e) {
                console.error('ATTENZIONE: cancellazione account di prova fallita:', e.message);
            }
        }

        const fine = { utenti: await mongoose.connection.collection('users').countDocuments() };
        console.log('\nConteggi finali:', fine);
        ok('nessun utente di prova rimasto', fine.utenti === partenza.utenti, `${partenza.utenti} -> ${fine.utenti}`);

        await mongoose.disconnect();
        console.log(`\n=== ${passati} passati, ${falliti} falliti ===`);
        if (falliti) console.log('Falliti:\n - ' + fallimenti.join('\n - '));
        process.exit(falliti ? 1 : 0);
    }
})();
