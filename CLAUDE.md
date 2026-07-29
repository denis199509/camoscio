# Camoscio

App web di escursionismo sociale. Node.js + Express + MongoDB Atlas, frontend vanilla (Leaflet, Chart.js), hosting su Render. Ambito geografico: Lazio, Marche, Abruzzo, Molise.

## Memoria di progetto — LEGGERE PRIMA DI INIZIARE

**Il vault è la fonte principale** (deciso da Denis il 29/07/2026). Sta in un vault Obsidian nella cartella **sorella** `../camoscio memoria`, non in questo repository — quindi non è pubblico.

All'inizio di ogni sessione, leggere in quest'ordine:

1. `../camoscio memoria/00-Indice.md` — mappa delle note
2. `../camoscio memoria/02-Vincoli-Hard.md` — vincoli non negoziabili (spazio MongoDB, RAM Render, open source)
3. `../camoscio memoria/04-Da-Fare.md` — cosa è aperto davvero
4. `leggimi.txt` — mezza pagina: a che punto siamo e da dove si ricomincia

Poi, secondo il tipo di lavoro:

- decisioni tecniche → `../camoscio memoria/03-Decisioni-Architetturali.md` (prima di riproporre una scelta, controllare se è già stata presa e perché)
- debug, test, script → `../camoscio memoria/07-Trappole-Tecniche.md` (errori già pagati, non ripagarli)

**Non leggere `cronologia.txt` per capire a che punto siamo**: è lungo e serve ad altro (vedi sotto).

## I tre file nel repo, e a cosa servono davvero

- `leggimi.txt` — **solo** «da dove si riparte». Corto per scelta: un file lungo non lo si rilegge quando lo si aggiorna, quindi invecchia senza che nessuno se ne accorga. Se supera un paio di pagine, dentro c'è finito qualcosa che appartiene altrove.
- `cose_da_fare.txt` — le richieste di Denis **con le sue parole**, e il ragionamento di ogni punto chiuso. È l'archivio: cresce, e va bene così.
- `cronologia.txt` — l'ex `leggimi.txt`. Il racconto disteso di ogni lavoro, con le misure. Ci si va per il **dettaglio di qualcosa di già fatto**, non per orientarsi.

**Se due fonti si contraddicono, vince il vault.** Prima del 29/07/2026 vinceva la sezione finale di `leggimi.txt`; quel file era anche l'unico che avesse detto il falso, due volte in una giornata, ed è il motivo per cui è stato diviso.

## Fine sessione

- **sempre**: il vault (`04-Da-Fare.md`, più una riga in `06-Cronologia-Sessioni.md`; `03` e `07` solo se è emerso qualcosa da ricordare) e `leggimi.txt`
- `cronologia.txt` solo se c'è un lavoro nuovo da raccontare
- `cose_da_fare.txt` quando un punto si chiude o ne arriva uno nuovo

Il vault **non è sotto git** (sta solo su disco, dentro OneDrive): a differenza del repo non ha storia delle versioni, quindi va aggiornato con la stessa attenzione con cui si scrive un commit.

## Regole di lavoro

- **Vincolo spazio**: MongoDB Atlas gratuito, 512 MB. Campi opzionali con `default: undefined`, mai `default: false`. Niente dati duplicati negli schemi.
- **Vincolo RAM**: Render gratuito, 512 MB. L'indice sentieri in RAM ha già fatto cadere il sito una volta — non caricare dati di routing insieme all'indice principale.
- **Le prove automatiche** stanno in `prove/` con il loro `LEGGIMI-PROVE.txt`. Vanno rilanciate ogni volta che si tocca accessi, password o email.
- **Pulizie di prova sul database**: sempre filtrate per `userId` dell'account di prova, e con dati finti riconoscibili. Una pulizia non filtrata ha già cancellato un dato vero dell'utente.
- **Non promettere a schermo** ciò che il sito non può mantenere (email che potrebbero non partire, SOS satellitare, ecc.).
