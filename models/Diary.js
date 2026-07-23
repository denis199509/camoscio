const { mongoose } = require('../db/mongo');

const diarySchema = new mongoose.Schema({
    hikeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hike', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lat: Number,
    lng: Number,
    textNote: String,
    mediaUrl: { type: String, default: null },
    audioNoteUrl: { type: String, default: null }
}, { timestamps: { createdAt: 'timestamp', updatedAt: false } }); // "timestamp": nome storico gia' usato dal frontend

module.exports = mongoose.models.Diary || mongoose.model('Diary', diarySchema);
