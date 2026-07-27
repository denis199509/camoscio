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
        if (window.lucide) window.lucide.createIcons();
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
            <div class="outing-card">
                <div class="outing-card-head">
                    <span class="outing-card-title">${titolo}</span>
                    ${importata
                        ? `<span class="badge badge-accent outing-tag" title="Traccia caricata da un file .gpx, non registrata dal sito"><i data-lucide="upload"></i> importata</span>`
                        : `<span class="badge badge-green outing-tag" title="Registrata col GPS durante l'escursione"><i data-lucide="satellite-dish"></i> registrata</span>`}
                </div>
                ${sottotitolo ? `<span class="outing-card-sub">${sottotitolo}</span>` : ''}
                <div class="outing-card-stats">
                    <div><strong>${(s.distanceKm || 0).toFixed(1).replace('.', ',')}</strong><span>km</span></div>
                    <div><strong>${Math.round(s.elevationGainM || 0)}</strong><span>m disliv.</span></div>
                    <div><strong>${durata(s.durationSeconds)}</strong><span>durata</span></div>
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
            const res = await fetch('/api/tracking/import-gpx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gpx: testo })
            });
            const dati = await res.json();

            if (!res.ok) {
                // Il server manda un messaggio gia' scritto per l'utente e che spiega il
                // motivo vero (file senza orari, traccia fuori regione, tetto mensile...):
                // si mostra quello invece di un "errore" generico.
                return mostraEsito(`<i data-lucide="circle-alert"></i> <span>${esc(dati.error || 'Importazione non riuscita.')}</span>`, 'errore');
            }

            const avvisi = (dati.avvisi || []).length
                ? `<div class="gpx-import-warn">${dati.avvisi.map(a => esc(a)).join('<br>')}</div>`
                : '';

            mostraEsito(`
                <i data-lucide="circle-check-big"></i>
                <span>
                    <b>${esc(dati.nome || 'Uscita')} del ${dataItaliana(dati.inizio)}</b> importata.
                    ${(dati.distanzaKm || 0).toFixed(1).replace('.', ',')} km,
                    ${Math.round(dati.dislivelloM || 0)} m di dislivello, ${durata(dati.durataSecondi)}.
                    <br>
                    <span class="small text-muted">
                        ${dati.puntiLetti.toLocaleString('it-IT')} punti nel file, ${dati.puntiSalvati.toLocaleString('it-IT')} salvati
                        dopo la semplificazione (il percorso disegnato resta lo stesso, occupa molto meno spazio).
                        Hai caricato ${dati.caricatiQuestoMese} file su ${dati.massimoAlMese} questo mese.
                    </span>
                    ${avvisi}
                </span>`, 'ok');

            aggiornaNotaQuota(dati.caricatiQuestoMese, dati.massimoAlMese);
            await renderStorico();
            // I totali della Dashboard cambiano: si ridisegna, cosi' i due posti non
            // raccontano due cose diverse finche' non si ricarica la pagina.
            if (window.renderDashboard) window.renderDashboard();
        } catch (e) {
            console.error('Errore importazione .gpx:', e);
            mostraEsito(`<i data-lucide="circle-alert"></i> <span>Non è stato possibile contattare il server. Riprova.</span>`, 'errore');
        }
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
