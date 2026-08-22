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
// ROLLOUT AL RESTO DEL SITO approvato da Denis il 22/08/2026, dopo la prova sulla
// sola pagina Badge (punto 102). In corso a lotti (un gruppo di pagine alla volta,
// verificato dal vivo e committato prima del successivo - vedi 04-Da-Fare.md del
// vault per lo stato). Le due bandiere vivono nell'header condiviso (visibile su
// ogni pagina) perche' la preferenza di lingua e' per forza globale - le pagine non
// ancora nel dizionario restano semplicemente in italiano (t(chiave) restituisce
// null, il chiamante tiene il proprio testo di ripiego).
//
// DUE COSE CHE CAMBIANO CON LA LINGUA OLTRE AL TESTO, scoperte scendendo nelle
// pagine vere (non servivano ancora sulla sola pagina Badge):
// - numeri decimali: virgola in italiano, punto in inglese (vedi formattaDecimale
//   in userprofile.js) - le date invece NON cambiano formato, vedi sotto;
// - date con il nome del mese (es. "15 giugno 2026"): usare 'en-GB' invece di
//   'it-IT' in toLocaleDateString quando la lingua e' inglese. Le date SOLO
//   numeriche (dataItaliana in badges.js, GG/MM/AAAA) restano identiche in
//   entrambe le lingue, motivo per cui e' stata scelta la bandiera 🇬🇧 - vedi sotto.
//
// CONVENZIONE PER FILE NON avvolti in una IIFE (tutti tranne badges.js): tutti gli
// script del sito sono <script> classici che condividono lo stesso scope globale,
// non moduli ES - "const T = ..." in cima a PIU' file da' SyntaxError
// (Identifier 'T' has already been declared) al secondo file caricato, e blocca
// l'esecuzione di quello script per intero. Usare "var T = ..." (non const/let):
// la riassegnazione ripetuta e' innocua perche' ogni file assegna sempre lo stesso
// valore (window.CamoscioI18n.t). badges.js fa eccezione perche' e' gia' dentro una
// propria IIFE, dove "const T" resta locale a quel file e non collide con nessuno.
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
            // Rollout punto 102: manca apposta una voce per squad-page/hike-page (non
            // sono nemmeno in prettyNames, app.js - la loro intestazione e' SEMPRE il
            // nome vero della squadra/escursione, mai un titolo fisso da tradurre qui).
            'sectionTitle.people-search': 'Search People',
            'sectionTitle.user-profile': 'Profile',

            // Etichette della barra laterale (public/index.html, <nav class="nav-menu">) -
            // segnalato da Denis il 22/08/2026: restavano in italiano anche a pagina
            // tradotta, perche' non erano mai state marcate, nemmeno nella prova originale
            // sulla sola pagina Badge. Chiavi separate da sectionTitle.*: sono due posti
            // diversi (voce di menu compatta vs titolo di pagina) che qui capita abbiano
            // spesso lo stesso testo, ma potrebbero divergere in futuro (es. un'etichetta
            // di menu piu' corta del titolo della pagina, come gia' succede in italiano per
            // "Carpooling & Spese Viaggio" -> solo "Carpooling" nel menu).
            'nav.dashboard': 'Dashboard',
            'nav.hikes': 'Hikes',
            'nav.myHikes': 'My Hikes',
            'nav.badges': 'Badges',
            'nav.map': 'Map & Trails',
            'nav.backpack': 'Smart Backpack',
            'nav.safety': 'Safety & Mesh',
            'nav.social': 'Tribe & Squads',
            'nav.peopleSearch': 'Search People',

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
            'badges.livello.frequentatore.descrizione': "You've got the hang of it, the climb has no more first-time secrets.",

            // Rollout punto 102 (22/08/2026), primo lotto: le quattro pagine piu' piccole
            // senza voce in barra (Cerca Persone, profilo, pagina squadra, pagina
            // escursione). Fallback generico riusato da piu' file (squadpage.js,
            // hikepage.js) quando un id utente non si trova piu' nella cache locale.
            'common.utente': 'User',

            // Cerca Persone (public/js/peoplesearch.js)
            'peopleSearch.titolo': 'Search People',
            'peopleSearch.sottotitolo': "Type a person's username (e.g. DaniWoll).",
            'peopleSearch.placeholder': 'E.g. DaniWoll',
            'peopleSearch.minLettere': function (soglia) { return 'Type at least ' + soglia + ' letters to start searching.'; },
            'peopleSearch.nessunRisultato': 'No people found.',

            // Profilo, proprio e altrui (public/js/userprofile.js): renderProfileIdentity/
            // renderProfileHikes/renderProfileBookmarks sono funzioni CONDIVISE fra
            // #user-profile e #my-profile - tradotte una volta sola qui, valgono per
            // entrambe le pagine (my-profile arriva col rollout del punto 102, non ancora
            // tradotta per il resto).
            'profile.escursioni': 'Hikes',
            'profile.sentieriPreferiti': 'Favorite trails 🐐',
            'profile.badgeGuadagnati': 'Badges earned',
            'profile.caricamento': 'Loading...',
            'profile.erroreCaricamento': 'This profile could not be loaded. Please try again later.',
            'profile.nonTrovato': 'Profile not found.',
            'profile.livelloReputazione': function (livello, reputazione) { return 'Level: ' + livello + ' · Reputation: ' + reputazione + '%'; },
            'profile.espertoLocale': 'Local expert',
            'profile.nessunBadge': 'No badges earned yet.',
            'profile.erroreCaricamentoEscursioni': 'Your hikes could not be loaded.',
            'profile.nessunaEscursione': 'No hikes to show yet.',
            'profile.nessunSentieroPreferito': 'No favorite trails yet.',
            'profile.togliPreferiti': 'Remove from favorites',
            'profile.fotoProfilo': 'Profile photo',
            'profile.mDisliv': 'm gain',
            'profile.quotaMax': 'max alt.',
            'profile.durata': 'duration',
            'profile.durataIgnota': 'duration unknown',
            'profile.durataIgnotaTitle': 'The .gpx file did not contain point timestamps: duration not available.',
            'profile.cammino': 'Walking time',
            'profile.diPause': function (testo) { return ' (+ ' + testo + ' break)'; },
            'profile.completataGruppoTitle': 'Completed together with the group',
            'profile.inGruppo': 'as a group',
            'profile.tracciaImportataTitle': 'Track uploaded from a .gpx file, not recorded by the site',
            'profile.importata': 'imported',
            'profile.tracciaRegistrataTitle': 'Recorded via GPS during the hike',
            'profile.registrata': 'recorded',

            // Pagina squadra (public/js/squadpage.js)
            'squadPage.nonTrovata': 'Squad not found.',
            'squadPage.membri': 'Members',
            'squadPage.richiestePartecipazione': 'Membership requests:',
            'squadPage.accetta': 'Accept',
            'squadPage.rifiuta': 'Decline',
            'squadPage.richiestaInviata': 'Membership request sent: wait for an admin to confirm it.',
            'squadPage.nonMembro': 'You are not a member of this squad yet.',
            'squadPage.richiediPartecipazione': 'Request to Join',
            'squadPage.cambiaFoto': 'Change squad photo (admins only):',
            'squadPage.fotoAlt': 'Squad photo',
            'squadPage.rimuoviAdmin': 'Remove admin',
            'squadPage.rendiAdmin': 'Make admin',
            'squadPage.fotoTroppoGrande': 'Photo too big, pick a smaller one (max ~1.5MB).',
            'squadPage.erroreApprovazione': 'Could not approve the request.',
            'squadPage.erroreRifiuto': 'Could not decline the request.',
            'squadPage.fotoAggiornata': 'Squad photo updated.',
            'squadPage.erroreFoto': "Could not change the squad's photo.",
            'squadPage.errorePromozione': 'Could not promote the member.',
            'squadPage.erroreRimozioneAdmin': 'Could not remove the admin.',
            'squadPage.chatTitolo': 'Squad Chat',

            // Pagina escursione (public/js/hikepage.js)
            'hikePage.nonTrovata': 'Hike not found.',
            'hikePage.partecipanti': 'Participants',
            'hikePage.chatTitolo': 'Hike Chat'
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
        // data-i18n-placeholder: stesso principio, per il placeholder di un campo di
        // input (rollout punto 102, non serviva ancora sulla sola pagina Badge).
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            if (el.dataset.i18nPlaceholderFallback === undefined) {
                el.dataset.i18nPlaceholderFallback = el.placeholder;
            }
            const tradotto = t(el.getAttribute('data-i18n-placeholder'));
            el.placeholder = tradotto !== null ? tradotto : el.dataset.i18nPlaceholderFallback;
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
