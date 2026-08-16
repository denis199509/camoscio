const { mongoose } = require('../db/mongo');

const INTERESSI = [
    'Passeggiate facili', 'Trekking giornalieri', 'Trekking di più giorni', 'Ferrate',
    'Alpinismo', 'Trail running', 'MTB', 'Ciaspolate', 'Fotografia', 'Natura',
    'Rifugi', 'Laghi', 'Panorami', 'Vette', 'Borghi', 'Tramonti', 'Alba'
];

const REGIONI = ['Marche', 'Lazio', 'Abruzzo', 'Molise'];

// Campi obbligatori solo per gli account registrati per davvero: i 4 account demo storici
// (isDemoAccount:true) sono stati creati prima che questi campi esistessero e restano
// utilizzabili solo tramite la pagina /demo, senza passare da qui.
const requiredUnlessDemo = function () {
    return !this.isDemoAccount;
};

const emergencyContactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    // Non piu' chiesto dai form dal 16/08/2026 (richiesta di Denis: "il numero del telefono
    // al momento non serve quindi cancelliamo quella voce. basta il nome, relazione e la
    // mail"). Due scelte separate, entrambe volute:
    //  - VIA required: l'array emergencyContacts viene sostituito PER INTERO a ogni
    //    salvataggio (vedi salvaNuovoContatto in public/js/safety.js, e la PUT con
    //    runValidators:true in routes/users.js), quindi un solo contatto NUOVO senza numero
    //    farebbe rifiutare l'intero elenco, vecchi compresi. E' lo stesso motivo per cui
    //    l'email qui sotto non e' required, letto al contrario.
    //  - IL CAMPO RESTA: i contatti salvati prima di oggi (Denis compreso) un numero ce
    //    l'hanno, e proprio perche' l'array si riscrive per intero Mongoose lo scarterebbe
    //    al primo salvataggio successivo - il dato sparirebbe senza che nessuno l'abbia
    //    chiesto. Chi ce l'ha se lo tiene (lo mostra ancora triggerEmergencyAlarm in
    //    public/js/safety.js), chi non ce l'ha non scrive niente: nessun default, come da
    //    vincolo spazio.
    phone: { type: String },
    relationship: { type: String, required: true },
    // Punto 37: canale scelto per l'allarme vero del Dead Man's Switch. NON required a
    // livello di schema apposta - i contatti reali gia' salvati (Denis compreso) non ne
    // hanno uno, e questo campo vive dentro un array sostituito per intero a ogni salvataggio
    // (vedi salvaNuovoContatto in public/js/safety.js): required:true qui bloccherebbe anche
    // l'aggiunta di un contatto NUOVO finche' quelli vecchi non vengono sistemati, e non
    // esiste (ancora) una schermata per modificarli. Obbligatoria invece nei form (wizard di
    // registrazione e "Aggiungi un contatto"), e i contatti senza email restano selezionabili
    // ma non usabili per attivare il timer (vedi popolaContattiEmergenza in safety.js).
    email: { type: String, lowercase: true, trim: true }
}, { _id: false });

// Punto 42b: _id:false come sopra - un ObjectId per voce non aggiungerebbe niente, sono
// pochissime righe per pochissimi utenti ma il principio (non scrivere spazio che non
// serve) resta lo stesso a prescindere dalla quantita'.
const recognizedAscentSchema = new mongoose.Schema({
    stampId: { type: String, required: true },
    count: { type: Number, required: true, min: 1 }
}, { _id: false });

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    reputation: { type: Number, default: 50 },
    completedHikes: { type: Number, default: 0 },
    // IL CAMPO ASSENTE VUOL DIRE "MAI MISURATO", e non e' la stessa cosa di "350".
    // Prima del 16/08/2026 questi due campi nascevano con 350/500 gia' scritti addosso: un
    // account appena registrato, senza una sola escursione, mostrava in Dashboard "Velocita'
    // Ascesa 350 m/h" e un grafico a barre piene, indistinguibili da una misura vera
    // (segnalato da Denis su un account reale). Un'ipotesi di calcolo mostrata come un dato
    // rilevato e' esattamente il vincolo hard 7 ("niente promesse che il sito non puo'
    // mantenere"), e default: undefined e' anche la regola del vincolo hard 1 quando "non
    // c'e' ancora" e' il caso normale.
    // Chi scrive qui: SOLO il server, ricostruendo da tutte le osservazioni vere presenti
    // (recalculatePersonalPace + applyPersonalPace in lib/hikeStats.js) - mai il client
    // (non sono in SELF_EDITABLE_FIELDS, routes/users.js).
    // ECCEZIONE VOLUTA: i 4 account demo del seed (scripts/seed-data.json) hanno un passo
    // assegnato a mano SENZA completamenti a giustificarlo, per simulare un utente esperto -
    // scelta gia' presa e approvata. Per loro il campo c'e' ed e' giusto che si veda: e'
    // anche il motivo per cui "campo presente = mostralo" basta al frontend senza bisogno di
    // guardare isDemoAccount.
    // Il numero 350/500 continua a esistere come IPOTESI DI CALCOLO dove un divisore serve
    // comunque (DEFAULT_PACE_UP/DOWN in lib/hikeStats.js, calculateHikeTimes in
    // public/js/profile.js): li' serve un numero, il divieto riguarda solo mostrarlo
    // all'utente spacciandolo per "il tuo passo rilevato".
    averagePaceUp: { type: Number, default: undefined },
    averagePaceDown: { type: Number, default: undefined },
    // Calcolato automaticamente dallo storico escursioni (vedi routes/hikes.js) - MAI autodichiarato
    experienceLevel: {
        type: String,
        enum: ['Principiante', 'Intermedio', 'Esperto'],
        default: 'Principiante'
    },
    avatar: { type: String, default: '🏔️' },
    trainingGoal: { type: String, default: '' },
    // Citta'/zona di partenza per il matching carpooling (vedi public/js/carpool.js): il campo
    // mancava dallo schema (bug trovato in Fase H) - veniva scartato silenziosamente ad ogni
    // salvataggio, cosi' il matching per citta' funzionava solo per coincidenza tra account
    // diversi sullo stesso browser (via il fallback localStorage), mai tra utenti veri.
    homeCity: { type: String, default: '' },
    localExpert: {
        type: new mongoose.Schema({
            area: String,
            active: Boolean
        }, { _id: false }),
        default: null
    },
    // Distingue per sempre i 4 account demo storici dagli account registrati per davvero
    isDemoAccount: { type: Boolean, default: false },

    // --- 1. Dati base (obbligatori alla registrazione reale) ---
    nome: { type: String, required: requiredUnlessDemo },
    cognome: { type: String, required: requiredUnlessDemo },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    // L'indirizzo e' stato DIMOSTRATO, cliccando il link di conferma mandato in
    // registrazione. In Fase C si era deciso "email solo salvata, nessuna verifica": quella
    // decisione e' caduta il 2026-07-28, quando il canale di invio ha cominciato a
    // funzionare davvero (vedi cronologia.txt).
    // NESSUNA MIGRAZIONE E' SERVITA: sui documenti creati prima il campo non c'e', e un
    // campo assente vale gia' "non verificato" - che e' proprio quello che si vuole, perche'
    // di quegli indirizzi nessuno ha mai dimostrato niente.
    // NON e' fra i campi modificabili dal proprietario (SELF_EDITABLE_FIELDS in
    // routes/users.js): quella e' una lista bianca, quindi nessuno puo' marcarsi verificato
    // da solo con una PUT.
    emailVerified: { type: Boolean, default: false },
    passwordHash: { type: String, select: false },
    birthDate: { type: Date, default: null },
    ageRange: { type: String, enum: ['18-29', '30-39', '40-49', '50-59', '60+', null], default: null },
    termsAcceptedAt: { type: Date, default: null },

    // --- 2. Profilo escursionistico dichiarato (separato da experienceLevel, che e' calcolato) ---
    hikingLevel: {
        type: String,
        enum: ['Principiante', 'Intermedio', 'Esperto', 'Alpinista', null],
        default: null
    },

    // --- 3. Interessi (multi-selezione) ---
    interests: { type: [{ type: String, enum: INTERESSI }], default: [] },

    // --- 4. Difficolta' preferita (scala CAI) ---
    preferredDifficulty: {
        type: String,
        enum: ['T', 'E', 'EE', 'EEA', 'Alpinistica', null],
        default: null
    },

    // --- 5. Area geografica ---
    geoPreferences: {
        type: new mongoose.Schema({
            region: { type: String, enum: [...REGIONI, null], default: null },
            provinces: { type: [String], default: [] },
            mountainRanges: { type: [String], default: [] }
        }, { _id: false }),
        default: () => ({})
    },

    // --- 6. Profilo pubblico (username: vedi campo "username" sopra, gia' esistente) ---
    profilePhoto: { type: String, default: null }, // data URL base64, piccola: niente file su disco (Render li perde ad ogni riavvio)
    bio: { type: String, maxlength: 250, default: '' },

    // --- 7. Contatti di emergenza (obbligatorio, anche piu' di uno) ---
    emergencyContacts: { type: [emergencyContactSchema], default: [] },

    // --- 8. Consenso geolocalizzazione (facoltativo) ---
    geolocationConsent: { type: Boolean, default: false },

    // --- 9. Preferenze privacy ---
    privacySetting: {
        type: String,
        enum: ['Pubblico', 'SoloAmici', 'Privato'],
        default: 'Pubblico'
    },

    // --- 10. Salite riconosciute a una vetta, prima che il sito esistesse (punto 42b) ---
    // Il sito sa contare le uscite che toccano una vetta (routes/tracking.js), ma non puo'
    // sapere di quelle avvenute PRIMA che Camoscio esistesse. Questo campo e' quel numero,
    // scritto a mano da Denis per una persona di cui conosce lo storico - un PAVIMENTO su
    // cui le uscite registrate dal sito si sommano, non un totale: non va mai ritoccato
    // quando la persona cammina. Nessuna interfaccia per scriverlo (deciso il 29/07/2026,
    // vedi 03-Decisioni-Architetturali.md del vault): per ora si scrive direttamente.
    // default: undefined come coordinates in Hike.js - quasi nessun utente avra' mai una
    // voce qui, e il vincolo hard sullo spazio dice di non scrivere il campo quando non serve.
    recognizedAscents: { type: [recognizedAscentSchema], default: undefined },

    // --- 11. Dead Man's Switch: il conto alla rovescia vive anche sul server (punto 37) ---
    // Prima esisteva SOLO in localStorage (public/js/safety.js): se la pagina restava chiusa
    // oltre la scadenza, non se ne accorgeva nessuno finche' qualcuno non riapriva il sito.
    // Questi tre campi rispecchiano lo stesso stato gia' tenuto li' - duplicato qui perche'
    // solo il server puo' controllarlo a pagina chiusa (routes/safety.js, chiamata da un
    // trigger esterno: questo progetto non ha nessuno scheduler, vedi 04-Da-Fare.md del vault).
    // default: undefined su tutti e tre (vincolo spazio, come recognizedAscents sopra): quasi
    // nessun utente ha il timer attivo nello stesso istante in cui il documento viene letto.
    deadManActive: { type: Boolean, default: undefined },
    deadManExpiresAt: { type: Date, default: undefined },
    deadManContactIndex: { type: Number, default: undefined },

    // --- 12. Moderazione segnalazioni sentiero (punto 45) ---
    // Ruolo DI SITO, non scoped a una singola squadra come Squad.admins (punto 48, vedi
    // 03-Decisioni-Architetturali.md del vault): chi puo' confermare o rifiutare le
    // segnalazioni sentiero prima che diventino pubbliche. default: undefined come i campi
    // Dead Man's Switch sopra - oggi lo avra' un solo utente su tutto il database. Nessuna
    // interfaccia per impostarlo: si scrive con scripts/set-report-moderator.js. Un booleano
    // per utente scala gia' a piu' moderatori futuri senza bisogno di un framework di ruoli.
    canModerateReports: { type: Boolean, default: undefined }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
User.INTERESSI = INTERESSI;
User.REGIONI = REGIONI;
module.exports = User;
