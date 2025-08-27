# 1) Insiemi, indici, parametri

* **Insime/indici**

  * $E$: dipendenti, indice $i$.
  * $R$: ruoli (es. OSS, Infermiere, Medico), indice $r$.
  * $T$: turni arbitrari sull’orizzonte scelto (sett., mese o anno), indice $t$. Ogni turno $t$ ha $(\text{start}_t, \text{end}_t)$ in **timestamp**, può attraversare la mezzanotte.
  * $F$: fasce di **copertura** (intervalli arbitrari start–end) su cui imponi **min/max per ruolo**; possono sovrapporsi (“turni di rinforzo”).

* **Parametri di configurazione**

  * `coverage_mode ∈ {per_ruolo, totale}` (default: **per\_ruolo**).
  * `role_flex ∈ {rigido, flessibile}` (default: **rigido**).

    * Se flessibile: matrice $A \in \{0,1\}^{R\times R}$ o per-dipendente $A_{i,r}$ (ruoli copribili).
  * **Disponibilità contratto** per dipendente: intervallo di validità $[\text{from}_i,\text{to}_i]$ (assunzione/cessazione).

* **Copertura min/max per ruolo e fascia (hard)**

  * Per ogni fascia $f \in F$ e ruolo $r \in R$: $\text{min}_{f,r}, \text{max}_{f,r}$ (con **precedenza agli override** per singola istanza di turno/fascia).

* **Riposo minimo (hard)**

  * Per ruolo: $\text{rest\_hrs}_r$.
  * Override per persona: $\text{rest\_hrs}_i$ (se definito, sostituisce quello del ruolo).
  * **Politica post-notte**: nessuna regola speciale oltre al riposo minimo (tua scelta).

* **Preferenze (soft, peso uguale ma con gerarchia semantica 2→1→3)**

  1. (2) “Evita fascia X **in un certo giorno**”.
  2. (1) “Giorno libero” (data specifica).
  3. (3) “Non faccio **fascia X** (globale)” ⇒ **minimizza** il numero di assegnazioni a X sull’orizzonte.

* **Ore target (soft, dopo equità)**

  * Orizzonte **unico per run**: $\mathcal{H} \in \{\text{settimanale}, \text{mensile}, \text{annuale}\}$.
  * Target per ruolo $\text{target\_hrs}_{r,\mathcal{H}}$, override per persona $\text{target\_hrs}_{i,\mathcal{H}}$.
  * Minimizza **deviazione assoluta** $|\text{ore}_i-\text{target}_i|$.

* **Altre policy operative**

  * **Ferie/assenze approvate**: hard; se rendono infeasible ⇒ lo stato resta **pending** (non accettate).
  * **Ritardatari**: approvazione **manuale**.
  * **Trigger calcolo**: ogni cambiamento rilevante (accettazioni, batch, what-if).
  * **Credito di equità (“enchanted”)**: input **manuale** del caposala (sposta priorità e/o pesi).

* **Tempo continuo**

  * Coperture valutate su fasce $F$ arbitrariamente definite (sovrapponibili).
  * **DST Europe/Rome**: ore calcolate con **durata reale** del turno (±1h).

---

# 2) Variabili decisionali

* **Assegnazione turno**

  * $x_{i,t} \in \{0,1\}$: dipendente $i$ assegnato al turno $t$.
  * Ruolo “attivo” quando $i$ copre $t$:

    * **Rigido:** $role(i)$ è il ruolo coperto.
    * **Flessibile:** variabili ausiliarie $y_{i,t,r} \in \{0,1\}$ con $\sum_r y_{i,t,r}=x_{i,t}$ e $y_{i,t,r} \le A_{i,r}$.

* **Soddisfazione preferenze**

  * Indicatori $u$ per le preferenze di tipo (2) e (1) per giorno/fascia.
  * Contatore $m_{i,X}=\sum_{t \in \text{fascia }X} x_{i,t}$ per la preferenza (3) “non faccio X”.

* **Ore e deviazioni**

  * $\text{ore}_i = \sum_t x_{i,t}\cdot \text{durata}_t$ (in ore, con DST).
  * $\delta_i \ge 0$ tale che $|\text{ore}_i-\text{target}_i| \le \delta_i$.

* **Punteggio individuale di soddisfazione**

  * $S_i = \sum \text{(preferenze soddisfatte per } i)$ con **pesi uguali** (ma codifica semantica 2→1→3).
  * $z$: **minimo** tra i $S_i$ (per equità max–min).

*(Opzionale, solo quando il caposala chiede “parziale”): deficit di copertura $d_{f,r} \ge 0$ per segnalare buchi da coprire con esterni. In modalità **strict** questi NON sono presenti.)*

---

# 3) Vincoli **HARD**

1. **Compatibilità e disponibilità**

   * Se $i$ non è attivo nel periodo del turno $t$ ⇒ $x_{i,t}=0$.
   * **Nessuna sovrapposizione**: se due turni $t,t'$ si sovrappongono nel tempo, $x_{i,t}+x_{i,t'} \le 1$.

2. **Riposo minimo (per persona/ruolo)**

   * Per ogni coppia di turni $t,t'$ con distanza $< \text{rest\_hrs}_i$ (o del ruolo):
     $x_{i,t}+x_{i,t'} \le 1$.

3. **Coperture min/max per fascia e ruolo**

   * Per ogni **fascia** $f$ e ruolo $r$:

     $$
     \text{min}_{f,r} \;\le\; \sum_{t \in \text{overlap}(f)} \sum_{i \in E_r} x_{i,t} \;\;\; \le\; \text{max}_{f,r}
     $$

     con $E_r=\{i:\ role(i)=r\}$ in modalità rigida, oppure usando $y_{i,t,r}$ in modalità flessibile.
     *Se esistono override puntuali per un turno/fascia, sostituiscono i valori di template.*

4. **Ferie/assenze approvate**

   * Se $i$ è assente nell’intervallo $\Lambda$: $x_{i,t}=0$ per ogni $t \subset \Lambda$.

5. **Un solo ruolo per turno (flessibile)**

   * $\sum_r y_{i,t,r} = x_{i,t}$; $y_{i,t,r} \le A_{i,r}$.

6. **(Solo STRICT)** Nessun deficit ammesso: **niente** $d_{f,r}$.

---

# 4) Vincoli **SOFT** (con linking)

* **Preferenza (2): evita fascia X in giorno $g$**

  * Se il giorno $g$ ha turni $t$ in fascia $X$:
    $u^{(2)}_{i,g,X} \le 1 - \sum_{t\in(g,X)} x_{i,t}$.

* **Preferenza (1): giorno libero (data specifica)**

  * $u^{(1)}_{i,g} \le 1 - \sum_{t\in g} x_{i,t}$.

* **Preferenza (3): “non faccio X (globale)”**

  * $m_{i,X} = \sum_{t \in X} x_{i,t}$.
  * Verrà **minimizzato** nell’obiettivo (vedi §5), non serve $u$.

* **Ore target (orizzonte $\mathcal{H}$)**

  * $\text{ore}_i - \text{target}_i \le \delta_i$
  * $\text{target}_i - \text{ore}_i \le \delta_i$.

*(Solo in modalità “parziale” quando richiesto dal caposala)*

* **Deficit di copertura** per fascia/ruolo:

  $$
  \sum_{t\in \text{overlap}(f)} \sum_{i\in E_r} x_{i,t} + d_{f,r} \;\ge\; \text{min}_{f,r}
  $$

  con costo alto sui $d_{f,r}$ e report dei buchi (da coprire con esterni).

---

# 5) **Obiettivi** (lessicografici, in ordine)

1. **Fattibilità hard** (sempre per prima).
2. **Soddisfazione preferenze** (pesi uguali) con **gerarchia semantica 2 → 1 → 3**:

   * 2: massimizza $\sum u^{(2)}$ (evita fascia in giorno).
   * 1: tra le soluzioni con stesso valore di (2), massimizza $\sum u^{(1)}$ (giorni liberi).
   * 3: poi **minimizza** $\sum_{i} m_{i,X(i)}$ per ciascuna preferenza globale “non faccio X”.
3. **Equità (max–min)**: massimizza $z$ con vincoli $z \le S_i$ (dove $S_i$ somma le preferenze soddisfatte di $i$).
4. **Ore target**: minimizza $\sum_i \delta_i$ (deviazioni assolute).
5. **(Opzionale)** Tie-break: minimizza variazione vs piano precedente; bilancia notti/mattine se vuoi metriche estetiche.

> Nota scettica: usare **fasi** (solve → fissa optimum → aggiungi livello successivo) evita che pesi numerici “sballati” rompano la priorità concettuale.

---

# 6) Workflow decisionale (coerente con le tue policy)

* **Richieste** → stato `pending`.
* **Check singolo/batch** su **HARD-only**:

  * **Se fattibile** ⇒ il caposala può **Accettare** ⇒ diventa vincolo **hard**.
  * **Se infeasible** ⇒ resta **pending** (non accettata); il sistema spiega **perché** (fasce/ruoli in deficit) e, su richiesta, può proporre **what-if** alternativi.
* **Ritardatari**: come sopra, ma entrano solo se approvati manualmente.
* **Calcolo orario**: lanci automatici/manuali; modalità:

  * **STRICT (default):** nessuna violazione di min/max.
  * **PARZIALE (solo se richiesto esplicitamente):** introduce $d_{f,r}$ per quantificare i buchi e produrre un **orario parziale** + **lista deficit** per esterni.

---

# 7) Note implementative essenziali

* **Tempo continuo & fasce sovrapponibili**

  * Valutiamo la copertura su $F$ (intervalli) senza vincolare la generazione dei turni a fasce complementari.
  * Se serve granularità uniforme, puoi generare $F$ con slots da 30’ o 60’ e aggregare come “fasce”.

* **Rigido vs flessibile**

  * Default **rigido**; il toggle abilita $y_{i,t,r}$ e la matrice $A$.

* **Stabilità e warm-start**

  * Se vuoi stabilità, aggiungi un costo sulle differenze rispetto al mese precedente (facoltativo).

* **Rapporti**

  * **Individuale**: turni, preferenze OK/KO (con motivo), ore vs target, distribuzione per tipologia.
  * **Aggregato**: coperture min/max, KPI di equità (min/med/max $S_i$), ore per ruolo, eventuali deficit (in modalità parziale).

---

# 8) Pseudomodello compatto (CP-SAT/MILP)

**Variabili**
$x_{i,t}\in\{0,1\}$; (se flessibile) $y_{i,t,r}\in\{0,1\}$; $u^{(2)}_{i,g,X}\in\{0,1\}$, $u^{(1)}_{i,g}\in\{0,1\}$; $m_{i,X}\in \mathbb{Z}_{\ge0}$; $\delta_i\ge0$; $z$.

**Vincoli hard (estratto)**

* Disponibilità, nessuna sovrapposizione, riposo minimo:

  $$
  x_{i,t}+x_{i,t'}\le 1\ \ \text{se}\ \text{overlap}(t,t')\ \text{o}\ \Delta(t,t')<\text{rest\_hrs}_i
  $$
* Copertura min/max per fascia/ruolo:

  $$
  \text{min}_{f,r}\le \sum_{t\in overlap(f)}\sum_{i\in E_r} x_{i,t}\le \text{max}_{f,r}
  $$

  (oppure $\sum_i y_{i,t,r}$ se flessibile).
* Ferie approvate: $x_{i,t}=0$ sui periodi bloccati.

**Soft (linking)**

$$
u^{(2)}_{i,g,X}\le 1-\sum_{t\in(g,X)} x_{i,t},\quad
u^{(1)}_{i,g}\le 1-\sum_{t\in g} x_{i,t}
$$

$$
m_{i,X}=\sum_{t\in X} x_{i,t}
$$

$$
|\text{ore}_i-\text{target}_i|\le \delta_i
$$

**Equità**

$$
S_i=\sum u^{(2)}_{i,\cdot,\cdot}+ \sum u^{(1)}_{i,\cdot} + \text{(eventuali altre preferenze)}
$$

$$
z\le S_i\ \ \forall i
$$

**Obiettivi lessicografici**

1. Max $\sum u^{(2)}$
2. Max $\sum u^{(1)}$
3. Min $\sum m_{i,X}$
4. Max $z$
5. Min $\sum \delta_i$

*(Se serve tie-break: aggiungere livello con stabilità/estetica.)*

---

# 9) Perché questa impostazione è robusta (scetticismo incluso)

* **Fasce sovrapposte + timestamp** eliminano l’artefatto delle fasce complementari: si modella la realtà (anche turni “di rinforzo”).
* **Riposo minimo hard per persona** cattura casi speciali (“Tiziana 24h”) senza rompere il default di ruolo.
* **Gerarchia 2→1→3** evita compromessi controintuitivi tra un “giorno libero” e una “avversione globale”.
* **Equità max–min** impedisce che il sistema “sacrifi chi sempre”.
* **Ore target alla fine** evita di ottimizzare ore a scapito delle preferenze (come richiesto).
* **STRICT vs PARZIALE** rispecchia la tua policy: default rigoroso; solo su richiesta produciamo orari parziali con **deficit trasparenti** per esterni.