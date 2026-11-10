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
