// Verifica del segreto condiviso per le rotte chiamate da un trigger ESTERNO: in questo
// progetto non c'e' nessuno scheduler, quindi certe azioni periodiche (scadenze del Dead
// Man's Switch, scrub degli account eliminati) le fa scattare un ping da cron-job.org, e
// un ping non ha una sessione utente - non puo' usare requireAuth.
//
// Fail-closed in PRODUZIONE se il segreto non e' configurato (stesso principio di
// indirizzoBaseUtilizzabile in lib/mailer.js): senza, chiunque su internet potrebbe far
// scattare l'azione a ripetizione. In LOCALE invece si accetta senza segreto, per poter
// provare a mano senza configurare niente.
//
// Usata da:
//  - routes/safety.js   -> SAFETY_CRON_SECRET   (POST/GET /api/safety/controlla-scadenze)
//  - routes/users.js     -> ACCOUNT_SCRUB_SECRET (POST/GET /api/users/scrub-eliminati)
// I due segreti sono INDIPENDENTI di proposito: ruotarne uno non tocca l'altro job.
const crypto = require('crypto');

// Confronto a tempo costante: la differenza e' minima su HTTP, ma costa due righe e la
// rotta dello scrub e' distruttiva. timingSafeEqual pretende buffer di pari lunghezza,
// quindi la lunghezza si confronta prima (e li' un early-return va bene).
function stringheUguali(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function segretoCronValido(req, nomeVariabile) {
    const segreto = process.env[nomeVariabile];
    if (!segreto) return process.env.NODE_ENV !== 'production';
    const fornito = req.query.chiave || req.get('X-Cron-Secret') || req.get('X-Safety-Cron-Secret') || '';
    return stringheUguali(fornito, segreto);
}

module.exports = { segretoCronValido };
