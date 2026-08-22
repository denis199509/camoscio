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
            'hikePage.chatTitolo': 'Hike Chat',

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
            //    accetta/rifiuta (notifyParticipantDecision, social.js) NON sono
            //    stati tradotti apposta: il testo viene scritto una volta sola sul
            //    server nella lingua di CHI approva, non di chi lo legge dopo -
            //    tradurlo avrebbe fatto vedere l'inglese a un utente che preferisce
            //    l'italiano (o viceversa) a seconda della lingua di chi ha
            //    approvato, invece di seguire sempre la lingua di chi guarda.
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
            'hikes.esplora': 'Explore Group Hikes',
            'hikes.cercaTitoloLabel': 'Search by title:',
            'hikes.cercaTitoloPlaceholder': 'E.g. Alba Corno Grande...',
            'hikes.filtriTitolo': 'Filters and Matching Algorithms',
            'hikes.difficoltaLabel': 'Difficulty:',
            'hikes.tutteDifficolta': 'All difficulties',
            'hikes.tribuLabel': 'Tribe (Lifestyle) — select one or more:',
            'hikes.disponibiliTitolo': 'Open to Join',
            'hikes.partecipiTitolo': "You're Joining",
            'hikes.completateTitolo': 'Completed',
            'hikes.nessunFiltro': 'No hikes found with the selected filters.',
            'hikes.nonPartecipiAlcuna': "You're not joining any upcoming hike.",
            'hikes.nessunaCompletata': 'No completed hikes.',

            // --- LE MIE ESCURSIONI (public/index.html #my-hikes, social.js +
            // storico.js) ---
            'myHikes.organizzateTitolo': 'Organized by Me',
            'myHikes.organizzateDesc': 'Hikes you created. Here you approve or decline join requests.',
            'myHikes.partecipoTitolo': 'Joining',
            'myHikes.partecipoDesc': "Upcoming hikes you've joined, plus those awaiting approval.",
            'myHikes.completateTitolo': 'Completed Hikes',
            'myHikes.completateDesc': 'Hikes you completed on the site, and routes you recorded via GPS or uploaded from a file.',
            'myHikes.gpxUploadTitolo': 'Upload a .gpx file',
            'myHikes.gpxUploadDesc': 'Do you have tracks from hikes you did before using Camoscio? Upload them here to add them to your history and totals.',
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
            'hikeModal.routeSourceLabel': 'Max altitude, elevation gain and distance:',
            'hikeModal.routeManuale': "I'll enter them myself",
            'hikeModal.routeDraft': 'Calculate from an existing project',
            'hikeModal.routeGpx': 'Calculate by importing a track (.gpx)',
            'hikeModal.qualeProgetto': 'Which project:',
            'hikeModal.fileGpxLabel': '.gpx File:',
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
            'hikeCard.completataGruppo': 'Completed as a group ✓',
            'hikeCard.completaBtn': 'Complete hike',
            'hikeCard.opzioniTitle': 'Hike options',
            'hikeCard.modificaBtn': 'Edit',
            'hikeCard.partecipantiLabel': function (n) { return 'Participants (' + n + '):'; },

            // --- Messaggi/conferme azioni escursione (social.js) ---
            'hikeToast.scegliProgetto': 'Choose a project from the list.',
            'hikeToast.scegliGpx': 'Choose a .gpx file to import.',
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
            'hikeToast.filePesa': function (mb) { return 'The file is ' + mb + ' MB, over the 10 MB limit.'; },
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

            // --- Le mie escursioni: caricamento .gpx (storico.js) ---
            'gpx.estensioneErrata': function (nome) { return 'The file must have a <b>.gpx</b> extension. You chose "' + nome + '".'; },
            'gpx.filePesa': function (mb) { return 'The file is ' + mb + ' MB, over the 10 MB limit. A normally-recorded hike is usually under 1 MB.'; },
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
            'gpx.riprova': 'Try again.'
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
