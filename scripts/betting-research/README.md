# Betting research scripts

Backtest harness built while designing `workflows/Odds Line Shopper.json`. Kept because
it answers "would this strategy have worked?" in about 30 minutes, before anything gets
built on top of the idea.

Plain Node, no dependencies. Data comes from football-data.co.uk (free, no key).

## Getting the data

```bash
mkdir -p data && cd data
for S in 2526 2627; do for L in E0 D1 SP1 I1 F1; do
  curl -s -o "${L}_${S}.csv" "https://www.football-data.co.uk/mmz4281/$S/$L.csv"
done; done
```

Lower divisions use the same pattern with `E1 E2 E3 EC SC0 SC1 D2 SP2 I2 F2 N1 B1 P1 T1 G1`.
Season codes are `YYZZ` — `2627` is the 2026/27 season.

## The scripts

| file | what it does |
|---|---|
| `parse.js` | CSV → match objects. Handles the UTF-8 BOM, `dd/mm/yyyy` dates, and the column order changing between seasons. Run directly to sanity-check a download. |
| `ratings.js` | Dixon-Coles time-weighted attack/defence strengths. Uses xG where the season provides it (2627+), goals otherwise. |
| `predict.js` | Poisson goal matrix with the Dixon-Coles low-score correction → 1X2, over/under 2.5, BTTS. |
| `backtest.js` | Walk-forward: rates each match using only prior data, scores the model against closing odds. Reports log-loss, Brier, and ROI by EV bucket. |
| `vs_human.js` | Compares model-selected bets against betting the same odds band blind. This is the one that showed the model ranking inversely. |
| `shopping.js` | Measures what line shopping is worth on identical bets. The one positive result. |

Run any of them from the `data/` directory:

```bash
cd data && node ../backtest.js
```

## What these measured

Findings that shaped the workflow, so they don't get re-litigated:

- **The model does not beat the market.** Log-loss 1.018 vs the market's 0.980 across
  1417 matches. Betting its signals returned −8.2%, and the higher-EV buckets did
  *worse* — the signature of a model that is wrong where it is most confident.
- **In the 2.0–3.2 odds band specifically:** model picks returned −15.9%, versus −5.8%
  for betting the entire band blind. Its best-ranked quartile returned −17.7% while its
  worst-ranked quartile returned +1.4%. The ranking is inverted.
- **The bookmaker margin is the binding constraint.** ~3% at Pinnacle, ~6% at a typical
  book, 8–10% in lower divisions. Break-even needs an edge larger than the margin.
  Consensus-based selection found *zero* qualifying bets at average-book prices.
- **Goals are near-perfectly Poisson** (variance/mean = 0.993), which is why there is so
  little structure left to model. Corners are more over-dispersed (1.214) but the CSVs
  carry no corner odds, so that is untested rather than ruled out.
- **Line shopping is worth +3.79 percentage points** on identical bets, with a better
  price available in 84% of cases. No forecasting involved.

## If you want to test a new idea

Copy `vs_human.js` and change the selection rule. Keep the structure: walk-forward
ratings, an explicit baseline to beat, and a control that inverts the rule — if betting
*against* your signal does better, the signal is backwards. That control is what caught
the model here.

Watch for two traps that produced false positives during this work:

1. **`MaxC` odds are not a real price.** The best-of-all-books column looks profitable
   because it is whichever book was most wrong, and it would be limited immediately.
   Test at `AvgC` if you intend to bet at one ordinary book.
2. **CLV against a different book's closing line is not CLV.** Comparing `Max` to
   Pinnacle's close showed +13% "CLV" alongside −9.5% actual returns.

## Accumulator scripts

Added while building `workflows/Slip Builder.json`.

| file | what it does |
|---|---|
| `acca.js` | Margin compounding across leg counts. Run it to see why fewest-legs wins. |
| `slip.js` | The slip-building algorithm, identical to the `Build Response` node. |
| `slip_test.js` | Targets 1.5x–500x, parameter combinations, edge cases, invariant checks. |
| `slip_proof.js` | Forces different leg counts at the same target and compares expected value. |
| `cap_check.js` | Before/after for the @5.00 soft odds ceiling, 3x–500x. |

`slip_test.js` and `slip_proof.js` generate their own synthetic slate — no data download
needed:

```bash
node slip_test.js
node slip_proof.js
```

### What these established

- **Margin compounds per leg.** At 8% per leg, fair value retained is 85.7% (2 legs),
  79.4% (3), 63.0% (6), 54.0% (8). `slip_proof.js` confirms it empirically: EV 0.8605 at
  2 legs vs 0.7984 at 3, matching `1/1.08^n`. This is why the algorithm returns at the
  smallest workable leg count.
- **Stratified pool selection is required.** Capping the candidate pool by quality alone
  drops every high-odds leg, and targets of 50x+ become unreachable. Keep the band split.
- **Fewest-legs needs an odds ceiling to be safe.** On its own it happily picks one extreme
  leg: `/szelveny 10` returned `1.34 × 7.32` before the cap. Since `tippmixRatio()` is only
  calibrated to 6.0 and the model's ranking is inverted, a @7+ leg is a guess wearing a
  price tag. `buildSlip` now searches under a soft @5.00 cap first and only lifts it if the
  target is otherwise unreachable. Run `cap_check.js` for the before/after.
  The cap **costs EV where it binds** (20x: 0.8601 → 0.7990) — that is the accepted trade,
  not a regression. Do not "restore" the uncapped behaviour to win those points back.

### A trap that cost a debugging cycle

`slip_test.js` originally generated odds as `fair * 1.08`, which hands the *bettor* an 8%
edge instead of the book. Under that data more legs looked better, appearing to contradict
the margin theory. Margin means `fair / (1 + margin)` — odds **below** fair. If a result
here ever suggests more legs beat fewer, check this first.
