const express = require('express');
const router = express.Router();
const { boundaries } = require('../lib/regions');

// Pubblica (nessun login richiesto), come /api/auth/demo-accounts: serve al frontend per
// disegnare/validare l'ambito geografico reale invece del vecchio rettangolo approssimativo.
router.get('/boundaries', (req, res) => res.json(boundaries));

module.exports = router;
