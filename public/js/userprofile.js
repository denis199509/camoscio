// Pagina profilo di un ALTRO utente — non richiesta in cose_da_fare.txt, chiesta da
// Denis in sessione (01/08/2026). Si apre cliccando un nome/avatar altrove nel sito
// (per ora: nome dell'organizzatore e avatar dei partecipanti sulla scheda escursione,
// vedi public/js/social.js). Mostra SOLO badge personale, badge guadagnati e un avviso
// che la pagina e' in aggiornamento - il resto lo decidera' Denis in seguito.
//
// I timbri di un altro utente sono "achievement pubblici tra utenti loggati" (vedi
// routes/stamps.js): niente da nascondere. /api/users/:id applica gia' da solo il
// filtro privacy (serializeUserForViewer in routes/users.js) per gli altri campi -
// se profilePhoto sparisce per via della privacy dell'altro, si torna alla sua emoji,
// non e' un difetto di questo file.
async function showUserProfile(userId) {
    if (!userId) return;
    if (window.navigateTo) window.navigateTo("user-profile");
    await renderUserProfile(userId);
}

async function renderUserProfile(userId) {
    const header = document.getElementById("user-profile-header");
    const badgeBox = document.getElementById("user-profile-personal-badge");
    const badgesGrid = document.getElementById("user-profile-badges");
    if (!header || !badgesGrid) return;

    header.innerHTML = `<p class="text-muted">Caricamento...</p>`;
    badgeBox.innerHTML = "";
    badgesGrid.innerHTML = "";

    let utente = null;
    let timbri = [];
    try {
        [utente, timbri] = await Promise.all([
            fetch(`/api/users/${userId}`).then(r => r.ok ? r.json() : null),
            fetch(`/api/stamps/${userId}`).then(r => r.ok ? r.json() : [])
        ]);
    } catch (e) {
        console.error("Errore nel caricamento del profilo:", e);
        header.innerHTML = `<p class="text-muted">Non è stato possibile caricare questo profilo. Riprova più tardi.</p>`;
        return;
    }

    if (!utente) {
        header.innerHTML = `<p class="text-muted">Profilo non trovato.</p>`;
        return;
    }

    const sectionTitle = document.getElementById("section-title");
    if (sectionTitle) sectionTitle.textContent = utente.username;

    const esc = window.escapeHtml;
    const avatarHtml = utente.profilePhoto
        ? `<img src="${esc(utente.profilePhoto)}" alt="Foto profilo" class="avatar-photo">`
        : esc(utente.avatar);

    header.innerHTML = `
        <span class="user-profile-avatar">${avatarHtml}</span>
        <div class="user-details">
            <h3 class="font-bold">${esc(utente.username)}</h3>
            <p class="small text-muted">Livello: ${esc(utente.experienceLevel)} · Reputazione: ${utente.reputation}%</p>
        </div>
    `;

    // Punto 63(a): campo gia' esistente (localExpert), oggi visibile solo come tooltip
    // sull'avatar in una scheda escursione (social.js). Stesso testo usato li',
    // "Esperto locale: <zona>" - il nome non cambia finche' Denis non decide (punto 63b).
    const localExpertBox = document.getElementById("user-profile-local-expert");
    if (localExpertBox) {
        localExpertBox.innerHTML = (utente.localExpert && utente.localExpert.active)
            ? `<p class="local-expert-line"><i data-lucide="star"></i> Esperto locale: <b>${esc(utente.localExpert.area)}</b></p>`
            : "";
    }

    const personale = window.CamoscioPersonalBadges ? window.CamoscioPersonalBadges.get(userId) : null;
    if (personale) {
        badgeBox.innerHTML = `
            <div class="glass-card personal-badge-showcase">
                <img src="img/badge-personali/${esc(personale.icon)}" alt="${esc(personale.titolo)}" class="personal-badge-illustration">
                <div>
                    <h4>${esc(personale.titolo)}</h4>
                    <p>${esc(personale.descrizione)}</p>
                    <p class="small text-muted">Distintivo assegnato a mano dal team di Camoscio: non si guadagna, è un riconoscimento personale.</p>
                </div>
            </div>
        `;
    }

    if (window.CamoscioBadges) {
        const stato = window.CamoscioBadges.statoBadgePer(timbri || []);
        const presi = stato.filter(b => b.sbloccato)
            .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
        if (presi.length === 0) {
            badgesGrid.innerHTML = `<div class="glass-card text-center py-4 text-muted">Nessun badge conquistato per ora.</div>`;
        } else {
            presi.forEach(b => badgesGrid.appendChild(window.CamoscioBadges.schedaBadge(b)));
        }
    }

    if (window.lucide) window.lucide.createIcons();
}

window.showUserProfile = showUserProfile;
