// SOLO LETTURA - diagnostica una tantum. Cerca "tracce" di un utente (default: DaniWoll)
// i cui punti cadono fuori dalle 4 regioni coperte dal sito (Marche/Lazio/Abruzzo/Molise),
// usando i confini reali di lib/regions.js. Non scrive niente, non cancella niente.
//
// Uso: node scripts/trova-traccia-fuori-regioni.js [--utente=Username]
require('dotenv').config();
const { connectMongo, mongoose } = require('../db/mongo');
const User = require('../models/User');
const ActiveHikeSession = require('../models/ActiveHikeSession');
const RouteDraft = require('../models/RouteDraft');
const Hike = require('../models/Hike');
const { regionForPoint } = require('../lib/regions');

const arg = process.argv.find(a => a.startsWith('--utente='));
const USERNAME = arg ? arg.slice('--utente='.length) : 'DaniWoll';

function bboxOf(coords) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const [lng, lat] of coords) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }
    return { minLat, maxLat, minLng, maxLng };
}

// Campiona fino a N punti per non chiamare regionForPoint migliaia di volte.
function fuoriRegioni(coords, campione = 40) {
    if (coords.length === 0) return { fuori: 0, tot: 0, campioni: [] };
    const step = Math.max(1, Math.floor(coords.length / campione));
    let fuori = 0, tot = 0;
    const campioni = [];
    for (let i = 0; i < coords.length; i += step) {
        const [lng, lat] = coords[i];
        if (typeof lng !== 'number' || typeof lat !== 'number') continue;
        tot++;
        const reg = regionForPoint(lng, lat);
        if (!reg) { fuori++; if (campioni.length < 3) campioni.push([lng, lat]); }
    }
    return { fuori, tot, campioni };
}

(async () => {
    await connectMongo();

    const user = await User.findOne({ username: USERNAME });
    if (!user) {
        console.log(`Nessun utente con username "${USERNAME}".`);
        await mongoose.disconnect();
        return;
    }
    console.log(`Utente: ${user.username}  (_id ${user._id})\n`);

    // --- ActiveHikeSession (le "tracce" vere e proprie, registrate o importate da GPX) ---
    const sessioni = await ActiveHikeSession.find({ userId: user._id }).lean();
    console.log(`=== ActiveHikeSession: ${sessioni.length} totali ===`);
    for (const s of sessioni) {
        const pts = Array.isArray(s.points) ? s.points : [];
        const { fuori, tot, campioni } = fuoriRegioni(pts);
        const bb = pts.length ? bboxOf(pts) : null;
        const kb = Math.round(Buffer.byteLength(JSON.stringify(s)) / 1024);
        const flag = tot > 0 && fuori === tot ? '  <<< TUTTI I PUNTI FUORI REGIONE' :
                     fuori > 0 ? `  <<< ${fuori}/${tot} campioni fuori regione` : '';
        console.log(
            `\n  _id ${s._id}` +
            `\n    nome        : ${s.importedName || '(nessuno)'}` +
            `\n    importata da : ${s.importedFrom || '(registrata dal vivo)'}` +
            `\n    creata       : ${s._id.getTimestamp().toISOString()}` +
            `\n    startedAt    : ${s.startedAt ? new Date(s.startedAt).toISOString() : '-'}` +
            `\n    status       : ${s.status}   punti: ${pts.length}   distanza: ${s.distanceKm} km   peso doc: ~${kb} KB` +
            (bb ? `\n    bbox         : lat ${bb.minLat.toFixed(4)}..${bb.maxLat.toFixed(4)}  lng ${bb.minLng.toFixed(4)}..${bb.maxLng.toFixed(4)}` : '') +
            (campioni.length ? `\n    campioni fuori: ${campioni.map(c => `[${c[0].toFixed(4)}, ${c[1].toFixed(4)}]`).join('  ')}` : '') +
            flag
        );
    }

    // --- RouteDraft (progetti percorso "I miei progetti") ---
    const bozze = await RouteDraft.find({ userId: user._id }).lean();
    console.log(`\n\n=== RouteDraft: ${bozze.length} totali ===`);
    for (const b of bozze) {
        const pts = Array.isArray(b.punti) ? b.punti : [];
        const { fuori, tot, campioni } = fuoriRegioni(pts, 100);
        const bb = pts.length ? bboxOf(pts) : null;
        const flag = tot > 0 && fuori === tot ? '  <<< TUTTI I PUNTI FUORI REGIONE' :
                     fuori > 0 ? `  <<< ${fuori}/${tot} punti fuori regione` : '';
        console.log(
            `\n  _id ${b._id}` +
            `\n    nome   : ${b.nome}` +
            `\n    creata : ${b.creataIl ? new Date(b.creataIl).toISOString() : b._id.getTimestamp().toISOString()}` +
            `\n    punti  : ${pts.length}` +
            (bb ? `\n    bbox   : lat ${bb.minLat.toFixed(4)}..${bb.maxLat.toFixed(4)}  lng ${bb.minLng.toFixed(4)}..${bb.maxLng.toFixed(4)}` : '') +
            (campioni.length ? `\n    campioni fuori: ${campioni.map(c => `[${c[0].toFixed(4)}, ${c[1].toFixed(4)}]`).join('  ')}` : '') +
            flag
        );
    }

    // --- Hike creati dall'utente (trailhead / location / peaks) ---
    const hikes = await Hike.find({ creatorId: user._id }).lean();
    console.log(`\n\n=== Hike creati da ${user.username}: ${hikes.length} totali ===`);
    for (const h of hikes) {
        const punti = [];
        if (h.trailhead && typeof h.trailhead.lng === 'number') punti.push([h.trailhead.lng, h.trailhead.lat]);
        if (h.location && Array.isArray(h.location.coordinates) && h.location.coordinates.length === 2) punti.push(h.location.coordinates);
        for (const p of (h.peaks || [])) if (typeof p.lng === 'number') punti.push([p.lng, p.lat]);
        const { fuori, tot } = fuoriRegioni(punti, 100);
        const flag = tot > 0 && fuori === tot ? '  <<< TUTTI I PUNTI NOTI FUORI REGIONE' :
                     fuori > 0 ? `  <<< ${fuori}/${tot} punti fuori regione` : '';
        if (tot === 0 && !flag) continue;
        console.log(
            `\n  _id ${h._id}  "${h.title}"  data ${h.date || '-'}` +
            `\n    punti noti: ${tot}   fuori: ${fuori}` + flag
        );
    }

    console.log('\n\n(diagnostica di sola lettura: niente e\' stato modificato)');
    await mongoose.disconnect();
})().catch(e => {
    console.error('Errore:', e.message);
    process.exit(1);
});
