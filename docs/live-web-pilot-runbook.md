# Running the live-web pilot

How to take one bounded pilot pass from a clean checkout to a graded report,
for the [live-web performance baseline](performance-baseline.md) (#223), and
what this session established before anyone spends money on it (#227).

The pilot is **six commands, once each**: four initial hunts plus the two fixed
follow-ups. It is the only paid step in the four-ticket plan, and the three
baseline passes it informs need **separate post-pilot authorisation**.

## Before you spend anything

Run these in order. Each is free, and each has caught something real.

```sh
# 1. Everything that does not need the app, plus the measured launch itself.
pnpm test && pnpm typecheck && pnpm lint
pnpm test:e2e e2e/live/measuredLaunch.e2e.test.ts

# 2. The whole capture-to-report path, scripted model, local pages, no spend.
pnpm test:e2e e2e/live/pilotVerification.e2e.test.ts

# 3. The source pages, through the real embedded browser, production settings.
BINGBONG_ENV_FILE=/absolute/path/to/.env pnpm live:preflight

# 4. What the keys claim that could have moved since they were written.
pnpm live:keys --live-facts
```

### The two environment traps

**`.env` does not exist in a git worktree.** It is gitignored, so it lives only
in the main checkout. A measured launch resolves production routing through it
and fails with `real-model evaluation needs production orchestrator routing`,
which reads like a broken suite rather than a missing file. Point at the real
one:

```sh
BINGBONG_ENV_FILE=/home/you/Projects/bingbong/.env pnpm test:live
```

**The machine needs to be idle.** Each hunt launches its own app and drives it
with synthetic input, which goes to whichever window has OS focus. Check for a
competing Electron or Xvfb run before starting, including other agent sessions.

## Running the pass

```sh
BINGBONG_ENV_FILE=/absolute/path/to/.env pnpm test:live
```

One pass per invocation, by design — there is no repeat flag, because a
campaign that can be started by passing a number is exactly what the separate
authorisation exists to gate.

The set id defaults to a timestamp. Name a pass only when you mean to
(`BINGBONG_LIVE_SET_ID=…`), and only with an id nothing has used: a capture
identity is claimed once and never reused, so a repeated id fails the pass as
`measurement_failed` before anything launches.

What the suite asserts is that the pass was **measured**, never that it went
well. A hunt the assistant gets wrong is the finding the study exists to
record, not a red test. Only broken measurement fails it.

The set lands at `e2e/live/artifacts/<setId>.json`, beside the per-hunt capture
directories it names. Both are gitignored.

## Grading and reporting

```sh
# 1. A human grades every slot at the Grading Bench. It opens on a setup page
#    that proposes the newest set with ungraded slots, the reviewer from
#    git config user.name, and the grades file derived from both. Check them,
#    then press Start. One grades file per reviewer.
pnpm live:review

# 2. Describe the keys to the report. Writes into the gitignored private root.
pnpm live:keys --out=e2e/live/private/key-manifest.json

# 3. The compact report. This one is committed.
pnpm live:report \
  --capture=e2e/live/artifacts/pilot-1.json \
  --keys=e2e/live/private/key-manifest.json \
  --grades=e2e/live/private/pilot-1-grades-<you>.json \
  --format=markdown --out=e2e/live/reports/pilot-1.md
```

The bench builds the key manifest in memory, so grading needs no `live:keys`
run; the report does. A second reviewer starts the bench under their own name,
which gives them their own file, and the setup page offers the first reviewer's
file to compare against — preselected when it is the only one. The bench shows
it slot by slot only after their own Grade for that slot is saved. The bench is
described in [live-web-reporting.md](live-web-reporting.md#grading-at-the-bench).

### Grading is the bottleneck, not the model

**68 checks.** 56 across the four initial hunts (10 / 17 / 14 / 15) and 12
across the two follow-ups (6 / 6). Nothing in this path grades anything: there
is no automated judge, and no code path from a `done` outcome or a proposed
`completed` Run Resolution to a pass. Until a human grades at the bench the
report shows zeros over full denominators, and **that is correct output, not a
broken run**. Budget the review as a work item.

**Read each key's `constraints` before judging its checks.** Check ids come
only from required facts, pitfalls and uncertainties — the things answerable
yes/no about the Answer in front of you. Some `constraints` nonetheless decide
verdicts rather than describe procedure, and ticking all 68 boxes without
opening them yields a complete, well-formed, wrongly-graded record. That is the
one failure neither the parser nor the corpus test can see.

## What was established before the first paid run (#227)

### The key recheck: no revision required

Every scoped fact still reads as the key records it, rechecked 2026-09-10
against its primary source. Eurostar's allowances and the guitar exception — the
only facts the corpus marks as able to move — are verbatim unchanged, as is the
museum record's genuine dating tension between its `circa 1962` field and its
"probably made in 1938 … possibly also with adaptations in the 1960s"
description. Detail is in the gitignored private root, since it quotes key
material.

### Embedded-browser access: all nine pages reach and render

Checked through the real pane under production settings and ad blocking,
outside any measured Session and on a profile that is thrown away, so nothing
seeds an attempt. No page redirected; all nine rendered.

| Source | Rendered | Notes |
| --- | --- | --- |
| raspberrypi.com product + 2 documentation pages | 5.4k / 36k / 146k chars | consent banner on both documentation pages |
| rmg.co.uk H4 and carrying-case records | 3.4k / 3.1k chars | consent banner; client-rendered Beta pages, and they do populate |
| eurostar.com luggage + musical instruments | 11.7k / 3.6k chars | consent banner **and** login UI on both |
| jpl.nasa.gov and nasa.gov 2013 releases | 7.5k / 7.7k chars | clean |

Consent banners are recorded, never clicked: accepting one would both change
the site's behaviour for a state the measured attempt will not have, and answer
a question the measured attempt has to answer for itself.

### Two defects the no-spend rehearsal caught

**A not-reached follow-up left no durable record.** The schedule decided
not-reached itself and returned before handing the command to the capture, so
nothing was written; the reason (`session_lost`, `awaiting_help`,
`run_active`, `initial_not_accepted`) existed only in memory and died with the
process, and the report filed the slot as `unaccounted`. Fixed in #225 at
`176efc7`: the command is always handed over, and the host records its own
refusal.

**A measured launch never came up.** `Target.attachedToTarget` reports a target
when it is *created*, before it navigates, so its url is `''`; the harness
recorded that once and never updated it, while every target predicate matches
on url. The dashboard was therefore invisible for the lifetime of the harness.
Whether that race is lost depends on how busy the main process is when the
first window opens — a hermetic launch wins it, a measured one building its ad
blocker from the real filter lists loses it every time. Fixed at `296f6de`.

That second one had never been reachable before: `productionDefaults: true`
reaches `startHarness` from exactly two places, `capture.ts`'s measured branch
and the preflight, and every Electron suite written for #224 and #225 runs in
verification mode because measured mode needs real routing. **The pilot's first
action was code that had never run.**

## What the pilot will not be able to tell you

- **Complete spend.** Vision records carry request duration and no tokens, so
  vision usage is structurally `unavailable`. The daily ledger turns missing
  usage into zero and does not bind requests to an attempt, so per-attempt cost
  comes from raw `llm_round` records only. Whether the provider populates those
  is not established — the rehearsal's scripted model reports no usage at all,
  which is why any dollar figure must be a labelled partial subtotal naming the
  roles it does not cover.
- **Tail latency.** One pilot and three later repeats do not support a p95, and
  the report deliberately produces only min, median and max.
- **Startup cost.** Task Completion Time starts at the first accepted command,
  so a cold ad-blocker cache costs wall clock but does not inflate the measured
  number.
