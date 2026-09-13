# Betting Slate Builder.json + Slip Builder.json

**Deployed inactive as `tB0nXG5lZVWwn7UP` (slate) and `2RQIK9uprRkTlpnm` (slip).** Own use.
These two supersede `Football Tips + Line Shopper.json` and `Odds Line Shopper.json` —
see "Superseded" below.

A slip builder: you send `/szelveny 10` on Telegram and get a ~10x accumulator back.
The slate workflow runs once daily and writes every candidate leg to the `bet_slate`
data table (`g6EjXi82TbW6VB91`); the slip workflow reads that table and answers in
seconds without recomputing anything.

**Split into two workflows because of latency and quota**, not tidiness. Rebuilding the
model, fetching odds and running the LLM on every `/szelveny` would take 30+ seconds and
burn the API quota per request.

## The leg-count rule is the core of the design

Accumulator margin **compounds per leg**. Measured, at ~8% per leg:

| legs | 2 | 3 | 4 | 6 | 8 |
|---|---|---|---|---|---|
| fair value retained | 85.7% | 79.4% | 73.5% | 63.0% | 54.0% |

So `Build Slip` searches leg counts in ascending order and **returns at the first count
that hits the target**, never going higher. Verified empirically: a forced 2-leg solution
returned EV 0.8605 and a 3-leg one 0.7984 — matching `1/1.08^n`. Do not "improve" this by
searching for a better-scoring combination at a higher leg count; that trades a real,
measured loss for a cosmetic gain.

## …bounded by a soft @5.00 odds ceiling (added 2026-09-02)

Fewest-legs on its own picks an *extreme* leg. Before this change `/szelveny 10` returned
`1.34 × 7.32` — a 13% shot carrying the whole slip. Two reasons not to trust a leg that
far out:

1. `tippmixRatio()` is calibrated on **1.3–6.0 only** (20 real prices). Above that the
   quoted Tippmix odds is extrapolation, not measurement.
2. The model's ranking is **inverted** (`vs_human.js`: best quartile −17.7%, worst +1.4%).
   There is no basis for believing it picks high-odds legs well.

`buildSlip` therefore runs `search(cap)` **twice**: first with `maxLegOdds` (5.00), and
only if that finds nothing, again uncapped — the result then carries `capped_relaxed` and
the Discord reply says the ceiling had to be lifted. The cap is soft on purpose: it never
turns a solvable target into an error.

**This deliberately costs EV at some targets, and that is the trade, not a bug.** Measured
on the synthetic slate, 20x: 2 legs @5.15 (EV 0.8601) → 3 legs @3.85 (EV 0.7990). The
fewest-legs rule still holds *within* the cap. Low targets are untouched — 3x and 5x pick
the same legs as before. `cap_check.js` prints the before/after for 3x–500x.

Note this is the first *effective* upper bound in the system: `maxOdds: 15.0` in the Slate
Builder `Config` node is dead code, read by nothing.

**Pool selection is stratified by odds band, not by pure quality.** A pure quality sort
keeps only high-probability (low-odds) legs, which made `/szelveny 50` and `/szelveny 500`
unreachable during testing. `BANDS` in `buildSlip` keeps the best legs within each odds
band so every target stays reachable.

**One leg per match** (`usedMatches`) — correlation protection, and **confirmed against
the real book on 2026-09-13**. Two outcomes from one fixture are not independent, and
Tippmixpro does allow both on one slip — but it does not multiply the odds. Measured on a
live pair: the straight product was **9.16**, Tippmixpro quoted **5.25**, i.e. 57.3% of
the product, a **42.7% deduction**. The correlation only pays back 1.55× on the best pair
measured (draw + under 2.5, `same_match.js`), so the combination nets **−21.9%** against
betting the legs separately. The rule stays, and it is now measured rather than assumed.

**ALACSONY-confidence legs are excluded from slips.** Confidence is model/market
*agreement*, not divergence — see [Football Tips + Line Shopper.md](Football%20Tips%20%2B%20Line%20Shopper.md) for the
measurements behind that inversion. Re-measured 2026-09-12 across 25k legs: excluding
ALACSONY is justified (−8.3% / −10.5% / −18.8% in the three odds bands), but the **MAGAS
bonus was not** and has been removed — KOZEPES outperforms MAGAS in two of three bands.

## Leg selection uses market probability, not the model's (changed 2026-09-12)

`buildSlip` ranked candidates by `model_prob` and scored slips by the product of model
probabilities. Both now use `market_prob`, the de-vigged market probability the slate
already stores. `scripts/betting-research/market_ref.js` measured why, over 25k legs,
**within** each odds band (so the comparison is not just favourites vs longshots):

| tippmix band | top quartile by `model_prob` | bottom quartile | top by `market_prob` | bottom |
|---|---|---|---|---|
| 1.3–2.0 | −3.04% | **+0.75%** | **−0.61%** | −4.48% |
| 2.0–3.2 | −7.25% | **−2.47%** | **−3.72%** | −8.40% |
| 3.2–5.0 | −12.74% | **−10.73%** | **−5.71%** | −18.23% |

The model's ranking is inverted in all three bands — the legs it likes most return the
least. The market's ranking points the right way in all three. This is the same inversion
`vs_human.js` found on whole-match selection, now shown to apply *inside* the slip
builder's own candidate pool.

**The model's probability is still displayed, it just no longer decides.** The reply keeps
the `modell X% · piac Y%` line, because a user comparing the two is information. A missing
`market_prob` falls back to `1/odds`, never to `model_prob`.

**The displayed hit chance was also wrong, and by a growing margin.** `Bejovesi esely` and
the saved `bet_slips.hit_prob` were the product of model probabilities. On the real 145-leg
slate the old scorer overstated its own slips' chances by **11.5% at 3x rising to 41.3% at
100x**. Since `Bet Settlement` measures the realized win rate, it would have been measuring
it against a number the builder never actually believed. Expected value improved at every
target too (3x: 0.9241 → 0.9766; 20x: 0.8611 → 0.9227; 100x: 0.7870 → 0.8390), measured
with market probabilities on both sides.

**Verified**, all against the code read out of the deployed workflow JSON, not a copy:
`scorer_switch_test.js` (66 checks — the switch changes the chosen legs on all 6 targets
of the real slate, every invariant holds, `1/odds` fallback, and a decoy leg the model
rates 90% is correctly rejected in favour of two the market rates higher);
`slip_save_test.js` (140 checks — `/help` and `/slate` still character-identical to the
pre-change code, slip reply structure unchanged, every reply inside Discord's 2000-char
limit, displayed chance equals saved `hit_prob`); `slip_test.js`, `settle_test.js` (79) and
`settle_wf_test.js` (75) unchanged and passing.

**Not yet run as an n8n execution** — the deployed instance still carries the old node code.
See the handover steps in the chat response; the workflow file in this repo is ahead of the
instance until it is pushed.

## News: it excludes, it does not adjust

`Analyze News` (chainLlm **1.9** + lmChatAnthropic **1.3**) reads BBC + Guardian football
RSS (free, no key — 147 articles in testing, ~40 matching slate teams) and returns
severity-scored signals. `Apply News` then sets `news_flag`:

- `severity >= 2` + negative → `veto`, the leg is dropped from slips
- `severity == 1` → `warn`, allowed but shown with the reason
- otherwise `ok`

**News never modifies a probability.** There is no validated measurement for a
news→probability conversion, and an invented multiplier would damage calibration, which is
the model's only proven strength. Only legs backing the *affected team* are vetoed — a draw
or an over/under leg is untouched, since it does not back either side.

The whole branch is fault-tolerant: a failed or unparseable LLM response leaves every leg
at `news_flag: ok` and the slate still writes. `Build Report` surfaces the parse error.

## Quota — the binding constraint

**The Odds API cost = markets × regions**, not 1 per request. The earlier
`Football Tips + Line Shopper.json` README note claiming "≈300 requests/month" was wrong;
it ignored the region multiplier and the real figure was 600, over the free 500.

This build uses **1 region** (`eu`) and 3 markets across 5 leagues = 15 credits/run, once
daily = **450/month**. That is why the schedule is daily and the slip builder reads a cache.
Adding a region or a second daily run breaks the free tier. `Build Report` prints
`x-requests-remaining` and warns under 60.

**`btts` availability is not confirmed** for soccer in The Odds API docs. `Generate Legs`
requires ≥3 bookmakers per market and silently skips a market that is missing, so a
btts-less match yields 5 legs instead of 7 — not an error. `Build Report` prints the
per-market counts and says so explicitly when btts is absent.

## Tippmixpro odds are estimated, and the page says so

Tippmixpro is not in The Odds API (Hungarian state monopoly) and its site is a closed
EveryMatrix SPA marked `noindex` whose odds come from a private API — scraping it would
breach the terms and break on every frontend change. So `tippmix_odds = market_avg ×
(1 − tippmixHaircut)`, haircut **0.045** originally, tunable in the `Config` node — see the
recalibration below for why this changed. Every slip message states the odds are estimates
and tells the user to check before placing.

## Setup

1. The Odds API key → Query Auth credential, parameter `apiKey`, on `Fetch Odds`
2. Anthropic credential on `News Model` (`dyNNL1J6Pq1gEHW5` already exists on the instance)
3. Discord Bot credential on `Send Discord` (slate) — the slip builder needs no credential, it answers the webhook directly
4. `DISCORD_PUBLIC_KEY` env var (Developer Portal → General Information → Public
   Key) — **required**; the signature check fails closed without it. Optional
   `DISCORD_USER_ID` restricts the bot to you; anyone else gets a polite refusal
5. **`Slip Builder` must be activated** for the slash command to work; `Betting Slate
   Builder` needs activation only for the 08:00 schedule

## Tested before deploy

`Build Slip`, `Generate Legs`, `Parse Command`, and the news nodes were all run locally
against real data before going into nodes. Slip: 7 targets (1.5x–500x), leg-count minimality,
one-leg-per-match, veto exclusion, min-odds constraint, product arithmetic checked by hand.
Legs: 16 checks including probability sums = 1.0 for model and de-vigged market, btts-missing
(5 legs not 7), the 3.5 totals line filtered out, HTTP 401, unmatched teams, thin-data teams.
News: real BBC/Guardian RSS (147 articles), CDATA and plain-title parsing, plus veto/warn
logic and malformed-LLM fallback. Commands: 14 inputs including malformed, out-of-range, and
foreign-chat rejection.

## Superseded

`Odds Line Shopper.json` (`N87XeBaSQD2u1SOW`) compared prices across bookmakers, which the
Tippmixpro-only decision made pointless. `Football Tips + Line Shopper.json`
(`KntZP0zp0O1q8mn5`) is the direct ancestor — its `Config`, `Fetch History`, `Build Model`
and `Fan Out Leagues` nodes are reused verbatim here. Both are still deployed and still
work; delete them only on request. The four data tables from the abandoned value-betting
plan (`bet_team_ratings`, `bet_signals`, `bet_log`, `bet_config`) are unused by this build.

## typeVersion: telegramTrigger 1.5 fails, 1.2 works (verified 2026-09-02)

`Slip Builder` originally shipped with `telegramTrigger` at **1.5** — the version the
n8n-mcp catalog reports as current. It did not load in the UI. A probe workflow carrying
1, 1.1 and 1.2 side by side showed **all three load fine**, so the node is pinned at
**1.2**, the highest confirmed working version and the same era as the `telegram` action
node (also 1.2 here).

This is the same catalog-vs-instance trap documented in the main [README](../README.md)
for `lmChatAnthropic` and the Gmail nodes, now confirmed for a third node family. The
generalisation holds: **this instance's n8n-nodes-base is older than the catalog assumes,
and no MCP validator catches it** — the 1.5 workflow uploaded and validated clean. The
cheap fix is what was used here: upload one throwaway workflow with several candidate
versions stacked, and have someone open it once.

Also worth noting: the catalog's *other* two guesses in this project were right —
`dataTable` at 1.1 and `chainLlm` at 1.9 both loaded first time. The catalog is not
uniformly ahead — check, don't assume in either direction.

## Moved from Telegram to Discord (2026-09-02)

The user could not complete Telegram signup — an unskippable Premium promo blocked the iOS
app, and web.telegram.org routes the login code back through the app. The Bot API itself is
free (verified against Telegram's FAQ; the paid tier starts at 100k Stars and 100k MAU), so
this was an onboarding problem, not a cost one. Discord was chosen because the bot is
created entirely in a browser with no phone verification step.

**There is no official Discord trigger node** — only a sender (`n8n-nodes-base.discord`,
typeVersion 2). The community `n8n-nodes-discord-trigger` package is unverified, so the slip
builder uses a plain **Webhook node behind a Discord Slash Command** instead. No community
package, and the slash command gives typed argument fields (`/szelveny cel:10`) rather than
free-text parsing.

**`Verify & Parse` implements the Ed25519 signature check, and it is not optional.** Discord
signs every request and **deliberately sends a bad signature during endpoint registration** —
returning anything but 401 to that probe makes Discord reject the endpoint. The node rebuilds
an SPKI DER key from Discord's raw 32-byte hex public key, then verifies `timestamp + rawBody`.
This is why the webhook node sets `options.rawBody: true`: the signature covers the exact
bytes, so a re-serialised JSON body would not verify.

Tested with real generated Ed25519 keypairs: valid PING, forged signature, wrong public key,
missing env key, missing headers, and a tampered body all behave correctly (13 checks).

**`responseMode: responseNode`** so `Respond to Webhook` can return 401 as well as 200 —
a fixed-200 webhook would fail Discord's registration probe.

Discord's 3-second interaction deadline is comfortable here because the slip builder reads
the pre-built `bet_slate` table rather than computing anything. That latency argument was
already the reason for the two-workflow split.

**One rename bit during the port:** `Build Response` referenced `$('Parse Command')`, the old
Telegram node name. It was caught by grepping the node code for channel-specific references
before deploying, not by validation — `validate_workflow` does not check `$()` node names
against the node list, so a stale reference fails silently at runtime.

Verified pins for the new nodes: `webhook` **2.1**, `respondToWebhook` **1.4**, `discord` **2**
— all three probed in the UI, all catalog-current for once.

## Going live: what the first real runs taught (2026-09-02)

Both workflows are **active**. `Betting Slate Builder` runs daily at 08:00;
`Slip Builder` answers Discord slash commands. First clean slate: 115 legs across
23 matches, 0 unmatched teams, 482 of 500 API credits left.

**Credit cost is 10 per run, not 15** — 5 leagues × 2 markets × 1 region. The btts
market turned out not to exist on the `/odds` endpoint, which lowered the bill.
Daily runs cost ~300/month against the free 500.

**Node-source reading beat guessing, repeatedly.** Downloading the `n8n-nodes-base`
package and reading `dist/nodes/DataTable/` settled three things no MCP tool or
validator could: `table/clear` has no operation file (hence the error), the valid
`matchType` values are `anyCondition`/`allConditions`, and the valid conditions are
`eq`/`neq`/`isNotEmpty`/… — not the `anyFilter`/`notEquals` that were guessed first.
It also surfaced that `row/get` defaults to a **50-row limit** unless `returnAll` is
set, which would have silently fed the slip builder a sixth of the slate.

**`Clear Slate` is guarded as of 2026-09-06 — `Model Is Usable` sits in front of it.**
This was missing for four days after the incident that produced the rule. On 2026-09-02 an
HTTP 422 during the history fetch left the run failed, `Clear Slate` fired anyway, and a
143-row slate was wiped with the execution still reporting success. CLAUDE.md § Destructive
nodes was written that day; the guard itself was only added when `workspace-auditor` found
the JSON still unprotected — while the workflow was **active on a daily 08:00 cron**.

The guard is an IF between `Build Model` and `Clear Slate`, and all three conditions must
hold before anything is deleted:

| Condition | Why |
|---|---|
| `teams_rated > 0` | never wipe the slate for an empty model |
| `total_matches >= 200` | a truncated model does not justify deleting a working slate (the model was validated on 1849 matches) |
| `fetch_errors.length <= 2` | 1-2 misses out of the 10 CSV fetches is normal; 3+ is a systemic failure |

`Build Model` already throws when *no* CSV parses at all (its line 82), so the gap the guard
closes is **partial** failure — 5 of 10 leagues down produces a usable-looking model object
that is not actually usable.

**The false branch throws instead of NoOp-ing, deliberately.** CLAUDE.md says false → NoOp,
and this is the documented exception. Two reasons: an empty output stops the chain here
anyway (see the note below), so a NoOp would stop silently; and silence is precisely what
made the original incident invisible until the data was gone. `Skip Clear Slate` raises an
error naming `teams_rated`, `total_matches` and every fetch error, which makes the run red
in the execution list. Not deleting is half the fix — being loud is the other half.

The old slate survives a blocked run. Stale rows beat no rows.

**An empty node output stops an n8n chain outright**, and a stopped chain skips the
report that would explain why. `Clear Slate`, `Split Legs` and `Write Slate` all set
`alwaysOutputData` for that reason. `deleteRows` returning `[]` when nothing matches
is the specific case that bit.

**A webhook node created through the API gets no `webhookId`**, and without one n8n
never registers the endpoint — the workflow reports `active: true` while every
request 404s. Generate a UUID into `webhookId` when building a webhook node
programmatically.

**Env vars are unreachable from Code nodes on this instance.** They run in a separate
task-runner container; a probe returned `process.env nem elerheto`, and
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` on the main container does not reach it. The
n8n Variables feature is licence-gated here (HTTP 403). The Discord public key is
therefore inlined in `Verify & Parse` — defensible because it is a verification key
published in the Developer Portal, not a secret. Anything that *is* secret (the bot
token, the Odds API key) stays in credentials.

**Discord's own API needs a `User-Agent`** of the form
`DiscordBot (url, version)` when registering slash commands, or Cloudflare rejects
the call with JSON error 40333.

**Slash commands are registered by `scripts/discord/register-commands.js`** (added
2026-09-02). It `PUT`s the **whole** command list, which is how Discord's API works —
an option left out of that file disappears from Discord. So the file is the source of
truth for the command surface, and it must stay in step with the option names
`Verify & Parse` reads (`cel`, `nap`, `max`, `min`, `mikor`, `orak`). The token comes
from `DISCORD_BOT_TOKEN` in the environment and is never written to disk.

## `nap:` picks one calendar day (added 2026-09-02)

`mikor`/`orak` only ever set an **upper** bound — `mikor:holnap` is "36 hours from now",
which still includes tonight. `nap:` sets **both** bounds, so `nap:2026-09-05` returns
only that Saturday's matches. It accepts `2026-09-05`, `09-05`, `9-5` and `5` (missing
parts fill in from today, Budapest), rejects impossible dates like `02-31`, and rolls to
next year when a bare day/month is already >180 days past.

**The timezone code computes a duration, never an absolute instant**, and that is
load-bearing. The `local` Date's epoch value is deliberately wrong; only its *local
getters* read Budapest wall-clock. So the day bounds are `now + (target - local)`, the
same trick the older `'today'` branch uses. Verified across the DST change: 2026-10-25
comes out **25 hours** long and the offset moves from 22:00Z to 23:00Z on the 26th.
Treating `new Date(y, m, d)` as absolute would skew by the server-vs-Budapest offset.

Bounds are floored to whole seconds — the millisecond part of `now` otherwise leaks in
and a match kicking off exactly at midnight falls outside its own day.

**A day outside the slate gets a list, not an empty reply.** The slate only reaches
~96 hours ahead, so asking for next week is the common mistake; the response names the
days that actually hold matches, with leg counts.

## Per-leg reasoning, computed not generated (added 2026-09-02)

Each leg carries `↳` lines explaining why it is there. They are **plain JavaScript over
fields the slate already stores** — no LLM call, so no tokens, no latency, and nothing
that can invent a fact the data does not contain. An LLM was priced (~2 Ft/slip) and
rejected on those grounds, not on cost: it would only reword the same numbers while
sounding more authoritative than the model deserves.

The lines are the break-even rate (`1/odds`), the model-vs-market gap, and the better
price elsewhere when it is ≥3%.

**The break-even number is printed but never judged.** No "worth it" / "not worth it"
label: on roughly two thirds of legs the model sits *below* break-even, so the label
would read "not worth it" on the very legs the builder just recommended — and the
model's ranking is inverted anyway (`vs_human.js`), so its EV verdict is not something
to surface. The number informs; the verdict would mislead.

**Formatting degrades by leg count, because Discord truncates at 2000 characters** and
`Format Discord` cuts from the *end* — which is where the total odds, the hit chance and
the warnings live. So: 1-4 legs get the full three lines, 5 legs get them joined into
one, and 6+ legs get none (there the raw list is the point, and every leg still shows
model/market/odds). News notes are also clipped past 4 legs. Verified against the real
slate's longest fixture name (40 chars, "Brighton and Hove Albion vs Leeds United") with
a news warning on every leg: 1-8 legs all fit.

The standing explanations that used to sit under every slip (selection rationale, the
margin table, the estimated-odds caveat) moved into `/help` — they were identical on
every response and were the reason long slips overflowed. Slip length went 1520 → 866
characters for a typical two-legger.

**Two ordering bugs worth remembering:** the HTTP Request node forwards none of its
input fields, so anything downstream needing the league had to pair against the
upstream node by index; and a verify-then-act chain must gate, or the later node
overwrites the rejection — a forged Discord signature returned 200 until
`Build Response` learned to return early.

## Tippmixpro odds are odds-dependent, not a flat haircut (calibrated 2026-09-02)

The initial 4.5% haircut was a derivation, not a measurement, and it was **wrong**.
Twenty real Tippmixpro prices across four matches, compared against the market
average the slate recorded for the same selections:

| market avg band | ratio to Tippmixpro | effective haircut |
|---|---|---|
| 1.0–1.8 | 100.6% | −0.6% (pays *more*) |
| 1.8–2.4 | 101.6% | −1.6% (pays *more*) |
| 2.4–3.6 | 100.0% | 0% |
| 3.6+ | 95.2% | +4.8% |

Overall mean 99.45%, and the relationship with odds is real: Pearson r = −0.768,
t = −5.08 at n = 20. Tippmixpro is **competitive at short odds and cuts hard at long
odds** — a single multiplier cannot express that, and the flat 4.5% under-estimated
every price below about 4.0.

`Generate Legs` now applies `tippmixRatio(odds) = 1.0469 − 0.01814 × odds`, clamped to
the measured range 1.3–6.0 rather than extrapolated. Residuals on the calibration
points are within ±2.9%, against 5–9% before. Re-calibrate if Tippmixpro changes its
margin structure; the sampling script pattern is in `scripts/betting-research`.

## A full PUT wipes credentials — always merge them back

The workflow JSON in this repo deliberately carries **no `credentials` blocks**, so a
plain `PUT` of the local file strips every credential the user attached in the UI, plus
resource-locator selections like the Discord guild/channel. This went unnoticed through
several updates because the workflow was inactive; activation is what validates
credentials, and it failed with *"Missing required credential"* the moment it mattered.

**Before any full-workflow PUT: read the live workflow, keep its `credentials` objects
and any `__rl` resource-locator values, and merge them into the payload.** Prefer
`n8n_update_partial_workflow` for single-node edits precisely to avoid this.

## One hostname is a single point of failure — football-data rate-limits per host (fixed 2026-09-08)

Ten consecutive runs failed — eight manual attempts plus the scheduled 08:00 runs on
09-07 and 09-08 — all with the same `Build Model` error: *"Egyetlen CSV sem dolgozodott
fel. Hibak: E0 2627: HTTP 503; …"* for all ten league/season pairs. The slate sat on
09-05 data for three days.

The cause was not an outage. `www.football-data.co.uk` and `football-data.co.uk` are the
same nginx server but **run on separate rate-limit bands**, and only the `www` one was
exhausted. Checked side by side at 16:01 UTC:

| | `www` | bare |
|---|---|---|
| status | 503 | 200 |
| `Retry-After` | 348 | — |
| `X-WS-RateLimit-Remaining` | absent | 999/1000 |

`Config` hardcoded the `www` host into every URL, so all ten downloads shared one point
of failure. Swapping the hostname would only move the problem — when the bare band
exhausts, the same failure returns mirrored. So `Config` now emits **both hosts** for
each league/season (10 items → 20, keyed `league|season`) and `Build Model` groups by
that key, taking the first usable response. A pair fails only if *every* host failed,
and the error then names each host with its `Retry-After`.

Note the fallback also covers a 200 that carries an unusable body — a truncated or
error-page CSV falls through to the next host rather than counting as success.

**The Clear Slate guard held throughout.** All ten failed runs stopped at `Build Model`;
the destructive node was never reached, and the stale slate survived. This is the same
shape as the 2026-09-02 incident where an HTTP 422 let a failed run wipe 143 rows — the
guard added in `57a0b08` is what made the difference.

### Verified

- Isolated logic test, 6 cases: www-down, bare-down, both-down, partial, 200-with-bad-CSV,
  config passthrough. All as expected, including 10 loud errors when both hosts fail.
- Live run against the real hosts before deploying: all 10 pairs recovered on the second
  host, 1898 matches, zero failed pairs.
- Execution `109` (2026-09-08 16:11 UTC), item counts node by node: `Config` 20 →
  `Fetch History` 20 → `Build Model` 1 (`total_matches: 1898`, `teams_rated: 110`,
  `fetch_errors: []`) → `Clear Slate` 145 deleted → `Write Slate` 60 written.
- Table state after: 60 rows, ids 1244-1303, 12 matches for the 09-11/09-12 round, zero
  `leg_id` overlap with the pre-run snapshot. The 145 → 60 drop is expected — the old
  slate covered 09-05 fixtures that have since been played.
- Pre-run snapshot of all 145 rows kept at
  `scripts/betting-research/snapshots/bet_slate_2026-09-08T16-10Z.json`. To roll back,
  re-insert those rows without `id`/`createdAt`/`updatedAt`.

The same `curl -s` trap bit the local research scripts on the same day: without `-f`,
curl writes the 489-byte HTML error page as a `.csv` and exits 0, so the failure only
surfaces at the parser. See `scripts/betting-research/README.md`.

## Results tracking lives in a third workflow (added 2026-09-12)

`Clear Slate` wipes the table every morning and the `/szelveny` reply went only to Discord,
so the system kept **no record of its own recommendations** and the win rate was not
measurable at all. [Bet Settlement.md](Bet%20Settlement.md) fixes that: `Slip Builder` now
saves every issued slip to `bet_slips` / `bet_slip_legs` (after `Respond`, so Discord's
3-second deadline is untouched), and a daily workflow settles them against
football-data.co.uk results.

`Build Response` changed in exactly one way — it emits `_slip` alongside `message`. **The
reply text is byte-identical** to before, checked against the pre-change code on 7 command
variants.

Two things from that build that apply back to *this* workflow:

- **`www.football-data.co.uk` now returns `302` to the bare host** (observed 2026-09-12,
  empty body + `Location`). The two-host fallback in `Config` absorbs it — the bare host
  serves a 200 — so nothing here needs changing, but note this workflow has **not been run
  since**. It also means `curl -sf` in local scripts writes a 0-byte file and exits 0;
  use `curl -sfL`.
- **The `ALIAS` table in `Generate Legs` is now shared**, extracted verbatim to
  `scripts/betting-research/teams.js`. A hand-copied version of it in the settlement code
  came out at 67 of 122 entries and silently dropped 5 Espanyol legs
  (football-data spells it `Espanol`). `settle_test.js` now fails if the two copies
  diverge, so **a new team has to be added in both places**.
