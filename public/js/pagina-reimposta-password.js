// Estratto da reimposta-password.html (CSP/header di sicurezza, tappa 1, 52a sessione) -
// script inline spostato qui senza modifiche di comportamento, per poter attivare
// script-src 'self' senza 'unsafe-inline'. Non avvolto in IIFE: definisce globali come
// faceva l'inline, la pagina non si carica mai insieme alle altre.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Due parametri possibili nell'indirizzo, mutuamente esclusivi:
//  ?token=...   -> reset password normale (col secondo fattore, se l'account ce l'ha)
//  ?recupero=...-> completamento del RECUPERO RITARDATO senza secondo fattore (opzione C)
// Si leggono subito e si TOLGONO dalla barra (piu' sotto): le variabili li tengono in
// mano, ma nella cronologia del browser non restano.
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const recupero = params.get('recupero') || '';

// Il codice del secondo fattore per il reset normale: 6 cifre dell'app, oppure un
// codice di recupero (testo). Il link "usa invece..." fa da interruttore.
let modoRecoveryCode = false;

const STATI = ['stato-verifica', 'stato-modulo', 'stato-scaduto', 'stato-fatto',
               'stato-recupero-avviato', 'stato-recupero-attesa', 'stato-recupero-modulo'];
function mostra(idStato) {
    STATI.forEach(id => document.getElementById(id).classList.toggle('hidden', id !== idStato));
}
function mostraErrore(idBox, messaggio) {
    const box = document.getElementById(idBox);
    box.textContent = messaggio;
    box.classList.remove('hidden');
}
function dataItaliana(iso) {
    try {
        const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
        // timeZone esplicito (revisione del cumulativo 42a, cluster i18n): senza, si
        // legge il fuso del DISPOSITIVO di chi guarda - la stessa trappola UTC/ora
        // locale gia' segnalata piu' volte su questo progetto. La pagina scrive
        // sempre " (ora italiana)" accanto: senza forzare il fuso, quell'etichetta
        // sarebbe falsa per chiunque abbia il telefono su un altro fuso orario.
        return new Date(iso).toLocaleString(loc, {
            timeZone: 'Europe/Rome',
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return String(iso); }
}

// ---- Reset password normale (?token=) --------------------------------------------

async function verificaToken() {
    try {
        const res = await fetch('/api/auth/reset-password/check?token=' + encodeURIComponent(token));
        const dati = await res.json();
        if (dati && dati.valid) {
            document.getElementById('reset-2fa-group').classList.toggle('hidden', !dati.twoFactorRequired);
            mostra('stato-modulo');
            document.getElementById('reset-password').focus();
        } else {
            mostra('stato-scaduto');
        }
    } catch (e) {
        mostra('stato-scaduto');
        document.getElementById('scaduto-titolo').textContent =
            T('pwdReset.serverError') || 'Non riesco a contattare il server. Controlla la connessione e ricarica la pagina.';
    }
}

function toggleRecoveryCode() {
    modoRecoveryCode = !modoRecoveryCode;
    const campo = document.getElementById('reset-2fa-code');
    const lbl = document.getElementById('reset-2fa-label');
    const link = document.getElementById('link-usa-codice-recupero');
    if (modoRecoveryCode) {
        campo.removeAttribute('inputmode'); campo.removeAttribute('pattern'); campo.removeAttribute('maxlength');
        lbl.textContent = T('pwdReset.2faRecoveryLabel') || 'Codice di recupero:';
        link.textContent = T('pwdReset.2faUseApp') || 'Usa invece il codice dell\'app';
    } else {
        campo.setAttribute('inputmode', 'numeric'); campo.setAttribute('pattern', '[0-9]*'); campo.setAttribute('maxlength', '6');
        lbl.textContent = T('pwdReset.2faLabel') || 'Codice del secondo fattore (6 cifre):';
        link.textContent = T('pwdReset.2faUseRecovery') || 'Non ho il telefono: usa un codice di recupero';
    }
    campo.value = '';
    campo.focus();
}

async function inviaNuovaPassword(e) {
    e.preventDefault();
    const password = document.getElementById('reset-password').value;
    const conferma = document.getElementById('reset-password-confirm').value;
    const bottone = document.getElementById('reset-submit');

    if (password.length < 8) return mostraErrore('reset-error', T('auth.err.pwdMin8') || 'La password deve avere almeno 8 caratteri.');
    if (password !== conferma) return mostraErrore('reset-error', T('auth.err.pwdMismatch') || 'Le due password non coincidono.');

    const corpo = { token, password };
    const gruppo2fa = document.getElementById('reset-2fa-group');
    if (!gruppo2fa.classList.contains('hidden')) {
        const grezzo = document.getElementById('reset-2fa-code').value.trim();
        if (modoRecoveryCode) corpo.recoveryCode = grezzo;
        else corpo.code = grezzo.replace(/\D+/g, '');
    }

    document.getElementById('reset-error').classList.add('hidden');
    bottone.disabled = true;
    bottone.textContent = T('common.salvataggio') || 'Salvataggio…';
    const ripristina = () => { bottone.disabled = false; bottone.textContent = T('pwdReset.saveBtn') || 'Salva la nuova password'; };

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        const dati = await res.json();

        if (res.status === 401 && dati && dati.twoFactorRequired) {
            // L'account ha il 2FA e manca/e' sbagliato il codice. Il TOKEN RESTA VALIDO
            // (lo dice il server): si mostra il campo e si chiede di riprovare.
            gruppo2fa.classList.remove('hidden');
            mostraErrore('reset-error', dati.error || T('pwdReset.serveCodice') || 'Serve il codice del secondo fattore.');
            ripristina();
            document.getElementById('reset-2fa-code').focus();
            return;
        }
        if (!res.ok) {
            mostraErrore('reset-error', dati.error || T('pwdReset.changeFailed') || 'Non è stato possibile cambiare la password.');
            ripristina();
            return;
        }

        document.getElementById('fatto-dettaglio').textContent = dati.loggedIn
            ? (T('pwdReset.doneLoggedIn') || 'Sei già dentro: puoi tornare al sito e continuare.')
            : (T('pwdReset.doneNotLoggedIn') || 'Ora puoi accedere con la password nuova.');
        document.getElementById('btn-vai-al-sito').textContent = dati.loggedIn
            ? (T('pwdReset.goToSite') || 'Vai al sito')
            : (T('pwdReset.goToLogin') || 'Vai alla pagina di accesso');
        mostra('stato-fatto');
    } catch (err) {
        mostraErrore('reset-error', T('auth.err.serverUnreachable') || 'Impossibile contattare il server. Riprova.');
        ripristina();
    }
}

// ---- "Non ho né il telefono né i codici di recupero" -> recupero ritardato --------

async function avviaRecuperoRitardato() {
    const btn = document.getElementById('btn-avvia-recupero');
    btn.disabled = true;
    try {
        const res = await fetch('/api/auth/recovery/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
        });
        const dati = await res.json();
        if (!res.ok) {
            mostraErrore('reset-error', dati.error || T('pwdReset.recuperoErrore') || 'Non è stato possibile avviare il recupero.');
            document.getElementById('recupero-conferma').classList.add('hidden');
            btn.disabled = false;
            return;
        }
        document.getElementById('recupero-avviato-data').textContent = dataItaliana(dati.maturaIl) + (T('common.oraItaliana') || ' (ora italiana)');
        mostra('stato-recupero-avviato');
    } catch (e) {
        mostraErrore('reset-error', T('auth.err.serverUnreachable') || 'Impossibile contattare il server. Riprova.');
        document.getElementById('recupero-conferma').classList.add('hidden');
        btn.disabled = false;
    }
}

// ---- Completamento del recupero ritardato (?recupero=) ---------------------------

async function verificaRecupero() {
    try {
        const res = await fetch('/api/auth/recovery/check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: recupero })
        });
        const dati = await res.json();
        const stato = dati && dati.stato;
        if (stato === 'ok') {
            mostra('stato-recupero-modulo');
            document.getElementById('recupero-password').focus();
        } else if (stato === 'nonMaturo') {
            document.getElementById('recupero-attesa-data').textContent = dataItaliana(dati.maturaIl) + (T('common.oraItaliana') || ' (ora italiana)');
            const giorni = Math.max(0, Math.ceil((new Date(dati.maturaIl).getTime() - Date.now()) / 86400000));
            if (giorni > 0) {
                const modello = T('pwdReset.recuperoAttesaMancano') || 'Mancano ancora {n} giorni.';
                document.getElementById('recupero-attesa-mancano').textContent = ' ' + modello.replace('{n}', String(giorni));
            }
            mostra('stato-recupero-attesa');
        } else {
            // annullato / completato / scaduto / assente -> stesso riquadro "non valido",
            // con un sottotitolo che dice quale dei quattro.
            mostra('stato-scaduto');
            const t = {
                annullato:  T('pwdReset.recuperoAnnullato')  || 'Questo recupero è stato annullato.',
                completato: T('pwdReset.recuperoCompletato') || 'Questo recupero è già stato completato.',
                scaduto:    T('pwdReset.recuperoScaduto')    || 'Questo link è scaduto: avvia un nuovo recupero dalla pagina «password dimenticata».'
            }[stato];
            if (t) document.getElementById('scaduto-titolo').textContent = t;
        }
    } catch (e) {
        mostra('stato-scaduto');
        document.getElementById('scaduto-titolo').textContent =
            T('pwdReset.serverError') || 'Non riesco a contattare il server. Controlla la connessione e ricarica la pagina.';
    }
}

async function completaRecupero(e) {
    e.preventDefault();
    const password = document.getElementById('recupero-password').value;
    const conferma = document.getElementById('recupero-password-confirm').value;
    const bottone = document.getElementById('recupero-submit');

    if (password.length < 8) return mostraErrore('recupero-error', T('auth.err.pwdMin8') || 'La password deve avere almeno 8 caratteri.');
    if (password !== conferma) return mostraErrore('recupero-error', T('auth.err.pwdMismatch') || 'Le due password non coincidono.');

    document.getElementById('recupero-error').classList.add('hidden');
    bottone.disabled = true;
    bottone.textContent = T('common.salvataggio') || 'Salvataggio…';

    try {
        const res = await fetch('/api/auth/recovery/complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: recupero, password })
        });
        const dati = await res.json();
        if (!res.ok) {
            mostraErrore('recupero-error', dati.error || T('pwdReset.changeFailed') || 'Non è stato possibile cambiare la password.');
            bottone.disabled = false;
            bottone.textContent = T('pwdReset.saveBtn') || 'Salva la nuova password';
            return;
        }
        document.getElementById('fatto-dettaglio').textContent = dati.loggedIn
            ? (T('pwdReset.doneLoggedIn') || 'Sei già dentro: puoi tornare al sito e continuare.')
            : (T('pwdReset.doneNotLoggedIn') || 'Ora puoi accedere con la password nuova.');
        document.getElementById('btn-vai-al-sito').textContent = dati.loggedIn
            ? (T('pwdReset.goToSite') || 'Vai al sito')
            : (T('pwdReset.goToLogin') || 'Vai alla pagina di accesso');
        mostra('stato-fatto');
    } catch (err) {
        mostraErrore('recupero-error', T('auth.err.serverUnreachable') || 'Impossibile contattare il server. Riprova.');
        bottone.disabled = false;
        bottone.textContent = T('pwdReset.saveBtn') || 'Salva la nuova password';
    }
}

// ---- Aggancio + avvio ----------------------------------------------------------

document.getElementById('reset-form').addEventListener('submit', inviaNuovaPassword);
document.getElementById('recupero-form').addEventListener('submit', completaRecupero);
document.getElementById('link-usa-codice-recupero').addEventListener('click', toggleRecoveryCode);
document.getElementById('link-non-ho-niente').addEventListener('click', () => {
    document.getElementById('recupero-conferma').classList.remove('hidden');
});
document.getElementById('btn-annulla-avvio').addEventListener('click', () => {
    document.getElementById('recupero-conferma').classList.add('hidden');
});
document.getElementById('btn-avvia-recupero').addEventListener('click', avviaRecuperoRitardato);

// Si tolgono i parametri dall'indirizzo SUBITO: le variabili li hanno gia' in mano.
if (token || recupero) {
    history.replaceState(null, '', window.location.pathname);
}

if (recupero) {
    verificaRecupero();
} else if (token) {
    verificaToken();
} else {
    mostra('stato-scaduto');
}
