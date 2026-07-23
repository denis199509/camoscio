const { mongoose } = require('../db/mongo');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    reputation: { type: Number, default: 50 },
    kycVerified: { type: Boolean, default: false },
    completedHikes: { type: Number, default: 0 },
    averagePaceUp: { type: Number, default: 350 },
    averagePaceDown: { type: Number, default: 500 },
    experienceLevel: {
        type: String,
        enum: ['Principiante', 'Intermedio', 'Esperto'],
        default: 'Principiante'
    },
    avatar: { type: String, default: '🏔️' },
    trainingGoal: { type: String, default: '' },
    localExpert: {
        type: new mongoose.Schema({
            area: String,
            active: Boolean
        }, { _id: false }),
        default: null
    },
    // Distingue per sempre i 4 account demo storici dagli account registrati per davvero (Fase C)
    isDemoAccount: { type: Boolean, default: false }
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
