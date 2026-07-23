const express = require('express');
const router = express.Router();
const Completion = require('../models/Completion');

// Ottieni le escursioni già segnate come completate da un utente
router.get('/:userId', async (req, res) => {
    try {
        const userCompletions = await Completion.find({ userId: req.params.userId });
        res.json(userCompletions);
    } catch (e) {
        res.json([]);
    }
});

module.exports = router;
