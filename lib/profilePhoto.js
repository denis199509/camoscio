// Validazione della foto profilo (User.profilePhoto), condivisa fra registrazione
// (routes/auth.js) e modifica profilo (routes/users.js) - stesso identico buco chiuso su
// Squad.photo (MEDIO-2/MEDIO-3 residuo, follow-up revisione sicurezza): prima si controllava
// solo la LUNGHEZZA della stringa, mai i byte veri, e il client mandava il file scelto cosi'
// com'e' (qualunque formato). Qui il client ora comprime sempre in JPEG (public/js/profile.js
// e public/js/auth.js, stesso modulo imagecompress.js delle foto squadra/segnalazioni), quindi
// si valida SOLO quel formato - stesso controllo di routes/reports.js e routes/squads.js.
// Estratta in un modulo unico perche' due rotte diverse ne hanno bisogno (stesso principio di
// User.validaContattiEmergenza: mai due copie della stessa regola di sicurezza).
const MAX_PHOTO_BYTES = 600 * 1024;
// Margine sulla stringa base64 (~4/3 dei byte, + il prefisso "data:image/jpeg;base64,"): un
// pre-controllo economico prima di decodificare, MAI il tetto vero (quello e' sui byte).
const MAX_PHOTO_LENGTH = Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 100;

// Ritorna { ok: true } oppure { ok: false, errore }. Non lancia mai.
function validaFotoProfiloJpeg(dataUrl) {
    if (String(dataUrl).length > MAX_PHOTO_LENGTH) {
        return { ok: false, errore: 'Foto profilo troppo grande, scegline una più piccola' };
    }
    const m = String(dataUrl).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) {
        return { ok: false, errore: 'Formato foto non valido' };
    }
    const buffer = Buffer.from(m[1], 'base64');
    if (buffer.length > MAX_PHOTO_BYTES) {
        return { ok: false, errore: 'Foto profilo troppo grande, scegline una più piccola' };
    }
    if (buffer.length < 3 || buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
        return { ok: false, errore: 'Formato foto non valido' };
    }
    return { ok: true };
}

module.exports = { MAX_PHOTO_BYTES, MAX_PHOTO_LENGTH, validaFotoProfiloJpeg };
