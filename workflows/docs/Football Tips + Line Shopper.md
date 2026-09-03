# Football Tips + Line Shopper.json

**Deployed inactive as `KntZP0zp0O1q8mn5`.** Own use. Supersedes `Odds Line Shopper.json`
(kept as the price-only version); this one adds the model's opinion on every match.

**Superseded by `Betting Slate Builder.json` + `Slip Builder.json`** — see [Betting Slate Builder.md](Betting%20Slate%20Builder.md#superseded). Its `Config`, `Fetch History`, `Build Model` and `Fan Out Leagues` nodes are reused verbatim there. Still deployed and still works; kept for reference.

Self-contained: downloads two seasons of results for five leagues from football-data.co.uk
(free, no key), computes Dixon-Coles team strengths in a Code node, fetches current odds
from The Odds API, and sends one Telegram message per run with a tip per match plus where
the best price is. Twice daily (09:00, 18:00) plus manual. Minimum odds 1.30 per the
user's requirement.

**What the model is actually worth, measured** (walk-forward, 1417 matches):

| | hit rate |
|---|---|
| Random | 33.3% |
| Always home | 43.8% |
| **This model** | **49.6%** |
| The bookmaker | 54.6% |

So the model genuinely beats guessing — but not the market, and the ~6% margin sits on top
of that gap. Tips are decision support, not an edge. The sticky note and the message footer
both say this; do not quietly drop that framing in a later edit.

**Calibration is the model's real strength** and why the tips are worth reading:

| model says | reality |
|---|---|
| 37.5% | 38.5% |
| 44.6% | 49.1% |
| 53.9% | 57.2% |
| 62.8% | 62.7% |

It errs toward *under*-confidence, which is the safe direction.

**The confidence flag inverts naive intuition, deliberately.** A tip is marked 🔴 ALACSONY
when the model disagrees *most* with the market, not least. Measured basis: outcomes where
the model saw >10pp more than the market came in at 25.0% actual versus the model's 35.5%
and the market's 21.1% — the market was closer. Average model-market divergence is 6.98pp
overall but 14.43pp among the outcomes a naive EV filter would select, i.e. selecting on
divergence selects error, not information. Betting the model's own top-ranked quartile
returned −17.7% while its bottom quartile returned +1.4%. Hence: agreement = confidence.

**A 2.0–2.5 odds band showed +5.1% ROI and was deliberately NOT shipped as a feature.**
t = 0.89 (needs 1.96), 95% CI −6.1%…+16.3%, and the two halves split +14.7% / −4.5%. It is
noise. Do not resurrect it without ~1800 more tips.

**Setup:** The Odds API key in a Query Auth credential (`apiKey`) on `Fetch Odds`; Telegram
credential on `Send Telegram`; `TELEGRAM_CHAT_ID` env var. 2 runs/day × 5 leagues ≈ 300
requests/month against the free tier's 500. (Corrected in the Betting Slate Builder doc:
this figure ignored the region multiplier — the real Odds API cost is markets × regions,
not 1 per request.)

**Season codes are computed, not hardcoded** — `Config` derives `2627`-style codes from the
current date, rolling over in August. No annual edit needed.

**Nothing is dropped silently.** Three separate report lists: `unmatched` (team name the
alias table missed — extend `ALIAS` in `Generate Tips`), `too_thin` (a team with <8 matches,
normal in early season for promoted sides), and `odds_errors`. All three surface in the
Telegram message.

**Tested before deploy** against real CSVs (1849 matches, 110 teams parsed) and shaped odds
payloads: happy path, unmatched teams, thin-data teams, HTTP 401, rate-limit 429, empty
array, non-array body, no model, and kickoff outside the window. Probability sums verified
to 100% for both model and de-vigged market. Not yet run live — needs the API key.
