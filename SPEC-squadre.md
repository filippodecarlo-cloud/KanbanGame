# KanbanGame a squadre — specifica (per i worker)

Obiettivo: versione multigiocatore di «Fattoria LEGO a doppio kanban». Ogni **squadra** (stanza) gestisce UNO stabilimento
condiviso in tempo reale; ogni membro prende un ruolo; i ruoli scoperti sono automatici. Il docente ha una regia con classifica dal vivo.
Stessa architettura di «Spaghetti Zero» (labarena/spaghetti-zero): server Node **senza dipendenze npm**, file statici + **Server-Sent Events**,
stanze in memoria, PIN docente, `render.yaml` per Render (piano free, Francoforte). Differenza voluta: qui il **server è autorevole**
e fa girare la simulazione (il motore è lo stesso JS usato dal browser).

Lingua dell'interfaccia: **italiano**. Niente build step, niente framework. Node >= 18.

## Materiale esistente (leggere prima di scrivere)
- `/home/claude/lego-kanban2/engine.js` — motore attuale (makeSim). Va esteso, non riscritto.
- `/home/claude/lego-kanban2/ui.js`, `animal.js`, `template.html` — interfaccia a giocatore singolo: disegni a mattoncini (drawModel),
  griglie supermarket/bordo linea, reparti, carrello del Mizusumashi, cartellini con sigle, animazioni «in volo» guidate dagli eventi `S.ev`,
  schermate esito / intermezzo (formula e scelta cartellini) / retrospettiva (miglioramenti) / debriefing, grafici SVG. **Riusare il più possibile.**
- `/home/claude/KanbanGame/index.html` — versione a giocatore singolo già pubblicata su GitHub Pages. **Non toccarla.**

## Struttura dei file nel repo `/home/claude/KanbanGame`
```
index.html            (esistente, solo: NON modificare)
server.js             W1
package.json          W1   {"scripts":{"start":"node server.js","test":"node test-server.js"},"engines":{"node":">=18"},"private":true}
render.yaml           W1   service name: kanban-game, healthCheckPath /api/ping, env DOCENTE_PIN=lean, buildCommand "true"
test-server.js        W1   test automatico (avvia il server su porta libera, simula client via HTTP/SSE)
team/engine.js        W1   motore condiviso (UMD: module.exports in Node, window.KG in browser)
team/index.html       W2
team/app.js           W2
team/style.css        W2
```
Il server serve `team/` come radice del sito (`/` → team/index.html) e `/solo/` → l'`index.html` della radice del repo.

## Motore (W1) — estensioni a makeSim
- `cfg.human`: **array** di ruoli umani tra `legs, body, head, mizu, asm` (prima era una stringa). `S.human` = array.
- Reparti `body` e `head` giocabili come `legs`: azioni `produce` (kanban: prende il primo kanban P dalla cassetta) e `produceType` con arg tipo animale (push).
- Ruolo `asm` (assemblaggio finale) giocabile: se umano, l'assemblaggio NON parte da solo; azione `assemble` avvia il prossimo ordine se i 3 pezzi sono a bordo linea
  (stessa logica dell'automatico; i mancanti continuano a essere rilevati e contati anche quando è umano).
- API: `sim.can(role, action, arg)` → '' se possibile, altrimenti codice motivo; `sim.act(role, action, arg)`; `sim.step(dt)`; `sim.result()`;
  `sim.snapshot()` → oggetto **JSON puro** con ciò che serve a disegnare: stessi nomi di campo di `S`
  (`t,dur,mode,ended,pitch,human,super,line,empties,cells,asm,mizu,queue,log`) più `delivered` ridotto a `{n, last:[ultimi 6 ordini]}`,
  `wip` (numero), `orderIdx`. Escludere `seq, samples, LP, LW, stockT, shortN`. `queue` al massimo i primi 10 + `queueN`.
  Lo snapshot deve bastare a calcolare `can` lato client: esporre anche `KG.canOn(snapshot, role, action, arg)` (funzione pura) oppure
  includere nello snapshot `can: {legs:{produce:''...}, body:{...}, head:{...}, asm:{assemble:''}, mizu:{deliver:'',collect:'',goSuper:'',swap:'',loadAll:'',goLine:''}}`
  (**scelta: includere `can` nello snapshot**, più `swapPossible` booleano).
- Gli eventi per le animazioni restano in `S.ev` (il server li svuota a ogni invio).
- Esportare anche `P, TYPES, COMPS, PN, MEAN, SETUP, makeSeq`.
- Il motore non deve usare API del browser. Lasciare invariati taratura e punteggio (+10 spedito, −5 non evaso, −1 per contenitore).

## Server (W1) — `server.js`
Convenzioni come Spaghetti Zero: `http` nativo, CORS `*` su tutte le API, SSE con `retry: 2000` e ping ogni 15 s, id stanza `^[A-Z0-9_-]{1,24}$` (maiuscolo),
stanze eliminate dopo 24 h senza client, `PORT` e `DOCENTE_PIN` (default `lean`) da env.

Stato di una stanza:
```
{ id, name, phase, round, roles:{legs,body,head,mizu,asm → cid|null}, cfg:{nP:{legs,body,head}, nW:{...}, imp:[]},
  results:[r1,r2,r3] (oggetti sim.result() SENZA samples pesanti: tenere samples ma decimati a ≤ 90 punti), sim (solo in partita), touched }
```
Fasi: `lobby → g1 → s1 → inter → g2 → s2 → retro → g3 → s3 → debrief`. Default cfg: nP 2/2/2, nW 2/2/2, imp [].
Sessione globale: `{dur: 180, seed}`; `seed` uguale per tutte le stanze (stessa sequenza di ordini per tutti), rigenerato a ogni reset.
Round 1 = push, round 2 = kanban con cfg, round 3 = kanban con cfg + imp (max 2 tra `heijunka,pitch,smed,std`).

Tick: `setInterval` 100 ms; per ogni stanza in partita `sim.step(0.1)`; ogni 200 ms invia `tick`. A fine round salva il risultato, passa a `sN`, invia `state`.

### API
- `GET /api/ping` → `{ok:true, app:'kanban-game'}`
- `GET /api/events?room=ID&c=CID&name=NOME[&view=1]` (SSE). `view=1` = spettatore (docente), non compare tra i membri.
  Messaggi (`data: JSON`):
  - `{type:'init', room:<stato pubblico>, peers:[{c,name}], session:{dur}}` — se in partita include `S` (snapshot).
  - `{type:'peers', peers}` a ogni ingresso/uscita. Se un membro esce, i suoi ruoli tornano liberi (automatici) → segue `state`.
  - `{type:'state', room:<stato pubblico>}` a ogni cambio di fase/ruoli/cfg/risultati. Stato pubblico = `{id,name,phase,round,roles,cfg,results}`.
  - `{type:'tick', S:<snapshot>, ev:[...]}` in partita.
  - `{type:'reset'}` quando il docente azzera.
- `POST /api/op?room=ID` corpo JSON `{c, a, ...}` → `{ok:true}` oppure `{ok:false, error}`:
  - `{a:'role', role}` prende il ruolo se libero (un client può tenere più ruoli); `{a:'unrole', role}` lo lascia. Consentito in ogni fase, anche in partita
    (in partita: aggiornare `sim.S.human`).
  - `{a:'cfg', nP, nW, imp}` solo nelle fasi `inter` (nP/nW) e `retro` (nP/nW/imp). Valori 1..5; imp max 2.
  - `{a:'next'}` avanza: `lobby→g1`, `s1→inter`, `inter→g2`, `s2→retro`, `retro→g3`, `s3→debrief`. Ignorato nelle fasi g*.
  - `{a:'act', role, action, arg}` azione di gioco; valida solo se `roles[role]===c` e fase g*.
  - `{a:'name', name}` imposta il nome visualizzato della squadra (≤ 24 caratteri).
- `GET /api/rooms` → `{rooms:[{room,name,peers:[nomi],phase,round,roles:{ruolo:nomeGiocatore|null},cards,imp,
  results:[{points,delivered,backlog,wip,lead,noWait}|null ×3], live:{t,dur,delivered,waiting,stock}|null}], session:{dur}, now}`
- `POST /api/session?pin=PIN` corpo `{dur}` (120|180|240|300) → imposta la durata dei round futuri.
- `POST /api/reset?pin=PIN` → azzera tutte le stanze (broadcast `reset`), nuovo seed.
- `GET /api/pin?pin=` → `{ok:bool}`
- File statici come descritto sopra, `Cache-Control: no-cache`.

`test-server.js`: avvia il server, due client SSE nella stessa stanza, prendono ruoli (uno `mizu`, uno `legs`), giocano i 3 round con durata ridotta
(permettere `KG_TEST_DUR` / `KG_SPEED` env per accelerare il tempo simulato nei test), verificano fasi, tick, risultati, `/api/rooms`, reset. Deve uscire con codice 0.

## Client (W2) — `team/`
`team/index.html` carica `engine.js` (per costanti e `KG`), poi `app.js`. `window.KG_SERVER=''` configurabile (come `SZ_SERVER`; anche `?server=`).
`api(p)` come in Spaghetti Zero. `cid` in sessionStorage; nome giocatore e squadra in localStorage (con try/catch).

Schermate:
1. **Ingresso**: nome della squadra + il tuo nome → entra (`?room=NOME` precompila). Chi scrive lo stesso nome squadra entra nello stesso stabilimento.
   Se `/api/ping` fallisce: messaggio chiaro + link alla versione a giocatore singolo (`/solo/` oppure `../index.html`).
2. **Sala (lobby)**: i 5 ruoli come carte (Reparto Zampe, Reparto Corpi, Reparto Teste, Mizusumashi, Assemblaggio finale) con chi li ha presi;
   tocca per prendere/lasciare; i ruoli liberi sono «automatico». Breve spiegazione dei due cartellini (riusare schema dei due anelli e distinta base).
   Pulsante «Inizia il round 1» (chiunque).
3. **Partita**: lo stabilimento come nella versione singola (stesso layout, cartellini con sigle, carrello, animazioni dagli `ev`), più:
   chi occupa ogni postazione (nome del compagno o «auto»), evidenziata la/le tua/e; barra azioni in basso per i TUOI ruoli
   (se ne hai più di uno, mostrare le azioni di tutti, raggruppate). Abilitazione pulsanti da `S.can`. Le azioni inviano `POST /api/op {a:'act'...}`.
   Spettatore (`view=1`): nessuna barra azioni. Si può prendere un ruolo libero anche a partita in corso.
4. **Esito round** (`sN`): come la versione singola (punteggio, tabella, grafici, lead time dei due anelli), pulsante per proseguire (`next`).
5. **Intermezzo** e **Retrospettiva**: come la versione singola ma **condivise**: ogni modifica a cartellini/miglioramenti invia `cfg` e si aggiorna a tutti.
6. **Debriefing**: confronto dei 3 round, domande, concetti chiave.
7. **Regia docente** (`?docente=PIN`): link per gli studenti con «Copia», durata dei round (invoca `/api/session`), classifica dal vivo (polling `/api/rooms` ogni 2 s)
   ordinata per punti del round 3, poi round 2, con: squadra, membri e ruoli, fase, punti R1/R2/R3, cartellini usati, miglioramenti scelti, e in partita
   tempo rimasto / spediti / in attesa / scorte; «Guarda» apre `?room=X&view=1`; «Azzera la sessione» con conferma in pagina (niente `confirm()`).
   Pensata per essere proiettata.

Robustezza: riconnessione SSE automatica (alla riconnessione arriva `init` completo); su `reset` tornare all'ingresso; nessun `alert/confirm/prompt`.
Responsive: telefoni in verticale (gli studenti giocano dal telefono) e proiettore. Le animazioni non devono dipendere da `prefers-reduced-motion`
(c'è un interruttore «Animazioni: sì/no»).

## Deviazioni W1
Nessuna modifica al protocollo; solo aggiunte e precisazioni (W2 può ignorare ciò che non usa).
- **Snapshot** (`S` in `init`/`tick`): oltre ai campi della specifica contiene `cv, imp (array), nP, nW, queueN, produced`,
  `asm.ready` (true se il ruolo `asm` è umano e il prossimo ordine ha tutti i pezzi: va premuto «assembla»), `mizu.load` (pezzi sul carrello).
  `S.human` è sempre un array. `mizu.act` = `{kind, rem, dur, data}`; per `swap` `data = {pn, pk, wk, fc, ec}` (id cartellino P, id cartellino W,
  id contenitore pieno, id contenitore vuoto); per `collect`/`loadAll` `data` è un numero; altrimenti `null`. `kind` può essere `'wait'` (solo bot).
- **`can`**: chiavi `legs|body|head: {produce, produceType}`, `asm: {assemble}`, `mizu: {deliver, collect, goSuper, swap, loadAll, goLine}`.
  `''` = possibile, altrimenti codice: `ended, busy, mode, noCard, badType, noOrder, missing, where, nothing, noEmpty, cartFull, noW, noMatch, superEmpty, unknown`.
  `produceType` senza `arg` produce `cow`; `arg` deve essere uno di `TYPES`. Se un umano prende `mizu` mentre il bot è in `wait`, l'attesa viene annullata.
- **Errori di `/api/op`** (`{ok:false,error}`): `noRoom` (404: la stanza nasce solo con la prima connessione SSE), `notMember` (role/unrole da cid non connesso
  o spettatore), `taken`, `notYours` (unrole/act su ruolo non proprio), `role`, `phase`, `nP`, `nW`, `imp`, `name`, `unknown`, oppure il codice di `can` per `act`.
  `next` in `debrief` (o in partita) → `phase`. `cfg` accetta campi parziali (solo quelli presenti vengono cambiati); `imp` solo in `retro`.
  `{a:'role'}` su un ruolo già proprio → `ok:true`.
- **Fine round**: il server invia un ultimo `tick` (con `S.ended=true`) e poi `state` con fase `sN` e `results[N-1]`.
  All'avvio di un round invia `state` (fase `gN`) e subito un primo `tick`. Gli `ev` di un `tick` includono anche quelli generati dalle azioni.
- **Reset**: dopo `{type:'reset'}` il server chiude tutte le connessioni SSE. Il client deve chiudere il suo `EventSource` alla ricezione di `reset`
  (altrimenti la riconnessione automatica ricreerebbe la stanza vuota).
- **Uscita**: i ruoli vengono liberati 8 s dopo la chiusura dell'ultima connessione SSE del cid (env `KG_LEAVE_MS` per i test); `peers` è inviato in quel momento.
- **`/api/session`** risponde `{ok:true, session:{dur}}`; pin errato → HTTP 403 `{ok:false,error:'pin'}` (anche `/api/reset`).
- **`/api/rooms`**: `cards` = cartellini della cfg corrente (4 × Σ(nP+nW)); `live.stock` = pezzi in supermarket + bordo linea + carrello.
- Env per i test: `KG_SPEED` (intero, passi da 0,1 s per tick da 100 ms), `KG_TEST_DUR` (s), `KG_LEAVE_MS`.

## Apertura e chiusura del gioco
Il gioco **parte chiuso**: sul piano free di Render ogni risveglio è un riavvio, quindi uno stato «chiuso» in memoria tornerebbe aperto.
Il docente lo apre dalla regia all'inizio della lezione; si richiude da solo dopo 3 ore o al riavvio del server.
- Sessione: `session.open` (bool) e `session.openUntil` (ms epoch, `null` se chiuso). Env `KG_OPEN=1` = parte aperto; `KG_OPEN_HOURS` (anche frazionario,
  es. `0.001` nei test) = durata massima dell'apertura (predefinita 3). Scaduto `openUntil`, il server chiude da solo (timer da 1 s + controllo a ogni richiesta).
- `POST /api/session?pin=PIN` accetta anche `{open:true|false}` e `{extend:1}` (+1 ora, solo se aperto, altrimenti 409 `closed`); `open` non booleano → 400 `open`.
  Aprire imposta `openUntil = adesso + 3 h`. Chiudere: `{type:'closed'}` a tutte le connessioni SSE (membri e spettatori), connessioni chiuse,
  stanze eliminate (nessuna simulazione resta attiva), nuovo seed.
- `session` (in `init`, `session`, `/api/rooms`, risposta di `/api/session`) e `GET /api/ping` includono `open` e `openUntil`.
- A gioco chiuso: `GET /api/events` → HTTP 403 `{ok:false,error:'closed'}` (niente SSE); `POST /api/op` → 403 `{ok:false,error:'closed'}`.
  `/api/pin`, `/api/rooms`, `/api/session`, `/api/reset` funzionano sempre.
- Client: se il ping dice `open:false`, se arriva `closed`, se `op` risponde `closed` o se l'SSE fallisce con errore HTTP e il ping conferma la chiusura,
  mostra la schermata «Il gioco è chiuso» con «Riprova» e il link alla versione a giocatore singolo; `EventSource` chiuso e **nessun** polling o
  riconnessione automatica (terrebbero sveglio il server). La regia, a gioco chiuso, smette di interrogare `/api/rooms` (un controllo quando la scheda torna visibile).
