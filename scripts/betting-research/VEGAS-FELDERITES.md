# Vegas.hu felderítés — 2026-09-17

Mit tudtunk meg a vegas.hu-ról, mint második magyar fogadóiroda a Tippmixpro mellé.
Ez **felderítés, nem épített rendszer** — a döntés még nyitott, lásd a végét.

## A platform

A vegas.hu sportfogadása **Altenar**-on fut (nem saját fejlesztés, nem az a WAMP
WebSocket, amit a Tippmixpro használ). Ez a `scripts/betting-research/tippmix_feed.js`
mintájára **nem újrahasznosítható** — teljesen más adatforrás.

Amit a publikus fájlokból ki lehetett olvasni (`https://vegas.hu/cms/settings.json`):

```json
"altenarSettings": {
  "integration": { "production": "vegas.hu", "stage": "hustage" },
  "apiBaseUrl":  { "production": "https://hu-sb2frontend-altenar2.biahosted.com/api/" },
  "urlWSDK":     { "production": "https://sb2widgetsstatic-altenar2.biahosted.com/altenarWSDK_hungary.js" }
}
```

- Az API-metódusok alakja `Widget/GetSportInfo` (nagy W, a WSDK core bundle-ből:
  `` Fr=()=>`${ao().web}Widget/GetSportInfo` ``).
- Van **odds-booster oldal**: `configAltenarPage` → `{"url":"odds-booster","param":"coupon","sportId":66,"couponType":8}`.
  Tehát a Vegasnak is van boostolt piaca, mint a Tippmixpro „Szuper odds"-nak.
- Van `WBoostedOdds` widget a `cms/configurations/altenarWidgets.json`-ban.

## Az odds API NEM érhető el csak úgy

**Ez a felderítés fő negatív eredménye.** Minden hívás **üres HTTP 400**-at ad az
nginxtől — hibaüzenet nélkül, ami WAF/token-réteg jegye, nem hiányzó paraméteré.
Kipróbálva és elbukott:

- GET a helyes `Widget/GetSportInfo` útvonalon, a helyes `integration=vegas.hu`-val,
  `Referer`/`Origin` fejlécekkel → 400, 0 bájt
- `Sportsbook/*` és `widget/*` (kis w) útvonalak → 400
- paraméter nélküli bare hívás → 400
- **CORS preflight (OPTIONS) → szintén 400**, ami azt jelenti, hogy nem a paraméterekkel
  van baj

A core bundle-ben ott a magyarázat is — egy obfuszkált token-validátor ül az API előtt:

```js
validate(o,e){ "dmFsaWRhdGVUb2tlb" in window && window.dmFsaWRhdGVUb2tlb(o, S.integration, e) }
fetch(){ this.service.fetch({ ge3F6uCFVIZiI: S.integration }) }
```

A `ge3F6uCFVIZiI` egy szándékosan összekevert paraméternév, a `dmFsaWRhdGVUb2tlb`
base64-ben `validateToken`. Vagyis a böngésző előbb szerez egy tokent, és csak azzal
hívhat. **Egy sima `curl` vagy n8n HTTP Request node ezt nem tudja megkerülni.**

Amit ez jelent: ha a Vegas árai kellenek automatikusan, az **fejlécet futtató böngésző**
(Playwright), nem HTTP-hívás. Az viszont nem fér bele egy n8n Code node-ba
(lásd a `n8n-code-node-no-websocket` emléket — ugyanaz a korlát, más okból).

## Ami VISZONT nyilvános

A promóciók listája bejelentkezés nélkül kiolvasható:

```bash
curl -sL -A "Mozilla/5.0" -H "Referer: https://vegas.hu/" \
  "https://vegas.hu/cms/pages/activePages.json"
```

Ez egy sima string-tömb, 1121 oldal-sluggal, ebből **961 `promotions/*`**. A nevek
önmagukban beszédesek, mert a Vegas rendszert használ az elnevezésre:

| minta | jelentés | darab |
|---|---|---|
| `S_freebet0706_5k` | ingyen tét, dátum + méret | 47 |
| `S_cashback0621_10k` | visszatérítés, dátum + méret | 46 |
| `S_kockazatmentes*` | kockázatmentes fogadás | 7 |

Az `S_` prefix = sport (a `c_` kaszinó). A `_2k` / `_5k` / `_10k` utótag a méret,
a négy számjegy a dátum (`0706` = júl. 6.). **Egy promó több méretben is kimegy** —
ez erősen arra utal, hogy a Vegas szegmentálja a felhasználókat, és nem mindenki
ugyanazt az ajánlatot kapja.

Fontos figyelmeztetés: ez a lista **tartalmaz régi, lejárt promókat is** (2024-es
dátumok bőven vannak benne). Az `activePages.json` az oldal-útvonalak listája, nem
az élő akciók listája — a kettő nem ugyanaz. Hogy egy promó **most fut-e**, az ebből
a fájlból nem derül ki.

## A promó-feltételek, amik számítanak

Nyilvános forrásokból (a Vegas promóciós oldalai JS-sel töltődnek, így a feltételeket
másodlagos forrásból kellett venni — **ezt a felhasználónak ellenőriznie kell a saját
fiókjában**):

- **Ingyen tét (freebet): a tét NEM jár vissza.** Csak a nettó nyeremény. 5000 Ft
  freebet @3.00 → 15 000 Ft helyett **10 000 Ft** jóváírás.
- Az aktiváló fogadásra jellemzően **min. 1,6 odds** kell.
- Befizetési bónusznál **5× megforgatás, szelvényenként min. 1,5 odds, 240 óra**.
- **Freebeten nincs cashout** — sem teljes, sem részleges.

Az utolsó pont a fontos: a cashout lett volna az egyetlen „kvázi-lay" eszköz
lay-oldal nélkül. Freebeten nem elérhető.

## Mit változtat ez a matched betting képén

Semmit a lay-oldalon. A `no-exchange-access-hungary` emlék áll: **két fogadóiroda
nem helyettesít egy exchange-et.** A matched betting lényege, hogy az egyik oldal
*pontosan* a másik ellentéte; két könyv csak akkor adna garantált profitot, ha az
áraik átfednének (arbitrázs), ehhez viszont **negatív együttes margó** kellene —
a Tippmixpro 2% (boost) és 5-6% (rendes), a Vegas ennél nem lesz élesebb.

**Amit viszont tényleg nyit:** az ingyen tét és a visszatérítés akciók **lay nélkül
is pozitív EV-jűek** — ezt már a `no-exchange-access-hungary` emlék is kimondta.
A második könyv itt nem a lay-oldalt adja, hanem **több akciót**: ugyanaz a stratégia,
kétszer annyi alkalommal.

## Befizetési bónusz — mérve, nem becsülve (2026-09-17)

A felhasználó jelezte, hogy a Tippmixprónak is van 100% befizetési bónusza. Mindkét
könyvnek van. A kérdés nem az, hogy van-e, hanem hogy **mennyit ér valójában** —
mert a „100%" a névérték, nem a kifizetés.

A szimuláció: `bonus_ev.js` (névérték) és `bonus_sens.js` (tétméret-érzékenység).
200 000 ill. 100 000 futás, a bónusz-egyenlegen a minimum oddson fogadva, amíg a
forgatás teljesül.

| forgatókönyv | EV a névértékből | teljesíti a forgatást |
|---|---|---|
| Tippmixpro 3× forgatás, min 2.00 | **85,8%** | 67,3% |
| Tippmixpro 5× forgatás, min 1.50 | 74,5% | 64,4% |
| Vegas 5× forgatás, min 1.50 | 74,2% | 64,3% |
| **boost-piacon 3×, min 2.00 (2% margó)** | **94,6%** | 71,2% |

**A forgatási szorzó a döntő változó, nem a bónusz mérete.** 3×-ról 5×-re lépve
85,8%-ról 74,5%-ra esik az érték — a bónusz több mint tizede elolvad egyetlen
feltételen. Egy 10 000 Ft-os 3×-os bónusz többet ér, mint egy 12 000 Ft-os 5×-ös.

**A boost-piac itt válik hasznossá.** Ez köti össze a két korábbi szálat: a
`tippmix-boost-feed` mérése szerint a Szuper odds piacon a margó ~2% az 5-6% helyett.
Ha a forgatást **ott** teljesítjük, az érték 85,8%-ról **94,6%-ra** megy. Ugyanaz a
bónusz, ugyanaz a szabály, csak jobb piacon forgatva — **ez a rendszer valódi
hozzáadott értéke**, és nem igényel se lay-oldalt, se jóslást.

### A tétméret nem az EV-t mozgatja, hanem a szórást

Tippmixpro 3×, min 2.00, 10 000 Ft bónusz:

| tét | EV | medián | nullával zár |
|---|---|---|---|
| 1 000 Ft | 8 417 | 8 000 | **11,9%** |
| 2 500 Ft | 8 534 | 10 000 | 33,0% |
| 5 000 Ft | 8 717 | 0 | 50,5% |
| 10 000 Ft | 8 942 | 0 | **65,9%** |

Az EV végig 8 400–8 900 között van — gyakorlatilag lapos. A **medián** viszont
10 000-ről nullára zuhan, és a bukás esélye 12%-ról 66%-ra megy. Egyetlen nagy
tét mediánban nullát hoz, miközben az EV-je a legmagasabb.

**Ez a rendszer fő tanácsa lesz: sok kis tét, nem kevés nagy.** Ez az EV-t nem
rontja, a lenullázás esélyét viszont 66%-ról 12%-ra viszi. Egy EV-t maximalizáló
kalkulátor ezt magától elrontaná — a tétméretet külön szabályként kell kezelni.

### Amit ez nem old meg

A bónusz **egyszeri, fiókonként**. Két könyv = két bónusz, aztán vége. Ez nem
ismétlődő bevétel, hanem kétszeri belépő. A visszatérő sáv továbbra is a freebet
és a cashback.

## A Vegas üdvözlőbónusz VALÓDI feltételei (képernyőkép, 2026-09-17)

A felhasználó beküldte a Részvételi szabályzatot. Ezek már nem becsült, hanem
**megerősített** feltételek:

| mező | érték |
|---|---|
| bónusz mértéke | 100% az első befizetésre |
| maximum | **100 000 Ft** (100 000 Ft feletti befizetésnél is) |
| oddskövetelmény | szelvényenként **min. 1,5** |
| tétrakási követelmény | a bónuszösszeg **5-szöröse** (100k bónusz → 500k forgatás) |
| időtartam | 2026.08.03 – **2026.12.31** |

Két eltérés a korábbi becsléshez képest — az egyik nem számít, a másik igen:

- **A forgatási szorzó (5×) és a min odds (1,5) eltalálva** — a 74,2%-os becslés
  helyes volt. A pontosított szimuláció (`vegas_real.js`) **72,5%**-ot ad.
- **Az időkorlát nem 7 nap, hanem ~3,5 hónap.** Ez sokkal lazább, mint a
  Tippmixprónál látott 7 nap. Gyakorlatilag nem szorít: 500 000 Ft forgalom
  4,5 hónap alatt kényelmesen kirakható apró tétekben. **Ez teszi egyáltalán
  reálissá a „sok kis tét" stratégiát** — 7 nap alatt nem férne bele.

### Az odds megválasztása nem számít. A piac megválasztása igen.

`vegas_real.js` — odds 1.5-től 3.0-ig, minden más fix:

| odds | EV | % névérték | nullával zár |
|---|---|---|---|
| 1.50 | 72 481 | 72,5% | 0,1% |
| 2.00 | 72 622 | 72,6% | 1,7% |
| 3.00 | 73 057 | 73,1% | 7,9% |

**Az EV végig 72,5–73,1% — lapos.** A magasabb odds csak a bukás esélyét emeli
(0,1% → 7,9%) anélkül, hogy bármit hozna. Tehát: **fogadj a minimum 1,5 közelében**,
és ne hajszold a magas oddsokat. Ez ellentmond a megérzésnek, ezért érdemes kimondani.

### Ami viszont tényleg mozgatja: a margó

`vegas_boost.js` — ugyanaz a bónusz, ugyanaz a szabály, csak más piacon forgatva:

| margó | EV | % névérték | várható veszteség az 500k forgalmon |
|---|---|---|---|
| 6,5% (alsó liga, rossz piac) | 67 516 | 67,5% | 32 500 Ft |
| 5,5% (tipikus) | 72 441 | 72,4% | 27 500 Ft |
| 4,3% (jó piac) | 78 439 | 78,4% | 21 500 Ft |
| **2,0% (boost-piac)** | **89 951** | **90,0%** | **10 000 Ft** |

**A rossz és a jó piac közti különbség 22 500 Ft ugyanazon a bónuszon.** Ez a
teljes projekt legnagyobb egyedi tétele, és nem igényel se jóslást, se lay-oldalt —
csak azt, hogy a forgatás a szűk margójú piacon menjen.

A mechanizmus egyszerű: a margó nem a bónuszon csapódik le, hanem a **forgalmon**.
500 000 Ft forgalom × margó = a várható veszteség. Ezért ér a forgatási szorzó
csökkentése és a margó csökkentése pontosan ugyanannyit.

**Itt kapcsolódik be a meglévő boost-figyelő** (`boost_fetch.js`, `tippmix-boost-feed`):
Tippmixpro-oldalon már tudjuk mérni, melyik piac boostolt. Vegas-oldalon a
`couponType: 8` odds-booster létezik, de az API zárt (lásd fent) — ott egyelőre
**kézi ellenőrzés** kell, vagy Playwright.

Fontos korlát: a 2%-os margót a Tippmixpro boost-piacán mértük. **Hogy a Vegas
boost-piaca is ilyen éles-e, az mérve nincs** — ezt a felhasználónak kellene
ellenőriznie néhány konkrét árral, vagy Playwright-tal felderíteni.

## A Tippmixpro bónusz VALÓDI feltételei (részvételi szabályzat, 2026-09-17)

A felhasználó beküldte a teljes szabályzatot. **A két bónusz szerkezete gyökeresen
eltér** — nem ugyanannak a dolognak két mérete, hanem két különböző játék.

| | Vegas | Tippmixpro |
|---|---|---|
| bónusz max | 100 000 Ft | **5 000 Ft** |
| forgatás | 5× (500 000 Ft) | **2× (10 000 Ft)** |
| min odds | 1,5 szelvényenként | **2,0 eredő** |
| kötés | nincs előírás | **min. 3-as, 3 külön meccs** |
| határidő | ~4,5 hónap | **72 óra** |
| boost-piac forgatásra | valószínűleg igen | **KIZÁRVA** |

### A boost-stratégia itt nem működik — ez a legfontosabb

A szabályzat kizárja a forgatásból:

> az Oddspiramissal megtett fogadások. **az Oddsrakétával megtett fogadások.**
> a kombinációs és speciális fogadások… az azonnali kifizetéssel (cash out) érintett
> fogadások.

Az **Oddsrakéta = a boost-piac** — pontosan az, amit a `tippmix-boost-feed` mérése
szerint ~2%-os margóval áraznak. **A Tippmixpro pont ezt zárja ki a forgatásból.**

Ez visszamenőleg is tanulság: a fenti „boost-piacon 94,6%" sor a `bonus_ev.js`-ből
**a Tippmixpróra nem alkalmazható.** A boost-forgatás ötlete a Vegasnál élhet (ott a
szabályzat nem zárja ki), a Tippmixprónál nem. A kizárás léte egyébként azt is
megerősíti, hogy a könyv tudja, hogy a boost-piac a legjobb ár — különben nem tiltaná.

### A 3-as kötés a domináns költség

`tippmix_real.js` — 5 000 Ft bónusz, 2× forgatás, eredő odds 2.0, 5,5% margó lábanként:

| lábak | láb odds | szelvény esély | EV | % névérték |
|---|---|---|---|---|
| 1 (nem megengedett) | 2.00 | 47,3% | 4 545 | 90,9% |
| 2 (nem megengedett) | 1.41 | 44,7% | 4 104 | 82,1% |
| **3 (kötelező minimum)** | **1.26** | **42,2%** | **3 698** | **74,0%** |
| 4 | 1.19 | 39,9% | 3 347 | 66,9% |

**A 3-as kötés 90,9%-ról 74,0%-ra viszi az értéket.** Az ok: a margó lábanként
csapódik le, és mindhárom lábnak be kell jönnie. Egy 3-as kötésben a ház margója
nagyjából háromszor szedődik be ugyanazon a téten.

**Következmény: pontosan 3 lábat rakj, soha többet.** Minden további láb ~7
százalékponttal csökkenti az értéket. Ez az a szabály, amit egy kalkulátor magától
nem találna ki.

### Itt a NAGY tét a jobb — ellentétben a Vegassal

`tippmix_stake.js`. Az ok egy apró kitétel:

> Fogadásonként legfeljebb a bónuszösszeggel megegyező összeg számít bele a
> forgatási feltételek teljesítésébe.

Tehát egy 5 000 Ft-os tét **teljesen** beszámít, és mivel a forgatás csak 2×
(=10 000 Ft), **két darab 5 000 Ft-os fogadással kész.**

| tét | ennyi tét kell | EV | % névérték | medián | nullával zár |
|---|---|---|---|---|---|
| 1 000 Ft | 10 | 3 534 | 70,7% | 3 000 | 22,2% |
| 2 500 Ft | 4 | 3 705 | 74,1% | 5 000 | 49,6% |
| **5 000 Ft** | **2** | **3 901** | **78,0%** | 0 | 57,8% |

**Ez megfordítja a Vegasnál adott tanácsot.** Ott 500 000 Ft forgalmat kellett
kirakni, és a sok kis tét csökkentette a bukást az EV rontása nélkül. Itt a
beszámítási plafon miatt a kis tét **több forgatási kört** jelent ugyanazon a
bónuszon — több kör, több margó, kevesebb érték.

A választás itt valódi kompromisszum, nem egyértelmű:
- **5 000 Ft × 2 fogadás** → legmagasabb EV (78%), de 57,8% eséllyel nulla
- **1 000 Ft × 10 fogadás** → alacsonyabb EV (70,7%), de csak 22,2% eséllyel nulla,
  és a medián 3 000 Ft

A 72 órás határidő mindkettőt engedi (10 fogadás 3 nap alatt kirakható), de a
3-as kötés miatt minden szelvényhez 3 meccs kell, ami 10 fogadásnál 30 meccs.

### A magasabb eredő odds nem segít

| eredő odds | EV | % névérték | nullával zár |
|---|---|---|---|
| 2.0 | 3 860 | 77,2% | 58,1% |
| 3.0 | 4 002 | 80,0% | 71,9% |
| 5.0 | 4 081 | 81,6% | 83,2% |
| 10.0 | 3 783 | 75,7% | 91,7% |

Az EV 5.0 körül tetőzik, majd **visszaesik** — a 10× plafon (a nyereményegyenlegre
max a bónusz tízszerese mehet át) levágja a felső farkot. Közben a bukás esélye
91,7%-ra megy. **Nem éri meg magas oddsot hajszolni.**

### Amit a 72 óra jelent

Ez a szűk keresztmetszet. 3 nap alatt kell 2–10 szelvényt kirakni, mindegyiken
3 külön meccsel, és **a fogadásnak ki is kell értékelődnie** („nem a fogadás
pillanatában"). Hétvégi meccsnapra időzítve megoldható, hétköznap indítva szoros.

**Ez az egyetlen pont, ahol az automatizálásnak valódi haszna van a Tippmixprónál:**
egy 5 000 Ft-os bónusznál a 74% és a 78% közti különbség ~200 Ft — nem éri meg
rendszert építeni rá. A határidő figyelése és a 3 láb kiválasztása viszont
kényelmi kérdés.

## A Vegas margója — MÉRVE (2026-09-17)

A felhasználó beküldte a teljes 1X2 és O/U piacokat 8 EL meccsre. **Ez az első
referenciamentes mérés** — a margó (`sum(1/odds) - 1`) önmagában kijön, nem kell
hozzá összehasonlítás. Script: `vegas_margin.js`.

| piac | átlag margó | medián |
|---|---|---|
| 1X2 | **5,28%** | 6,17% |
| O/U 2,5 / 3,5 | **6,63%** | 6,69% |

Összevetés: Tippmixpro rendes 1X2 **4,3–6,5%**, Szuper odds **2,0–2,4%**,
Pinnacle ~3%.

**A Vegas 1X2 margója (5,28%) a Tippmixpro rendes sávjában van** — nem kiugróan
rossz könyv. Az O/U viszont egységesen ~6,6%, ami a rosszabb vége.

### Ez cáfolja a korábbi „a Vegas rosszul áraz" következtetést

Előző körben egyetlen szelvényből (6,50 vs 8,00) arra jutottam, hogy a Vegas
alapára ~19%-kal rosszabb. **A teljes piacok ezt nem támasztják alá.** A Salzburg
1X2 lába a Vegasnál 2,16, és azon a meccsen a margó mindössze **2,98%** — a
legalacsonyabb a mintában.

Tehát a 6,50-es kombinált alapár **nem magas 1X2-margóból jött**, hanem a három
láb *együttes* árazása volt konzervatív. A Bet Builder korrelációkezelése a
különbség, nem az alappiac margója. **Az egymintás következtetés téves volt** —
pontosan az a hiba, ami ellen a `README.md` „Ha új ötletet tesztelnél" szakasza
figyelmeztet.

### Az „Odds+" jelölés

A képen két meccs visel `Odds+` címkét. Azoknál a margó valóban alacsonyabb:

| | 1X2 margó |
|---|---|
| Odds+ meccsek (2 db) | **3,95%** |
| sima meccsek (6 db) | 5,72% |

1,77 százalékpont különbség. **De a minta nem tiszta:** a legalacsonyabb margójú
meccs (Levszki–Salzburg, 2,98%) *nincs* megjelölve. 8 meccs kevés ahhoz, hogy az
`Odds+` címkét megbízható szűrőnek tekintsük — érdemes újramérni egy nagyobb
meccsnapon (`vegas_oddsplus.js`).

### A bónusz újraszámolva a mért margókkal

`vegas_bonus_final.js` — 100 000 Ft, 5× forgatás, odds 1,5, 2 000 Ft-os tétek:

| hol forgatod | EV | % névérték | veszteség az 500k-n |
|---|---|---|---|
| O/U piacon (6,63%) | 66 853 | 66,9% | 33 150 Ft |
| 1X2 átlagon (5,28%) | 73 662 | 73,7% | 26 400 Ft |
| Odds+ meccseken (3,95%) | 80 291 | 80,3% | 19 750 Ft |
| a legjobb meccsen (2,98%) | **85 116** | **85,1%** | 14 900 Ft |

**A piacválasztás értéke 18 391 Ft** ugyanazon a bónuszon. Ez valamivel kisebb,
mint a korábbi 22 500 Ft-os becslés, de nagyságrendben ugyanaz — **és most már
mérésen áll, nem feltevésen.**

Két konkrét szabály jön ki belőle:

1. **Ne O/U-n forgass.** Egységesen ~6,6%, ez a legrosszabb választás: 6 800 Ft-ba
   kerül az 1X2 átlagához képest.
2. **1X2-n forgass, és a szűk margójú meccseket válogasd.** A 2,98% és a 6,54%
   közti szórás a mintán belül is jelentős — meccsválogatással ~11 000 Ft nyerhető
   az 1X2 átlagához képest.

Ez pontosan az, amit egy figyelő script tud: minden meccsre kiszámolja a
`sum(1/odds)`-ot, és megmondja, melyiken érdemes a forgatást letolni. **Nem
jóslás, csak számolás** — a margó a fogadás pillanatában ismert.

### A végső kép

| | Tippmixpro | Vegas |
|---|---|---|
| bónusz névérték | 5 000 Ft | 100 000 Ft |
| tényleges érték | ~3 900 Ft | **66 900 – 85 100 Ft** |
| mi dönt | 3-as kötés (fix) | **hol forgatod** (befolyásolható) |
| boost forgatásra | kizárva | nem tiltott |

A Vegas bónusza **17-22-szer** nagyobb tétel, és — a Tippmixpróval ellentétben —
a kimenetel érdemben befolyásolható. **Az automatizálás itt térül meg, sehol
máshol.**

## Nyitott kérdés — a felhasználónak szól

Az egész irány azon áll vagy bukik, hogy a Vegas **nem szegmentálja-e el** a
felhasználót a promóktól. Erre a repóból nem lehet válaszolni, csak a saját fiókból.
A kérdések a session összefoglalójában vannak.
