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

    // Catalogo + "questo l'ho preso, e quando". L'unica fonte e' db.stamps, cioe' i
    // timbri veri dell'utente collegato: nessun badge puo' risultare preso per
    // qualcuno che non l'ha preso davvero.
    function statoBadge() {
        const timbri = (window.CamoscioState && window.CamoscioState.stamps) || [];
        return catalogo().map(b => {
            const timbro = timbri.find(t => t.stampId === b.stampId);
            return Object.assign({}, b, {
                sbloccato: !!timbro,
                data: timbro ? timbro.dateUnlocked : null
            });
        });
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

    function schedaBadge(b) {
        const esc = window.escapeHtml;
        const el = document.createElement('div');
        el.className = `badge-card ${b.sbloccato ? 'unlocked' : ''}`;

        // Riga di contesto: quota, zona e regione quando si sanno. I badge ricavati
        // dalle vette di un'escursione non hanno zona ne' regione, e si scrive solo
        // quello che si sa invece di riempire con dei trattini.
        const contesto = [
            b.quota ? `${b.quota} m` : null,
            b.zona,
            b.regione
        ].filter(Boolean).map(esc).join(' · ');

        const stato = b.sbloccato
            ? `<span class="badge-card-state won"><i data-lucide="award"></i> Conquistato il ${esc(dataItaliana(b.data) || '—')}</span>`
            : `<span class="badge-card-state"><i data-lucide="lock"></i> Non ancora conquistato</span>`;

        el.innerHTML = `
            <span class="badge-card-icon">${esc(b.emoji)}</span>
            <span class="badge-card-name">${esc(b.nome)}</span>
            <span class="badge-card-context">${contesto}</span>
            ${stato}
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
        // Dalla piu' alta alla piu' bassa dentro ogni gruppo: e' l'ordine con cui si
        // guarda una collezione di montagne. Lo stato preso/non preso si vede dal
        // colore della scheda, non serve separarli anche nell'ordine.
        const perQuota = (a, b) => (b.quota || 0) - (a.quota || 0);
        const cime = tutti.filter(b => b.tipo === 'cima').sort(perQuota);
        const rifugi = tutti.filter(b => b.tipo === 'rifugio').sort(perQuota);

        riempiGruppo('badges-cime', 'count-badges-cime', cime,
            'Nessuna cima in elenco.');
        riempiGruppo('badges-rifugi', 'count-badges-rifugi', rifugi,
            'Nessun rifugio in elenco.');

        const presi = tutti.filter(b => b.sbloccato).length;
        const totale = tutti.length;
        const percentuale = totale > 0 ? Math.round((presi / totale) * 100) : 0;

        const riepilogo = document.getElementById('badges-summary');
        if (riepilogo) {
            riepilogo.innerHTML = `
                <div class="glass-card badges-counter">
                    <div class="badges-counter-numbers">
                        <div><strong>${presi}</strong><span>conquistati</span></div>
                        <div><strong>${totale - presi}</strong><span>da conquistare</span></div>
                        <div><strong>${percentuale}%</strong><span>completato</span></div>
                    </div>
                    <div class="badge-progress-track" role="img"
                         aria-label="${presi} badge conquistati su ${totale}">
                        <div class="badge-progress-bar" style="width: ${percentuale}%"></div>
                    </div>
                </div>`;
        }

        if (window.lucide) window.lucide.createIcons();
    }

    window.CamoscioBadges = { catalogo, puntiTimbrabili, statoBadge, anteprima, dataItaliana, render: renderBadges };
    window.renderBadges = renderBadges;
})();
