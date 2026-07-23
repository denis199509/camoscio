const { mongoose } = require('../db/mongo');

const squadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.models.Squad || mongoose.model('Squad', squadSchema);
