// Modulo di autenticazione: vista login, wizard di registrazione a 6 passi, logout.
// Non tocca window.CamoscioState (quello e' gestito da app.js dopo il login).

const TOTAL_WIZARD_STEPS = 6;
let currentWizardStep = 1;
let registerPhotoDataUrl = null;

function showAuthError(elId, message) {
    const box = document.getElementById(elId);
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
}

function hideAuthError(elId) {
    const box = document.getElementById(elId);
    if (box) box.classList.add('hidden');
}

// --- Passaggio tra vista Login e vista Registrazione ---
function showLoginView() {
    document.getElementById('auth-login-view').classList.remove('hidden');
    document.getElementById('auth-register-view').classList.add('hidden');
}

function showRegisterView() {
    document.getElementById('auth-login-view').classList.add('hidden');
    document.getElementById('auth-register-view').classList.remove('hidden');
    currentWizardStep = 1;
    renderWizardStep();
}

// --- Indicatore di avanzamento (6 pallini) ---
function renderWizardProgress() {
    const container = document.getElementById('wizard-progress');
    if (!container) return;
    let html = '';
    for (let i = 1; i <= TOTAL_WIZARD_STEPS; i++) {
        const cls = i === currentWizardStep ? 'active' : (i < currentWizardStep ? 'done' : '');
        html += `<div class="wizard-progress-dot ${cls}">${i}</div>`;
        if (i < TOTAL_WIZARD_STEPS) html += '<div class="wizard-progress-line"></div>';
    }
    container.innerHTML = html;
}

function renderWizardStep() {
    document.querySelectorAll('.wizard-step').forEach(step => {
        step.classList.toggle('active', Number(step.getAttribute('data-step')) === currentWizardStep);
    });
    renderWizardProgress();

    document.getElementById('btn-wizard-prev').classList.toggle('hidden', currentWizardStep === 1);
    document.getElementById('btn-wizard-next').classList.toggle('hidden', currentWizardStep === TOTAL_WIZARD_STEPS);
    document.getElementById('btn-wizard-submit').classList.toggle('hidden', currentWizardStep !== TOTAL_WIZARD_STEPS);
}

// Valida il passo corrente. Ritorna un messaggio di errore, oppure null se tutto ok.
function validateCurrentStep() {
    if (currentWizardStep === 1) {
        const nome = document.getElementById('reg-nome').value.trim();
        const cognome = document.getElementById('reg-cognome').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const passwordConfirm = document.getElementById('reg-password-confirm').value;
        const ageMode = document.querySelector('input[name="age-mode"]:checked').value;

        if (!nome || !cognome) return 'Inserisci nome e cognome.';
        if (!email || !email.includes('@')) return 'Inserisci un indirizzo email valido.';
        if (password.length < 8) return 'La password deve avere almeno 8 caratteri.';
        if (password !== passwordConfirm) return 'Le due password non coincidono.';
        if (ageMode === 'date' && !document.getElementById('reg-birthdate').value) return 'Inserisci la data di nascita, oppure scegli "Fascia d\'età".';
        if (!document.getElementById('reg-terms').checked) return 'Devi accettare i Termini e la Privacy per continuare.';
        return null;
    }
    if (currentWizardStep === 4) {
        if (!document.getElementById('reg-username').value.trim()) return 'Scegli uno username.';
        return null;
    }
    if (currentWizardStep === 5) {
        const rows = document.querySelectorAll('.emergency-contact-row');
        if (rows.length === 0) return 'Serve almeno un contatto di emergenza.';
        for (const row of rows) {
            const name = row.querySelector('.ec-name').value.trim();
            const phone = row.querySelector('.ec-phone').value.trim();
            const relationship = row.querySelector('.ec-relationship').value.trim();
            if (!name || !phone || !relationship) return 'Completa nome, telefono e relazione per ogni contatto di emergenza.';
        }
        return null;
    }
    return null;
}

// --- Contatti di emergenza dinamici ---
function addEmergencyContactRow() {
    const list = document.getElementById('reg-emergency-contacts-list');
    const row = document.createElement('div');
    row.className = 'emergency-contact-row';
    row.innerHTML = `
        <button type="button" class="btn-remove-contact" title="Rimuovi contatto">&times;</button>
        <div class="form-row">
            <div class="form-group">
                <label>Nome:</label>
                <input type="text" class="ec-name">
            </div>
            <div class="form-group">
                <label>Telefono:</label>
                <input type="text" class="ec-phone">
            </div>
            <div class="form-group">
                <label>Relazione:</label>
                <input type="text" class="ec-relationship" placeholder="Es. Madre, Amico...">
            </div>
        </div>
    `;
    row.querySelector('.btn-remove-contact').addEventListener('click', () => {
        if (document.querySelectorAll('.emergency-contact-row').length > 1) {
            row.remove();
        } else {
            window.showToast('Serve almeno un contatto di emergenza.', 'error');
        }
    });
    list.appendChild(row);
}

function collectEmergencyContacts() {
    return Array.from(document.querySelectorAll('.emergency-contact-row')).map(row => ({
        name: row.querySelector('.ec-name').value.trim(),
        phone: row.querySelector('.ec-phone').value.trim(),
        relationship: row.querySelector('.ec-relationship').value.trim()
    }));
}

// --- Selettori a pulsanti singola-scelta (livello, privacy) ---
function setupChoicePicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
}

function getSelectedChoice(containerId) {
    const selected = document.querySelector(`#${containerId} .choice-btn.selected`);
    return selected ? selected.getAttribute('data-value') : null;
}

// --- Assemblaggio dati finali e invio ---
async function submitRegistration() {
    const ageMode = document.querySelector('input[name="age-mode"]:checked').value;
    const provinces = document.getElementById('reg-provinces').value.split(',').map(s => s.trim()).filter(Boolean);
    const mountainRanges = document.getElementById('reg-mountainranges').value.split(',').map(s => s.trim()).filter(Boolean);
    const interests = Array.from(document.querySelectorAll('input[name="reg-interest"]:checked')).map(cb => cb.value);

    const payload = {
        nome: document.getElementById('reg-nome').value.trim(),
        cognome: document.getElementById('reg-cognome').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        birthDate: ageMode === 'date' ? document.getElementById('reg-birthdate').value : null,
        ageRange: ageMode === 'range' ? document.getElementById('reg-agerange').value : null,
        termsAccepted: document.getElementById('reg-terms').checked,
        hikingLevel: getSelectedChoice('reg-hikinglevel-picker'),
        interests,
        preferredDifficulty: document.getElementById('reg-preferreddifficulty').value || null,
        geoPreferences: {
            region: document.getElementById('reg-region').value || null,
            provinces,
            mountainRanges
        },
        username: document.getElementById('reg-username').value.trim(),
        profilePhoto: registerPhotoDataUrl,
        bio: document.getElementById('reg-bio').value.trim(),
        emergencyContacts: collectEmergencyContacts(),
        geolocationConsent: document.getElementById('reg-geoconsent').checked,
        privacySetting: getSelectedChoice('reg-privacy-picker') || 'Pubblico'
    };

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            showAuthError('auth-register-error', data.error || 'Registrazione non riuscita.');
            return;
        }
        hideAuthError('auth-register-error');
        if (window.onAuthSuccess) window.onAuthSuccess();
    } catch (e) {
        console.error('Errore registrazione:', e);
        showAuthError('auth-register-error', 'Impossibile completare la registrazione. Riprova.');
    }
}

async function submitLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            showAuthError('auth-login-error', data.error || 'Accesso non riuscito.');
            return;
        }
        hideAuthError('auth-login-error');
        if (window.onAuthSuccess) window.onAuthSuccess();
    } catch (e) {
        console.error('Errore login:', e);
        showAuthError('auth-login-error', 'Impossibile contattare il server. Riprova.');
    }
}

function setupAuthGate() {
    document.getElementById('auth-login-form').addEventListener('submit', submitLogin);
    document.getElementById('link-go-register').addEventListener('click', showRegisterView);
    document.getElementById('link-go-login').addEventListener('click', showLoginView);

    document.getElementById('btn-wizard-next').addEventListener('click', () => {
        const error = validateCurrentStep();
        if (error) {
            window.showToast(error, 'error');
            return;
        }
        hideAuthError('auth-register-error');
        currentWizardStep = Math.min(TOTAL_WIZARD_STEPS, currentWizardStep + 1);
        renderWizardStep();
    });

    document.getElementById('btn-wizard-prev').addEventListener('click', () => {
        currentWizardStep = Math.max(1, currentWizardStep - 1);
        renderWizardStep();
    });

    document.getElementById('btn-wizard-submit').addEventListener('click', () => {
        const error = validateCurrentStep();
        if (error) {
            window.showToast(error, 'error');
            return;
        }
        submitRegistration();
    });

    // Passo 1: alterna data di nascita / fascia d'eta'
    document.querySelectorAll('input[name="age-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isDate = document.querySelector('input[name="age-mode"]:checked').value === 'date';
            document.getElementById('reg-birthdate').classList.toggle('hidden', !isDate);
            document.getElementById('reg-agerange').classList.toggle('hidden', isDate);
        });
    });

    setupChoicePicker('reg-hikinglevel-picker');
    setupChoicePicker('reg-privacy-picker');

    // Passo 4: contatore bio + anteprima foto
    document.getElementById('reg-bio').addEventListener('input', (e) => {
        document.getElementById('reg-bio-counter').textContent = e.target.value.length;
    });

    document.getElementById('reg-photo-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 1.5 * 1024 * 1024) {
            window.showToast('Foto troppo grande, scegline una più piccola (max ~1.5MB).', 'error');
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            registerPhotoDataUrl = reader.result;
            document.getElementById('reg-photo-preview').innerHTML = `<img src="${reader.result}" alt="Anteprima">`;
        };
        reader.readAsDataURL(file);
    });

    // Passo 5: almeno un contatto di emergenza gia' presente all'apertura
    addEmergencyContactRow();
    document.getElementById('btn-add-emergency-contact').addEventListener('click', addEmergencyContactRow);

    renderWizardStep();
}

// Logout
async function performLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        console.error('Errore logout:', e);
    }
    window.location.reload();
}

window.setupAuthGate = setupAuthGate;
window.showLoginView = showLoginView;
window.performLogout = performLogout;
