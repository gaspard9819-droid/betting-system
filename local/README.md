# Helyi szelvényépítő

Tippmixpro-árakból, minden piacon, n8n és Discord nélkül. **Egyik script sem ír
sehova** — csak olvas (WAMP feed + promóciós oldal) és a konzolra ír.

```
node local/cli.js --cel 2.0                 szelvény 2.0-s eredőre
node local/cli.js --cel 2.0 --mikor ma      csak mai meccsek
node local/cli.js --cel 5 --max 3           legfeljebb 3 láb
node local/cli.js --cel 2.0 --db 2          két különböző szelvény
node local/cli.js --boost                   Szuper odds kínálat
node local/cli.js --promok                  aktív promóciók
node local/cli.js --piacok                  piacok margó szerint
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
| kombinált piacok (`1X2 + Gólszám`) | két esemény szorzata egy lábban; a margó halmozott, és a szelvényen belül rejtetten korrelál |
| játékos-függő (`Ki szerzi a gólt?`) | a kezdőcsapattól függ, amit meccs előtt nem tudunk |
| időzítés (`1. gól 70 perc előtt`) | nagyobb szórás, a mért margó-referencia nem terjed ki rá |
| félidős piacok | külön eseményre szól, rövidebb mintával és magasabb margóval |
| negyed-vonal (`Ázsiai hendikep 0.25`) | a tét fele visszajárhat; kötésben az a láb 1,0-s oddsszal számít tovább, az eredő lezuhan — ezt sem a kiírt összodds, sem a legCost nem mutatja |
| szélső gólszám-vonal (`Gólszám 6`) | ott alig van forgalom; a szűk margó nem jó árat jelent, hanem azt, hogy a könyv nem foglalkozott vele |

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

## Korlátok — amit ez nem tud

- **Nincs visszamérés.** Nincs naplózás, nincs elszámolás. Nem fogod megtudni, hogy a
  margó-minimalizálás hozott-e bármit. A margó *előre* becsült, minden szelvény mellett
  ott van.
- **A margó becslés, nem mérés.** Egy könyvből de-vigelve, arányos levonással. Ez
  favorit-longshot torzítást hordoz: a rövid lábon a valódi margó kisebb, a hosszún
  nagyobb, mint amit ez ad (`research/devig_check.js`, 7228 meccsen mérve).
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

A `research/` scriptek **változatlanok** — azok mért eredményeket szolgáltattak, és egy
refaktor többet kockáztat, mint amennyit ér. Az `workflows/` szintén érintetlen: az n8n
rendszer tovább fut, ez mellette működik.
