// ==========================================================================
// BADGE PERSONALI — non richiesti in cose_da_fare.txt, chiesti da Denis in sessione
// (01/08/2026): un'onorificenza scelta a mano da Denis, NON guadagnata in nessun modo.
// E' l'opposto dei badge delle vette (badges.js): qui non c'e' nessuna regola, nessun
// geofencing, nessun timbro. L'interfaccia deve dirlo chiaramente - stesso principio
// del vincolo hard 7 ("niente promesse che il sito non puo' mantenere"), qui al
// contrario: niente lasciato intendere come conquistato quando non lo e'.
//
// NIENTE SU MONGODB, di proposito: come i badge delle vette, e' un catalogo fisso che
// non aggiunge informazione che il codice non abbia gia'. Per aggiungerne uno nuovo:
// un'icona in public/img/badge-personali/ + una riga qui sotto. Zero migrazioni.
//
// Chiave: userId di MongoDB (stabile), non username - lo username e' modificabile
// dal proprietario (SELF_EDITABLE_FIELDS in routes/users.js) e romperebbe il
// collegamento. Lo username accanto è solo per leggere il file, non e' usato dal
// codice.
(function () {
    const CATALOGO = {
        "6a62e398a1e019a3d635817d": { // Denis
            icon: "denis-404.png",
            titolo: "Errore 404: Ruolo non trovato",
            descrizione: "Il sistema non è riuscito a identificare il suo contributo. Ma continua a partecipare con successo."
        },
        "6a6320d6e884a400f04418ff": { // DaniWoll
            icon: "daniwoll-merenderos.png",
            titolo: "Merenderos in Vetta",
            descrizione: "Le calorie si recuperano sempre. Il dislivello, purtroppo, va fatto prima."
        },
        "6a6a3c9436f2ea487a64765a": { // Manu er 5 lingue
            icon: "manu-mare.png",
            titolo: "Nostalgia del Mare",
            descrizione: "Sale in montagna solo per controllare se il mare è ancora lì."
        },
        "6a6c53d43e6d711c4b2991f1": { // Matteo Bi
            icon: "matteo-geologo.png",
            titolo: "Paleontologo... Più o Meno",
            descrizione: "Alla ricerca del fossile perfetto. Il gruppo, nel frattempo, lo aspetta qualche curva più avanti."
        },
        "6a798ca12539954e0769bcb2": { // Camilla
            icon: "camilla-flamenco.png",
            titolo: "Non cammina, fa flamenco in salita.",
            descrizione: "Non affronta la salita: la interpreta."
        },
        "6a798f8e2539954e0769bcb4": { // Bob84
            icon: "bob84-pescara.png",
            titolo: "Pescara sopra tutto. Anche sopra i 2000.",
            descrizione: "La quota può cambiare, la fede no. In vetta come allo stadio, sempre biancazzurro."
        },
        "6a7b643da0bc42ac66955583": { // Nicolo97
            icon: "nicolo-football.png",
            titolo: "Fuori sentiero, dentro il football",
            descrizione: "Viene in montagna con noi quando il calendario del football americano glielo permette. Se c’è una partita, la vetta può aspettare. Prima il touchdown, poi il dislivello."
        },
        "6a81e2e4609ba367d0688bc0": { // Scheldon
            icon: "sheldon-mishka.png",
            titolo: "Il Passeggero del Rottweiler",
            descrizione: "Non viene in montagna, è il cane che lo porta."
        },
        "6a880bb1501b7d0f6026fea8": { // gabriele183
            icon: "gabriele183-mare.png",
            titolo: "Il mare lo vede dai 2000 m.",
            descrizione: "Vive a due passi dalla spiaggia, ma considera l'acqua salata un bell'elemento decorativo da osservare esclusivamente con il cannocchiale e le scarpe da trekking ai piedi."
        }
    };

    function get(userId) {
        return CATALOGO[userId] || null;
    }

    window.CamoscioPersonalBadges = { get };
})();
