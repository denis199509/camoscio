// ==========================================================================
// BADGE — punto 18 di cose_da_fare.txt
// "Serve un tasto Badge che porti a una pagina con i badge dell'utente. La lista
//  completa la definira' l'utente in futuro: per ora inserirne qualcuno di prova
//  (qualche cima e qualche rifugio)."
//
// DECISIONI PRESE QUI, spiegate perche' non si debbano ricostruire da capo:
//
// 1) I BADGE NON SONO SALVATI SU MONGODB, si ricavano dai timbri che esistono gia'
//    (collezione Stamp, sbloccati con il geofencing della Mappa). Salvarli sarebbe
//    un documento per utente per badge che non aggiunge NIENTE a quello che il
//    database sa gia' - contro il vincolo hard sullo spazio scritto in cima a
//    cose_da_fare.txt. In piu' l'utente ha detto che la lista definitiva la
//    decidera' lui: una lista salvata andrebbe migrata ad ogni ripensamento,
//    una calcolata si aggiorna da sola cambiando questo file.
//
// 2) OGNI BADGE E' DAVVERO OTTENIBILE. Il geofencing (checkGeofencing in map.js)
//    guardava solo le vette elencate dentro le escursioni: aggiungere qui delle
//    cime che non stanno in nessuna escursione avrebbe creato badge impossibili
//    da prendere, cioe' una promessa che il sito non puo' mantenere - lo stesso
//    difetto tolto al punto 19 (le finte "sfide in corso") e al punto 21 (l'"SMS
//    satellitare inviato" che non partiva). Per questo map.js ora prende i punti
//    timbrabili da qui: questo file e' l'UNICO elenco, e tutto cio' che compare
//    nella pagina si puo' andare a prendere davvero.
//
// 3) L'ELENCO DEI BADGE NON STA PIU' QUI: dal 2026-07-27 e' in
//    public/js/badge-points.js, perche' serve anche al server (importando una
//    traccia .gpx i badge conquistati vengono assegnati da soli). E' una copia
//    sola letta da entrambi, e le regole per modificarla - gli stampId non si
//    cambiano mai, le coordinate vanno cercate su Overpass - sono scritte la',
//    accanto ai dati a cui si applicano, invece di essere ripetute qui.
// ==========================================================================

(function () {
    // Traduzione inglese (prova 22/08/2026, solo interfaccia - vedi i18n.js per
    // l'ambito e il perche'). Se il file non fosse caricato T('...') non
    // esiste: il ripiego e' sempre il "|| 'testo italiano'" al punto di
    // chiamata, stessa filosofia del CATALOGO_FISSO qui sotto - meglio restare
    // in italiano che rompere la pagina.
    const T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

    // L'elenco NON sta piu' qui. Dal 2026-07-27 e' in public/js/badge-points.js, perche'
    // serve anche al SERVER: importando una traccia .gpx i badge conquistati vengono
    // assegnati da solo, e quel conto lo fa il server. Una copia sola, letta da entrambi -
    // vedi la spiegazione lunga in cima a quel file. Per aggiungere un badge si scrive una
    // riga LA'; pagina, conteggio, geofencing e importazione si aggiornano da soli.
    // Se il file non fosse caricato si va avanti con le sole vette delle escursioni, come
    // faceva il sito prima del punto 18: meglio meno badge che una schermata rotta.
    const CATALOGO_FISSO = window.CAMOSCIO_BADGE_POINTS || [];

    // Catalogo completo = elenco fisso + le vette delle escursioni presenti sul
    // database che non siano gia' qui dentro. Cosi' chi crea un'escursione con una
    // vetta nuova si ritrova il badge corrispondente senza che nessuno tocchi il
    // codice, e non serve tenere due elenchi allineati a mano.
    function catalogo() {
        const perCodice = new Map(CATALOGO_FISSO.map(b => [b.stampId, b]));

        const hikes = (window.CamoscioState && window.CamoscioState.hikes) || [];
        hikes.forEach(h => {
            (h.peaks || []).forEach(p => {
                if (!p || !p.stampId || perCodice.has(p.stampId)) return;
                perCodice.set(p.stampId, {
                    stampId: p.stampId,
                    nome: p.name || 'Punto senza nome',
                    // In OSM come nel nostro modello non c'e' un campo che dica "e' un
                    // rifugio": lo si deduce dal nome. Nel dubbio e' una cima, che e' il
                    // verso giusto in cui sbagliare per un elenco di montagna.
                    tipo: /rifugio|bivacco|capanna|baita/i.test(p.name || '') ? 'rifugio' : 'cima',
                    quota: p.altitude || null,
                    lat: p.lat,
                    lng: p.lng,
                    zona: null,
                    regione: null,
                    emoji: /rifugio|bivacco|capanna|baita/i.test(p.name || '') ? '🛖' : '⛰️'
                });
            });
        });

        return Array.from(perCodice.values());
    }

    // Elenco dei punti che fanno scattare il timbro sulla Mappa. Restituito nella
    // STESSA forma delle vette delle escursioni ({name, lat, lng, altitude, stampId})
    // perche' checkGeofencing in map.js la usa gia' cosi': cambiare la forma avrebbe
    // voluto dire toccare anche i popup, senza guadagnarci niente.
    function puntiTimbrabili() {
        return catalogo()
            .filter(b => Number.isFinite(b.lat) && Number.isFinite(b.lng))
            .map(b => ({ name: b.nome, lat: b.lat, lng: b.lng, altitude: b.quota, stampId: b.stampId }));
    }

    // Catalogo + "questo l'ho preso, e quando", per un elenco di timbri qualunque.
    // Parametrizzata (non legge direttamente lo stato globale) per poter mostrare
    // anche i badge di un ALTRO utente nella sua pagina profilo: i timbri sono
    // "achievement pubblici tra utenti loggati" (vedi routes/stamps.js), quindi non
    // c'e' niente da nascondere, ma la logica di incrocio col catalogo va scritta
    // una volta sola.
    // "ascesePerVetta" e' facoltativo: {stampId: {recognizedCount, siteCount, total}},
    // punto 42b. Assente (pagine che non lo caricano) = badge senza il conteggio estra,
    // esattamente come si vedevano prima che il punto 42b esistesse.
    function statoBadgePer(timbri, ascesePerVetta) {
        const ascese = ascesePerVetta || {};
        return catalogo().map(b => {
            const timbro = timbri.find(t => t.stampId === b.stampId);
            const conteggio = ascese[b.stampId];
            return Object.assign({}, b, {
                sbloccato: !!timbro,
                data: timbro ? timbro.dateUnlocked : null,
                // Solo quando dice qualcosa in piu' di "una volta", che e' il caso quasi
                // sempre vero: un numero che ripete "1 volta" su ogni singolo badge del
                // sito sarebbe rumore, non informazione.
                ascesa: (timbro && conteggio && conteggio.total > 1) ? conteggio : null
            });
        });
    }

    // Stato badge dell'utente collegato: l'unica fonte e' db.stamps, cioe' i timbri
    // veri gia' caricati per lui. Nessun badge puo' risultare preso per qualcuno che
    // non l'ha preso davvero.
    function statoBadge() {
        return statoBadgePer(
            (window.CamoscioState && window.CamoscioState.stamps) || [],
            (window.CamoscioState && window.CamoscioState.peakAscents) || {}
        );
    }

    // Per la scheda del Passaporto in Dashboard, che ha spazio per pochi riquadri:
    // prima quelli presi (il piu' recente davanti), poi i piu' alti ancora da
    // prendere per riempire i posti liberi. Cosi' la scheda mostra sempre qualcosa
    // e mette davanti quello che l'utente ha fatto, non una fetta arbitraria.
    function anteprima(quanti) {
        const tutti = statoBadge();
        const presi = tutti.filter(b => b.sbloccato)
            .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
        const mancanti = tutti.filter(b => !b.sbloccato)
            .sort((a, b) => (b.quota || 0) - (a.quota || 0));
        return presi.concat(mancanti).slice(0, quanti);
    }

    // "2026-06-15" -> "15/06/2026". Il formato del database e' quello buono per ordinare
    // e confrontare, ma a schermo e' una data da macchina, e nella scheda andava pure a
    // capo in mezzo ("2026-06-" / "15").
    // Si spezza la stringa invece di usare new Date(): una data "YYYY-MM-DD" viene letta
    // come mezzanotte UTC, quindi in un fuso dietro Greenwich toLocaleDateString
    // mostrerebbe il giorno PRIMA - un timbro preso il 15 apparirebbe preso il 14.
    function dataItaliana(iso) {
        if (!iso) return '';
        const p = String(iso).split('-');
        if (p.length !== 3) return String(iso);
        return `${p[2]}/${p[1]}/${p[0]}`;
    }

    // --- DISEGNO DELLA PAGINA ---

    // Punto 42b: il numero deve sempre dire da dove viene (deciso il 29/07/2026, vedi
    // 03-Decisioni-Architetturali.md del vault) - un "73" da solo, fra sei mesi, non se lo
    // spiega piu' nessuno, nemmeno Denis. "Riconosciute" e' la parola scritta a mano da chi
    // conosce la persona, non una misura del sito: le due cose non vanno confuse in una
    // somma muta.
    function testoAscesa(a) {
        if (a.recognizedCount > 0 && a.siteCount > 0) {
            return T('badges.ascesa.entrambe', a.recognizedCount, a.siteCount)
                || `${a.recognizedCount} riconosciut${a.recognizedCount === 1 ? 'a' : 'e'} + ${a.siteCount} registrat${a.siteCount === 1 ? 'a' : 'e'}`;
        }
        if (a.recognizedCount > 0) {
            return T('badges.ascesa.soloRiconosciute', a.recognizedCount)
                || `${a.recognizedCount} riconosciut${a.recognizedCount === 1 ? 'a' : 'e'}`;
        }
        return T('badges.ascesa.soloSito', a.siteCount) || `${a.siteCount} volte registrate dal sito`;
    }

    // Livelli di frequentazione di una cima, decisi da Denis il 17/08/2026: soglie sul
    // totale ascesa.total (stesso numero gia' mostrato da testoAscesa, riconosciute +
    // registrate - punto 42b, un solo conto, mai due matematiche diverse). SOLO per le
    // cime: i nomi parlano sempre di "cima"/"vetta"/"montagna", su un rifugio visitato
    // piu' volte suonerebbero fuori posto. Ordinata dalla soglia piu' alta: il primo
    // elemento che total soddisfa e' il livello giusto.
    // "id" aggiunto il 22/08/2026 per la traduzione inglese (T('badges.livello.' +
    // id + '.titolo'), vedi livelloAscesa/schedaBadge piu' sotto): si tiene stabile
    // anche se la soglia numerica dovesse cambiare in futuro.
    const LIVELLI_ASCESA = [
        { id: 'espertoCima', soglia: 30, titolo: 'Esperto della Cima', descrizione: 'Il livello massimo: la vetta è diventata la tua seconda casa.' },
        { id: 'colonnaMontagna', soglia: 25, titolo: 'Colonna della Montagna', descrizione: 'Sei un punto di riferimento per chiunque incontri sul percorso.' },
        { id: 'veteranoVetta', soglia: 20, titolo: 'Veterano della Vetta', descrizione: 'Hai affrontato la salita con ogni meteo e stagionalità.' },
        { id: 'custodeSentiero', soglia: 15, titolo: 'Custode del Sentiero', descrizione: 'Conosci ogni svolta, sasso e cambio di pendenza.' },
        { id: 'habitueCima', soglia: 10, titolo: 'Habitué della Cima', descrizione: 'Riconosci i punti di sosta, i panorami e il ritmo giusto.' },
        { id: 'frequentatore', soglia: 5, titolo: 'Frequentatore', descrizione: 'Hai preso la mano e la salita non ha più segreti iniziali.' }
    ];

    function livelloAscesa(b) {
        if (b.tipo !== 'cima' || !b.ascesa) return null;
        return LIVELLI_ASCESA.find(l => b.ascesa.total >= l.soglia) || null;
    }

    // Punto 63b, 17/08/2026: le stesse soglie del badge "guadagnano" anche una riga nella
    // parte "Esperto locale" del profilo (idea di Denis - una cima con abbastanza salite
    // conta come esperto locale di quella cima, in aggiunta alla zona dichiarata a mano).
    // Prende uno "stato" gia' calcolato (statoBadge/statoBadgePer), non lo ricalcola: stesso
    // numero, stesso livello del badge - un secondo conteggio qui potrebbe solo disallinearsi.
    function montagneEsperienza(stato) {
        return stato
            .map(b => ({ nome: b.nome, livello: livelloAscesa(b) }))
            .filter(m => m.livello)
            .sort((a, b) => b.livello.soglia - a.livello.soglia || a.nome.localeCompare(b.nome));
    }

    function schedaBadge(b) {
        const esc = window.escapeHtml;
        const el = document.createElement('div');
        el.className = `badge-card ${b.sbloccato ? 'unlocked' : ''}`;
        // Il click sull'icona (delegato in app.js) risale a questa card per sapere quale
        // badge aprire nel modale e se ha una scheda "i" (badge-info.js).
        if (b.stampId) el.dataset.stampId = b.stampId;

        // Riga di contesto: quota, zona e regione quando si sanno. I badge ricavati
        // dalle vette di un'escursione non hanno zona ne' regione, e si scrive solo
        // quello che si sa invece di riempire con dei trattini.
        const contesto = [
            b.quota ? `${b.quota} m` : null,
            b.zona,
            b.regione
        ].filter(Boolean).map(esc).join(' · ');

        const stato = b.sbloccato
            ? `<span class="badge-card-state won"><i data-lucide="award"></i> ${esc(T('badges.stato.conquistatoIl', dataItaliana(b.data) || '—') || `Conquistato il ${dataItaliana(b.data) || '—'}`)}</span>`
            : `<span class="badge-card-state"><i data-lucide="lock"></i> ${esc(T('badges.stato.nonConquistato') || 'Non ancora conquistato')}</span>`;

        const ascesa = b.ascesa
            ? `<span class="badge-card-count">${esc(testoAscesa(b.ascesa))}</span>`
            : '';

        // "×N" in alto a destra sulla scheda dalla seconda salita in poi: b.ascesa esiste
        // gia' solo quando ascesePerVetta[...].total > 1 (statoBadgePer piu' sopra), stessa
        // soglia richiesta da Denis - nessuna nuova condizione da inventare qui.
        const ripetizione = b.ascesa
            ? `<span class="badge-card-repeat-pill">×${b.ascesa.total}</span>`
            : '';

        const livello = livelloAscesa(b);
        const livelloHtml = livello ? `
            <div class="badge-card-tier">
                <span class="badge-card-tier-title">${esc(T('badges.livello.' + livello.id + '.titolo') || livello.titolo)}</span>
                <span class="badge-card-tier-desc">${esc(T('badges.livello.' + livello.id + '.descrizione') || livello.descrizione)}</span>
            </div>
        ` : '';

        // Punto 91, 18/08/2026: "icona" (facoltativa, un file vero) al posto dell'emoji per
        // chi ce l'ha - stessa classe badge-card-icon di sempre, cosi' il grayscale del
        // blocco/sblocco (styles.css) continua a funzionare identico senza scriverlo due
        // volte per emoji e immagine. L'emoji resta comunque nei dati (badge-points.js) come
        // ripiego, mai tolta: se l'immagine manca o non carica, un'emoji e' sempre meglio di
        // un buco vuoto sulla scheda.
        const iconaHtml = b.icona
            ? `<img src="${esc(b.icona)}" alt="" class="badge-card-icon badge-card-icon-img">`
            : `<span class="badge-card-icon">${esc(b.emoji)}</span>`;

        el.innerHTML = `
            ${ripetizione}
            ${iconaHtml}
            ${livelloHtml}
            <span class="badge-card-name">${esc(b.nome)}</span>
            <span class="badge-card-context">${contesto}</span>
            ${stato}
            ${ascesa}
        `;
        return el;
    }

    function riempiGruppo(idContenitore, idContatore, elenco, messaggioVuoto) {
        const box = document.getElementById(idContenitore);
        if (!box) return;
        box.innerHTML = '';

        if (!elenco.length) {
            box.innerHTML = `<div class="glass-card text-center py-4 text-muted">${messaggioVuoto}</div>`;
        } else {
            elenco.forEach(b => box.appendChild(schedaBadge(b)));
        }

        const contatore = document.getElementById(idContatore);
        if (contatore) {
            contatore.textContent = `${elenco.filter(b => b.sbloccato).length}/${elenco.length}`;
        }
    }

    function renderBadges() {
        // La pagina puo' non esserci (altre schermate del sito caricano gli stessi
        // script): in quel caso non c'e' niente da disegnare e si esce in silenzio.
        if (!document.getElementById('badges-cime')) return;
        if (!window.CamoscioState || !window.CamoscioState.currentUser) return;

        const tutti = statoBadge();
        // Serve sia al riquadro del badge personale sia al riepilogo qui sotto -
        // dichiarata una volta sola all'inizio della funzione (22/08/2026, prima
        // viveva solo dentro l'if del badge personale e il riepilogo non la vedeva).
        const esc = window.escapeHtml;
        // Dalla piu' alta alla piu' bassa dentro ogni gruppo: e' l'ordine con cui si
        // guarda una collezione di montagne. Lo stato preso/non preso si vede dal
        // colore della scheda, non serve separarli anche nell'ordine.
        const perQuota = (a, b) => (b.quota || 0) - (a.quota || 0);
        const cime = tutti.filter(b => b.tipo === 'cima').sort(perQuota);
        const rifugi = tutti.filter(b => b.tipo === 'rifugio').sort(perQuota);

        riempiGruppo('badges-cime', 'count-badges-cime', cime,
            T('badges.vuoto.cime') || 'Nessuna cima in elenco.');
        riempiGruppo('badges-rifugi', 'count-badges-rifugi', rifugi,
            T('badges.vuoto.rifugi') || 'Nessun rifugio in elenco.');

        // Punto 57: stesso riquadro gia' costruito per la pagina profilo (punto 50),
        // qui per l'utente collegato invece che per un altro - CamoscioPersonalBadges
        // e' lo stesso catalogo unico, non ce n'e' una seconda copia da tenere allineata.
        const boxPersonale = document.getElementById('badges-personal-badge');
        if (boxPersonale) {
            const personale = window.CamoscioPersonalBadges
                ? window.CamoscioPersonalBadges.get(window.CamoscioState.currentUser.id)
                : null;
            boxPersonale.innerHTML = personale ? `
                <div class="glass-card personal-badge-showcase">
                    <img src="img/badge-personali/${esc(personale.icon)}" alt="${esc(personale.titolo)}" class="personal-badge-illustration">
                    <div>
                        <h4>${esc(personale.titolo)}</h4>
                        <p>${esc(personale.descrizione)}</p>
                        <p class="small text-muted">${esc(T('badges.personale.nota') || 'Distintivo assegnato a mano dal team di Camoscio: non si guadagna, è un riconoscimento personale.')}</p>
                    </div>
                </div>
            ` : "";
        }

        const presi = tutti.filter(b => b.sbloccato).length;
        const totale = tutti.length;
        const percentuale = totale > 0 ? Math.round((presi / totale) * 100) : 0;

        const riepilogo = document.getElementById('badges-summary');
        if (riepilogo) {
            const ariaLabel = window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en'
                ? `${presi} badges earned out of ${totale}`
                : `${presi} badge conquistati su ${totale}`;
            riepilogo.innerHTML = `
                <div class="glass-card badges-counter">
                    <div class="badges-counter-numbers">
                        <div><strong>${presi}</strong><span>${esc(T('badges.summary.conquistati') || 'conquistati')}</span></div>
                        <div><strong>${totale - presi}</strong><span>${esc(T('badges.summary.daConquistare') || 'da conquistare')}</span></div>
                        <div><strong>${percentuale}%</strong><span>${esc(T('badges.summary.completato') || 'completato')}</span></div>
                    </div>
                    <div class="badge-progress-track" role="img"
                         aria-label="${esc(ariaLabel)}">
                        <div class="badge-progress-bar" style="width: ${percentuale}%"></div>
                    </div>
                </div>`;
        }

        if (window.lucide) window.lucide.createIcons();
    }

    window.CamoscioBadges = { catalogo, puntiTimbrabili, statoBadge, statoBadgePer, schedaBadge, anteprima, dataItaliana, montagneEsperienza, render: renderBadges };
    window.renderBadges = renderBadges;

    // Il cambio lingua (i18n.js) ricostruisce l'HTML della pagina invece di
    // fare uno swap di testContent: renderBadges gia' cancella e ridisegna
    // tutto a ogni chiamata, quindi basta ri-agganciarsi qui invece di
    // inventare un secondo percorso di aggiornamento.
    if (window.CamoscioI18n) window.CamoscioI18n.onChange(renderBadges);
})();
