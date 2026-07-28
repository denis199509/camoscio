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
//
// Nessuna libreria nuova: fetch e' dentro Node.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10000;

// Indirizzo pubblico del sito, usato per costruire i link dentro le email.
// NON si ricava dall'intestazione "Host" della richiesta: quella la sceglie chi chiama, e
// permetterebbe di far arrivare a un utente vero un link che punta al server di qualcun
// altro (il token finirebbe dritto all'attaccante). Va letto dalla configurazione.
function indirizzoBase() {
    const configurato = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configurato) return configurato;
    // Ripiego per lo sviluppo in locale, dove APP_BASE_URL di solito non e' impostata.
    return `http://localhost:${process.env.PORT || 3000}`;
}

function configurato() {
    return !!(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
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
        console.log('EMAIL NON INVIATA (BREVO_API_KEY / BREVO_SENDER_EMAIL mancanti).');
        console.log('In locale e\' normale: ecco il contenuto che sarebbe partito.');
        console.log('-------------------------------------------------------------');
        console.log('A:       ', a);
        console.log('Oggetto: ', oggetto);
        console.log('-------------------------------------------------------------');
        console.log(testo);
        console.log('=============================================================\n');
        return false;
    }

    try {
        const res = await fetch(BREVO_URL, {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    email: process.env.BREVO_SENDER_EMAIL,
                    name: process.env.BREVO_SENDER_NAME || 'Camoscio'
                },
                to: [{ email: a }],
                subject: oggetto,
                textContent: testo,
                htmlContent: html || undefined
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (!res.ok) {
            // Il corpo dell'errore di Brevo dice il motivo vero (mittente non verificato,
            // quota giornaliera finita, chiave sbagliata): senza, si resta a indovinare.
            const dettaglio = await res.text().catch(() => '');
            console.error(`Invio email fallito (${res.status}):`, dettaglio.slice(0, 500));
            return false;
        }
        return true;
    } catch (e) {
        console.error('Invio email fallito (rete o timeout):', e.message);
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
        <p>${saluto}</p>
        <p>hai chiesto di reimpostare la password del tuo account <strong>Camoscio</strong>.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#3E6B48;color:#fff;text-decoration:none;border-radius:8px;">Scegli una nuova password</a></p>
        <p style="font-size:13px;color:#555;">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${link}</p>
        <p>Il link vale <strong>${durataMinuti} minuti</strong> e si pu&ograve; usare <strong>una volta sola</strong>.</p>
        <p style="font-size:13px;color:#555;">Se non hai chiesto tu questo cambio puoi ignorare questa email: non &egrave; cambiato niente e la tua password di adesso continua a funzionare.</p>
        <p style="font-size:12px;color:#888;">&mdash;<br>Camoscio &middot; escursioni in montagna</p>
    `;

    return { oggetto: 'Camoscio - reimposta la tua password', testo, html };
}

module.exports = { inviaEmail, emailRecuperoPassword, indirizzoBase, configurato };
