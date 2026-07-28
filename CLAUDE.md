# Camoscio

App web di escursionismo sociale. Node.js + Express + MongoDB Atlas, frontend vanilla (Leaflet, Chart.js), hosting su Render. Ambito geografico: Lazio, Marche, Abruzzo, Molise.

## Memoria di progetto — LEGGERE PRIMA DI INIZIARE

Il contesto del progetto (vincoli, decisioni già prese, cosa resta da fare, trappole tecniche già pagate) sta in un vault Obsidian nella cartella **sorella** `../camoscio memoria`, non in questo repository.

All'inizio di ogni sessione, leggere in quest'ordine:

1. `../camoscio memoria/00-Indice.md` — mappa delle note
2. `../camoscio memoria/02-Vincoli-Hard.md` — vincoli non negoziabili (spazio MongoDB, RAM Render, open source)
3. `../camoscio memoria/04-Da-Fare.md` — cosa è aperto davvero

Poi, secondo il tipo di lavoro:

- decisioni tecniche → `../camoscio memoria/03-Decisioni-Architetturali.md` (prima di riproporre una scelta, controllare se è già stata presa e perché)
- debug, test, script → `../camoscio memoria/07-Trappole-Tecniche.md` (errori già pagati, non ripagarli)

A fine sessione, aggiornare le note toccate dal lavoro fatto: `04-Da-Fare.md` sempre, `06-Cronologia-Sessioni.md` con una riga nuova, e `03`/`07` solo se è emerso qualcosa che vale la pena ricordare.

## Fonti di dettaglio nel repo

- `cose_da_fare.txt` — il piano: richieste originali, liste di bug per sessione, decisioni con motivazione
- `leggimi.txt` — lo stato attuale, verboso: checklist di avanzamento e sezione "DA DOVE SI RIPARTE" in fondo (la parte più aggiornata)

Il vault distilla questi due file. Se si contraddicono, vince la sezione finale di `leggimi.txt`, che è la più recente.

## Regole di lavoro

- **Vincolo spazio**: MongoDB Atlas gratuito, 512 MB. Campi opzionali con `default: undefined`, mai `default: false`. Niente dati duplicati negli schemi.
- **Vincolo RAM**: Render gratuito, 512 MB. L'indice sentieri in RAM ha già fatto cadere il sito una volta — non caricare dati di routing insieme all'indice principale.
- **Le prove automatiche** stanno in `prove/` con il loro `LEGGIMI-PROVE.txt`. Vanno rilanciate ogni volta che si tocca accessi, password o email.
- **Pulizie di prova sul database**: sempre filtrate per `userId` dell'account di prova, e con dati finti riconoscibili. Una pulizia non filtrata ha già cancellato un dato vero dell'utente.
- **Non promettere a schermo** ciò che il sito non può mantenere (email che potrebbero non partire, SOS satellitare, ecc.).
