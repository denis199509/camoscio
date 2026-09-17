"use strict";

// Estratto da diagnostica-gps.html (CSP/header di sicurezza, tappa 1, 52a sessione) - script
// inline spostato qui senza modifiche di comportamento, per poter attivare script-src 'self'
// senza 'unsafe-inline'. Non e' in una IIFE: var, non const (come le altre pagine autonome).
// Ripiego a funzione-che-torna-null: se i18n.js non c'e', la pagina resta IT.
var T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };

// Decimali dei secondi: virgola in italiano, punto in inglese - come
// decimaleMeteo (weather.js) e numTracc (tracking.js) nel resto del punto 102.
function numLoc(n) {
    var s = n.toFixed(1);
    var lang = (window.CamoscioI18n && window.CamoscioI18n.getLang && window.CamoscioI18n.getLang()) || 'it';
    return lang === 'en' ? s : s.replace('.', ',');
}

// Raccoglie tutto quello che si scopre, cosi' il pulsante "Copia il rapporto" puo'
// ricostruire un testo unico da incollare. Senza, l'unica alternativa sarebbe
// chiedere all'utente di ricopiare a mano dei messaggi tecnici da uno schermo da
// telefono - cioe' non ottenerli mai.
const esiti = {};

function scrivi(id, testo, classePallino) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    if (classePallino) {
        const pallino = document.createElement("span");
        pallino.className = "pallino " + classePallino;
        el.appendChild(pallino);
    }
    // textContent, non innerHTML: i messaggi d'errore arrivano dal browser e non c'e'
    // ragione di trattarli come HTML (stessa regola applicata in Fase H a tutto il sito).
    el.appendChild(document.createTextNode(testo));
}

// I codici dell'API sono tre e hanno rimedi OPPOSTI: confonderli e' esattamente
// l'errore che l'app faceva prima (un solo messaggio per tutti i casi).
function nomeCodice(code) {
    if (code === 1) return T('diag.js.code1') || "1 — PERMISSION_DENIED (permesso negato)";
    if (code === 2) return T('diag.js.code2') || "2 — POSITION_UNAVAILABLE (posizione non calcolabile)";
    if (code === 3) return T('diag.js.code3') || "3 — TIMEOUT (tempo scaduto)";
    return String(code);
}

function posizioneUnaVolta(opzioni) {
    return new Promise(resolve => {
        const partenza = Date.now();
        if (!navigator.geolocation) {
            resolve({ ok: false, code: null, message: T('diag.js.apiNonDisp') || "API non disponibile", ms: 0 });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({
                ok: true,
                precisione: pos.coords.accuracy,
                altitudine: pos.coords.altitude,
                ms: Date.now() - partenza
            }),
            err => resolve({
                ok: false,
                code: err.code,
                message: err.message || T('diag.js.nessunMsg') || "(nessun messaggio)",
                ms: Date.now() - partenza
            }),
            opzioni
        );
    });
}

async function diagnosi() {
    const btn = document.getElementById("btn-avvia");
    btn.disabled = true;
    btn.textContent = T('diag.js.btnInCorso') || "Diagnosi in corso… (circa 1 minuto)";

    // --- 1. La pagina ---
    esiti.secure = window.isSecureContext;
    scrivi("r-secure",
           esiti.secure ? (T('diag.js.si') || "sì") : (T('diag.js.noHttps') || "NO — il GPS è vietato senza https"),
           esiti.secure ? "p-ok" : "p-ko");

    esiti.origin = location.origin;
    scrivi("r-origin", esiti.origin);

    esiti.api = !!navigator.geolocation;
    scrivi("r-api", esiti.api ? (T('diag.js.presente') || "presente") : (T('diag.js.assente') || "ASSENTE"), esiti.api ? "p-ok" : "p-ko");

    // Su Safari/iOS query() SOLLEVA un'eccezione invece di rispondere: 'geolocation' non
    // e' un nome valido li'. Va sempre avvolta, altrimenti la diagnosi si pianta proprio
    // sul telefono su cui serve. (Stessa trappola gia' documentata in geolocation.js.)
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const p = await navigator.permissions.query({ name: "geolocation" });
            esiti.permesso = p.state;
            const etichette = {
                granted: T('diag.js.permGranted') || "consentito",
                denied: T('diag.js.permDenied') || "NEGATO",
                prompt: T('diag.js.permPrompt') || "da chiedere"
            };
            const pallini = { granted: "p-ok", denied: "p-ko", prompt: "p-warn" };
            scrivi("r-perm", etichette[p.state] || p.state, pallini[p.state] || "p-warn");
        } else {
            esiti.permesso = "non-interrogabile";
            scrivi("r-perm", T('diag.js.permMuto') || "il browser non lo dice (normale su iPhone)", "p-warn");
        }
    } catch (e) {
        esiti.permesso = "non-interrogabile";
        scrivi("r-perm", T('diag.js.permMuto') || "il browser non lo dice (normale su iPhone)", "p-warn");
    }

    // --- 2. Alta precisione ---
    // Stesse identiche opzioni dell'app (geolocation.js, OPZIONI_GPS): se qui funziona
    // e nell'app no, allora il difetto e' nell'app e non nel telefono. maximumAge:0 e'
    // l'unica differenza, ed e' voluta: una posizione riciclata dalla cache direbbe
    // "tutto a posto" anche con il GPS spento un minuto fa.
    scrivi("r-alta", T('diag.js.inCorso20') || "in corso… (fino a 20 secondi)", "p-attesa");
    const alta = await posizioneUnaVolta({ enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    esiti.alta = alta;
    if (alta.ok) {
        scrivi("r-alta", T('diag.js.posOttenuta') || "posizione ottenuta", "p-ok");
        scrivi("r-alta-msg", (T('diag.js.precisione') || "precisione") + " " + Math.round(alta.precisione) + " " + (T('diag.js.metri') || "metri"));
    } else {
        scrivi("r-alta", (T('diag.js.errore') || "errore") + " " + nomeCodice(alta.code), "p-ko");
        scrivi("r-alta-msg", alta.message);
    }
    scrivi("r-alta-tempo", numLoc(alta.ms / 1000) + " " + (T('diag.js.secondi') || "secondi"));

    // --- 3. Bassa precisione ---
    // Il discriminante piu' utile di tutta la pagina. Se l'alta fallisce e la bassa
    // riesce, il permesso c'e' e il problema e' solo che i satelliti non si vedono
    // (al chiuso, sotto il bosco, in valle stretta). Se falliscono ENTRAMBE con il
    // codice 2 e in pochi decimi di secondo, non c'e' nessuna fonte di posizione
    // accesa: e' l'interruttore generale del telefono, non il sito.
    scrivi("r-bassa", T('diag.js.inCorso15') || "in corso… (fino a 15 secondi)", "p-attesa");
    const bassa = await posizioneUnaVolta({ enableHighAccuracy: false, maximumAge: 0, timeout: 15000 });
    esiti.bassa = bassa;
    if (bassa.ok) {
        scrivi("r-bassa", T('diag.js.posOttenuta') || "posizione ottenuta", "p-ok");
        scrivi("r-bassa-msg", (T('diag.js.precisione') || "precisione") + " " + Math.round(bassa.precisione) + " " + (T('diag.js.metri') || "metri"));
    } else {
        scrivi("r-bassa", (T('diag.js.errore') || "errore") + " " + nomeCodice(bassa.code), "p-ko");
        scrivi("r-bassa-msg", bassa.message);
    }
    scrivi("r-bassa-tempo", numLoc(bassa.ms / 1000) + " " + (T('diag.js.secondi') || "secondi"));

    // --- 4. Inseguimento continuo ---
    scrivi("r-watch", T('diag.js.inCorsoWatch') || "in corso… (20 secondi)", "p-attesa");
    const watch = await provaWatch(20000);
    esiti.watch = watch;
    scrivi("r-watch", watch.fix + " " + (T('diag.js.posizioniIn20') || "posizioni in 20 secondi"), watch.fix > 0 ? "p-ok" : "p-ko");
    scrivi("r-watch-prec", watch.miglioreP === null ? "—" : Math.round(watch.miglioreP) + " " + (T('diag.js.metri') || "metri"));
    scrivi("r-watch-err", watch.errori.length ? watch.errori.join(" · ") : (T('diag.js.nessuno') || "nessuno"));

    // --- 5. Telefono ---
    esiti.ua = navigator.userAgent;
    scrivi("r-ua", navigator.userAgent);
    esiti.schermo = window.innerWidth + "×" + window.innerHeight;
    scrivi("r-schermo", esiti.schermo + " " + (T('diag.js.punti') || "punti"));

    mostraVerdetto();

    btn.textContent = T('diag.js.btnRipeti') || "Ripeti la diagnosi";
    btn.disabled = false;
    document.getElementById("btn-copia").style.display = "block";
}

function provaWatch(durataMs) {
    return new Promise(resolve => {
        const risultato = { fix: 0, miglioreP: null, errori: [] };
        if (!navigator.geolocation) { resolve(risultato); return; }

        const id = navigator.geolocation.watchPosition(
            pos => {
                risultato.fix++;
                if (risultato.miglioreP === null || pos.coords.accuracy < risultato.miglioreP) {
                    risultato.miglioreP = pos.coords.accuracy;
                }
            },
            err => {
                const testo = (T('diag.js.codice') || "codice") + " " + err.code;
                // Un errore ripetuto e' lo stesso errore: elencarlo trenta volte
                // riempirebbe lo schermo senza aggiungere niente.
                if (!risultato.errori.includes(testo)) risultato.errori.push(testo);
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );

        setTimeout(() => {
            navigator.geolocation.clearWatch(id);
            resolve(risultato);
        }, durataMs);
    });
}

// Il verdetto e' la parte che conta: senza, resterebbe una pagina di numeri che
// l'utente deve interpretare da solo. Ogni ramo dice CHE COSA fare, non solo cosa
// e' andato storto.
function mostraVerdetto() {
    const box = document.getElementById("verdetto");
    const testo = document.getElementById("verdetto-testo");
    const alta = esiti.alta, bassa = esiti.bassa;
    let html = "";
    let classe = "esito-warn";

    if (!esiti.secure) {
        classe = "esito-ko";
        html = T('diag.verd.noSecure') ||
               ("<p><strong>La pagina non è su una connessione sicura.</strong> I browser vietano il GPS a qualunque pagina aperta in <code>http</code>, e rispondono comunque «permesso negato». Non è un blocco che hai messo tu.</p>" +
                "<p>Apri <code>https://camoscio.onrender.com/diagnostica-gps.html</code> e riprova.</p>");
    }
    else if (!esiti.api) {
        classe = "esito-ko";
        html = T('diag.verd.noApi') ||
               "<p><strong>Questo browser non ha la geolocalizzazione.</strong> È molto raro: prova con Chrome o Safari aggiornati.</p>";
    }
    else if (alta.ok || bassa.ok) {
        classe = "esito-ok";
        html = T('diag.verd.okBase') ||
               "<p><strong>Il telefono la posizione ce l'ha.</strong> Permessi a posto: da qui in poi il puntino blu deve comparire.</p>";
        if (!alta.ok && bassa.ok) {
            html += T('diag.verd.okSoloBassa') ||
                    "<p>Nota: ha funzionato solo la posizione approssimativa. Vuol dire che il <strong>GPS non vede i satelliti</strong> — succede al chiuso, sotto il bosco fitto o in una valle stretta. All'aperto migliora da sola. L'app ora ripiega su questa stima invece di non mostrarti niente, e disegna il cerchio dell'imprecisione attorno al puntino.</p>";
        }
        html += T('diag.verd.okEnd') ||
                "<p>Se nell'app il puntino ancora non si vede mentre <em>qui</em> la posizione arriva, allora il difetto è nell'app: riferiscilo insieme a questo rapporto.</p>";
    }
    else if (alta.code === 1 || bassa.code === 1) {
        classe = "esito-ko";
        html = (T('diag.verd.bloccato') ||
                "<p><strong>Il permesso è bloccato dal browser</strong> (codice 1). Una pagina web, una volta bloccata, non può più richiederlo da sola: va riaperto a mano.</p>") + guidaSblocco();
    }
    else if ((alta.code === 2 && bassa.code === 2) && alta.ms < 3000 && bassa.ms < 3000) {
        // Il caso piu' frequente su Android, e quello che l'app spiegava MALE: diceva
        // "prova all'aperto" mandando fuori casa qualcuno che aveva solo l'interruttore
        // della posizione spento. Il segnale sono i tempi: un rifiuto immediato non e'
        // un GPS che ci prova e non ce la fa, e' un telefono che non ha nessuna fonte
        // di posizione accesa da interrogare.
        classe = "esito-ko";
        html = T('diag.verd.nessunaFonte') ||
               ("<p><strong>Nessuna fonte di posizione è accesa sul telefono</strong> (codice 2, e la risposta è arrivata subito: il telefono non ci ha nemmeno provato).</p>" +
                "<p>Il permesso del sito può risultare «consentito» e non cambiare niente: sotto ci sono altri due livelli, e ne basta uno chiuso. È esattamente ciò che segnala il <strong>triangolo di avviso</strong> che Chrome mette accanto al permesso.</p>" +
                "<ol>" +
                "<li><strong>Posizione del dispositivo</strong> — scorri in giù la tendina delle impostazioni rapide e controlla che l'icona <em>Posizione</em> sia accesa. Oppure: Impostazioni Android → Posizione. <strong>È il sospetto numero uno</strong> quando gli altri due risultano già a posto.</li>" +
                "<li><strong>Permesso dell'app Chrome</strong> — Impostazioni → App → Chrome → Autorizzazioni → Posizione → «Consenti solo mentre l'app è in uso», e verifica che <em>Usa posizione precisa</em> sia attivo.</li>" +
                "<li><strong>Risparmio energetico</strong> — se è attivo, su molti telefoni spegne il GPS. Disattivalo e riprova.</li>" +
                "</ol>" +
                "<p>Scorciatoia: tocca direttamente il triangolo di avviso nel pannello del lucchetto. Chrome dice lì che cosa gli manca e apre le impostazioni giuste.</p>");
    }
    else if (alta.code === 3 && bassa.code === 3) {
        html = T('diag.verd.timeout') ||
               ("<p><strong>Il permesso c'è, ma nessuna posizione è arrivata in tempo</strong> (codice 3 su entrambe le prove).</p>" +
                "<p>Al primo aggancio della giornata, da fermo e al chiuso, può volerci più di un minuto. Rifai la prova <strong>all'aperto con il cielo in vista</strong>: è la condizione in cui il sito viene usato davvero.</p>");
    }
    else {
        const ca = (alta.code !== null && alta.code !== undefined) ? alta.code : "?";
        const cb = (bassa.code !== null && bassa.code !== undefined) ? bassa.code : "?";
        html = (T('diag.verd.altro', ca, cb) ||
                ("<p><strong>Il permesso non risulta bloccato, ma la posizione non arriva</strong> (codice " +
                 ca + " ad alta precisione, codice " + cb + " approssimativa).</p>" +
                 "<p>Rifai la prova all'aperto. Se anche fuori resta così, controlla i tre livelli:</p>")) + guidaSblocco();
    }

    testo.innerHTML = html;
    box.className = "card " + classe;
    box.style.display = "block";
    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Nomina Android e iPhone tutti e due, mettendo per primo quello in uso: dall'interno
// del browser il caso "sito bloccato" e quello "localizzazione spenta per il browser"
// sono INDISTINGUIBILI, quindi indovinare sarebbe peggio che elencare.
function guidaSblocco() {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const android = T('diag.guida.android') ||
        ("<p><strong>Android (Chrome)</strong></p><ol>" +
        "<li>Tendina delle impostazioni rapide → <em>Posizione</em> accesa</li>" +
        "<li>Impostazioni Android → App → Chrome → Autorizzazioni → Posizione → consentita, con <em>posizione precisa</em> attiva</li>" +
        "<li>Nel sito: lucchetto accanto all'indirizzo → Autorizzazioni → Posizione → Consenti</li>" +
        "</ol>");
    const ios = T('diag.guida.ios') ||
        ("<p><strong>iPhone / iPad (Safari)</strong></p><ol>" +
        "<li>Impostazioni iOS → Privacy e sicurezza → Localizzazione: accesa</li>" +
        "<li>Nella stessa schermata, in fondo: Safari → «Durante l'uso dell'app» <em>(è il caso più frequente, e dal sito non si può distinguere dal successivo)</em></li>" +
        "<li>Nel sito: «aA» nella barra dell'indirizzo → Impostazioni sito web → Posizione → Consenti</li>" +
        "</ol>");
    const ricarica = T('diag.guida.ricarica') || "<p>Poi ricarica la pagina.</p>";
    return (iOS ? ios + android : android + ios) + ricarica;
}

function componiRapporto() {
    const r = [];
    r.push("=== CAMOSCIO - DIAGNOSI GPS ===");
    r.push("Data: " + new Date().toISOString());
    r.push("Indirizzo: " + esiti.origin);
    r.push("Connessione sicura: " + (esiti.secure ? "si" : "NO"));
    r.push("API geolocalizzazione: " + (esiti.api ? "presente" : "ASSENTE"));
    r.push("Permesso secondo il browser: " + esiti.permesso);
    r.push("");
    r.push("ALTA PRECISIONE: " + (esiti.alta.ok
        ? "OK, precisione " + Math.round(esiti.alta.precisione) + " m"
        : "ERRORE codice " + esiti.alta.code + " - " + esiti.alta.message));
    r.push("  tempo: " + (esiti.alta.ms / 1000).toFixed(1) + " s");
    r.push("APPROSSIMATA: " + (esiti.bassa.ok
        ? "OK, precisione " + Math.round(esiti.bassa.precisione) + " m"
        : "ERRORE codice " + esiti.bassa.code + " - " + esiti.bassa.message));
    r.push("  tempo: " + (esiti.bassa.ms / 1000).toFixed(1) + " s");
    r.push("WATCH 20s: " + esiti.watch.fix + " posizioni, precisione migliore " +
        (esiti.watch.miglioreP === null ? "-" : Math.round(esiti.watch.miglioreP) + " m") +
        ", errori: " + (esiti.watch.errori.join(" ") || "nessuno"));
    r.push("");
    r.push("Browser: " + esiti.ua);
    r.push("Schermo: " + esiti.schermo);
    r.push("(nessuna coordinata inclusa, di proposito)");
    return r.join("\n");
}

document.getElementById("btn-avvia").addEventListener("click", diagnosi);

document.getElementById("btn-copia").addEventListener("click", async () => {
    const btn = document.getElementById("btn-copia");
    const testo = componiRapporto();
    try {
        await navigator.clipboard.writeText(testo);
        btn.textContent = T('diag.js.copiato') || "Copiato ✓";
    } catch (e) {
        // navigator.clipboard non c'e' sempre (serve https, e su qualche browser
        // vecchio manca del tutto): meglio mostrare il testo da selezionare a mano
        // che lasciare un pulsante che non fa niente.
        const area = document.createElement("textarea");
        area.value = testo;
        area.style.cssText = "width:100%;height:220px;margin-bottom:10px;font-size:0.8rem;background:#14150F;color:#F3EFE6;border:1px solid rgba(243,239,230,0.12);border-radius:8px;padding:8px;";
        btn.parentNode.insertBefore(area, btn.nextSibling);
        area.select();
        btn.textContent = T('diag.js.copiaMano') || "Copia a mano il testo qui sotto";
    }
    setTimeout(() => { btn.textContent = T('diag.btnCopia') || "Copia il rapporto"; }, 4000);
});
