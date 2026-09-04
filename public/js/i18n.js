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
            // V2 UX PASSO 11: 'sectionTitle.badges' -> 'sectionTitle.progress' (pagina "Progressi").
            'sectionTitle.progress': 'Progress',
            // Rollout punto 102: manca apposta una voce per squad-page/hike-page (non
            // sono nemmeno in prettyNames, app.js - la loro intestazione e' SEMPRE il
            // nome vero della squadra/escursione, mai un titolo fisso da tradurre qui).
            // V2 UX PASSO 10: via 'sectionTitle.people-search' (sezione rimossa).
            'sectionTitle.user-profile': 'Profile',

            // Etichette della barra laterale (public/index.html, <nav class="nav-menu">) -
            // segnalato da Denis il 22/08/2026: restavano in italiano anche a pagina
            // tradotta, perche' non erano mai state marcate. Chiavi separate da
            // sectionTitle.* perche' sono due punti diversi nel codice (voce di menu vs
            // #section-title dell'header, che ha un meccanismo suo, updateSectionTitle,
            // che parte da prettyNames in app.js).
            // PASSO 6: header = voce di menu. PASSO 7 (01/09/2026): il menu passa a
            // gruppi. "Home"/"Ispirazioni"/"Community" sono RINOMINE (prima Dashboard/
            // Feed/Tribu' & Squadre) - i data-target restano dashboard/feed/social.
            // "Esplora" e' l'intestazione del gruppo, non naviga. nav.ispirazioni sta
            // piu' in basso, accanto alle altre voci della parte social (punto 113).
            'nav.blocco.navigazione': 'Navigation',
            'nav.blocco.azione': 'Action',
            'nav.blocco.personale': 'Personal area',
            // V2 UX PASSO 14a: via 'nav.blocco.strumenti' (il blocco "STRUMENTI" non esiste piu').
            'nav.home': 'Home',
            'nav.esplora': 'Explore',
            'nav.hikes': 'Hikes',
            'nav.map': 'Map',
            'nav.myHikes': 'My Hikes',
            // V2 UX PASSO 9: sotto-voci di "Le mie escursioni" (viste-filtro della
            // stessa pagina, non sezioni). "In programma" = non ancora completate.
            'nav.mieTutte': 'All',
            'nav.mieProgramma': 'Upcoming',
            'nav.mieCompletate': 'Completed',
            'nav.community': 'Community',
            // V2 UX PASSO 10: "Community" e' ora un gruppo con la sotto-voce "Amici"
            // (porta alla card "Persone", che ha assorbito la ricerca per nome utente).
            // Via 'nav.peopleSearch' - la voce "Cerca Persone" non esiste piu'.
            'nav.amici': 'Friends',
            // Sotto-tendina "Squadre" dentro Community: elenco delle proprie squadre,
            // scorciatoia alla pagina di ognuna. I nomi delle squadre restano com'e'
            // (contenuto utente). "Squads" come social.squadsTitle & co.
            'nav.squadre': 'Squads',
            'nav.squadreVuoto': 'No squads',
            'nav.crea': 'Create',
            // V2 UX PASSO 13: le 2 voci del popover "＋ Crea".
            'crea.nuovaEscursione': 'New hike',
            'crea.nuovoPercorso': 'New route',
            // V2 UX PASSO 8: aria-label dell'hamburger del drawer mobile.
            'nav.apriMenu': 'Open menu',
            // V2 UX PASSO 11: 'nav.badges' -> 'nav.progressi' (la voce "Badge" diventa "Progressi").
            'nav.progressi': 'Progress',
            // V2 UX PASSO 12: #my-profile si sdoppia in "Profilo" (vista) + "Impostazioni" (#settings).
            'nav.profilo': 'Profile',
            'nav.impostazioni': 'Settings',
            // V2 UX PASSO 14c: 'nav.backpack' ritirata - lo Zaino e' un tab di hike-page.
            // V2 UX PASSO 14a: 'nav.safety' -> 'nav.sicurezza', etichetta accorciata.
            'nav.sicurezza': 'Safety',

            // V2 UX PASSO 11 - blocco "Il tuo cammino per zona" in fondo a #progress
            // (badges.js -> renderProgressoZoneTutte). "Ti mancano N vette..." riusa
            // 'dash.camminoMancano' (stessa frase della Home).
            'progress.zoneTitolo': 'Your path, zone by zone',
            'progress.zoneDesc': 'How many peaks you have earned in each zone, and how many are left to complete it.',
            'progress.zoneCompletata': 'Zone completed.',
            'progress.zoneVuoto': 'No zone has catalogued peaks yet.',
            // PASSO 11b - blocco "Le tue statistiche" (#progress-stats). I numeri
            // (escursioni/km/D+/vette) riusano dash.annoEscursioni/.kmPercorsi/.mDislivello/.annoVette.
            'progress.statsTitolo': 'Your stats',
            'progress.statsDa': 'From',
            'progress.statsA': 'To',
            'progress.statsQuestoAnno': 'This year',
            'progress.statsUltimi12': 'Last 12 months',
            'progress.statsSempre': 'All time',
            'progress.statsVuoto': 'No hikes recorded in this range.',
            'progress.statsSenzaDurata': function (n) { return n + (n === 1 ? ' outing without' : ' outings without') + ' a recorded duration: distance and elevation still count them.'; },

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
            'squadPage.fotoNonElaborata': 'The chosen photo could not be processed.',
            'squadPage.erroreApprovazione': 'Could not approve the request.',
            'squadPage.erroreRifiuto': 'Could not decline the request.',
            'squadPage.fotoAggiornata': 'Squad photo updated.',
            'squadPage.erroreFoto': "Could not change the squad's photo.",
            'squadPage.errorePromozione': 'Could not promote the member.',
            'squadPage.erroreRimozioneAdmin': 'Could not remove the admin.',
            // Consenso squadra (27ª): inviti, uscita, rimozione.
            'squadPage.invitatoInAttesa': 'invited, pending',
            'squadPage.invitiInAttesa': 'Pending invitations:',
            'squadPage.annullaInvito': 'Cancel',
            'squadPage.seiInvitato': 'You have been invited to this squad.',
            'squadPage.rimuoviMembro': 'Remove from squad',
            'squadPage.lasciaSquadra': 'Leave squad',
            'squadPage.confermaRimuoviMembro': 'Remove this person from the squad?',
            'squadPage.lasciaConfermaBase': 'Leave this squad?',
            'squadPage.lasciaUltimoMembro': "You're the last member: the squad and its chat will be deleted.",
            'squadPage.lasciaCreatore': 'You created this squad: it will pass to the longest-standing member.',
            'squadPage.uscito': 'You left the squad.',
            'squadPage.erroreAnnullaInvito': 'Could not cancel the invitation.',
            'squadPage.chatTitolo': 'Squad Chat',

            // Pagina escursione (public/js/hikepage.js)
            'hikePage.nonTrovata': 'Hike not found.',
            'hikePage.partecipanti': 'Participants',
            'hikePage.chatTitolo': 'Hike Chat',
            // V2 UX PASSO 14b: tab interni di hike-page (PASSO 14c aggiunge "Zaino").
            'hikePage.tabDettagli': 'Details',
            'hikePage.tabChat': 'Chat',
            'hikePage.tabCarpool': 'Carpooling',
            'hikePage.tabZaino': 'Backpack',
            // Punto 116: card mini-mappa nel tab Dettagli, col percorso della traccia importata.
            'hikePage.percorsoPrevisto': 'Planned route',

            // ==================================================================
            // Rollout punto 102, secondo lotto (22/08/2026): Escursioni + Le mie
            // escursioni - condividono buildHikeCard (public/js/social.js), quindi
            // un solo lotto per entrambe le pagine (vedi 04-Da-Fare.md del vault).
            //
            // Tre scelte non ovvie emerse scendendo in queste due pagine:
            // 1) Difficolta' (Principiante/Intermedio/Esperto) e Tag Tribu' (Passo
            //    Fotografico, Trail Runners...) sono vocabolario fisso definito da
            //    noi (come i livelli badge), non testo utente ne' un nome proprio:
            //    tradotti SOLO per la visualizzazione - il valore salvato sul
            //    database resta sempre la stringa italiana (vedi difficulty.*/
            //    tribeTag.* sotto, usati come T('...'+valore) con l'italiano
            //    invariato come ripiego, mai per filtrare o salvare).
            // 2) I due messaggi di notifica mandati all'ALTRO utente quando lo si
            //    accetta/rifiuta (routes/hikes.js, PUT /:id, ALTO-1) NON sono
            //    stati tradotti apposta: il testo lo scrive il server una volta
            //    sola, sempre in italiano fisso, non nella lingua di chi lo legge -
            //    stessa scelta di ogni altro testo che il server genera per una
            //    notifica (richiesta di partecipazione, invito squadra...).
            //    Restano in italiano fisso, come prima di questo lotto.
            // 3) I messaggi d'errore che arrivano dal SERVER (dati.error/body.error
            //    nelle risposte delle rotte) restano sempre in italiano: il
            //    dizionario qui e' solo lato client. Tradotto solo il testo di
            //    ripiego per quando il server non manda un messaggio proprio.
            'sectionTitle.hikes': 'Hikes',
            'sectionTitle.my-hikes': 'My Hikes',

            // Condivise fra piu' file di questo lotto (e riusabili da lotti futuri)
            'common.e': ' and ',
            'common.elimina': 'Delete',
            'common.cancella': 'Cancel',
            'common.rimuovi': 'Remove',
            // Punto A-3.4: nome mostrato al posto di quello di un account eliminato. E'
            // interfaccia (non contenuto utente), quindi si traduce.
            'common.accountEliminato': 'Deleted account',
            'common.erroreServer': 'Could not reach the server.',
            'common.copia': 'Copy',

            // Vocabolario fisso, vedi nota (1) qui sopra - il VALORE salvato resta
            // sempre la stringa italiana usata come chiave.
            'difficulty.Principiante': 'Beginner',
            'difficulty.Intermedio': 'Intermediate',
            'difficulty.Esperto': 'Expert',
            'tribeTag.Passo Fotografico': 'Photography Pace',
            'tribeTag.Trail Runners': 'Trail Runners',
            'tribeTag.Passo Svelto': 'Brisk Pace',
            'tribeTag.Dog Friendly': 'Dog Friendly',
            'tribeTag.Generazione Alpha': 'Generation Alpha',
            'tribeTag.Generazione Z': 'Generation Z',
            'tribeTag.Millennials': 'Millennials',

            // Badge idoneita' sulla card escursione (public/js/profile.js,
            // getEligibilityBadge) - funzione piccola e autonoma, tradotta ora
            // anche se il resto di profile.js (Dashboard) e' un lotto futuro,
            // perche' il suo output compare su ogni card di questo lotto.
            'eligibility.idoneo': 'Fit (Pace OK)',
            'eligibility.richiestoPassoSuperiore': 'Requires a Higher Pace',

            // --- ESCURSIONI (public/index.html #hikes, public/js/social.js) ---
            'hikes.esplora': 'Group Hikes',
            'hikes.cercaTitoloLabel': 'Search by title:',
            'hikes.cercaTitoloPlaceholder': 'E.g. Alba Corno Grande...',
            'hikes.filtriTitolo': 'Filters and Matching Algorithms',
            'hikes.difficoltaLabel': 'Difficulty:',
            'hikes.tutteDifficolta': 'All difficulties',
            'hikes.tribuLabel': 'Tribe (Lifestyle) — select one or more:',
            'hikes.disponibiliTitolo': 'Open to Join',
            // V2 UX PASSO 9: "Escursioni" (Esplora) e' solo scoperta - via le chiavi
            // hikes.partecipiTitolo / hikes.completateTitolo / hikes.nonPartecipiAlcuna /
            // hikes.nessunaCompletata (i gruppi "A cui partecipi" e "Completate" vivono
            // ora solo in "Le mie escursioni").
            'hikes.nessunFiltro': 'No hikes found with the selected filters.',

            // --- LE MIE ESCURSIONI (public/index.html #my-hikes, social.js +
            // storico.js) ---
            'myHikes.organizzateTitolo': 'Organized by Me',
            'myHikes.organizzateDesc': 'Hikes you created. Here you approve or decline join requests.',
            'myHikes.partecipoTitolo': 'Joining',
            'myHikes.partecipoDesc': "Upcoming hikes you've joined, plus those awaiting approval.",
            // Invito squadra direzionale (27ª): gruppo nuovo in "Le mie escursioni".
            'myHikes.invitiTitolo': 'Invitations',
            'myHikes.invitiDesc': 'Hikes a squad invited you to. You decide whether to join.',
            'myHikes.completateTitolo': 'Completed Hikes',
            'myHikes.completateDesc': 'Hikes you completed on the site, and routes you recorded via GPS or uploaded from a file.',
            'myHikes.gpxUploadTitolo': 'Upload a track (.gpx or .fit)',
            'myHikes.gpxUploadDesc': 'Do you have tracks from hikes you did before using Camoscio? Upload them here to add them to your history and totals. .fit is Garmin\'s native format and gives the most complete data.',
            'myHikes.gpxSceglieFile': 'Choose file',
            'myHikes.progettiTitolo': 'My Projects',
            'myHikes.progettiDesc': 'Routes you designed on the map and saved. Open one to find it again on the Map, with sun exposure along the track.',
            'myHikes.nessunaOrganizzata': "You haven't organized any hike yet. You can create one from the Hikes section.",
            'myHikes.nonIscrittoAlcuna': "You're not joining any upcoming hike. Check out other people's in the Hikes section.",
            'myHikes.riepilogoVuoto': "Your hikes will show up here: the ones you organize, the ones you join, and the ones you've already done.",
            'myHikes.organizzateLabel': 'organized',
            'myHikes.programmaLabel': 'planned',
            'myHikes.completateLabel': 'completed',
            'myHikes.completateVuoto': "No completed hikes yet. After a hike, remember to mark it as completed, or upload a .gpx file of a hike you've already done using the button above.",
            'myHikes.erroreCaricaUscite': 'Completed hikes are up to date; the GPS-recorded hikes could not be loaded. Try again later.',

            // --- Modale crea/modifica escursione (#create-hike-modal, social.js) ---
            'hikeModal.creaNuova': 'Create New Hike',
            'hikeModal.titoloLabel': 'Hike Title:',
            'hikeModal.titoloPlaceholder': 'E.g. Three Peaks Loop',
            'hikeModal.descLabel': 'Trail and meeting point description:',
            'hikeModal.descPlaceholder': 'Give details about the trail...',
            'hikeModal.difficoltaLabel': 'Technical Difficulty:',
            'hikeModal.diffPrincipiante': 'Beginner (Low elevation gain, wide trail)',
            'hikeModal.diffIntermedio': 'Intermediate (Up to 1000m gain, steep sections)',
            'hikeModal.diffEsperto': 'Expert (Over 1000m gain, technical/exposed terrain)',
            'hikeModal.dataLabel': 'Hike Date:',
            'hikeModal.multiDayCheck': 'Multi-day hike (hut/tent)',
            'hikeModal.multiDayHint': 'Enables the "shareable backpack" for participants: tent for several people, weight split.',
            'hikeModal.routeSourceLabel': 'Max altitude, elevation gain and distance:',
            'hikeModal.routeManuale': "I'll enter them myself",
            'hikeModal.routeDraft': 'Calculate from an existing project',
            'hikeModal.routeGpx': 'Calculate by importing a track (.gpx or .fit)',
            'hikeModal.qualeProgetto': 'Which project:',
            'hikeModal.fileGpxLabel': '.gpx or .fit file:',
            'hikeModal.quotaMassima': 'Max altitude (meters):',
            'hikeModal.dislivelloPositivo': 'Elevation gain (D+ meters):',
            'hikeModal.distanzaTotale': 'Total Distance (km):',
            'hikeModal.puntoRitrovoLabel': 'Meeting point:',
            'hikeModal.cercaLuogoPlaceholder': 'Search a place, e.g. Campo Imperatore',
            'hikeModal.sceglisiMappaTitle': 'Choose the point directly on the map',
            'hikeModal.sceglisiMappaBtn': 'Choose on map',
            'hikeModal.copiaCoordTitle': 'Copy coordinates (e.g. to paste into Google Maps)',
            'hikeModal.comeChiamareLabel': 'What to call the meeting point (editable):',
            'hikeModal.trailheadNamePlaceholder': 'E.g. Rifugio Franchetti',
            'hikeModal.tagTribuLabel': 'Select Tribe Tags (lifestyle):',
            'hikeModal.modalitaIscrizioneLabel': 'Sign-up Mode:',
            'hikeModal.iscrizioneManuale': 'Manual (Leader Veto - I approve members)',
            'hikeModal.iscrizioneAutomatica': 'Automatic (Anyone can join freely)',
            'hikeModal.pubblicaBtn': 'Publish Hike',
            'hikeModal.modificaTitolo': 'Edit Hike',
            'hikeModal.salvaModificheBtn': 'Save Changes',
            'hikeModal.quoteManualiNota': 'Enter the max altitude and elevation gain yourself: the project stays linked.',
            'hikeModal.nessunProgetto': "You don't have any saved projects yet",
            'hikeModal.erroreCaricaProgetti': 'Could not load the projects',

            // --- Modale completamento di gruppo (#complete-group-modal, social.js) ---
            'completeGroupModal.completaPrefix': 'Complete:',
            'completeGroupModal.confermaDesc': 'Confirm who really took part. Anyone left checked will show as present on their profile and yours.',
            'completeGroupModal.aggiungiLabel': "Add someone who wasn't on the sign-up list:",
            'completeGroupModal.cercaPlaceholder': 'Search by username...',
            'completeGroupModal.gpxLabel': ".gpx track (optional, for the hike's real data):",
            'completeGroupModal.confermaBtn': 'Confirm completion',
            'completeGroupModal.aggiungiBtn': 'Add',
            'completeGroupModal.confermaAlmeno': 'Confirm at least one person present.',
            'completeGroupModal.gpxNonLetto': 'Could not read the .gpx file.',
            'completeGroupModal.completataSuccesso': 'Hike completed for the group!',
            'completeGroupModal.erroreCompletamento': 'Could not complete the group.',
            'completeGroupModal.erroreReteCompletamento': 'Network error: the completion was not saved.',

            // --- Card escursione (buildHikeCard, social.js) ---
            'hikeCard.escursionistaFallback': 'Hiker',
            'hikeCard.organizzatore': 'Organizer',
            'hikeCard.partecipiCheck': 'Joined ✓',
            'hikeCard.inAttesaApprovazione': 'Awaiting approval...',
            'hikeCard.iscrivitiBtn': 'Join',
            'hikeCard.organizzatoDa': 'Organized by:',
            'hikeCard.dislivelloDLabel': 'Elevation gain D+',
            'hikeCard.quotaMaxLabel': 'Max Altitude',
            'hikeCard.distanzaLabel': 'Distance',
            'hikeCard.tempoPrevistoLabel': 'Estimated time:',
            'hikeCard.caiStandard': '(CAI standard)',
            'hikeCard.sulTuoPasso': 'at your pace',
            'hikeCard.percorsoLabel': 'Route:',
            'hikeCard.dislivelloIndicato': ' - elevation gain as entered by the organizer',
            'hikeCard.tempoNonDisponibile': "Estimated time not available: no real route has been chosen yet for this hike, so we can't know how long it will actually take. The elevation gain and distance above are those entered by the organizer.",
            'hikeCard.tempoMisuratoLabel': 'Your measured walking time:',
            'hikeCard.caiPercorsoLabel': 'CAI for this route:',
            'hikeCard.trailMatch': function (names, singolare) { return 'Also ' + names + (singolare ? ' has' : ' have') + ' added this trail to favorites.'; },
            'hikeCard.caricaGpxTitle': 'Upload a .gpx file to get the real time for this hike',
            'hikeCard.cancellaGiaFattaTitle': "Remove this hike from your 'done' list",
            'hikeCard.vediMappaTitle': 'View trail on the map',
            'hikeCard.mappaBtn': 'Map',
            'hikeCard.rimuoviPreferitiTitle': 'Remove from favorites',
            'hikeCard.aggiungiPreferitiTitle': 'Add to favorites',
            'hikeCard.chatTitle': 'Chat between participants',
            'hikeCard.chatBtn': 'Chat',
            'hikeCard.richiestePendenti': 'Pending Requests (Veto):',
            'hikeCard.accettaBtn': 'Accept',
            'hikeCard.rifiutaBtn': 'Decline',
            // Invito squadra direzionale (27ª): l'invitato accetta o rifiuta dalla card.
            'hikeCard.accettaInvitoBtn': 'Accept',
            'hikeCard.rifiutaInvitoBtn': 'Decline',
            'hikeCard.invitiInAttesa': function (n) { return n + (n === 1 ? ' invited person has' : ' invited people have') + ' not answered yet'; },
            'hikeCard.completataGruppo': 'Completed as a group ✓',
            'hikeCard.completaBtn': 'Complete hike',
            'hikeCard.opzioniTitle': 'Hike options',
            'hikeCard.modificaBtn': 'Edit',
            'hikeCard.partecipantiLabel': function (n) { return 'Participants (' + n + '):'; },
            'hikeCard.iscrizioniChiuse': 'Sign-ups closed',
            'hikeCard.iscrizioniChiuseTitle': 'The scheduled day has passed: no more sign-ups',
            'hikeCard.iscrizioniChiuseData': function (data) { return 'This hike was scheduled for ' + data + ': it no longer accepts sign-ups after that day.'; },
            'hikeCard.eliminaEscursione': 'Delete hike',
            'hikeCard.eliminaEscursioneTitle': 'Delete this hike for every participant',

            // --- Messaggi/conferme azioni escursione (social.js) ---
            'hikeToast.scegliProgetto': 'Choose a project from the list.',
            'hikeToast.scegliGpx': 'Choose a .gpx or .fit file to import.',
            'hikeToast.fileNonLetto': 'Could not read the file.',
            'hikeToast.scegliRitrovo': 'Choose the meeting point first: search by name or pick it on the map.',
            'hikeToast.fuoriRegione': 'The meeting point you entered is outside the current geographic scope of the demo (Lazio, Molise, Abruzzo, Marche). Enter coordinates within these regions.',
            'hikeToast.quoteRicalcolate': function (alt, gain) { return 'The elevation source responded: max altitude and elevation gain were calculated from the route (' + alt + ' m, ' + gain + ' m D+), not the ones you entered.'; },
            'hikeToast.escursioneAggiornata': 'Hike updated!',
            'hikeToast.escursionePubblicata': 'Hike published!',
            'hikeToast.erroreSalvaModifiche': 'Could not save the changes. Check the entered data.',
            'hikeToast.errorePubblica': 'Could not publish the hike. Check the entered data.',
            'hikeToast.erroreReteModifiche': 'Network error: the changes were not saved.',
            'hikeToast.erroreRetePubblica': 'Network error: the hike was not published.',
            'hikeConfirm.avvisoIdoneita': '⚠️ WARNING: This hike requires a pace above your current recorded history.\n\nDo you still want to send a request to the leader and discuss it in chat?',
            'hikeConfirm.questaEscursione': 'this hike',
            'hikeConfirm.cancellaTitolo': function (t) { return 'Delete "' + t + '" from your completed hikes?'; },
            'hikeConfirm.cancellaPassoRicalcolato': 'Your personal pace will be recalculated without this hike.',
            'hikeConfirm.cancellaNoRecensioni': 'You will no longer be able to write or receive reviews for this hike.',
            'hikeConfirm.cancellaBadgeRestano': "Badges you've earned stay in your passport.",
            'hikeConfirm.cancellaTracciaSeparata': 'If you had also recorded the route via GPS, that track stays separate in your history.',
            'hikeToast.erroreCancellaEscursione': 'Could not delete this hike.',
            'hikeToast.escursioneCancellata': 'Hike removed from your "completed" list.',
            'hikeConfirm.eliminaHikeTitolo': function (t) { return 'Delete "' + t + '" for everyone?'; },
            'hikeConfirm.eliminaHikeAltri': function (n) { return 'There are ' + n + ' people signed up besides you: they will lose it from their list, along with their completions, the chat, the linked GPS tracks and any "likes" those tracks had received in the feed.'; },
            'hikeConfirm.eliminaHikeSolo': 'The chat, any linked GPS tracks (with the "likes" they received in the feed) and the notifications will be removed too.',
            'hikeConfirm.eliminaHikeIrreversibile': 'This cannot be undone.',
            'hikeToast.hikeEliminata': 'Hike deleted.',
            'hikeToast.erroreEliminaHike': 'Could not delete this hike.',
            // Invito squadra direzionale (27ª): esito della risposta all'invito.
            'hikeToast.invitoAccettato': 'You are now taking part in this hike.',
            'hikeToast.invitoRifiutato': 'Invitation declined.',
            'hikeToast.invitoNonPiuValido': 'This invitation is no longer valid.',
            'hikeToast.escursioneNonPiuEsiste': 'This hike no longer exists.',
            'hikeToast.filePesa': function (mb, limite) { return 'The file is ' + mb + ' MB, over the ' + (limite || 10) + ' MB limit.'; },
            'hikeToast.erroreAggiuntaFile': 'Could not add the file.',
            'hikeToast.tempoRealeAggiunto': 'Real time added',

            // --- Le mie escursioni: cancellazione uscite tracciate (storico.js) ---
            'outing.cancellaTitle': 'Delete this hike from your history',
            'outing.questaUscita': 'this hike',
            'outing.cancellaTitolo': function (t) { return 'Delete "' + t + '" from your history?'; },
            'outing.cancellaTotaliSpariscono': 'Its kilometers and elevation gain will disappear from the Dashboard totals.',
            'outing.cancellaPostoLibero': 'Since it was an imported file, the slot it takes up in the monthly cap becomes free again.',
            'outing.cancellaRegistrataAttenzione': "Warning: this hike was RECORDED via GPS, so this data was measured on the spot and can't be reloaded from any file.",
            'outing.cancellaBadgeRestano': "Badges you've earned stay in your passport.",
            'outing.erroreCancella': 'Could not delete this hike.',
            'outing.cancellataSuccesso': 'Hike removed from your history.',
            'outing.rinominaTitle': 'Rename this outing',
            'outing.rinominaPrompt': 'New name for the outing (leave empty to go back to the date).',
            'outing.rinominaErrore': 'Could not rename the outing.',
            'outing.rinominata': 'Outing renamed.',
            'outing.nomeTolto': 'Name removed: it shows the date again.',

            // --- Le mie escursioni: caricamento .gpx (storico.js) ---
            'gpx.estensioneErrata': function (nome) { return 'The file must have a <b>.gpx</b> or <b>.fit</b> extension. You chose "' + nome + '".'; },
            'gpx.filePesa': function (mb, limite) { return 'The file is ' + mb + ' MB, over the ' + (limite || 10) + ' MB limit. A normally-recorded hike is usually under 1 MB.'; },
            'gpx.stoLeggendo': function (nome) { return 'Reading "' + nome + '"…'; },
            'gpx.caricamentoAnnullato': "Upload canceled: without the hike's date, the track won't be added to your history.",
            'gpx.stoImportando': function (nome) { return 'Importing "' + nome + '"…'; },
            'gpx.importazioneNonRiuscita': 'Import failed.',
            'gpx.badgeConquistato': 'Badge earned',
            'gpx.badgeConquistati': 'Badges earned',
            'gpx.aggiuntiPassaporto': "Added to your passport with the hike's date.",
            'gpx.uscitaFallback': 'Hike',
            'gpx.titoloImportata': function (nome, data) { return '<b>' + nome + '</b> from ' + data + ' imported.'; },
            'gpx.mDislivelloLabel': 'm of elevation gain',
            'gpx.durataNonDisponibile': ', duration not available',
            'gpx.puntiSalvatiFrase': function (letti, salvati) { return letti + ' points in the file, ' + salvati + ' saved after simplification (the drawn route stays the same, it just takes up much less space).'; },
            'gpx.haiCaricato': function (n, max) { return "You've uploaded " + n + ' of ' + max + ' files this month.'; },
            'gpx.nonContieneOrari': function (nome) { return '"' + nome + '" does not contain point timestamps.'; },
            'gpx.tracciaBuona': function (km, dislivello) { return 'The track looks good (' + km + ' km, ' + dislivello + " m of elevation gain), but without timestamps the site can't know what day you hiked."; },
            'gpx.dataNelFile': function (data) { return 'The file contains the date ' + data + ", but that's often the day you EXPORTED the file, not the day of the hike. Double-check it."; },
            'gpx.nessunaDataNelFile': "The file doesn't contain any date.",
            'gpx.cheGiornoEra': 'What day was it?',
            'gpx.importaBtn': 'Import',
            'gpx.dataNonValida': 'Invalid date: it must be in day/month/year format.',
            'gpx.neHaiCaricati': function (n, max) { return " You've uploaded " + n + ' of ' + max + ' this month.'; },
            'gpx.riprova': 'Try again.',

            // ==================================================================
            // Rollout punto 102, TERZO lotto (27/08/2026): Dashboard + Profilo
            // proprio (#my-profile). Confermato da Denis a fine sesta sessione
            // ("confermo il terzo lotto, quello proposto") - vedi 04-Da-Fare.md.
            //
            // Quattro scelte non ovvie di questo lotto:
            // 1) Il titolo di #my-profile e' FISSO ("Il Tuo Profilo"), non
            //    dinamico come #user-profile (dove e' lo username). Aggiunto sia
            //    a prettyNames (app.js) sia qui come 'sectionTitle.my-profile':
            //    updateSectionTitle lo rimette a posto da solo a ogni cambio
            //    lingua, nessun onChange dedicato serve (a differenza di
            //    userprofile.js, che ne tiene uno solo per lo username).
            // 2) Il CORPO di #my-profile (identita'/escursioni/preferiti) usa le
            //    stesse funzioni condivise di #user-profile, gia' tradotte nel
            //    primo lotto e - come li' - NON ridisegnate al cambio lingua
            //    (renderProfileHikes fa un fetch): stesso residuo onesto,
            //    coerente fra le due pagine gemelle. Le etichette statiche
            //    dell'HTML si aggiornano comunque, via applyStaticTranslations.
            // 3) La Dashboard invece SI ridisegna al cambio lingua
            //    (CamoscioI18n.onChange in fondo ad app.js): quasi tutti i suoi
            //    dati sono gia' in CamoscioState, il re-render sincrono e'
            //    gratis. L'unico fetch (renderDashYearSummary, pochi numeri) non
            //    svuota la card mentre carica, quindi non da' il flicker che ha
            //    sconsigliato l'onChange completo su userprofile.js.
            // 4) I numeri della Dashboard (km/dislivello/vette dell'anno) passano
            //    da toLocaleString: separatore migliaia italiano vs inglese, va
            //    scelto il locale come per le date col nome del mese (en-GB).

            // --- DASHBOARD: testo statico nell'HTML (#dashboard) ---
            // Blocco di apertura (revisione UX): saluto, sottotitolo e card della prossima
            // avventura li scrive renderDashHero (app.js) via le voci qui sotto - gli elementi
            // NON hanno data-i18n apposta (vedi commento in index.html). Fa eccezione il bottone
            // "Apri escursione", testo fisso, che sta come data-i18n.
            'dash.ciaoNome': function (nome) { return 'Hi ' + nome + ' 👋'; },
            'dash.heroSubDefault': 'Ready for your next adventure?',
            'dash.heroSubProssima': 'Your next adventure is almost ready.',
            'dash.ctaTrova': 'Find a hike',
            'dash.ctaEsplora': 'Explore',
            'dash.avventuraApri': 'Open hike',
            'dash.avventuraOggi': 'today',
            'dash.avventuraDomani': 'tomorrow',
            'dash.avventuraFraGiorni': function (n) { return 'in ' + n + ' days'; },
            'dash.avventuraDa': function (nome) { return 'from ' + nome; },
            'dash.avventuraPartecipanti': function (n) { return n + (n === 1 ? ' participant' : ' participants'); },
            // FASE 3
            'dash.avventuraOrganizzata': 'Organised by you',
            'dash.avventuraVediTutte': 'See all my hikes',
            'dash.vediTuttiBadge': 'See all badges',
            'dash.kmPercorsi': 'km covered',
            'dash.mDislivello': 'm of elevation gain',
            // FASE 4 - "Il tuo cammino" / "Ultimi traguardi" / "Il tuo <anno>" (testo fisso)
            'dash.camminoTitolo': 'Your journey',
            'dash.camminoVette': function (n) { return n === 1 ? 'peak conquered' : 'peaks conquered'; },
            'dash.camminoCta': 'Continue your journey',
            'dash.camminoCtaScopri': 'Discover the next peaks',
            'dash.camminoVuotoTitolo': 'Start your journey',
            'dash.camminoVuotoTesto': 'Your first peak is still waiting. Complete a hike to start building your path on Camoscio.',
            'dash.camminoVuotoCta': 'Find a hike',
            'dash.traguardiTitolo': 'Latest achievements',
            'dash.traguardiVuotoTitolo': 'Your first badge awaits',
            'dash.traguardiVuotoTesto': 'Complete a hike and start collecting your achievements.',
            'dash.traguardiVuotoCta': 'Discover hikes',
            'dash.annoEscursioni': 'hikes',
            'dash.annoVette': 'peaks',
            // PASSO 11b: link dalla card "Il tuo <anno>" alla pagina statistiche filtrabile.
            'dash.vediStatistiche': 'See stats',
            'dash.passoTitolo': 'Pace & Effort Calculator',
            'dash.passoDesc': 'The algorithm learns from your tracked hikes to estimate real walking times.',
            'dash.velocitaAscesa': 'Ascent Speed:',
            'dash.velocitaDiscesa': 'Descent Speed:',
            'dash.indiceFatica': 'Personalized Effort Index:',
            'dash.rispettoCai': 'x vs CAI',

            // --- DASHBOARD: testo generato da JS (app.js) ---
            'dash.passoNotaVuoto': "Your pace hasn't been measured yet: complete a hike entering the time it took (or attaching the .gpx track) and these numbers will show up.",
            'dash.totaliErrore': 'Could not load the totals. Try again later.',
            // FASE 4 - testo generato da JS
            'dash.camminoSub': function (r, b) { return r + (r === 1 ? ' hut visited' : ' huts visited') + ' · ' + b + (b === 1 ? ' badge unlocked' : ' badges unlocked'); },
            'dash.camminoMancano': function (n, zona) { return (n === 1 ? 'You are 1 peak away' : 'You are ' + n + ' peaks away') + ' from completing ' + zona + '.'; },
            'dash.camminoBarraAria': function (presi, tot, zona) { return presi + ' of ' + tot + ' peaks in ' + zona; },
            'dash.annoTitolo': function (a) { return 'Your ' + a; },
            'dash.annoNotaVuoto': function (a) { return 'No hikes recorded in ' + a + ' yet: these numbers update on their own as you walk.'; },
            'dash.chartTuoPasso': 'Your Measured Pace',
            'dash.chartCaiStandard': 'Alpine CAI Standard',
            'dash.chartAscesa': 'Ascent (m/hour)',
            'dash.chartDiscesa': 'Descent (m/hour)',

            // --- PROFILO PROPRIO (#my-profile) + IMPOSTAZIONI (#settings): testo statico ---
            // V2 UX PASSO 12: header = menu -> "Profile". #settings e' la pagina di config.
            'sectionTitle.my-profile': 'Profile',
            'sectionTitle.settings': 'Settings',
            'myProfile.cardTitolo': 'Your Profile',
            'myProfile.modificaInImpostazioni': 'Edit in Settings',
            'settings.accountTitolo': 'Account',
            'settings.linguaTitolo': 'Language',
            'settings.linguaDesc': 'The same two flags stay in the header too.',
            'settings.sessioneTitolo': 'Session',
            'settings.logoutDesc': 'End the session on this device.',
            'settings.altreTitolo': 'Other settings',
            'settings.altreDesc': 'Coming soon. Not active yet.',
            'settings.phNotifiche': 'Notification settings',
            'settings.phEmail': 'Change email',
            // A-3.1: revoca del consenso alla geolocalizzazione (#settings, "Privacy e posizione")
            'settings.privacyTitolo': 'Privacy & location',
            'settings.revocaGeo': 'Withdraw location consent',
            'settings.geoConsentNota': "If you withdraw it, the site will ask for your consent again next time a feature uses your location. To stop the browser from sharing it at all, also revoke the site's permission in your browser settings. GPS tracks already recorded are kept: you can delete them one by one from «My hikes».",
            'settings.geoConsentDemo': "Location consent doesn't apply to demo accounts.",
            'settings.geoConsentDato': "You've consented to the use of your location.",
            'settings.geoConsentNon': "You haven't given (or you've withdrawn) consent to use your location: you'll be asked when it's needed.",
            'settings.geoRevocaTracciamento': 'A GPS recording is in progress: stop it before withdrawing consent.',
            'settings.geoRevocaConferma': 'Withdraw consent to use your location? Features that need it (route recording, «where am I», nearby hikes) will ask again.',
            'settings.geoRevocaFatto': "Consent withdrawn. Remember to also remove the site's permission from your browser settings if you want to block it entirely.",
            'settings.geoRevocaErrore': "I couldn't withdraw consent. Try again.",
            // A-3.3: export dei propri dati
            'settings.esportaDati': 'Download my data',
            'settings.esportaDesc': 'Download a single JSON file with all the data the site keeps about your account.',
            'settings.esportaInCorso': 'Preparing the file…',
            'settings.esportaFatto': 'Export downloaded.',
            'settings.esportaErrore': "I couldn't prepare the export. Try again.",
            // A-3.4: eliminazione account (soft-delete in due tempi + 30 giorni di grazia)
            'settings.eliminaTitolo': 'Delete account',
            'settings.eliminaDesc': "What you've posted — hikes, messages, badges, routes, tracks — stays visible, but «Deleted account» will show instead of your name. Your name, photo, bio, email and emergency contacts are removed. You have 30 days to change your mind: just log back in to cancel. After that, your personal data is deleted for good.",
            'settings.eliminaNotaEscursioni': 'If you have upcoming hikes you organised, cancel them or hand them to another organiser first.',
            'settings.eliminaBtn': 'Delete my account',
            'settings.eliminaModaleTesto': "Type your password to delete the account. Your content stays visible under «Deleted account». You have 30 days to cancel: just log back in.",
            'settings.eliminaScriviPwd': 'Type your password to confirm.',
            'settings.eliminaPwdErrata': 'Wrong password.',
            'settings.eliminaBloccoEscursioni': 'You have upcoming hikes you organised. Cancel them or hand them to another organiser, then try again:',
            'settings.eliminaErrore': "The account could not be deleted. Try again.",
            'settings.eliminatoTitolo': 'Account deleted',
            'settings.eliminatoTesto': 'Your account has been deleted. You have 30 days to change your mind: log back in with your credentials to cancel. After that, your personal data will be permanently erased.',
            'settings.ripristinoFatto': "Welcome back: the account deletion has been cancelled. The safety timer had been switched off (turn it back on if you need it); if you were the only admin of a squad, the role passed to another member.",
            'myProfile.rimuoviFoto': 'Remove photo',
            'myProfile.bioLabel': 'Bio (max 250 characters):',
            'myProfile.bioPlaceholder': 'Tell us something about yourself...',
            'myProfile.salvaFotoBio': 'Save photo and bio',
            'myProfile.espertoDesc': 'If you know an area well, offer yourself as an informal local expert to help those less familiar with the place.',
            'myProfile.sonoEsperto': "I'm a local expert",
            'myProfile.espertoZonaLabel': 'Local expert:',
            'myProfile.espertoZonaPlaceholder': "E.g. Gran Sasso d'Italia, Monti Sibillini...",
            'myProfile.cambioPwdDesc': "Change your account password. You'll need the current one.",
            'myProfile.pwdAttuale': 'Current password:',
            'myProfile.pwdNuova': 'New password (at least 8 characters):',
            'myProfile.pwdConferma': 'Confirm new password:',
            'myProfile.cambiaPwdBtn': 'Change password',

            // --- PROFILO PROPRIO: testo generato da JS (profile.js) ---
            'myProfile.fotoNonElaborata': 'The chosen photo could not be processed.',
            'myProfile.profiloAggiornato': 'Profile updated.',
            'myProfile.erroreSalva': 'Could not save the changes.',
            'myProfile.scriviPwdAttuale': 'Enter your current password.',
            'myProfile.pwdMin8': 'The new password must be at least 8 characters.',
            'myProfile.pwdNonCoincidono': "The two new passwords don't match.",
            'myProfile.errorePwd': 'Could not change the password.',
            'myProfile.pwdCambiata': 'Password changed. You stay logged in on this device.',
            'myProfile.indicaZona': "Enter the area you're an expert in to enable the local expert layer.",
            'myProfile.espertoAttivato': "You're now a local expert for this area!",
            'myProfile.espertoDisattivato': 'Local expert layer disabled.',

            // --- HEADER CONDIVISO (visibile su ogni pagina): bottone Esci, campana
            //     notifiche, widget utente in alto a destra. Non erano marcati in
            //     nessun lotto - segnalato durante la verifica del terzo lotto e
            //     ripiegato dentro su richiesta di Denis (27/08/2026). Il valore di
            //     experienceLevel ("Esperto"...) NON si traduce qui, coerente con la
            //     card identita' di profilo (profile.livelloReputazione, primo lotto):
            //     solo l'etichetta "Livello:". updateHeaderUserWidget (app.js) si
            //     registra su onChange per rimettere nome/reputazione/livello dopo che
            //     applyStaticTranslations ha riportato i data-i18n al testo di partenza.
            'header.esci': 'Log out',
            'header.esciTitle': 'Log out of your account',
            'header.notifiche': 'Notifications',
            'header.moderazioneTitle': 'Trail reports to review',
            'header.profiloTitle': 'Go to your profile',
            'header.caricamento': 'Loading...',
            'header.reputazione': 'Reputation: <strong id="current-user-reputation">--</strong>%',
            'header.livelloLabel': 'Level:',

            // Etichetta generica riusata da #my-profile (bottone "Salva" del
            // modulo esperto locale) - come common.elimina/cancella dei lotti
            // precedenti, sta qui per essere riusabile dai lotti futuri.
            'common.salva': 'Save',

            // ==================================================================
            // Rollout punto 102, QUARTO lotto (27/08/2026): Sicurezza & Mesh -
            // l'INTERA funzione di safety.js, confermato da Denis ("tutta la
            // funzione safety.js"): la sezione #safety (simulatore mesh, radar,
            // chat mesh, registro avvisi), la fascia #emergency-banner in cima a
            // ogni pagina, e il form Dead Man's Switch + tasto SOS 112 che dal
            // punto 17 vivono nella barra laterale della Mappa (NON il resto
            // della sezione Mappa - livelli, progetta percorso, meteo,
            // tracciamento - che resta al lotto Mappa).
            //
            // Scelte non ovvie di questo lotto:
            // 1) Registro avvisi (#sms-log-entries) e chat mesh (#mesh-messages-log)
            //    NON si ridisegnano al cambio lingua: sono la cronologia di
            //    eventi di una sessione, le voci nuove escono gia' nella lingua
            //    attiva al momento dell'evento - stesso residuo onesto scelto
            //    per chatpanel.js (07-Trappole-Tecniche.md). I loro segnaposto
            //    di stato vuoto sono testo statico e si traducono.
            // 2) Il menu "chi avvisare" e il suo hint SI ridisegnano (safety.js
            //    -> onChange): dati gia' in CamoscioState, nessun fetch, nessun
            //    flicker. Le opzioni restano "Nome (relazione)" - dato utente.
            // 3) Il testo auto del tasto SOS mesh (safety.mesh.sosText) viene
            //    trasmesso via WebSocket agli altri client e mostrato come
            //    arriva: chi lo manda lo vede nella propria lingua, chi lo
            //    riceve nella lingua di chi l'ha mandato - il punto 1 sopra e'
            //    lo stesso principio: testo scritto una volta sola, non riletto
            //    nella lingua di chi guarda dopo.
            // 4) Orario nel registro avvisi (toLocaleTimeString): locale
            //    'en-GB'/'it-IT' come per le date col nome del mese.
            'sectionTitle.safety': 'Safety',

            // --- Fascia rossa #emergency-banner (globale). data-i18n-html: dentro
            //     c'e' <span id="emergency-banner-timer"> che safety.js aggiorna
            //     ogni secondo. Un cambio lingua a timer attivo lo rimette a
            //     "00:00" per <1s (il countdown lo riscrive subito) - caso raro,
            //     costo accettato per non spezzare il testo attorno al segnaposto.
            'safety.banner.testo': '<strong>DEAD MAN\'S SWITCH ACTIVE:</strong> <span id="emergency-banner-timer">00:00</span> left until your estimated return. Check in to turn it off.',
            'safety.banner.checkin': 'Safe check-in',

            // --- Sezione #safety: card "Timer di Sicurezza" (rimando alla Mappa) ---
            'safety.sez.timerTitolo': 'Safety Timer',
            'safety.sez.timerDesc': 'The Dead Man\'s Switch is set from the <strong>Map &amp; Trails</strong> section, next to the SOS button: you need it while you\'re on the move, not sitting still.',
            'safety.sez.vaiAllaMappa': 'Go to the Map',
            'safety.sez.registroTitolo': 'Emergency alerts log (simulated)',
            'safety.sez.registroVuoto': 'No messages sent. The system is in a safe state.',

            // --- Sezione #safety: Simulatore Mesh Networking ---
            'safety.sez.meshTitolo': 'Mesh Networking Simulator (Offline Link)',
            'safety.sez.meshDesc': 'When there\'s no signal, the app builds a Wi-Fi Direct/Bluetooth network between nearby devices (50-100m) to exchange messages and positions in real time.',
            'safety.mesh.statoAttivo': 'Active (Connected to Mesh Server)',
            'safety.mesh.statoOffline': 'Offline (Trying to reconnect...)',
            'safety.mesh.legendaTu': 'You',
            'safety.mesh.legendaCompagno': 'Peer on the Network',
            'safety.mesh.canaleTitolo': 'Local Mesh SOS Channel (100m Range)',
            'safety.mesh.inAttesa': 'Waiting for network traffic... Open the app in several browser tabs as different users to test the mesh in real time!',
            'safety.mesh.inputPlaceholder': 'Write a message or SOS...',
            'safety.mesh.invia': 'Send',
            'safety.mesh.sosText': 'SOS! IMMEDIATE ASSISTANCE NEEDED / ACCIDENT ON THE TRAIL!',
            'safety.mesh.posNonDisp': 'position not available',

            // --- Tasto SOS 112 (barra laterale Mappa, safety.js -> chiamaSos) ---
            'safety.sos.btnTitle': 'Call the 112 emergency number',
            'safety.sos.staiPerChiamare': 'You\'re about to call 112, the single emergency number.',
            'safety.sos.leggiCoordinate': 'READ THESE COORDINATES TO THE OPERATOR:',
            'safety.sos.rilevata': function (quando, metri) { return '(detected ' + quando + ', accurate to within ' + metri + ' meters)'; },
            'safety.sos.nonHoPosizione': 'I DON\'T HAVE YOUR POSITION.',
            'safety.sos.senzaPosizione1': 'If you have a moment: close this, press "Where am I" at the top right of the map and try again. Knowing where you are is the first thing they\'ll ask.',
            'safety.sos.senzaPosizione2': 'If there\'s no time, call anyway and describe out loud where you are.',
            'safety.sos.notaTecnica': 'The site only opens the phone with the number ready: you make the call. If there\'s no signal and your phone has satellite SOS, it\'s the phone that uses it — not this site.',
            'safety.sos.chiama112': 'Call 112',

            // --- daQuantoInParole (safety.js): usata nei testi SOS e allarme ---
            'safety.tempo.adesso': 'just now',
            'safety.tempo.minutiFa': function (n) { return n + (n === 1 ? ' minute ago' : ' minutes ago'); },
            'safety.tempo.oreFa': function (n) { return n + (n === 1 ? ' hour ago' : ' hours ago'); },

            // --- Form Dead Man's Switch (barra laterale Mappa): testo statico HTML ---
            'safety.dms.titolo': 'Safety Timer (Dead Man\'s Switch)',
            'safety.dms.desc': "Set the time you expect to be back. If you don't check in by then, an email alert goes out to all your emergency contacts.",
            'safety.dms.contattiTitolo': 'Emergency contacts (all alerted at expiry):',
            'safety.dms.nome': 'Name',
            'safety.dms.nomePlaceholder': 'E.g. Anna',
            'safety.dms.chiE': 'Relationship',
            'safety.dms.chiEPlaceholder': 'E.g. sister',
            'safety.dms.email': 'Email',
            'safety.dms.emailPlaceholder': 'Used to send them the alert',
            'safety.dms.salvaContatto': 'Save contact',
            'safety.dms.salvataggio': 'Saving…',
            'safety.dms.aggiungiContatto': 'Add a contact',
            'safety.dms.fraQuanteOre': 'In how many hours you\'ll be back:',
            'safety.dms.oppureCheOra': 'Or at what time:',
            'safety.dms.attiva': 'Start the timer',
            'safety.dms.disattiva': 'I\'m safe (turn off)',
            'safety.dms.notaOnesta': "The alert really works, even with the phone off or the page closed: if the timer runs out, within a few minutes a real email goes to all your emergency contacts. It's still not your only safety net: always tell someone where you're going.",

            // --- Form Dead Man's Switch: testo generato da JS (safety.js) ---
            // A-3.2: niente piu' "contatto scelto" - l'allarme va a tutti quelli con un'email.
            'safety.dms.senzaEmail': 'no email',
            'safety.dms.avvisaTuttiPrefix': 'At expiry the alert goes by email to all your contacts:',
            'safety.dms.confermaRimuovi': function (nome) { return 'Remove ' + nome + ' from your emergency contacts?'; },
            'safety.dms.contattoRimosso': 'Contact removed.',
            'safety.dms.rimossoUltimoConEmail': 'You removed the last contact with an email while the timer is active: no alert will go out at expiry.',
            'safety.dms.erroreRimozione': "I couldn't remove the contact. Try again.",
            'safety.dms.avvisoNessunContatto': 'You have no emergency contact: without one, the timer would have nobody to alert. Add one below.',
            'safety.dms.avvisoNessunaEmail': 'None of your contacts has an email, which is needed to send the alert: add one below.',
            'safety.dms.serveContattoEmail': 'Add an emergency contact with an email before starting the timer.',
            'safety.dms.campiObbligatori': 'All three fields are needed: name, relationship and email.',
            'safety.dms.emailNonValida': 'That email doesn\'t look valid.',
            'safety.dms.contattoSalvato': 'Emergency contact saved.',
            'safety.dms.erroreContatto': 'I couldn\'t save the contact. Try again.',
            'safety.dms.timerLocaleNonServer': 'The timer is active on this phone, but I couldn\'t notify the server: if you close the page the automatic alert might not go out. Try again when you have signal.',
            'safety.dms.checkinNonServer': 'I couldn\'t tell the server you\'re safe. Your emergency contact might still get an alert when the time runs out. Try again as soon as you have signal, or reach out to them directly yourself.',

            // --- Registro avvisi (logSimulatedSms) e allarme scaduto (safety.js) ---
            'safety.log.sistema': '[SYSTEM]',
            'safety.log.timerAttivato': function (ora, nome) { return 'Timer started. Expected return: ' + ora + '. To alert: ' + nome + '.'; },
            'safety.log.checkinOk': 'Check-in completed successfully. Device deactivated. Safe Station.',
            'safety.log.sosLine': function (a, m) { return 'To: ' + a + ' - MSG: ' + m; },
            'safety.alarm.nessunContatto': 'no saved contact',
            'safety.alarm.posRilevata': function (lat, lng, quando) { return lat + ', ' + lng + ' (detected ' + quando + ')'; },
            'safety.alarm.posSconosciuta': 'unknown - the GPS never provided a position',
            'safety.alarm.msg': function (posizione) { return 'The hiker did not return by the expected time. Last known position: ' + posizione + '.'; },
            'safety.alarm.modal': function (msg, aChi) {
                return '⏰ TIME IS UP\n\n' + msg + '\n\n' +
                    'You should have alerted: ' + aChi + '\n\n' +
                    'This on-screen warning doesn’t send anything by itself: it’s only here, on this phone. ' +
                    'The real sending is done by the server, within a few minutes and regardless of this page. ' +
                    'If you’re the one reading this and you’re okay, check in right away to stop it. If you’re ' +
                    'reading this on someone else’s behalf, alert the contact above yourself.';
            },

            // ==================================================================
            // Rollout punto 102, QUINTO lotto (28/08/2026): Sociale - la sezione
            // #social (Tribu, Recensioni & Squadre) e le parti di social.js NON
            // gia' tradotte al secondo lotto (buildHikeCard/escursioni/modali),
            // PIU' chatpanel.js (chat condivisa da pagina squadra e pagina
            // escursione, rimasta indietro dal primo lotto: i suoi chiamanti
            // traducono gia' il titolo passato a render({title}), mancavano solo
            // le stringhe interne). Confermato da Denis ("andiamo avanti con il
            // prossimo lotto"), chatpanel.js gia' concordato per questo lotto.
            //
            // Scelte non ovvie:
            // 1) Le parti SINCRONE di #social (elenco squadre proprie/altrui,
            //    match obiettivi, riquadro "obiettivo attuale") si ridisegnano
            //    SEMPRE al cambio lingua - dati gia' in CamoscioState, come
            //    renderHikesList al secondo lotto. Il <select> delle recensioni
            //    (populateReviewTargets, che fa un fetch a /api/reviews/gia-recensite)
            //    si ridisegna solo se #social e' la sezione aperta - stesso schema
            //    di renderCompletate (storico.js) al secondo lotto: nessun fetch a
            //    vuoto per una pagina che non si sta guardando, ma nessuna stringa
            //    nella lingua sbagliata quando la pagina e' davanti agli occhi.
            // 2) chatpanel.js: nessun onChange. Il giro di polling perderebbe la
            //    posizione di scroll (stessa lezione di refreshSquadHeaderAndMembers),
            //    e i messaggi nuovi escono gia' nella lingua attiva.
            // 3) Data col nome del mese in rigaInvitoSquadra (riquadro "Invita a
            //    Gita"): locale 'en-GB'/'it-IT' come per le altre date estese.
            // 4) sectionTitle.social e la voce di menu portano lo stesso testo.
            //    PASSO 6 lo accorcio' da "Tribe, Reviews & Squads"; PASSO 7 (01/09)
            //    rinomina la sezione "Community" (data-target resta 'social') - vedi
            //    nav.community nel commento di nav.* piu' sopra.
            // 5) Un residuo del secondo lotto corretto qui perche' trovato
            //    lavorando nel file: il tooltip "Esperto locale: <zona>" sugli
            //    avatar dei partecipanti in buildHikeCard, ora dietro T()
            //    (riusa profile.espertoLocale del primo lotto). Il badge "Admin"
            //    su squadpage.js resta invariato: e' gia' inglese, come "Carpooling".
            'sectionTitle.social': 'Community',

            // --- #social: card "Le tue Squadre Ricorrenti" (HTML statico) ---
            'social.squadsTitle': 'Your Recurring Squads',
            'social.squadsDesc': 'If a group works well, save it as a fixed squad to create new hikes with one click, inviting everyone automatically.',
            'social.createSquadBtn': 'Create New Squad',
            'social.squadNameLabel': 'Squad Name:',
            'social.squadNamePlaceholder': 'E.g. The Gran Sasso Chamois',
            'social.addMembersLabel': 'Add members (search by username):',
            'social.searchUserPlaceholder': 'Search by username...',
            'social.selectedMembersLabel': 'Selected members:',
            'social.createSquadConfirm': 'Create Squad',

            // --- #social: card "Altre Squadre" ---
            'social.otherSquadsTitle': 'Other Squads',
            'social.otherSquadsDesc': "Other hikers' squads: ask to join, an admin just needs to confirm.",

            // --- #social: card "Match su Obiettivi Comuni" ---
            'social.goalsTitle': 'Match on Shared Goals',
            'social.goalsDesc': 'Training for a big mountaineering goal in a few months? Find partners with the same goal to plan focused training hikes.',
            'social.goalLabel': 'Your long-term mountaineering goal:',
            'social.goalPlaceholder': 'E.g. Mont Blanc, Matterhorn, Gran Paradiso...',
            'social.saveGoalBtn': 'Save Goal',
            'social.compatibleTitle': 'Hikers with compatible goals:',

            // --- #social: card "Recensioni Post-Escursione" ---
            // reviewsDesc tiene i marcatori **...** identici all'italiano (quel
            // testo non viene passato per un renderer markdown, gli asterischi si
            // vedono cosi' come sono gia' oggi in italiano - non e' questo lotto a
            // cambiarlo).
            'social.reviewsTitle': 'Post-Hike Reviews (100% Anonymous)',
            'social.reviewsDesc': 'To keep the group safe and trusting, mutual ratings are mandatory and **strictly anonymous** (scores are only aggregated, never shown individually).',
            'social.whoToReviewLabel': 'Who do you want to review?',
            'social.punctualityLabel': 'Punctuality (1-5):',
            'social.equipmentLabel': 'Adequate Equipment (1-5):',
            'social.respectLabel': 'Group/Environment Respect (1-5):',
            'social.sendReviewBtn': 'Send Anonymous Review',

            // --- #social: obiettivi di allenamento (social.js). currentGoal e
            //     trainsFor sono etichette che precedono uno <strong> costruito in
            //     JS con il testo (gia' escaped) dell'utente - solo l'etichetta. ---
            'social.currentGoal': 'Your current goal:',
            'social.enterGoalHint': 'Enter a goal to find training partners.',
            'social.noSameGoal': 'No hiker has the same goal right now.',
            'social.trainsFor': 'is training for:',
            'social.inviteToSquad': 'Invite to Squad',

            // --- #social: elenco squadre (social.js) ---
            'social.noFixedSquad': 'No fixed squad created yet.',
            'social.inviteToHike': 'Invite to Hike',
            'social.memberBadge': 'Member',
            'social.noOtherSquads': 'No other squads for now.',
            'social.requestSent': 'Request sent',
            'social.errRequestSend': 'Could not send the request.',
            'social.removeFromSquadTitle': 'Remove from squad',
            'social.noMembersYet': 'No members added yet (besides you).',

            // --- #social: modale "Invita a Gita" (#invite-squad-modal + social.js) ---
            'social.inviteModalPre': 'Invite',
            'social.inviteModalPost': 'to a hike',
            'social.inviteModalDesc': "Choose the hike: squad members get an invitation and join only if they accept. On someone else's hike that requires approval, only the organizer can invite.",
            'social.you': 'you',
            'social.anotherUser': 'another user',
            'social.noDate': 'date not set',
            'social.needsApproval': 'Needs approval',
            'social.inviteOnlyOrganizer': 'Only the organizer can invite a squad',
            'social.allMembersInOrPending': 'All members are already joined or pending',
            'social.allMembersIn': 'All members are already joined',
            'social.toPropose': function (n) { return n + ' to propose'; },
            'social.toAdd': function (n) { return n + (n === 1 ? ' member to add' : ' members to add'); },
            // Invito squadra direzionale (27ª): l'invito NON aggiunge, propone alla persona.
            'social.toInvite': function (n) { return n + ' to invite'; },
            'social.allMembersInvited': 'All members are already joined, pending or invited',
            'social.squadInvited': function (squad, hike, n) { return 'Invitation sent to ' + n + (n === 1 ? ' member' : ' members') + ' of "' + squad + '": they will join "' + hike + '" only if they accept.'; },
            'social.organizedBy': function (chi) { return 'Organized by ' + chi; },
            'social.organizedByYou': 'Organized by you',
            'social.youreJoining': "You're joining",
            'social.noOpenHikeForInvite': function (squad) { return 'You have no open hike to invite "' + squad + '" to: completed hikes can no longer be changed. Create a new one from the Hikes section.'; },
            'social.squadOrHikeGone': 'Squad or hike no longer available.',
            'social.hikeNotAvailableInvite': function (titolo) { return '"' + titolo + '" is no longer available for an invite.'; },
            'social.allAlreadyIn': function (squad, hike) { return 'All members of "' + squad + '" are already joined (or pending) on "' + hike + '".'; },
            'social.errInviteSend': 'Could not send the invite.',
            'social.squadAdded': function (squad, hike, n) { return '"' + squad + '" added to "' + hike + '": ' + n + (n === 1 ? ' new participant.' : ' new participants.'); },
            'social.squadProposed': function (squad, hike, n) { return 'Request sent for ' + n + (n === 1 ? ' member' : ' members') + ' of "' + squad + '": they will join "' + hike + '" only if the organizer approves it.'; },
            // Consenso squadra (27ª): creazione, card "Inviti alle squadre", risposta.
            'social.squadCreated': 'Squad created.',
            'social.squadCreatedInvited': function (n) { return 'Squad created. Invitation sent to ' + n + (n === 1 ? ' person: they will' : ' people: they will') + ' join only if they accept.'; },
            'social.squadInvitesTitle': 'Squad invitations',
            'social.squadInvitesDesc': 'Squads that invited you. You decide whether to join.',
            'social.acceptSquadInvite': 'Accept',
            'social.declineSquadInvite': 'Decline',
            'social.squadInviteAccepted': 'You have joined the squad.',
            'social.squadInviteDeclined': 'Invitation declined.',
            'social.squadInviteNoLongerValid': 'This invitation is no longer valid.',

            // --- #social: recensioni anonime (social.js) ---
            'social.noPastSharedHikes': 'No past shared hikes to review',
            'social.allReviewed': "You've already reviewed everyone from your completed hikes",
            'social.reviewSent': 'Feedback sent! The review stays 100% anonymous in the system.',
            'social.errReviewSend': 'Could not send the review.',

            // ==================================================================
            // chatpanel.js - chat condivisa pagina squadra / pagina escursione
            // (punto 55). Il titolo lo passa gia' tradotto chi chiama render()
            // (squadPage.chatTitolo / hikePage.chatTitolo, primo lotto). "Utente"
            // riusa common.utente. Nessun onChange, vedi nota 2 sopra.
            'chat.loading': 'Loading messages...',
            'chat.inputPlaceholder': 'Write a message...',
            'chat.send': 'Send',
            'chat.empty': 'No messages yet, write the first one.',
            'chat.errSend': 'Could not send the message.',

            // ==================================================================
            // Rollout punto 102, SESTO lotto (28/08/2026): Carpooling + Zaino -
            // le due sezioni #carpool e #backpack e i due file carpool.js (484
            // righe) e backpack.js (919) per intero, un solo lotto. Denis ha
            // scelto "Carpooling + Zaino insieme" (AskUserQuestion). Nessun
            // modale dedicato a queste due sezioni.
            //
            // Scelte non ovvie:
            // 1) sectionTitle.carpool esiste anche se la voce di menu "Carpooling"
            //    NON e' tradotta (e' gia' inglese): serve comunque perche' l'header
            //    ha un meccanismo suo (updateSectionTitle) che parte da prettyNames
            //    in italiano. Dalla revisione UX v2 (PASSO 6) header e menu portano
            //    lo stesso testo, "Carpooling" (prima l'header diceva "Carpooling &
            //    Spese Viaggio" / "...& Travel Costs", accorciato perche' si troncava
            //    su telefono). Idem sectionTitle.backpack -> "Smart Backpack", uguale
            //    a nav.backpack (che esisteva gia' dal primo lotto).
            // 2) I nomi degli oggetti della checklist generati dalle REGOLE di
            //    backpack.js (Scarponi da trekking, Mantella impermeabile...),
            //    le categorie (Abbigliamento, Attrezzatura...) e i "generi"
            //    (tenda, cucina...) sono vocabolario fisso NOSTRO, come
            //    Difficolta'/Tag Tribu' del secondo lotto: tradotti SOLO per la
            //    visualizzazione. Il valore usato per raggruppare e - questo e'
            //    il punto delicato - la CHIAVE localStorage dello stato spuntato
            //    (chiaveSpuntato keya su item.name) restano SEMPRE la stringa
            //    italiana: cambiare lingua non fa mai perdere un oggetto gia'
            //    spuntato. Gli oggetti del template escursione e quelli
            //    personali aggiunti a mano (testo dell'utente) non stanno nel
            //    dizionario: T() torna null e si ripiega al loro testo originale.
            // 3) Cambio lingua stando sulla pagina: #carpool si ridisegna
            //    tutto (nessun fetch nel suo percorso sincrono). #backpack pure
            //    SI ridisegna (la checklist via innerHTML sarebbe altrimenti
            //    stantia sotto gli occhi), ma SENZA rifare il fetch meteo di
            //    open-meteo: applyBackpackRules (l'imbuto sincrono) salva i suoi
            //    ultimi input in ultimoInputZaino, l'onChange li rigioca. Stessa
            //    logica della Dashboard al terzo lotto (ridisegna, non rifetch).
            //    Entrambi solo se la loro sezione e' quella attiva (navigateTo
            //    li ridisegna comunque all'ingresso), come renderCompletate.
            // 4) Decimali: gli importi in € del calcolatore spese e i kg della
            //    ripartizione pesi usano virgola (IT) / punto (EN), come
            //    formattaDecimale del secondo lotto - helper minuscolo
            //    duplicato in locale nei due file, come gia' fa storico.js.
            // 5) La conferma di cancellazione di un annuncio auto
            //    (showConfirmModal in carpool.js) e' stata allineata all'idioma
            //    gia' usato dai due "cancella una cosa tua" gemelli in
            //    social.js/storico.js: T('common.elimina') + cancelLabel
            //    T('common.cancella') + danger:true. Le altre showConfirmModal
            //    del sito (Mappa, tracciamento, moderazione) restano in
            //    italiano: sono lotti futuri.
            // V2 UX PASSO 14b: 'sectionTitle.carpool' ritirata - #carpool e' un tab di
            // hike-page, il cui header e' sempre il nome dell'escursione.
            // V2 UX PASSO 14c: 'sectionTitle.backpack' ritirata - lo Zaino e' un tab di hike-page.

            // Etichette generiche riusabili (come common.elimina/cancella dei
            // lotti precedenti) - stanno qui per i lotti futuri.
            'common.modifica': 'Edit',
            'common.salvataggio': 'Saving…',

            // ===================== CARPOOLING (#carpool) =======================
            // --- Calcolatore spese viaggio (HTML statico) ---
            'carpool.calc.titolo': 'Travel Cost Split',
            'carpool.calc.desc': 'Enter the outbound trip only: the return is calculated automatically, on the same figures.',
            'carpool.calc.distLabel': 'Outbound Distance (km):',
            'carpool.calc.consumoLabel': 'Consumption (L/100km):',
            'carpool.calc.benzinaLabel': 'Fuel Price (€/L):',
            'carpool.calc.pedaggioLabel': 'Outbound Toll (€):',
            'carpool.calc.extraLabel': 'Extra Costs (e.g. parking, hut):',
            'carpool.calc.personeLabel': 'Total People in the Car:',
            'carpool.calc.ricalcolaBtn': 'Recalculate Cost Split',
            'carpool.calc.resFuelLabel': 'Total Fuel Cost:',
            'carpool.calc.resTotalLabel': 'Total Trip Cost (round trip):',
            'carpool.calc.resShareLabel': 'Share per Person:',

            // --- Il tuo annuncio auto / Offri un passaggio (HTML statico) ---
            // V2 UX PASSO 14b: annuncio per-uscita (era "Your Car Listings", tutte le
            // escursioni); via 'carpool.driver.hikeLabel' (il selettore escursione e' sparito).
            'carpool.offers.titoloUscita': 'Your ride offer',
            'carpool.driver.titolo': 'Offer a Ride',
            'carpool.driver.cityLabel': 'Departure City:',
            'carpool.driver.cityPlaceholder': 'E.g. Milan, Bergamo...',
            'carpool.driver.seatsLabel': 'Free Seats in the Car:',
            'carpool.driver.distLabel': 'Estimated round-trip distance (km):',
            'carpool.driver.pubblicaBtn': 'Publish Available Car',

            // --- Abbinamenti & privacy partenze (HTML statico) ---
            'carpool.match.titolo': 'Smart Matching & Departure Privacy',
            'carpool.match.desc': 'Share your home departure area. The algorithm shows matches only if 2 or more people are from the same area, to protect privacy.',
            'carpool.match.homeLabel': "Town / departure area (not your exact address):",
            'carpool.match.homePlaceholder': "E.g. Roma Nord, L'Aquila, Rieti...",
            'carpool.match.salvaZonaBtn': 'Save Area',
            'carpool.match.dispTitolo': 'Available cars and rides:',

            // --- carpool.js: testo generato da JS ---
            // V2 UX PASSO 14b: messaggio per-uscita (era 'carpool.js.nessunAnnuncio', su tutte).
            'carpool.js.nessunAnnuncioUscita': "You haven't offered a ride for this outing yet. Use the form below.",
            'carpool.js.postiOccupati': function (n, tot) { return n + '/' + tot + ' seats taken'; },
            'carpool.js.partenzaDaLabel': 'Departure from:',
            'carpool.js.cancellaAnnuncio': 'Delete listing',
            'carpool.js.confermaCancellaConPasseggeri': function (n) { return 'You have ' + n + (n === 1 ? ' passenger' : ' passengers') + ' on board: deleting the listing would leave them with no ride and no notice. Delete anyway?'; },
            'carpool.js.confermaCancella': 'Delete this listing?',
            'carpool.js.annuncioCancellato': 'Listing deleted.',
            'carpool.js.nessunaZona': 'No departure area entered. Enter your area to find nearby companions.',
            'carpool.js.matchTrovato': function (quanti) { return '<strong>DEPARTURE MATCH FOUND!</strong> ' + quanti + (quanti === 1 ? ' other participant leaves' : ' other participants leave') + ' from your same area. Check the participant list or use "Offer a Ride" to sort it out.'; },
            'carpool.js.posizioneProtetta': function (citta) { return '<strong>Position protected:</strong> You\'re leaving from <i>"' + citta + '"</i>. Right now no other participant leaves from your area. Your departure will stay hidden for privacy.'; },
            'carpool.js.nessunaAuto': 'No car registered for this hike yet. Be the first to offer a ride!',
            'carpool.js.passeggeroFallback': 'Passenger',
            'carpool.js.nessunPasseggero': 'No passengers on board',
            'carpool.js.laTuaAuto': 'Your Car',
            'carpool.js.abbandonaAuto': 'Leave Car',
            'carpool.js.saliABordo': 'Hop In',
            'carpool.js.autoPiena': 'Car Full',
            'carpool.js.conducenteLabel': 'Driver:',
            'carpool.js.postiLiberiLabel': 'Free seats:',
            'carpool.js.costoStimatoLabel': 'Estimated cost per passenger:',
            'carpool.js.equipaggioLabel': 'Crew:',

            // ================== ZAINO INTELLIGENTE (#backpack) =================
            // --- Generatore checklist (HTML statico) ---
            'backpack.gen.titolo': 'Smart Checklist Generator',
            'backpack.gen.desc': "Enter the environmental data to get a recommended checklist. Your list is private: other participants don't see it.",
            // V2 UX PASSO 14c: ritirate backpack.gen.perQualeLabel / perAuto / grpOrganizzate /
            // grpPartecipo / perPersonale - non c'e' piu' il selettore "prepara lo zaino per"
            // ne' lo "zaino personale" (Q6): il tab e' gia' di una singola escursione.
            'backpack.gen.stagioneLabel': 'Season:',
            'backpack.gen.stagioneEstate': 'Summer (Heat, sudden storms)',
            'backpack.gen.stagioneInverno': 'Winter (Deep cold, ice, snow)',
            'backpack.gen.stagioneMezza': 'Shoulder Season (Wind, rain, layering)',
            'backpack.gen.quotaLabel': 'Max Altitude (meters):',
            // Blocco zaino/carpooling per-partecipanti: ritirate backpack.gen.durataLabel /
            // durataGiornata / durataPluri - non c'e' piu' il <select> "durata escursione",
            // la durata la dice l'escursione del tab (hike.multiDay).
            'backpack.gen.pioggiaCheck': 'Rain / Bad Weather Forecast',
            'backpack.gen.generaBtn': 'Generate Dynamic Checklist',

            // --- Ripartizione pesi / porto io una cosa per tutti (HTML statico) ---
            'backpack.weight.titolo': 'Group Weight Split',
            'backpack.weight.desc': 'Only items that are shared: tent, stove, first-aid kit. Personal things (jacket, water, food) are carried by each person and are not shown here.',
            'backpack.shared.titolo': "I'm carrying something for everyone",
            'backpack.shared.nomePlaceholder': 'E.g. 3-person tent',
            'backpack.shared.pesoPlaceholder': 'E.g. 2400',
            'backpack.shared.copreLabel': 'For how many people:',
            'backpack.shared.coprePlaceholder': 'Empty = everyone',
            'backpack.shared.hint': 'The number of people matters for things that only cover a few, like a tent. One stove is enough for the group: leave it empty.',
            'backpack.shared.aggiungiBtn': 'Add to the group list',

            // --- La tua checklist / aggiungi una tua cosa (HTML statico) ---
            'backpack.list.titolo': 'Your Checklist',
            'backpack.personal.titolo': 'Add something of yours',
            'backpack.personal.nomePlaceholder': 'E.g. Trekking poles',
            'backpack.personal.pesoPlaceholder': 'E.g. 400',
            'backpack.personal.aggiungiBtn': 'Add to my list',
            'backpack.list.confermatoBanner': 'Backpack confirmed: you have everything mandatory.',
            'backpack.list.confermaBtn': 'Confirm backpack',

            // --- Etichette dei campi "cosa / peso" (condivise dai due form) ---
            'backpack.form.cosaLabel': 'What:',
            'backpack.form.pesoLabel': 'Weight (grams):',

            // --- Vocabolario checklist: OGGETTI generati dalle regole. Vedi
            //     nota (2): il valore/chiave localStorage resta la stringa IT,
            //     qui solo la traduzione per la visualizzazione. ---
            'backpack.item.Scarponi da trekking': 'Trekking boots',
            'backpack.item.Acqua (almeno 1.5 Litri)': 'Water (at least 1.5 Liters)',
            'backpack.item.Snack energetici / Pranzo': 'Energy snacks / Lunch',
            'backpack.item.Fischietto di emergenza': 'Emergency whistle',
            'backpack.item.Coperta termica alluminata': 'Aluminized emergency blanket',
            'backpack.item.Borraccia vuota extra': 'Extra empty water bottle',
            'backpack.item.Ramponcini di sicurezza': 'Safety micro-spikes',
            'backpack.item.Guscio antivento termico (Goretex)': 'Windproof thermal shell (Goretex)',
            'backpack.item.Guanti e berretto caldi': 'Warm gloves and hat',
            'backpack.item.K-Way o giacca leggera': 'Windbreaker or light jacket',
            'backpack.item.Mantella impermeabile / Poncho': 'Waterproof cape / Poncho',
            'backpack.item.Coprizaino impermeabile': 'Waterproof backpack cover',
            'backpack.item.Sacchetti stagni per indumenti': 'Dry bags for clothing',
            'backpack.item.Cramponi classici da ghiaccio': 'Classic ice crampons',
            'backpack.item.Ghette da neve': 'Snow gaiters',
            'backpack.item.Thermos per bevande calde': 'Thermos for hot drinks',
            'backpack.item.Piumino leggero extra': 'Extra light down jacket',
            'backpack.item.Crema solare protettiva': 'Protective sunscreen',
            'backpack.item.Cappellino da sole': 'Sun hat',
            'backpack.item.Sali minerali di scorta': 'Spare mineral salts',
            'backpack.item.Sacco a pelo confort 0°C': 'Sleeping bag, comfort 0°C',
            'backpack.item.Materassino isolante': 'Insulating sleeping mat',
            'backpack.item.Torcia frontale + batterie': 'Headlamp + batteries',
            'backpack.item.Powerbank per cellulare': 'Phone power bank',
            'backpack.item.Articoli per igiene personale': 'Personal hygiene items',

            // --- Vocabolario checklist: CATEGORIE (solo visualizzazione) ---
            'backpack.cat.Abbigliamento': 'Clothing',
            'backpack.cat.Attrezzatura': 'Gear',
            'backpack.cat.Alimentazione': 'Food & Drink',
            'backpack.cat.Sicurezza / Emergenza': 'Safety / Emergency',
            'backpack.cat.Igiene': 'Hygiene',
            'backpack.cat.Aggiunte da te': 'Added by you',
            'backpack.cat.Attrezzatura di gruppo': 'Group gear',

            // --- Vocabolario checklist: GENERI oggetti condivisi (avviso copertura) ---
            'backpack.genere.tenda': 'tent',
            'backpack.genere.cucina': 'kitchen',
            'backpack.genere.primo soccorso': 'first aid',
            'backpack.genere.corda': 'rope',
            'backpack.genere.acqua': 'water',
            'backpack.genere.navigazione': 'navigation',
            'backpack.genere.riparo': 'shelter',
            'backpack.genere.luce da campo': 'camp light',

            // --- backpack.js: badge regole + avvisi (applyBackpackRules) ---
            'backpack.js.badgeAltaQuota': 'Altitude > 2500m',
            'backpack.js.badgeQuotaStd': 'Standard Altitude',
            'backpack.js.alertQuota': 'Altitude above 2500m: <strong>Thermal Shell</strong> and <strong>Micro-spikes</strong> have been forced into the backpack!',
            'backpack.js.alertPioggia': 'Rain forecast: <strong>Waterproof Cape</strong> mandatory!',

            // --- backpack.js: riga della checklist (renderChecklistUI) ---
            'backpack.js.obbligatorioTag': 'MANDATORY',
            'backpack.js.portaLabel': 'Carried by:',
            'backpack.js.qualcuno': 'Someone',
            'backpack.js.daAssegnare': 'To assign',
            'backpack.js.posti': function (n) { return n + (n === 1 ? ' spot' : ' spots'); },

            // --- backpack.js: riquadro escursione di riferimento (mostraEscursioneDiRiferimento) ---
            // V2 UX PASSO 14c: ritirate backpack.js.zainoPersonaleTitolo/Desc/Scelto (Q6:
            // niente piu' "zaino personale" - il tab e' sempre di un'escursione vera).
            'backpack.js.zainoPerLabel': 'Backpack for:',
            'backpack.js.dataNonIndicata': 'date not set',
            'backpack.js.quotaMassimaLabel': 'max altitude',
            'backpack.js.organizzataDaTe': 'organized by you',
            'backpack.js.aCuiPartecipi': "you're joining",
            'backpack.js.piuGiorni': 'multi-day',
            'backpack.js.listaPrivata': "Your list is private: other participants don't see what you carry.",

            // --- backpack.js: nota previsione pioggia (mostraNotaPioggia) ---
            'backpack.js.meteoTroppoLontano': "Forecast not available yet: it's more than two weeks away. Check the backpack again in the days before you leave.",
            'backpack.js.meteoNonDisp': 'Weather forecast not available for this date: the list does not account for rain.',
            'backpack.js.meteoPioggia': 'Forecast: rain likely on the day of the hike. Cape and backpack cover have been made mandatory.',
            'backpack.js.meteoSereno': 'Forecast: a day without rain. Rain gear has not been forced into the list.',

            // --- backpack.js: avviso "non basta per tutti" (mostraAvvisiCopertura) ---
            'backpack.js.nonBastaPerTutti': 'Not enough for everyone',
            'backpack.js.neManca': 'One is <strong>missing</strong>',
            'backpack.js.neMancano': function (n) { return '<strong>' + n + '</strong> are missing'; },
            'backpack.js.coperturaRiga': function (intest, posti, persone, mancano) { return '<li><strong>' + intest + '</strong>: ' + posti + ' for ' + persone + ' people. ' + mancano + ': you need something bigger, or another one to add.</li>'; },

            // --- backpack.js: ripartizione pesi (renderWeightDistribution) ---
            'backpack.js.wdNessunaGruppo': "No upcoming group hike: there's nothing to split.",
            'backpack.js.wdSoloTu': "For now you're the only one on this hike: there's no one to split the weight with. Items to share appear when someone else joins.",
            'backpack.js.wdNessunOggetto': 'No items to share on this hike. If you bring something everyone needs (tent, stove, first-aid kit) add it below.',
            'backpack.js.assegnaOggetto': 'Assign item...',

            // --- backpack.js: toast (aggiungi oggetto personale/condiviso, conferma zaino) ---
            'backpack.js.scriviCosa': "Write what you're carrying.",
            'backpack.js.mettiPeso': 'Enter a weight in grams.',
            'backpack.js.mettiPesoCarico': "Enter a weight in grams, it's needed to split the load.",
            'backpack.js.portataMin': 'The capacity must be at least 1 person, or leave it empty.',
            'backpack.js.aggiuntoTua': 'Added to your list.',
            'backpack.js.aggiuntoGruppo': "Added. You're carrying it for the group.",
            'backpack.js.erroreAggiunta': "I couldn't add it. Try again.",
            'backpack.js.mancaObbligatorio': function (elenco) { return 'Mandatory items still to check off: ' + elenco + '.'; },
            'backpack.js.zainoConfermatoToast': 'Backpack confirmed: you have everything mandatory!',

            // ==================================================================
            // Rollout punto 102, SETTIMO lotto (28/08/2026): Moderazione - la
            // sezione #pending-reports-page e pendingreports.js per intero (178
            // righe). Pagina senza voce in barra, si apre solo dal triangolo in
            // header (gia' col data-i18n-title dal terzo lotto), visibile solo a
            // chi ha canModerateReports. Denis: "andiamo avanti con la
            // moderazione" - ordine gia' fissato dal vault, niente AskUserQuestion.
            //
            // Scelte:
            // 1) Titolo fisso della pagina ("Segnalazioni da verificare",
            //    piu' corto del titolo della card "Segnalazioni sentiero da
            //    verificare"): aggiunto a prettyNames (app.js) E come
            //    'sectionTitle.pending-reports-page' -> updateSectionTitle lo
            //    rimette da solo a ogni cambio lingua, come #my-profile al terzo
            //    lotto. showPendingReportsPage non scrive piu' il titolo a mano.
            // 2) onChange in pendingreports.js: se #pending-reports-page e' la
            //    sezione attiva, ri-chiama showPendingReportsPage (ri-fetch +
            //    ridisegno lista) - la pagina fa gia' un fetch a ogni
            //    conferma/rifiuto, e il suo corpo via innerHTML sarebbe stantio
            //    sotto gli occhi al cambio lingua. Gate su sezione attiva come
            //    il <select> recensioni del quinto lotto.
            // 3) I tipi di segnalazione (emoji + titolo "Frana"/"Ghiaccio"...)
            //    vengono da window.CamoscioReportTypes in map.js: NON tradotti
            //    qui, restano al lotto Mappa (li usano anche i marker e la lista
            //    waze). In EN il pannello mostra bottoni/etichette tradotti
            //    accanto ai tipi in italiano - stesso caso del form DMS accanto
            //    ai comandi mappa al quarto lotto. Tradotto solo il ripiego
            //    'Avviso' per un tipo sconosciuto.
            // 4) err.error dal server resta italiano (dizionario solo lato
            //    client), tradotto solo il testo di ripiego.
            'sectionTitle.pending-reports-page': 'Report moderation',
            'pendingReports.cardTitolo': 'Trail reports to moderate',
            'pendingReports.cardDesc': 'Three queues: expired reports (renew or remove), resolutions requested by users (confirm or keep), and new reports (confirm or reject).',
            'pendingReports.erroreCaricamento': 'Could not load the reports to moderate.',
            'pendingReports.nessuna': 'No reports to review.',
            'pendingReports.avvisoFallback': 'Alert',
            'pendingReports.reporterNonDisponibile': 'user not available',
            'pendingReports.segnalatoDa': function (nome, data, lat, lng) { return 'Reported by ' + nome + ' on ' + data + ' — coord: ' + lat + ', ' + lng; },
            'pendingReports.rifiuta': 'Reject',
            'pendingReports.conferma': 'Confirm',
            'pendingReports.fotoAlt': 'Report photo',
            'pendingReports.confermata': 'Report confirmed: it is now visible to everyone.',
            'pendingReports.erroreConferma': 'Could not confirm the report.',
            'pendingReports.rifiutaConfermaMsg': 'Rejecting this report deletes it permanently, with no way to recover it. Continue?',
            'pendingReports.rifiutaConfermaBtn': 'Reject and delete',
            'pendingReports.rifiutata': 'Report rejected and deleted.',
            'pendingReports.erroreRifiuto': 'Could not reject the report.',
            // Punto 111: le due code nuove della pagina Moderazione.
            'pendingReports.scaduteTitolo': 'Expired',
            'pendingReports.scaduteDesc': 'Past the 90 days. Renew for another 90 days from today, or remove the report.',
            'pendingReports.risoluzioniTitolo': 'Resolution requests',
            'pendingReports.risoluzioniDesc': 'A user reported the hazard is gone. Confirm (the report is deleted) or keep it for now.',
            'pendingReports.daVerificareTitolo': 'To review',
            'pendingReports.daVerificareDesc': 'New reports, not public yet. Confirm (they become visible to everyone) or reject (they get deleted).',
            'pendingReports.nessunaScaduta': 'No expired reports.',
            'pendingReports.nessunaRisoluzione': 'No resolution requests.',
            'pendingReports.utenteSconosciuto': 'a user',
            'pendingReports.risoltaDa': function (nome, data) { return 'Reported as resolved by ' + nome + ' on ' + data; },
            'pendingReports.scadutaIl': function (data) { return 'Expired on ' + data; },
            'pendingReports.tieniAncora': 'Keep it',
            'pendingReports.confermaRisoluzione': 'Confirm resolution',
            'pendingReports.rinnova': 'Renew +90d',
            'pendingReports.togli': 'Remove',
            'pendingReports.rifiutaEElimina': 'Reject and delete',
            'pendingReports.tenutaAncora': 'Report kept active: the user can request resolution again.',
            'pendingReports.erroreTieniAncora': 'Could not keep the report.',
            'pendingReports.rinnovata': 'Expiry moved to 90 days from today.',
            'pendingReports.erroreRinnova': 'Could not renew the report.',
            'pendingReports.confermaRisoluzioneMsg': 'Do you confirm the hazard is gone? The report (photo included) will be permanently deleted, with no way to recover it.',
            'pendingReports.confermaRisoluzioneBtn': 'Confirm and delete',
            'pendingReports.risoluzioneConfermata': 'Resolution confirmed: report deleted.',
            'pendingReports.erroreConfermaRisoluzione': 'Could not confirm the resolution.',
            'pendingReports.togliMsg': 'Remove this expired report? It will be permanently deleted, photo included.',
            'pendingReports.togliBtn': 'Remove and delete',
            'pendingReports.tolta': 'Expired report removed.',
            'pendingReports.erroreTogli': 'Could not remove the report.',

            // ==================================================================
            // Rollout punto 102, LOTTO MAPPA - area 1 di 4 (28/08/2026):
            // "base mappa + Segnalazioni sentiero". La Mappa e' la sezione piu'
            // grande del sito e si traduce a aree, una alla volta (scelto da
            // Denis via AskUserQuestion). Quest'area: tutto public/js/map.js
            // TRANNE l'Esposizione Solare (renderSolarExposureAdvice +
            // calculateBearing/bearingToCompassSector), che sta in map.js ma va
            // con l'area 3 (Meteo + Esposizione Solare). Fuori anche progetta
            // percorso (area 2, routeplanner.js), meteo (area 3, weather.js) e
            // tracciamento (area 4, tracking.js/geolocation.js): la barra
            // laterale resta mezza italiana fino ai loro lotti, atteso - come
            // il form Dead Man's Switch (gia' tradotto al quarto lotto) accanto
            // ai comandi mappa italiani.
            //
            // Scelte non ovvie:
            // 1) I tipi di segnalazione (Frana/Ghiaccio/...) diventano
            //    window.CamoscioReportTypes.titleFor(tipo) in map.js: la CHIAVE
            //    resta il codice (frana/ghiaccio/fontana_secca/ostacolo), il
            //    valore salvato e inviato al server non cambia MAI - stessa
            //    regola di Difficolta'/Tag Tribu' al secondo lotto. Li legge
            //    anche pendingreports.js (settimo lotto), che ora passa da
            //    titleFor: era gia' previsto ("lavoro del lotto Mappa").
            // 2) Le opzioni <select> del tipo pericolo (con emoji davanti,
            //    "Frana / Cedimento" ecc.) hanno un testo diverso dai titoli di
            //    titleFor ("Presenza Ghiaccio" ecc.) - chiavi separate
            //    (map.wazeOpt.* vs map.reportType.*), ma condivise fra i due
            //    <select> identici (#waze-type nella sidebar e #report-fab-type
            //    nel pannello del FAB).
            // 3) map.js si ridisegna al cambio lingua SOLO se la Mappa e' la
            //    sezione attiva (renderMapMarkers + renderWazeReportsList +
            //    aggiornaTastoPosizione): lista segnalazioni e popup marker sono
            //    innerHTML, il tasto "Dove sono" ha il testo da JS - roba che
            //    applyStaticTranslations non tocca. Gate come il <select>
            //    recensioni del quinto lotto e la lista moderazione del settimo.
            // 4) Data "Segnalato il" nel popup del marker: toLocaleDateString con
            //    locale esplicito 'en-GB'/'it-IT' (solo cifre, identica nelle due
            //    lingue, ma il locale va passato - regola dei lotti 2-4).
            // 5) Conferma "risolvi segnalazione" allineata agli altri "cancella
            //    per sempre" (cancelLabel common.cancella + danger:true), come
            //    la gemella rejectPendingReport del settimo lotto.
            'sectionTitle.map-section': 'Map',

            // --- .map-overlay-instructions + tasto "Dove sono" (#btn-use-real-gps) ---
            'map.overlay.istruzioni': 'Click the map to report hazards or simulate your GPS position to stamp the peak.',
            'map.gps.doveSono': 'Where am I',
            'map.gps.laMiaPosizione': 'My position',
            'map.gps.titleSpento': 'Show your real position on the map',
            'map.gps.titleAcceso': 'Your position is on the map: tap to recenter, tap again when centered to hide it',
            'map.gps.localizzazione': 'Locating…',
            'map.gps.cercoSegnale': 'Still looking for a GPS signal: the dot will appear on its own as soon as it arrives.',

            // --- Tooltip del segnaposto GPS 🥾 (createUserGpsMarker/begin/endLiveGpsView) ---
            'map.marker.tuTracc': '<b>You (GPS Tracking)</b><br>Drag the marker to move along the trails',
            'map.marker.tuLive': '<b>You</b><br>Real GPS position, recording in progress',

            // --- Geofencing timbri: popup sul segnaposto (checkGeofencing/unlockStampDirectly).
            //     Il nome della vetta e la quota NON si traducono (nome proprio). ---
            'map.geo.giaCollezionato': "You've already collected this passport stamp!",
            'map.geo.vettaRaggiunta': 'Peak Reached!',
            'map.geo.aSoliMetri': function (m) { return "You're just " + m + 'm from the summit.'; },
            'map.geo.timbraBtn': 'STAMP PASSPORT',
            'map.geo.timbroSbloccato': 'Stamp Unlocked! 🏆',
            'map.geo.timbratoConSuccesso': function (nome) { return 'The peak passport for <b>' + nome + '</b> was stamped successfully!'; },
            'map.geo.serveRegistrazione': 'The stamp unlocks by walking here with a recording running (or by importing the .gpx track of the climb).',
            'map.geo.timbroNegato': "The stamp couldn't be registered right now.",

            // --- Punti timbrabili disegnati sulla mappa (drawStampablePoints) ---
            'map.punto.altitudine': function (m) { return 'Altitude: <b>' + m + 'm</b>'; },
            'map.punto.timbroCollezionato': 'Stamp Collected ✓',
            'map.punto.timbroNonSbloccato': 'Stamp not Unlocked',
            'map.punto.teletrasporta': 'Teleport GPS here',

            // --- Card "Segnala Stato Sentiero" nella sidebar (HTML statico + map.js) ---
            'map.waze.cardTitolo': 'Report Trail Status',
            'map.waze.cardDesc': 'Help the community by reporting issues in real time. Click the map to place a report.',
            'map.waze.tipoLabel': 'Hazard Type:',
            'map.waze.descLabel': 'Description of the issue:',
            'map.waze.descPlaceholder': 'Describe the hazard...',
            'map.waze.invia': 'Send Report',
            'map.waze.nessuna': 'No active trail reports.',
            'map.waze.coord': 'Coord:',
            // Punto 111: "risolvi" e' una RICHIESTA che passa da chi modera, non piu' una
            // cancellazione - testi riscritti di conseguenza (niente "permanently deleted").
            'map.waze.risolviTitle': 'Report as resolved',
            'map.waze.risolviConfermaMsg': 'Do you confirm the reported hazard is gone? Your request goes to the moderators, who decide whether to remove the report. It stays visible on the map in the meantime.',
            'map.waze.risolviConfermaBtn': 'Report as resolved',
            'map.waze.richiestaInviata': 'Request sent: the moderators will check and decide whether to remove the report.',
            'map.waze.giaRichiesta': 'This report has already been marked as resolved: awaiting verification.',
            'map.waze.inAttesaTitle': 'Already reported as resolved, awaiting verification',
            'map.waze.giaRimossa': 'This report has already been removed.',
            'map.waze.erroreRisolvi': 'Could not send the resolution request.',

            // --- Opzioni <select> tipo pericolo: condivise da #waze-type e
            //     #report-fab-type (stesso testo con l'emoji davanti). ---
            'map.wazeOpt.frana': '⚠️ Landslide / Collapse',
            'map.wazeOpt.ghiaccio': '❄️ Ice / Snowfield',
            'map.wazeOpt.fontana_secca': "💧 Dry Spring",
            'map.wazeOpt.ostacolo': '🌲 Tree / Obstacle',

            // --- window.CamoscioReportTypes.titleFor(tipo): titolo del tipo di
            //     segnalazione, usato dal popup del marker (map.js) e dalla card
            //     di moderazione (pendingreports.js). La chiave e' il codice tipo. ---
            'map.reportType.frana': 'Landslide / Collapse',
            'map.reportType.ghiaccio': 'Ice on Trail',
            'map.reportType.fontana_secca': 'Dry Spring',
            'map.reportType.ostacolo': 'Blocked Trail',
            'map.reportType.fallback': 'Alert',

            // --- Popup segnalazione sulla mappa (renderMapMarkers). La
            //     descrizione la scrive l'utente: non si traduce. ---
            'map.reportPopup.segnalatoIl': function (data) { return 'Reported on: ' + data; },

            // --- Invio segnalazione (submitReport, condiviso form mappa + FAB) ---
            'map.report.inviata': 'Report sent: it will appear on the map after a review.',
            'map.report.erroreInvio': 'Could not send the report.',

            // --- Flusso "Indica sulla mappa" del FAB (avviaScegliPuntoSullaMappa ecc.) ---
            'map.scegliPunto.avviso': 'Tap the spot where the hazard is',
            'map.scegliPunto.sceltaSullaMappa': 'Position chosen on the map',
            'map.scegliPunto.cambia': 'Change',
            'map.scegliPunto.puntoScelto': 'Spot chosen: fill in and send the report.',

            // --- FAB "Segnala un pericolo" (#report-fab / #report-panel: HTML statico + map.js) ---
            'map.fab.title': 'Report a hazard on the trail',
            'map.fab.panelTitolo': 'Report a hazard',
            'map.fab.compariraDopoVerifica': 'It will appear on the map after a review.',
            'map.fab.doveSiTrova': 'Where is the hazard?',
            'map.fab.sonoQui': "I'm here now",
            'map.fab.indicaSullaMappa': 'Point it on the map',
            'map.fab.fotoLabel': 'Photo (optional):',
            'map.fab.fotoAnteprima': 'Photo preview',
            'map.fab.invia': 'Send report',
            'map.fab.cercoGps': 'Looking for GPS position…',
            'map.fab.gpsAttuale': 'Current GPS position',
            'map.fab.gpsNonTrovato': 'Could not find the GPS position: try again, or choose "Point it on the map".',
            'map.fab.fotoNonElaborata': 'The chosen photo could not be processed.',
            'map.fab.scegliPosizione': "First choose whether you're on site or want to point it on the map.",
            'map.fab.consensoGps': "To report a hazard at your current position the phone's GPS is needed. You left geolocation consent off during sign-up: turn it on now?",

            // --- loadActiveHikeOnMap: popup del punto di ritrovo (il nome del
            //     ritrovo lo scrive chi crea l'escursione, non si traduce). ---
            'map.ritrovo.titolo': 'Meeting point',

            // ==================================================================
            // Rollout punto 102, LOTTO MAPPA - area 2 di 4 (28/08/2026):
            // "Progetta un percorso" = tutto `public/js/routeplanner.js` (690
            // righe, dentro una IIFE quindi `const T`) TRANNE la funzione
            // `esposizioneSolare()` e i suoi helper `calculateBearing`/
            // `bearingToCompassSector` (in `map.js`): quel blocco va con l'area 3
            // (Esposizione Solare) insieme a `renderSolarExposureAdvice` — quindi
            // l'area 3 tocca anche `routeplanner.js`. Nel pannello del percorso il
            // riquadro `.rp-sole` resta in italiano fino ad allora (atteso).
            //
            // Incluso qui `renderProgetti` (card "I miei progetti" in "Le mie
            // escursioni"): sta in `routeplanner.js`, era l'ultima isola italiana
            // di quella pagina (il resto tradotto al secondo lotto). L'intestazione
            // e la descrizione della card ("My Projects"/`myHikes.progetti*`)
            // erano gia' fatte al secondo lotto, qui il contenuto dinamico.
            //
            // Scelte non ovvie:
            // 1) `metri()` (helper interno) ora sceglie il separatore decimale per
            //    lingua (virgola IT / punto EN) come `formattaDecimale` del secondo
            //    lotto - ma resta un helper locale all'IIFE, nessuna collisione.
            //    "km"/"m" non si traducono (unita').
            // 2) `#route-planner-body` e `#projects-list` sono interamente innerHTML
            //    da JS: `onChange` che ridisegna il pannello (dallo stato in
            //    memoria, NESSUN ricalcolo del percorso: `ultimoEsito` e' gia' in
            //    mano) se `#map-section` e' attiva, e `renderProgetti` (ri-fetch)
            //    se `#my-hikes` e' attiva. Gate come il <select> recensioni del
            //    quinto lotto.
            // 3) `showConfirmModal` di `cancellaBozza` allineato ai "cancella per
            //    sempre" (`cancelLabel` + `danger:true`). "Non e' stato possibile
            //    contattare il server" (x3 nel file) riusa `common.erroreServer`.
            // 4) La data suggerita per il nome di una bozza nuova
            //    (`new Date().toLocaleDateString`) col locale `en-GB`/`it-IT`.
            //    Il nome poi lo puo' cambiare l'utente ed e' contenuto suo.

            // --- <h4> statico in index.html (route-planner-card) ---
            'rp.cardTitolo': 'Plan a route',

            // --- Stato iniziale del pannello (aggiornaPannello, non attivo) ---
            'rp.introTesto': "Pick two or more points on the map and the site links them along known trails. The route is saved as your own draft, not tied to any hike.",
            'rp.cominciaBtn': 'Start planning',
            'rp.titoloBozze': 'Your saved routes',

            // --- Pannello in modalita' progettazione (aggiornaPannello, attivo) ---
            'rp.toccaMappa': 'Tap the map to add a stop.',
            'rp.seguiSentieri': 'Follow known trails',
            'rp.spiegaSwitch': 'Turn it off and the points always link in a straight line — useful where nothing is mapped.',
            'rp.nessunPunto': 'No points chosen.',
            'rp.spiegaAnello': 'The route goes back to point 1, where you left the car. The return follows trails like the other legs, and the figures below include it too.',
            'rp.togliPuntoTitle': 'Remove this point',
            'rp.togliPuntoAria': function (n) { return 'Remove point ' + n; },
            'rp.ritornoAllaPartenza': 'Return to start',
            'rp.togliRitornoTitle': 'Remove the return',
            'rp.togliRitornoAria': 'Remove the return to start',
            'rp.stoCercando': 'Looking for the route…',
            'rp.tornaInizioBtn': 'Back to start',
            'rp.togliRitornoBtn': 'Remove the return',
            'rp.tornaInizioBtnTitle': 'Add the return to point 1, where you left the car',
            'rp.togliRitornoBtnTitle': 'The route goes back to point 1: press to remove it',
            'rp.togliUltimo': 'Remove the last',
            'rp.svuota': 'Clear',
            'rp.chiudi': 'Close',

            // --- Tooltip dei marker / delle linee sulla mappa ---
            'rp.partenzaArrivo': 'Start and finish',
            'rp.partenza': 'Start',
            'rp.arrivo': 'Finish',
            'rp.tappaN': function (n) { return 'Stop ' + n; },
            'rp.suiSentieri': function (dist) { return 'On trails · ' + dist; },
            'rp.inLineaAria': function (dist, motivo) { return 'As the crow flies · ' + dist + ' — ' + motivo; },
            'rp.nessunSentieroCollega': 'no known trail connects the two points',

            // --- Esito del calcolo: totali e avvisi ---
            'rp.tuttoBene': 'The whole route follows known trails.',
            'rp.avvisoRetta': function (dist, n, tratto) { return '<b>' + dist + ' as the crow flies</b> over ' + n + ' ' + tratto + ": there's no known trail linking the points there, so the dashed red line is NOT a route to follow. Judge it on the spot."; },
            'rp.tratto': 'stretch',
            'rp.tratti': 'stretches',
            'rp.totali': 'total',
            'rp.suiSentieriLabel': 'on trails',
            'rp.inLineaAriaLabel': 'as the crow flies',
            'rp.salvaBozzaBtn': 'Save as draft',

            // --- tipoPercorso (anello vs sola andata) ---
            'rp.anello': 'Loop',
            'rp.anelloSpiega': 'the figures below include the return to point 1.',
            'rp.solaAndata': 'One way',
            'rp.solaAndataSpiega': 'the figures below do NOT include the return to point 1. If you go back the way you came, use "Back to start".',

            // --- dislivello (stima quote) ---
            'rp.dislivelloTroppoLungo': function (extra) { return "This route is over <b>25 km</b>: over a distance like this, elevation can't be estimated accurately enough, so the elevation gain is withheld rather than given wrong. Distance and track above are still correct." + (extra || ''); },
            'rp.dislivelloTogliRitorno': ' If you need the number, remove the return: the one-way route is within the limit.',
            'rp.dislivelloNonDisp': "Elevation gain isn't available right now: the elevation source didn't respond. The route above is still correct. Try again shortly.",
            'rp.dislivelloInRetta': function (m) { return ' Of this, about <b>' + m + ' m</b> falls on the straight-line stretches, where the route is drawn straight and follows no trail.'; },
            'rp.salita': 'ascent',
            'rp.discesa': 'descent',
            'rp.quota': 'altitude',
            'rp.notaDislivello': function (inRetta) { return 'Ascent and descent are <b>estimated from a terrain model</b>, not measured on site: they can be off by about 5% (some fifty meters per thousand of ascent).' + (inRetta || ''); },
            'rp.fonteQuote': 'Elevation: Copernicus DEM via Open-Meteo (CC-BY 4.0).',

            // --- calcolo / avvio / limite tappe ---
            'rp.erroreCalcolo': 'The route could not be calculated.',
            'rp.toccaPerTappe': 'Tap the map to add the route stops.',
            'rp.maxTappeAnello': function (max) { return 'A route can have at most ' + max + ' stops plus the return to start.'; },
            'rp.maxTappe': function (max) { return 'A route can have at most ' + max + ' stops.'; },

            // --- salvataggio bozza ---
            'rp.cheNome': 'What name do you want to give this route?',
            'rp.nomeDefault': function (data) { return 'Route from ' + data; },
            'rp.erroreSalvaBozza': 'The draft could not be saved.',
            'rp.bozzaSalvata': 'Draft saved. You’ll find it below when you close the planner.',

            // --- riga dati di una bozza (elencaBozze) ---
            'rp.tappe': 'stops',
            'rp.datiAnello': ' · loop',
            'rp.datiInRetta': function (dist) { return ' · ' + dist + ' as the crow flies'; },

            // --- cancellazione bozza / progetto (stessa entita', due nomi nella UI IT) ---
            'rp.cancellaBozzaMsg': "Delete this saved route?\n\nThe chosen points will be lost. Your hikes and recorded outings are unrelated and won't be touched.",
            'rp.bozzaCancellata': 'Route deleted.',
            'rp.erroreCancella': 'Could not delete.',
            'rp.cancellaTitle': 'Delete this route',
            'rp.cancellaAria': function (nome) { return 'Delete ' + nome; },

            // --- renderProgetti: card "I miei progetti" (#projects-list in "Le mie escursioni") ---
            'rp.prog.erroreCarica': 'Your projects could not be loaded. Please try again later.',
            'rp.prog.vuoto': 'No projects yet. Go to <b>Map &amp; Trails</b>, open "Plan a route" and tap the points you want to link.',
            'rp.prog.tagProgetto': 'project',
            'rp.prog.tagProgettoTitle': 'Route you planned, not done yet',
            'rp.prog.tagAnello': 'loop',
            'rp.prog.tagAnelloTitle': 'The route goes back to the start: the length includes the return',
            'rp.prog.tagSolaAndata': 'one way',
            'rp.prog.tagSolaAndataTitle': "The route doesn't go back to the start: the length does NOT include the return",
            'rp.prog.cancellaTitle': 'Delete this project',
            'rp.prog.lunghezza': 'length',
            'rp.prog.salitaTitle': 'Estimated from a terrain model, can be off by about 5%',
            'rp.prog.inRettaTitle': 'Stretches where no known trail connects the points',
            'rp.prog.tuttoSuSentieri': 'all on trails',
            'rp.prog.apriSullaMappa': 'Open on the map',

            // ==================================================================
            // Rollout punto 102, LOTTO MAPPA - area 3 di 4 (28/08/2026):
            // "Meteo + Esposizione Solare". Un cluster unico su TRE file (come
            // previsto facendo le aree 1-2): `weather.js` per intero, piu' in
            // `map.js` `renderSolarExposureAdvice` + `bearingToCompassSector`
            // (le 8 etichette dei settori cardinali), piu' in `routeplanner.js`
            // la funzione `esposizioneSolare()` - il riquadro `.rp-sole` del
            // pannello del percorso, lasciato in italiano fino a qui. Con
            // quest'area la barra laterale della Mappa e' tradotta tranne il
            // tracciamento GPS (area 4). `calculateBearing` e' pura matematica,
            // niente da tradurre.
            //
            // Scelte non ovvie:
            // 1) I decimali di temperatura/vento nella tabella meteo usano
            //    virgola (IT) / punto (EN) come `formattaDecimale` del secondo
            //    lotto - prima erano `.toFixed(1)` fisso col punto anche in
            //    italiano (per coerenza col resto del sito ora seguono la
            //    lingua). Helper `decimaleMeteo` locale a weather.js (non e' in
            //    una IIFE: nome proprio per non collidere, come `formattaEuro`).
            // 2) `#weather-details-container` e' innerHTML costruito da
            //    `renderWeatherData` sull'ultima risposta di open-meteo:
            //    `applyStaticTranslations` non lo tocca. L'`onChange` di
            //    weather.js RIGIOCA l'ultimo dato gia' in mano (`ultimoData`),
            //    NESSUN fetch nuovo - open-meteo ha un tetto (punto 33). Stessa
            //    logica di `#backpack` al sesto lotto. Solo se `#map-section`
            //    e' attiva (gate come le aree 1-2 del lotto Mappa).
            // 3) `bearingToCompassSector` (map.js) ora restituisce `.label` gia'
            //    nella lingua attiva (chiave `solar.compass.<KEY>`), `.key`
            //    resta il codice N/NE/... usato per i confronti - stessa regola
            //    di Difficolta'/Tag Tribu' al secondo lotto e di `titleFor`
            //    all'area 1. La usano sia `renderSolarExposureAdvice` (map.js)
            //    sia `esposizioneSolare` (routeplanner.js): tradotta in un
            //    posto solo, la vedono giusta entrambe.
            // 4) `esposizioneSolare` di routeplanner.js si ridisegna gia' col
            //    suo `onChange` (chiama `aggiornaPannello` dallo stato in
            //    memoria) - basta tradurne il corpo, l'handler non cambia.
            // 5) Il titolo notifica "Camoscio Safety Alert" (weather.js,
            //    triggerLightningPushNotification) resta invariato: e' un nome
            //    di notifica col marchio davanti, come "Admin"/"Carpooling". Il
            //    corpo (il messaggio di rischio) e' tradotto.
            // 6) I `console.warn` di weather.js restano in italiano: il
            //    dizionario e' solo per l'interfaccia, mai per la console.

            // --- Card Meteo Multi-Quota (#weather-widget-card): HTML statico ---
            'weather.cardTitolo': 'Multi-Altitude Weather & Microclimate',
            'weather.cardDesc': 'Analysis of temperature and wind at the different altitudes along the route.',
            'weather.cercaPlaceholder': 'Search a place, e.g. Campo Imperatore',
            'weather.mappaBtn': 'Map',
            'weather.mappaBtnTitle': 'Choose the point directly on the map',
            'weather.meteoQui': 'Weather where I am',
            'weather.selezionaPunto': 'Select a place or a trail...',

            // --- weather.js: testo generato da JS ---
            'weather.interrogazione': 'Querying Weather API...',
            'weather.cercoPosizione': 'Finding your position...',
            'weather.nonLettaPosizione': "I couldn't read your position yet. Try again in a few seconds, out in the open.",
            'weather.laMiaPosizione': 'My position',
            'weather.simulatoOffline': 'Offline Simulation',
            'weather.mapPickerTitolo': 'Choose the weather point',
            'weather.mapPickerSuggerimento': "Tap the map where you're interested: temperature and wind are calculated for that area, at the different altitudes.",
            'weather.precipitazioni': 'Precipitation:',
            'weather.instabilitaCape': 'CAPE instability:',
            'weather.quota.puntoScelto': 'Chosen point',
            'weather.quota.salita': 'Ascent',
            'weather.quota.crestaVetta': 'Ridge / Summit',
            'weather.rischioElevato': 'HIGH DANGER: Very strong convective instability. Risk of violent storms and imminent lightning in the afternoon!',
            'weather.rischioFulmini': 'LIGHTNING RISK: High humidity with instability. Chance of storm cells at altitude.',
            'weather.nessunRischio': 'No lightning risk detected for the next few hours.',

            // --- Card Esposizione Solare (#sun-exposure-card): HTML statico ---
            'solar.cardTitolo': 'Sun Exposure',
            'solar.cardDesc': 'The algorithm analyzes the slope and aspect of alpine hillsides, advising the best times and aspects.',
            'solar.selezionaSentiero': 'Select a trail to get sun/shade advice.',

            // --- map.js renderSolarExposureAdvice: consigli generati da JS
            //     (contengono <strong>/<br>, contenuto nostro - vengono messi
            //     via innerHTML come gli altri *.js html del dizionario). Il
            //     versante lo passa chi chiama (gia' tradotto, vedi solar.compass). ---
            'solar.nessunaVetta': "No summit recorded for this route: the hillside aspect can't be estimated. Still, consider early starts in the summer months to avoid the hottest hours.",
            'solar.ghiacciaio': function (s) { return '<strong>❄️ High Altitude: High Glacier Glare (' + s + '-facing slope)</strong><br>\n            Above 3500m sun exposure is at its peak. Category 4 sunglasses and protective sunscreen are mandatory. Watch for the glacier warming from 12:00, which makes the snow bridges unstable.'; },
            'solar.estateEsposto': function (s) { return '<strong>☀️ Summer Tip: ' + s + '-facing slope, high exposure</strong><br>\n            The route to the summit faces ' + s + ' and heats up quickly during the central hours. A start by 07:00 is recommended to avoid heat stroke, and mind the afternoon lightning risk.'; },
            'solar.estateOmbra': function (s) { return '<strong>🌲 Summer Tip: ' + s + '-facing slope, more shaded</strong><br>\n            The route to the summit faces ' + s + ': it stays cooler even in the central hours, but can hold residual snow or ice longer in the hollows. Bring sun protection anyway for the open stretches.'; },
            'solar.invernoLuce': function (s) { return '<strong>❄️ Seasonal Tip: ' + s + '-facing slope, maximize the light</strong><br>\n            Doing the climb in the central hours (10:00 - 14:00) is recommended, using the ' + s + '-facing slope to benefit from the sunshine.'; },
            'solar.invernoGhiaccio': function (s) { return '<strong>❄️ Seasonal Tip: ' + s + '-facing slope, ice risk</strong><br>\n            The route to the summit faces ' + s + ', with little sun this season: consider micro-spikes/poles and a not-too-late return because of the risk of sudden ice.'; },

            // --- 8 settori cardinali (bearingToCompassSector, map.js): chiave =
            //     codice, valore = etichetta nella lingua attiva. Condivisa fra
            //     renderSolarExposureAdvice (map.js) e esposizioneSolare (routeplanner.js). ---
            'solar.compass.N': 'North',
            'solar.compass.NE': 'Northeast',
            'solar.compass.E': 'East',
            'solar.compass.SE': 'Southeast',
            'solar.compass.S': 'South',
            'solar.compass.SW': 'Southwest',
            'solar.compass.W': 'West',
            'solar.compass.NW': 'Northwest',

            // --- routeplanner.js esposizioneSolare(): riquadro .rp-sole nel
            //     pannello "Progetta un percorso" ---
            'rp.sole.titolo': 'Sun exposure',
            'rp.sole.direzionePrevalente': function (etichetta) { return ' · mostly facing ' + etichetta; },
            'rp.sole.aSud': 'south',
            'rp.sole.aNord': 'north',
            'rp.sole.nota': "Calculated from the track's orientation. It doesn't account for shade from nearby walls, which can't be known without the elevations.",
            'rp.sole.consiglioSudEstate': "More than half the route faces south and heats up early: this season it's best to start by 7:00, and remember that heat storms roll in from early afternoon.",
            'rp.sole.consiglioSud': 'More than half the route faces south: it gets sun for a long time, which helps in winter — the snow melts sooner and the ground is less frozen in the morning.',
            'rp.sole.consiglioNordEstate': 'More than half the route faces north: it stays cooler even in summer, good for the central hours.',
            'rp.sole.consiglioNordInverno': 'More than half the route faces north: in the cold months ice lingers there for a long time even in the sun. Consider micro-spikes.',
            'rp.sole.consiglioMisto': 'The route changes aspect often, alternating sunny and shaded stretches: no exposure dominates.',

            // ==================================================================
            // Rollout punto 102, LOTTO MAPPA - area 4 di 4 (28/08/2026):
            // "Tracciamento GPS + mappa offline" - l'ULTIMA area. Con questa la
            // barra laterale della Mappa e' tutta tradotta.
            //   - tracking.js (1364 righe, NON in una IIFE -> var T): pannello
            //     #tracking-panel, mini-bar #tracking-mini-bar, tasto
            //     "Comincia/Termina registrazione" sulla mappa, riquadro
            //     "Opzioni escursione" (#map-record-setup), download mappa
            //     offline, badge GPS/sync, riepilogo di fine escursione,
            //     promemoria nativo Android, tutti i toast.
            //   - geolocation.js (464 righe, NON in una IIFE -> var T): messaggi
            //     d'errore posizione, e soprattutto la guida allo sblocco del
            //     permesso GPS (tre livelli iOS/Android) - testo d'aiuto lungo.
            //   - offline-map.js: NESSUNA stringa d'interfaccia (solo Error()
            //     interni mai mostrati) -> non toccato.
            //
            // Scelte non ovvie (dettaglio in 03-Decisioni-Architetturali.md,
            // sottosezione "Lotto Mappa, area 4"):
            // 1) decimali distanza/velocita' (toFixed(2)/toFixed(1)) ora seguono
            //    la lingua (virgola IT / punto EN) - helper numTracc locale a
            //    tracking.js, come decimaleMeteo dell'area 3. Prima erano fissi
            //    col punto anche in italiano.
            // 2) onChange in tracking.js: ridisegna dallo stato in memoria (mai
            //    un fetch) - tasto mappa sempre, pannello/badge se si sta
            //    registrando, riepilogo se il suo pannello e' aperto. Gate
            //    #map-section per il <select> escursione. I badge GPS/sync
            //    hanno il loro stato salvato in una module-var (ultimoStatoSync)
            //    perche' setSyncBadge/renderGpsQuality partono da un argomento.
            // 3) il promemoria nativo Android (LocalNotifications, ogni ora) e'
            //    tradotto con T() al momento della programmazione: se l'utente
            //    cambia lingua a escursione in corso il testo resta quello di
            //    partenza fino alla ricorrenza dopo - edge raro, notifica di
            //    sistema, non DOM (come "Camoscio Safety Alert" dell'area 3).
            //    title:'Camoscio' invariato (marchio).
            // 4) i console.error/warn di entrambi i file restano in italiano
            //    (dizionario = interfaccia). I body.error dal server nei toast
            //    restano il testo del server, tradotto solo il ripiego.
            // 5) geolocation.js NON ha onChange: le sue stringhe vivono solo in
            //    modali/toast creati al momento da un'azione utente, T() le
            //    risolve fresche ogni volta - nessun DOM persistente.

            // --- #map-record-setup (HTML statico) ---
            'track.opzioniEscursione': 'Hike options',
            'track.escursioneCollegata': 'Linked hike (optional):',
            'track.nessunaTracciaLibera': 'None - free track',
            'track.consensoAlert': 'Tracking will use the phone’s real GPS position. You left geolocation consent off during sign-up: it will be turned on now if you continue.',
            'track.scaricaMappaOffline': 'Download offline map for this area',

            // --- #map-record-controls (HTML statico + updateMapRecordButton) ---
            'track.ricentra': 'Recenter on me',
            'track.ricentraTitle': 'Go back to following my GPS position',
            'track.cominciaRegistrazione': 'Start recording',
            'track.terminaRegistrazione': 'Stop recording',

            // --- #tracking-mini-bar (HTML statico) ---
            'track.toccaDettagli': 'Tap for details',

            // --- #tracking-panel (HTML statico) ---
            'track.panelTitolo': 'Live hike',
            'track.idleDesc': 'Record the real GPS route of your hike: it keeps updating even with weak signal and syncs on its own as soon as signal is back.',
            'track.avviaBtn': 'Start GPS tracking',
            'track.statTempo': 'Time',
            'track.statDistanza': 'Distance',
            'track.statDislivello': 'Elevation gain D+',
            'track.statVelocita': 'Average speed',
            'track.pausaBtn': 'Pause',
            'track.riprendiBtn': 'Resume',
            'track.terminaBtn': 'Stop',
            'track.riepilogoTitolo': 'Hike finished 🎉',
            'track.statDurata': 'Duration',
            'track.segnaCompletata': 'Mark the linked hike as completed',
            'track.chiudiBtn': 'Close',

            // --- tracking.js: badge qualita' GPS (renderGpsQuality) ---
            'track.gps.interrotto': 'GPS: recording interrupted — tap to retry',
            'track.gps.permessoNegato': 'GPS: permission denied',
            'track.gps.attesa': 'GPS: waiting for signal...',
            'track.gps.ottima': function (acc) { return 'GPS: excellent accuracy (±' + acc + 'm)'; },
            'track.gps.buona': function (acc) { return 'GPS: good accuracy (±' + acc + 'm)'; },
            'track.gps.scarsa': function (acc) { return 'GPS: poor accuracy (±' + acc + 'm)'; },

            // --- tracking.js: badge sincronizzazione (setSyncBadge) ---
            'track.sync.sincronizzato': 'Synced',
            'track.sync.sincronizzazione': 'Syncing...',
            'track.sync.offline': 'Offline: data queued',

            // --- tracking.js: toast e modali ---
            'track.noGeoBrowser': 'Your browser does not support geolocation: the real route cannot be recorded.',
            'track.consensoTracciamento': 'To record the GPS route of the hike, the phone’s real position is needed. You left geolocation consent off during sign-up: turn it on now and continue?',
            'track.avviato': 'GPS tracking started: enjoy the hike! 🥾',
            'track.erroreAvvio': 'Could not start GPS tracking. Try again.',
            'track.promemoriaBody': 'GPS tracking is still on. If you’re done, open the app and tap Stop.',
            'track.confermaTermina': 'Do you want to stop tracking this hike? The final summary will use the data collected so far.',
            'track.completataReale': 'Hike marked as completed with the real tracking data!',
            'track.erroreCompletamento': 'Could not mark the hike as completed.',
            'track.erroreGpsBackground': 'Could not start GPS in the background. Try again.',
            'track.gpsBackgroundNonDisp': 'Background GPS is not available on this device.',
            'track.modalePermessoAndroid': 'To keep recording the route even with the screen off, Camoscio is about to ask Android for location permission. Any option Android offers is fine, even "only while using the app": tracking stays active with the screen off thanks to the service with a permanent notification. If it then also asks for notification permission, you can allow it or not: tracking starts either way.',
            'track.hoCapitoContinua': 'Got it, continue',
            'track.gpsSpento': 'The phone’s GPS is off. Turn it on from Android’s quick settings and try again.',
            'track.permessoPosizioneNegatoRiprova': 'Camoscio cannot track without location permission. Try again: it will ask you once more.',
            'track.appInBackground': 'Android blocked resuming GPS because the app was in the background. Open Camoscio and try again.',
            'track.notificheDisattivate': 'Notifications appear to be off for Camoscio: tracking still works, but you won’t see the permanent Android notification that signals it. To turn them on: Settings → Apps → Camoscio → Notifications.',
            'track.permessoNegato': 'Geolocation permission denied: tracking cannot record the real position.',
            'track.sessioneChiusaAltrove': 'Tracking appears to be closed on the server (maybe from another device): recording on this phone has stopped here.',
            'track.mappaOfflineNonDisp': 'Offline map feature not available right now.',
            'track.apriPrimaMappa': 'Open the Map section first, so I can tell which area to download.',
            'track.confermaDownload': function (tileCount, mb) { return 'About ' + tileCount + ' map tiles (~' + mb + ' MB) will be downloaded. Continue? (recommended on Wi-Fi or a good connection)'; },
            'track.progressoTile': function (done, total) { return done + '/' + total + ' tiles'; },
            'track.tileNonRiuscite': function (n) { return ' (' + n + ' failed)'; },
            'track.mappaProntaToast': function (salvate, total) { return 'Offline map ready: ' + salvate + '/' + total + ' tiles saved on the device.'; },
            'track.erroreDownloadMappa': 'Error while downloading the offline map.',
            'track.ripresoConBuco': function (minuti) { return 'Tracking resumed. For about ' + minuti + (minuti === 1 ? ' minute' : ' minutes') + ' the route was not recorded: that stretch will be missing from the track.'; },
            'track.ripresoDaDoveEriRimasto': 'GPS tracking resumed from where you left off.',
            'track.ripresoAllaCieca': 'Tracking resumed without confirmation from the server (no network right now): I keep recording, it catches up on its own when the connection is back.',
            'track.ripreso': 'GPS tracking resumed.',

            // --- geolocation.js: messaggi d'errore posizione (descriviErrore) ---
            'geo.err.generico': 'Could not get your position.',
            'geo.err.negato': 'Location permission denied.',
            'geo.err.nonDisponibile': 'The phone gives no position at all. Either the device’s location is off, or you’re indoors and the GPS can’t see the satellites.',
            'geo.err.timeout': 'The GPS is taking too long. The first fix of the day can take a few minutes outdoors: try again shortly.',
            'geo.noGeoBrowser': 'Your browser does not support geolocation.',
            'geo.motivoPredefinito': 'To show your real position on the map, the phone’s GPS is needed. You left geolocation consent off during sign-up: turn it on now?',

            // --- geolocation.js: guida allo sblocco del permesso (mostraGuidaSblocco) ---
            'geo.insecureContext': 'Location is blocked because this page isn’t on a secure connection (https).\n\nIt’s not a block you set: browsers deny GPS to any page opened over http, and still answer "permission denied".\n\nOpen the site at https://camoscio.onrender.com and location will work.',
            'geo.guidaDesktop': 'Computer (Chrome, Edge, Firefox…) — one level only: the site permission\n1. Click the icon left of the address (the padlock, or the "site settings" slider)\n2. Under "Location" choose "Allow" (or "Ask (default)")\n3. Reload the page\nOn Firefox: if it says "Blocked", click the × next to it to clear it, then reload.\nIf you can’t find the setting, also check that Windows/macOS location is on\n(Windows: Settings → Privacy → Location).',
            'geo.guidaSafari': 'iPhone / iPad (Safari) — three levels, you need all three\n1. iOS Settings → Privacy & Security → Location Services: on\n2. On the same screen, further down: Safari → "While Using the App"\n   (this is the most common case, and the site can’t tell it apart from point 3)\n3. On the site: "aA" in the address bar → Website Settings → Location → Allow',
            'geo.guidaChrome': 'Android (Chrome) — three levels, you need all three\n1. PHONE location: pull down the quick settings and check that\n   "Location" is on (or Android Settings → Location).\n   It’s the one missing most often, and the only one you won’t find by searching "Chrome".\n2. Chrome APP permission: Android Settings → Apps → Chrome → Permissions\n   → Location → allowed, with "precise location" on\n3. SITE permission: tap the padlock next to the address → Permissions\n   → Location → Allow\nIf you see a warning triangle next to the permission, the site is fine and one of\nthe two levels above is closed: tap the triangle and Chrome tells you which.',
            'geo.guidaIntro': 'Location isn’t coming through, and I can’t unblock it from here: it has to be re-enabled by hand.',
            'geo.guidaOutro': 'Then reload the page.\n\nIf it still doesn’t work after these steps, open the diagnostics page: it tries your location three different ways and tells you which level is closed.\n\nOpen it now?',

            // ==================================================================
            // Rollout punto 102 - ULTIMO pezzo (28/08/2026): il GATE di
            // login/registrazione (schermata #auth-gate + public/js/auth.js) e
            // le 3 PAGINE HTML AUTONOME che non passano da index.html
            // (demo.html, conferma-email.html, reimposta-password.html). Con
            // questo il punto 102 e' completo (resta fuori solo
            // diagnostica-gps.html, strumento di debug, da decidere a parte).
            //
            // Scelte:
            // 1) Il gate vive PRIMA di #main-app-container, dove stanno le
            //    bandiere - quindi si aggiunge una .lang-switcher in ognuna
            //    delle 3 viste del gate (dentro .auth-brand) e una in ogni
            //    pagina autonoma. i18n.js aggancia gia' TUTTE le .lang-flag-btn
            //    del documento e aggiornaBandiere() marca .active su tutte:
            //    piu' copie non danno problemi.
            // 2) Le 3 pagine autonome NON caricavano i18n.js: aggiunto lo
            //    <script src="js/i18n.js"> subito prima del loro <script> inline
            //    (a fine <body>, cosi' applyStaticTranslations vede gia' il DOM).
            //    Il loro JS inline legge window.CamoscioI18n.t.
            // 3) Vocabolario fisso del wizard (livello escursionistico,
            //    interessi, difficolta' CAI, privacy) tradotto SOLO a video: il
            //    data-value / value degli <option>/.choice-btn resta la stringa
            //    italiana (va al server come hikingLevel/interests/
            //    preferredDifficulty/privacySetting) - regola di Difficolta'/Tag
            //    Tribu' del secondo lotto. Marche/Lazio/Abruzzo/Molise NON si
            //    traducono (nomi propri, come cime/rifugi).
            // 4) Le righe "contatto di emergenza" (addEmergencyContactRow,
            //    auth.js) sono innerHTML da JS: le loro etichette portano
            //    data-i18n NEL TEMPLATE, cosi' applyStaticTranslations le prende
            //    a un cambio lingua senza perdere quanto gia' scritto - nessun
            //    onChange serve per il gate.
            // 5) data.error dal server (login/register falliti) resta il testo
            //    del server; tradotto solo il ripiego.
            // 6) I <title> delle pagine restano in italiano (applyStaticTranslations
            //    non tocca <title>, e non e' testo in pagina).

            // --- Gate: comune a login / forgot / wizard (index.html #auth-gate) ---
            'auth.emailLabel': 'Email:',
            'auth.passwordLabel': 'Password:',
            'auth.loginBtn': 'Log in',
            'auth.loginLink': 'Log in',
            'auth.loginSubtitle': 'Log in to your account for hikes, carpooling and mountain safety.',
            'auth.forgotLink': 'Forgot your password?',
            'auth.noAccount': "Don't have an account?",
            'auth.registerLink': 'Sign up',
            'auth.demoHint': 'Just want to try the site? Log in with a demo account →',

            // --- Gate: vista "Password dimenticata" ---
            'auth.forgotSubtitle': 'Enter the email you signed up with: we\'ll send you a link to choose a new password.',
            'auth.forgotDoneStrong': 'Done.',
            'auth.forgotDoneNote': 'The link is valid for <strong>one hour</strong> and can be used <strong>once</strong>. Until you choose the new password, your current one keeps working.',
            'auth.forgotSubmit': 'Send me the link',
            'auth.forgotRemembered': 'Remembered it?',
            'auth.backToLogin': 'Back to login',
            'auth.sending': 'Sending…',
            'auth.forgotDoneFallback': "If that address is registered, we've sent you an email.",

            // --- Gate: wizard di registrazione, testo statico (index.html) ---
            'auth.step1Title': '1. Basic details',
            'auth.step1Desc': 'The essential information to create your account.',
            'auth.firstNameLabel': 'First name:',
            'auth.lastNameLabel': 'Last name:',
            'auth.passwordMinLabel': 'Password (at least 8 characters):',
            'auth.passwordConfirmLabel': 'Confirm password:',
            'auth.birthOrRange': 'Date of birth or age range:',
            'auth.birthDateRadio': 'Date of birth',
            'auth.ageRangeRadio': 'Age range',
            'auth.ageOpt.1829': '18-29 years',
            'auth.ageOpt.3039': '30-39 years',
            'auth.ageOpt.4049': '40-49 years',
            'auth.ageOpt.5059': '50-59 years',
            'auth.ageOpt.60': '60+ years',
            'auth.acceptTerms': 'I accept the Terms of Service and the Privacy Policy',
            'auth.step2Title': '2. Hiking profile',
            'auth.step2Desc': 'Helps us suggest the right routes for you (optional but recommended).',
            'auth.expLevelLabel': 'Stated experience level:',
            'auth.level.Principiante': 'Beginner',
            'auth.level.Intermedio': 'Intermediate',
            'auth.level.Esperto': 'Expert',
            'auth.level.Alpinista': 'Mountaineer',
            'auth.interestsLabel': 'Your interests (select as many as you like):',
            'auth.interest.Passeggiate facili': 'Easy walks',
            'auth.interest.Trekking giornalieri': 'Day hikes',
            'auth.interest.Trekking di più giorni': 'Multi-day treks',
            'auth.interest.Ferrate': 'Via ferrata',
            'auth.interest.Alpinismo': 'Mountaineering',
            'auth.interest.Trail running': 'Trail running',
            'auth.interest.MTB': 'MTB',
            'auth.interest.Ciaspolate': 'Snowshoeing',
            'auth.interest.Fotografia': 'Photography',
            'auth.interest.Natura': 'Nature',
            'auth.interest.Rifugi': 'Mountain huts',
            'auth.interest.Laghi': 'Lakes',
            'auth.interest.Panorami': 'Views',
            'auth.interest.Vette': 'Peaks',
            'auth.interest.Borghi': 'Villages',
            'auth.interest.Tramonti': 'Sunsets',
            'auth.interest.Alba': 'Sunrise',
            'auth.step3Title': '3. Difficulty and area',
            'auth.step3Desc': 'Optional: helps filter the routes best suited to you.',
            'auth.prefDiffLabel': 'Preferred difficulty (CAI scale):',
            'auth.noPreference': 'No preference',
            'auth.cai.T': 'T — Tourist',
            'auth.cai.E': 'E — Hiking',
            'auth.cai.EE': 'EE — Experienced Hikers',
            'auth.cai.EEA': 'EEA — Experienced Hikers with Equipment',
            'auth.cai.Alpinistica': 'Mountaineering',
            'auth.prefRegionLabel': 'Preferred region:',
            'auth.provincesLabel': 'Provinces (comma-separated):',
            'auth.provincesPlaceholder': 'E.g. AQ, TE',
            'auth.rangesLabel': 'Mountain ranges (comma-separated):',
            'auth.rangesPlaceholder': 'E.g. Gran Sasso, Maiella, PNALM',
            'auth.step4Title': '4. Public profile',
            'auth.step4Desc': 'How other hikers will see you.',
            'auth.usernameLabel': 'Username (unique, e.g. MarcoHiker):',
            'auth.photoLabel': 'Profile photo (optional):',
            'auth.bioLabel': 'Bio (max 250 characters):',
            'auth.bioPlaceholder': 'Tell us something about yourself...',
            'auth.step5Title': '5. Safety',
            'auth.step5Desc': 'Emergency contacts (mandatory) and geolocation (optional).',
            'auth.ecPrivacyNote': 'The emergency contact is not public and is used ONLY for emergencies.',
            'auth.addContactBtn': 'Add another contact',
            'auth.geoNote': "By accepting geolocation you'll have a better chance of finding people with the same interests.",
            'auth.geoConsent': 'I consent to the use of my location (to find nearby hikes, record routes, show my position)',
            'auth.step6Title': '6. Privacy preferences',
            'auth.step6Desc': 'Who can see your public profile (bio, photo, interests)?',
            'auth.privacy.Pubblico': 'Public',
            'auth.privacy.SoloAmici': 'Friends only',
            'auth.privacy.Privato': 'Private',
            'auth.privacyNote': '"Friends only" means people who share a squad with you. Sensitive data (email, emergency contacts, date of birth) is never visible to any other user, whatever setting you choose.',
            'auth.wizardPrev': 'Back',
            'auth.wizardNext': 'Next',
            'auth.wizardSubmit': 'Complete Registration',
            'auth.haveAccount': 'Already have an account?',

            // --- Gate: auth.js, testo generato / righe contatto emergenza ---
            'auth.ecRemoveTitle': 'Remove contact',
            'auth.ecName': 'Name:',
            'auth.ecRelationship': 'Relationship:',
            'auth.ecRelationshipPlaceholder': 'E.g. Mother, Friend...',
            'auth.ecEmailPlaceholder': 'Used to send them the alert',
            'auth.photoPreviewAlt': 'Preview',

            // --- Gate: auth.js, messaggi d'errore / validazione ---
            'auth.err.invalidEmail': 'Enter a valid email address.',
            'auth.err.serverUnreachable': 'Could not reach the server. Try again.',
            'auth.err.nameRequired': 'Enter your first and last name.',
            'auth.err.pwdMin8': 'The password must be at least 8 characters.',
            'auth.err.pwdMismatch': 'The two passwords don\'t match.',
            'auth.err.birthdateRequired': 'Enter your date of birth, or choose "Age range".',
            'auth.err.termsRequired': 'You must accept the Terms and Privacy Policy to continue.',
            'auth.err.usernameRequired': 'Choose a username.',
            'auth.err.ecRequired': 'At least one emergency contact is needed.',
            'auth.err.ecIncomplete': 'Fill in name, relationship and email for every emergency contact.',
            'auth.err.ecInvalidEmail': 'Enter a valid email for every emergency contact.',
            'auth.err.registerFailed': 'Registration failed.',
            'auth.err.registerRetry': 'Could not complete registration. Try again.',
            'auth.err.loginFailed': 'Login failed.',
            'auth.err.photoNotProcessed': 'The chosen photo could not be processed.',
            'common.hoCapito': 'Got it',

            // --- demo.html ---
            'demoPage.badge': 'Demo / test mode',
            'demoPage.intro': 'These 4 accounts exist only to try the site quickly, without signing up. They are not real accounts: any change made here is visible to anyone using the demo.',
            'demoPage.wantReal': 'Want a real account, all your own?',
            'demoPage.backToLogin': 'Back to the login/sign-up page',
            'demoPage.loginError': "Couldn't log in with the demo account",
            'demoPage.loadError': 'Could not load the demo accounts. Is the server running?',

            // --- conferma-email.html ---
            'emailConfirm.verifying': 'Confirming your address…',
            'emailConfirm.doneTitle': '✅ Address confirmed.',
            'emailConfirm.doneNote': 'Thank you. Now, if you ever forget your password, we can send you the link to reset it to this address.',
            'emailConfirm.goToSite': 'Go to the site',
            'emailConfirm.expiredTitle': 'This link is no longer valid.',
            'emailConfirm.expiredNote1': 'Confirmation links are valid for <strong>24 hours</strong> and can be used <strong>once</strong>. If you requested another one after this, only the last one you received counts.',
            'emailConfirm.expiredNote2': 'It may also be that you have <strong>already confirmed</strong>: in that case everything is fine and you don\'t need to do anything.',
            'emailConfirm.expiredNote3': 'If you still need to do it, log into the site: at the top you\'ll find the button to have the email resent.',
            'emailConfirm.serverError': "I can't reach the server. Check your connection and reload the page.",

            // --- reimposta-password.html ---
            'pwdReset.verifying': 'Checking the link…',
            'pwdReset.chooseTitle': 'Choose your new password.',
            'pwdReset.newPwdLabel': 'New password (at least 8 characters):',
            'pwdReset.confirmPwdLabel': 'Confirm the new password:',
            'pwdReset.saveBtn': 'Save the new password',
            'pwdReset.logoutNote': 'On saving, you\'ll be logged out of every other device where your account was left open.',
            'pwdReset.backToLogin': 'Back to the login page',
            'pwdReset.expiredTitle': 'This link is no longer valid.',
            'pwdReset.expiredNote1': 'Password reset links are valid for <strong>one hour</strong> and can be used <strong>once</strong>. If you requested another one after this, only the last one you received counts.',
            'pwdReset.expiredNote2': 'Nothing has changed in the meantime: your current password keeps working.',
            'pwdReset.expiredBtn': 'Back to the site to request another',
            'pwdReset.doneTitle': '✅ Password updated.',
            'pwdReset.goToSite': 'Go to the site',
            'pwdReset.goToLogin': 'Go to the login page',
            'pwdReset.serverError': "I can't reach the server. Check your connection and reload the page.",
            'pwdReset.changeFailed': 'Could not change the password.',
            'pwdReset.doneLoggedIn': "You're already in: you can go back to the site and carry on.",
            'pwdReset.doneNotLoggedIn': 'You can now log in with the new password.',

            // --- diagnostica-gps.html (strumento di debug GPS) ---
            //  Pagina autonoma, dipendenze zero: carica i18n.js a fine <body>
            //  come demo / conferma-email / reimposta-password. Prefisso 'diag.*'.
            //  1) Testo statico -> data-i18n / data-i18n-html (le 2 note con
            //     <em>). "Esito" / "Tempo impiegato" / "Messaggio del browser"
            //     sono identiche nelle card 2 e 3: chiave unica condivisa
            //     (diag.lbl.*).
            //  2) <title> resta IT, come le pagine del gate
            //     (applyStaticTranslations non tocca <title>).
            //  3) #btn-avvia / #btn-copia: qui la sola etichetta di partenza.
            //     Gli stati transitori ("Diagnosi in corso…", "Copiato ✓", …) e
            //     tutte le stringhe generate da JS arrivano da T() nello script
            //     inline (punto 3 del lavoro). Nessun onChange sulla pagina: un
            //     cambio lingua a diagnosi in corso rimette l'etichetta di
            //     partenza, si risistema da sola a fine run - residuo accettato,
            //     coerente con la pagina ("residuo onesto" come chatpanel.js).
            'diag.h1': 'GPS Diagnosis',
            'diag.sub': "Works out <em>why</em> the blue dot won't appear. Open it on the phone that has the problem, and run it outdoors if you can.",
            'diag.btnAvvia': 'Start the diagnosis',
            'diag.btnCopia': 'Copy the report',
            'diag.verdetto.titolo': 'What we found',
            'diag.card1.titolo': '1. The page',
            'diag.card1.secure': 'Secure connection (https)',
            'diag.card1.indirizzo': 'Address',
            'diag.card1.api': 'Geolocation API',
            'diag.card1.perm': 'Permission, per the browser',
            'diag.card2.titolo': '2. High-accuracy position',
            'diag.card2.nota': 'This is what the app uses for the dot. It asks for real GPS (the satellites).',
            'diag.lbl.esito': 'Outcome',
            'diag.lbl.tempo': 'Time taken',
            'diag.lbl.msgBrowser': 'Browser message',
            'diag.card3.titolo': '3. Approximate position',
            'diag.card3.nota': 'Without satellites, estimated from wi-fi and phone masts. If only this one works, the problem is GPS not locking on — not a permission.',
            'diag.card4.titolo': '4. Continuous tracking (20 s)',
            'diag.card4.nota': 'This is how the app follows your position as you walk. If you can, move a few steps while it runs.',
            'diag.card4.ricevute': 'Positions received',
            'diag.card4.migliorePrec': 'Best accuracy',
            'diag.card4.errori': 'Errors',
            'diag.card5.titolo': '5. Phone and browser',
            'diag.card5.browser': 'Browser',
            'diag.card5.schermo': 'Screen',
            'diag.notaPrivacy': "The exact coordinates do NOT appear on this page, nor in the report you copy: for the diagnosis, all that matters is <em>whether</em> a position arrives and how accurate it is, not where you are. It's the same rule that keeps emergency contacts out of the project's files.",
            'diag.tornaCamoscio': '← Back to Camoscio',

            //  diagnostica-gps.html - stringhe generate da JS nello script inline
            //  (stati, esiti, etichette dei bottoni durante un run). Ripiego IT
            //  a fianco nel codice: T('diag.js.x') || "testo italiano".
            //  I decimali dei secondi passano da numLoc() (virgola IT / punto EN,
            //  come decimaleMeteo/numTracc). componiRapporto() resta IT: e' il
            //  testo tecnico da incollare per assistenza, non interfaccia.
            'diag.js.code1': '1 — PERMISSION_DENIED (permission denied)',
            'diag.js.code2': '2 — POSITION_UNAVAILABLE (position not computable)',
            'diag.js.code3': '3 — TIMEOUT (timed out)',
            'diag.js.apiNonDisp': 'API not available',
            'diag.js.nessunMsg': '(no message)',
            'diag.js.btnInCorso': 'Diagnosis running… (about 1 minute)',
            'diag.js.btnRipeti': 'Run the diagnosis again',
            'diag.js.si': 'yes',
            'diag.js.noHttps': 'NO — GPS is blocked without https',
            'diag.js.presente': 'present',
            'diag.js.assente': 'ABSENT',
            'diag.js.permGranted': 'allowed',
            'diag.js.permDenied': 'DENIED',
            'diag.js.permPrompt': 'will be asked',
            'diag.js.permMuto': "the browser won't say (normal on iPhone)",
            'diag.js.inCorso20': 'running… (up to 20 seconds)',
            'diag.js.inCorso15': 'running… (up to 15 seconds)',
            'diag.js.inCorsoWatch': 'running… (20 seconds)',
            'diag.js.posOttenuta': 'position obtained',
            'diag.js.precisione': 'accuracy',
            'diag.js.metri': 'metres',
            'diag.js.errore': 'error',
            'diag.js.secondi': 'seconds',
            'diag.js.posizioniIn20': 'positions in 20 seconds',
            'diag.js.nessuno': 'none',
            'diag.js.punti': 'points',
            'diag.js.codice': 'code',
            'diag.js.copiato': 'Copied ✓',
            'diag.js.copiaMano': 'Copy the text below by hand',

            //  Il verdetto (mostraVerdetto): 8 rami, ognuno un blocco HTML con
            //  <strong>/<code>/<em>/<ol>. Testo istruttivo - resa fedele al
            //  registro diretto dell'italiano. 'diag.verd.altro' e' una funzione
            //  (ci incolla i due codici errore). guidaSblocco: 'diag.guida.*'.
            //  I passaggi delle impostazioni sono le diciture inglesi reali di
            //  Android/iOS (Location Services, "While Using the App", ecc.).
            'diag.verd.noSecure': '<p><strong>This page is not on a secure connection.</strong> Browsers block GPS for any page opened over <code>http</code>, and still answer «permission denied». It is not a block you set.</p><p>Open <code>https://camoscio.onrender.com/diagnostica-gps.html</code> and try again.</p>',
            'diag.verd.noApi': '<p><strong>This browser has no geolocation.</strong> That is very rare: try an up-to-date Chrome or Safari.</p>',
            'diag.verd.okBase': "<p><strong>The phone has your position.</strong> Permissions are fine: from here on the blue dot should appear.</p>",
            'diag.verd.okSoloBassa': '<p>Note: only the approximate position worked. That means the <strong>GPS cannot see the satellites</strong> — it happens indoors, under thick tree cover or in a narrow valley. It improves on its own outdoors. The app now falls back to this estimate instead of showing you nothing, and draws the accuracy circle around the dot.</p>',
            'diag.verd.okEnd': '<p>If the dot still does not show in the app while the position <em>does</em> arrive here, then the fault is in the app: report it along with this report.</p>',
            'diag.verd.bloccato': '<p><strong>The permission is blocked by the browser</strong> (code 1). Once blocked, a web page can no longer ask for it on its own: it has to be reopened by hand.</p>',
            'diag.verd.nessunaFonte': '<p><strong>No position source is switched on on the phone</strong> (code 2, and the answer came back at once: the phone did not even try).</p>' +
                '<p>The site permission may read «allowed» and change nothing: there are two more levels beneath it, and one closed is enough. That is exactly what the <strong>warning triangle</strong> Chrome puts next to the permission means.</p>' +
                '<ol>' +
                '<li><strong>Device location</strong> — swipe down the quick-settings panel and check the <em>Location</em> icon is on. Or: Android Settings → Location. <strong>It is the number-one suspect</strong> when the other two are already fine.</li>' +
                '<li><strong>Chrome app permission</strong> — Settings → Apps → Chrome → Permissions → Location → «Allow only while using the app», and check that <em>Use precise location</em> is on.</li>' +
                '<li><strong>Battery saver</strong> — if it is on, it turns GPS off on many phones. Turn it off and try again.</li>' +
                '</ol>' +
                '<p>Shortcut: tap the warning triangle directly in the padlock panel. Chrome says there what it is missing and opens the right settings.</p>',
            'diag.verd.timeout': '<p><strong>The permission is there, but no position arrived in time</strong> (code 3 on both tests).</p>' +
                '<p>On the first fix of the day, standing still and indoors, it can take more than a minute. Redo the test <strong>outdoors with the sky in view</strong>: that is the condition the site is really used in.</p>',
            'diag.verd.altro': function (ca, cb) {
                return '<p><strong>The permission does not look blocked, but no position arrives</strong> (code ' +
                    ca + ' at high accuracy, code ' + cb + ' approximate).</p>' +
                    '<p>Redo the test outdoors. If it stays like this outside too, check the three levels:</p>';
            },
            'diag.guida.android': '<p><strong>Android (Chrome)</strong></p><ol>' +
                '<li>Quick-settings panel → <em>Location</em> on</li>' +
                '<li>Android Settings → Apps → Chrome → Permissions → Location → allowed, with <em>precise location</em> on</li>' +
                '<li>On the site: padlock next to the address → Permissions → Location → Allow</li>' +
                '</ol>',
            'diag.guida.ios': '<p><strong>iPhone / iPad (Safari)</strong></p><ol>' +
                '<li>iOS Settings → Privacy &amp; Security → Location Services: on</li>' +
                '<li>On the same screen, further down: Safari → «While Using the App» <em>(this is the most common case, and cannot be told apart from the next one from the site)</em></li>' +
                '<li>On the site: «aA» in the address bar → Website Settings → Location → Allow</li>' +
                '</ol>',
            'diag.guida.ricarica': '<p>Then reload the page.</p>',

            // ============================================================
            // PUNTO 113 - Parte social: Segui, Feed, pagina uscita, "mi piace", "crea percorso".
            // Traduzione EN aggiunta al passo 10 (30/08/2026): i passi 1-9 erano gia' a schermo
            // col ripiego italiano inline (T('chiave') || 'italiano'), come da rollout del
            // punto 102. RESTANO IN ITALIANO di proposito: la didascalia di un'uscita (testo
            // utente), il nome di un percorso salvato e l'etichetta "da <autore>" (nome
            // proprio), e il testo delle notifiche (lo genera il server, come tutte le altre).
            // ============================================================

            // Voce di barra + titolo di sezione. PASSO 7 (01/09/2026): "Feed" ->
            // "Ispirazioni" (rinomina; data-target e id di sezione restano 'feed').
            // La voce ora vive dentro il gruppo "Esplora" della sidebar.
            'nav.ispirazioni': 'Inspiration',
            'sectionTitle.feed': 'Inspiration',
            // #section-title dell'uscita: disegnaTestata (outingpage.js) ci scrive poi il nome
            // dell'autore (come #user-profile con lo username) - questa e' la parola di
            // ripiego per l'istante prima, e per il picker della barra dove la sezione non ha voce.
            'sectionTitle.outing-page': 'Outing',

            // Pagina Feed (feed.js + intro statica in index.html). PASSO 7: il titolo
            // interno segue la rinomina "Feed" -> "Ispirazioni" (id sezione resta 'feed';
            // "il feed" come nome comune del flusso resta nei testi di publish.*).
            'feed.titolo': 'Inspiration',
            'feed.sottotitolo': 'Outings published by the people you follow, most recent first. Tap an outing to open it.',
            'feed.caricamento': 'Loading...',
            'feed.caricaAltre': 'Load more',
            'feed.errore': 'Could not load the feed. Try again later.',
            'feed.vuoto': 'No outings published yet by the people you follow.',
            'feed.nessunSeguito': 'You\'re not following anyone yet. Find people in "Search People" or on their profile and follow them: their published outings will show up here.',
            'feed.miPiaceMetti': 'Add a like',
            'feed.miPiaceTogli': 'Remove the like',
            'feed.miPiaceErrore': 'Could not update the like.',
            // Titolo di ripiego della card nel feed quando l'uscita non ha un nome: nel feed
            // la data e' gia' nella riga autore, quindi qui non si ripete (cosmetico punto 113).
            'feed.uscitaSenzaNome': 'Outing',

            // Tasto "Segui" e liste follow (userprofile.js, social.js, index.html)
            'follow.segui': 'Follow',
            'follow.seguiGia': 'Following',
            'follow.smettiSegui': 'Unfollow',
            'follow.errore': 'Could not update.',
            'follow.seguaci': 'followers',
            'follow.seguiti': 'following',
            'follow.nessunSeguito': 'You\'re not following anyone yet.',
            'follow.nessunSeguace': 'Nobody follows you yet.',
            'follow.nessunSeguitoAltri': 'This person isn\'t following anyone.',
            'follow.nessunSeguaceAltri': 'Nobody follows this person.',
            'follow.sezioneTitolo': 'People',
            'follow.sezioneDesc': 'Who you follow and who follows you. Tap a name to open the profile.',
            'follow.seguitiTitolo': 'People you follow',
            'follow.seguaciTitolo': 'People who follow you',

            // Pubblicare / togliere un'uscita dal feed (storico.js)
            'publish.pubblica': 'Publish to feed',
            'publish.pubblicata': 'Published',
            'publish.togli': 'Remove from feed',
            'publish.tolta': 'Outing removed from the feed.',
            'publish.fatta': 'Outing published to the feed!',
            'publish.pubblicaTitle': 'Make this outing visible to the people who follow you',
            'publish.pubblicataTitle': 'In the feed of the people who follow you. Click to remove it.',
            'publish.serveTracciaTitle': 'A GPS track is needed to publish to the feed',
            'publish.serveTraccia': 'This hike has no GPS track on the site. Add it with the ⬆ button on this card (the same one for real time), then you can publish it to the feed.',
            'publish.chiediNome': 'Name of the outing (optional, but it helps whoever sees it in the feed).',
            'publish.chiediDidascalia': 'Write a line or two about the outing (optional). Press OK to publish it to the feed of the people who follow you.',
            'publish.confermaTogli': 'Remove this outing from the feed? It will no longer be visible to the people who follow you (the likes stay).',
            'publish.errorePubblica': 'Could not publish the outing.',
            'publish.erroreTogli': 'Could not remove the outing from the feed.',

            // Pagina di una singola uscita (outingpage.js)
            'outing.caricamento': 'Loading...',
            'outing.errore': 'Could not load this outing. Try again later.',
            'outing.nonVisibile': 'You can\'t see this outing: maybe it\'s no longer public, or you no longer follow whoever published it.',
            'outing.durata': 'duration',
            'outing.durataIgnota': 'duration unknown',
            'outing.durataIgnotaTitle': 'The .gpx file didn\'t contain point timestamps.',
            'outing.mDisliv': 'm elev. gain',
            'outing.miPiaceMetti': 'Add a like',
            'outing.miPiaceTogli': 'Remove the like',
            'outing.miPiaceErrore': 'Could not update the like.',
            'outing.creaPercorso': 'Create route',
            'outing.creaPercorsoChiediNome': 'What name do you want to give this route? You\'ll find it in "My Hikes" → My projects.',
            'outing.creaPercorsoFatto': 'Route created: you\'ll find it in "My Hikes" → My projects.',
            'outing.creaPercorsoErrore': 'Could not create the route.',
            // Nome di default per "crea percorso": "autore · data". Identico in IT/EN
            // (la data la formatta gia' formattaData in en-GB/it-IT).
            'outing.creaPercorsoNomeDefault': function (autore, quando) { return autore + ' · ' + quando; },

            // "Crea percorso" -> SavedRoute nelle card di "I miei progetti" (routeplanner.js)
            'rp.prog.tagDaTraccia': 'from a track',
            'rp.prog.tagDaTracciaTitle': 'Route copied from an outing\'s track, to reuse it',
            'rp.prog.daAutore': function (nome) { return 'from ' + nome; },
            'rp.prog.daAutoreTitle': 'Who walked the original track',
            'rp.prog.quotaMax': 'max elevation',
            'rp.prog.cancellaPercorsoMsg': 'Delete this saved route?\n\nThe copy of the track will be lost. The original outing of whoever walked it is not touched.',

            // Escursione con i numeri calcolati da un percorso salvato (social.js, index.html)
            'hikeModal.routeSaved': 'Calculate from a route saved from a track',
            'hikeModal.qualePercorso': 'Which route:',
            'hikeModal.nessunPercorsoSalvato': 'You don\'t have any routes saved from a track yet',
            'hikeToast.scegliPercorso': 'Choose a route from the list.',

            // "Percorso da seguire" durante una registrazione (tracking.js, index.html)
            'track.percorsoDaSeguire': 'Route to follow (optional):',
            'track.nessunPercorso': 'None',
            'track.percorsoDaSeguireNota': 'Just a reference line on the map. The site does not warn you if you stray from it.'
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
        // data-i18n-title: stesso principio, per l'attributo title (tooltip) di un
        // elemento statico nell'HTML - rollout punto 102, secondo lotto (Escursioni/Le
        // mie escursioni), primo caso con un title fisso nel markup invece che
        // costruito da JS (dove basta un T(...) diretto nel template).
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            if (el.dataset.i18nTitleFallback === undefined) {
                el.dataset.i18nTitleFallback = el.title;
            }
            const tradotto = t(el.getAttribute('data-i18n-title'));
            el.title = tradotto !== null ? tradotto : el.dataset.i18nTitleFallback;
        });

        // data-i18n-label: stesso principio per aria-label (V2 UX PASSO 8, hamburger del
        // drawer - primo controllo con un aria-label da tradurre).
        document.querySelectorAll('[data-i18n-label]').forEach(function (el) {
            if (el.dataset.i18nLabelFallback === undefined) {
                el.dataset.i18nLabelFallback = el.getAttribute('aria-label') || '';
            }
            const tradotto = t(el.getAttribute('data-i18n-label'));
            el.setAttribute('aria-label', tradotto !== null ? tradotto : el.dataset.i18nLabelFallback);
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
