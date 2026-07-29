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
    phone: { type: String, required: true },
    relationship: { type: String, required: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    reputation: { type: Number, default: 50 },
    kycVerified: { type: Boolean, default: false },
    completedHikes: { type: Number, default: 0 },
    averagePaceUp: { type: Number, default: 350 },
    averagePaceDown: { type: Number, default: 500 },
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
    }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
User.INTERESSI = INTERESSI;
User.REGIONI = REGIONI;
module.exports = User;
