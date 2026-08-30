// Ridimensiona le immagini dei badge (public/img/badge-luoghi/ e badge-personali/)
// a un lato massimo di 768 px, ri-codificando il PNG senza perdita.
//
// PERCHE': le immagini erano salvate a 1024-1254 px (~1,5 MB l'una) ma mostrate a
// 80-90 px ovunque; l'unico posto dove serve la risoluzione piena e' il
// click-per-ingrandire (lightbox, ~92% dello schermo), per cui 768 px bastano.
// Le 33 immagini erano 46 MB, l'88% dell'intero repo. NON stanno su MongoDB (sono
// file statici serviti da Render), quindi il vincolo hard dei 512 MB non c'entra:
// il costo era il peso di pagina (la pagina Badge scaricava fino a 46 MB) e la
// dimensione del repo pubblico.
//
// SICUREZZE:
//  - gli originali vengono copiati UNA volta in ../camoscio-badge-originali/
//    (cartella SORELLA, fuori dal repo) prima di toccare qualsiasi cosa;
//  - i nomi dei file NON cambiano (referenziati in 6 file JS) e il formato resta
//    PNG: zero modifiche al codice;
//  - un'immagine gia' <= 768 px viene lasciata com'e';
//  - ri-lanciarlo e' innocuo (il backup non si sovrascrive; un file gia' a 768 px
//    viene saltato).
//
// Lancio:  node scripts/comprimi-badge.js
//          node scripts/comprimi-badge.js --dry   (solo stima, non scrive niente)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const LATO_MAX = 768;
const DRY = process.argv.includes('--dry');

const RADICE = path.join(__dirname, '..');
const CARTELLE = ['public/img/badge-luoghi', 'public/img/badge-personali'];
const BACKUP = path.join(RADICE, '..', 'camoscio-badge-originali');

function kb(n) { return (n / 1024).toFixed(0).padStart(5) + ' KB'; }

(async () => {
    let totPrima = 0, totDopo = 0, ridotte = 0, saltate = 0;

    for (const rel of CARTELLE) {
        const dir = path.join(RADICE, rel);
        if (!fs.existsSync(dir)) { console.log(`(salto ${rel}: non esiste)`); continue; }
        const backupDir = path.join(BACKUP, path.basename(rel));
        if (!DRY) fs.mkdirSync(backupDir, { recursive: true });

        const file = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'));
        console.log(`\n=== ${rel} (${file.length} PNG) ===`);

        for (const nome of file) {
            const src = path.join(dir, nome);
            const prima = fs.statSync(src).size;
            totPrima += prima;

            const meta = await sharp(src).metadata();
            if (Math.max(meta.width, meta.height) <= LATO_MAX) {
                console.log(`  ${nome.padEnd(38)} ${meta.width}x${meta.height}  gia' piccola, salto`);
                totDopo += prima; saltate++;
                continue;
            }

            // Backup dell'originale, solo se non c'e' gia'.
            const bak = path.join(backupDir, nome);
            if (!DRY && !fs.existsSync(bak)) fs.copyFileSync(src, bak);

            const buf = await sharp(src)
                .resize(LATO_MAX, LATO_MAX, { fit: 'inside', withoutEnlargement: true })
                .png({ compressionLevel: 9, effort: 10 })   // senza perdita, niente palette (niente banding)
                .toBuffer();

            totDopo += buf.length;
            ridotte++;
            const pct = (buf.length / prima * 100).toFixed(0);
            console.log(`  ${nome.padEnd(38)} ${kb(prima)} -> ${kb(buf.length)}  (${pct}%)`);

            if (!DRY) fs.writeFileSync(src, buf);
        }
    }

    console.log('\n----------------------------------------');
    console.log(`immagini ridimensionate : ${ridotte}`);
    console.log(`gia' piccole (saltate)  : ${saltate}`);
    console.log(`totale PRIMA            : ${(totPrima / 1024 / 1024).toFixed(1)} MB`);
    console.log(`totale DOPO             : ${(totDopo / 1024 / 1024).toFixed(1)} MB`);
    console.log(`risparmio              : ${((totPrima - totDopo) / 1024 / 1024).toFixed(1)} MB  (${(100 - totDopo / totPrima * 100).toFixed(0)}%)`);
    if (DRY) console.log('\n(--dry: non e\' stato scritto niente)');
    else console.log(`\noriginali copiati in: ${BACKUP}`);
})().catch(e => { console.error('ERRORE:', e); process.exit(1); });
