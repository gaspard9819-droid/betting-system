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
    # -L KELL: a www hoszt 2026-09-12 ota 302-t ad a bare hosztra, es -L nelkul
    # a curl 0 bajtos fajlt ir es 0-val ter vissza (a -f nem fog meg egy 302-t).
    curl -sfL -A "Mozilla/5.0" -o "$2" "https://$h/mmz4281/$1" && return 0
  done
  echo "  nem sikerult: $1" >&2; rm -f "$2"; return 1
}
for S in 2526 2627; do for L in E0 D1 SP1 I1 F1; do
  fetch "$S/$L.csv" "${L}_${S}.csv"
done; done
```

A `curl -sfL` a `-f` miatt hibakoddal tér vissza 503-ra, igy a fallback elsul.
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

## Settlement scripts

Added while building `workflows/Bet Settlement.json` — the workflow that measures whether
the slips actually win.

| file | what it does |
|---|---|
| `teams.js` | The `ALIAS` team-name table + `norm()`, extracted **verbatim** from the `Generate Legs` node. Shared by `settle.js` so there is one table, not two. |
| `settle.js` | Leg outcome from a final score, team-name matching against the CSV, accumulator settlement, and the win-rate/ROI summary. Identical to the `Settle Legs` node. |
| `settle_test.js` | 79 checks: every market, the four statuses, malformed input, and a real-data run over the 2026-09-08 slate snapshot. |
| `settle_wf_test.js` | 76 checks against the **actual** `Bet Settlement.json` node code (read out of the workflow JSON): download failures, one host down, one league down, multi-item, malformed legs, idempotency. |
| `slip_save_test.js` | 128 checks on `Slip Builder`'s `Build Response`. Proves the `_slip` output did not change the Discord reply — compares `message` character-for-character against the git HEAD version. |

```bash
node settle_test.js
```

### What these established

- **`Espanyol` vs `Espanol`.** football-data.co.uk spells Espanyol without the `y`. The
  first version of `settle.js` hand-copied the alias table and got **67 of the 122
  entries**, missing that one — and the substring fallback cannot bridge `espanyol` →
  `espanol`, so **5 legs went silently unresolvable on real data**. Hence `teams.js`:
  one table, and `settle_test.js` fails if it drifts from the node's copy.
- **Real-data settlement is provably correct**, by arithmetic rather than by inspection:
  over the 145-leg snapshot, `h2h` home+draw+away wins = 8+9+12 = 29 = the match count
  (exactly one outcome per match must win), and over+under = 21+8 = 29 likewise. A
  mis-settled leg breaks those identities, which is why the test asserts them instead of
  just counting hits.
- **`still_open` and `unresolvable` must stay separate.** Waiting for a CSV refresh and a
  broken team-name match look identical if you collapse them, and the second one would
  quietly corrupt the win rate. A leg is **never** defaulted to lost.
- **`curl -sf` is not enough any more.** As of 2026-09-12 `www.football-data.co.uk`
  returns **302** to the bare host. A 302 is not a 4xx/5xx, so `-f` does not trip: curl
  writes a **0-byte file** and exits 0, and the failure only surfaces at the parser. Use
  `curl -sfL`. This is the second time this shape of bug has cost a cycle here — the first
  was the 489-byte HTML error page landing as a `.csv`.

## Profitability review (2026-09-12)

Six scripts, one question each, asked after the settlement workflow made the win rate
measurable: *where could the slips actually gain?* All run from `data/`, over four full
seasons plus the current one (7228 matches, 6228 with a Pinnacle closing price). Pinnacle
closing is used as the fair probability throughout — it is the best public estimate, and
the model is measured against it, not the other way round.

| file | what it does |
|---|---|
| `odds_loader.js` | Shared loader: every odds column (opening + closing, 1X2 + O/U 2.5, Pinnacle/Avg/Max/B365) and `tippmixRatio()` verbatim from `Generate Legs`. Run directly for a coverage check. |
| `tippmix_cost.js` | Cost of one leg at Tippmix-estimated prices by odds band, the retained-value table by leg count, and a day-pool slip simulation. |
| `market_ref.js` | Which market reference to de-vig from; the model+market blend weight; the O/U 2.5 ranking check; leg ranking by `model_prob` vs market probability within a band. |
| `composition_sensitivity.js` | The composition result under three Tippmix price assumptions; the existing builder at caps 5 → 1.7; band × leg type; per season; opening vs closing. |
| `same_match.js` | Joint frequency of same-match outcome pairs against the product of their marginals. |
| `scorer_ab.js` | The whole `buildSlip` logic on real day pools, `model_prob` scorer vs market-probability scorer, leg-level realized ROI. |
| `scorer_switch_test.js` | 66 checks on the **deployed** `Build Response` node code after the switch to market probability. Run it from this directory. |
| `tippmix_direct.js` | **The one that fits the shipped curve.** Pairs the live slate run's own `market_avg_odds` with real Tippmixpro prices — no reference correction, no estimate. Extend this one with new prices. |
| `timing.js` | Does betting earlier pay? Opening vs closing price on the legs the builder actually picks, per market and odds band, with a paired significance test. Run from `data/`. |
| `tippmix_calib.js` | The withdrawn first attempt: matches prices against `fixtures.csv` averages. Kept because its overround and book-set findings stand. Run from `data/`. |
| `tippmix_calib_check.js` | The three things ruled out before believing that calibration: opening-vs-closing timing, book-set differences, sample representativeness. Run from `data/`. |
| `tippmix_refit.js` | The reference correction that turned out to be too small, plus sloped-vs-flat comparison. Run from `data/`. |
| `tippmix_ratio_test.js` | 28 checks on the **deployed** `Generate Legs` curve, against the directly-measured pairs. Run from this directory. |
| `ratio_impact_test.js` | 23 checks: what the new curve does to real slips, the leg-count optimum, and the ceiling justification. Run from this directory. |

### What these established

- **The model carries no information beyond the market.** Blending
  `p = (1−w)·market + w·model`, log-loss is minimised at **w = 0** for 1X2 and for O/U,
  against Pinnacle *and* against the plain average (0.9626 → 1.0042 as w goes 0 → 1).
  Every 0.1 of model weight makes it worse. Tuning `XI`/`RHO`/shrinkage cannot close a
  0.04 log-loss gap; the model's probabilities should not drive any decision.
- **The inversion holds on O/U 2.5 too**, and in every season: model EV > 0 picks
  return −8.6% vs −5.4% blind, and quartiles by model-market gap run −8.8% → −2.0%,
  monotonic the wrong way. The "bet against the model" control is −2.2% — better than
  blind, still negative, and mostly a repackaged favourite-longshot bias.
- **`model_prob` in the slip scorer picks the wrong legs.** Within every tippmix odds
  band (1.3–2, 2–3.2, 3.2–5; 25k legs), the top quartile by `model_prob` returns *less*
  than the bottom quartile (−3.0% vs +0.8%, −7.3% vs −2.5%, −12.7% vs −10.7%). The top
  quartile by market probability returns *more* than its bottom quartile (−0.6% vs −4.5%,
  −3.7% vs −8.4%, −5.7% vs −18.2%). `scorer_ab.js` runs the full builder both ways; at
  ~500 legs per cell it cannot resolve the difference (±5–7%), so the quartile table
  above is the evidence, not the A/B.
  **Applied 2026-09-13** to `slip.js` and the deployed `Build Response` node: `_q`,
  `jointP`, the single-leg fallback and the last-resort branch all use `market_prob`,
  falling back to `1/odds` and never to `model_prob`. The MAGAS bonus was removed with
  it (KOZEPES beats MAGAS in two of three bands); excluding ALACSONY was kept (−8% to
  −19% in every band). The model's probability is still shown in the reply, it just no
  longer decides. Side effect worth its own line: the displayed hit chance and the saved
  `bet_slips.hit_prob` were model-based and **overstated the real chance by 11.5% at 3x
  rising to 41.3% at 100x** on the real slate — the settlement workflow would have been
  scoring the win rate against a number the builder never believed.
- **Max vs Pinnacle vs Avg as the de-vig reference makes no difference**: log-loss
  0.9625 / 0.9626 / 0.9631, the class label changes on 8–10% of legs with no ROI
  difference. The "MaxC is not a real price" trap is about *prices*, not probabilities —
  `Generate Legs` can stay as it is.
- **Leg cost is strongly odds-dependent.** At tippmix-estimated prices vs Pinnacle fair,
  1.3–2.5 costs −1.9% to −3.5% per leg (realized ≈ 0%, n=5148); 4–5 costs −9% (realized
  −15%); 6+ costs −13% (realized −32%). Same shape in each of the four seasons. This is
  favourite-longshot bias at the average book, amplified by `tippmixRatio()`.
- **So the flat-8% margin in `acca.js` is wrong, and fewest-legs looked only
  conditionally right.** Under the 20-point curve, retained value appeared to *rise*
  with leg count at 20x+ (20x: 2 legs 83% vs 5 legs 86%). That was flagged as
  "measure more prices before changing the builder" — and the measurement,
  **done 2026-09-13, cleared the builder**: with 140 real prices the optimum is 2–3
  legs at every target, so the fewest-legs rule holds. See "Tippmixpro price
  calibration" below. The @5 cap is right under every assumption (leg cost rises
  monotonically with odds whatever the ratio).
- **1X2 favourites beat O/U legs in every band**: O/U EV(fair) is 1–1.5pp worse per leg
  (O/U overround 5.0% vs 4.2–4.9% for 1X2), and `tippmixRatio` is not calibrated on
  O/U at all. Under 2.5 is the worst leg type (−4.2% realized at 1.3–1.6, −12.8% at
  2.5–3.2). Draws at 2.5–3.2 are the cheapest leg in that band (−4.4% fair, −5.8%
  realized).
- **Same-match pairs are strongly correlated, and the book prices that in. Closed
  2026-09-13.** Draw + under 2.5 has joint/product 1.55 (+36% EV *if* the price were a
  straight multiply), home + over 2.5 for 1.6–3.2 favourites 1.20. Tippmixpro does allow
  two legs from one fixture, but quotes a combined price, not the product: measured live,
  product **9.16** → quoted **5.25**, i.e. 57.3% of the product, a **42.7% deduction**
  against a 1.55× correlation gain. Net **−21.9%** versus betting the legs separately.
  The `usedMatches` one-leg-per-match rule stays, now measured rather than assumed.
- **Timing: betting early is worth about +0.40pp per leg, and it is real.** The first pass
  called this "not a strategy" from a blind-betting view. Re-measured 2026-09-13 on the
  legs the builder *actually picks* (`timing.js`), it survives: paired test over 18653
  legs in the 1.3–2.5 tippmix band, **+0.403pp, t = 7.55**, positive in all five seasons.
  Paired means the same leg at two prices with the same outcome, which is far more
  sensitive than comparing two ROIs.
  **The mechanism is odds-dependent drift, not a general rule.** Short-odds prices
  *decay* toward kickoff as money arrives on favourites, long-odds prices improve:

  | band | 1X2 close/open | O/U close/open |
  |---|---|---|
  | 1.0–1.4 | 99.20% | 97.80% |
  | 1.4–1.8 | 99.56% | 98.67% |
  | 1.8–2.2 | 99.90% | 100.59% |
  | 2.2–3.0 | 100.37% | 103.03% |
  | 5.0+ | 103.24% | — |

  The builder picks short legs, so early wins *for it*. Anyone betting long legs should
  wait instead. Size: ~8 Ft on a 1000 Ft two-legger, ~800 Ft over 100 slips — real but
  small, and smaller than the 2.3% price-estimation error, so it does not justify
  changing behaviour on its own.
  **Caveat:** this measures the *market average*, not Tippmixpro. A monopoly book may
  move more slowly, in which case the effect is smaller or absent there. Testing that
  needs the same selection priced twice on the actual site.
- **Lowering `minOdds` below 1.30 gains nothing**: 1.1–1.3 home legs cost the same as
  1.3–1.6 (−1.4% fair, −0.5% realized).

### Tippmixpro price calibration (2026-09-13)

204 real Tippmixpro prices collected by hand, matched against `fixtures.csv` market
averages: **140 usable points**, 28 matches, 7 leagues. Replaces the 20-point curve that
every slip-composition conclusion had been resting on.

Raw data in `data/tippmix/`. Get the market side with:

```bash
cd data && curl -sfL -A "Mozilla/5.0" -o fresh/fixtures.csv https://www.football-data.co.uk/fixtures.csv
```

- **The first fit was wrong, and deploying it is what caught it.** It measured against
  `fixtures.csv` and converted to the slate's reference with a **1.30% correction
  estimated from an older snapshot**. Checked live afterwards, the raw ratio on the
  slate's own field was 98.53% on 1X2, not the implied 100.6% — the real gap is ~3.4%,
  and the curve overestimated prices by 1.9pp. **Rule: calibrate on the field the
  function is applied to.** A different source's average is a different book set, and
  the gap is bigger than it can be estimated to be.
- **The shipped curve is fitted directly**, on 45 pairs from the live 08:00 run matched
  to real prices (`tippmix_direct.js`, `data/tippmix/slate_pairs_2026-09-13.json`):
  1X2 `1.0711 − 0.02066 × odds` (n=27, r=−0.879, **t=−9.23**), O/U **flat 0.9992**.
  Accuracy as estimated-over-real price: direct 100.24% (2.31% mean absolute error),
  old curve 100.43% (3.21%), withdrawn fixtures-based 102.21% (4.26%).
- **O/U is flat on purpose.** Its slope is not significant (t=−1.86) and the discarded
  measurement gave the *opposite* sign on the same market. Two weak contradictory signals
  do not justify a line. On O/U the old curve's RMSE is marginally better (2.86 vs
  2.96pp) but it is biased −1.00pp while flat is unbiased — a systematic offset moves
  every slip the same way, scatter does not, so the test asserts on bias.
- **Tippmixpro's overround is 4.4% on 1X2**, against 8.0% for the football-data opening
  average. It is *narrower* than a typical book. Against the best available book it still
  pays 4.7% less on 1X2, 1.3% less on O/U — line shopping still wins, monopoly or not.
- **Only 28 of 204 matches paired against `fixtures.csv`**, and that is the ceiling, not a
  bug: it covers 4 days while the collected prices span several future rounds, and
  international and Hungarian fixtures are not in football-data at all. The direct method
  does not have this problem — it pairs against the slate, which holds the same fixtures.
- **The flat O/U curve removed a false positive** the sloped one created: 3.2+ legs went
  from looking +5.13% EV to −1.23% (realized −4.32%, n=243). Nothing there to chase.
- **Leg cost with the shipped curve**, which is what justifies the @5.00 ceiling:
  −0.23% at 1.3–2.0, −2.67% at 2.0–3.2, −5.64% at 3.2–5.0, −12.32% at 5.0–8.0, −21.15%
  at 8.0–12. Cost rises sharply past 5.0.
- **Live effect is small**: re-pricing the 145-leg slate moved prices +0.44% on average
  (+1.48% 1X2, −1.13% O/U), but changed the chosen legs at every target tested.

**Confirmed live on execution 137** (2026-09-13 13:21): 85 legs, clean table swap, zero
errors, and all 85 prices matching the new curve. 21 legs differ by 1 forint from a
hand-recomputation because the node multiplies the *unrounded* market average while the
stored `market_avg_odds` is rounded — inside the rounding band, not a defect.

**A measurement trap that run exposed.** Scored against the collected prices, the new
slate looked *worse* (3.93% vs 3.22% mean absolute error). It was not the curve: the
prices were collected around 08:00 and the run fetched odds at 13:21, by which point 60
of 85 market prices had moved, 1.34% on average and up to 9.9%. Holding the market price
fixed, the new curve wins 2.46% to 3.21% (1X2: 2.53% vs 3.96%). **Only compare prices
captured at the same moment** — which is why `tippmix_direct.js` reads one specific
execution's output rather than whatever the slate holds now.

**What is still unmeasured:** O/U has 18 direct pairs and none above 3.6; `btts` entirely
(the API does not serve it; unknown markets fall back to the 1X2 curve); and whether the
ratio drifts over time. The 1X2 fit is the solid one at t=−9.23. Two long under-2.5 legs
priced 22% above the market (RB Leipzig–Hamburg, Elversberg–Bayern) were hand-verified as
genuine against `fixtures.csv`, which suggests long `under` legs are where Tippmixpro is
most generous — worth more points if revisited.

### A trap in the day-pool simulations

Maximising joint probability at a fixed target product is the same as maximising EV, and
the EV here is `p_pinnacle × (AvgC × tippmixRatio)`. So the search selects the legs where
the average book disagrees most with Pinnacle — and the tippmix price is an *estimate*
built from that same average. The `EV(fair) ≥ 1.00` of the max-EV strategy in
`tippmix_cost.js` §6, and the 0.986 of the fewest-legs strategy, are that artefact, not
an edge. Use the band tables (no selection) for expected values and realized leg ROI for
selection tests. The same winner's curse is why the empirical simulation prefers fewer
legs while the analytic curve does not.
