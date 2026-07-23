# Camoscio — Note di sviluppo (stato al 2026-07-17)

Riepilogo di cosa è stato fatto in questa sessione, cosa è stato verificato dal vivo nel browser, e cosa resta da controllare o decidere. Scritto per riprendere il lavoro senza dover rileggere tutta la conversazione.

## Stato generale

**Il file `avvia.bat` funziona.** Verificato in questa sessione: `node server.js` si avvia senza errori, il sito risponde su `http://localhost:3000`, tutte le librerie (Leaflet, Chart.js, Lucide, font) si caricano correttamente in locale. Nessun processo di test è rimasto in esecuzione: la porta 3000 è libera.

Tutte le 11 fasi del piano concordato sono state implementate **e verificate dal vivo nel browser** (non solo lette/scritte) — click reali, chiamate API dirette, controllo dei valori calcolati contro calcoli a mano, controllo della console per errori JS. Il dettaglio completo di cosa è stato verificato è nella conversazione originale; qui sotto solo il riepilogo utile per ripartire.

## Cosa è stato corretto/completato (tutto verificato)

1. **Bug critico**: `window.userSimulatedLocation` non era mai assegnato come proprietà di `window` (era una `let` locale) — rompeva silenziosamente Dead Man's Switch e Mesh Networking. Corretto in `public/js/map.js`.
2. **Bug scoperto durante i test, non nel piano originale**: la classe `.hidden` non aveva nessuna regola CSS generica (solo `.modal.hidden`) — banner di emergenza, form, badge KYC ecc. non si nascondevano mai davvero. Aggiunta la regola in `public/css/styles.css`.
3. **Bug scoperto durante i test**: tutti i popup Leaflet (vette, segnalazioni Waze, timbri) impostavano `color: white` sul testo ma Leaflet di default ha sfondo popup bianco → testo invisibile. Aggiunto CSS scuro per `.leaflet-popup-*`.
4. Ambito geografico ristretto a Lazio/Molise/Abruzzo/Marche (vincolo di regione su Leaflet + validazione form + dati seed sostituiti con Corno Grande/Gran Sasso e Monte Vettore/Sibillini, con coordinate verificate via ricerca web dove possibile — vedi nota sotto).
5. Librerie vendorizzate in locale (`public/vendor/`): Leaflet, Chart.js, Lucide, font Inter/Outfit. Il sito funziona anche offline tranne le tile OSM e le chiamate meteo (per natura remote).
6. Pulsante GPS reale aggiunto (Geolocation API), aggiuntivo al marker trascinabile.
7. Bug zaino intelligente (chiave duplicata), carpooling (distanza fissa a 120km), notifica meteo (icona non valida) — tutti corretti.
8. Stato "escursione attiva" condiviso tra Mappa/Zaino/Carpooling/Inviti Squadra (prima ognuno guardava sempre la prima escursione creata).
9. **Tracciamento completamento escursioni** (il vuoto più grande trovato): nuovo endpoint, pulsante "Segna come completata", aggiornamento automatico di passo personale e livello esperienza da dati reali invece che da valori statici.
10. Note vocali nel diario di viaggio (registrazione reale via MediaRecorder, upload, riproduzione) + timeline riorganizzata a scorrimento orizzontale per escursione.
11. Esposizione solare generalizzata (calcolo orientamento reale trailhead→cima) invece di testo fisso per due sole escursioni.
12. Recensioni anonime: limitate ai co-partecipanti di escursioni passate condivise + anti-duplicati con hash non riconducibile (l'anonimato resta totale, verificato che nessun campo identificativo del recensore compare mai nei dati visibili).
13. Verifica KYC collegata a un pulsante vero (prima era codice morto, mai raggiungibile) + layer "esperto locale" costruito da zero (badge, toggle, area) + visualizzazione "chi altro ha salvato questo sentiero".
14. Tutti gli `alert()`/`confirm()`/`prompt()` nativi sostituiti con un sistema toast/modal non bloccante (il più importante: l'allarme del Dead Man's Switch non congela più la pagina).
15. Vocabolario tag Tribù ampliato (Passo Svelto, Generazione Alpha/Z) + filtro multi-selezione con logica AND.
16. Centro notifiche (campanella) per le squadre ricorrenti: notifica automatica quando il capo-squadra crea una nuova escursione, notifica quando una richiesta di iscrizione viene accettata/rifiutata.
17. **Bug trovato e corretto durante la verifica finale**: `refreshState()` veniva chiamato prima di impostare l'utente corrente, quindi al primo caricamento pagina timbri/completamenti/notifiche risultavano sempre vuoti finché non si cliccava altrove. Corretto in `public/js/app.js` (`initApp`).

## Cose da ricontrollare / decisioni ancora aperte

- **Coordinate approssimate da verificare su OpenStreetMap**: Rifugio Franchetti e Rifugio Zilioli (i due rifugi intermedi, non i trailhead/vette principali che sono verificati) hanno coordinate stimate per interpolazione, non verificate puntualmente. Non bloccante per l'uso della demo, ma da controllare se si vuole precisione cartografica reale.
- **Non ho potuto testare fino in fondo il pulsante "Usa la mia posizione reale"** (Fase 3): il permesso di geolocalizzazione del browser è un popup nativo che i miei strumenti di automazione non possono attraversare. Il codice è verificato staticamente e strutturalmente (il bottone esiste, è cliccabile, chiama l'API corretta) ma non ho visto il flusso di permesso completo andare a buon fine con un vero click umano. Vale la pena provarlo una volta manualmente.
- **Registrazione vocale reale**: stessa logica del punto sopra — ho testato l'endpoint di upload e il rendering con un file audio finto (bypassando il microfono reale per non rischiare di bloccare l'automazione su un permesso nativo). La UI del pulsante è verificata, ma una registrazione vocale vera end-to-end (microfono → salvataggio → riproduzione reale) andrebbe provata una volta a mano.
- **Layout responsive/mobile**: non toccato, come da accordo. Il sito resta pensato per schermo desktop fisso (nessuna media query).
- **`data/db.json` attuale**: verrà rigenerato automaticamente pulito al prossimo avvio del server se non esiste già. Se esiste già un `data/db.json` con dati di test vecchi e si vuole ripartire pulito, basta cancellare quel file prima di avviare.
- Idee facoltative rimaste fuori scope (non richieste, solo annotate nel piano originale): geocoding reale (Nominatim) per l'abbinamento carpooling per zona invece dell'euristica testuale attuale; possibilità in futuro di allargare l'ambito geografico oltre le 4 regioni attuali (basta modificare `window.CAMOSCIO_REGION_BOUNDS` in `public/js/map.js`, è l'unico punto).

## File principali toccati

`server.js`, `public/index.html`, `public/css/styles.css`, tutti gli 8 file in `public/js/`, più la nuova cartella `public/vendor/` (librerie) e `public/uploads/` (note vocali, creata automaticamente all'avvio del server).
