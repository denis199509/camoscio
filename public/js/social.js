// Rollout traduzione punto 102, secondo lotto (22/08/2026). "var", non "const": vedi
// la nota in cima a i18n.js sul perche' (piu' file <script> classici che condividono
// lo stesso scope globale, "const T" ripetuto in due file darebbe SyntaxError).
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Punto 54: create-hike-modal e' riusato anche per modificare un'escursione gia'
// esistente - questo tiene traccia di QUALE, se non null siamo in modalita' modifica.
let editingHikeId = null;

function setHikeModalMode(mode, hike) {
    const titolo = document.querySelector('#create-hike-modal .modal-header h4');
    const submitBtn = document.querySelector('#create-hike-form button[type="submit"]');
    if (mode === 'edit') {
        editingHikeId = hike.id;
        if (titolo) titolo.textContent = T('hikeModal.modificaTitolo') || 'Modifica Escursione';
        if (submitBtn) submitBtn.textContent = T('hikeModal.salvaModificheBtn') || 'Salva Modifiche';
    } else {
        editingHikeId = null;
        if (titolo) titolo.textContent = T('hikeModal.creaNuova') || 'Crea Nuova Escursione';
        if (submitBtn) submitBtn.textContent = T('hikeModal.pubblicaBtn') || 'Pubblica Escursione';
    }
}

// Punto 43: riporta il selettore "quota/dislivello/distanza" a "Li scrivo io", che e' anche
// lo stato con cui si apre SEMPRE il modulo di modifica (punto 54) - anche su un'escursione
// che ha gia' un percorso collegato. Riproporre un progetto o una traccia ogni volta che si
// tocca un'altra cosa del modulo sarebbe una seccatura; chi vuole ricollegarne uno lo sceglie
// di nuovo apposta, chi non tocca questa parte si ritrova gli stessi numeri di prima.
function resetHikeRouteSourcePicker() {
    const sel = document.getElementById('hike-route-source');
    if (sel) sel.value = 'manuale';
    const draftPicker = document.getElementById('hike-route-draft-picker');
    const gpxPicker = document.getElementById('hike-route-gpx-picker');
    const manualRow = document.getElementById('hike-route-manual-row');
    const nota = document.getElementById('hike-route-calcolato-nota');
    if (draftPicker) draftPicker.classList.add('hidden');
    if (gpxPicker) gpxPicker.classList.add('hidden');
    if (manualRow) manualRow.classList.remove('hidden');
    if (nota) nota.classList.add('hidden');
    const gpxInput = document.getElementById('hike-route-gpx-file');
    if (gpxInput) gpxInput.value = '';
    document.querySelectorAll('#hike-alt, #hike-elev, #hike-dist').forEach(el => el.required = true);
    nascondiQuoteManuali();
}

// Punto 93 - il riquadro "scrivi tu quota e dislivello" (mostraQuoteManuali sotto) non deve
// mai restare visibile o "required" oltre il tentativo che lo ha fatto comparire: cambiare
// progetto, riaprire il modulo, o un secondo invio riuscito invalidano i numeri digitati.
function nascondiQuoteManuali() {
    const box = document.getElementById('hike-route-quote-manuali');
    if (box) box.classList.add('hidden');
    const quota = document.getElementById('hike-quota-manuale');
    const disl = document.getElementById('hike-dislivello-manuale');
    if (quota) { quota.required = false; quota.value = ''; }
    if (disl) { disl.required = false; disl.value = ''; }
}

// Mostra il riquadro con i due campi manuali dopo un 422 {richiedeQuote:true} dal server -
// vedi lib/percorso.js:risolviPercorso. "corpo" e' il JSON gia' letto dalla risposta.
function mostraQuoteManuali(corpo) {
    const box = document.getElementById('hike-route-quote-manuali');
    const nota = document.getElementById('hike-route-quote-manuali-nota');
    if (!box || !nota) return;
    nota.textContent = corpo.error || T('hikeModal.quoteManualiNota') || 'Scrivi tu quota massima e dislivello: il progetto resta collegato.';
    box.classList.remove('hidden');
    const quota = document.getElementById('hike-quota-manuale');
    const disl = document.getElementById('hike-dislivello-manuale');
    if (quota) quota.required = true;
    if (disl) { disl.required = true; disl.focus(); }
}

// Riempie il menu a tendina dei progetti con le bozze dell'utente (GET /api/routing/drafts,
// gia' esistente dal punto 13 - nessuna rotta nuova). Solo nome e id: i numeri si calcolano
// davvero al salvataggio, non qui, altrimenti due fonti potrebbero dire cose diverse.
async function popolaBozzePerHike() {
    const sel = document.getElementById('hike-route-draft-select');
    if (!sel) return;
    sel.innerHTML = `<option>${escapeHtml(T('profile.caricamento') || 'Caricamento...')}</option>`;
    try {
        const res = await fetch('/api/routing/drafts');
        const bozze = res.ok ? await res.json() : [];
        if (!bozze.length) {
            sel.innerHTML = `<option value="">${escapeHtml(T('hikeModal.nessunProgetto') || 'Non hai ancora nessun progetto salvato')}</option>`;
            return;
        }
        sel.innerHTML = bozze.map(b => `<option value="${b.id}">${window.escapeHtml(b.nome)}</option>`).join('');
    } catch (e) {
        console.error('Errore nel caricamento dei progetti:', e);
        sel.innerHTML = `<option value="">${escapeHtml(T('hikeModal.erroreCaricaProgetti') || 'Non è stato possibile caricare i progetti')}</option>`;
    }
}

// Precompila il modulo di creazione coi dati di un'escursione esistente e lo apre in
// modalita' modifica. Solo il creatore puo' arrivarci (il tasto compare solo a lui,
// e comunque routes/hikes.js rifiuta un salvataggio da chiunque altro).
window.openEditHikeModal = function(hikeId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    document.querySelectorAll('.hike-card-menu-dropdown').forEach(d => d.classList.add('hidden'));
    setHikeModalMode('edit', hike);

    document.getElementById('hike-title').value = hike.title;
    document.getElementById('hike-desc').value = hike.description;
    document.getElementById('hike-diff').value = hike.difficulty;
    // Niente "min" qui: un'escursione gia' esistente puo' avere una data di oggi o
    // passata, e non deve bloccare il salvataggio se non e' quella data a cambiare.
    document.getElementById('hike-date').removeAttribute('min');
    document.getElementById('hike-date').value = hike.date;
    resetHikeRouteSourcePicker();
    document.getElementById('hike-alt').value = hike.maxAltitude;
    document.getElementById('hike-elev').value = hike.elevationGain;
    document.getElementById('hike-dist').value = hike.distanceKm;
    document.getElementById('hike-approval').value = hike.manualApproval ? 'true' : 'false';

    document.querySelectorAll("input[name='hike-tags']").forEach(cb => {
        cb.checked = hike.tribeTags.includes(cb.value);
    });

    if (window.setChosenTrailhead) {
        window.setChosenTrailhead(hike.trailhead.lat, hike.trailhead.lng, hike.trailhead.name, '');
    }
    document.getElementById('hike-trailhead-search').value = hike.trailhead.name || '';

    document.getElementById('create-hike-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
};

function initSocialModule() {
    setupSocialEvents();
    renderSocialModule();
    renderHikesList();
}

function setupSocialEvents() {
    // Punto 113: apri/chiudi le due liste follow (Denis: "cliccando sopra devo vedere").
    // I due bottoni sono statici nell'HTML, un ascoltatore diretto qui basta (setupSocialEvents
    // gira una volta all'avvio); il contenuto delle liste si ridisegna ma i contenitori no.
    document.querySelectorAll('[data-follow-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const quale = btn.getAttribute('data-follow-toggle') === 'following' ? 'following-list' : 'followers-list';
            const body = document.getElementById(quale);
            if (!body) return;
            const chiuso = body.classList.toggle('hidden'); // true se 'hidden' è stato aggiunto
            btn.classList.toggle('open', !chiuso);
            btn.setAttribute('aria-expanded', String(!chiuso));
        });
    });

    // Form inserimento obiettivo di allenamento
    const formGoal = document.getElementById("training-goal-form");
    if (formGoal) {
        formGoal.addEventListener("submit", async (e) => {
            e.preventDefault();
            const goal = document.getElementById("user-training-goal").value;
            await saveTrainingGoal(goal);
        });
    }

    // Bottone apertura modal escursione
    const btnOpenModal = document.getElementById("btn-open-create-hike");
    const btnCloseModal = document.getElementById("btn-close-hike-modal");
    const modal = document.getElementById("create-hike-modal");

    if (btnOpenModal && modal) {
        btnOpenModal.addEventListener("click", () => {
            // Punto 54: questo tasto crea sempre una NUOVA escursione, anche se il modulo
            // era rimasto in modalita' modifica da un'apertura precedente mai inviata.
            setHikeModalMode('create');
            modal.classList.remove("hidden");
            // Imposta la data minima a oggi
            document.getElementById("hike-date").min = new Date().toISOString().split("T")[0];
            // Punto 8: form.reset() non basta a ripulire il punto di ritrovo scelto,
            // perche' nome/coordinate/avvisi stanno anche fuori dai campi del modulo.
            if (window.resetTrailheadPicker) window.resetTrailheadPicker();
            resetHikeRouteSourcePicker();
        });
    }

    if (btnCloseModal && modal) {
        btnCloseModal.addEventListener("click", () => {
            modal.classList.add("hidden");
            editingHikeId = null;
        });
    }

    // Punto 43: quota/dislivello/distanza a mano, oppure calcolati da un progetto o da una
    // traccia importata. Cambiare selettore mostra il pannello giusto e nasconde gli altri -
    // i tre campi manuali restano "required" solo quando servono davvero.
    const selRouteSource = document.getElementById('hike-route-source');
    if (selRouteSource) {
        selRouteSource.addEventListener('change', () => {
            const draftPicker = document.getElementById('hike-route-draft-picker');
            const gpxPicker = document.getElementById('hike-route-gpx-picker');
            const manualRow = document.getElementById('hike-route-manual-row');
            const manuale = selRouteSource.value === 'manuale';

            if (manualRow) manualRow.classList.toggle('hidden', !manuale);
            document.querySelectorAll('#hike-alt, #hike-elev, #hike-dist').forEach(el => el.required = manuale);
            // Cambiare la fonte del percorso invalida qualunque numero scritto a mano per
            // un tentativo precedente andato in 422 (punto 93).
            nascondiQuoteManuali();

            if (draftPicker) draftPicker.classList.toggle('hidden', selRouteSource.value !== 'draft');
            if (selRouteSource.value === 'draft') popolaBozzePerHike();

            if (gpxPicker) gpxPicker.classList.toggle('hidden', selRouteSource.value !== 'gpx');
        });
    }

    // Punto 54: menu "tre puntini" -> Modifica sulle card escursione. Delegato su un
    // solo ascoltatore (le card si ricreano ad ogni renderHikesList, uno per card
    // perderebbe il conteggio o si aggancerebbe piu' volte).
    document.addEventListener("click", (e) => {
        const kebabBtn = e.target.closest(".hike-card-menu-btn");
        if (kebabBtn) {
            e.stopPropagation();
            const dropdown = kebabBtn.nextElementSibling;
            const eraAperto = dropdown && !dropdown.classList.contains("hidden");
            document.querySelectorAll(".hike-card-menu-dropdown").forEach(d => d.classList.add("hidden"));
            if (dropdown && !eraAperto) dropdown.classList.remove("hidden");
            return;
        }
        if (!e.target.closest(".hike-card-menu-dropdown")) {
            document.querySelectorAll(".hike-card-menu-dropdown").forEach(d => d.classList.add("hidden"));
        }
    });

    // Form creazione escursione
    const formHike = document.getElementById("create-hike-form");
    if (formHike) {
        formHike.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitCreateHike();
        });
    }

    // Punto 64: modale di completamento di gruppo
    const btnCloseCompleteGroup = document.getElementById("btn-close-complete-group-modal");
    if (btnCloseCompleteGroup) {
        btnCloseCompleteGroup.addEventListener("click", closeCompleteGroupModal);
    }
    const btnConfirmCompleteGroup = document.getElementById("btn-confirm-complete-group");
    if (btnConfirmCompleteGroup) {
        btnConfirmCompleteGroup.addEventListener("click", submitCompleteGroup);
    }
    const inputCompleteGroupSearch = document.getElementById("complete-group-search-input");
    if (inputCompleteGroupSearch) {
        inputCompleteGroupSearch.addEventListener("input", renderCompleteGroupSearch);
    }

    // "Invita a Gita" da una squadra ricorrente
    const btnCloseInviteSquad = document.getElementById("btn-close-invite-squad-modal");
    if (btnCloseInviteSquad) {
        btnCloseInviteSquad.addEventListener("click", closeInviteSquadModal);
    }

    // Form creazione squadra ricorrente
    const btnOpenSquadForm = document.getElementById("btn-open-create-squad");
    const btnCloseSquadForm = document.getElementById("btn-close-squad-form");
    const squadFormBox = document.getElementById("create-squad-form-box");

    if (btnOpenSquadForm && squadFormBox) {
        btnOpenSquadForm.addEventListener("click", () => {
            squadFormBox.classList.remove("hidden");
            resetSquadCreateForm();
        });
    }

    if (btnCloseSquadForm && squadFormBox) {
        btnCloseSquadForm.addEventListener("click", () => {
            squadFormBox.classList.add("hidden");
        });
    }

    const formSquad = document.getElementById("create-squad-form");
    if (formSquad) {
        formSquad.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitCreateSquad();
        });
    }
    const inputSquadCreateSearch = document.getElementById("squad-create-search-input");
    if (inputSquadCreateSearch) {
        inputSquadCreateSearch.addEventListener("input", renderSquadCreateSearch);
    }

    // Form invio recensioni anonime obbligatorie
    const formReview = document.getElementById("peer-review-form");
    if (formReview) {
        formReview.addEventListener("submit", async (e) => {
            e.preventDefault();
            await submitAnonymousReview();
        });
    }

    // Filtri dinamici nella pagina escursioni
    const filterDiff = document.getElementById("filter-difficulty");
    const filterTribeContainer = document.getElementById("filter-tribe-checkboxes");
    const filterSearch = document.getElementById("filter-search-hikes");

    if (filterDiff) filterDiff.addEventListener("change", renderHikesList);
    if (filterTribeContainer) filterTribeContainer.addEventListener("change", renderHikesList);
    // Punto 69: "input" invece di "change", cosi' la lista si aggiorna ad ogni carattere
    // digitato invece che solo quando il campo perde il focus.
    if (filterSearch) filterSearch.addEventListener("input", renderHikesList);
}

// Renderizza la UI del modulo social
function renderSocialModule() {
    renderSocialStaticParts();
    // Il <select> delle recensioni fa un fetch (/api/reviews/gia-recensite): tenuto FUORI
    // da renderSocialStaticParts perche' l'onChange del cambio lingua lo richiama solo se
    // #social e' la sezione aperta (vedi in fondo al file), non a ogni toggle da un'altra
    // pagina - stesso schema di renderCompletate al secondo lotto.
    if (window.CamoscioState.currentUser) populateReviewTargets();
    // Punto 113: liste "chi segui"/"chi ti segue". Come populateReviewTargets fa un fetch
    // (/api/follow/followers), quindi sta qui e non in renderSocialStaticParts.
    if (window.CamoscioState.currentUser) renderFollowLists();
}

// Punto 113: le persone che seguo e che mi seguono, nella pagina Tribù & Squadre.
// "Chi seguo" viene da CamoscioState.following (già in stato, aggiornato da refreshState);
// "chi mi segue" da GET /api/follow/followers. Righe .squad-item come renderSquadsList,
// cliccabili verso il profilo, con un tasto segui/smetti inline (follow-back nella lista
// "ti seguono"). Le due liste sono chiuse di default: l'apri/chiudi è in setupSocialEvents.
async function renderFollowLists() {
    const followingBox = document.getElementById('following-list');
    const followersBox = document.getElementById('followers-list');
    if (!followingBox || !followersBox) return;

    const db = window.CamoscioState;
    if (!db.currentUser) return;

    const utente = (id) => db.users.find(u => u.id === id);
    const rigaPersona = (u, seguoGia) => {
        if (!u) return '';
        const btnCls = seguoGia ? 'btn-secondary' : 'btn-primary';
        const btnLbl = seguoGia ? (T('follow.seguiGia') || 'Segui già') : (T('follow.segui') || 'Segui');
        return `<div class="squad-item">
            <div class="squad-item-open" onclick="showUserProfile('${escapeHtml(u.id)}')">
                <h5>${escapeHtml(u.avatar)} ${escapeHtml(u.username)}</h5>
            </div>
            <div><button class="btn btn-sm ${btnCls}" onclick="toggleFollow('${escapeHtml(u.id)}')">${escapeHtml(btnLbl)}</button></div>
        </div>`;
    };

    // "Chi seguo" - da CamoscioState.following, nessun fetch.
    const seguiti = db.following || [];
    const seguitiIds = new Set(seguiti.map(f => f.followingId));
    const followingCount = document.getElementById('following-count');
    if (followingCount) followingCount.textContent = seguiti.length ? `(${seguiti.length})` : '';
    followingBox.innerHTML = seguiti.length
        ? seguiti.map(f => rigaPersona(utente(f.followingId), true)).join('')
        : `<div class="text-muted small italic text-center py-2">${escapeHtml(T('follow.nessunSeguito') || 'Non segui ancora nessuno.')}</div>`;

    // "Chi mi segue" - un solo GET, come populateReviewTargets.
    let followers = [];
    try {
        const res = await fetch('/api/follow/followers');
        if (res.ok) followers = await res.json();
    } catch (e) {
        console.error('Errore caricamento seguaci:', e);
    }
    const followersCount = document.getElementById('followers-count');
    if (followersCount) followersCount.textContent = followers.length ? `(${followers.length})` : '';
    followersBox.innerHTML = followers.length
        ? followers.map(f => rigaPersona(utente(f.followerId), seguitiIds.has(f.followerId))).join('')
        : `<div class="text-muted small italic text-center py-2">${escapeHtml(T('follow.nessunSeguace') || 'Nessuno ti segue ancora.')}</div>`;

    if (window.lucide) window.lucide.createIcons();
}

// Le parti di #social che disegnano SOLO da window.CamoscioState (nessun fetch):
// elenco squadre proprie/altrui, match su obiettivi comuni, riquadro "obiettivo
// attuale". Estratta da renderSocialModule per poter essere ridisegnata gratis al
// cambio lingua, come renderHikesList al secondo lotto - un'unica copia, mai due che
// possono divergere.
function renderSocialStaticParts() {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    if (!usr) return;

    // Carica l'obiettivo di allenamento dell'utente
    document.getElementById("user-training-goal").value = usr.trainingGoal || "";

    // Punto 98/D: mostra l'obiettivo salvato anche fuori dal campo modificabile,
    // altrimenti non c'e' nessun riscontro visibile dopo il salvataggio
    const goalDisplay = document.getElementById("current-goal-display");
    if (goalDisplay) {
        if (usr.trainingGoal) {
            goalDisplay.innerHTML = `${escapeHtml(T('social.currentGoal') || 'Il tuo obiettivo attuale:')} <strong style="color:var(--accent-orange)">${escapeHtml(usr.trainingGoal)}</strong>`;
            goalDisplay.classList.remove("hidden");
        } else {
            goalDisplay.classList.add("hidden");
        }
    }

    // Calcola e disegna i match sugli obiettivi
    renderGoalMatches(usr);

    // Disegna le squadre ricorrenti
    renderSquadsList();
    renderOtherSquadsList();
}

// Disegna l'elenco delle escursioni filtrate, diviso in tre categorie (punto 69):
// "a cui puoi partecipare" / "a cui partecipi" (organizzate + iscritto, unite: qui non
// serve la distinzione che ha senso in "Le mie escursioni") / "completate". Quest'ultima
// mostra solo le TUE concluse: il punto 77 fa gia' sparire le altre a monte, confermato
// con Denis che va bene resti vuota per chi non ha ancora completato nulla.
function renderHikesList() {
    const db = window.CamoscioState;
    if (!db || !db.currentUser) return;
    if (!document.getElementById("hikes-list-disponibili")) return;

    const diffFilter = document.getElementById("filter-difficulty").value;
    const tribeFilters = Array.from(document.querySelectorAll("input[name='filter-tribe-tag']:checked")).map(cb => cb.value);
    const testoRicerca = (document.getElementById("filter-search-hikes").value || "").trim().toLowerCase();

    // Filtra la lista. Più tag Tribù selezionati = AND (l'escursione deve averli tutti), non OR
    const filteredHikes = db.hikes.filter(h => {
        if (diffFilter !== "all" && h.difficulty !== diffFilter) return false;
        if (tribeFilters.length > 0 && !tribeFilters.every(tag => h.tribeTags.includes(tag))) return false;
        if (testoRicerca && !h.title.toLowerCase().includes(testoRicerca)) return false;
        return true;
    });

    // Classificazione calcolata SOLO sulle escursioni gia' filtrate qui sopra (stessa
    // funzione di "Le mie escursioni", punto 59: due pagine non devono poter raccontare
    // due cose diverse per lo stesso criterio) - "disponibili" e' il complementare delle
    // altre due, non un quarto confronto scritto a mano.
    const { create, partecipo, fatte } = classificaMieEscursioni(filteredHikes);
    const nonDisponibiliIds = new Set([...create, ...partecipo, ...fatte].map(h => h.id));
    const disponibili = filteredHikes.filter(h => !nonDisponibiliIds.has(h.id));
    const partecipi = [...create, ...partecipo].sort((a, b) => new Date(a.date) - new Date(b.date));

    document.getElementById("count-hikes-disponibili").textContent = disponibili.length;
    document.getElementById("count-hikes-partecipi").textContent = partecipi.length;
    document.getElementById("count-hikes-completate").textContent = fatte.length;

    riempiGruppo("hikes-list-disponibili", disponibili,
        T('hikes.nessunFiltro') || "Nessuna escursione trovata con i filtri inseriti.");
    riempiGruppo("hikes-list-partecipi", partecipi,
        T('hikes.nonPartecipiAlcuna') || "Non partecipi a nessuna escursione in programma.");
    riempiGruppo("hikes-list-completate", fatte,
        T('hikes.nessunaCompletata') || "Nessuna escursione completata.");

    if (window.lucide) window.lucide.createIcons();

    // "Le mie escursioni" mostra le stesse escursioni divise per gruppo: si ridisegna
    // insieme a questo elenco invece di aggiungere una chiamata in ognuno dei dodici
    // punti che aggiornano le escursioni (iscriversi, approvare, completare, creare...).
    // Cosi' i due elenchi non possono raccontare due cose diverse.
    if (window.renderMyHikes) window.renderMyHikes();
}

// --- LE MIE ESCURSIONI (punto 10 di cose_da_fare.txt) ---
//
// Le informazioni "l'ho creata io / ci partecipo / l'ho gia' fatta" esistevano gia', ma
// solo come riquadri colorati DENTRO le singole schede dell'elenco generale: per trovare
// le proprie escursioni bisognava scorrere quelle di tutti e guardare scheda per scheda.
// Qui si usano gli stessi identici criteri (stessi confronti su creatorId, participants,
// pendingApproval e db.completions) ma per DIVIDERE le escursioni in tre gruppi.

// Punto 69: accetta una lista opzionale su cui classificare (default db.hikes, il
// comportamento di sempre) - serve a renderHikesList() per applicarla DOPO i filtri
// (ricerca/difficolta'/tribu'), senza duplicare i tre confronti creatorId/participants/
// completions in un secondo posto. Chiamata senza argomenti (backpack.js, punto 23)
// si comporta esattamente come prima.
function classificaMieEscursioni(lista) {
    const db = window.CamoscioState;
    const utente = db.currentUser;
    if (!utente) return { create: [], partecipo: [], fatte: [] };

    const idFatte = new Set(
        (db.completions || []).filter(c => c.userId === utente.id).map(c => c.hikeId)
    );

    const create = [];
    const partecipo = [];
    const fatte = [];

    (lista || db.hikes || []).forEach(h => {
        const completata = idFatte.has(h.id);
        const sonoIscritto = (h.participants || []).includes(utente.id);
        const inAttesa = (h.pendingApproval || []).includes(utente.id);
        const laHoCreata = h.creatorId === utente.id;

        // "Gia' fatta" vince su tutto: una volta completata non ha piu' senso mostrarla
        // tra quelle in programma, indipendentemente dal fatto che l'avessi creata tu.
        if (completata) {
            fatte.push(h);
            return;
        }
        if (laHoCreata) create.push(h);
        // Chi ha creato l'escursione ne fa anche parte: senza questo controllo
        // comparirebbe due volte, in "organizzate da me" e in "a cui partecipo".
        else if (sonoIscritto || inAttesa) partecipo.push(h);
    });

    // La piu' vicina nel tempo per prima: e' quella di cui importa davvero.
    const perData = (a, b) => new Date(a.date) - new Date(b.date);
    create.sort(perData);
    partecipo.sort(perData);
    // Le gia' fatte al contrario: l'ultima cosa fatta e' la prima da rivedere.
    fatte.sort((a, b) => new Date(b.date) - new Date(a.date));

    return { create, partecipo, fatte };
}

// "Aperte" = si puo' ancora agire su di esse (usata da "Invita a Gita", punto nuovo). Due
// condizioni, per due motivi diversi:
//  1) !groupCompletedAt - il gruppo "fatte" di classificaMieEscursioni guarda il MIO
//     Completion, non lo stato dell'escursione: chi e' stato aggiunto a un'escursione gia'
//     chiusa non ne ha nessuno, e per lui la chiusa ricadrebbe comunque in "partecipo";
//  2) partecipante VERO, non solo in attesa - "partecipo" unisce sonoIscritto e inAttesa, ma
//     su un'escursione dove sono solo in pendingApproval il server rifiuta qualunque modifica
//     alla lista partecipanti (wasParticipant falso, routes/hikes.js): sarebbe un bersaglio
//     che risponde sempre 403.
// Nessun filtro sulla data, di proposito: un'escursione passata ma non ancora chiusa resta un
// bersaglio legittimo, e confrontare una data senza ora con "adesso" e' la trappola del punto 58.
function mieEscursioniAperte() {
    const db = window.CamoscioState;
    const me = db.currentUser ? db.currentUser.id : null;
    if (!me) return [];
    const { create, partecipo } = classificaMieEscursioni();
    return create.concat(partecipo).filter(h =>
        !h.groupCompletedAt && (h.creatorId === me || (h.participants || []).includes(me))
    );
}
window.mieEscursioniAperte = mieEscursioniAperte;

function riempiGruppo(idContenitore, escursioni, messaggioVuoto) {
    const box = document.getElementById(idContenitore);
    if (!box) return;
    box.innerHTML = "";

    if (!escursioni.length) {
        box.innerHTML = `<div class="glass-card text-center py-4 text-muted col-span-2">${messaggioVuoto}</div>`;
        return;
    }
    escursioni.forEach(h => box.appendChild(buildHikeCard(h)));
}

function renderMyHikes() {
    const db = window.CamoscioState;
    if (!db || !db.currentUser) return;
    if (!document.getElementById("my-hikes-created")) return;

    const { create, partecipo, fatte } = classificaMieEscursioni();

    document.getElementById("count-created").textContent = create.length;
    document.getElementById("count-joined").textContent = partecipo.length;

    riempiGruppo("my-hikes-created", create,
        T('myHikes.nessunaOrganizzata') || "Non hai ancora organizzato nessuna escursione. Puoi crearne una dalla sezione Escursioni.");
    riempiGruppo("my-hikes-joined", partecipo,
        T('myHikes.nonIscrittoAlcuna') || "Non sei iscritto a nessuna escursione in programma. Guarda quelle degli altri nella sezione Escursioni.");

    // Punto 80/B: "Gia' fatte" e "Uscite registrate" sono ora un'unica lista visiva
    // (public/js/storico.js, renderCompletate) - vive li' perche' e' l'unico file che ha
    // gia' la parte ASINCRONA della sezione (fetch delle sessioni, cancellazione,
    // caricamento gpx). Chiamata senza await (fire-and-forget): renderMyHikes resta
    // sincrona, non fa aspettare i dodici punti che passano da renderHikesList qui sopra.
    // Scrive da sola il proprio contatore (#count-completate) quando la sua fetch
    // finisce - #my-hikes-summary qui sotto conta invece SOLO le escursioni sociali
    // (fatte.length), non cambia significato.
    if (window.renderCompletate) window.renderCompletate(fatte);

    const riepilogo = document.getElementById("my-hikes-summary");
    if (riepilogo) {
        const totale = create.length + partecipo.length + fatte.length;
        riepilogo.innerHTML = totale === 0
            ? `<div class="glass-card text-center py-4 text-muted">${escapeHtml(T('myHikes.riepilogoVuoto') || 'Qui compariranno le tue escursioni: quelle che organizzi, quelle a cui ti iscrivi e quelle che hai già fatto.')}</div>`
            : `<div class="glass-card my-hikes-counters">
                   <div><strong>${create.length}</strong><span>${escapeHtml(T('myHikes.organizzateLabel') || 'organizzate')}</span></div>
                   <div><strong>${partecipo.length}</strong><span>${escapeHtml(T('myHikes.programmaLabel') || 'in programma')}</span></div>
                   <div><strong>${fatte.length}</strong><span>${escapeHtml(T('myHikes.completateLabel') || 'completate')}</span></div>
               </div>`;
    }

    if (window.lucide) window.lucide.createIcons();
}

window.renderMyHikes = renderMyHikes;
// Esportata anche per lo Zaino (punto 23): deve sapere quali escursioni sono DAVVERO
// dell'utente, e deve usare gli stessi identici criteri di questa pagina - altrimenti
// "mia escursione" finirebbe per voler dire due cose diverse in due punti del sito.
window.classificaMieEscursioni = classificaMieEscursioni;

// Rollout punto 102, secondo lotto: renderHikesList legge solo window.CamoscioState
// (mai una fetch diretta) e ricade a cascata su renderMyHikes() e su
// renderCompletate() (storico.js - quella fa una fetch vera, ma solo se "Le mie
// escursioni" e' la sezione attiva, stesso schema gia' seguito da ogni altra azione
// di questa pagina - non un costo nuovo introdotto dal cambio lingua).
if (window.CamoscioI18n) window.CamoscioI18n.onChange(renderHikesList);

// Rollout punto 102, quinto lotto. Cambio lingua:
//  - parti sincrone di #social (squadre, match obiettivi, riquadro "obiettivo
//    attuale"): sempre, sono letture da CamoscioState, come renderHikesList sopra;
//  - <select> recensioni (populateReviewTargets, che fa un fetch): solo se #social e'
//    la sezione aperta - stesso schema di renderCompletate (storico.js) al secondo
//    lotto, nessun fetch a vuoto per una pagina che non si sta guardando.
if (window.CamoscioI18n) window.CamoscioI18n.onChange(function () {
    renderSocialStaticParts();
    const social = document.getElementById("social");
    if (social && social.classList.contains("active") && window.CamoscioState.currentUser) {
        populateReviewTargets();
        renderFollowLists(); // punto 113: fa un fetch, solo se #social è aperta
    }
});

// Costruisce la scheda di UNA escursione. Estratta da renderHikesList (punto 10 di
// cose_da_fare.txt) per poterla riusare identica anche nella pagina "Le mie escursioni":
// due elenchi che mostrano le stesse schede devono restare uguali da soli, senza doverle
// aggiornare in due punti ogni volta che cambia qualcosa.
function buildHikeCard(hike) {
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const creator = db.users.find(u => u.id === hike.creatorId);
    const creatorName = creator ? creator.username : (T('hikeCard.escursionistaFallback') || "Escursionista");

    // Badge personale (chiesto da Denis in sessione il 01/08/2026, non in
    // cose_da_fare.txt): assegnato a mano, non guadagnato - vedi personal-badges.js.
    const creatorPersonalBadge = window.CamoscioPersonalBadges ? window.CamoscioPersonalBadges.get(hike.creatorId) : null;
    const creatorBadgeHtml = creatorPersonalBadge
        ? ` <img class="personal-badge-icon" src="img/badge-personali/${escapeHtml(creatorPersonalBadge.icon)}" alt="" title="${escapeHtml(creatorPersonalBadge.titolo)}: ${escapeHtml(creatorPersonalBadge.descrizione)}">`
        : "";
    const isCreatorMe = hike.creatorId === currentUser.id;

    // Punto 44, ripreso ora che il punto 43 puo' collegare un percorso VERO: senza
    // hike.routeSource dislivello/distanza restano quelli dichiarati da chi organizza, e
    // un tempo calcolato su un'ipotesi sarebbe un numero che sembra una misura e non lo e'
    // (lo stesso principio gia' scritto per il dislivello dei progetti al punto 33).
    // Con un percorso collegato i numeri sono VERI, quindi calculateHikeTimes() (mai
    // toccata, punto 33/44) torna a essere richiamabile cosi' com'e'.
    const tempoHtml = hike.routeSource
        ? (() => {
            const tempi = calculateHikeTimes(hike, currentUser);
            // "sul tuo passo" si scrive SOLO se un passo misurato esiste davvero. Senza
            // misure il calcolo usa un'ipotesi di partenza (350 m/h, vedi calculateHikeTimes):
            // stamparla accanto alla parola "tuo" e' lo stesso difetto trovato da Denis sulla
            // card Passo & Fatica in Dashboard - un numero inventato che sembra personale.
            // Il tempo CAI standard invece si mostra sempre: e' calcolato sui dati veri del
            // percorso collegato e non dice niente su chi guarda.
            const parteMia = tempi.passoMisurato
                ? ` · <b>${tempi.customText}</b> ${T('hikeCard.sulTuoPasso') || 'sul tuo passo'}`
                : '';
            // Punto 93: dislivelloManuale = la distanza e il tracciato sono veri (dal
            // percorso), ma quota massima e dislivello li ha scritti chi organizza perche'
            // la fonte delle quote non rispondeva - lo si dice, invece di far credere che
            // tutti e tre i numeri siano stati misurati allo stesso modo.
            const notaManuale = hike.routeSource.dislivelloManuale ? (T('hikeCard.dislivelloIndicato') || ' - dislivello indicato da chi organizza') : '';
            return `<p class="small text-muted rp-nota-dislivello"><i data-lucide="clock"></i><span>${escapeHtml(T('hikeCard.tempoPrevistoLabel') || 'Tempo previsto:')} <b>${tempi.standardText}</b> ${escapeHtml(T('hikeCard.caiStandard') || '(CAI standard)')}${parteMia}. ${escapeHtml(T('hikeCard.percorsoLabel') || 'Percorso:')} ${escapeHtml(hike.routeSource.nome)}${notaManuale}.</span></p>`;
        })()
        : `<p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i><span>${escapeHtml(T('hikeCard.tempoNonDisponibile') || "Tempo previsto non disponibile: per questa escursione non è ancora stato scelto un percorso reale, quindi non si può sapere quanto ci vorrà davvero. Dislivello e distanza qui sopra sono quelli indicati da chi l'ha organizzata.")}</span></p>`;

    // Punto 79: se l'escursione e' completata e IO ho un tempo di cammino reale misurato da
    // un .gpx (Completion.movingTimeHours, presente solo quando la traccia era abbastanza
    // fitta da fidarsene), lo confronto con lo standard CAI calcolato sugli stessi dati VERI
    // dell'escursione - non sul mio passo storico, che e' gia' il confronto mostrato sopra
    // prima di partire. Risponde alla domanda di Denis: "quanto ho camminato davvero, senza
    // le mie pause, contro lo standard" - le pause si mostrano separate perche' sono sue,
    // soggettive, non della escursione (a lui bastano 5 minuti, ad altri ne servono 10+).
    // Punto 80/A: la ricerca non e' piu' condizionata a hike.groupCompletedAt come prima -
    // quel controllo era una scorciatoia valida solo finche' unicamente il completamento di
    // gruppo poteva portare un movingTimeHours. Ora anche un'escursione auto-completata (mai
    // passata dal gruppo) puo' averne uno, aggiunto in un secondo momento da qui sotto
    // (tasto "Carica gpx") - serve quindi cercare il proprio Completion su OGNI escursione
    // completata, non solo su quelle completate in gruppo. miaCompletion serve anche piu'
    // sotto per i tasti "carica gpx"/cestino, visibili solo se questa escursione e' fra le
    // mie "gia' fatte" (db.completions e' gia' filtrata per l'utente corrente, vedi app.js).
    const miaCompletion = db.completions.find(c => c.hikeId === hike.id);
    let tempoRealeHtml = "";
    if (miaCompletion && miaCompletion.movingTimeHours) {
        const tVertStandard = hike.elevationGain / 400;
        const tFlatStandard = hike.distanceKm / 4;
        const caiOre = Math.max(tVertStandard, tFlatStandard) + Math.min(tVertStandard, tFlatStandard) / 2;
        const pauseOre = miaCompletion.actualTimeHours
            ? Math.max(0, miaCompletion.actualTimeHours - miaCompletion.movingTimeHours)
            : 0;
        const pausaText = pauseOre > (1 / 60) // sotto il minuto non si scrive, formatHoursToMin arrotonderebbe a "0h 0m"
            ? (T('profile.diPause', window.formatHoursToMin(pauseOre)) || ` (+ ${window.formatHoursToMin(pauseOre)} di pause)`)
            : "";
        tempoRealeHtml = `<p class="small text-muted rp-nota-dislivello"><i data-lucide="footprints"></i><span>${escapeHtml(T('hikeCard.tempoMisuratoLabel') || 'Il tuo tempo di cammino misurato:')} <b>${window.formatHoursToMin(miaCompletion.movingTimeHours)}</b>${pausaText} · ${escapeHtml(T('hikeCard.caiPercorsoLabel') || 'CAI per questo percorso:')} <b>${window.formatHoursToMin(caiOre)}</b>.</span></p>`;
    }

    // Punto 80/A: aggiungere un .gpx a un'escursione gia' completata, o cancellarla dallo
    // storico - solo quando ho davvero un Completion per questa escursione (le card di
    // "disponibili"/"a cui partecipo" non entrano mai qui). L'input file e' creato al volo
    // in uploadCompletionGpx invece che nel markup: piu' card identiche vivono insieme nel
    // DOM (Escursioni "Completate" e Le mie escursioni "Gia' fatte" possono mostrare la
    // stessa escursione due volte), e un id fisso qui ripeterebbe la stessa trappola gia'
    // presa nota in leggimi.txt per chatpanel.js/buildHikeCard - mai un id fisso su un
    // elemento di un componente che vive in piu' copie.
    const completionToolsHtml = miaCompletion ? `
        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="uploadCompletionGpx('${miaCompletion.id}')" title="${escapeHtml(T('hikeCard.caricaGpxTitle') || 'Carica un file .gpx per avere il tempo reale di questa escursione')}">
            <i data-lucide="upload"></i>
        </button>
        <button class="btn btn-sm btn-secondary" style="padding:2px 6px; color:var(--accent-red);" onclick="deleteCompletion('${miaCompletion.id}', '${hike.id}')" title="${escapeHtml(T('hikeCard.cancellaGiaFattaTitle') || "Cancella questa escursione dalle tue 'gia' fatte'")}">
            <i data-lucide="trash-2"></i>
        </button>
    ` : "";

    // Verifica idoneità fisica
    const eligibility = window.getEligibilityBadge(hike, currentUser);

    // Preferito sentiero
    const isBookmarked = db.bookmarks.some(b => b.userId === currentUser.id && b.hikeId === hike.id);

    // Trova compagno per questo percorso specifico: mostrato solo se anche io l'ho salvato,
    // per scoprire chi altro ha lo stesso interesse su QUESTO sentiero (non un match generico)
    let trailMatchHtml = "";
    if (isBookmarked) {
        const otherBookmarkers = db.bookmarks
            .filter(b => b.hikeId === hike.id && b.userId !== currentUser.id)
            .map(b => db.users.find(u => u.id === b.userId))
            .filter(Boolean);
        if (otherBookmarkers.length > 0) {
            const names = otherBookmarkers.map(u => `<b>${escapeHtml(u.username.split(" ")[0])}</b>`).join(T('common.e') || " e ");
            trailMatchHtml = `<div class="trail-match-line small"><i data-lucide="star"></i> ${T('hikeCard.trailMatch', names, otherBookmarkers.length === 1) || `Anche ${names} ${otherBookmarkers.length === 1 ? "ha" : "hanno"} messo questo sentiero nei preferiti.`}</div>`;
        }
    }

    const card = document.createElement("div");
    card.className = "glass-card hike-card";
    // Punto 81: permette a goToHikeToComplete (app.js) di trovare la scheda giusta partendo
    // da una notifica - MAI un id fisso (questa stessa funzione costruisce piu' copie della
    // stessa escursione su piu' pagine/gruppi), un data-attribute invece si ripete identico
    // su ogni copia senza collidere, esattamente come i data-del-* gia' in uso altrove.
    card.dataset.hikeId = hike.id;

    // Costruzione partecipanti. Cliccabile: apre la pagina profilo di quella persona
    // (funzionalita' chiesta da Denis in sessione il 01/08/2026, non in cose_da_fare.txt).
    const participantsHtml = hike.participants.map(pId => {
        const pUser = db.users.find(u => u.id === pId);
        if (!pUser) return "";
        const isLocalExpert = pUser.localExpert && pUser.localExpert.active;
        const expertTitlePart = isLocalExpert ? ` — ${T('profile.espertoLocale') || 'Esperto locale'}: ${escapeHtml(pUser.localExpert.area)}` : "";
        return `
            <div class="p-avatar ${isLocalExpert ? 'local-expert' : ''}" title="${escapeHtml(pUser.username)} (Rep: ${pUser.reputation}%)${expertTitlePart}" onclick="showUserProfile('${pId}')">
                ${pUser.avatar}
            </div>
        `;
    }).join("");

    // Bottone Iscrizione / Stato partecipazione
    let actionBtnHtml = "";
    const isParticipant = hike.participants.includes(currentUser.id);
    const isPending = hike.pendingApproval.includes(currentUser.id);

    if (isCreatorMe) {
        actionBtnHtml = `<span class="badge badge-accent">${escapeHtml(T('hikeCard.organizzatore') || 'Organizzatore')}</span>`;
    } else if (isParticipant) {
        actionBtnHtml = `<span class="badge badge-green">${escapeHtml(T('hikeCard.partecipiCheck') || 'Partecipi ✓')}</span>`;
    } else if (isPending) {
        actionBtnHtml = `<span class="badge badge-primary">${escapeHtml(T('hikeCard.inAttesaApprovazione') || 'In attesa approvazione...')}</span>`;
    } else {
        actionBtnHtml = `<button class="btn btn-sm btn-primary" onclick="joinHikeRequest('${hike.id}', ${eligibility.eligible})">${escapeHtml(T('hikeCard.iscrivitiBtn') || 'Iscriviti')}</button>`;
    }

    // Pannello Veto del Capogruppo (solo per l'organizzatore). Guardia groupCompletedAt: senza,
    // "Accetta"/"Rifiuta" chiamerebbe una PUT che il server ora rifiuta sempre con 409 su
    // un'escursione chiusa (complete-group azzera comunque pendingApproval alla chiusura, quindi
    // in teoria la lista e' gia' vuota - questa resta una seconda difesa, non superflua).
    let vetoSectionHtml = "";
    if (isCreatorMe && !hike.groupCompletedAt && hike.pendingApproval && hike.pendingApproval.length > 0) {
        const pendingItemsHtml = hike.pendingApproval.map(pendingId => {
            const pendingUser = db.users.find(u => u.id === pendingId);
            if (!pendingUser) return "";
            
            return `
                <div class="veto-request-item">
                    <span>${pendingUser.avatar} <b>${escapeHtml(pendingUser.username)}</b> (Rep: ${pendingUser.reputation}%, ${pendingUser.experienceLevel})</span>
                    <div class="veto-actions">
                        <button class="btn btn-sm btn-success" style="padding:2px 6px;" onclick="approveParticipant('${hike.id}', '${pendingId}')">${escapeHtml(T('hikeCard.accettaBtn') || 'Accetta')}</button>
                        <button class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="declineParticipant('${hike.id}', '${pendingId}')">${escapeHtml(T('hikeCard.rifiutaBtn') || 'Rifiuta')}</button>
                    </div>
                </div>
            `;
        }).join("");

        vetoSectionHtml = `
            <div class="veto-management-box">
                <span class="small font-bold text-warning" style="display:block; margin-bottom:6px;"><i data-lucide="shield-alert"></i> ${escapeHtml(T('hikeCard.richiestePendenti') || 'Richieste Pendenti (Veto):')}</span>
                ${pendingItemsHtml}
            </div>
        `;
    }

    // Punto 64: il creatore conferma IN BLOCCO chi ha partecipato, invece di aspettare che
    // ognuno si auto-dichiari. Confronto per STRINGA di calendario (hike.date e' gia'
    // "YYYY-MM-DD"), non new Date(): stessa cautela gia' presa nel promemoria server-side
    // (lib/hikeStats.js) e nel punto 58, per non segnare un'escursione "passata" dalla
    // mezzanotte del suo stesso giorno, ore prima che cominci davvero. Disponibile dal
    // giorno dell'escursione (non dal giorno dopo: quello e' quando comincia solo il
    // promemoria, per lasciare un margine prima di ricordarlo).
    let completeGroupBtnHtml = "";
    if (isCreatorMe) {
        const oggi = new Date();
        const oggiStr = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
        if (hike.groupCompletedAt) {
            completeGroupBtnHtml = `<span class="badge badge-green">${escapeHtml(T('hikeCard.completataGruppo') || 'Completata in gruppo ✓')}</span>`;
        } else if (hike.date <= oggiStr) {
            completeGroupBtnHtml = `<button class="btn btn-sm btn-success" onclick="openCompleteGroupModal('${hike.id}')">${escapeHtml(T('hikeCard.completaBtn') || 'Completa escursione')}</button>`;
        }
    }

    // Punto 54: solo il creatore vede il tasto "tre puntini" -> Modifica. Riusa il
    // create-hike-modal gia' esistente (openEditHikeModal lo precompila).
    // Punto 76: una volta completata in gruppo il menu sparisce del tutto - l'unica voce
    // che contiene, Modifica, non e' piu' permessa (guardia vera lato server in hikes.js).
    const editMenuHtml = (isCreatorMe && !hike.groupCompletedAt) ? `
        <div class="hike-card-menu">
            <button type="button" class="hike-card-menu-btn" title="${escapeHtml(T('hikeCard.opzioniTitle') || 'Opzioni escursione')}" aria-label="${escapeHtml(T('hikeCard.opzioniTitle') || 'Opzioni escursione')}">
                <i data-lucide="more-vertical"></i>
            </button>
            <div class="hike-card-menu-dropdown hidden">
                <button type="button" class="hike-card-menu-item" onclick="openEditHikeModal('${hike.id}')">
                    <i data-lucide="pencil"></i> ${escapeHtml(T('hikeCard.modificaBtn') || 'Modifica')}
                </button>
            </div>
        </div>
    ` : "";

    // Punto 69: la card nasce chiusa, solo il titolo (Denis: "sulla pagina possiamo
    // leggere piu' titoli di escursioni invece di salire su e giu' per la pagina").
    // Tutto il resto vive in un fratello successivo, aperto/chiuso da window.toggleHikeCard
    // - mai un id fisso, questa stessa funzione costruisce card identiche su piu' gruppi
    // e pagine diverse (Escursioni in tre categorie, Le mie escursioni in quattro).
    card.innerHTML = `
        <div class="hike-card-header" onclick="window.toggleHikeCard(this)">
            <h4 class="hike-card-title">${escapeHtml(hike.title)}</h4>
            <i data-lucide="chevron-down" class="hike-card-toggle-icon"></i>
        </div>
        <div class="hike-card-body hidden">
            <div class="hike-card-topright">
                <span class="badge badge-primary hike-difficulty-badge">${escapeHtml(T('difficulty.' + hike.difficulty) || hike.difficulty)}</span>
                ${editMenuHtml}
            </div>
            <p class="small text-muted" style="margin-bottom: 8px;">${escapeHtml(T('hikeCard.organizzatoDa') || 'Organizzato da:')} <b class="user-link" onclick="showUserProfile('${hike.creatorId}')">${escapeHtml(creatorName)}</b>${creatorBadgeHtml}</p>

            <p class="small text-secondary" style="line-height:1.4; height: 60px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(hike.description)}</p>

            <div class="hike-meta-row">
                <div class="hike-meta-item">
                    <span>${escapeHtml(T('hikeCard.dislivelloDLabel') || 'Dislivello D+')}</span>
                    <strong>${hike.elevationGain}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>${escapeHtml(T('hikeCard.quotaMaxLabel') || 'Quota Max')}</span>
                    <strong>${hike.maxAltitude}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>${escapeHtml(T('hikeCard.distanzaLabel') || 'Distanza')}</span>
                    <strong>${hike.distanceKm} km</strong>
                </div>
            </div>

            ${tempoHtml}
            ${tempoRealeHtml}

            <div class="tag-list">
                ${hike.tribeTags.map(tag => `<span class="tag">${escapeHtml(T('tribeTag.' + tag) || tag)}</span>`).join("")}
                <span class="badge ${eligibility.class}">${eligibility.text}</span>
            </div>

            <div class="participants-section">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="small text-muted">${escapeHtml(T('hikeCard.partecipantiLabel', hike.participants.length) || `Partecipanti (${hike.participants.length}):`)}</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="loadHikeOnMapDirectly('${hike.id}')" title="${escapeHtml(T('hikeCard.vediMappaTitle') || 'Vedi sentiero sulla mappa')}">${escapeHtml(T('hikeCard.mappaBtn') || 'Mappa')}</button>
                        <button class="btn btn-sm btn-secondary bookmark-toggle-btn ${isBookmarked ? 'is-bookmarked' : ''}" style="padding:2px 6px;" onclick="toggleBookmark('${hike.id}')" title="${isBookmarked ? escapeHtml(T('hikeCard.rimuoviPreferitiTitle') || 'Rimuovi dai preferiti') : escapeHtml(T('hikeCard.aggiungiPreferitiTitle') || 'Aggiungi ai preferiti')}">
                            🐐
                        </button>
                        ${isParticipant ? `<button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="showHikePage('${hike.id}')" title="${escapeHtml(T('hikeCard.chatTitle') || 'Chat tra i partecipanti')}">${escapeHtml(T('hikeCard.chatBtn') || 'Chat')}</button>` : ""}
                        ${completionToolsHtml}
                    </div>
                </div>
                <div class="participants-avatars">${participantsHtml}</div>
            </div>

            ${trailMatchHtml}
            ${vetoSectionHtml}

            <div style="display:flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 12px;">
                ${completeGroupBtnHtml}
                ${actionBtnHtml}
            </div>
        </div>
    `;
    return card;
}

// Punto 69: toggle sul fratello successivo dell'header cliccato, mai un id - vedi
// commento sopra buildHikeCard sul perche' qui un id fisso romperebbe le altre pagine.
window.toggleHikeCard = function(headerEl) {
    const body = headerEl.nextElementSibling;
    if (!body) return;
    body.classList.toggle('hidden');
    headerEl.classList.toggle('expanded');
};

// Punto 81: cliccare la notifica "non hai ancora completato" porta qui invece di limitarsi
// a segnarla come letta. Il tasto "Completa escursione" vive solo su "Le mie escursioni" ->
// "Organizzate da me" (isCreatorMe, buildHikeCard sopra) - e il promemoria stesso lo manda
// SOLO al creatore (ensureCompletionReminders, lib/hikeStats.js), quindi la scheda giusta
// esiste sempre li'. renderMyHikes() legge gia' window.CamoscioState (nessun fetch), la
// scheda e' gia' nel DOM appena si naviga: nessuna attesa a tempo fisso.
// Scoped a #my-hikes-created, non a document: la stessa escursione puo' comparire anche in
// "Escursioni" (buildHikeCard costruisce piu' copie identiche su piu' pagine/gruppi) - senza
// questo scope si rischierebbe di espandere/scrollare la copia sbagliata.
window.goToHikeToComplete = function(hikeId) {
    // Il pannello notifiche resta aperto altrimenti: e' dentro di lui che si e' cliccato,
    // quindi il chiudi-al-click-fuori di setupNotificationBell (app.js) non scatta da solo.
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    if (window.navigateTo) window.navigateTo('my-hikes');

    const card = document.querySelector(`#my-hikes-created .hike-card[data-hike-id="${hikeId}"]`);
    if (!card) return;

    const header = card.querySelector('.hike-card-header');
    const body = card.querySelector('.hike-card-body');
    if (header && body && body.classList.contains('hidden')) {
        window.toggleHikeCard(header);
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// Richiesta iscrizione con avviso se inesperto
window.joinHikeRequest = async function(hikeId, isEligible) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    if (!isEligible) {
        const confirmJoin = await window.showConfirmModal(T('hikeConfirm.avvisoIdoneita') || "⚠️ ATTENZIONE: Questa escursione richiede un passo superiore al tuo attuale storico rilevato.\n\nVuoi comunque inviare una richiesta al capogruppo e discuterne in chat?");
        if (!confirmJoin) return;
    }

    // Se l'approvazione è automatica va direttamente in partecipanti, altrimenti va in pending (Veto)
    if (hike.manualApproval) {
        if (!hike.pendingApproval.includes(db.currentUser.id)) {
            hike.pendingApproval.push(db.currentUser.id);
        }
    } else {
        if (!hike.participants.includes(db.currentUser.id)) {
            hike.participants.push(db.currentUser.id);
        }
    }

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participants: hike.participants,
                pendingApproval: hike.pendingApproval
            })
        });

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nell'iscrizione:", e);
    }
};

// Notifica l'esito (accettato/rifiutato) di una richiesta di iscrizione
async function notifyParticipantDecision(userId, text) {
    try {
        await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, text })
        });
    } catch (e) {
        console.error("Errore nell'invio della notifica:", e);
    }
}

// Accetta partecipante (Veto Capogruppo)
window.approveParticipant = async function(hikeId, userId) {
    // Stato riletto PRIMA di calcolare qualunque cosa, stessa regola di confermaInvitoSquadra:
    // pendingApproval ora ha piu' di uno scrittore (richieste dirette E invito squadra), uno
    // stato vecchio in pagina puo' far sparire in silenzio una terza richiesta arrivata nel
    // frattempo (la PUT manda l'elenco intero, non un diff).
    await refreshState();
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    const pendingApproval = hike.pendingApproval.filter(id => id !== userId);
    const participants = hike.participants.includes(userId)
        ? hike.participants
        : hike.participants.concat(userId);

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participants, pendingApproval })
        });

        // Testo neutro apposta: da quando l'aggiunta a pendingApproval puo' arrivare anche da un
        // invito squadra (non solo da una richiesta propria), "la tua richiesta" sarebbe falso
        // per chi non ha mai chiesto niente.
        await notifyParticipantDecision(userId, `Sei tra i partecipanti di "${hike.title}".`);

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nell'approvazione:", e);
    }
};

// Rifiuta partecipante (Veto Capogruppo)
window.declineParticipant = async function(hikeId, userId) {
    // Stessa regola di approveParticipant qui sopra: stato riletto prima di calcolare.
    await refreshState();
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    const pendingApproval = hike.pendingApproval.filter(id => id !== userId);

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingApproval })
        });

        // Stesso motivo del testo neutro in approveParticipant qui sopra.
        await notifyParticipantDecision(userId, `Non sei stato inserito tra i partecipanti di "${hike.title}".`);

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nel rifiutare il partecipante:", e);
    }
};

// Carica escursione ed apre la mappa
window.loadHikeOnMapDirectly = function(hikeId) {
    const btnMapNav = document.getElementById("btn-nav-map");
    if (btnMapNav) {
        btnMapNav.click(); // Naviga
        setTimeout(() => {
            window.loadActiveHikeOnMap(hikeId);
        }, 300);
    }
};

// Aggiunge o rimuove sentiero dai preferiti (Rileva chi ha interesse comune).
// Punto 80/G: prima chiamava sempre POST, che sull'account gia' salvato non faceva nulla
// (idempotente lato server) - il tasto "Rimuovi dai preferiti" prometteva una cosa che non
// faceva. Ora sceglie POST/DELETE guardando lo stato attuale, come tutti gli altri tasti a
// due stati del progetto (es. il like delle recensioni).
window.toggleBookmark = async function(hikeId) {
    const db = window.CamoscioState;
    const isBookmarked = db.bookmarks.some(b => b.userId === db.currentUser.id && b.hikeId === hikeId);

    try {
        if (isBookmarked) {
            await fetch(`/api/bookmarks/${hikeId}`, { method: 'DELETE' });
        } else {
            await fetch('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hikeId })
            });
        }

        await refreshState();
        renderHikesList();
        renderSocialModule(); // Aggiorna match sentieri
    } catch(e) {
        console.error("Errore nel salvare il preferito:", e);
    }
};

// Punto 80/A: aggiunge (o corregge) il tempo reale di un'escursione gia' completata,
// caricando un .gpx dopo il fatto - "i numeri reali sostituiscono quelli scritti a mano",
// stessa regola gia' applicata al punto 67. L'input file e' creato al volo, mai presente nel
// markup della card (buildHikeCard): la stessa escursione puo' comparire in piu' liste
// contemporaneamente (Escursioni "Completate" e Le mie escursioni "Gia' fatte"), quindi un
// id fisso condiviso scriverebbe nel posto sbagliato - stessa cautela gia' presa per
// chatpanel.js e le schede di buildHikeCard (leggimi.txt).
window.uploadCompletionGpx = function(completionId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx,application/gpx+xml';
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        // Stesso tetto di storico.js (10 MB): dire subito cosa non va e' meglio che far
        // aspettare un invio destinato a fallire.
        if (file.size > 10 * 1024 * 1024) {
            if (window.showToast) window.showToast(T('hikeToast.filePesa', (file.size / 1024 / 1024).toFixed(1)) || `Il file pesa ${(file.size / 1024 / 1024).toFixed(1)} MB, oltre il limite di 10 MB.`, 'error');
            return;
        }

        let gpxText;
        try {
            gpxText = await file.text();
        } catch (e) {
            if (window.showToast) window.showToast(T('hikeToast.fileNonLetto') || 'Non è stato possibile leggere il file.', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/completions/${completionId}/gpx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gpxText })
            });
            const dati = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (window.showToast) window.showToast(dati.error || T('hikeToast.erroreAggiuntaFile') || 'Non è stato possibile aggiungere il file.', 'error');
                return;
            }
            if (window.showToast) {
                const avviso = (dati.avvisi || []).length ? ` (${dati.avvisi[0]})` : '';
                window.showToast(`${T('hikeToast.tempoRealeAggiunto') || 'Tempo reale aggiunto'}${avviso}.`, 'success');
            }
            await refreshState();
            renderHikesList();
        } catch (e) {
            console.error('Errore nel caricare il gpx sul completamento:', e);
            if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
        }
    });
    input.click();
};

// Punto 80/A: cancella un'escursione dalle "gia' fatte" - stesso schema gia' provato per
// cancellaUscita in storico.js (conferma con showConfirmModal, bottone rosso "Elimina"),
// stessa onesta': dice cosa cambia davvero prima di farlo sparire, invece di un generico
// "sei sicuro?".
// Riceve hikeId, MAI il titolo per esteso: un titolo puo' contenere un apostrofo (es.
// "Gran Sasso d'Italia") che romperebbe la stringa JS dentro l'onclick della card - bug
// vero, trovato provando dal vivo. Il titolo si recupera qui da window.CamoscioState,
// stesso principio di ogni altro onclick del progetto (mai testo libero, solo id).
window.deleteCompletion = async function(completionId, hikeId) {
    const hike = (window.CamoscioState.hikes || []).find(h => h.id === hikeId);
    const hikeTitle = hike ? hike.title : (T('hikeConfirm.questaEscursione') || 'questa escursione');
    const righe = [
        T('hikeConfirm.cancellaTitolo', hikeTitle) || `Cancellare "${hikeTitle}" dalle escursioni fatte?`,
        '',
        T('hikeConfirm.cancellaPassoRicalcolato') || 'Il tuo passo personale verrà ricalcolato senza questa escursione.',
        T('hikeConfirm.cancellaNoRecensioni') || 'Non potrai più scrivere né ricevere recensioni per questa escursione.',
        '',
        T('hikeConfirm.cancellaBadgeRestano') || 'I badge che hai conquistato restano nel passaporto.',
        // Punto 80/B: se questa escursione aveva anche un tracciamento dal vivo collegato
        // (public/js/tracking.js, completeLinkedHike), quella traccia GPS non viene
        // toccata da questo cestino - resterebbe visibile come voce a parte in questa
        // stessa lista. Riga sempre presente (non si sa qui se il caso ricorre davvero,
        // controllarlo servirebbe una fetch in piu' per un'informazione che non cambia la
        // decisione di procedere) invece di lasciarlo scoprire come sorpresa dopo il click.
        T('hikeConfirm.cancellaTracciaSeparata') || 'Se avevi anche registrato il percorso col GPS, quella traccia resta separata nello storico.'
    ];
    const procedi = window.showConfirmModal
        ? await window.showConfirmModal(righe.join('\n'), T('common.elimina') || 'Elimina', { cancelLabel: T('common.cancella') || 'Cancella', danger: true })
        : true;
    if (!procedi) return;

    try {
        const res = await fetch(`/api/completions/${completionId}`, { method: 'DELETE' });
        const dati = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (window.showToast) window.showToast(dati.error || T('hikeToast.erroreCancellaEscursione') || 'Non è stato possibile cancellare questa escursione.', 'error');
            return;
        }
        if (window.showToast) window.showToast(T('hikeToast.escursioneCancellata') || 'Escursione cancellata dalle "già fatte".', 'success');
        await refreshState();
        renderHikesList();
    } catch (e) {
        console.error('Errore cancellazione completamento:', e);
        if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
    }
};

// --- CREAZIONE ESCURSIONE ---

async function submitCreateHike() {
    const db = window.CamoscioState;
    const title = document.getElementById("hike-title").value;
    const description = document.getElementById("hike-desc").value;
    const difficulty = document.getElementById("hike-diff").value;
    const date = document.getElementById("hike-date").value;

    // Punto 43: quota/dislivello/distanza a mano (come sempre), oppure calcolate dal
    // server da un progetto o da una traccia - in quei due casi i numeri qui sotto non
    // servono piu' e non si mandano: routeSource dice al server cosa calcolare.
    const fonte = document.getElementById("hike-route-source").value;
    let maxAltitude, elevationGain, distanceKm, routeSource;
    if (fonte === 'draft') {
        const draftId = document.getElementById("hike-route-draft-select").value;
        if (!draftId) {
            window.showToast(T('hikeToast.scegliProgetto') || "Scegli un progetto dall'elenco.", "error");
            return;
        }
        routeSource = { kind: 'draft', draftId };
        // Punto 93: se il riquadro "scrivi tu quota e dislivello" e' visibile (un tentativo
        // precedente e' finito in 422, la fonte delle quote non ha risposto), si rimandano
        // anche quei due numeri insieme al progetto - non lo si manda mai se il riquadro
        // e' nascosto, altrimenti numeri di un tentativo passato viaggerebbero anche su un
        // calcolo che stavolta riesce da solo.
        const boxQuoteManuali = document.getElementById('hike-route-quote-manuali');
        if (boxQuoteManuali && !boxQuoteManuali.classList.contains('hidden')) {
            routeSource.quoteManuali = {
                maxAltitude: parseInt(document.getElementById('hike-quota-manuale').value),
                elevationGain: parseInt(document.getElementById('hike-dislivello-manuale').value)
            };
        }
    } else if (fonte === 'gpx') {
        const file = document.getElementById("hike-route-gpx-file").files[0];
        if (!file) {
            window.showToast(T('hikeToast.scegliGpx') || "Scegli un file .gpx da importare.", "error");
            return;
        }
        try {
            routeSource = { kind: 'gpx', gpxText: await file.text() };
        } catch (e) {
            window.showToast(T('hikeToast.fileNonLetto') || "Non è stato possibile leggere il file.", "error");
            return;
        }
    } else {
        routeSource = null;
        maxAltitude = parseInt(document.getElementById("hike-alt").value);
        elevationGain = parseInt(document.getElementById("hike-elev").value);
        distanceKm = parseFloat(document.getElementById("hike-dist").value);
    }

    const lat = parseFloat(document.getElementById("hike-trailhead-lat").value);
    const lng = parseFloat(document.getElementById("hike-trailhead-lng").value);
    const name = document.getElementById("hike-trailhead-name").value;
    const manualApproval = document.getElementById("hike-approval").value === "true";

    // Punto 8: le coordinate non si scrivono piu' a mano, arrivano dalla ricerca per nome
    // o dalla scelta sulla mappa. Se sono vuote vuol dire che quel passaggio e' stato
    // saltato: i campi sono nascosti, quindi il browser non puo' segnalarlo da solo con
    // il classico "campo obbligatorio" (su un campo invisibile non funziona).
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        window.showToast(T('hikeToast.scegliRitrovo') || "Scegli prima il punto di ritrovo: cercalo per nome oppure indicalo sulla mappa.", "error");
        const ricerca = document.getElementById("hike-trailhead-search");
        if (ricerca) ricerca.focus();
        return;
    }

    // Vincolo hard: il ritrovo deve trovarsi in una delle 4 regioni reali (Fase G - prima
    // era solo un rettangolo approssimativo). Ricontrollato comunque lato server in
    // routes/hikes.js: questo e' solo per un messaggio d'errore immediato all'utente.
    if (window.CamoscioIsInRegion && !window.CamoscioIsInRegion(lat, lng)) {
        window.showToast(T('hikeToast.fuoriRegione') || "Il punto di ritrovo inserito è fuori dall'ambito geografico attuale della demo (Lazio, Molise, Abruzzo, Marche). Inserisci coordinate all'interno di queste regioni.", "error");
        return;
    }

    // Raccoglie i tag selezionati
    const tags = [];
    document.querySelectorAll("input[name='hike-tags']:checked").forEach(cb => {
        tags.push(cb.value);
    });

    const payload = {
        title,
        description,
        difficulty,
        date,
        routeSource,
        trailhead: { lat, lng, name },
        tribeTags: tags,
        manualApproval
    };
    // Mandati SOLO in modalita' manuale: con un progetto o una traccia li calcola il
    // server, e mandare qui dei numeri vecchi (magari ancora quelli di un percorso
    // collegato in precedenza) sarebbe fuorviante piu' che utile.
    if (fonte === 'manuale') {
        payload.maxAltitude = maxAltitude;
        payload.elevationGain = elevationGain;
        payload.distanceKm = distanceKm;
    }
    // Punto 54: creatorId ha senso solo alla creazione - in modifica lo decide la
    // sessione lato server (hike.creatorId non cambia mai), non un campo del payload.
    if (!editingHikeId) payload.creatorId = db.currentUser.id;

    const inModifica = !!editingHikeId;

    try {
        const response = await fetch(inModifica ? `/api/hikes/${editingHikeId}` : '/api/hikes', {
            method: inModifica ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            // Punto 93: se avevamo mandato dei numeri scritti a mano (routeSource.quoteManuali)
            // e la fonte nel frattempo e' tornata a rispondere, il server ha calcolato lui i
            // due numeri e li ha preferiti ai nostri - l'escursione salvata NON ha
            // routeSource.dislivelloManuale in quel caso. Non e' un errore, ma l'utente ha
            // appena scritto due numeri che non sono finiti sull'escursione: va detto,
            // altrimenti sembra solo un salvataggio riuscito uguale a tutti gli altri.
            const avevamoMandatoQuoteManuali = !!(routeSource && routeSource.quoteManuali);
            const hikeSalvata = await response.json().catch(() => null);

            document.getElementById("create-hike-modal").classList.add("hidden");
            document.getElementById("create-hike-form").reset();
            if (window.resetTrailheadPicker) window.resetTrailheadPicker();
            resetHikeRouteSourcePicker();
            setHikeModalMode('create'); // torna sempre alla modalita' di default dopo l'invio

            await refreshState();
            renderHikesList(); // ridisegna anche "Le mie escursioni", vedi commento li'
            if (window.populateHikeSelects) window.populateHikeSelects();

            if (avevamoMandatoQuoteManuali && hikeSalvata && hikeSalvata.routeSource && !hikeSalvata.routeSource.dislivelloManuale) {
                window.showToast(
                    T('hikeToast.quoteRicalcolate', hikeSalvata.maxAltitude, hikeSalvata.elevationGain) ||
                    `La fonte delle quote ha risposto: quota massima e dislivello sono stati calcolati dal percorso (${hikeSalvata.maxAltitude} m, ${hikeSalvata.elevationGain} m D+), non quelli che avevi scritto.`,
                    "success"
                );
            } else {
                window.showToast(inModifica ? (T('hikeToast.escursioneAggiornata') || "Escursione aggiornata!") : (T('hikeToast.escursionePubblicata') || "Escursione pubblicata!"), "success");
            }
        } else {
            // Prima non si diceva NIENTE quando il server rifiutava: la finestra restava
            // aperta senza spiegazioni e sembrava che il pulsante non funzionasse. Il caso
            // piu' probabile e' proprio il rifiuto per ritrovo fuori dalle 4 regioni.
            const body = await response.json().catch(() => ({}));

            // Punto 93: la fonte delle quote non ha risposto (o il percorso e' troppo
            // lungo) - non un errore da mostrare e basta, un'informazione mancante da
            // chiedere. Il modulo resta aperto, il progetto resta selezionato.
            if (response.status === 422 && body.richiedeQuote) {
                mostraQuoteManuali(body);
                return;
            }

            const messaggioDefault = inModifica
                ? (T('hikeToast.erroreSalvaModifiche') || "Non è stato possibile salvare le modifiche. Controlla i dati inseriti.")
                : (T('hikeToast.errorePubblica') || "Non è stato possibile pubblicare l'escursione. Controlla i dati inseriti.");
            window.showToast(body.error || messaggioDefault, "error");
        }
    } catch(e) {
        console.error("Errore creazione escursione:", e);
        window.showToast(inModifica ? (T('hikeToast.erroreReteModifiche') || "Errore di rete: le modifiche non sono state salvate.") : (T('hikeToast.erroreRetePubblica') || "Errore di rete: l'escursione non è stata pubblicata."), "error");
    }
}

// --- PUNTO 64: COMPLETAMENTO DI GRUPPO DAL CREATORE ---
//
// Il tasto "Completa escursione" (buildHikeCard) apre questo modale: una checklist dei
// partecipanti gia' iscritti (pre-spuntati, si toglie la spunta a chi non si e' presentato)
// piu' una ricerca per aggiungere chi era presente ma non era fra gli iscritti originali
// (es. contattato fuori dal sito). Confermando, POST /api/hikes/:id/complete-group
// sovrascrive hike.participants con la lista finale e crea i Completion mancanti.

let completeGroupHikeId = null;
// Persone aggiunte via ricerca in QUESTA apertura del modale, non ancora fra
// hike.participants: tenute separate per sapere chi escludere dai risultati di ricerca
// (non ha senso ritrovare fra i risultati chi si e' appena aggiunto) e per ricostruire la
// checklist dopo ogni aggiunta senza perdere le spunte tolte a mano.
let completeGroupExtraIds = [];

// Stessa soglia di public/js/peoplesearch.js (4 lettere, "Dani" -> "DaniWoll", confermata
// con Denis) - ripetuta qui invece di letta da la' perche' questo modale non dipende
// dall'ordine di caricamento degli script: e' lo stesso numero per lo stesso motivo, non
// un valore condiviso da tenere sincronizzato.
const SOGLIA_RICERCA_COMPLETAMENTO = 4;

function renderCompleteGroupChecklist() {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === completeGroupHikeId);
    const container = document.getElementById("complete-group-checklist");
    if (!hike || !container) return;

    const idsDaMostrare = [...new Set([...(hike.participants || []), ...completeGroupExtraIds])];
    container.innerHTML = idsDaMostrare.map(id => {
        const u = db.users.find(u => u.id === id);
        if (!u) return "";
        return `
            <label>
                <input type="checkbox" name="complete-group-member" value="${id}" checked>
                <span>${u.avatar} ${escapeHtml(u.username)}</span>
            </label>
        `;
    }).join("");
}

function renderCompleteGroupSearch() {
    const input = document.getElementById("complete-group-search-input");
    const results = document.getElementById("complete-group-search-results");
    const db = window.CamoscioState;
    if (!input || !results) return;

    const query = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (query.length < SOGLIA_RICERCA_COMPLETAMENTO) return;

    const hike = db.hikes.find(h => h.id === completeGroupHikeId);
    if (!hike) return;
    const giaPresenti = new Set([...(hike.participants || []), ...completeGroupExtraIds]);

    // Solo su username, stesso motivo di peoplesearch.js: nome/cognome veri non arrivano
    // mai al browser per un altro utente.
    const trovati = db.users.filter(u =>
        !giaPresenti.has(u.id) && (u.username || "").toLowerCase().includes(query)
    );

    if (!trovati.length) {
        results.innerHTML = `<p class="small text-muted">${escapeHtml(T('peopleSearch.nessunRisultato') || 'Nessuna persona trovata.')}</p>`;
        return;
    }

    trovati.forEach(u => {
        const row = document.createElement("div");
        row.className = "carpool-group-item";
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div class="p-avatar">${u.avatar}</div>
                <b>${escapeHtml(u.username)}</b>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addToCompleteGroup('${u.id}')">${escapeHtml(T('completeGroupModal.aggiungiBtn') || 'Aggiungi')}</button>
        `;
        results.appendChild(row);
    });
}

// Aggiunta via ricerca, non ancora salvata: entra nella checklist gia' spuntata, come chi
// era gia' iscritto. Il salvataggio vero avviene solo al tasto "Conferma completamento".
// SI ACCODA UNA RIGA SOLA, non si richiama renderCompleteGroupChecklist(): quella
// ricostruisce l'intera lista da capo con ogni casella di nuovo spuntata, e cancellerebbe
// silenziosamente la spunta appena tolta a mano a qualcun altro (trovato provando dal vivo).
window.addToCompleteGroup = function(userId) {
    if (completeGroupExtraIds.includes(userId)) return;
    completeGroupExtraIds.push(userId);

    const db = window.CamoscioState;
    const u = db.users.find(u => u.id === userId);
    const container = document.getElementById("complete-group-checklist");
    if (u && container) {
        const label = document.createElement("label");
        label.innerHTML = `
            <input type="checkbox" name="complete-group-member" value="${userId}" checked>
            <span>${u.avatar} ${escapeHtml(u.username)}</span>
        `;
        container.appendChild(label);
    }

    document.getElementById("complete-group-search-input").value = "";
    document.getElementById("complete-group-search-results").innerHTML = "";
    if (window.lucide) window.lucide.createIcons();
};

window.openCompleteGroupModal = function(hikeId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    completeGroupHikeId = hikeId;
    completeGroupExtraIds = [];

    document.getElementById("complete-group-hike-title").textContent = hike.title;
    document.getElementById("complete-group-search-input").value = "";
    document.getElementById("complete-group-search-results").innerHTML = "";
    document.getElementById("complete-group-gpx-file").value = "";
    renderCompleteGroupChecklist();

    document.getElementById("complete-group-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
};

function closeCompleteGroupModal() {
    document.getElementById("complete-group-modal").classList.add("hidden");
    completeGroupHikeId = null;
    completeGroupExtraIds = [];
}

async function submitCompleteGroup() {
    if (!completeGroupHikeId) return;

    const confirmedUserIds = Array.from(
        document.querySelectorAll('#complete-group-checklist input[name="complete-group-member"]:checked')
    ).map(cb => cb.value);

    if (!confirmedUserIds.length) {
        window.showToast(T('completeGroupModal.confermaAlmeno') || "Conferma almeno una persona presente.", "error");
        return;
    }

    // Punto 67: facoltativo. Letto qui e non lasciato al server come multipart per restare
    // coerenti con come il resto del sito manda gia' un .gpx (routeSource alla creazione,
    // punto 43): testo semplice dentro lo stesso JSON, nessuna libreria di upload in piu'.
    let gpxText;
    const gpxFile = document.getElementById("complete-group-gpx-file").files[0];
    if (gpxFile) {
        try {
            gpxText = await gpxFile.text();
        } catch (e) {
            window.showToast(T('completeGroupModal.gpxNonLetto') || "Non è stato possibile leggere il file .gpx.", "error");
            return;
        }
    }

    try {
        const response = await fetch(`/api/hikes/${completeGroupHikeId}/complete-group`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmedUserIds, gpxText })
        });

        if (response.ok) {
            closeCompleteGroupModal();
            await refreshState();
            renderHikesList(); // ridisegna anche "Le mie escursioni", vedi commento su renderHikesList
            window.showToast(T('completeGroupModal.completataSuccesso') || "Escursione completata per il gruppo!", "success");
        } else {
            const body = await response.json().catch(() => ({}));
            window.showToast(body.error || (T('completeGroupModal.erroreCompletamento') || "Non è stato possibile completare il gruppo."), "error");
        }
    } catch (e) {
        console.error("Errore completamento di gruppo:", e);
        window.showToast(T('completeGroupModal.erroreReteCompletamento') || "Errore di rete: il completamento non è stato salvato.", "error");
    }
}

// --- OBIETTIVI COMUNI ---

async function saveTrainingGoal(goal) {
    const db = window.CamoscioState;
    const usr = db.currentUser;
    usr.trainingGoal = goal;

    try {
        await fetch(`/api/users/${usr.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainingGoal: goal })
        });

        await refreshState();
        renderSocialModule();
    } catch (e) {
        console.error("Errore salvataggio obiettivo:", e);
    }
}

function renderGoalMatches(currentUser) {
    const container = document.getElementById("goal-matches-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (!currentUser.trainingGoal) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">${escapeHtml(T('social.enterGoalHint') || 'Inserisci un obiettivo per trovare compagni di allenamento.')}</div>`;
        return;
    }

    const matches = db.users.filter(u => 
        u.id !== currentUser.id && 
        u.trainingGoal && 
        u.trainingGoal.toLowerCase().trim() === currentUser.trainingGoal.toLowerCase().trim()
    );

    if (matches.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">${escapeHtml(T('social.noSameGoal') || 'Nessun escursionista ha lo stesso obiettivo al momento.')}</div>`;
        return;
    }

    matches.forEach(m => {
        const item = document.createElement("div");
        item.className = "goal-match-item";
        item.innerHTML = `
            <span>${m.avatar} <b>${escapeHtml(m.username)}</b> ${escapeHtml(T('social.trainsFor') || 'si allena per:')} <strong style="color:var(--accent-orange)">${escapeHtml(m.trainingGoal)}</strong></span>
            <button class="btn btn-sm btn-secondary" onclick="inviteToSquadDirectly('${m.id}')">${escapeHtml(T('social.inviteToSquad') || 'Invita in Squadra')}</button>
        `;
        container.appendChild(item);
    });
}

window.inviteToSquadDirectly = function(peerId) {
    const btnOpenSquad = document.getElementById("btn-open-create-squad");
    if (btnOpenSquad) {
        btnOpenSquad.click();
        // Spunta l'utente nel checkbox della creazione
        setTimeout(() => {
            const cb = document.querySelector(`input[name='squad-member'][value='${peerId}']`);
            if (cb) cb.checked = true;
        }, 100);
    }
};

// --- SQUADRE RICORRENTI ---

function renderSquadsList() {
    const container = document.getElementById("squads-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const mySquads = db.squads.filter(s => s.creatorId === currentUser.id || s.members.includes(currentUser.id));

    if (mySquads.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">${escapeHtml(T('social.noFixedSquad') || 'Nessuna squadra fissa creata.')}</div>`;
        return;
    }

    mySquads.forEach(squad => {
        const item = document.createElement("div");
        item.className = "squad-item";

        const membersAvatars = squad.members.map(mId => {
            const mem = db.users.find(u => u.id === mId);
            return mem ? mem.avatar : "👤";
        }).join(" ");

        // Punto 98/A: "Invita a Gita" spetta a QUALUNQUE membro della squadra, non solo a chi
        // l'ha creata - il permesso vero lo decide confermaInvitoSquadra guardando il creatore
        // dell'ESCURSIONE (aggiunta diretta se organizzo io, proposta in pendingApproval se
        // partecipo e basta), non il creatore della squadra. Prima chi era stato solo accettato
        // come membro non vedeva il bottone su nessuna escursione, nemmeno le proprie.
        let actionBtn = `<button class="btn btn-sm btn-success" onclick="inviteSquadToHike('${squad.id}')">${escapeHtml(T('social.inviteToHike') || 'Invita a Gita')}</button>`;
        if (squad.creatorId !== currentUser.id) {
            actionBtn += ` <span class="badge badge-primary">${escapeHtml(T('social.memberBadge') || 'Membro')}</span>`;
        }

        item.innerHTML = `
            <div class="squad-item-open" onclick="showSquadPage('${squad.id}')">
                <h5>👥 ${escapeHtml(squad.name)}</h5>
                <div class="squad-members-row">${membersAvatars}</div>
            </div>
            <div>
                ${actionBtn}
            </div>
        `;
        container.appendChild(item);
    });
}

// Punto 75: senza questa lista non c'era alcun modo di TROVARE una squadra a cui non si
// appartiene ancora (renderSquadsList qui sopra mostra solo le proprie) - GET /api/squads
// porta gia' tutte le squadre al client, qui si mostrano solo quelle in cui non si e' ne'
// creatore ne' membro. Il tasto cambia in base allo stato della propria richiesta.
function renderOtherSquadsList() {
    const container = document.getElementById("other-squads-list");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const altreSquadre = db.squads.filter(s =>
        s.creatorId !== currentUser.id && !s.members.includes(currentUser.id)
    );

    if (altreSquadre.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">${escapeHtml(T('social.noOtherSquads') || "Nessun'altra squadra per ora.")}</div>`;
        return;
    }

    altreSquadre.forEach(squad => {
        const item = document.createElement("div");
        item.className = "squad-item";

        const membersAvatars = squad.members.map(mId => {
            const mem = db.users.find(u => u.id === mId);
            return mem ? mem.avatar : "👤";
        }).join(" ");

        const giaRichiesta = (squad.pendingRequests || []).includes(currentUser.id);
        const actionBtn = giaRichiesta
            ? `<span class="badge badge-primary">${escapeHtml(T('social.requestSent') || 'Richiesta inviata')}</span>`
            : `<button class="btn btn-sm btn-secondary" onclick="requestJoinSquad('${squad.id}')">${escapeHtml(T('squadPage.richiediPartecipazione') || 'Richiesta Partecipazione')}</button>`;

        item.innerHTML = `
            <div class="squad-item-open" onclick="showSquadPage('${squad.id}')">
                <h5>👥 ${escapeHtml(squad.name)}</h5>
                <div class="squad-members-row">${membersAvatars}</div>
            </div>
            <div>
                ${actionBtn}
            </div>
        `;
        container.appendChild(item);
    });
}

// Punto 75: usata sia dalla lista "Altre Squadre" sia dal tasto sulla pagina della singola
// squadra (squadpage.js) - stessa richiesta, due punti di partenza diversi.
window.requestJoinSquad = async function(squadId) {
    try {
        const response = await fetch(`/api/squads/${squadId}/request-join`, { method: 'POST' });
        if (response.ok) {
            const squadAggiornata = await response.json();
            if (window.updateLocalSquad) window.updateLocalSquad(squadAggiornata);
            renderOtherSquadsList();
            if (window.refreshSquadHeaderAndMembers) window.refreshSquadHeaderAndMembers(squadId);
            window.showToast(T('squadPage.richiestaInviata') || "Richiesta inviata: aspetta la conferma di un amministratore.", "success");
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || T('social.errRequestSend') || "Impossibile inviare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore richiesta di partecipazione squadra:", e);
        window.showToast(T('social.errRequestSend') || "Impossibile inviare la richiesta.", "error");
    }
};

// Punto 75: ricerca invece di spuntare *tutti* gli iscritti al sito (problema di scala,
// segnalato apposta in anticipo da Denis) - stesso schema gia' scritto per "Completa
// escursione" (renderCompleteGroupSearch/addToCompleteGroup), stessa soglia di ricerca.
let squadCreateMemberIds = [];

function resetSquadCreateForm() {
    squadCreateMemberIds = [];
    const searchInput = document.getElementById("squad-create-search-input");
    if (searchInput) searchInput.value = "";
    const results = document.getElementById("squad-create-search-results");
    if (results) results.innerHTML = "";
    renderSquadCreateSelectedMembers();
}

function renderSquadCreateSelectedMembers() {
    const container = document.getElementById("squad-create-selected-members");
    if (!container) return;
    const db = window.CamoscioState;
    const righe = squadCreateMemberIds.map(id => {
        const u = db.users.find(u => u.id === id);
        if (!u) return "";
        return `
            <label>
                <span>${u.avatar} ${escapeHtml(u.username)}</span>
                <button type="button" class="btn-inline-remove" onclick="removeFromSquadCreate('${id}')" title="${escapeHtml(T('social.removeFromSquadTitle') || 'Togli dalla squadra')}">&times;</button>
            </label>
        `;
    }).join("");
    container.innerHTML = righe || `<p class="small text-muted">${escapeHtml(T('social.noMembersYet') || 'Nessun membro aggiunto ancora (oltre a te).')}</p>`;
}

window.removeFromSquadCreate = function(userId) {
    squadCreateMemberIds = squadCreateMemberIds.filter(id => id !== userId);
    renderSquadCreateSelectedMembers();
};

// Aggiunta via ricerca, non ancora salvata - stesso principio di addToCompleteGroup: si
// accoda un id solo, il salvataggio vero avviene al tasto "Crea Squadra".
window.addToSquadCreate = function(userId) {
    if (squadCreateMemberIds.includes(userId)) return;
    squadCreateMemberIds.push(userId);
    document.getElementById("squad-create-search-input").value = "";
    document.getElementById("squad-create-search-results").innerHTML = "";
    renderSquadCreateSelectedMembers();
};

function renderSquadCreateSearch() {
    const input = document.getElementById("squad-create-search-input");
    const results = document.getElementById("squad-create-search-results");
    const db = window.CamoscioState;
    if (!input || !results) return;

    const query = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (query.length < SOGLIA_RICERCA_COMPLETAMENTO) return;

    const giaPresenti = new Set([db.currentUser.id, ...squadCreateMemberIds]);
    const trovati = db.users.filter(u => !giaPresenti.has(u.id) && (u.username || "").toLowerCase().includes(query));

    if (!trovati.length) {
        results.innerHTML = `<p class="small text-muted">${escapeHtml(T('peopleSearch.nessunRisultato') || 'Nessuna persona trovata.')}</p>`;
        return;
    }

    trovati.forEach(u => {
        const row = document.createElement("div");
        row.className = "carpool-group-item";
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div class="p-avatar">${u.avatar}</div>
                <b>${escapeHtml(u.username)}</b>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addToSquadCreate('${u.id}')">${escapeHtml(T('completeGroupModal.aggiungiBtn') || 'Aggiungi')}</button>
        `;
        results.appendChild(row);
    });
}

// Crea la squadra sul server
async function submitCreateSquad() {
    const db = window.CamoscioState;
    const name = document.getElementById("squad-name").value;
    const memberIds = [db.currentUser.id, ...squadCreateMemberIds];

    try {
        const response = await fetch('/api/squads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, creatorId: db.currentUser.id, members: memberIds })
        });

        if (response.ok) {
            document.getElementById("create-squad-form-box").classList.add("hidden");
            document.getElementById("create-squad-form").reset();
            resetSquadCreateForm();

            await refreshState();
            renderSquadsList();
            renderOtherSquadsList();
        }
    } catch(e) {
        console.error("Errore creazione squadra:", e);
    }
}

// Invita una squadra a un'escursione - prima sceglieva l'escursione da solo (db.activeHikeId,
// che appartiene a Zaino/Carpooling/Mappa - vedi app.js - o la prima del database, qualunque
// fosse) e ha davvero invitato una squadra a un'escursione gia' completata (bug segnalato da
// Denis). Ora apre un riquadro con le escursioni ancora aperte fra le proprie
// (mieEscursioniAperte, sopra) e lascia scegliere.
let invitoSquadId = null;
// Guardia contro il doppio clic rapido: confermaInvitoSquadra e' async e la prima await
// (refreshState) lascia una finestra in cui un secondo clic rientrerebbe nella funzione e
// manderebbe una seconda PUT con lo stesso elenco - due inviti invece di uno.
let invitoInCorso = false;

window.inviteSquadToHike = function(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    if (!squad) return;

    invitoSquadId = squadId;
    const nameEl = document.getElementById("invite-squad-name");
    if (nameEl) nameEl.textContent = squad.name;

    // Trovato dal code-reviewer: senza controllare il risultato, il riquadro-lista-vuota
    // chiude il modale e mostra l'avviso, ma questa funzione lo riapriva comunque subito dopo
    // - un pannello vuoto e morto sopra l'avviso, per chi ha una squadra senza nessuna
    // escursione aperta (es. appena creata).
    if (!renderInviteSquadHikeList()) return;
    document.getElementById("invite-squad-modal").classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
};

function closeInviteSquadModal() {
    document.getElementById("invite-squad-modal").classList.add("hidden");
    invitoSquadId = null;
}

// Una riga per escursione candidata: titolo/data/organizzatore, e quanti membri della squadra
// verrebbero davvero toccati (esclusi quelli gia' dentro, in participants O in pendingApproval).
// "Richiede approvazione" quando non sono io il creatore e l'escursione ha manualApproval: in
// quel caso l'invito propone, non iscrive (vedi confermaInvitoSquadra) - va detto PRIMA del
// click, non solo nel messaggio finale.
function rigaInvitoSquadra(hike, squad, me) {
    const db = window.CamoscioState;
    const isCreatorMe = hike.creatorId === me;
    const richiedeApprovazione = !isCreatorMe && !!hike.manualApproval;

    const giaDentro = new Set([...(hike.participants || []), ...(hike.pendingApproval || [])]);
    const daAggiungere = squad.members.filter(id => !giaDentro.has(id));
    const inAttesa = squad.members.some(id => (hike.pendingApproval || []).includes(id));

    const organizzatore = isCreatorMe ? (T('social.you') || 'te') : (() => {
        const u = db.users.find(u => u.id === hike.creatorId);
        return escapeHtml(u ? u.username : (T('social.anotherUser') || 'un altro utente'));
    })();
    // hike.date non e' required nello schema (models/Hike.js) - senza guardia un'escursione
    // senza data darebbe "Invalid Date" nel riquadro invece di dire semplicemente che manca.
    // Locale della data col mese esteso scelto per lingua, come formattaDataItaliana (primo lotto).
    const dateLocale = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
    const dataFmt = hike.date
        ? new Date(hike.date + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })
        : (T('social.noDate') || 'data non indicata');
    const badge = richiedeApprovazione ? ` <span class="badge badge-primary">${escapeHtml(T('social.needsApproval') || 'Richiede approvazione')}</span>` : "";

    const disabilitata = daAggiungere.length === 0;
    const contatore = disabilitata
        ? (inAttesa
            ? (T('social.allMembersInOrPending') || "Tutti i membri sono già iscritti o in attesa")
            : (T('social.allMembersIn') || "Tutti i membri sono già iscritti"))
        : (richiedeApprovazione
            ? (T('social.toPropose', daAggiungere.length) || `${daAggiungere.length} da proporre`)
            : (T('social.toAdd', daAggiungere.length) || `${daAggiungere.length} ${daAggiungere.length === 1 ? 'membro da aggiungere' : 'membri da aggiungere'}`));

    return `
        <div class="carpool-group-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px; ${disabilitata ? 'opacity:0.6;' : 'cursor:pointer;'}" ${disabilitata ? '' : `onclick="confermaInvitoSquadra('${hike.id}')"`}>
            <div>
                <b>${escapeHtml(hike.title)}</b> · ${dataFmt}<br>
                <span class="small text-muted">${T('social.organizedBy', organizzatore) || `Organizzata da ${organizzatore}`}${badge}</span>
            </div>
            <span class="small ${richiedeApprovazione && !disabilitata ? 'text-warning' : 'text-muted'}">${contatore}</span>
        </div>
    `;
}

// Torna false quando non c'e' niente da mostrare (e il modale va tenuto chiuso), true quando
// il riquadro ha davvero del contenuto - chi chiama da inviteSquadToHike deve saperlo per non
// riaprire un pannello vuoto sopra l'avviso che questa stessa funzione fa comparire.
function renderInviteSquadHikeList() {
    const box = document.getElementById("invite-squad-hike-list");
    if (!box) return false;

    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === invitoSquadId);
    if (!squad) { box.innerHTML = ""; return false; }

    const candidate = mieEscursioniAperte();
    if (candidate.length === 0) {
        const nomeSquadra = squad.name;
        closeInviteSquadModal();
        window.showAlertModal(T('social.noOpenHikeForInvite', nomeSquadra) || `Non hai nessuna escursione aperta a cui invitare "${nomeSquadra}": le escursioni già completate non si possono più modificare. Creane una nuova dalla sezione Escursioni.`);
        return false;
    }

    // Ordinate per data (formato "YYYY-MM-DD", confrontabile come stringa) - una senza data
    // (vedi la guardia in rigaInvitoSquadra) va in coda, non mescolata a caso fra le altre.
    const perData = (a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99');
    const me = db.currentUser.id;
    const mie = candidate.filter(h => h.creatorId === me).sort(perData);
    const altrui = candidate.filter(h => h.creatorId !== me).sort(perData);

    let html = "";
    if (mie.length) {
        html += `<div class="small font-bold text-muted">${escapeHtml(T('social.organizedByYou') || 'Organizzate da te')}</div>`;
        html += mie.map(h => rigaInvitoSquadra(h, squad, me)).join("");
    }
    if (altrui.length) {
        html += `<div class="small font-bold text-muted" style="margin-top:8px;">${escapeHtml(T('social.youreJoining') || 'A cui partecipi')}</div>`;
        html += altrui.map(h => rigaInvitoSquadra(h, squad, me)).join("");
    }
    box.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
    return true;
}

// Esegue davvero l'invito, su UNA escursione scelta dal riquadro sopra.
window.confermaInvitoSquadra = async function(hikeId) {
    if (!invitoSquadId || invitoInCorso) return;
    invitoInCorso = true;
    const squadIdAlMomento = invitoSquadId;

    try {
    // Lo stato va riletto PRIMA di calcolare qualunque cosa: la PUT manda l'elenco intero, e
    // con uno stato vecchio in pagina il creatore cancellerebbe in silenzio chi si e' iscritto
    // nel frattempo (per lui il server non vieta le rimozioni - solo un non-creatore le ha
    // sempre vietate, vedi canNonCreatorEditParticipation).
    await refreshState();

    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadIdAlMomento);
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!squad || !hike) {
        window.showToast(T('social.squadOrHikeGone') || "Squadra o escursione non più disponibile.", "error");
        closeInviteSquadModal();
        return;
    }

    // Stessa condizione che decide cosa mostrare nel riquadro (mieEscursioniAperte): se nel
    // frattempo l'escursione si e' chiusa, o non ne faccio piu' parte, non e' piu' un bersaglio
    // valido - non si scopre solo dal 403 del server, si ridisegna la lista con lo stato vero.
    const me = db.currentUser.id;
    const ancoraValida = mieEscursioniAperte().some(h => h.id === hikeId);
    if (!ancoraValida) {
        window.showToast(T('social.hikeNotAvailableInvite', hike.title) || `"${hike.title}" non è più disponibile per un invito.`, "error");
        renderInviteSquadHikeList();
        return;
    }

    const isCreatorMe = hike.creatorId === me;
    // Con l'approvazione manuale attiva, chi non e' il creatore puo' solo PROPORRE nomi
    // (pendingApproval), mai iscriverli direttamente - il server rifiuta comunque il campo
    // sbagliato (canNonCreatorEditParticipation), questo sceglie subito quello giusto.
    const campo = (!isCreatorMe && hike.manualApproval) ? 'pendingApproval' : 'participants';

    const giaDentro = new Set([...(hike.participants || []), ...(hike.pendingApproval || [])]);
    const daAggiungere = squad.members.filter(id => !giaDentro.has(id));

    if (daAggiungere.length === 0) {
        window.showToast(T('social.allAlreadyIn', squad.name, hike.title) || `Tutti i membri di "${squad.name}" sono già iscritti (o in attesa) su "${hike.title}".`, "info");
        closeInviteSquadModal();
        return;
    }

    // UN SOLO campo nel body, mai anche l'altro invariato: il server calcola il diff contro
    // il proprio stato attuale, e mandare anche il campo che non cambia e' puro rischio se
    // quello in pagina fosse di qualche minuto vecchio.
    const nuovoElenco = (hike[campo] || []).concat(daAggiungere);

    try {
        const response = await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: nuovoElenco })
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            window.showToast(body.error || T('social.errInviteSend') || "Non è stato possibile inviare l'invito.", "error");
            await refreshState();
            renderInviteSquadHikeList();
            return;
        }

        await refreshState();

        const n = daAggiungere.length;
        // Mai la parola "invitata" nel caso proposta, e "solo se" non "solo quando": "quando"
        // darebbe per scontata un'approvazione che potrebbe non arrivare.
        const messaggio = campo === 'participants'
            ? (T('social.squadAdded', squad.name, hike.title, n) || `"${squad.name}" aggiunta a "${hike.title}": ${n} ${n === 1 ? 'nuovo partecipante' : 'nuovi partecipanti'}.`)
            : (T('social.squadProposed', squad.name, hike.title, n) || `Richiesta inviata per ${n} ${n === 1 ? 'membro' : 'membri'} di "${squad.name}": ${n === 1 ? 'entrerà' : 'entreranno'} in "${hike.title}" solo se l'organizzatore la approva.`);
        window.showToast(messaggio, "success");

        closeInviteSquadModal();
        renderSquadsList();
        renderHikesList();
    } catch (e) {
        console.error("Errore invito squadra:", e);
        window.showToast(T('social.errInviteSend') || "Non è stato possibile inviare l'invito.", "error");
    }
    } finally {
        invitoInCorso = false;
    }
};

// --- RECENSIONI ANONIME OBBLIGATORIE ---

// Popola gli utenti recensibili: solo co-partecipanti di escursioni condivise e già concluse
// (non più "chiunque nel sistema") - le opzioni sono coppie escursione+utente perché la stessa
// persona può essere stata compagna di più uscite passate.
// "Già conclusa" si misura da un Completion vero (bug segnalato da Denis 03/08/2026: la data
// dell'escursione confrontata con adesso segnava già "passata" dalla mezzanotte del giorno
// stesso, prima ancora che l'escursione iniziasse). Qui si può controllare solo il PROPRIO
// completamento (db.completions ha solo quelli dell'utente corrente): il server verifica anche
// quello dell'altra persona al momento dell'invio, vedi routes/reviews.js.
// Contatore di generazione (punto 98/B): renderSocialModule() richiama questa funzione
// da più punti, e ora che c'è un await in mezzo due chiamate ravvicinate potrebbero far
// atterrare la risposta più vecchia DOPO quella nuova, ridipingendo un elenco stantio -
// stesso principio già usato per invitoInCorso più sopra in questo file.
let generazioneTendinaRecensioni = 0;

async function populateReviewTargets() {
    const select = document.getElementById("review-target");
    if (!select) return;

    const db = window.CamoscioState;

    const completedHikeIds = new Set(db.completions.map(c => c.hikeId));
    const pastSharedHikes = db.hikes.filter(h =>
        completedHikeIds.has(h.id) && h.participants.includes(db.currentUser.id)
    );

    const options = [];
    pastSharedHikes.forEach(hike => {
        hike.participants.forEach(pId => {
            if (pId === db.currentUser.id) return;
            const user = db.users.find(u => u.id === pId);
            if (!user) return;
            options.push({ hikeId: hike.id, hikeTitle: hike.title, user });
        });
    });

    if (options.length === 0) {
        select.innerHTML = `<option value="" disabled selected>${escapeHtml(T('social.noPastSharedHikes') || 'Nessuna escursione passata condivisa da recensire')}</option>`;
        return;
    }

    const generazione = ++generazioneTendinaRecensioni;
    select.innerHTML = `<option value="" disabled selected>${escapeHtml(T('profile.caricamento') || 'Caricamento...')}</option>`;

    // Punto 98/B: senza questo filtro una coppia gia' recensita restava per sempre
    // selezionabile - il server la rifiuta (409), ma l'utente non lo sapeva finche' non
    // ci provava, e con molte escursioni condivise diventava ingestibile trovare quella
    // giusta. Un solo giro col server (mai N), che risponde solo per la sessione corrente
    // senza rivelare chi ha recensito chi - vedi routes/reviews.js.
    let disponibili = options;
    try {
        const response = await fetch('/api/reviews/gia-recensite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                coppie: options.map(o => ({ hikeId: o.hikeId, targetUserId: o.user.id }))
            })
        });
        if (response.ok) {
            const { gia } = await response.json();
            const giaRecensite = new Set(gia);
            disponibili = options.filter(o => !giaRecensite.has(`${o.hikeId}::${o.user.id}`));
        }
        // Risposta non ok (es. sessione scaduta): si mostra tutto, come prima di questo
        // punto, invece di nascondere per sbaglio escursioni davvero recensibili.
    } catch (e) {
        console.error('Errore verifica recensioni già fatte:', e);
    }

    if (generazione !== generazioneTendinaRecensioni) return; // una chiamata più recente ha già ridisegnato

    if (disponibili.length === 0) {
        select.innerHTML = options.length === 0
            ? `<option value="" disabled selected>${escapeHtml(T('social.noPastSharedHikes') || 'Nessuna escursione passata condivisa da recensire')}</option>`
            : `<option value="" disabled selected>${escapeHtml(T('social.allReviewed') || 'Hai già recensito tutti i compagni delle tue escursioni concluse')}</option>`;
        return;
    }

    select.innerHTML = "";
    disponibili.forEach(opt => {
        const el = document.createElement("option");
        el.value = `${opt.hikeId}::${opt.user.id}`;
        el.textContent = `${opt.user.avatar} ${opt.user.username} (${opt.hikeTitle})`;
        select.appendChild(el);
    });
}

// Invia recensione anonima al server
async function submitAnonymousReview() {
    const selection = document.getElementById("review-target").value;
    if (!selection) return;
    const [hikeId, targetUserId] = selection.split("::");

    const punctuality = document.getElementById("rate-punctuality").value;
    const equipment = document.getElementById("rate-equipment").value;
    const respect = document.getElementById("rate-respect").value;
    const db = window.CamoscioState;

    try {
        const response = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // reviewerId e hikeId servono SOLO lato server per l'hash anti-duplicati:
            // non vengono mai salvati né restituiti nel record di recensione visibile.
            body: JSON.stringify({ targetUserId, punctuality, equipment, respect, reviewerId: db.currentUser.id, hikeId })
        });

        if (response.ok) {
            window.showToast(T('social.reviewSent') || "Feedback inviato con successo! La recensione rimarrà al 100% anonima nel sistema.", "success");
            document.getElementById("peer-review-form").reset();

            await refreshState();
            renderSocialModule();
        } else {
            const err = await response.json();
            window.showToast(err.error || T('social.errReviewSend') || "Non è stato possibile inviare la recensione.", "error");
        }
    } catch(e) {
        console.error("Errore invio recensione:", e);
    }
}

window.initSocialModule = initSocialModule;
window.renderSocialModule = renderSocialModule;
window.renderHikesList = renderHikesList;
window.renderSquadsList = renderSquadsList;
window.renderOtherSquadsList = renderOtherSquadsList;
window.renderFollowLists = renderFollowLists; // punto 113: lo richiama anche toggleFollow (userprofile.js)
