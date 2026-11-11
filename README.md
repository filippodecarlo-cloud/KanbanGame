# KanbanGame – Fattoria LEGO a doppio kanban

Serious game per insegnare il **sistema kanban a doppio cartellino** (kanban di produzione e kanban di prelievo/movimentazione) agli studenti di ingegneria.

**Gioca:** https://filippodecarlo-cloud.github.io/KanbanGame/

## Il gioco

Tre reparti (Zampe, Corpi, Teste) costruiscono i componenti di quattro animali LEGO e li depositano in un supermarket. Il Mizusumashi rifornisce il bordo linea dell'assemblaggio finale, che riceve un ordine ogni 8 secondi (takt time).

- **Round 1 – Push:** i reparti producono su previsione.
- **Round 2 – Doppio kanban:** si dimensionano i cartellini con N = D · L · (1 + α) / a e si lavora in pull.
- **Round 3 – Kaizen:** si misurano i lead time dei due anelli e si scelgono miglioramenti (heijunka, giri più frequenti, SMED, lavoro standard).

Una barra in alto permette di passare a qualsiasi pagina (round, esiti, intermezzo, retrospettiva, debriefing) senza rigiocare: i round non giocati vengono simulati automaticamente.

Ruoli: Reparto Zampe, Mizusumashi oppure osservatore (tutto automatico, per la proiezione in aula). Interfaccia in italiano e inglese.

Il ciclo dei cartellini segue Y. Monden, *Toyota Production System*. Ispirato al [Lego Animal Farm Kanban Game](https://www.organizeagile.com/update/lego-kanban-game) di Organize Agile.

## Uso offline

`index.html` è autonomo: si può scaricare e aprire direttamente nel browser.

---
Filippo De Carlo – Università degli Studi di Firenze, Dipartimento di Ingegneria Industriale

## Versione a squadre (multigiocatore)

**Gioca:** https://kanban-game-kisp.onrender.com · **Regia docente:** `https://kanban-game-kisp.onrender.com/?docente=lean`

Ogni squadra gestisce lo stesso stabilimento in tempo reale: chi scrive lo stesso nome di squadra entra nello stesso stabilimento e prende un ruolo dal proprio telefono (Reparto Zampe, Corpi, Teste, Mizusumashi, Assemblaggio finale). I ruoli liberi lavorano in automatico. Cartellini e miglioramenti si decidono insieme; tutte le squadre ricevono la stessa sequenza di ordini.

- **Studenti:** l'indirizzo base; `?room=NOME` precompila la squadra; `?lang=en` apre in inglese (c'è anche il pulsante IT/EN in alto).
- **Docente:** `?docente=lean` (il PIN si cambia con la variabile `DOCENTE_PIN`): link da copiare, durata dei round, lingua predefinita, classifica dal vivo, «Guarda» per aprire uno stabilimento in sola lettura, «Azzera la sessione».
- **Avvio locale:** `node server.js` (Node 18 o superiore, nessuna dipendenza), poi http://localhost:3000. Test: `node test-server.js`.
- **Render:** «New → Blueprint» sul repository: `render.yaml` è pronto (piano free, Francoforte). Il piano free si addormenta dopo 15 minuti di inattività: aprire il sito un paio di minuti prima della lezione. Le squadre vivono in memoria: un riavvio le azzera.

Architettura (come Spaghetti Zero): `server.js` serve i file di `team/` e sincronizza via Server-Sent Events; qui il server fa anche girare la simulazione (`team/engine.js`, lo stesso motore del browser).
