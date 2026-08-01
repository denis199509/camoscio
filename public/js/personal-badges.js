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
        }
    };

    function get(userId) {
        return CATALOGO[userId] || null;
    }

    window.CamoscioPersonalBadges = { get };
})();
