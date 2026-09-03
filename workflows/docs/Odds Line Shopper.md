# Odds Line Shopper.json

**Deployed inactive as `N87XeBaSQD2u1SOW`.** Own use, not client work.

**Superseded by `Betting Slate Builder.json` + `Slip Builder.json`** — see [Betting Slate Builder.md](Betting%20Slate%20Builder.md#superseded). Still deployed and still works; kept for reference.

Reads h2h odds for five leagues from The Odds API, compares every bookmaker's price
for each outcome, and sends one Telegram message listing where the same bet is
available at a better price. Three triggers a day (08:00, 14:00, 20:00) plus manual.

**It does not predict anything, and that is the whole point.** An earlier version of
this build was a Poisson/Dixon-Coles value-betting model. It was backtested properly
before shipping and the results killed it:

| test | sample | result |
|---|---|---|
| Model vs market calibration | 1417 matches | log-loss 1.018 vs 0.980 — model worse |
| Betting the model's signals | 1417 matches | ROI −8.2%, and higher EV meant *worse* returns |
| Model picks in the 2.0–3.2 odds band | 1253 outcomes | ROI −15.9% vs −5.8% for betting the whole band blind |
| Model's own ranking, best quartile | 313 | −17.7% |
| Model's own ranking, worst quartile | 313 | **+1.4%** |

The model ranked *inversely*. Following it was measurably worse than betting at random
in the same odds band. Line shopping, measured on the same data, is worth **+3.79
percentage points** on identical bets — no forecasting involved, just a better price.
That is the only effect in this dataset that survived out-of-sample testing.

**Configuration lives in the `League Config` Code node**, not in credentials:
`myBook` (which book you'd otherwise use — defaults to `bet365`), `minGapPct` (2.0),
`minOdds`/`maxOdds` (1.5–6.0), `maxHoursAhead` (96). Tippmixpro is not in The Odds API
(Hungarian state monopoly), so `myBook` is a proxy for it; set it to a book you can
actually bet at and the number becomes exact.

**Setup before first run:**
1. The Odds API key (free tier, 500 req/month) into a **Query Auth** credential named
   `The Odds API`, parameter name `apiKey`, attached to `Fetch Odds`.
2. Telegram credential on `Send Telegram`, and `TELEGRAM_CHAT_ID` as an env var.
3. Run manually once. 3 triggers/day × 5 leagues = ~450 requests/month — just inside
   the free tier. Drop a league or a daily run if it gets tight.

**Two triggers feed `League Config`** — the documented convergence exception, only one
fires per execution. The real convergence point (`Compare Prices` + `Handle Fetch Error`)
goes through `Combine Branches`, a Merge with explicit `numberInputs: 2`.

**`Fetch Odds` uses `neverError` + `fullResponse`**, so a 401 or a rate-limit response
arrives as data rather than killing the run; `Compare Prices` reads `statusCode` and
pushes the message into the report's error list. A bad API key produces a Telegram
message saying so, not a silent empty run.

**Node logic was unit-tested before deploy** against six shaped payloads (happy path,
under-3 bookmakers, empty array, HTTP 401, kickoff outside the window, mixed batch),
with the gap and margin arithmetic checked by hand. The workflow itself has not been
run live — it needs the API key first.
