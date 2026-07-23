const mongoose = require('mongoose');

// Ogni documento serializzato in JSON espone "id" (stringa) invece di "_id"/"__v",
// per restare compatibile con tutto il frontend esistente che usa gia' ".id".
mongoose.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
        delete ret._id;
        delete ret.passwordHash; // non deve MAI uscire in una risposta API, qualunque rotta sia
        return ret;
    }
});

let connected = false;

async function connectMongo() {
    if (connected) return mongoose.connection;

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI non impostata nel file .env');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    connected = true;
    console.log('Connesso a MongoDB Atlas, database:', mongoose.connection.name);
    return mongoose.connection;
}

module.exports = { mongoose, connectMongo };
