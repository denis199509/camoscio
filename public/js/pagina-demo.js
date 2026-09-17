// Estratto da demo.html (CSP/header di sicurezza, tappa 1, 52a sessione) - script inline
// spostato qui senza modifiche di comportamento, solo per poter attivare script-src 'self'
// senza 'unsafe-inline'. Definisce globali (escapeHtml, showToast) come faceva l'inline: la
// pagina non e' avvolta in IIFE e non si carica mai insieme a index.html, quindi non collide
// con le omonime di app.js/social.js - va incluso SOLO qui, mai in index.html.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

window.showToast = function (message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast error';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};

// Un account demo non ha password: chiunque puo' farvi accesso e, da li', rinominarsi
// (campo username, normalmente modificabile dal proprio profilo). Senza questo escaping
// un nome scelto apposta con HTML dentro avvelenerebbe questa pagina pubblica per
// chiunque la visiti dopo (bug trovato in Fase H, caccia ai bug generale).
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadDemoAccounts() {
    const grid = document.getElementById('demo-accounts-grid');
    try {
        const res = await fetch('/api/auth/demo-accounts');
        const accounts = await res.json();
        grid.innerHTML = accounts.map(u => `
            <div class="demo-account-btn" data-id="${u.id}">
                <span class="demo-avatar">${escapeHtml(u.avatar) || '🥾'}</span>
                <span class="demo-name">${escapeHtml(u.username)}</span>
                <span class="demo-level">${escapeHtml(u.experienceLevel) || ''}</span>
            </div>
        `).join('');

        grid.querySelectorAll('.demo-account-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const r = await fetch('/api/auth/demo-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: btn.getAttribute('data-id') })
                    });
                    if (!r.ok) throw new Error('Accesso demo fallito');
                    window.location.href = '/';
                } catch (e) {
                    showToast(T('demoPage.loginError') || "Impossibile accedere con l'account demo");
                }
            });
        });
    } catch (e) {
        grid.innerHTML = '<p class="text-muted">' + (T('demoPage.loadError') || 'Impossibile caricare gli account demo. Il server è avviato?') + '</p>';
    }
}

loadDemoAccounts();
