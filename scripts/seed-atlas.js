// Migra i dati storici da scripts/seed-data.json a MongoDB Atlas.
// Sicuro da rilanciare per errore: se trova gia' utenti nel database si ferma senza duplicare nulla.
require('dotenv').config();

const { mongoose, connectMongo } = require('../db/mongo');
const seedData = require('./seed-data.json');

const User = require('../models/User');
const Hike = require('../models/Hike');
const Report = require('../models/Report');
const Review = require('../models/Review');
const Stamp = require('../models/Stamp');
const Squad = require('../models/Squad');
const RouteBookmark = require('../models/RouteBookmark');
const Completion = require('../models/Completion');
const Notification = require('../models/Notification');
const Diary = require('../models/Diary');

async function migrate() {
    await connectMongo();

    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
        console.log(`Trovati gia' ${existingUsers} utenti su Atlas: migrazione saltata per non duplicare i dati.`);
        await mongoose.disconnect();
        return;
    }

    // --- Utenti: creati per primi, servono per tradurre tutti i riferimenti nelle altre collezioni ---
    const userIdMap = new Map(); // vecchio id stringa ("user_marco") -> nuovo ObjectId
    for (const oldUser of seedData.users) {
        const { id: oldId, ...rest } = oldUser;
        const created = await User.create({ ...rest, isDemoAccount: true });
        userIdMap.set(oldId, created._id);
    }
    console.log(`Creati ${userIdMap.size} utenti demo.`);

    // --- Escursioni ---
    const hikeIdMap = new Map(); // vecchio id stringa ("hike_orobie") -> nuovo ObjectId
    for (const oldHike of seedData.hikes) {
        const { id: oldId, carpool, backpackTemplate, trailhead, ...rest } = oldHike;

        const created = await Hike.create({
            ...rest,
            trailhead,
            location: trailhead ? { type: 'Point', coordinates: [trailhead.lng, trailhead.lat] } : undefined,
            creatorId: userIdMap.get(oldHike.creatorId),
            participants: (oldHike.participants || []).map(id => userIdMap.get(id)).filter(Boolean),
            pendingApproval: (oldHike.pendingApproval || []).map(id => userIdMap.get(id)).filter(Boolean),
            carpool: carpool ? {
                ...carpool,
                drivers: (carpool.drivers || []).map(d => ({ ...d, userId: userIdMap.get(d.userId) }))
            } : undefined,
            backpackTemplate: (backpackTemplate || []).map(item => ({
                ...item,
                assignedTo: item.assignedTo ? userIdMap.get(item.assignedTo) : null
            }))
        });
        hikeIdMap.set(oldId, created._id);
    }
    console.log(`Create ${hikeIdMap.size} escursioni.`);

    // --- Segnalazioni sentiero ---
    for (const oldReport of seedData.reports) {
        const { id, createdAt, ...rest } = oldReport;
        await Report.create(rest);
    }
    console.log(`Create ${seedData.reports.length} segnalazioni.`);

    // --- Recensioni (anonime: nessun reviewerId) ---
    for (const oldReview of seedData.reviews) {
        const { id, targetUserId, ...rest } = oldReview;
        await Review.create({ ...rest, targetUserId: userIdMap.get(targetUserId) });
    }
    console.log(`Create ${seedData.reviews.length} recensioni.`);

    // --- Timbri ---
    for (const oldStamp of seedData.stamps) {
        await Stamp.create({ ...oldStamp, userId: userIdMap.get(oldStamp.userId) });
    }
    console.log(`Creati ${seedData.stamps.length} timbri.`);

    // --- Squadre ---
    for (const oldSquad of seedData.squads) {
        const { id, creatorId, members, ...rest } = oldSquad;
        await Squad.create({
            ...rest,
            creatorId: userIdMap.get(creatorId),
            members: (members || []).map(m => userIdMap.get(m)).filter(Boolean)
        });
    }
    console.log(`Create ${seedData.squads.length} squadre.`);

    // --- Preferiti sentiero ---
    for (const oldBookmark of seedData.routeBookmarks) {
        await RouteBookmark.create({
            userId: userIdMap.get(oldBookmark.userId),
            hikeId: hikeIdMap.get(oldBookmark.hikeId)
        });
    }
    console.log(`Creati ${seedData.routeBookmarks.length} preferiti.`);

    // --- Completamenti e notifiche (oggi vuoti, gestiti comunque per completezza) ---
    for (const oldCompletion of seedData.completions || []) {
        await Completion.create({
            userId: userIdMap.get(oldCompletion.userId),
            hikeId: hikeIdMap.get(oldCompletion.hikeId),
            dateCompleted: oldCompletion.dateCompleted,
            actualTimeHours: oldCompletion.actualTimeHours
        });
    }
    for (const oldNotification of seedData.notifications || []) {
        const { id, userId, createdAt, ...rest } = oldNotification;
        await Notification.create({ ...rest, userId: userIdMap.get(userId) });
    }

    // --- Diario di viaggio ---
    for (const oldDiary of seedData.diaries || []) {
        const { id, hikeId, userId, timestamp, ...rest } = oldDiary;
        await Diary.create({
            ...rest,
            hikeId: hikeIdMap.get(hikeId),
            userId: userIdMap.get(userId)
        });
    }
    console.log(`Creati ${(seedData.diaries || []).length} appunti di diario.`);

    console.log('Migrazione completata con successo.');
    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error('Errore durante la migrazione:', err);
    process.exit(1);
});
