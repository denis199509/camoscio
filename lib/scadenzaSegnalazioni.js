// --- Scadenza delle segnalazioni sentiero (punto 111) ---
//
// Un posto solo per "quanto vale una segnalazione": 90 giorni. Prima questo numero viveva
// dentro l'indice TTL di models/Report.js (`expireAfterSeconds`), che pero' sapeva solo
// CANCELLARE alla scadenza. Il punto 111 lo sostituisce con un campo `Report.expiresAt`
// spostabile: alla scadenza parte una notifica a Denis, che decide se togliere la
// segnalazione o rinnovarla di altri 90 giorni.
//
// Nessuna dipendenza (nemmeno da mongoose): e' matematica su date, testabile da sola.

const GIORNI_VALIDITA = 90;
const MS_VALIDITA = GIORNI_VALIDITA * 24 * 60 * 60 * 1000;

// Alla creazione di una segnalazione: 90 giorni da adesso.
function prossimaScadenza(da = new Date()) {
    return new Date(da.getTime() + MS_VALIDITA);
}

// "Rinnova": sempre 90 giorni DA ADESSO, MAI `expiresAt + 90 giorni`. Parole di Denis:
// "tenerla per ALTRI 90 giorni". Se una segnalazione e' scaduta il 1 ottobre e Denis la
// rinnova il 10 novembre, `expiresAt + 90` gli darebbe 50 giorni residui, non 90.
// E' un alias di prossimaScadenza apposta: la logica e' la stessa, cambia solo l'intento
// del chiamante (e qui vive la lezione, cosi' non si sbaglia al passo del rinnovo).
function rinnovo(adesso = new Date()) {
    return prossimaScadenza(adesso);
}

module.exports = { GIORNI_VALIDITA, MS_VALIDITA, prossimaScadenza, rinnovo };
