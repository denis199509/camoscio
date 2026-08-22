// ==========================================================================
// I18N — selettore di lingua IT/EN, prova sulla pagina Badge (22/08/2026).
//
// SOLO L'INTERFACCIA SI TRADUCE (richiesta esplicita di Denis). I testi che
// scrivono gli utenti (descrizioni, chat, nomi squadre) e i nomi propri di
// luogo (cime, rifugi - vengono da badge-points.js) NON entrano in questo
// dizionario: restano sempre in italiano, come i nomi di persona.
//
// L'ITALIANO NON E' DUPLICATO QUI DENTRO. E' gia' scritto nell'HTML e nei
// file JS che generano le pagine, ed e' la lingua di partenza del sito: il
// dizionario sotto contiene SOLO l'inglese, come una sovrapposizione. t(chiave)
// restituisce null se manca una voce (lingua italiana, o chiave non ancora
// tradotta) e chi chiama tiene comunque il proprio testo italiano come
// ripiego - una fonte sola per l'italiano, mai due copie da tenere allineate.
//
// AMBITO LIMITATO DI PROPOSITO alla sola pagina Badge, per ora: e' la prova
// del meccanismo prima di estenderlo al resto del sito (index.html da solo e'
// 2233 righe, altri 27 file JS per ~13.000 righe). Le due bandiere vivono
// nell'header condiviso (visibile su ogni pagina) perche' la preferenza di
// lingua e' per forza globale - ma finche' non si aggiungono voci per le
// altre pagine, cambiare lingua li' non cambia nulla a schermo.
//
// Bandiera scelta apposta 🇬🇧 e non 🇺🇸: il formato data italiano (GG/MM/AAAA,
// vedi dataItaliana in badges.js) e' anche quello inglese britannico, quindi
// le date non hanno bisogno di nessuna conversione per questa lingua.
//
// Preferenza salvata in localStorage, non sul server: per-browser, zero campi
// nuovi su MongoDB, zero costo RAM/Render (vedi 02-Vincoli-Hard.md del vault).
//
// QUESTO FILE VA CARICATO PRIMA DEGLI ALTRI MODULI APPLICATIVI: non dipende
// da nessuno di loro, e badges.js si registra su CamoscioI18n.onChange gia'
// al proprio avvio (stesso ordine sincrono di parsing, non serve altro).
// ==========================================================================

(function () {
    'use strict';

    const LANG_KEY = 'camoscioLang';

    const DICT = {
        en: {
            // Titolo di sezione nell'header (#section-title): la mappa completa
            // sectionId -> titolo resta scritta una volta sola in app.js
            // (updateSectionTitle) - qui solo l'inglese per le sezioni tradotte.
            'sectionTitle.badges': 'Your Badges',

            // Sezione Badge - testo statico nell'HTML (data-i18n / data-i18n-html)
            'badges.howto': 'Badges are earned on location: open the <b>Map</b> with your position active and get within 150 meters of the point. Each badge is earned once and kept forever.',
            'badges.cime.titolo': 'Peaks',
            'badges.cime.sottotitolo': 'Peaks across the four regions: Marche, Lazio, Abruzzo and Molise.',
            'badges.rifugi.titolo': 'Huts',
            'badges.rifugi.sottotitolo': 'Mountain huts and waypoints along the trails.',

            // Riepilogo in cima alla pagina (badges.js -> renderBadges)
            'badges.summary.conquistati': 'earned',
            'badges.summary.daConquistare': 'to earn',
            'badges.summary.completato': 'complete',

            // Stato di ogni scheda (badges.js -> schedaBadge)
            'badges.stato.nonConquistato': 'Not earned yet',
            'badges.stato.conquistatoIl': function (data) { return 'Earned on ' + data; },

            // Messaggi vuoti (badges.js -> renderBadges)
            'badges.vuoto.cime': 'No peaks yet.',
            'badges.vuoto.rifugi': 'No huts yet.',

            // Badge personale: SOLO la frase fissa. Titolo e descrizione del
            // badge sono scritti a mano da Denis persona per persona (punto
            // 82/83) - stesso trattamento dei nomi propri, non si traducono qui.
            'badges.personale.nota': "Badge hand-assigned by the Camoscio team: it can't be earned, it's a personal recognition.",

            // Conteggio ascese (badges.js -> testoAscesa, punto 42b): il numero
            // deve sempre dire da dove viene, stessa regola in entrambe le lingue.
            'badges.ascesa.entrambe': function (ric, sito) { return ric + ' confirmed + ' + sito + ' logged'; },
            'badges.ascesa.soloRiconosciute': function (ric) { return ric + ' confirmed'; },
            'badges.ascesa.soloSito': function (sito) { return sito + ' times logged by the site'; },

            // Livelli di frequentazione di una cima (badges.js -> LIVELLI_ASCESA,
            // punto 86) - chiave per "id" del livello, non per soglia numerica:
            // la soglia puo' cambiare, l'id no.
            'badges.livello.espertoCima.titolo': 'Cima Expert',
            'badges.livello.espertoCima.descrizione': 'The top tier: this peak has become your second home.',
            'badges.livello.colonnaMontagna.titolo': 'Pillar of the Mountain',
            'badges.livello.colonnaMontagna.descrizione': "You're a landmark for everyone you meet on the trail.",
            'badges.livello.veteranoVetta.titolo': 'Summit Veteran',
            'badges.livello.veteranoVetta.descrizione': "You've taken on the climb in every weather and season.",
            'badges.livello.custodeSentiero.titolo': 'Trail Keeper',
            'badges.livello.custodeSentiero.descrizione': 'You know every turn, rock and change of slope.',
            'badges.livello.habitueCima.titolo': 'Regular of the Peak',
            'badges.livello.habitueCima.descrizione': 'You recognize the rest stops, the views and the right pace.',
            'badges.livello.frequentatore.titolo': 'Frequent Visitor',
            'badges.livello.frequentatore.descrizione': "You've got the hang of it, the climb has no more first-time secrets."
        }
    };

    function getLang() {
        try {
            return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'it';
        } catch (e) {
            return 'it';
        }
    }

    // Restituisce null quando manca una voce (lingua italiana, o chiave non
    // ancora tradotta): chi chiama usa il proprio testo italiano come ripiego,
    // mai un buco a schermo. Argomenti extra passati a una voce-funzione, per
    // le stringhe che devono incollare un numero o una data.
    function t(key) {
        const lang = getLang();
        const voce = DICT[lang] && DICT[lang][key];
        if (voce == null) return null;
        if (typeof voce === 'function') {
            return voce.apply(null, Array.prototype.slice.call(arguments, 1));
        }
        return voce;
    }

    // Testo statico marcato nell'HTML con data-i18n (textContent) o
    // data-i18n-html (innerHTML, solo per i pochi casi con markup dentro, es.
    // il <b>Mappa</b> nella spiegazione dei badge - contenuto nostro, non di
    // un utente, quindi innerHTML e' sicuro). L'italiano originale si salva
    // una sola volta per elemento (primo passaggio): si torna indietro senza
    // tenere una seconda copia scritta a mano da qualche parte.
    function applyStaticTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            if (el.dataset.i18nFallback === undefined) {
                el.dataset.i18nFallback = el.textContent;
            }
            const tradotto = t(el.getAttribute('data-i18n'));
            el.textContent = tradotto !== null ? tradotto : el.dataset.i18nFallback;
        });
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            if (el.dataset.i18nFallback === undefined) {
                el.dataset.i18nFallback = el.innerHTML;
            }
            const tradotto = t(el.getAttribute('data-i18n-html'));
            el.innerHTML = tradotto !== null ? tradotto : el.dataset.i18nFallback;
        });
    }

    // Moduli che ricostruiscono il proprio pezzo di pagina via innerHTML (es.
    // renderBadges, che non puo' limitarsi a uno swap di textContent) si
    // registrano qui invece di essere agganciati a mano uno per uno - lo
    // stesso meccanismo servira' alle pagine future senza toccare questo file.
    const ascoltatori = [];
    function onChange(fn) {
        ascoltatori.push(fn);
    }

    function aggiornaBandiere() {
        const lang = getLang();
        document.querySelectorAll('.lang-flag-btn').forEach(function (btn) {
            const attivo = btn.dataset.lang === lang;
            btn.classList.toggle('active', attivo);
            btn.setAttribute('aria-pressed', String(attivo));
        });
    }

    function setLang(lang) {
        try {
            localStorage.setItem(LANG_KEY, lang);
        } catch (e) {
            // localStorage non disponibile (es. modalita' privata): la scelta
            // vale solo per questa visita, non e' un errore da mostrare.
        }
        document.documentElement.lang = lang;
        aggiornaBandiere();
        applyStaticTranslations();

        // #section-title dipende dalla sezione aperta al momento, non da un
        // testo fisso nell'HTML: lo aggiorna la stessa funzione che usa gia'
        // la navigazione (app.js), cosi' la mappa sectionId -> titolo resta
        // scritta in un solo posto.
        const sezioneAttiva = document.querySelector('.page-section.active');
        if (sezioneAttiva && window.CamoscioUpdateSectionTitle) {
            window.CamoscioUpdateSectionTitle(sezioneAttiva.id);
        }

        ascoltatori.forEach(function (fn) { fn(lang); });
    }

    // Le bandiere sono gia' nell'HTML quando questo script viene eseguito (gli
    // script applicativi stanno in fondo al body, dopo tutto il markup): si
    // possono agganciare subito, senza aspettare initApp()/i dati dell'utente
    // - a differenza di altri pulsanti del sito, cambiare lingua non dipende
    // da nessun dato caricato (vedi "moduli che si collegano tardi" in
    // 04-Da-Fare.md del vault, stessa classe di bug da non ripetere qui).
    document.documentElement.lang = getLang();
    aggiornaBandiere();
    applyStaticTranslations();
    document.querySelectorAll('.lang-flag-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { setLang(btn.dataset.lang); });
    });

    window.CamoscioI18n = { t: t, getLang: getLang, setLang: setLang, onChange: onChange };
})();
