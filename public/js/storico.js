// ==========================================================================
// STORICO DELLE USCITE + CARICAMENTO .GPX — punto 15 di cose_da_fare.txt
//
// Due cose che stanno insieme perche' sono la stessa schermata:
//  - l'ELENCO delle uscite gia' concluse. Non esisteva: le sessioni di
//    tracciamento finivano solo dentro i tre totali della Dashboard, quindi
//    un'uscita registrata non si poteva piu' rivedere da nessuna parte;
//  - il CARICAMENTO di file .gpx, che e' la richiesta del punto 15
//    ("costruirsi uno storico anche delle uscite fatte prima di usare il sito").
//    Senza l'elenco il caricamento non avrebbe avuto senso: si sarebbero visti
//    salire dei numeri senza mai vedere l'uscita.
//
// Il file viene letto QUI nel browser e mandato al server come testo. Non si usa
// un caricamento multipart: servirebbe una libreria in piu' sul server, mentre
// express.json c'e' gia' - e il contenuto va comunque letto come testo per essere
// convertito. Il file NON viene mai salvato su disco: si converte, si tiene la
// traccia nel formato compatto e l'XML si butta (e' 11 volte piu' pesante, misurato).
// ==========================================================================

(function () {
    // Rollout traduzione punto 102, secondo lotto (22/08/2026). "const", non "var":
    // questo file e' gia' dentro una propria IIFE (vedi la nota su badges.js in cima
    // a i18n.js sul perche' fa eccezione alla regola "var").
    const T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

    // Lo stesso limite del server (routes/tracking.js). Controllato anche qui per
    // dire subito che il file e' troppo grande, invece di far partire un invio da
    // decine di MB che verrebbe comunque rifiutato.
    const MAX_BYTE_GPX = 10 * 1024 * 1024;
    // Punto 114: per un .fit il limite lato client e' piu' basso. Il file viaggia in
    // base64 (~+33%), e il corpo JSON complessivo deve stare sotto i 10 MB di
    // express.json: 7 MB di binario -> ~9,4 MB di base64, ancora dentro. Un .fit di
    // 7 MB e' comunque enorme (il FIT e' molto compatto: ~7 MB = decine di ore a 1 s).
    const MAX_BYTE_FIT = 7 * 1024 * 1024;

    function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

    // Nome del mese per esteso: cambia locale con la lingua, stessa regola gia'
    // scelta per formattaDataItaliana in userprofile.js (vedi la nota in cima a
    // i18n.js) - a differenza del formato solo-cifre di italiana() piu' sotto, che
    // resta identico in entrambe le lingue.
    function dataItaliana(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const lang = window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en' ? 'en-GB' : 'it-IT';
        return d.toLocaleDateString(lang, { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function durata(secondi) {
        if (!secondi || secondi < 60) return '—';
        const ore = Math.floor(secondi / 3600);
        const minuti = Math.round((secondi % 3600) / 60);
        return ore > 0 ? `${ore}h ${minuti}min` : `${minuti} min`;
    }

    // Virgola italiana o punto inglese per i decimali - stessa formula di
    // formattaDecimale in userprofile.js, duplicata qui (piccola, autonoma) invece
    // di dipendere da una funzione non esportata di un altro file.
    function formattaDecimale(n) {
        const testo = (n || 0).toFixed(1);
        const lang = window.CamoscioI18n && window.CamoscioI18n.getLang();
        return lang === 'en' ? testo : testo.replace('.', ',');
    }

    // Separatore delle migliaia sui conteggi punti GPX - stessa lingua del resto.
    function formattaNumero(n) {
        const lang = window.CamoscioI18n && window.CamoscioI18n.getLang();
        return (n || 0).toLocaleString(lang === 'en' ? 'en-GB' : 'it-IT');
    }

    // --- ELENCO UNIFICATO "ESCURSIONI COMPLETATE" (punto 80/B) ---
    //
    // Prima erano due sezioni separate - "Già fatte" (Completion, un'escursione sociale
    // segnata come completata) e "Uscite registrate" (ActiveHikeSession, gpx importato o
    // tracciamento libero) - che a Denis raccontavano la stessa cosa: "quello che ho
    // fatto". Restano DUE pipeline dati separate (mai fuse come modello), ma diventano
    // UNA sola lista visiva, ordinata per data. Stesso principio già provato sul profilo
    // utente (punto 74, renderProfileHikes in userprofile.js) - qui in più ci sono i
    // bottoni azione (carica gpx/cestino) perché questa è la propria pagina, non un
    // profilo altrui.
    //
    // DEDUPLICAZIONE: un tracciamento dal vivo collegato a un'escursione sociale
    // (trackingState.hikeId, public/js/tracking.js) può, con un click esplicito
    // dell'utente a fine escursione, generare SIA una ActiveHikeSession con quel hikeId
    // SIA un Completion per la stessa escursione (completeLinkedHike -> POST
    // /api/hikes/:id/complete) - la stessa camminata reale, mostrata due volte, se non si
    // fa nulla. Si costruiscono PRIMA le voci-escursione (quelle che hanno davvero una
    // card, cioè le hike ancora in db.hikes con un mio Completion - se l'organizzatore
    // chiude il gruppo togliendo la spunta a chi si era auto-completato da solo, quel
    // Completion resta sul database ma NON produce una card qui), e SOLO DOPO si
    // scartano le sessioni il cui hikeId è fra quelle voci - mai il contrario, altrimenti
    // una sessione con un hikeId "orfano" (nessuna card a rappresentarlo) sparirebbe nel
    // nulla invece di restare l'unica prova visibile di quella camminata. Al massimo UNA
    // sessione per hikeId viene tolta (un Completion è unico per utente+escursione, ma due
    // sessioni con lo stesso hikeId sono possibili - tracciamento chiuso per sbaglio e
    // ripreso - e la seconda resta comunque una traccia GPS vera da mostrare).
    // --- PUNTO 113: pubblicare un'uscita nel feed dei follower ---
    //
    // Il tasto vive sulle card di "Le mie escursioni". sessionId presente = c'è una traccia
    // GPS pubblicabile (una ActiveHikeSession, registrata o importata). Assente = l'escursione
    // non ha traccia: il tasto non pubblica, spiega che serve prima importare un .gpx (il
    // tasto ⬆ "tempo reale" NON salva la traccia - solo "Carica un file .gpx" qui sopra lo fa).
    // Punto 115: i tasti usano data-attributi + un ascoltatore delegato (come [data-del-outing]),
    // non piu' onclick inline - cosi' il nome dell'uscita (che puo' contenere apici e virgolette)
    // ci arriva pulito dentro data-outing-name senza rompere l'HTML.
    function bottonePubblica(sessionId, publishedAt, nomeAttuale) {
        if (!sessionId) {
            return `<button type="button" class="btn btn-sm btn-secondary" style="padding:2px 8px;" data-pub-notrack="1" title="${esc(T('publish.serveTracciaTitle') || 'Serve una traccia GPS per pubblicare nel feed')}"><i data-lucide="upload-cloud"></i> ${esc(T('publish.pubblica') || 'Pubblica nel feed')}</button>`;
        }
        const nomeAttr = ` data-outing-name="${esc(nomeAttuale || '')}"`;
        if (publishedAt) {
            return `<button type="button" class="btn btn-sm btn-success" style="padding:2px 8px;" data-pub-outing="${esc(sessionId)}" data-published="1"${nomeAttr} title="${esc(T('publish.pubblicataTitle') || 'Nel feed di chi ti segue. Clic per toglierla.')}"><i data-lucide="check"></i> ${esc(T('publish.pubblicata') || 'Pubblicata')}</button>`;
        }
        return `<button type="button" class="btn btn-sm btn-primary" style="padding:2px 8px;" data-pub-outing="${esc(sessionId)}"${nomeAttr} title="${esc(T('publish.pubblicaTitle') || 'Rendi visibile questa uscita a chi ti segue')}"><i data-lucide="upload-cloud"></i> ${esc(T('publish.pubblica') || 'Pubblica nel feed')}</button>`;
    }

    // Punto 115: la matita per rinominare. Vale per ogni uscita propria (importata o
    // registrata dal vivo). data-outing-name porta il nome attuale (vuoto = ancora senza nome).
    function bottoneRinomina(sessionId, nomeAttuale) {
        const etichetta = esc(T('outing.rinominaTitle') || 'Rinomina questa uscita');
        return `<button type="button" class="outing-card-del" data-rename-outing="${esc(sessionId)}" data-outing-name="${esc(nomeAttuale || '')}" title="${etichetta}" aria-label="${etichetta}"><i data-lucide="pencil"></i></button>`;
    }

    async function togglePubblicaUscita(sessionId, giaPubblicata, nomeAttuale) {
        try {
            if (giaPubblicata) {
                const ok = window.showConfirmModal
                    ? await window.showConfirmModal(
                        T('publish.confermaTogli') || 'Togliere questa uscita dal feed? Non sarà più visibile a chi ti segue (i "mi piace" restano).',
                        T('publish.togli') || 'Togli dal feed',
                        { cancelLabel: T('common.annulla') || 'Annulla' })
                    : true;
                if (!ok) return;
                const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(sessionId)}/unpublish`, { method: 'POST' });
                if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    if (window.showToast) window.showToast(d.error || (T('publish.erroreTogli') || 'Non è stato possibile togliere l\'uscita dal feed.'), 'error');
                    return;
                }
                if (window.showToast) window.showToast(T('publish.tolta') || 'Uscita tolta dal feed.', 'success');
            } else {
                // Punto 115: prima il NOME (gia' compilato se ce l'ha), poi il commento.
                // Annullare uno dei due annulla tutta la pubblicazione.
                let nome = nomeAttuale || '';
                if (window.showPromptModal) {
                    const r = await window.showPromptModal(T('publish.chiediNome') || 'Nome dell\'uscita (facoltativo, ma aiuta chi la vede nel feed).', nomeAttuale || '');
                    if (r === null) return; // annullato
                    nome = r;
                }
                const didascalia = window.showPromptModal
                    ? await window.showPromptModal(T('publish.chiediDidascalia') || 'Scrivi due righe sull\'uscita (facoltativo). Premi OK per pubblicarla nel feed di chi ti segue.', '')
                    : '';
                if (didascalia === null) return; // annullato
                const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(sessionId)}/publish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        caption: (didascalia || '').trim().slice(0, 500),
                        name: (nome || '').trim().slice(0, 120)
                    })
                });
                if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    if (window.showToast) window.showToast(d.error || (T('publish.errorePubblica') || 'Non è stato possibile pubblicare l\'uscita.'), 'error');
                    return;
                }
                if (window.showToast) window.showToast(T('publish.fatta') || 'Uscita pubblicata nel feed!', 'success');
            }
            if (window.renderMyHikes) window.renderMyHikes(); // ridisegna la lista con lo stato nuovo
        } catch (e) {
            console.error('Pubblicazione/rimozione uscita fallita:', e);
            if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
        }
    }

    function avvisoPubblicaSenzaTraccia() {
        if (window.showToast) {
            window.showToast(
                T('publish.serveTraccia') || 'Questa escursione non ha una traccia GPS sul sito. Aggiungila col tasto ⬆ su questa card (lo stesso del tempo reale), poi potrai pubblicarla nel feed.',
                'error'
            );
        }
    }

    async function renderCompletate(fatte) {
        const box = document.getElementById('completate-list');
        const contatore = document.getElementById('count-completate');
        if (!box) return;

        // renderMyHikes() (social.js) chiama questa funzione ad OGNI ridisegno di
        // "Escursioni" (join/approva/rifiuta/preferito...), non solo quando si è
        // davvero su "Le mie escursioni" - senza questa guardia partirebbe una fetch
        // delle sessioni per una sezione nascosta a ogni azione fatta altrove. Quando la
        // sezione torna visibile, triggerSectionRender (app.js) richiama comunque
        // refreshState()+renderMyHikes() da capo: niente resta mai vecchio a schermo.
        const sezione = document.getElementById('my-hikes');
        if (!sezione || !sezione.classList.contains('active')) return;

        // Le voci-escursione vengono da window.CamoscioState, già in memoria: si
        // disegnano SEMPRE, anche se la fetch delle sessioni qui sotto fallisce. Cosa
        // significa "degradare" in questa lista: si vede di meno (mancano le uscite
        // registrate), mai qualcosa di sbagliato.
        const db = window.CamoscioState;

        // Punto 113: le sessioni servono PRIMA di costruire le voci-escursione, per sapere
        // quali "escursioni completate" hanno una traccia GPS collegata (quindi pubblicabile
        // nel feed) e quali no. La deduplicazione per hikeId più sotto resta identica.
        let sessioni = [];
        let erroreSessioni = false;
        try {
            const res = await fetch('/api/tracking/sessions');
            if (!res.ok) throw new Error('richiesta fallita');
            sessioni = await res.json();
        } catch (e) {
            console.error('Impossibile caricare lo storico delle uscite:', e);
            erroreSessioni = true;
        }

        const vociHike = (fatte || []).map(h => {
            const completion = (db.completions || []).find(c => c.hikeId === h.id);
            // Di norma un'escursione in 'fatte' ha un Completion di questo utente.
            // Eccezione: quella chiusa in gruppo dal creatore (groupCompletedAt) di cui
            // il Completion manca - mai creato, o cancellato per errore dalla lista
            // "Completate". classificaMieEscursioni (social.js) la tiene comunque fra le
            // completate; qui va disegnata lo stesso o sparirebbe da ogni vista. Senza
            // Completion si tolgono solo '⬆ carica gpx' e cestino (agiscono su un
            // completion.id che non c'è) - il resto della card è identico.
            if (!completion && !h.groupCompletedAt) return null;
            // Punto 113: la traccia GPS di questa escursione (dedotta dal hikeId). Se c'è, è
            // lei l'oggetto pubblicabile - è anche quella che usciteVisibili toglie qui sotto
            // per non mostrarla due volte. Se non c'è, il tasto lo spiega.
            const tracciaCollegata = sessioni.find(s => s.hikeId === h.id && (s.distanceKm || 0) > 0.05);
            const azioniCompletion = completion ? `
                <button class="btn btn-sm btn-secondary" style="padding:2px 6px;" onclick="uploadCompletionGpx('${completion.id}')" title="${esc(T('hikeCard.caricaGpxTitle') || 'Carica un file .gpx per avere il tempo reale di questa escursione')}">
                    <i data-lucide="upload"></i>
                </button>
                <button class="outing-card-del" onclick="deleteCompletion('${completion.id}', '${h.id}')" title="${esc(T('hikeCard.cancellaGiaFattaTitle') || "Cancella questa escursione dalle tue 'già fatte'")}" aria-label="${esc(T('hikeCard.cancellaGiaFattaTitle') || "Cancella questa escursione dalle tue 'già fatte'")}"><i data-lucide="trash-2"></i></button>
            ` : '';
            const azioni = `
                ${bottonePubblica(tracciaCollegata ? tracciaCollegata.id : null, tracciaCollegata ? tracciaCollegata.publishedAt : null, tracciaCollegata ? tracciaCollegata.importedName : null)}
                ${tracciaCollegata ? bottoneRinomina(tracciaCollegata.id, tracciaCollegata.importedName) : ''}
                ${azioniCompletion}
            `;
            return {
                ordinamento: Date.parse(h.date) || 0,
                hikeIdCollegato: h.id,
                // Punto 115: se la traccia collegata e' stata rinominata con la matita, la
                // card mostra QUEL nome invece del titolo dell'escursione - cosi' la
                // rinomina ha un effetto visibile anche qui, non solo nel feed.
                html: window.CamoscioSchedeCompatte.escursione(h, completion, {
                    azioniHtml: azioni,
                    nomeUscita: tracciaCollegata ? tracciaCollegata.importedName : null
                })
            };
        }).filter(Boolean);

        const hikeIdGiaRappresentati = new Set(vociHike.map(v => v.hikeIdCollegato));

        // Le sessioni senza nemmeno un punto GPS non si mostrano: sono avvii annullati
        // o prove finite subito (ce n'e' piu' d'una sul database, da prove vere fatte dal
        // telefono). In un elenco di uscite fatte direbbero solo "0 km, 0 min".
        // IL CONTATORE CONTA QUELLO CHE SI VEDE, non tutte le sessioni (punto 15, stessa
        // regola di sempre - vedi la spiegazione storica lasciata più sotto in questo file).
        // Soglia e deduplicazione condivise con userprofile.js (bugfix 21/08/2026,
        // usciteVisibili li' - il profilo mostrava sia le sessioni-spazzatura sia i
        // duplicati che questa funzione toglie qui da sempre): mai due copie della stessa
        // regola che possono divergere in silenzio.
        const vociUscita = window.CamoscioUsciteVisibili(sessioni, hikeIdGiaRappresentati)
            .map(s => ({
                ordinamento: Date.parse(s.startedAt) || 0,
                html: window.CamoscioSchedeCompatte.uscita(s, {
                    azioniHtml: `${bottonePubblica(s.id, s.publishedAt, s.importedName)} ${bottoneRinomina(s.id, s.importedName)} <button class="outing-card-del" data-del-outing="${esc(s.id)}" title="${esc(T('outing.cancellaTitle') || 'Cancella questa uscita dallo storico')}" aria-label="${esc(T('outing.cancellaTitle') || 'Cancella questa uscita dallo storico')}"><i data-lucide="trash-2"></i></button>`
                })
            }));

        const tutte = [...vociHike, ...vociUscita].sort((a, b) => b.ordinamento - a.ordinamento);
        if (contatore) contatore.textContent = tutte.length;

        if (tutte.length === 0 && !erroreSessioni) {
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">
                ${esc(T('myHikes.completateVuoto') || "Nessuna escursione completata per ora. Dopo un'uscita ricordati di segnarla come completata, oppure carica qui sopra un file .gpx di un'uscita già fatta.")}
            </div>`;
            return;
        }

        const avvisoErrore = erroreSessioni
            ? `<div class="glass-card text-center py-3 text-muted">${esc(T('myHikes.erroreCaricaUscite') || "Le escursioni completate sono aggiornate; non è stato possibile caricare anche le uscite registrate col GPS. Riprova più tardi.")}</div>`
            : '';
        box.innerHTML = avvisoErrore + (tutte.length ? `<div class="outings-grid">${tutte.map(v => v.html).join('')}</div>` : '');

        // Un ascoltatore solo sul contenitore invece di uno per scheda: le schede vengono
        // ridisegnate ad ogni caricamento, e agganciarli uno per uno vorrebbe dire
        // riagganciarli ogni volta (e ricordarsi di farlo).
        box.querySelectorAll('[data-del-outing]').forEach(b => {
            b.addEventListener('click', () => cancellaUscita(b.getAttribute('data-del-outing')));
        });
        // Punto 115: pubblica/rinomina, delegati come la cancellazione qui sopra.
        box.querySelectorAll('[data-pub-outing]').forEach(b => {
            b.addEventListener('click', () => togglePubblicaUscita(
                b.getAttribute('data-pub-outing'),
                b.hasAttribute('data-published'),
                b.getAttribute('data-outing-name') || ''
            ));
        });
        box.querySelectorAll('[data-pub-notrack]').forEach(b => {
            b.addEventListener('click', () => avvisoPubblicaSenzaTraccia());
        });
        box.querySelectorAll('[data-rename-outing]').forEach(b => {
            b.addEventListener('click', () => rinominaUscita(
                b.getAttribute('data-rename-outing'),
                b.getAttribute('data-outing-name') || ''
            ));
        });

        if (window.lucide) window.lucide.createIcons();
    }

    // --- PUNTO 115: RINOMINA DI UN'USCITA ---
    async function rinominaUscita(sessionId, nomeAttuale) {
        if (!window.showPromptModal) return;
        const nuovo = await window.showPromptModal(
            T('outing.rinominaPrompt') || 'Nuovo nome dell\'uscita (lascia vuoto per tornare alla data).',
            nomeAttuale || ''
        );
        if (nuovo === null) return; // annullato
        const nome = (nuovo || '').trim().slice(0, 120);
        if (nome === (nomeAttuale || '').trim()) return; // nessun cambiamento
        try {
            const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(sessionId)}/name`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nome })
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                if (window.showToast) window.showToast(d.error || (T('outing.rinominaErrore') || 'Non è stato possibile rinominare l\'uscita.'), 'error');
                return;
            }
            if (window.showToast) window.showToast(nome ? (T('outing.rinominata') || 'Uscita rinominata.') : (T('outing.nomeTolto') || 'Nome rimosso: torna a mostrare la data.'), 'success');
            if (window.renderMyHikes) window.renderMyHikes();
        } catch (e) {
            console.error('Rinomina uscita fallita:', e);
            if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
        }
    }

    // --- CANCELLAZIONE DI UN'USCITA ---
    //
    // La conferma dice tre cose precise, perche' sono le tre che uno si chiede prima di
    // premere: che i chilometri spariranno dai totali, che il posto nel mese torna
    // disponibile se era un file importato, e che i badge conquistati RESTANO (vedi la
    // spiegazione nella rotta DELETE in routes/tracking.js: non e' registrato perche' un
    // timbro sia stato preso, quindi revocarlo rischierebbe di togliere un badge vero).
    async function cancellaUscita(id) {
        const scheda = document.querySelector(`.outing-card[data-outing-id="${id}"]`);
        const fallbackTitolo = T('outing.questaUscita') || 'questa uscita';
        const titolo = scheda ? (scheda.querySelector('.outing-card-title')?.textContent || fallbackTitolo) : fallbackTitolo;
        const importata = !!(scheda && scheda.querySelector('.outing-tag i[data-lucide="upload"], .outing-tag svg.lucide-upload'));

        const righe = [
            T('outing.cancellaTitolo', titolo) || `Cancellare "${titolo}" dallo storico?`,
            '',
            T('outing.cancellaTotaliSpariscono') || 'I suoi chilometri e il dislivello spariranno dai totali della Dashboard.',
            importata
                ? (T('outing.cancellaPostoLibero') || 'Essendo un file importato, il posto che occupa nel tetto mensile torna libero.')
                : (T('outing.cancellaRegistrataAttenzione') || 'Attenzione: questa uscita e\' stata REGISTRATA col GPS, quindi sono dati misurati sul posto e non si possono ricaricare da nessun file.'),
            '',
            T('outing.cancellaBadgeRestano') || 'I badge che hai conquistato restano nel passaporto.'
        ];
        const procedi = window.showConfirmModal
            ? await window.showConfirmModal(righe.join('\n'), T('common.elimina') || 'Elimina', { cancelLabel: T('common.cancella') || 'Cancella', danger: true })
            : true;
        if (!procedi) return;

        try {
            const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const dati = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (window.showToast) window.showToast(dati.error || (T('outing.erroreCancella') || 'Non è stato possibile cancellare l\'uscita.'), 'error');
                return;
            }
            if (window.showToast) window.showToast(T('outing.cancellataSuccesso') || 'Uscita cancellata dallo storico.', 'success');

            // Punto 80/B: non piu' renderStorico() (la sezione non esiste piu' da sola) -
            // renderMyHikes() ridisegna anche i contatori in cima alla pagina, non solo la
            // lista, e a cascata richiama renderCompletate() qui sotto con le hike fresche.
            if (window.renderMyHikes) window.renderMyHikes();
            // I totali cambiano, e cambia anche quanti file puoi ancora caricare questo
            // mese: si rileggono entrambi invece di lasciare due numeri vecchi a schermo.
            if (window.renderDashboard) window.renderDashboard();
            aggiornaQuotaDalServer();
        } catch (e) {
            console.error('Cancellazione uscita fallita:', e);
            if (window.showToast) window.showToast(T('common.erroreServer') || 'Non è stato possibile contattare il server.', 'error');
        }
    }

    // Quanti file risultano caricati questo mese, secondo il server. Si ricava dallo storico
    // stesso (le uscite importate di questo mese) invece di aggiungere una rotta solo per un
    // numero che si puo' contare da dati che il browser ha gia'.
    async function aggiornaQuotaDalServer() {
        try {
            const res = await fetch('/api/tracking/sessions');
            if (!res.ok) return;
            const sessioni = await res.json();
            const ora = new Date();
            const importateQuestoMese = sessioni.filter(s => {
                if (s.importedFrom !== 'gpx') return false;
                // La data del CARICAMENTO sta nell'_id (ObjectId): i primi 8 caratteri esadecimali
                // sono i secondi Unix. Si usa quella e non startedAt, che e' la data
                // dell'escursione e per un file del 2019 sarebbe il conto sbagliato.
                const secondi = parseInt(String(s.id).slice(0, 8), 16);
                if (!Number.isFinite(secondi)) return false;
                const caricato = new Date(secondi * 1000);
                return caricato.getFullYear() === ora.getFullYear() && caricato.getMonth() === ora.getMonth();
            }).length;
            aggiornaNotaQuota(importateQuestoMese, 5);
        } catch (e) { /* la nota resta com'e': non vale un messaggio d'errore */ }
    }

    // La card compatta di una singola uscita ora vive in userprofile.js
    // (schedaUscitaProfilo, esportata come window.CamoscioSchedeCompatte.uscita) - punto
    // 80/B, per non avere due copie della stessa formula fra questo file e il profilo.

    // --- CARICAMENTO DI UN FILE .GPX ---

    function mostraEsito(html, tipo) {
        const box = document.getElementById('gpx-import-result');
        if (!box) return;
        box.className = `gpx-import-result ${tipo}`;
        box.innerHTML = html;
        if (window.lucide) window.lucide.createIcons();
    }

    async function caricaFile(file) {
        if (!file) return;

        // Controlli fatti prima di leggere il file: dire subito cosa non va e' meglio
        // che far aspettare un invio destinato a fallire.
        // Punto 114: accettiamo .gpx (testo) e .fit (binario). Il .fit e' il formato
        // nativo di Garmin: il .gpx che Garmin Connect esporta e' gia' una copia
        // degradata, con buchi temporali che fanno rifiutare lo split cammino/pause.
        const eFit = /\.fit$/i.test(file.name);
        if (!eFit && !/\.gpx$/i.test(file.name)) {
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${T('gpx.estensioneErrata', esc(file.name)) || `Il file deve avere estensione <b>.gpx</b> o <b>.fit</b>. Hai scelto "${esc(file.name)}".`}</span>`, 'errore');
        }
        const tetto = eFit ? MAX_BYTE_FIT : MAX_BYTE_GPX;
        if (file.size > tetto) {
            const mb = (tetto / 1024 / 1024).toFixed(0);
            const pesa = (file.size / 1024 / 1024).toFixed(1);
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${T('gpx.filePesa', pesa, mb) || `Il file pesa ${pesa} MB, oltre il limite di ${mb} MB. Un'escursione registrata normalmente sta sotto 1 MB.`}</span>`, 'errore');
        }

        mostraEsito(`<i data-lucide="loader"></i> <span>${T('gpx.stoLeggendo', esc(file.name)) || `Sto leggendo "${esc(file.name)}"…`}</span>`, 'attesa');

        // Il payload che viaggia nel JSON: { gpx: "<testo>" } oppure { fit: "<base64>" }.
        // Tenuto come oggetto solo, cosi' l'eventuale reinvio con la data (ramo 422 qui
        // sotto, solo .gpx) non deve sapere da che formato veniva.
        let payload;
        try {
            payload = eFit
                ? { fit: await window.fileToBase64(file) }
                : { gpx: await file.text() };
        } catch (e) {
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${T('hikeToast.fileNonLetto') || 'Non è stato possibile leggere il file.'}</span>`, 'errore');
        }

        try {
            let res = await fetch('/api/tracking/import-gpx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            let dati = await res.json();

            // PUNTO 32: il file non ha gli orari, quindi il giorno dell'escursione lo deve
            // dire l'utente. Il server ha risposto 422 senza salvare niente (e senza
            // consumare un posto del mese): si chiede la data e si rimanda.
            if (res.status === 422 && dati.richiedeData) {
                const esito = await chiediData(file, dati);
                if (!esito) {
                    return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${T('gpx.caricamentoAnnullato') || "Caricamento annullato: senza il giorno dell'escursione la traccia non entra nello storico."}</span>`, 'errore');
                }
                mostraEsito(`<i data-lucide="loader"></i> <span>${T('gpx.stoImportando', esc(file.name)) || `Sto importando "${esc(file.name)}"…`}</span>`, 'attesa');
                res = await fetch('/api/tracking/import-gpx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, dataUscita: esito })
                });
                dati = await res.json();
            }

            if (!res.ok) {
                // Il server manda un messaggio gia' scritto per l'utente e che spiega il
                // motivo vero (file senza orari, traccia fuori regione, tetto mensile...):
                // si mostra quello invece di un "errore" generico. dati.error viene dal
                // server e resta sempre in italiano (dizionario i18n solo lato client) -
                // tradotto solo il ripiego per quando il server non manda un messaggio suo.
                return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${esc(dati.error || (T('gpx.importazioneNonRiuscita') || 'Importazione non riuscita.'))}</span>`, 'errore');
            }

            const avvisi = (dati.avvisi || []).length
                ? `<div class="gpx-import-warn">${dati.avvisi.map(a => esc(a)).join('<br>')}</div>`
                : '';

            // I badge conquistati dalla traccia. Vanno detti QUI e non lasciati scoprire
            // per caso nella pagina Badge: e' il momento in cui l'utente sta guardando, ed
            // e' la ricompensa di quello che ha appena fatto.
            const badge = (dati.badge || []).length
                ? `<div class="gpx-import-badges">
                       <b>${dati.badge.length === 1 ? (T('gpx.badgeConquistato') || 'Badge conquistato') : (T('gpx.badgeConquistati') || 'Badge conquistati')}:</b>
                       ${dati.badge.map(b => `${esc(b.emoji)} ${esc(b.nome)}`).join(' · ')}
                       <br><span class="small text-muted">${T('gpx.aggiuntiPassaporto') || "Aggiunti al tuo passaporto con la data dell'escursione."}</span>
                   </div>`
                : '';

            const kmTxt = formattaDecimale(dati.distanzaKm);
            const tempoTxt = dati.durataIgnota
                ? (T('gpx.durataNonDisponibile') || ', durata non disponibile')
                : `, ${durata(dati.durataSecondi)}`;

            mostraEsito(`
                <i data-lucide="circle-check-big"></i>
                <span>
                    ${T('gpx.titoloImportata', esc(dati.nome || (T('gpx.uscitaFallback') || 'Uscita')), dataItaliana(dati.inizio)) || `<b>${esc(dati.nome || 'Uscita')} del ${dataItaliana(dati.inizio)}</b> importata.`}
                    ${kmTxt} km,
                    ${Math.round(dati.dislivelloM || 0)} ${T('gpx.mDislivelloLabel') || 'm di dislivello'}${tempoTxt}.
                    <br>
                    <span class="small text-muted">
                        ${T('gpx.puntiSalvatiFrase', formattaNumero(dati.puntiLetti), formattaNumero(dati.puntiSalvati)) || `${dati.puntiLetti.toLocaleString('it-IT')} punti nel file, ${dati.puntiSalvati.toLocaleString('it-IT')} salvati dopo la semplificazione (il percorso disegnato resta lo stesso, occupa molto meno spazio).`}
                        ${T('gpx.haiCaricato', dati.caricatiQuestoMese, dati.massimoAlMese) || `Hai caricato ${dati.caricatiQuestoMese} file su ${dati.massimoAlMese} questo mese.`}
                    </span>
                    ${badge}
                    ${avvisi}
                </span>`, 'ok');

            aggiornaNotaQuota(dati.caricatiQuestoMese, dati.massimoAlMese);
            // Punto 80/B: vedi la stessa nota in cancellaUscita qui sopra - renderMyHikes()
            // e non piu' renderStorico(), che non esiste piu' da solo.
            if (window.renderMyHikes) window.renderMyHikes();

            // Se sono stati conquistati dei badge, i timbri sul database sono cambiati e
            // quelli in memoria no: senza rileggerli, il Passaporto e la pagina Badge
            // continuerebbero a mostrare quel badge come "non ancora conquistato" proprio
            // mentre il messaggio qui sopra dice che l'hai preso. refreshState() e' la
            // funzione che ricarica anche i timbri (vedi app.js).
            if ((dati.badge || []).length && window.refreshState) {
                await window.refreshState();
                if (window.renderBadges) window.renderBadges();
            }
            // I totali della Dashboard cambiano: si ridisegna, cosi' i due posti non
            // raccontano due cose diverse finche' non si ricarica la pagina.
            if (window.renderDashboard) window.renderDashboard();
        } catch (e) {
            console.error('Errore importazione .gpx:', e);
            mostraEsito(`<i data-lucide="circle-alert"></i> <span>${(T('common.erroreServer') || 'Non è stato possibile contattare il server.') + ' ' + (T('gpx.riprova') || 'Riprova.')}</span>`, 'errore');
        }
    }

    // Chiede all'utente il giorno dell'escursione per un file senza orari.
    // Restituisce "YYYY-MM-DD", oppure null se ha annullato.
    //
    // LA DATA PROPOSTA NON SI PRESENTA COME CERTA, ed e' il punto di tutta questa
    // finestra: viene dall'intestazione del file, che in molti programmi e' il momento
    // dell'ESPORTAZIONE e non della camminata. Se la si scrivesse nel campo senza dirlo,
    // uno confermerebbe a occhi chiusi una data sbagliata - che e' esattamente quello che
    // e' successo prima che questa finestra esistesse.
    async function chiediData(file, dati) {
        const nomeFile = esc(dati.nome || file.name);
        const km = formattaDecimale(dati.distanzaKm);
        const righe = [
            T('gpx.nonContieneOrari', nomeFile) || `"${dati.nome || file.name}" non contiene gli orari dei punti.`,
            '',
            T('gpx.tracciaBuona', km, Math.round(dati.dislivelloM || 0)) || `La traccia è buona (${km} km, ${Math.round(dati.dislivelloM || 0)} m di dislivello), ma senza orari il sito non può sapere che giorno hai camminato.`,
            '',
            dati.dataProposta
                ? (T('gpx.dataNelFile', italiana(dati.dataProposta)) || `Nel file c'è la data ${italiana(dati.dataProposta)}, ma spesso è il giorno in cui hai ESPORTATO il file, non quello dell'escursione. Controllala.`)
                : (T('gpx.nessunaDataNelFile') || 'Nel file non c\'è nessuna data.'),
            '',
            T('gpx.cheGiornoEra') || 'Che giorno era?'
        ];
        const scelta = window.showDateModal
            ? await window.showDateModal(righe.join('\n'), dati.dataProposta || '', T('gpx.importaBtn') || 'Importa')
            : await window.showPromptModal(righe.join('\n'), dati.dataProposta || '');

        if (!scelta) return null;
        const pulita = String(scelta).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pulita)) {
            if (window.showToast) window.showToast(T('gpx.dataNonValida') || 'Data non valida: serve nel formato giorno/mese/anno.', 'error');
            return null;
        }
        return pulita;
    }

    // "2026-06-14" -> "14/06/2026". Si spezza la stringa invece di usare new Date(): una
    // data "YYYY-MM-DD" viene letta come mezzanotte UTC e in un fuso dietro Greenwich
    // mostrerebbe il giorno prima (stessa trappola gia' scritta in badges.js).
    function italiana(iso) {
        const p = String(iso || '').split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || '');
    }

    function aggiornaNotaQuota(caricati, massimo) {
        const nota = document.getElementById('gpx-quota-note');
        if (nota && Number.isFinite(caricati)) {
            nota.textContent = T('gpx.neHaiCaricati', caricati, massimo) || ` Ne hai caricati ${caricati} su ${massimo} questo mese.`;
        }
    }

    function initStorico() {
        const bottone = document.getElementById('btn-gpx-choose');
        const input = document.getElementById('gpx-file-input');
        if (!bottone || !input) return;

        bottone.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            // Si azzera SEMPRE il valore, altrimenti riscegliere lo stesso file non
            // fa scattare "change" e sembra che il pulsante non funzioni.
            input.value = '';
            caricaFile(file);
        });
    }

    // Punto 80/B: non piu' window.renderStorico - l'unico chiamante esterno era
    // triggerSectionRender (app.js), che ora passa da renderMyHikes() (social.js) come
    // ogni altra azione di questa pagina. renderCompletate resta pensata per un solo
    // chiamante, renderMyHikes: nessun altro deve richiamarla direttamente, altrimenti i
    // contatori in cima a "Le mie escursioni" restano vecchi.
    window.renderCompletate = renderCompletate;
    window.initStorico = initStorico;
    // Punto 113: usati dagli onclick dei tasti "Pubblica nel feed" sulle card.
    window.togglePubblicaUscita = togglePubblicaUscita;
    window.avvisoPubblicaSenzaTraccia = avvisoPubblicaSenzaTraccia;
})();
