// Punto 45 (foto sulle segnalazioni): compressore immagine lato browser, primo modulo del
// genere nel progetto. Le foto profilo (punto 40) restano intere fino a ~1,5 MB perche' si
// salvano una volta e si leggono raramente; una segnalazione sentiero nasce invece al volo,
// spesso in montagna con poco campo - qui il tetto e' molto piu' stretto (~300-400 KB) ed e'
// il BROWSER a comprimere prima di inviare, non il server dopo (vincolo hard 1, spazio).
//
// createImageBitmap con imageOrientation:'from-image' gestisce da solo la rotazione EXIF
// delle foto verticali da telefono: i telefoni salvano l'orientamento vero in un tag EXIF
// senza ruotare i pixel, e sono <img>/CSS a leggerlo - un <canvas> disegnato senza questa
// opzione ignorerebbe il tag e produrrebbe una foto ruotata di 90 gradi.
window.CamoscioImageCompress = (function () {
    // Ridimensionamento progressivo del lato lungo, poi per ciascuna dimensione un ciclo di
    // qualita' JPEG: si esce al primo risultato sotto il tetto, cosi' una foto gia' piccola
    // non viene compressa piu' del necessario.
    const LATI_MAX = [1280, 960, 720];
    const QUALITA_JPEG = [0.72, 0.55, 0.4];

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    function disegnaRidimensionata(bitmap, latoMax) {
        const scala = Math.min(1, latoMax / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scala));
        canvas.height = Math.max(1, Math.round(bitmap.height * scala));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function canvasToBlob(canvas, qualita) {
        // toBlob e mai toDataURL nei tentativi: toDataURL costruirebbe una stringa base64
        // intera ad ogni prova, anche per quelle scartate. La stringa si costruisce una
        // sola volta, sul blob vincitore (vedi comprimi() sotto).
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualita));
    }

    // Ritorna una data URL JPEG sotto maxBytes (o la piu' piccola ottenuta, se nessun
    // tentativo scende sotto il tetto - meglio una foto un po' piu' pesante del previsto che
    // bloccare la segnalazione), oppure null se l'immagine non si riesce proprio a leggere.
    async function comprimi(file, maxBytes = 380 * 1024) {
        if (!window.createImageBitmap) return null;

        let bitmap;
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) {
            console.error("Impossibile leggere l'immagine:", e);
            return null;
        }

        try {
            let ultimoBlob = null;
            for (const lato of LATI_MAX) {
                const canvas = disegnaRidimensionata(bitmap, lato);
                for (const qualita of QUALITA_JPEG) {
                    const blob = await canvasToBlob(canvas, qualita);
                    if (!blob) continue;
                    ultimoBlob = blob;
                    if (blob.size <= maxBytes) {
                        return await blobToDataUrl(blob);
                    }
                }
            }
            return ultimoBlob ? await blobToDataUrl(ultimoBlob) : null;
        } finally {
            bitmap.close();
        }
    }

    return { comprimi };
})();
