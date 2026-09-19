# Helyi szelvényépítő

Tippmixpro-árakból, minden piacon, n8n és Discord nélkül. A szelvényépítő
**nem ír sehova** — csak olvas (WAMP feed + promóciós oldal) és a konzolra ír.

```
node local/cli.js --cel 2.0                 szelvény 2.0-s eredőre
node local/cli.js --cel 2.0 --mikor ma      csak mai meccsek
node local/cli.js --cel 5 --max 3           legfeljebb 3 láb
node local/cli.js --cel 2.0 --db 2          két különböző szelvény
node local/cli.js --boost                   Szuper odds kínálat
node local/cli.js --promok                  aktív promóciók
node local/cli.js --piacok                  piacok margó szerint
```

A visszamérés két külön script, lásd lent:

```
node local/log.js                           a mai kínálat naplózása
node local/calib.js                         a naplózott árak kiértékelése
node local/calib_test.js                    53 ellenőrzés a kiértékelőre
```

## Miért így

### Nincs predikció

A szelvényválasztás **margó-minimalizálás**, nem EV-becslés. A repo saját mérése
szerint a modell rangsora mindhárom oddssávban fordított (`research/slip.js:19-30`):
amit a legjobban szeret, az térül meg a legrosszabbul. Valódi EV-hez éles
referencia-ár kellene (Pinnacle), ami egy könyvből nincs.

A költség viszont számolható, és kisebb költség azonos kimenetel mellett mindig jobb.

### Bajnokságonként kérünk, nem a kiemelt listából

A `highlighted-popular-matches` topik a Tippmixpro szerkesztői válogatása, és **nem
tartalmazza a Szuper oddsos meccseket**. Mérve 2026-09-18: mind az öt aktuális boostolt
meccs hiányzott belőle, 50-es és 200-as lapmérettel is. Ezért ad a
`research/boost_fetch.js` nullát.

A bajnokság-topik minden meccset lát, és a `match-odds` kód nélkül minden piacot —
beleértve a `693-3` boostot is.

### Piac-szűrés — nem minden olcsó piac jó

A margó nem mindent lát. Hat kategória esik ki, még ha olcsónak is látszik:

| kizárva | miért |
|---|---|
| kombinált piacok (`1X2 + Gólszám`) | **20,73% margó** a két külön piac 11,26%-ával szemben (43 meccsen mérve) — lásd lent |
| játékos-függő (`Ki szerzi a gólt?`) | a kezdőcsapattól függ, amit meccs előtt nem tudunk |
| időzítés (`1. gól 70 perc előtt`) | nagyobb szórás, a mért margó-referencia nem terjed ki rá |
| félidős piacok | külön eseményre szól, rövidebb mintával és magasabb margóval |
| negyed-vonal (`Ázsiai hendikep 0.25`) | a tét fele visszajárhat; kötésben az a láb 1,0-s oddsszal számít tovább, az eredő lezuhan — ezt sem a kiírt összodds, sem a legCost nem mutatja |
| szélső gólszám-vonal (`Gólszám 6`) | ott alig van forgalom; a szűk margó nem jó árat jelent, hanem azt, hogy a könyv nem foglalkozott vele |
| **átfedő kimenetelű** (`1+`, `2+`, `0-3`, `2-5`) | a de-vig csak teljes, kizáró rendszeren értelmes — lásd lent |

Mérve 2026-09-19 a 43 meccses kínálaton: **26.500 lábból 8.516 marad**, 1507 piacból 939.
A megmaradt piacokon belül tiszta margó-sorrend van — ott tényleg mindegy, melyik.

### A legolcsóbb lábszám nyer, nem a legkevesebb

A `research/slip.js` az **első** lábszámnál megáll, amin van megoldás. Ott ez
helyes volt: a slate becsült Tippmix-árakat hordozott (2,31% átlagos hiba), tehát
a költséget nem lehetett lábszámok között összehasonlítani — a „kevesebb láb
kevesebb margó" használható közelítés volt.

Itt minden ár mért, tehát a költség közvetlenül számolható. És a közelítés nem
áll: a hosszú lábak büntetése (`README.md:571`) gyorsabban nő, mint amennyit egy
pluszláb margója hozzátesz.

Mérve 2026-09-19, ugyanarra a célra, Tippmixpro-árakon:

| cél | 1 láb | 2 láb | 3 láb |
|---|---|---|---|
| 2,1x | **1,60%** | 2,70% | 6,33% |
| 3x | 3,28% | **2,36%** | 3,03% |
| 5x | 6,03% | 3,89% | **2,53%** |
| 10x | nincs | 9,12% | **5,42%** |
| 20x | nincs | 12,59% | **10,14%** |

Kb. **2,5x alatt egy láb a legolcsóbb**, fölötte több. A kereső mindegyiket
végigpróbálja, és a legolcsóbbat adja; döntetlennél a kevesebb lábat, mert
kevesebb dolog tud rosszul elsülni (lemondott meccs, felfüggesztett piac).

### Átfedő kimenetelek — ahol a margószámítás érvénytelen

A de-vig feltételezi, hogy a kimenetelek **teljes, kizáró rendszert** alkotnak
(összegük 1). A Tippmixpro kínál olyan piacokat, ahol ez nem áll:

- `Ath. Bilbao: 1+`, `2+`, `3+`, `4+` — egymásba ágyazott halmazok
- `Gólszám: 0-2`, `0-3`, `1-2`, `2-5` — átfedő sávok

Ezeken az implikált összeg nem margót mér. **Mérve ugyanazon a meccsen:** az egyik
ilyen piac 6,49-es összeget adott („549% margó"), egy másik **1,0048-at (0,48%)**.

A 0,48% a veszélyesebb: úgy néz ki, mint egy kivételesen olcsó piac, és a rangsor
eléjére hozza. Egy szelvény épült rá, mielőtt észrevettem.

Két védelem:

1. **Alak-alapú felismerés** (`hasOverlappingOutcomes`): ha két vagy több kimenetel
   `N+` vagy `N-M` alakú, a piac kimarad. A név nem lenne elég — a `Gólszám` alatt
   két különböző piac fut, a kétkimenetelű over/under és a sávos.
2. **Margó-plafon** (25%): a legdrágább mért piac a kombinált (20,73%). Ami e fölött
   van, az nem drága piac, hanem rossz számítás.

A referencia-margó sem segít rajtuk: a `MARKET_REF` 6,76%-a a sima over/under
gólszámra áll, nem a sávos változatra.

### Egy meccsen két piac — a könyv mindkét irányban nyer

Gyakori ötlet: „hazai győzelem + mindkét csapat szerez gólt" ugyanarra a meccsre.
A Tippmixpro ezt kész piacként kínálja (`1X2 + Mindkét csapat szerez gólt`).

**Mérve 2026-09-19, 43 meccsen:**

| | margó |
|---|---|
| 1X2 | 4,90% |
| Mindkét csapat szerez gólt | 6,36% |
| a két külön piac együtt | 11,26% |
| **kombinált piac (6 kimenetel)** | **20,73%** |

Az ár első ránézésre jónak tűnik: a kombinált piac 12 esetből 11-ben **többet
fizet**, mint a két láb odds-szorzata (átlag +8,5%, maximum +13,9%). Ez azért van,
mert a két esemény **negatívan korrelál** — ha a hazai nyer, gyakran 1-0 vagy 2-0
lesz, tehát nincs BTTS. Az együttes kimenetel ritkább, mint a szorzat.

De a felár nem ajándék: a könyv beárazta a korrelációt, aztán rátett még egy adag
margót. **20,73% majdnem duplája a két külön lábnak.**

A `research/README.md:499` fordított esete ugyanezt mutatja más irányból:
**pozitívan** korreláló lábaknál a szorzat 9,16 lett volna, a Tippmixpro 5,25-öt
írt ki (−21,9% nettó). Negatív korrelációnál felárat ad, pozitívnál levon —
mindkét esetben a könyv nyer.

Ezért van két külön szabály: a kombinált piacok kizárva (`COMBINED` minta a
`margin.js`-ben), és egy meccsből egy láb.

### Egy meccsből egy láb — és semmi több

Ez az egyetlen diverzitás-szabály, és mért indoka van: ugyanazon meccs két lábjánál
a szorzat 9,16 lett volna, a Tippmixpro **5,25-öt írt ki** (−21,9% nettó) —
`research/README.md:499`.

Volt egy piac-család szerinti korlát is (max két azonos irányú láb), azzal az
indokkal, hogy a könyv az over-oldalt szisztematikusan drágábban adja. **Megmérve
2026-09-19, 148 közel 50/50-es gólszám vonalon: az over oldal a margó 49,8%-át
viseli** (medián 49,7%). Szimmetrikus — az állítás ezen az adaton nem igaz, ezért
a szabály kikerült.

Különböző meccsek függetlenek. Három „több mint 1,5 gól" láb három meccsről nem
egyetlen feltétel — három külön fogadás.

### Power de-vig, nem arányos

A margó szétosztása a kimenetelek között nem egyenletes: a favourite-longshot
bias miatt a hosszú lábakra aránytalanul több jut. A power módszer ezt kezeli —
azt a `k` kitevőt keresi, amire `Σ pᵢ^k = 1`.

**Mérve a `research/devig_check.js`-ben, 7228 meccsen:** a power jobb log-losst ad
(0,96302 → 0,96245). Az arányos módszer torzítása ugyanott: az 1,0–1,6 sávban
71,88%-ot becsül 73,19% helyett, az 5,0+ sávban 14,35%-ot 13,26% helyett.

Az a mérés több könyv legjobb árán (MaxC) azt találta, hogy a power ott alig
számít — a MaxC overroundja −0,03%, nincs mit szétosztani. **Itt egy könyv ára
van, 4–6% overrounddal**, tehát van.

A saját árainkon (863 piac, 2026-09-19) a power ebbe az irányba mozdít:
1,0–1,6 sáv **+2,80pp**, 3,2–5,0 sáv −1,97pp, 5,0+ sáv −3,82pp.

**Mit változtat a gyakorlatban:** nem a választást, hanem a becslést. A margó —
és vele a `legCost` — módszerfüggetlen, tehát a szelvény ugyanaz marad. A
**bejövési esély** lesz pontosabb: a mai 2,0-s szelvényen 46,5% → 47,7%.

Összevetés a régi módszerrel: `BETTING_DEVIG=proportional node local/cli.js ...`

## Mit mér, és mennyire pontosan

A számolt margók egybeesnek a `research/README.md` méréseivel:

| piac | itt mért | README:368 (25 meccs medián) |
|---|---|---|
| 1X2 – Szuper odds | 1,84% | 2,22% |
| 1X2 | 4,52% | 6,15% |
| Gólszám | 5,4–6,0% | 6,76% |
| Mindkét csapat szerez gólt | 6,34% | 7,50% |

Ugyanaz a nagyságrend és sorrend. Az eltérés napi ingadozás — a README-számok más nap
más meccseiről származnak.

## Visszamérés — `log.js` + `calib.js`

A margó *előre* becsült, és sokáig semmi nem mondta meg, hogy a becslés helyes-e.
Ez a két script megmondja. A `log.js` az egyetlen darab itt, ami ír — helyi
fájlba, a `local/pool/` mappába.

### Nem a megtett fogadásokat méri, hanem a teljes kínálatot

Egy ár helyessége nem attól függ, hogy tettünk-e rá pénzt. A `log.js` minden
lekért piacot naplóz, a `calib.js` pedig **az összeset** elszámolja a
football-data végeredményéből — napi ~1200 kiértékelhető piac a néhány megtett
szelvény helyett.

Ez a különbség dönt hét és év között. A `research/README.md:784` szerint
160–220 fogadásnál a ROI konfidencia-intervalluma túl széles bármihez; a
kalibráció viszont hetekben megoldódik.

### Árat naplóz, nem valószínűséget

Az ár **mérés**, a valószínűség **becslés** — és a becslés módszere változhat.
Ha a valószínűséget mentenénk, minden módszerváltás érvénytelenítené a régi
naplót. Így a `calib.js` bármelyik módszert visszamenőleg pontozhatja ugyanazon
az adaton.

### Mit naplóz, és mit nem

Mérve 2026-09-19, 43 meccses kínálaton: a teljes kínálat 12 213 piac, gzip után
**788 KB** — napi egy futással ~290 MB évente. A pontszámból elszámolható
családok ugyanabból 3190 piac, **167 KB**.

A különbség nem tömörítés kérdése: amit eldobunk, azt a football-data
végeredményéből **soha** nem lehetne elszámolni (játékos-statisztikák, lapok,
lesek, időszakaszok). Nincs hozzá mérő. Ami marad, az az öt család, amire a
`margin.js` `MARKET_REF`-je mért margó-referenciát tart, **és** ami a
végeredmény függvénye. A `--mind` mindent ment, ha valaki a teljes kínálat
margó-szerkezetét vizsgálná.

A snapshotok **mérések és nem reprodukálhatók** — ugyanaz a kategória, mint a
`research/data/tippmix/` kézi árai, amiket a `.gitignore` kifejezetten
bennhagy. Ezért nincsenek kizárva.

### A fő metrika: log-loss piaconként

Egy piac kimenetelei teljes, kizáró rendszert alkotnak: pontosan egy nyer. A
de-vigelt valószínűségek eloszlást adnak rajtuk, tehát a helyes pontszám a
nyertes kimenetel `-ln(p)`-je, **piaconként egy megfigyelés**.

Lábanként számolva ugyanaz az információ többször számítana (egy piac lábai nem
függetlenek, összegük 1), és a konfidencia-intervallum hamisan szűk lenne. A
power és az arányos módszer **párosítva** kerül összevetésre — ugyanaz a piac,
ugyanaz a kimenetel, két módszerrel pontozva. A `timing.js` ugyanezt csinálta
(+0,403pp, t=7,55): a párosított teszt sokkal érzékenyebb, mint két átlag
összevetése.

A kimenet **kiírja a t-t, és kimondja, ha `|t| < 2`** — plusz azt is, hány piac
kellene az észlelt hatáshoz. Enélkül egy 0,001-es log-loss különbség 40 piacon
eredménynek látszana.

### Két hiba, amit a `calib_test.js` fogott meg

Mindkettő **csendes** lett volna: kevesebb sor a jelentésben, semmi hibaüzenet.

1. **A `BETTING_POOL_DIR` modul-szinten oldódott fel**, a `require`
   pillanatában — a teszt viszont csak utána állítja be, tehát a valódi
   naplón futott volna. A 45–46. ellenőrzés 0 piacot látott.
2. **A dedup kulcsa meccs+kód volt**, de a `code` minden gólszám-vonalra
   ugyanaz (`47-3`, lásd `catalog.js:80`). A vonalak egymást írták felül:
   3190 naplózott piacból 950 maradt — **a minta kétharmada tűnt el.** Az 52–53.
   ellenőrzés ezt méri.

### Ami még nincs elszámolva

A **hendikep-piacok naplózva vannak, de nincsenek elszámolva** (napi ~730 piac).
A magyar címke parszolása — előjel, csapatoldal, egész vonal push-a — hibázásra
hajlamos, és egy elnézett előjel *csendben* fordítaná meg a kalibrációt. Az
adat viszont olcsó, és a mai árat holnap nem lehet újra felvenni, ezért gyűlik.

A `node local/calib.js --reszletek` kiírja, mennyi piac veszik el velük — abból
lehet eldönteni, megéri-e felvenni őket az `outcomeOf()`-ba. Egyenként, mért
címke-alakkal, nem mintára találgatva.

## Korlátok — amit ez nem tud

- **A visszamérés a becslést méri, nem a hozamot.** A `calib.js` azt mondja meg,
  helyesek-e a de-vigelt valószínűségek — tehát a kiírt bejövési esély és a
  láb-költség helyes-e. Azt nem, hogy nyersz-e: a margó-minimalizálás haszna
  aritmetikai (kisebb költség azonos kimenetel mellett mindig jobb), nem
  előrejelzési.
- **A kalibráció csak a hazai bajnokságokra áll.** A football-data nem ad
  kupákat, tehát a BL/EL/KL lábak sosem kerülnek bele. Rájuk marad a
  feltételezés, hogy a de-vig ugyanúgy viselkedik.
- **A csapatnév-feloldás rothad.** Új vagy promovált csapat új rövidítést hoz
  (`Atl. Madrid`, `E. Frankfurt`), és a tünete csendes: a meccs kiesik a
  mintából. Két helyen van megfogva — a `calib_test.js` 41. ellenőrzése minden
  naplózott nevet feloldani próbál, és a `--reszletek` kiírja a párosítatlanokat.
  A tábla a `calib.js` `FEED_ALIAS`-a, **nem** a `research/teams.js` — azt a
  `settle_test.js` a deployolt node-hoz tartja szinkronban.
- **Csak Tippmixpro.** A Vegas.hu külön forrás lenne.
- **Nincs kupa-adat, ha nincs kupaforduló.** A BL/EL/KL tournament id-k érvényesek, de
  a 96 órás ablakban 0 meccs, ha épp nincs játéknap.
- **A promó-parser hiányzó mezőket hagy üresen.** Ha egy feltétel nem olvasható ki a
  szövegből, `-` jelenik meg, nem kitalált szám. Néhány promónál a min. odds és kötés
  így hiányzik.

## Ha elavul egy tournament id

Szezonváltáskor a tünet: 0 meccs arra a ligára, hiba nélkül.

```
node research/tippmix_discover.js --cat 67     kupák
node research/tippmix_discover.js --cat 77     Anglia
```

Az új id-t a `local/catalog.js` `LEAGUES` / `CUPS` tömbjébe kell írni.

## Fájlok

| | |
|---|---|
| `feed.js` | WAMP kliens — egy példány (a `research/`-ben négy másolat van) |
| `catalog.js` | meccs- és piaclekérés bajnokságonként |
| `margin.js` | de-vig, margó, láb-költség |
| `build.js` | szelvényépítés (a `research/slip.js` DFS-e, margó-rangsorral) |
| `promos.js` | promóciók a publikus oldalról |
| `cli.js` | belépési pont |
| `log.js` | a kínálat naplózása a `pool/` mappába — **az egyetlen, ami ír** |
| `calib.js` | a naplózott árak kiértékelése a végeredményből |
| `calib_test.js` | 53 ellenőrzés, nagyrészt valós adaton |

A `research/` scriptek **változatlanok** — azok mért eredményeket szolgáltattak, és egy
refaktor többet kockáztat, mint amennyit ér. Az `workflows/` szintén érintetlen: az n8n
rendszer tovább fut, ez mellette működik.
