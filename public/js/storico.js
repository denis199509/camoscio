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
    // Lo stesso limite del server (routes/tracking.js). Controllato anche qui per
    // dire subito che il file e' troppo grande, invece di far partire un invio da
    // decine di MB che verrebbe comunque rifiutato.
    const MAX_BYTE_GPX = 10 * 1024 * 1024;

    function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

    function dataItaliana(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function durata(secondi) {
        if (!secondi || secondi < 60) return '—';
        const ore = Math.floor(secondi / 3600);
        const minuti = Math.round((secondi % 3600) / 60);
        return ore > 0 ? `${ore}h ${minuti}min` : `${minuti} min`;
    }

    // --- ELENCO DELLE USCITE ---

    async function renderStorico() {
        const box = document.getElementById('outings-list');
        if (!box) return;

        let sessioni = [];
        try {
            const res = await fetch('/api/tracking/sessions');
            if (!res.ok) throw new Error('richiesta fallita');
            sessioni = await res.json();
        } catch (e) {
            console.error('Impossibile caricare lo storico delle uscite:', e);
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">Non è stato possibile caricare lo storico. Riprova più tardi.</div>`;
            return;
        }

        const contatore = document.getElementById('count-outings');
        if (contatore) contatore.textContent = sessioni.length;

        // Le sessioni senza nemmeno un punto GPS non si mostrano: sono avvii annullati
        // o prove finite subito (ce n'e' piu' d'una sul database, da prove vere fatte dal
        // telefono). In un elenco di uscite fatte direbbero solo "0 km, 0 min".
        const vere = sessioni.filter(s => (s.distanceKm || 0) > 0.05);

        if (vere.length === 0) {
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">
                Nessuna uscita registrata per ora. Avvia il tracciamento dalla Mappa durante
                un'escursione, oppure carica qui sopra un file .gpx di un'uscita già fatta.
            </div>`;
            return;
        }

        box.innerHTML = `<div class="outings-grid">${vere.map(schedaUscita).join('')}</div>`;

        // Un ascoltatore solo sul contenitore invece di uno per scheda: le schede vengono
        // ridisegnate ad ogni caricamento, e agganciarli uno per uno vorrebbe dire
        // riagganciarli ogni volta (e ricordarsi di farlo).
        box.querySelectorAll('[data-del-outing]').forEach(b => {
            b.addEventListener('click', () => cancellaUscita(b.getAttribute('data-del-outing')));
        });

        if (window.lucide) window.lucide.createIcons();
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
        const titolo = scheda ? (scheda.querySelector('.outing-card-title')?.textContent || 'questa uscita') : 'questa uscita';
        const importata = !!(scheda && scheda.querySelector('.outing-tag i[data-lucide="upload"], .outing-tag svg.lucide-upload'));

        const righe = [
            `Cancellare "${titolo}" dallo storico?`,
            '',
            'I suoi chilometri e il dislivello spariranno dai totali della Dashboard.',
            importata
                ? 'Essendo un file importato, il posto che occupa nel tetto mensile torna libero.'
                : 'Attenzione: questa uscita e\' stata REGISTRATA col GPS, quindi sono dati misurati sul posto e non si possono ricaricare da nessun file.',
            '',
            'I badge che hai conquistato restano nel passaporto.'
        ];
        const procedi = window.showConfirmModal
            ? await window.showConfirmModal(righe.join('\n'), 'Cancella')
            : true;
        if (!procedi) return;

        try {
            const res = await fetch(`/api/tracking/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const dati = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (window.showToast) window.showToast(dati.error || 'Non è stato possibile cancellare l\'uscita.', 'error');
                return;
            }
            if (window.showToast) window.showToast('Uscita cancellata dallo storico.', 'success');

            await renderStorico();
            // I totali cambiano, e cambia anche quanti file puoi ancora caricare questo
            // mese: si rileggono entrambi invece di lasciare due numeri vecchi a schermo.
            if (window.renderDashboard) window.renderDashboard();
            aggiornaQuotaDalServer();
        } catch (e) {
            console.error('Cancellazione uscita fallita:', e);
            if (window.showToast) window.showToast('Non è stato possibile contattare il server.', 'error');
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

    function schedaUscita(s) {
        const importata = s.importedFrom === 'gpx';
        const titolo = importata && s.importedName
            ? esc(s.importedName)
            : dataItaliana(s.startedAt);

        // Il sottotitolo ripete la data solo quando il titolo e' un nome, per non
        // scrivere due volte la stessa cosa.
        const sottotitolo = (importata && s.importedName) ? dataItaliana(s.startedAt) : '';

        return `
            <div class="outing-card" data-outing-id="${esc(s.id)}">
                <div class="outing-card-head">
                    <span class="outing-card-title">${titolo}</span>
                    ${importata
                        ? `<span class="badge badge-accent outing-tag" title="Traccia caricata da un file .gpx, non registrata dal sito"><i data-lucide="upload"></i> importata</span>`
                        : `<span class="badge badge-green outing-tag" title="Registrata col GPS durante l'escursione"><i data-lucide="satellite-dish"></i> registrata</span>`}
                    <button class="outing-card-del" data-del-outing="${esc(s.id)}"
                            title="Cancella questa uscita dallo storico"
                            aria-label="Cancella questa uscita dallo storico"><i data-lucide="trash-2"></i></button>
                </div>
                ${sottotitolo ? `<span class="outing-card-sub">${sottotitolo}</span>` : ''}
                <div class="outing-card-stats">
                    <div><strong>${(s.distanceKm || 0).toFixed(1).replace('.', ',')}</strong><span>km</span></div>
                    <div><strong>${Math.round(s.elevationGainM || 0)}</strong><span>m disliv.</span></div>
                    ${s.durationUnknown
                        // Il file non aveva gli orari: si scrive che la durata non si sa,
                        // invece di un trattino muto che sembrerebbe un dato mancante per
                        // sbaglio. Il titolo spiega anche la conseguenza, che e' la cosa
                        // che uno si chiede guardando la Dashboard.
                        ? `<div title="Il file .gpx non conteneva gli orari dei punti, quindi la durata non si può ricavare. Questa uscita non entra nel tempo totale né nella velocità media, che restano così corretti."><strong>—</strong><span>durata ignota</span></div>`
                        : `<div><strong>${durata(s.durationSeconds)}</strong><span>durata</span></div>`}
                </div>
            </div>`;
    }

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
        if (!/\.gpx$/i.test(file.name)) {
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>Il file deve avere estensione <b>.gpx</b>. Hai scelto "${esc(file.name)}".</span>`, 'errore');
        }
        if (file.size > MAX_BYTE_GPX) {
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>Il file pesa ${(file.size / 1024 / 1024).toFixed(1)} MB, oltre il limite di 10 MB. Un'escursione registrata normalmente sta sotto 1 MB.</span>`, 'errore');
        }

        mostraEsito(`<i data-lucide="loader"></i> <span>Sto leggendo "${esc(file.name)}"…</span>`, 'attesa');

        let testo;
        try {
            testo = await file.text();
        } catch (e) {
            return mostraEsito(`<i data-lucide="circle-alert"></i> <span>Non è stato possibile leggere il file.</span>`, 'errore');
        }

        try {
            let res = await fetch('/api/tracking/import-gpx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gpx: testo })
            });
            let dati = await res.json();

            // PUNTO 32: il file non ha gli orari, quindi il giorno dell'escursione lo deve
            // dire l'utente. Il server ha risposto 422 senza salvare niente (e senza
            // consumare un posto del mese): si chiede la data e si rimanda.
            if (res.status === 422 && dati.richiedeData) {
                const esito = await chiediData(file, dati);
                if (!esito) {
                    return mostraEsito(`<i data-lucide="circle-alert"></i> <span>Caricamento annullato: senza il giorno dell'escursione la traccia non entra nello storico.</span>`, 'errore');
                }
                mostraEsito(`<i data-lucide="loader"></i> <span>Sto importando "${esc(file.name)}"…</span>`, 'attesa');
                res = await fetch('/api/tracking/import-gpx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gpx: testo, dataUscita: esito })
                });
                dati = await res.json();
            }

            if (!res.ok) {
                // Il server manda un messaggio gia' scritto per l'utente e che spiega il
                // motivo vero (file senza orari, traccia fuori regione, tetto mensile...):
                // si mostra quello invece di un "errore" generico.
                return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${esc(dati.error || 'Importazione non riuscita.')}</span>`, 'errore');
            }

            const avvisi = (dati.avvisi || []).length
                ? `<div class="gpx-import-warn">${dati.avvisi.map(a => esc(a)).join('<br>')}</div>`
                : '';

            // I badge conquistati dalla traccia. Vanno detti QUI e non lasciati scoprire
            // per caso nella pagina Badge: e' il momento in cui l'utente sta guardando, ed
            // e' la ricompensa di quello che ha appena fatto.
            const badge = (dati.badge || []).length
                ? `<div class="gpx-import-badges">
                       <b>${dati.badge.length === 1 ? 'Badge conquistato' : 'Badge conquistati'}:</b>
                       ${dati.badge.map(b => `${esc(b.emoji)} ${esc(b.nome)}`).join(' · ')}
                       <br><span class="small text-muted">Aggiunti al tuo passaporto con la data dell'escursione.</span>
                   </div>`
                : '';

            mostraEsito(`
                <i data-lucide="circle-check-big"></i>
                <span>
                    <b>${esc(dati.nome || 'Uscita')} del ${dataItaliana(dati.inizio)}</b> importata.
                    ${(dati.distanzaKm || 0).toFixed(1).replace('.', ',')} km,
                    ${Math.round(dati.dislivelloM || 0)} m di dislivello${dati.durataIgnota
                        ? ', durata non disponibile'
                        : `, ${durata(dati.durataSecondi)}`}.
                    <br>
                    <span class="small text-muted">
                        ${dati.puntiLetti.toLocaleString('it-IT')} punti nel file, ${dati.puntiSalvati.toLocaleString('it-IT')} salvati
                        dopo la semplificazione (il percorso disegnato resta lo stesso, occupa molto meno spazio).
                        Hai caricato ${dati.caricatiQuestoMese} file su ${dati.massimoAlMese} questo mese.
                    </span>
                    ${badge}
                    ${avvisi}
                </span>`, 'ok');

            aggiornaNotaQuota(dati.caricatiQuestoMese, dati.massimoAlMese);
            await renderStorico();

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
            mostraEsito(`<i data-lucide="circle-alert"></i> <span>Non è stato possibile contattare il server. Riprova.</span>`, 'errore');
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
        const km = (dati.distanzaKm || 0).toFixed(1).replace('.', ',');
        const righe = [
            `"${dati.nome || file.name}" non contiene gli orari dei punti.`,
            '',
            `La traccia è buona (${km} km, ${Math.round(dati.dislivelloM || 0)} m di dislivello), ma senza orari il sito non può sapere che giorno hai camminato.`,
            '',
            dati.dataProposta
                ? `Nel file c'è la data ${italiana(dati.dataProposta)}, ma spesso è il giorno in cui hai ESPORTATO il file, non quello dell'escursione. Controllala.`
                : 'Nel file non c\'è nessuna data.',
            '',
            'Che giorno era?'
        ];
        const scelta = window.showDateModal
            ? await window.showDateModal(righe.join('\n'), dati.dataProposta || '', 'Importa')
            : await window.showPromptModal(righe.join('\n'), dati.dataProposta || '');

        if (!scelta) return null;
        const pulita = String(scelta).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pulita)) {
            if (window.showToast) window.showToast('Data non valida: serve nel formato giorno/mese/anno.', 'error');
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
            nota.textContent = ` Ne hai caricati ${caricati} su ${massimo} questo mese.`;
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

    window.renderStorico = renderStorico;
    window.initStorico = initStorico;
})();
