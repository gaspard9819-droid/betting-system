# Bet Settlement.json

**Deployed inactive as `52wPklV2aISsPTRM`.** Own use. Pairs with
[Betting Slate Builder.md](Betting%20Slate%20Builder.md) — read that first; this workflow
only exists because the slate builder threw its output away.

Tracks the win rate of the slips `/szelveny` actually handed out: how many came in, what
came back in forints, and the ROI. Runs daily at 10:00, settles whatever the football
results now allow, and reports to Discord.

## The problem it solves: nothing was being kept

Before this, the system had **no memory of its own recommendations**. `Clear Slate` wipes
the whole `bet_slate` table every morning at 08:00, and the `/szelveny` reply went to
Discord and nowhere else. So the win rate was not merely unmeasured — it was
*unmeasurable*, and no backfill is possible. **The record starts the day the save branch
went live, and cannot be reconstructed for anything before it.**

Two new tables hold what used to be discarded:

| table | id | what it holds |
|---|---|---|
| `bet_slips` | `rWAlDpLh2eG5cpoe` | one row per slip issued — target, total odds, stake, status, payout, profit |
| `bet_slip_legs` | `VQWSxF1xp3YF0Jn6` | one row per leg, joined to the head by `slip_id` |

**Split head-from-legs on purpose.** A slip is an accumulator: the win rate is a property
of the slip, but *which leg broke it* is the question you actually ask afterwards. One
flat table could not answer the second question without re-deriving it.

`bet_log` was **not** reused despite being empty and available. It is shaped for single
bets (`signal_id`, `alerted_odds`, `clv_pct`) from the abandoned value-betting plan — one
row per bet, no way to express "these four legs are one slip".

## Every issued slip counts, at a flat 1000 Ft

Decided 2026-09-12. There is no "did you actually place it?" step, so the numbers measure
**what the system recommended**, not what the user's wallet did. A slip the user saw and
chose not to place still lands in the statistics.

The alternative (a `/megjatszott` confirmation command) was rejected as a per-slip chore
that would go unused, which would silently under-count instead. If the distinction ever
matters, `bet_slips` already has the `status` column to carry a third state.

Stake is **1000 Ft on every slip**, written by `Build Response`, so ROI is directly
comparable across slips. It is a column, not a constant — editing a row's `stake` makes
the settlement use the edited value.

## Saving happens after the response, not before

The save branch hangs off **`Respond`**, not before it. Discord's interaction deadline is
3 seconds; two data-table writes inside that window would eat into the reply. After
`Respond`, the reply is already out and the write costs the user nothing.

The chain is `Respond → Has Slip? → Prepare Slip Rows → (Save Slip | Save Slip Legs)`.

- **`Has Slip?`** gates on `_slip` existing. `/help`, `/slate` and every error message
  carry `_slip: null` and go to `No Slip To Save` — a NoOp, because nothing to save is
  not a failure here.
- **`Prepare Slip Rows`** splits the head from the legs onto two outputs. The `legs`
  array **must** be detached from the head: `autoMapInputData` treats every field as a
  column, and an array field would fail against `bet_slips`, which has no such column.
  It also throws if `leg_count` disagrees with the actual leg count — a mismatch there
  would make the later win rate wrong, so it fails loudly at write time instead.
- The two outputs go to **separate nodes with no convergence**, so there is no
  two-branches-into-one-node item loss to guard against.

`Build Response` gained exactly two things: a `slipRecord` that mirrors what was issued,
and `_slip` on the returned item. **The reply text is untouched** — verified character-for-character
against the pre-change code on 7 command variants (see Verified below).

The `slip_id` is generated in `Build Response`, not at save time, so a Discord retry
produces the same id rather than a duplicate row under a new one.

## Settlement: results come from football-data.co.uk, 1–3 days late

Same free source as the model, so no new API cost and no new key. The trade is latency:
the CSVs refresh about twice a week, so a Saturday match may not be settled until Monday.
That is why the workflow runs daily and re-checks rather than settling once.

The Odds API `/scores` endpoint would be near-instant but costs credits against the same
free 500/month the slate builder already spends ~300 of. Rejected on that basis, not on
capability.

**It runs at 10:00, two hours after the slate builder's 08:00.** Both hammer
football-data.co.uk, and the two hostnames share a rate-limit budget — running them
together is how you exhaust it.

### One leg, four possible verdicts

`settleLeg` returns `won` / `lost` / `still_open` / `unresolvable`, and the split between
the last two is the whole point:

- **`still_open`** — waiting. Match not finished, CSV not refreshed yet, league not
  downloaded. Normal, expected, silent.
- **`unresolvable`** — something is wrong: an unmatched team name, a bad kickoff, an
  unknown market, or a date mismatch. **Never silent** — every one appears in the Discord
  report by name.

Collapsing these two into one state is how a broken team-name match would quietly become
a wrong win rate. A leg that cannot be resolved is **never** guessed and **never**
defaulted to lost.

### Nothing can be settled from data that failed to arrive

This is the rule the 2026-09-02 incident bought (an HTTP 422 let a failed run wipe 143
rows). Applied here:

- A leg whose league has no usable CSV returns `still_open`, so it **cannot** be marked
  lost by a download failure. Verified: with all 10 downloads returning 503, zero legs
  were written and zero slips closed.
- **`Results Usable`** guards the writes — at least one league's CSV must have parsed.
  Its false branch **throws** (`Skip Settlement`) rather than NoOp-ing. This is the same
  documented exception as `Skip Clear Slate` in the slate builder, for the same reason:
  silence is what made the original incident invisible.
- A per-league failure does not stop the rest. With La Liga dead on both hosts, its 2 legs
  stayed open while 11 legs in other leagues settled normally.

**There are no destructive nodes.** The workflow only reads and updates — never deletes a
row. The slip history is the asset, so nothing in it is ever removed.

### A losing leg closes the slip immediately

`settleSlip` checks `lost` **before** `still_open`, deliberately. One dead leg kills an
accumulator, and that is knowable the moment it dies — no need to wait for the other legs.
A slip with one lost leg and three pending is `lost`, today.

The reverse never happens: an `unresolvable` leg blocks the slip from being called `won`,
because a slip cannot be a winner while one of its legs is unaccounted for.

Legs that closed on an earlier run are no longer in the `status = open` query, so
`Settle Legs` reconstructs them from `leg_count` minus the legs it can see. A leg missing
from the open set **can only have won** — a lost one would already have closed the slip.

## The win rate counts closed slips only

Open slips are reported separately. Folding them in would make a fresh slip look like a
loss, dragging the rate down every time a new one is issued.

`summarize()` returns `win_rate: null`, not `0`, when nothing has closed — a zero would
read as a measurement, and there isn't one. Same for `roi_pct` at zero stake.

The report also breaks down **by target band** (under 5x, 5–15x, 15–50x, 50x+), because a
3x and a 100x slip have nothing to say to each other in a single average. When the message
approaches Discord's 2000-character limit the band breakdown is dropped first — the
warnings live at the end and must not be the part that gets cut.

## The team-name table is shared, not copied

`Settle Legs` reuses the `ALIAS` table and `norm()` from `Generate Legs` **verbatim**, via
`research/teams.js`.

This was learned the expensive way in the same session. The first version hand-copied the
table and got **67 of 122 entries**. The gap included `'espanyol': 'Espanol'` —
football-data.co.uk spells Espanyol without the `y`, the Odds API spells it with, and the
substring fallback cannot bridge `espanyol` → `espanol`. Result: **5 legs silently
unresolvable**, on real data, in the first test run.

`settle_test.js` now **diffs the two tables and fails if they disagree**, so the next
divergence is a failed test rather than a wrong win rate. A new team means updating
`teams.js` and the node — the test enforces it.

The match is a four-step ladder, same as `findTeam`: exact, alias, normalised, then
substring at ≥4 characters. The substring step is loose enough that `Real` matches
`Real Madrid`; the `date_mismatch` check (CSV match day within ±2 days of kickoff) is what
catches a wrong pairing from that looseness, and it is tested.

## `www.football-data.co.uk` now 302-redirects (observed 2026-09-12)

New behaviour, and it affects the **already-deployed slate builder** too. The `www` host
returns `302 Found` with an empty body and `Location:` pointing at the bare host, which
serves the CSV with a 200.

Consequences:

- **The two-host fallback covers this without changes** — the bare host answers, so all
  five leagues load. Verified both ways: with `www` returning 302 on every league, all 5
  still loaded from the bare host.
- **It breaks `curl -sf` in local scripts.** A 302 is not a 4xx/5xx, so `-f` does not
  trip, and curl writes a **0-byte file** and exits 0. The download looks successful and
  the parser gets nothing. `curl -sfL` (follow redirects) is the fix; this cost a
  debugging cycle during this build, exactly like the `-f` trap documented for the 489-byte
  HTML error page.
- If both hosts ever return 302, the guard handles it: an empty body fails the
  usable-response check, all five leagues report errors, and **zero legs settle**.

Whether the n8n HTTP Request node follows the redirect is **not confirmed by execution**
— it follows redirects by default, and the fallback makes it moot either way, but the
slate builder has not been run since the change.

## Setup

1. ~~Discord credential + guild/channel on `Send Discord`~~ — **done 2026-09-15.**
   Credential `Discord Bot account`, guild `bet` (`1544693153938800702`), channel
   `általános` (`1544693155352412173`) — the same channel the slate builder posts to.
2. Activate for the daily 10:00 run. Until then, run it manually.

`Send Discord` is `onError: continueRegularOutput`: by the time it runs, the settlement is
already written, and a Discord outage must not fail the run or re-settle anything.

### The missing `resource` made it a channel-creating node

Worth its own note, because it passes validation and looks configured. The node shipped
without a `resource` key. The Discord node defaults to `resource: channel`, whose default
operation is `create` — so the UI showed **Channel → Create** with a `Name` field, and the
`content` expression was simply ignored (that operation has no message body). Picking the
guild in the UI then made it look finished.

Had it been activated in that state, the 10:00 run would have **created a new channel
named `általános` on the `bet` server every day** and posted no report anywhere. No error,
no warning — the wrong operation succeeds perfectly well.

**Rule: on a Discord node, write `resource` explicitly.** The one field whose absence
changes which operation runs is the one that is easiest to leave out. Compare against
`Betting Slate Builder`'s `Send Discord`, which carries `resource: message`, and whose
presence is exactly why that one works.

### The CSV body arrives as `data`, not `body` (execution 156)

`Settle Legs` unwrapped the HTTP response with `j.body !== undefined ? j.body : j`. The
n8n HTTP Request node returns a `text/csv` response under **`data`**. So `j.body` was
`undefined`, the whole response object fell through as the "body", and the
`typeof body !== 'string'` check rejected it.

Result: all ten requests returned `200 OK` with real CSV content, and all ten were logged
as `hasznalhatatlan valasz`. No league loaded, `Results Usable` took the false branch, and
`Skip Settlement` threw — **exactly as designed.** Zero rows written, loud failure. The
guard from the 2026-09-02 incident is what kept a fetch that "succeeded" from touching the
data.

**The test could not have caught it, because the test made the same assumption.**
`settle_wf_test.js` mocked responses as `{ statusCode, body }` and passed 76 checks against
a shape n8n never produces. A mock written from what the field *ought* to be called
validates the author's belief, not the integration.

Fixed on both sides: the node now accepts `data` or `body`, and the test feeds the real
shape, asserts that **both** forms load all five leagues, and asserts that an unknown key
correctly *fails* rather than silently passing. 81 checks.

**Rule: mock an HTTP response from a real execution's output, never from the field name
you expect.** Same family as the `curl -sf` traps in
[the research README](../../research/README.md) — a request that succeeds
while delivering nothing usable.

## Verified

**Execution 157 (2026-09-15 13:41) is the first green end-to-end run.** All five leagues
loaded, `fetch_errors` empty, and `Send Discord` returned a message object with `type: 0`
and `channel_id: 1544693155352412173` — a message posted to `#általános`, which is also
the proof it is no longer creating a channel. Both tables were empty, so the report read
"Meg nincs lezart szelveny" and zero rows were written — the correct output for an empty
history, not a no-op failure.

**Execution 156, four minutes earlier, failed — and that failure is worth keeping.** See
the `data` vs `body` section below. What was verified before either run:

- **`settle_test.js`: 79 checks pass.** All markets and their complements, the four
  statuses, team-name matching, accumulator logic, and the summary. Run it from
  `research/`.
- **Real-data proof, 145 legs from the 2026-09-08 slate snapshot against the downloaded
  CSVs: 145 settled, 0 unresolvable.** The arithmetic that makes this conclusive:
  `h2h` home+draw+away won = 8+9+12 = 29 = the match count (exactly one outcome per
  match), and `totals` over+under = 21+8 = 29 likewise. A silent mis-settlement would
  break those identities.
- **Workflow-level test, 81 checks** across the real CSVs: empty input, empty data-table
  rows (`{}` from `alwaysOutputData`), all-downloads-failed, one-host-failed,
  one-league-failed, multi-item (6 slips / 15 legs), four kinds of malformed leg,
  idempotency (two runs identical; a partially-settled slip settles the same), and the
  response body arriving as `data`, as `body`, or under an unknown key that must fail.
- **Live-data test, 13 checks**, freshly downloaded CSVs plus rows read back out of the
  real tables. Hand-checkable: Everton–Man United **2-2** → Over 2.5 won; Juventus–Milan
  **1-1** → Under 2.5 won; Hoffenheim–Dortmund **2-3** → home lost;
  Newcastle–Bournemouth **2-2** → away lost. The 3x slip (both legs in) paid 2990 Ft; the
  10x slip lost. Report: 50% win rate, +990 Ft, ROI +49.5%.
- **Deploy verified by read-back**: 17 nodes, 15 connections, zero parameter differences
  against the local file, `Combine Inputs` carrying `mode: append` / `numberInputs: 3`,
  and both table ids correct.
- **`Slip Builder` after its update**: `webhookId` `afc20897-…` and path `discord-slip`
  unchanged (a lost `webhookId` makes an active workflow 404 every request), 14 nodes,
  connections match, zero parameter drift.
- Test rows were inserted into the live tables, settled, and **deleted afterwards** —
  both tables are back to 0 rows, so the statistics start clean. Snapshot of the deleted
  rows was taken first.

### Robustness checklist

- **Multi-item input** — tested with 6 slips / 15 legs in one run, plus duplicate slips
  sharing identical legs (same legs must give the same verdict). No `$items(0)` or
  `itemMatching` assumptions; the HTTP responses are paired to leagues by index against
  `Config`, the same pattern `Generate Legs` uses.
- **Empty input** — `Get Open Slips` / `Get Open Legs` carry `alwaysOutputData`, and
  `Settle Legs` filters out the `{}` rows n8n emits for an empty table. Tested: 0 slips
  and 0 legs produces a sensible report, not an error.
- **Merge** — one convergence point, `Combine Inputs`, `mode: append` with
  `numberInputs: 3` **both written out** (the default of 2 would silently drop the third
  branch). It exists to order execution, not to carry data: the three branches have
  different shapes, so `Settle Legs` reads them by name with `$()`. `Config` taking both
  triggers is the documented multiple-trigger exception — one fires per execution.

## Open questions

- **Not activated yet.** Execution 157 proves the path works; the daily 10:00 schedule is
  still off. Every day it stays off is a day of slips that cannot be reconstructed later,
  because `Clear Slate` wipes the slate table at 08:00.
- **Never yet settled a real slip.** Both tables were empty on execution 157, so the
  settlement arithmetic has run on real CSVs but not on a real issued slip. The first
  `/szelveny` after activation is what closes that gap.
- **No `/eredmeny` command yet.** The stats are pushed daily; pulling them on demand would
  mean a new slash command in `scripts/discord/register-commands.js` plus a branch in
  `Slip Builder`.
- **Leg-level win rate is stored but not reported.** `bet_slip_legs` holds every leg's
  outcome, which is a far larger sample than the slips and would show whether the model's
  inverted ranking (`vs_human.js`) persists live. Deliberately left out of the report to
  keep it short.
