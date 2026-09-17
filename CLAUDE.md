# Betting System

Saját használatú sportfogadási rendszer — **nem kliensmunka, nem MVP.** A workflow-k
élő, futó rendszerek a felhasználó n8n instance-án, Discord-parancsokkal vezérelve.

Ez a repo 2026-09-17-én vált ki az `n8n-builder`-ből. Az ott maradt repo kliens-MVP-ket
gyárt bemásolt állásokból; ennek a kettőnek semmi köze egymáshoz a közös n8n
instance-on kívül. A git-történet át lett hozva, tehát a `git log` és a `git blame`
végigmegy a kiválás előtti munkán is.

## Mi van itt

| mappa | mi | |
|---|---|---|
| `research/` | backtest- és mérőscriptek, sima Node, függőség nélkül | `research/README.md` |
| `workflows/` | az n8n workflow-k JSON-ban | `workflows/docs/` egy doc/workflow |

## A két dolog, ami ezt a rendszert meghatározza

### 1. Nincs lay-oldal, és nem is lesz

A felhasználónak **nincs exchange-hozzáférése**: magyar lakcímmel a Betfair és társai
KYC-t kérnek, és a sportfogadás állami monopólium. Ezt 2026-09-16-án próbáltuk és
elbukott.

**Ne javasolj matched bettinget, arbitrázst vagy bármit, aminek a lay a fele.** Két
fogadóiroda nem helyettesít egy exchange-et — két pozitív margó összege pozitív marad.
Alternatív exchange (Smarkets, Matchbook, Betdaq) ugyanez. KYC nélküli kriptós platformot
nem építünk.

Ami lay nélkül is működik: **ingyen tét, visszatérítés, befizetési bónusz** — ezek
pozitív EV-jűek. Meg a **margó-minimalizálás**: ha forgatni kell, a legszűkebb margójú
piacon.

### 2. A modell nem veri a piacot — ez mérve van

A `research/README.md` részletesen leírja. A lényeg: log-loss 1.018 a piac 0.980-jával
szemben 1417 meccsen, és **a magasabb EV-jű fogadások rosszabbul teljesítettek** — ez
a jellegzetes jele annak, hogy a modell ott téved, ahol a legmagabiztosabb.

**Ne építs rá stratégiát, hogy megjósoljuk az eredményt.** Ami mérhetően működik:
line shopping (+3.79 százalékpont azonos fogadásokon) és a margó-választás.

## Ground rules

### Ezek élő rendszerek — futtatás előtt kérdezz

A `workflows/` minden darabja **fut**, és Discordra ír. **Soha ne aktiválj, ne futtass
és ne teszteld egyiket sem a felhasználó kifejezett jóváhagyása nélkül** — nem MVP-k,
ahol a mellékhatás a felhasználó saját fiókjában landol, hanem működő rendszerek, ahol
egy rossz futás valódi szelvényt vagy hibás Discord-üzenetet eredményez.

Mondd ki futtatás előtt, hogy mit fog csinálni, és hová ír.

### Destruktív node-ok

A `Clear Slate` minden reggel 08:00-kor **kitörli a teljes `bet_slate` táblát**.

- Soha ne futtass destruktív node-ot tartalmazó workflow-t kérdezés nélkül
- Snapshot előtte: sorszám + tartalom fájlba, és mondd meg, hol van
- **Minden destruktív node elé IF-guard kell**, ami ellenőrzi, hogy a fenti lépés
  sikerült *és* adott vissza sorokat. Hibánál vagy 0 sornál NoOp, nem törlés.
- Mielőtt késznek mondasz egy workflow-t: sorold fel a destruktív node-jait és azt,
  mi őrzi mindegyiket

### Soha ne találgass `typeVersion`-t

Írás előtt minden node-típusra `get_node`, és abból építkezz. **A katalógus nem az
instance** — egy verzió, ami validál, még nem biztos, hogy betöltődik ezen a buildben.
Ha egy node üresen jelenik meg, előbb a `typeVersion`-re gyanakodj, ne a paraméterekre.

### Mérj, ne becsülj

Ez a repo tele van olyan számokkal, amiket megmértünk, miután a becslés tévedett.
Két konkrét eset, amit érdemes tudni:

- **Egymintás következtetés.** Egy szelvényből arra jutottunk, hogy a Vegas ~19%-kal
  rosszabbul áraz. A teljes piacok megcáfolták: az 1X2 margójuk 5.28%, normális.
  A megcáfolt script (`research/vegas_boost_caveat.js`) fejlécében ott a figyelmeztetés.
- **Zöld pipa nem bizonyíték.** Számold az itemeket minden node-nál, és idézd a nyers
  JSON mezőt (node neve, `runIndex`, `itemCount`), mielőtt következtetsz.

Ha egy változtatás nem futott le, mondd ki, és adj helyette számozott kézi tesztet.
Sose add el futtatás nélküli változtatást működőként.

### Git

- **Javasolj commitot minden működőnek bizonyult állapot után** — de ne commitolj
  magadtól, kérdezz
- **Javasolj `git push`-t minden commit mellé** — a felhasználó több gépről dolgozik
- Visszaállítás előtt mindig mutasd a diffet

## n8n instance

Közös az `n8n-builder` repóval:
- self-hosted Hetzner VM-en, Coolify-jal
- `https://n8n-pwshg2jn0aifbcdupbtr9nu8.91.99.211.194.sslip.io/`
- API kulcs: `N8N_API_KEY` Windows env var — **soha ne írd be fájlba**

**Soha ne hardcode-olj credentialt a workflow JSON-be.** Ne írj `credentials` blokkot
placeholder ID-val sem — az eltöri az n8n UI credential-választóját. Hagyd ki a blokkot.

## Silent failure-ök — amik átmennek a validáción

Ezek **nem adnak hibát, nem adnak figyelmeztetést, és zöld futással végződnek:**

- **Két ág egy node-ba = két futás, és az egyik elveszik.** Minden találkozási pontra
  Merge node kell, `mode` és `numberInputs` kiírva.
- **Langchain sub-node-ban (memory, parser, model) csak `$('Node').first()` oldódik fel.**
  A `$json` és a `.item` némán elhasal, és az agent el sem indul.
- **A `disabled: true` nem hatástalanít `ai_tool`-ra kötött node-ot** — az agent
  továbbra is hívja. Csak a kapcsolat törlése teszi inertté. (`main`-en működik.)
- **A Discord node `resource` mező nélkül csatornát csinál** üzenetküldés helyett,
  némán, zöld futással.
- **Az n8n Code node nem tud WebSocketet nyitni** (task-runner konténer) — ami WS-t
  igényel, az külső script marad.
- **Az `lmChat` model mező 1.3-tól resourceLocator**, nem string. A validátor átengedi,
  futásnál "Could not get parameter".

### Patch előtt mindig újra-olvasás

A felhasználó kézzel szerkeszt node-okat a canvason, amikor a tooling nem éri el őket.
`n8n_get_workflow` közvetlenül minden `n8n_update_partial_workflow` előtt, és mondd el,
mi változott a UI-ban, mielőtt patchelsz. Soha ne törölj vagy hozz újra létre egy
node-ot, amit a felhasználó kézzel javított.

## Layout

220px vízszintes / 160px függőleges rács, [0,0]-tól. **Nincs sticky note** — a node
saját `notes` mezője hordozza a magyarázatot.
