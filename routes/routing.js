// PUNTO 13 - Progettazione di un percorso su piu' punti, seguendo i sentieri conosciuti.
//
// La ricerca vera sta in lib/trailGraph.js: qui c'e' solo il contorno, cioe' controllare
// che la richiesta abbia senso prima di far lavorare il server.
//
// COSA NON FA QUESTA ROTTA, di proposito: non rifiuta MAI un percorso perche' i sentieri
// non bastano. E' la decisione presa dall'utente il 2026-07-27 - dove un percorso sui
// sentieri non esiste si tira una retta ben dichiarata, e il percorso si completa sempre.
// Il campo "tipo" di ogni tappa ('sentiero' oppure 'retta') e' cio' che permette
// all'interfaccia di segnalare i tratti in linea d'aria, che e' la meta' della richiesta.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { isFiniteNum } = require('../lib/geometry');
const { regionForPoint } = require('../lib/regions');
const { progettaPercorso } = require('../lib/trailGraph');

// Un progetto di escursione ha una manciata di tappe. Il tetto non serve contro l'utente
// ma contro una richiesta costruita apposta: ogni tappa e' una ricerca su un grafo.
const MAX_PUNTI = 25;

router.post('/plan', requireAuth, async (req, res) => {
    try {
        const punti = req.body && req.body.punti;
        if (!Array.isArray(punti) || punti.length < 2) {
            return res.status(400).json({ error: 'Servono almeno due punti per progettare un percorso.' });
        }
        if (punti.length > MAX_PUNTI) {
            return res.status(400).json({ error: `Troppi punti: il massimo e' ${MAX_PUNTI}.` });
        }

        for (const p of punti) {
            if (!Array.isArray(p) || p.length < 2 || !isFiniteNum(p[0]) || !isFiniteNum(p[1])) {
                return res.status(400).json({ error: 'Uno dei punti non ha coordinate valide.' });
            }
            if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) {
                return res.status(400).json({ error: 'Uno dei punti ha coordinate fuori dal mondo.' });
            }
        }

        // Vincolo delle quattro regioni, come per la creazione di un'escursione.
        // Qui si pretende che TUTTI i punti siano dentro, non la maggioranza come per un
        // file .gpx importato: li' la traccia e' un dato registrato che puo' sconfinare da
        // solo su un crinale, qui ogni punto lo sceglie una persona apposta.
        const fuori = punti.findIndex(p => !regionForPoint(p[0], p[1]));
        if (fuori >= 0) {
            return res.status(400).json({
                error: `Il punto numero ${fuori + 1} e' fuori dalle quattro regioni coperte dal sito (Marche, Lazio, Abruzzo, Molise).`
            });
        }

        const esito = await progettaPercorso(punti, {
            agganciaAiSentieri: req.body.agganciaAiSentieri !== false
        });

        res.json(esito);
    } catch (e) {
        console.error('Progettazione percorso fallita:', e);
        res.status(500).json({ error: 'Non e\' stato possibile calcolare il percorso. Riprova.' });
    }
});

module.exports = router;
