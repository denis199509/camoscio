// L'UNICO posto da cui parte un'email in tutto il progetto (punto 7 di cose_da_fare.txt).
//
// PERCHE' UN'API HTTP E NON SMTP: il piano gratuito di Render blocca le connessioni in
// uscita sulle porte SMTP (25, 465, 587). Nodemailer verso Gmail, o qualunque altro invio
// SMTP classico, non partirebbe proprio una volta online - funzionerebbe solo in locale,
// che e' il modo peggiore di scoprire un problema. Le normali chiamate HTTPS passano, e
// Brevo ne espone una.
//
// PERCHE' TUTTO IN QUESTO FILE: il canale di invio e' l'unica decisione che restava aperta
// (bloccava i punti 7, 21-resto e 22). Tenendolo dietro una sola funzione, cambiare
// servizio un domani vuol dire riscrivere questo file e nient'altro.
// E' gia' servito: il 2026-07-28 si era scelto BREVO, poi e' saltato perche' chiede la
// partita IVA. Passare a Mailjet ha voluto dire cambiare solo questo file - le rotte, il
// token, la pagina e le sessioni non sanno nemmeno chi sia il fornitore.
//
// Nessuna libreria nuova: fetch e' dentro Node.

// A-NUOVO-1 (ri-review sicurezza, 2° giro) + R-2 (3° giro): i valori interpolati nell'HTML
// delle email possono venire da campi scritti dall'utente - nome del contatto di emergenza,
// nome escursionista, e anche il `saluto` ("Ciao <nome>,") delle email di conferma indirizzo
// e recupero password, dove <nome> = user.nome || user.username. Senza escaping, un valore
// = `<a href="phishing">...</a>` finisce verbatim in un'email inviata dal mittente Mailjet
// verificato di Camoscio, verso un indirizzo scelto da chi si registra. Va escapato SEMPRE,
// come escapeHtml lato client. (Il tetto di lunghezza su nome/cognome/username sta in
// models/User.js + routes/auth.js: contenimento in profondita', non l'unica difesa.)
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Mailjet Send API v3.1. Due differenze da tenere a mente rispetto ad altri servizi:
//  - si autentica con DUE stringhe (chiave e segreto) in Basic auth, non con una sola;
//  - i campi del corpo hanno l'iniziale maiuscola (Messages, From, To, Subject...): con
//    l'iniziale minuscola la richiesta viene accettata ma il messaggio non parte.
const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';
const TIMEOUT_MS = 10000;

// Indirizzo pubblico del sito, usato per costruire i link dentro le email.
// NON si ricava dall'intestazione "Host" della richiesta: quella la sceglie chi chiama, e
// permetterebbe di far arrivare a un utente vero un link che punta al server di qualcun
// altro (il token finirebbe dritto all'attaccante). Va letto dalla configurazione.
function indirizzoBase() {
    const impostato = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (impostato) return impostato;
    // Ripiego per lo sviluppo in locale, dove APP_BASE_URL di solito non e' impostata.
    return `http://localhost:${process.env.PORT || 3000}`;
}

function inProduzione() {
    return process.env.NODE_ENV === 'production';
}

// L'indirizzo del sito e' utile quanto le chiavi: senza, il link dentro l'email
// punterebbe a "localhost", cioe' al computer di chi legge, e non funzionerebbe per
// nessuno. Online e' un errore che non si vede - l'email parte, sembra tutto a posto, e
// il link e' inservibile.
// Percio' ONLINE, senza APP_BASE_URL, il recupero risulta NON CONFIGURATO: il sito lo
// dice invece di mandare un link rotto. In locale il ripiego su localhost e' giusto e
// non serve impostare niente.
function indirizzoBaseUtilizzabile() {
    if (!inProduzione()) return true;
    const impostato = (process.env.APP_BASE_URL || '').trim();
    if (impostato && !/^https?:\/\/localhost/i.test(impostato)) return true;

    console.error(
        'ATTENZIONE: APP_BASE_URL non e\' impostata (o punta a localhost) mentre il sito ' +
        'gira in produzione. I link di recupero password sarebbero inservibili, quindi ' +
        'il recupero resta disattivato. Impostala fra le variabili d\'ambiente di Render ' +
        'con il valore https://camoscio.onrender.com'
    );
    return false;
}

function configurato() {
    return !!(
        process.env.MAILJET_API_KEY &&
        process.env.MAILJET_SECRET_KEY &&
        process.env.MAIL_SENDER_EMAIL &&
        indirizzoBaseUtilizzabile()
    );
}

// --- Stato di salute dell'invio -------------------------------------------------------
//
// Avere le chiavi non vuol dire riuscire a spedire: il servizio puo' rifiutare (account
// non ancora validato, mittente non confermato, quota giornaliera finita) oppure essere
// irraggiungibile. In quel caso dire "ti abbiamo mandato un'email" e' falso, ed e'
// esattamente la bugia che questo punto ha lavorato per non raccontare.
//
// PERCHE' UNO STATO GLOBALE E NON L'ESITO DELLA SINGOLA RICHIESTA, che sarebbe piu'
// preciso: l'esito della singola richiesta esiste SOLO per gli indirizzi registrati -
// per gli altri non si prova nemmeno a spedire. Rispondere "invio fallito" a chi e'
// registrato e "fatto" a chi non lo e' trasformerebbe il modulo in un elenco degli
// iscritti, proprio mentre il servizio e' guasto e ogni tentativo fallisce.
// Uno stato globale invece vale per tutti allo stesso modo: non distingue nessuno.
// Il prezzo e' che la PRIMA persona che incontra il guasto riceve ancora il messaggio
// ottimista. Si azzera a ogni riavvio del server, che va bene: e' una fotografia di
// adesso, non uno storico.
let ultimoInvioRiuscito = true;

function inviiFunzionanti() {
    return ultimoInvioRiuscito;
}

/**
 * Manda un'email. Ritorna true se e' partita davvero, false altrimenti.
 *
 * NON LANCIA MAI ECCEZIONI: chi la chiama non deve cambiare la risposta all'utente a
 * seconda di come e' andata (vedi la nota sulla risposta sempre identica in
 * routes/auth.js). Un guasto del servizio finisce nel log del server, non a schermo.
 */
async function inviaEmail({ a, oggetto, testo, html }) {
    // SENZA CHIAVE NON FALLISCE: stampa il messaggio sul terminale. Serve per lavorare e
    // fare le prove in locale (compreso Puppeteer) senza mandare email vere e senza dover
    // configurare niente. Se questo ramo scattasse in produzione, la riga nel log e' anche
    // il modo per accorgersene.
    if (!configurato()) {
        console.log('\n=============================================================');
        console.log('EMAIL NON INVIATA (MAILJET_API_KEY / MAILJET_SECRET_KEY /');
        console.log('MAIL_SENDER_EMAIL mancanti).');
        console.log('In locale e\' normale: ecco il contenuto che sarebbe partito.');
        console.log('-------------------------------------------------------------');
        console.log('A:       ', a);
        console.log('Oggetto: ', oggetto);
        console.log('-------------------------------------------------------------');
        console.log(testo);
        console.log('=============================================================\n');

        // IN LOCALE IL TERMINALE E' LA CASELLA DI POSTA: il messaggio e' arrivato dove
        // chi sviluppa va a leggerlo, quindi vale come consegnato e le schermate si
        // comportano come si comporteranno online.
        // IN PRODUZIONE no: li' questo ramo vuol dire che la configurazione manca, e
        // nessuno leggera' mai quel log aspettandosi un'email. Dire "consegnata" sarebbe
        // la solita bugia.
        return !inProduzione();
    }

    try {
        const credenziali = Buffer
            .from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`)
            .toString('base64');

        const res = await fetch(MAILJET_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credenziali}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                Messages: [{
                    From: {
                        Email: process.env.MAIL_SENDER_EMAIL,
                        Name: process.env.MAIL_SENDER_NAME || 'Camoscio'
                    },
                    To: [{ Email: a }],
                    Subject: oggetto,
                    TextPart: testo,
                    HTMLPart: html || undefined
                }]
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        const corpo = await res.json().catch(() => null);

        if (!res.ok) {
            // Il corpo dell'errore dice il motivo vero (account non ancora validato,
            // mittente non confermato, quota finita, chiavi sbagliate): senza, si resta a
            // indovinare.
            console.error(`Invio email fallito (${res.status}):`, JSON.stringify(corpo).slice(0, 500));
            ultimoInvioRiuscito = false;
            return false;
        }

        // ATTENZIONE, TRAPPOLA DI MAILJET: risponde 200 anche quando il singolo messaggio
        // NON e' stato accettato (per esempio mittente non verificato). L'esito vero sta
        // dentro Messages[].Status, e va guardato: fermarsi al codice HTTP vorrebbe dire
        // credere partita un'email che non e' mai uscita.
        const esito = corpo && corpo.Messages && corpo.Messages[0];
        if (!esito || esito.Status !== 'success') {
            console.error('Invio email rifiutato dal servizio:', JSON.stringify(corpo).slice(0, 500));
            ultimoInvioRiuscito = false;
            return false;
        }

        if (!ultimoInvioRiuscito) {
            console.log('Invio email tornato a funzionare.');
        }
        ultimoInvioRiuscito = true;
        return true;
    } catch (e) {
        console.error('Invio email fallito (rete o timeout):', e.message);
        ultimoInvioRiuscito = false;
        return false;
    }
}

// --- Le email del progetto ---------------------------------------------------------

// Testo del recupero password. Dice per esteso le due cose che tolgono ansia a chi riceve
// un'email che non aspettava: che il link scade, e che finche' non lo si usa la password
// di prima continua a funzionare. Chi non ha chiesto niente puo' semplicemente ignorarla.
function emailRecuperoPassword({ nome, link, durataMinuti }) {
    const saluto = nome ? `Ciao ${nome},` : 'Ciao,';
    const testo = [
        saluto,
        '',
        'hai chiesto di reimpostare la password del tuo account Camoscio.',
        'Apri questo link per sceglierne una nuova:',
        '',
        link,
        '',
        `Il link vale ${durataMinuti} minuti e si puo' usare una volta sola.`,
        '',
        'Se non hai chiesto tu questo cambio, puoi ignorare questa email: non e\' cambiato',
        'niente e la tua password di adesso continua a funzionare.',
        '',
        '--',
        'Camoscio - escursioni in montagna'
    ].join('\n');

    // L'HTML e' volutamente povero e senza immagini: pesa poco, si legge su qualunque
    // programma di posta e non ha niente che possa non caricarsi.
    const html = `
        <p>${esc(saluto)}</p>
        <p>hai chiesto di reimpostare la password del tuo account <strong>Camoscio</strong>.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#3E6B48;color:#fff;text-decoration:none;border-radius:8px;">Scegli una nuova password</a></p>
        <p style="font-size:13px;color:#555;">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${link}</p>
        <p>Il link vale <strong>${durataMinuti} minuti</strong> e si pu&ograve; usare <strong>una volta sola</strong>.</p>
        <p style="font-size:13px;color:#555;">Se non hai chiesto tu questo cambio puoi ignorare questa email: non &egrave; cambiato niente e la tua password di adesso continua a funzionare.</p>
        <p style="font-size:12px;color:#888;">&mdash;<br>Camoscio &middot; escursioni in montagna</p>
    `;

    return { oggetto: 'Camoscio - reimposta la tua password', testo, html };
}

// Conferma dell'indirizzo email, mandata alla registrazione.
// Deve dire chiaramente due cose: che si puo' usare il sito anche senza confermare
// subito (altrimenti sembra un blocco), e che chi non si e' registrato puo' ignorarla -
// perche' se qualcuno ha sbagliato a digitare, questa email arriva a un estraneo.
function emailVerificaIndirizzo({ nome, link, durataOre }) {
    const saluto = nome ? `Ciao ${nome},` : 'Ciao,';
    const testo = [
        saluto,
        '',
        'benvenuto su Camoscio! Confermaci che questo indirizzo e\' tuo:',
        '',
        link,
        '',
        `Il link vale ${durataOre} ore.`,
        '',
        'Puoi gia\' usare il sito anche prima di confermare. Serve pero\' per poter',
        'recuperare la password se un giorno la dimentichi: senza conferma non possiamo',
        'sapere che questa casella e\' davvero tua.',
        '',
        'Se non ti sei registrato tu, ignora pure questa email: senza il link qui sopra',
        'nessuno potra\' usare il tuo indirizzo per entrare.',
        '',
        '--',
        'Camoscio - escursioni in montagna'
    ].join('\n');

    const html = `
        <p>${esc(saluto)}</p>
        <p>benvenuto su <strong>Camoscio</strong>! Confermaci che questo indirizzo &egrave; tuo:</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#3E6B48;color:#fff;text-decoration:none;border-radius:8px;">Conferma il mio indirizzo</a></p>
        <p style="font-size:13px;color:#555;">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${link}</p>
        <p>Il link vale <strong>${durataOre} ore</strong>.</p>
        <p style="font-size:13px;color:#555;">Puoi gi&agrave; usare il sito anche prima di confermare. Serve per&ograve; per poter recuperare la password se un giorno la dimentichi: senza conferma non possiamo sapere che questa casella &egrave; davvero tua.</p>
        <p style="font-size:13px;color:#555;">Se non ti sei registrato tu, ignora pure questa email: senza il link qui sopra nessuno potr&agrave; usare il tuo indirizzo per entrare.</p>
        <p style="font-size:12px;color:#888;">&mdash;<br>Camoscio &middot; escursioni in montagna</p>
    `;

    return { oggetto: 'Camoscio - conferma il tuo indirizzo email', testo, html };
}

// Allarme vero del Dead Man's Switch (punto 37), mandata AI CONTATTI di emergenza, non a chi
// ha attivato il timer. A-3.2 (revisione sicurezza 21a): va a TUTTI i contatti con un'email,
// non a uno scelto - se uno non risponde o non riesce a chiamare il 112, si muovono gli
// altri. "altriContatti" e' l'elenco (nomi) degli ALTRI destinatari di questo stesso
// allarme, cosi' chi legge sa di non essere solo/a e puo' coordinarsi.
// Deve dire una cosa sola con certezza (l'orario previsto e' passato senza check-in) ed
// essere onesta su cosa il sito NON fa: non chiama i soccorsi, non e' un servizio di
// emergenza - e' un promemoria automatico, l'unica azione resta di chi legge (vincolo hard 7,
// stesso principio del tasto SOS che apre tel:112 invece di promettere il satellite).
function emailAllarmeDeadMan({ nomeContatto, nomeEscursionista, oraAttesa, posizioneTesto, altriContatti }) {
    const altri = Array.isArray(altriContatti) ? altriContatti.filter(Boolean) : [];
    const saluto = nomeContatto ? `Ciao ${nomeContatto},` : 'Ciao,';
    const primaRiga = altri.length
        ? `sei uno dei contatti di emergenza indicati da ${nomeEscursionista} su Camoscio, un'app di escursionismo.`
        : `sei il contatto di emergenza indicato da ${nomeEscursionista} su Camoscio, un'app di escursionismo.`;
    const rigaAltri = altri.length
        ? `Questo stesso avviso è stato mandato anche a: ${altri.join(', ')}. Se potete, coordinatevi.`
        : null;

    // testo semplice: nessun rendering HTML, i valori vanno cosi' come sono.
    const testo = [
        saluto,
        '',
        primaRiga,
        '',
        `${nomeEscursionista} aveva impostato un promemoria di rientro per le ${oraAttesa} e non ha`,
        "fatto il check-in entro quell'ora.",
        '',
        `Ultima posizione nota: ${posizioneTesto}`,
        ...(rigaAltri ? ['', rigaAltri] : []),
        '',
        'Questo è un messaggio automatico. Prova a contattarlo/a per sapere se è tutto a posto.',
        `Se non risponde e la cosa ti preoccupa, valuta di chiamare il 112 (numero unico di`,
        'emergenza): Camoscio non avvisa i soccorsi al posto tuo, può solo dirti che il tempo',
        'previsto è scaduto.',
        '',
        '--',
        'Camoscio - escursioni in montagna'
    ].join('\n');

    // A-NUOVO-1: nell'HTML ogni valore che deriva da un campo scritto dall'utente
    // (nome contatto, nome escursionista, nomi degli altri contatti) va escapato.
    const html = `
        <p>${esc(saluto)}</p>
        <p>${altri.length ? 'sei uno dei contatti di emergenza indicati da ' : 'sei il contatto di emergenza indicato da '}<strong>${esc(nomeEscursionista)}</strong> su Camoscio, un'app di escursionismo.</p>
        <p><strong>${esc(nomeEscursionista)}</strong> aveva impostato un promemoria di rientro per le <strong>${esc(oraAttesa)}</strong> e non ha fatto il check-in entro quell'ora.</p>
        <p style="padding:12px 16px;background:#fdf1ec;border-left:4px solid #A83B2E;border-radius:4px;">Ultima posizione nota:<br><strong>${esc(posizioneTesto)}</strong></p>
        ${altri.length ? `<p style="font-size:13px;color:#555;">Questo stesso avviso &egrave; stato mandato anche a: ${esc(altri.join(', '))}. Se potete, coordinatevi.</p>` : ''}
        <p style="font-size:13px;color:#555;">Questo &egrave; un messaggio automatico. Prova a contattarlo/a per sapere se &egrave; tutto a posto. Se non risponde e la cosa ti preoccupa, valuta di chiamare il <strong>112</strong> (numero unico di emergenza): Camoscio non avvisa i soccorsi al posto tuo, pu&ograve; solo dirti che il tempo previsto &egrave; scaduto.</p>
        <p style="font-size:12px;color:#888;">&mdash;<br>Camoscio &middot; escursioni in montagna</p>
    `;

    // Oggetto: niente a capo/ritorni carrello da un nome utente (igiene, anche se l'API
    // Mailjet prende il subject come campo JSON e non come header grezzo).
    const nomeOggetto = String(nomeEscursionista || '').replace(/[\r\n]+/g, ' ').trim();
    return { oggetto: `Camoscio - ${nomeOggetto} non ha fatto il check-in`, testo, html };
}

module.exports = {
    inviaEmail, emailRecuperoPassword, emailVerificaIndirizzo, emailAllarmeDeadMan,
    indirizzoBase, configurato, inviiFunzionanti
};
