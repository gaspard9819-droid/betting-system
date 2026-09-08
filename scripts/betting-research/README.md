# Betting research scripts

Backtest harness built while designing `workflows/Odds Line Shopper.json`. Kept because
it answers "would this strategy have worked?" in about 30 minutes, before anything gets
built on top of the idea.

Plain Node, no dependencies. Data comes from football-data.co.uk (free, no key).

## Getting the data

```bash
mkdir -p data && cd data
# A ket hosztnev kulon rate-limit savon fut. Amelyik kimerult, 503-at ad
# Retry-After fejleccel, a masik kozben 200-at — ezert a fallback.
# Megfigyelve 2026-09-08: www 503 (Retry-After: 205), bare 200 (999/1000 kvota).
fetch() {  # fetch <url> <kimeneti fajl>
  for h in www.football-data.co.uk football-data.co.uk; do
    curl -sf -A "Mozilla/5.0" -o "$2" "https://$h/mmz4281/$1" && return 0
  done
  echo "  nem sikerult: $1" >&2; rm -f "$2"; return 1
}
for S in 2526 2627; do for L in E0 D1 SP1 I1 F1; do
  fetch "$S/$L.csv" "${L}_${S}.csv"
done; done
```

A `curl -sf` a `-f` miatt hibakoddal tér vissza 503-ra, igy a fallback elsul.
Enelkul a 489 bajtos HTML hibaoldal `.csv` neven landolna, es a parser ott hasalna el,
nem a letoltesnel — ez egy debugolasi kort mar elvitt.

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
  little structure left to model. Corners are more over-dispersed (1.174 measured over
  9290 matches) but carry almost no predictable structure either — see "Corners" below.
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

## Corners

`corners.js` — the zero-cost pre-screen that closed the corner question. Run it from
`data/` like the others.

The corner market looked like the one live lead left after the goals work: corners are
over-dispersed where goals are not, so there was more variance that the market might be
pricing badly. Testing that properly needs corner odds, which cost money —
football-data.co.uk carries `HC`/`AC` corner *counts* but no corner odds (every
over/under and Asian column is goals; confirmed in the official `notes.txt` 2026-09-08).
Paid sources exist: Footiqo gives one free Premier League season (~380 matches, closing
corner odds) and sells full history at €49.99; OddAlerts sells opening/closing/peak.

So `corners.js` answers the prior question for free — **is the corner count predictable
at all**, beating a baseline that uses no team information? If not, there is nothing for
a market to misprice and no reason to buy odds.

Same method as `backtest.js`: walk-forward ratings (weekly recompute, strictly prior
matches only), an explicit baseline, and the inverting control. Two differences:

- **Negative binomial, not Poisson.** Corners are over-dispersed (1.174), so a Poisson
  tail systematically understates the extremes. `nbTailOver()` was verified against a
  400k-draw Gamma-Poisson simulation — analytic and simulated tails agree to 4 decimals
  across all four lines.
- **Shrinkage prior is 1.0, unlike the goal ratings.** The `PRIOR_ATT = 0.92` in
  `ratings.js` exists because promoted sides underperform at scoring. There is no
  equivalent effect for corners — weak teams often concede *and* win more of them.

### What it established

**Corners are not predictable enough to bet.** Over 9290 matches (6 leagues, 4 seasons),
the model beat the league-average baseline by a log-loss margin of **0.0025–0.0048 per
match** depending on the line. That is real but negligible: a typical corner market
carries 5–8% margin, and an edge this size does not come close to covering it.

- Over% by line: 62.5% (8.5), 50.9% (9.5), 39.6% (10.5), 29.1% (11.5) — 9.5 sits nearest
  a coin flip, as expected for the usual main line.
- **The ranking is not inverted here** — unlike the goal model. The strongest signals beat
  the baseline by more than the middle half (+0.0080 vs +0.0002 at line 8.5), and the
  effect grows toward the outer lines (+0.0140 at 11.5 under). The model is directionally
  right; it is just far too small to pay for the margin.
- Interesting asymmetry: the **under** signal carries most of the edge at every line. If
  corners are ever revisited, that is where to look.

**Conclusion: don't buy corner odds data.** The €49.99 was the decision this script
existed to make, and the answer is no. Note what was *not* tested — whether the market
prices corners badly. That stays unknown, but it stops mattering: without a forecast that
beats a no-information baseline by more than the margin, a mispriced market is not
reachable.

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
