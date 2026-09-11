// ==========================================================================
// SECONDO FATTORE TOTP (2FA "Google Authenticator") - blocco 6 del piano
// C:\Users\lenovo\.claude\plans\camoscio-2fa-totp.md
//
// La card "Sicurezza" in Impostazioni (#settings-2fa-card). Quattro stati che si
// alternano con [hidden] - spento / configurazione / acceso / (codici) - piu' il
// riquadro d'allarme "recupero in corso", gemello DENTRO la pagina del banner
// globale (blocco 7).
//
// IIFE come badges.js: dentro, "const T" e' locale e non collide con il "var T"
// degli altri file (vedi la nota in cima a i18n.js). Espone
// window.renderTwoFactorCard(usr), chiamata da renderSettingsPage() (profile.js).
//
// BACKEND gia' in produzione e finora inerte: blocchi 3-4-5. Da qui si accende.
// I 4 account demo sono nascosti (card [hidden]) e comunque il server rifiuta ogni
// /2fa/* su un demo (403).
// ==========================================================================
(function () {
    'use strict';

    const T = (window.CamoscioI18n && window.CamoscioI18n.t) || function () { return null; };
    const $ = (id) => document.getElementById(id);

    // Segreto PROVVISORIO ottenuto da /2fa/setup in questa sessione, prima della conferma.
    // Vive solo in memoria: se si ricarica la pagina si riparte da /2fa/setup (che e'
    // idempotente lato server per 15 minuti, quindi restituira' lo stesso segreto).
    let segretoInAttesa = null;
    // Gli ultimi 10 codici di recupero mostrati (per Copia / Scarica). Mai riletti dal server.
    let codiciCorrenti = [];

    function mostraSolo(idVisibile) {
        // Se i codici di recupero erano visibili e si passa a un altro stato, si svuotano
        // (revisione del cumulativo 42a, BASSO): restavano nel DOM e in codiciCorrenti anche
        // dopo aver lasciato la sezione senza premere "Ho finito" - il progetto non ha CSP,
        // quindi non c'e' una seconda rete, ma restano comunque materiale mostrato in chiaro
        // una volta sola e non dovrebbero sopravvivere oltre la sezione che li mostra.
        const codiciEl = $('tfa-codici');
        if (codiciEl && !codiciEl.hidden && idVisibile !== 'tfa-codici') svuotaCodici();
        for (const id of ['tfa-stato-spento', 'tfa-configurazione', 'tfa-stato-acceso', 'tfa-codici']) {
            const el = $(id);
            if (el) el.hidden = (id !== idVisibile);
        }
    }
    function svuotaCodici() {
        codiciCorrenti = [];
        const ol = $('tfa-codici-lista');
        if (ol) ol.innerHTML = '';
    }
    function mostraErrore(id, testo) {
        const el = $(id);
        if (!el) return;
        el.textContent = testo || '';
        el.hidden = !testo;
    }
    function dataItaliana(iso) {
        try {
            // Locale secondo la lingua corrente + timeZone esplicito (revisione del cumulativo
            // 42a, cluster i18n): prima era 'it-IT' fisso anche con l'interfaccia in inglese, e
            // senza timeZone si leggeva il fuso del dispositivo - la trappola UTC/ora locale.
            const loc = (window.CamoscioI18n && window.CamoscioI18n.getLang() === 'en') ? 'en-GB' : 'it-IT';
            return new Date(iso).toLocaleString(loc, {
                timeZone: 'Europe/Rome',
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch { return String(iso); }
    }

    async function chiedi(metodo, url, corpo) {
        const r = await fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: corpo ? JSON.stringify(corpo) : undefined
        });
        let dati = null;
        try { dati = await r.json(); } catch { /* vuoto */ }
        return { ok: r.ok, status: r.status, dati: dati || {} };
    }

    // ---- Render -----------------------------------------------------------------

    async function renderTwoFactorCard(usr) {
        const card = $('settings-2fa-card');
        if (!card) return;
        // Nascosta ai demo (condivisi, senza password): un 2FA acceso su un demo bloccherebbe
        // /demo per chiunque, in modo definitivo. Riga gia' usata due volte (profile.js, app.js).
        card.classList.toggle('hidden', !usr || !!usr.isDemoAccount);
        if (!usr || usr.isDemoAccount) return;

        if (!card.dataset.collegato) {
            card.dataset.collegato = '1';
            collegaEventi();
        }

        // Stato del recupero ritardato: rotta a se' (NON un campo di currentUser, che
        // refreshState rimpiazzerebbe perdendolo - la trappola di profilePhoto).
        let recupero = null;
        try {
            const r = await fetch('/api/auth/recovery/status');
            if (r.ok) recupero = await r.json();
        } catch { /* rete assente: il riquadro semplicemente non compare */ }

        const alert = $('tfa-recupero-in-corso');
        if (alert) {
            const inSospeso = !!(recupero && recupero.inSospeso);
            alert.hidden = !inSospeso;
            if (inSospeso) {
                $('tfa-recupero-testo').textContent = ' ' + (T('settings.recuperoTesto') ||
                    'Qualcuno ha chiesto di rientrare nel tuo account senza il codice del secondo fattore. Si completa il ')
                    + dataItaliana(recupero.maturaIl) + '. '
                    + (T('settings.recuperoTestoFine') || 'Se non sei stato tu, annullalo adesso.');
            }
        }

        if (usr.twoFactorEnabledAt) {
            const dal = $('tfa-attivo-dal');
            if (dal) {
                dal.classList.add('tfa-attivo-dal');
                dal.textContent = (T('settings.2faAttivoDal') || 'Secondo fattore attivo dal ') + dataItaliana(usr.twoFactorEnabledAt) + '.';
            }
            mostraSolo('tfa-stato-acceso');
            chiudiFormCred();
            aggiornaCodiciRimasti();
        } else if (segretoInAttesa) {
            mostraSolo('tfa-configurazione');
        } else {
            mostraSolo('tfa-stato-spento');
        }

        if (window.lucide) window.lucide.createIcons();
    }
    window.renderTwoFactorCard = renderTwoFactorCard;

    // MEDIO-5 (revisione del cumulativo 42a): quanti codici di recupero restano, mostrato
    // SEMPRE (non solo appena dopo averne usato uno in app.js) cosi' la scorta in calo si
    // scopre in Impostazioni prima di perdere anche il telefono. Fetch dedicato a /me, MAI
    // usr.recoveryCodesRimasti: usr e' currentUser, che refreshState() rimpiazza con
    // GET /api/users (che questo campo non porta) - la trappola di profilePhoto, gia' pagata
    // due volte su questo progetto (MEDIO 31a, B-5 32a).
    async function aggiornaCodiciRimasti() {
        const el = $('tfa-codici-rimasti');
        if (!el) return;
        try {
            const r = await fetch('/api/auth/me');
            if (!r.ok) return;
            const dati = await r.json();
            if (typeof dati.recoveryCodesRimasti !== 'number') { el.textContent = ''; return; }
            const n = dati.recoveryCodesRimasti;
            const modello = n <= 2
                ? (T('settings.2faCodiciRimastiPochi') || 'Attenzione: solo {n} codici di recupero rimasti.')
                : (T('settings.2faCodiciRimasti') || '{n} codici di recupero rimasti.');
            el.textContent = modello.replace('{n}', String(n));
            el.classList.toggle('tfa-error', n <= 2);
        } catch { /* rete assente: il badge semplicemente non compare */ }
    }

    // Il cambio lingua re-renderizza le parti scritte da JS (data, testo del riquadro),
    // ma solo se la pagina Impostazioni e' visibile - i data-i18n statici li fa i18n.js.
    if (window.CamoscioI18n && window.CamoscioI18n.onChange) {
        window.CamoscioI18n.onChange(() => {
            const sez = $('settings');
            const usr = window.CamoscioState && window.CamoscioState.currentUser;
            if (usr && sez && !sez.classList.contains('hidden')) renderTwoFactorCard(usr);
        });
    }

    // Se la scheda perde il focus (cambio app, blocco schermo) mentre i codici di recupero
    // sono a schermo, si svuotano subito (revisione del cumulativo 42a, BASSO): un telefono
    // sbloccato lasciato a se' stesso non deve continuare a mostrare 10 codici a chi lo trova.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        const codiciEl = $('tfa-codici');
        if (codiciEl && !codiciEl.hidden) svuotaCodici();
    });

    // ---- Azioni ---------------------------------------------------------------

    async function avviaConfigurazione() {
        const btn = $('tfa-btn-attiva');
        if (btn) btn.disabled = true;
        try {
            const { ok, dati } = await chiedi('POST', '/api/auth/2fa/setup', {});
            if (!ok) {
                window.showToast(dati.error || (T('settings.2faErroreGenerico') || 'Non è stato possibile avviare la configurazione.'), 'error');
                return;
            }
            segretoInAttesa = dati.segreto;
            $('tfa-secret').textContent = dati.segreto;
            disegnaQr(dati.uri, dati.segreto);
            mostraErrore('tfa-configurazione-err', '');
            const inp = $('tfa-verify-code');
            if (inp) inp.value = '';
            const pwdInp = $('tfa-verify-pwd');
            if (pwdInp) pwdInp.value = '';
            mostraSolo('tfa-configurazione');
        } catch {
            window.showToast(T('common.erroreRete') || 'Impossibile contattare il server.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function disegnaQr(uri, segreto) {
        const box = $('tfa-qr');
        if (!box) return;
        // Ripiego se il vendor QR non ha caricato: si mostra la chiave a mano, il pannello
        // non si rompe (il QR e' comodita', non il meccanismo).
        if (!window.qrcode) {
            box.innerHTML = '<p class="small">' + (window.escapeHtml
                ? window.escapeHtml(T('settings.2faQrNonDisponibile') || 'Non riesco a disegnare il QR: inserisci la chiave qui sotto a mano nella tua app.')
                : 'Inserisci la chiave a mano.') + '</p>';
            return;
        }
        try {
            const qr = window.qrcode(0, 'M');      // typeNumber 0 = auto; correzione media
            qr.addData(uri);                        // otpauth:// URI: ASCII puro (lib/totp.js lo percent-codifica)
            qr.make();
            // niente `margin`: cosi' createSvgTag usa il suo default (cellSize*4 = 4 moduli
            // di zona di rispetto), quello che il piano chiede. Un margin esplicito piccolo
            // darebbe una zona muta sotto un modulo e alcune fotocamere non aggancerebbero.
            box.innerHTML = qr.createSvgTag({ cellSize: 5 });
        } catch (e) {
            box.innerHTML = '<p class="small">' + (T('settings.2faQrNonDisponibile') || 'Inserisci la chiave qui sotto a mano.') + '</p>';
            void segreto; void e;
        }
    }

    async function verificaEAttiva() {
        const pwdInp = $('tfa-verify-pwd');
        const password = pwdInp ? pwdInp.value : '';
        const inp = $('tfa-verify-code');
        const code = inp ? inp.value.replace(/\D+/g, '') : '';
        // Password richiesta anche qui, non solo su disattiva/rigenera (revisione del
        // cumulativo 42a, MEDIO-2): senza, una sessione aperta rubata poteva accendere il
        // 2FA contro il proprietario e chiuderlo fuori per 14 giorni (recupero ritardato).
        if (!password) {
            mostraErrore('tfa-configurazione-err', T('settings.2faPwdRichiesta') || 'Inserisci la password.');
            return;
        }
        if (code.length !== 6) {
            mostraErrore('tfa-configurazione-err', T('settings.2faCodice6') || 'Il codice ha 6 cifre.');
            return;
        }
        const btn = $('tfa-btn-verifica');
        if (btn) btn.disabled = true;
        try {
            const { ok, dati } = await chiedi('POST', '/api/auth/2fa/enable', { password, code });
            if (!ok) {
                let msg = dati.error || (T('settings.2faCodiceNonValido') || 'Codice non valido.');
                if (typeof dati.scartoMinuti === 'number' && dati.scartoMinuti !== 0) {
                    const verso = dati.scartoMinuti < 0
                        ? (T('settings.2faOrologioIndietro') || "indietro")
                        : (T('settings.2faOrologioAvanti') || "avanti");
                    msg += ' ' + (T('settings.2faOrologioSfasato') ||
                        `L'orologio del telefono sembra ${verso} di circa ${Math.abs(dati.scartoMinuti)} minuti: sincronizzalo e riprova.`)
                        .replace('{verso}', verso).replace('{min}', String(Math.abs(dati.scartoMinuti)));
                }
                mostraErrore('tfa-configurazione-err', msg);
                return;
            }
            segretoInAttesa = null;
            if (pwdInp) pwdInp.value = '';
            mostraCodici(dati.recoveryCodes || []);
            window.showToast(T('settings.2faAttivato') || 'Secondo fattore attivo.', 'success');
        } catch {
            mostraErrore('tfa-configurazione-err', T('common.erroreRete') || 'Impossibile contattare il server.');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function mostraCodici(codici) {
        codiciCorrenti = Array.isArray(codici) ? codici : [];
        const ol = $('tfa-codici-lista');
        if (ol) ol.innerHTML = codiciCorrenti.map(c => `<li>${window.escapeHtml ? window.escapeHtml(c) : c}</li>`).join('');
        const chk = $('tfa-codici-salvati');
        if (chk) chk.checked = false;
        const fatto = $('tfa-btn-codici-fatto');
        if (fatto) fatto.disabled = true;
        mostraSolo('tfa-codici');
    }

    async function chiudiCodici() {
        mostraCodici([]);           // svuota (non li rileggeremo mai)
        if (window.refreshState) await window.refreshState();
        renderTwoFactorCard(window.CamoscioState && window.CamoscioState.currentUser);
    }

    // Form credenziali condiviso da "Disattiva" e "Genera nuovi codici".
    function apriFormCred(modo) {
        const form = $('tfa-cred-form');
        if (!form) return;
        form.dataset.modo = modo;
        const lbl = $('tfa-cred-code-label');
        if (lbl) {
            lbl.textContent = modo === 'disable'
                ? (T('settings.2faCodiceAppORecupero') || "Codice dell'app (oppure un codice di recupero):")
                : (T('settings.2faCodiceApp') || "Codice dell'app:");
        }
        $('tfa-cred-pwd').value = '';
        $('tfa-cred-code').value = '';
        mostraErrore('tfa-cred-err', '');
        form.hidden = false;
    }
    function chiudiFormCred() {
        const form = $('tfa-cred-form');
        if (form) { form.hidden = true; form.dataset.modo = ''; }
    }

    async function confermaCred() {
        const form = $('tfa-cred-form');
        const modo = form ? form.dataset.modo : '';
        const password = $('tfa-cred-pwd').value;
        const grezzo = $('tfa-cred-code').value.trim();
        if (!password) { mostraErrore('tfa-cred-err', T('settings.2faServePwd') || 'Serve la password.'); return; }
        if (!grezzo) { mostraErrore('tfa-cred-err', T('settings.2faServeCodice') || 'Serve un codice.'); return; }

        // 6 cifre -> codice TOTP; altrimenti -> codice di recupero (solo per "disable": la
        // rigenerazione pretende il TOTP, D-3, e il server rifiuta comunque un recovery code).
        const soloCifre = grezzo.replace(/\D+/g, '');
        const corpo = { password };
        if (soloCifre.length === 6) corpo.code = soloCifre;
        else corpo.recoveryCode = grezzo;

        const url = modo === 'disable' ? '/api/auth/2fa/disable' : '/api/auth/2fa/recovery-codes';
        const btn = $('tfa-btn-cred-conferma');
        if (btn) btn.disabled = true;
        try {
            const { ok, dati } = await chiedi('POST', url, corpo);
            if (!ok) {
                mostraErrore('tfa-cred-err', dati.error || (T('settings.2faCredNonValide') || 'Password o codice non validi.'));
                return;
            }
            chiudiFormCred();
            if (modo === 'disable') {
                window.showToast(T('settings.2faDisattivato') || 'Secondo fattore disattivato.', 'success');
                if (window.refreshState) await window.refreshState();
                renderTwoFactorCard(window.CamoscioState && window.CamoscioState.currentUser);
            } else {
                mostraCodici(dati.recoveryCodes || []);
                window.showToast(T('settings.2faCodiciRigenerati') || 'Nuovi codici di recupero generati: i vecchi non funzionano più.', 'success');
            }
        } catch {
            mostraErrore('tfa-cred-err', T('common.erroreRete') || 'Impossibile contattare il server.');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function annullaRecupero() {
        const btn = $('tfa-btn-annulla-recupero');
        if (btn) btn.disabled = true;
        try {
            const { ok, dati } = await chiedi('POST', '/api/auth/recovery/cancel', {});
            if (!ok) {
                window.showToast(dati.error || (T('settings.recuperoAnnullaErrore') || "Non c'è nessun recupero da annullare."), 'error');
                return;
            }
            // Chi ha avviato quel recupero aveva in mano un token arrivato nella casella
            // email: se non sei stato tu, la casella e' compromessa.
            window.showToast(T('settings.recuperoAnnullatoAvviso') ||
                'Recupero annullato. Attenzione: chi l\'ha avviato ha letto un\'email arrivata nella tua casella. Cambia la password della tua email, e valuta di cambiare anche quella di Camoscio.', 'success');
            renderTwoFactorCard(window.CamoscioState && window.CamoscioState.currentUser);
        } catch {
            window.showToast(T('common.erroreRete') || 'Impossibile contattare il server.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ---- Copia / Scarica / Stampa dei codici ---------------------------------

    function testoCodici() {
        return 'Codici di recupero Camoscio\n'
            + '(ognuno funziona una volta sola, al posto del codice dell\'app)\n\n'
            + codiciCorrenti.join('\n') + '\n';
    }
    async function copia(testo, btn) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(testo);
            } else {
                const ta = document.createElement('textarea');
                ta.value = testo; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = T('common.copiato') || 'Copiato';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            }
        } catch {
            window.showToast(T('settings.2faCopiaFallita') || 'Copia non riuscita: selezionali a mano.', 'error');
        }
    }
    function scarica(nomeFile, testo) {
        try {
            const blob = new Blob([testo], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = nomeFile;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            window.showToast(T('settings.2faScaricaFallita') || 'Download non riuscito.', 'error');
        }
    }
    function stampa() {
        const w = window.open('', '_blank');
        if (!w) { window.showToast(T('settings.2faStampaBloccata') || 'La stampa è stata bloccata dal browser.', 'error'); return; }
        const righe = codiciCorrenti.map(c => `<li>${c}</li>`).join('');
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Codici di recupero Camoscio</title>`
            + `<style>body{font-family:monospace;font-size:16px;padding:24px}li{line-height:2.2;letter-spacing:.08em}</style>`
            + `<h3>Codici di recupero Camoscio</h3>`
            + `<p>Ognuno funziona una volta sola, al posto del codice dell'app.</p><ol>${righe}</ol>`);
        w.document.close();
        w.focus();
        w.print();
    }

    // ---- Aggancio eventi (una volta sola) -----------------------------------

    function unaVolta(id, evento, fn) {
        const el = $(id);
        if (el) el.addEventListener(evento, fn);
    }

    function collegaEventi() {
        unaVolta('tfa-btn-attiva', 'click', avviaConfigurazione);
        unaVolta('tfa-btn-annulla-config', 'click', () => {
            segretoInAttesa = null;
            const pwdInp = $('tfa-verify-pwd');
            if (pwdInp) pwdInp.value = '';
            renderTwoFactorCard(window.CamoscioState && window.CamoscioState.currentUser);
        });
        unaVolta('tfa-btn-copia-segreto', 'click', (e) => copia(segretoInAttesa || $('tfa-secret').textContent, e.currentTarget));
        unaVolta('tfa-btn-verifica', 'click', verificaEAttiva);
        unaVolta('tfa-verify-code', 'keydown', (e) => { if (e.key === 'Enter') verificaEAttiva(); });

        unaVolta('tfa-btn-disattiva', 'click', () => apriFormCred('disable'));
        unaVolta('tfa-btn-rigenera', 'click', () => apriFormCred('regen'));
        unaVolta('tfa-btn-cred-conferma', 'click', confermaCred);
        unaVolta('tfa-btn-cred-annulla', 'click', chiudiFormCred);

        unaVolta('tfa-btn-annulla-recupero', 'click', annullaRecupero);

        unaVolta('tfa-codici-salvati', 'change', (e) => {
            const b = $('tfa-btn-codici-fatto');
            if (b) b.disabled = !e.currentTarget.checked;
        });
        unaVolta('tfa-btn-codici-fatto', 'click', chiudiCodici);
        unaVolta('tfa-btn-copia-codici', 'click', (e) => copia(testoCodici(), e.currentTarget));
        unaVolta('tfa-btn-scarica-codici', 'click', () => scarica('codici-recupero-camoscio.txt', testoCodici()));
        unaVolta('tfa-btn-stampa-codici', 'click', stampa);
    }
})();
