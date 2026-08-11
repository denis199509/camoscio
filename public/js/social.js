// Punto 54: create-hike-modal e' riusato anche per modificare un'escursione gia'
// esistente - questo tiene traccia di QUALE, se non null siamo in modalita' modifica.
let editingHikeId = null;

function setHikeModalMode(mode, hike) {
    const titolo = document.querySelector('#create-hike-modal .modal-header h4');
    const submitBtn = document.querySelector('#create-hike-form button[type="submit"]');
    if (mode === 'edit') {
        editingHikeId = hike.id;
        if (titolo) titolo.textContent = 'Modifica Escursione';
        if (submitBtn) submitBtn.textContent = 'Salva Modifiche';
    } else {
        editingHikeId = null;
        if (titolo) titolo.textContent = 'Crea Nuova Escursione';
        if (submitBtn) submitBtn.textContent = 'Pubblica Escursione';
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
}

// Riempie il menu a tendina dei progetti con le bozze dell'utente (GET /api/routing/drafts,
// gia' esistente dal punto 13 - nessuna rotta nuova). Solo nome e id: i numeri si calcolano
// davvero al salvataggio, non qui, altrimenti due fonti potrebbero dire cose diverse.
async function popolaBozzePerHike() {
    const sel = document.getElementById('hike-route-draft-select');
    if (!sel) return;
    sel.innerHTML = '<option>Caricamento...</option>';
    try {
        const res = await fetch('/api/routing/drafts');
        const bozze = res.ok ? await res.json() : [];
        if (!bozze.length) {
            sel.innerHTML = '<option value="">Non hai ancora nessun progetto salvato</option>';
            return;
        }
        sel.innerHTML = bozze.map(b => `<option value="${b.id}">${window.escapeHtml(b.nome)}</option>`).join('');
    } catch (e) {
        console.error('Errore nel caricamento dei progetti:', e);
        sel.innerHTML = '<option value="">Non è stato possibile caricare i progetti</option>';
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
    setupDiaryForm();
    setupVoiceRecorder();
    renderSocialModule();
    renderHikesList();
}

function setupSocialEvents() {
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
    const db = window.CamoscioState;
    const usr = db.currentUser;
    if (!usr) return;

    // Carica l'obiettivo di allenamento dell'utente
    document.getElementById("user-training-goal").value = usr.trainingGoal || "";

    // Calcola e disegna i match sugli obiettivi
    renderGoalMatches(usr);

    // Disegna le squadre ricorrenti
    renderSquadsList();
    renderOtherSquadsList();

    // Popola i target delle recensioni (altri utenti escluse se stessi)
    populateReviewTargets();

    // Disegna il Diario di Viaggio
    renderDiaryTimeline();
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
        "Nessuna escursione trovata con i filtri inseriti.");
    riempiGruppo("hikes-list-partecipi", partecipi,
        "Non partecipi a nessuna escursione in programma.");
    riempiGruppo("hikes-list-completate", fatte,
        "Nessuna escursione completata.");

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
    document.getElementById("count-done").textContent = fatte.length;

    riempiGruppo("my-hikes-created", create,
        "Non hai ancora organizzato nessuna escursione. Puoi crearne una dalla sezione Escursioni.");
    riempiGruppo("my-hikes-joined", partecipo,
        "Non sei iscritto a nessuna escursione in programma. Guarda quelle degli altri nella sezione Escursioni.");
    riempiGruppo("my-hikes-done", fatte,
        "Nessuna escursione completata per ora. Dopo un'uscita ricordati di segnarla come completata.");

    const riepilogo = document.getElementById("my-hikes-summary");
    if (riepilogo) {
        const totale = create.length + partecipo.length + fatte.length;
        riepilogo.innerHTML = totale === 0
            ? `<div class="glass-card text-center py-4 text-muted">Qui compariranno le tue escursioni: quelle che organizzi, quelle a cui ti iscrivi e quelle che hai già fatto.</div>`
            : `<div class="glass-card my-hikes-counters">
                   <div><strong>${create.length}</strong><span>organizzate</span></div>
                   <div><strong>${partecipo.length}</strong><span>in programma</span></div>
                   <div><strong>${fatte.length}</strong><span>completate</span></div>
               </div>`;
    }

    if (window.lucide) window.lucide.createIcons();
}

window.renderMyHikes = renderMyHikes;
// Esportata anche per lo Zaino (punto 23): deve sapere quali escursioni sono DAVVERO
// dell'utente, e deve usare gli stessi identici criteri di questa pagina - altrimenti
// "mia escursione" finirebbe per voler dire due cose diverse in due punti del sito.
window.classificaMieEscursioni = classificaMieEscursioni;

// Costruisce la scheda di UNA escursione. Estratta da renderHikesList (punto 10 di
// cose_da_fare.txt) per poterla riusare identica anche nella pagina "Le mie escursioni":
// due elenchi che mostrano le stesse schede devono restare uguali da soli, senza doverle
// aggiornare in due punti ogni volta che cambia qualcosa.
function buildHikeCard(hike) {
    const db = window.CamoscioState;
    const currentUser = db.currentUser;

    const creator = db.users.find(u => u.id === hike.creatorId);
    const creatorName = creator ? creator.username : "Escursionista";

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
            return `<p class="small text-muted rp-nota-dislivello"><i data-lucide="clock"></i><span>Tempo previsto: <b>${tempi.standardText}</b> (CAI standard) · <b>${tempi.customText}</b> sul tuo passo. Percorso: ${escapeHtml(hike.routeSource.nome)}.</span></p>`;
        })()
        : `<p class="small text-muted rp-nota-dislivello"><i data-lucide="info"></i><span>Tempo previsto non disponibile: per questa escursione non è ancora stato scelto un percorso reale, quindi non si può sapere quanto ci vorrà davvero. Dislivello e distanza qui sopra sono quelli indicati da chi l'ha organizzata.</span></p>`;

    // Punto 79: se l'escursione e' completata e IO ho un tempo di cammino reale misurato da
    // un .gpx (Completion.movingTimeHours, presente solo quando la traccia era abbastanza
    // fitta da fidarsene), lo confronto con lo standard CAI calcolato sugli stessi dati VERI
    // dell'escursione - non sul mio passo storico, che e' gia' il confronto mostrato sopra
    // prima di partire. Risponde alla domanda di Denis: "quanto ho camminato davvero, senza
    // le mie pause, contro lo standard" - le pause si mostrano separate perche' sono sue,
    // soggettive, non della escursione (a lui bastano 5 minuti, ad altri ne servono 10+).
    let tempoRealeHtml = "";
    if (hike.groupCompletedAt) {
        const miaCompletion = db.completions.find(c => c.hikeId === hike.id);
        if (miaCompletion && miaCompletion.movingTimeHours) {
            const tVertStandard = hike.elevationGain / 400;
            const tFlatStandard = hike.distanceKm / 4;
            const caiOre = Math.max(tVertStandard, tFlatStandard) + Math.min(tVertStandard, tFlatStandard) / 2;
            const pauseOre = miaCompletion.actualTimeHours
                ? Math.max(0, miaCompletion.actualTimeHours - miaCompletion.movingTimeHours)
                : 0;
            const pausaText = pauseOre > (1 / 60) // sotto il minuto non si scrive, formatHoursToMin arrotonderebbe a "0h 0m"
                ? ` (+ ${window.formatHoursToMin(pauseOre)} di pause)`
                : "";
            tempoRealeHtml = `<p class="small text-muted rp-nota-dislivello"><i data-lucide="footprints"></i><span>Il tuo tempo di cammino misurato: <b>${window.formatHoursToMin(miaCompletion.movingTimeHours)}</b>${pausaText} · CAI per questo percorso: <b>${window.formatHoursToMin(caiOre)}</b>.</span></p>`;
        }
    }

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
            const names = otherBookmarkers.map(u => `<b>${escapeHtml(u.username.split(" ")[0])}</b>`).join(" e ");
            trailMatchHtml = `<div class="trail-match-line small"><i data-lucide="star"></i> Anche ${names} ${otherBookmarkers.length === 1 ? "ha" : "hanno"} messo questo sentiero nei preferiti.</div>`;
        }
    }

    const card = document.createElement("div");
    card.className = "glass-card hike-card";

    // Costruzione partecipanti. Cliccabile: apre la pagina profilo di quella persona
    // (funzionalita' chiesta da Denis in sessione il 01/08/2026, non in cose_da_fare.txt).
    const participantsHtml = hike.participants.map(pId => {
        const pUser = db.users.find(u => u.id === pId);
        if (!pUser) return "";
        const isLocalExpert = pUser.localExpert && pUser.localExpert.active;
        const expertTitlePart = isLocalExpert ? ` — Esperto locale: ${escapeHtml(pUser.localExpert.area)}` : "";
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
        actionBtnHtml = `<span class="badge badge-accent">Organizzatore</span>`;
    } else if (isParticipant) {
        actionBtnHtml = `<span class="badge badge-green">Partecipi ✓</span>`;
    } else if (isPending) {
        actionBtnHtml = `<span class="badge badge-primary">In attesa approvazione...</span>`;
    } else {
        actionBtnHtml = `<button class="btn btn-sm btn-primary" onclick="joinHikeRequest('${hike.id}', ${eligibility.eligible})">Iscriviti</button>`;
    }

    // Pannello Veto del Capogruppo (solo per l'organizzatore)
    let vetoSectionHtml = "";
    if (isCreatorMe && hike.pendingApproval && hike.pendingApproval.length > 0) {
        const pendingItemsHtml = hike.pendingApproval.map(pendingId => {
            const pendingUser = db.users.find(u => u.id === pendingId);
            if (!pendingUser) return "";
            
            return `
                <div class="veto-request-item">
                    <span>${pendingUser.avatar} <b>${escapeHtml(pendingUser.username)}</b> (Rep: ${pendingUser.reputation}%, ${pendingUser.experienceLevel})</span>
                    <div class="veto-actions">
                        <button class="btn btn-sm btn-success" style="padding:2px 6px;" onclick="approveParticipant('${hike.id}', '${pendingId}')">Accetta</button>
                        <button class="btn btn-sm btn-danger" style="padding:2px 6px;" onclick="declineParticipant('${hike.id}', '${pendingId}')">Rifiuta</button>
                    </div>
                </div>
            `;
        }).join("");

        vetoSectionHtml = `
            <div class="veto-management-box">
                <span class="small font-bold text-warning" style="display:block; margin-bottom:6px;"><i data-lucide="shield-alert"></i> Richieste Pendenti (Veto):</span>
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
            completeGroupBtnHtml = `<span class="badge badge-green">Completata in gruppo ✓</span>`;
        } else if (hike.date <= oggiStr) {
            completeGroupBtnHtml = `<button class="btn btn-sm btn-success" onclick="openCompleteGroupModal('${hike.id}')">Completa escursione</button>`;
        }
    }

    // Punto 54: solo il creatore vede il tasto "tre puntini" -> Modifica. Riusa il
    // create-hike-modal gia' esistente (openEditHikeModal lo precompila).
    // Punto 76: una volta completata in gruppo il menu sparisce del tutto - l'unica voce
    // che contiene, Modifica, non e' piu' permessa (guardia vera lato server in hikes.js).
    const editMenuHtml = (isCreatorMe && !hike.groupCompletedAt) ? `
        <div class="hike-card-menu">
            <button type="button" class="hike-card-menu-btn" title="Opzioni escursione" aria-label="Opzioni escursione">
                <i data-lucide="more-vertical"></i>
            </button>
            <div class="hike-card-menu-dropdown hidden">
                <button type="button" class="hike-card-menu-item" onclick="openEditHikeModal('${hike.id}')">
                    <i data-lucide="pencil"></i> Modifica
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
                <span class="badge badge-primary hike-difficulty-badge">${hike.difficulty}</span>
                ${editMenuHtml}
            </div>
            <p class="small text-muted" style="margin-bottom: 8px;">Organizzato da: <b class="user-link" onclick="showUserProfile('${hike.creatorId}')">${escapeHtml(creatorName)}</b>${creatorBadgeHtml}</p>

            <p class="small text-secondary" style="line-height:1.4; height: 60px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(hike.description)}</p>

            <div class="hike-meta-row">
                <div class="hike-meta-item">
                    <span>Dislivello D+</span>
                    <strong>${hike.elevationGain}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>Quota Max</span>
                    <strong>${hike.maxAltitude}m</strong>
                </div>
                <div class="hike-meta-item">
                    <span>Distanza</span>
                    <strong>${hike.distanceKm} km</strong>
                </div>
            </div>

            ${tempoHtml}
            ${tempoRealeHtml}

            <div class="tag-list">
                ${hike.tribeTags.map(t => `<span class="tag">${t}</span>`).join("")}
                <span class="badge ${eligibility.class}">${eligibility.text}</span>
            </div>

            <div class="participants-section">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="small text-muted">Partecipanti (${hike.participants.length}):</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="loadHikeOnMapDirectly('${hike.id}')" title="Vedi sentiero sulla mappa">Mappa</button>
                        <button class="btn btn-sm btn-secondary bookmark-toggle-btn ${isBookmarked ? 'is-bookmarked' : ''}" style="padding:2px 6px;" onclick="toggleBookmark('${hike.id}')" title="${isBookmarked ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">
                            🐐
                        </button>
                        ${isParticipant ? `<button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="showHikePage('${hike.id}')" title="Chat tra i partecipanti">Chat</button>` : ""}
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

// Richiesta iscrizione con avviso se inesperto
window.joinHikeRequest = async function(hikeId, isEligible) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    if (!isEligible) {
        const confirmJoin = await window.showConfirmModal("⚠️ ATTENZIONE: Questa escursione richiede un passo superiore al tuo attuale storico rilevato.\n\nVuoi comunque inviare una richiesta al capogruppo e discuterne in chat?");
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
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    hike.pendingApproval = hike.pendingApproval.filter(id => id !== userId);
    if (!hike.participants.includes(userId)) {
        hike.participants.push(userId);
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

        await notifyParticipantDecision(userId, `La tua richiesta per "${hike.title}" è stata accettata! Sei ufficialmente tra i partecipanti.`);

        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore nell'approvazione:", e);
    }
};

// Rifiuta partecipante (Veto Capogruppo)
window.declineParticipant = async function(hikeId, userId) {
    const db = window.CamoscioState;
    const hike = db.hikes.find(h => h.id === hikeId);
    if (!hike) return;

    hike.pendingApproval = hike.pendingApproval.filter(id => id !== userId);

    try {
        await fetch(`/api/hikes/${hikeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pendingApproval: hike.pendingApproval
            })
        });

        await notifyParticipantDecision(userId, `La tua richiesta per "${hike.title}" non è stata accettata dal capogruppo questa volta.`);

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
            window.showToast("Scegli un progetto dall'elenco.", "error");
            return;
        }
        routeSource = { kind: 'draft', draftId };
    } else if (fonte === 'gpx') {
        const file = document.getElementById("hike-route-gpx-file").files[0];
        if (!file) {
            window.showToast("Scegli un file .gpx da importare.", "error");
            return;
        }
        try {
            routeSource = { kind: 'gpx', gpxText: await file.text() };
        } catch (e) {
            window.showToast("Non è stato possibile leggere il file.", "error");
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
        window.showToast("Scegli prima il punto di ritrovo: cercalo per nome oppure indicalo sulla mappa.", "error");
        const ricerca = document.getElementById("hike-trailhead-search");
        if (ricerca) ricerca.focus();
        return;
    }

    // Vincolo hard: il ritrovo deve trovarsi in una delle 4 regioni reali (Fase G - prima
    // era solo un rettangolo approssimativo). Ricontrollato comunque lato server in
    // routes/hikes.js: questo e' solo per un messaggio d'errore immediato all'utente.
    if (window.CamoscioIsInRegion && !window.CamoscioIsInRegion(lat, lng)) {
        window.showToast("Il punto di ritrovo inserito è fuori dall'ambito geografico attuale della demo (Lazio, Molise, Abruzzo, Marche). Inserisci coordinate all'interno di queste regioni.", "error");
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
            document.getElementById("create-hike-modal").classList.add("hidden");
            document.getElementById("create-hike-form").reset();
            if (window.resetTrailheadPicker) window.resetTrailheadPicker();
            resetHikeRouteSourcePicker();
            setHikeModalMode('create'); // torna sempre alla modalita' di default dopo l'invio

            await refreshState();
            renderHikesList(); // ridisegna anche "Le mie escursioni", vedi commento li'
            if (window.populateHikeSelects) window.populateHikeSelects();
            window.showToast(inModifica ? "Escursione aggiornata!" : "Escursione pubblicata!", "success");
        } else {
            // Prima non si diceva NIENTE quando il server rifiutava: la finestra restava
            // aperta senza spiegazioni e sembrava che il pulsante non funzionasse. Il caso
            // piu' probabile e' proprio il rifiuto per ritrovo fuori dalle 4 regioni.
            const body = await response.json().catch(() => ({}));
            const messaggioDefault = inModifica
                ? "Non è stato possibile salvare le modifiche. Controlla i dati inseriti."
                : "Non è stato possibile pubblicare l'escursione. Controlla i dati inseriti.";
            window.showToast(body.error || messaggioDefault, "error");
        }
    } catch(e) {
        console.error("Errore creazione escursione:", e);
        window.showToast(inModifica ? "Errore di rete: le modifiche non sono state salvate." : "Errore di rete: l'escursione non è stata pubblicata.", "error");
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
        results.innerHTML = `<p class="small text-muted">Nessuna persona trovata.</p>`;
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
            <button type="button" class="btn btn-sm btn-secondary" onclick="addToCompleteGroup('${u.id}')">Aggiungi</button>
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
        window.showToast("Conferma almeno una persona presente.", "error");
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
            window.showToast("Non è stato possibile leggere il file .gpx.", "error");
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
            window.showToast("Escursione completata per il gruppo!", "success");
        } else {
            const body = await response.json().catch(() => ({}));
            window.showToast(body.error || "Non è stato possibile completare il gruppo.", "error");
        }
    } catch (e) {
        console.error("Errore completamento di gruppo:", e);
        window.showToast("Errore di rete: il completamento non è stato salvato.", "error");
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
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Inserisci un obiettivo per trovare compagni di allenamento.</div>`;
        return;
    }

    const matches = db.users.filter(u => 
        u.id !== currentUser.id && 
        u.trainingGoal && 
        u.trainingGoal.toLowerCase().trim() === currentUser.trainingGoal.toLowerCase().trim()
    );

    if (matches.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessun escursionista ha lo stesso obiettivo al momento.</div>`;
        return;
    }

    matches.forEach(m => {
        const item = document.createElement("div");
        item.className = "goal-match-item";
        item.innerHTML = `
            <span>${m.avatar} <b>${escapeHtml(m.username)}</b> si allena per: <strong style="color:var(--accent-orange)">${escapeHtml(m.trainingGoal)}</strong></span>
            <button class="btn btn-sm btn-secondary" onclick="inviteToSquadDirectly('${m.id}')">Invita in Squadra</button>
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
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessuna squadra fissa creata.</div>`;
        return;
    }

    mySquads.forEach(squad => {
        const item = document.createElement("div");
        item.className = "squad-item";

        const membersAvatars = squad.members.map(mId => {
            const mem = db.users.find(u => u.id === mId);
            return mem ? mem.avatar : "👤";
        }).join(" ");

        // Se sono l'organizzatore, posso fare "Invita a Gita" (automaticamente riempie partecipanti escursione)
        let actionBtn = "";
        if (squad.creatorId === currentUser.id) {
            actionBtn = `<button class="btn btn-sm btn-success" onclick="inviteSquadToHike('${squad.id}')">Invita a Gita</button>`;
        } else {
            actionBtn = `<span class="badge badge-primary">Membro</span>`;
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
        container.innerHTML = `<div class="text-muted small italic text-center py-2">Nessun'altra squadra per ora.</div>`;
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
            ? `<span class="badge badge-primary">Richiesta inviata</span>`
            : `<button class="btn btn-sm btn-secondary" onclick="requestJoinSquad('${squad.id}')">Richiesta Partecipazione</button>`;

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
            window.showToast("Richiesta inviata: aspetta la conferma di un amministratore.", "success");
        } else {
            const err = await response.json().catch(() => ({}));
            window.showToast(err.error || "Impossibile inviare la richiesta.", "error");
        }
    } catch (e) {
        console.error("Errore richiesta di partecipazione squadra:", e);
        window.showToast("Impossibile inviare la richiesta.", "error");
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
                <button type="button" class="btn-inline-remove" onclick="removeFromSquadCreate('${id}')" title="Togli dalla squadra">&times;</button>
            </label>
        `;
    }).join("");
    container.innerHTML = righe || `<p class="small text-muted">Nessun membro aggiunto ancora (oltre a te).</p>`;
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
        results.innerHTML = `<p class="small text-muted">Nessuna persona trovata.</p>`;
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
            <button type="button" class="btn btn-sm btn-secondary" onclick="addToSquadCreate('${u.id}')">Aggiungi</button>
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

// Invita tutta la squadra all'escursione attiva (Lago Gemelli)
window.inviteSquadToHike = async function(squadId) {
    const db = window.CamoscioState;
    const squad = db.squads.find(s => s.id === squadId);
    const hike = db.hikes.find(h => h.id === db.activeHikeId) || db.hikes[0]; // Escursione attiva, o la prima disponibile

    if (!squad || !hike) return;

    // Aggiungi tutti i membri della squadra all'escursione
    squad.members.forEach(mId => {
        if (!hike.participants.includes(mId)) {
            hike.participants.push(mId);
        }
    });

    try {
        await fetch(`/api/hikes/${hike.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participants: hike.participants })
        });

        window.showToast(`Squadra "${squad.name}" invitata correttamente alla gita "${hike.title}"!`, "success");
        
        await refreshState();
        renderHikesList();
    } catch(e) {
        console.error("Errore invito squadra:", e);
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
function populateReviewTargets() {
    const select = document.getElementById("review-target");
    if (!select) return;

    const db = window.CamoscioState;
    select.innerHTML = "";

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
        select.innerHTML = `<option value="" disabled selected>Nessuna escursione passata condivisa da recensire</option>`;
        return;
    }

    options.forEach(opt => {
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
    const comment = document.getElementById("review-comment").value;
    const db = window.CamoscioState;

    try {
        const response = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // reviewerId e hikeId servono SOLO lato server per l'hash anti-duplicati:
            // non vengono mai salvati né restituiti nel record di recensione visibile.
            body: JSON.stringify({ targetUserId, punctuality, equipment, respect, comment, reviewerId: db.currentUser.id, hikeId })
        });

        if (response.ok) {
            window.showToast("Feedback inviato con successo! La recensione rimarrà al 100% anonima nel sistema.", "success");
            document.getElementById("peer-review-form").reset();

            await refreshState();
            renderSocialModule();
        } else {
            const err = await response.json();
            window.showToast(err.error || "Non è stato possibile inviare la recensione.", "error");
        }
    } catch(e) {
        console.error("Errore invio recensione:", e);
    }
}

// --- DIARIO DI VIAGGIO COLLABORATIVO ---

// Timeline a scorrimento orizzontale ("Reel" interattivo), raggruppata per escursione
function renderDiaryTimeline() {
    const container = document.getElementById("diary-timeline-container");
    if (!container) return;

    container.innerHTML = "";
    const db = window.CamoscioState;

    if (db.diaries.length === 0) {
        container.innerHTML = `<div class="text-muted small italic text-center py-4">Nessun diario di viaggio registrato. Aggiungi il primo!</div>`;
        return;
    }

    // Raggruppa le note per escursione, più recenti prima all'interno di ciascun gruppo
    const groups = {};
    [...db.diaries]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach(entry => {
            const key = entry.hikeId || "generic";
            if (!groups[key]) groups[key] = [];
            groups[key].push(entry);
        });

    Object.keys(groups).forEach(hikeId => {
        const hike = db.hikes.find(h => h.id === hikeId);
        const groupBox = document.createElement("div");
        groupBox.className = "diary-timeline-hike-group";

        const filmstrip = document.createElement("div");
        filmstrip.className = "diary-timeline-filmstrip";

        groups[hikeId].forEach(entry => {
            const user = db.users.find(u => u.id === entry.userId);
            const name = user ? user.username.split(" ")[0] : "Escursionista";
            const avatar = user ? user.avatar : "👤";

            const item = document.createElement("div");
            item.className = "timeline-item";

            item.innerHTML = `
                <div class="timeline-header">
                    <span>${avatar} <b>${escapeHtml(name)}</b></span>
                    <span>${new Date(entry.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div class="timeline-body">
                    <p>${escapeHtml(entry.textNote)}</p>
                    ${entry.mediaUrl ? `<img src="${escapeHtml(entry.mediaUrl)}" alt="Media Diario">` : ''}
                    ${entry.audioNoteUrl ? `<audio controls src="${escapeHtml(entry.audioNoteUrl)}"></audio>` : ''}
                </div>
            `;
            filmstrip.appendChild(item);
        });

        groupBox.innerHTML = `<h6>${escapeHtml(hike ? hike.title : "Altre note")}</h6>`;
        groupBox.appendChild(filmstrip);
        container.appendChild(groupBox);
    });
}

// Stato della registrazione vocale corrente (URL già caricato sul server, pronto per essere allegato alla nota)
let pendingVoiceNoteUrl = null;
let activeMediaRecorder = null;

// Configura il pulsante di registrazione nota vocale (MediaRecorder, standard web aperto)
function setupVoiceRecorder() {
    const btn = document.getElementById("btn-record-voice-note");
    const status = document.getElementById("voice-note-status");
    if (!btn) return;

    if (!navigator.mediaDevices || !window.MediaRecorder) {
        btn.disabled = true;
        if (status) status.textContent = "Registrazione audio non supportata da questo browser.";
        return;
    }

    btn.addEventListener("click", async () => {
        if (activeMediaRecorder && activeMediaRecorder.state === "recording") {
            activeMediaRecorder.stop();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            activeMediaRecorder = new MediaRecorder(stream);

            activeMediaRecorder.ondataavailable = (e) => chunks.push(e.data);

            activeMediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                btn.classList.remove("recording");
                btn.innerHTML = `<i data-lucide="mic"></i> Registra nota vocale`;
                if (window.lucide) window.lucide.createIcons();
                if (status) status.textContent = "Caricamento nota vocale...";

                const blob = new Blob(chunks, { type: activeMediaRecorder.mimeType || "audio/webm" });
                const base64 = await blobToBase64(blob);

                try {
                    const response = await fetch('/api/uploads/audio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audioBase64: base64, mimeType: blob.type })
                    });
                    const result = await response.json();
                    if (response.ok) {
                        pendingVoiceNoteUrl = result.url;
                        if (status) status.textContent = "✓ Nota vocale pronta, verrà allegata al salvataggio.";
                    } else {
                        if (status) status.textContent = result.error || "Errore nel caricamento della nota vocale.";
                    }
                } catch (e) {
                    console.error("Errore nel caricamento della nota vocale:", e);
                    if (status) status.textContent = "Errore nel caricamento della nota vocale.";
                }
            };

            activeMediaRecorder.start();
            btn.classList.add("recording");
            btn.innerHTML = `<i data-lucide="square"></i> Ferma registrazione`;
            if (window.lucide) window.lucide.createIcons();
            if (status) status.textContent = "Registrazione in corso...";
        } catch (e) {
            console.error("Errore nell'accesso al microfono:", e);
            if (status) status.textContent = "Permesso microfono negato o non disponibile.";
        }
    });
}

// Converte un Blob audio in stringa base64 (senza il prefisso data:...;base64,)
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Aggiunge una nota al diario collaborativo
function setupDiaryForm() {
    const addDiaryForm = document.getElementById("add-diary-form");
    if (!addDiaryForm) return;

    addDiaryForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const db = window.CamoscioState;
        const hikeId = document.getElementById("diary-hike-select").value;
        const textNote = document.getElementById("diary-text").value;
        const mediaUrl = document.getElementById("diary-img").value;
        const lat = parseFloat(document.getElementById("diary-lat").value);
        const lng = parseFloat(document.getElementById("diary-lng").value);

        const payload = {
            hikeId,
            userId: db.currentUser.id,
            textNote,
            mediaUrl,
            audioNoteUrl: pendingVoiceNoteUrl,
            lat,
            lng
        };

        try {
            const response = await fetch('/api/diaries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                document.getElementById("diary-text").value = "";
                pendingVoiceNoteUrl = null;
                const status = document.getElementById("voice-note-status");
                if (status) status.textContent = "";

                await refreshState();
                renderDiaryTimeline();
            }
        } catch(e) {
            console.error("Errore inserimento diario:", e);
        }
    });
}

window.initSocialModule = initSocialModule;
window.renderSocialModule = renderSocialModule;
window.renderHikesList = renderHikesList;
window.renderSquadsList = renderSquadsList;
window.renderOtherSquadsList = renderOtherSquadsList;
