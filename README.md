# Betting System

Saját használatú sportfogadási rendszer: n8n workflow-k Discord-parancsokkal, plusz a
mögöttük álló kutatás.

**Nem kliensmunka.** 2026-09-17-én vált ki az `n8n-builder` repóból, ahol MVP-k készülnek
bemásolt állásokra. A git-történet át lett hozva, tehát a `git blame` végigmegy a
kiválás előtti munkán is.

## Szerkezet

```
research/    mérő- és backtest-scriptek (sima Node, nincs függőség)
workflows/   az n8n workflow-k JSON-ban
  docs/      egy doc workflow-nként: deploy id, kézi lépések, tesztek
```

## A workflow-k

| workflow | mit csinál |
|---|---|
| `Betting Slate Builder` | összeállítja a napi kínálatot, feltölti a `bet_slate` táblát |
| `Slip Builder` | a `/szelveny` Discord-parancs mögötti szelvényépítő |
| `Odds Line Shopper` | line shopping — a legjobb elérhető ár keresése |
| `Football Tips + Line Shopper` | tippek + árösszevetés |
| `Bet Settlement` | napi 10:00, elszámolja a kiadott szelvényeket, ROI-t jelent |

Részletek: `workflows/docs/`.

## A két mért tény, ami a rendszert alakította

**A modell nem veri a piacot.** Log-loss 1.018 a piac 0.980-jával szemben, 1417 meccsen.
A magasabb EV-jű fogadások *rosszabbul* teljesítettek — a modell ott téved, ahol a
legmagabiztosabb. Ezért a rendszer nem jóslásra épül.

**Ami viszont működik:** line shopping (+3.79 százalékpont azonos fogadásokon) és a
margó-választás. Mindkettő számolás, nem előrejelzés.

Részletes mérések: `research/README.md`.

## Ami le van zárva

**Nincs exchange-hozzáférés** (magyar lakcím, KYC) — a matched betting és az arbitrázs
nem járható. Ami lay nélkül is pozitív EV: ingyen tét, visszatérítés, befizetési bónusz.

A bónuszok gazdaságtana mérve: `research/VEGAS-FELDERITES.md`.

## Futtatás

A `research/` scriptjei sima Node-dal futnak:

```bash
cd research && node vegas_margin.js
```

A backtest-scriptek adatot igényelnek — a letöltő parancs a `research/README.md`
„Getting the data" szakaszában van. A `data/` CSV-k nincsenek verziókezelve, mert
bármikor újraszedhetők; a kézzel gyűjtött Tippmixpro-árak viszont igen, mert azok
mérések és nem reprodukálhatók.

## Figyelem

A workflow-k **élnek és futnak.** Ne aktiváld és ne futtasd őket vakon — a `Clear Slate`
minden reggel törli a teljes `bet_slate` táblát. A részletes szabályok a
[CLAUDE.md](CLAUDE.md)-ben.
