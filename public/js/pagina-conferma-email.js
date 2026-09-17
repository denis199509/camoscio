// Estratto da conferma-email.html (CSP/header di sicurezza, tappa 1, 52a sessione) - script
// inline spostato qui senza modifiche di comportamento, per poter attivare script-src 'self'
// senza 'unsafe-inline'. Non avvolto in IIFE: definisce globali come faceva l'inline, la
// pagina non si carica mai insieme alle altre.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Il token arriva dall'indirizzo. Si legge subito e poi si toglie dalla barra
// degli indirizzi, cosi' non resta nella cronologia del browser.
const token = new URLSearchParams(window.location.search).get('token') || '';

function mostra(idStato) {
    ['stato-verifica', 'stato-fatto', 'stato-scaduto'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== idStato);
    });
}

async function conferma() {
    if (!token) {
        mostra('stato-scaduto');
        return;
    }

    try {
        const res = await fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        mostra(res.ok ? 'stato-fatto' : 'stato-scaduto');
    } catch (e) {
        // Rete assente: NON si dice "link non valido", che sarebbe falso e farebbe
        // buttare via un link ancora buono. Si dice cos'e' successo davvero.
        mostra('stato-scaduto');
        document.querySelector('#stato-scaduto .auth-subtitle').textContent =
            T('emailConfirm.serverError') || 'Non riesco a contattare il server. Controlla la connessione e ricarica la pagina.';
    }
}

if (token) {
    history.replaceState(null, '', window.location.pathname);
}

conferma();
