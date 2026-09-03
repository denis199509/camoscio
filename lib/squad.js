// Appartenenza a una squadra - estratti da routes/squads.js (punto 48) perche' ora servono
// anche a routes/hikes.js: l'invito squadra direzionale (POST /api/hikes/:id/invite-squad)
// deve verificare che chi invita faccia parte della squadra. Una definizione sola - la
// lezione del punto 18 (due copie della stessa regola divergono in silenzio).
//
// Il creatore e' membro/admin PER CALCOLO (`creatorId`), mai duplicato dentro
// `members`/`admins`: per questo entrambe le funzioni fanno l'OR con `creatorId`. Una query
// secca `Squad.find({ members: userId })` NON basta a dire "fa parte di questa squadra" -
// funziona oggi solo perche' e' il client (`submitCreateSquad`) a mettere il creatore
// dentro `members`.

function isSquadMember(squad, userId) {
    return squad.creatorId.equals(userId) || squad.members.some(m => m.equals(userId));
}

function isSquadAdmin(squad, userId) {
    return squad.creatorId.equals(userId) || squad.admins.some(a => a.equals(userId));
}

module.exports = { isSquadMember, isSquadAdmin };
