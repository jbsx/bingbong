# Bing Bong

Voice assistant with a live web-browsing dashboard. Local voice pipeline
(wake word, STT, TTS) + LLM agents (GLM-4.6 orchestrator, DeepSeek subagents)
driving a real embedded Chromium via CDP.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Testing

### E2E tests must run under Xvfb

Never run e2e tests against the developer's real display — Electron windows
would pop up on screen. Always use `pnpm test:e2e` (it wraps vitest in
`xvfb-run`). When invoking the e2e vitest config directly, wrap it yourself:
`xvfb-run -a -s "-screen 0 1280x800x24" vitest run --config vitest.e2e.config.ts`.
The launch harness (`e2e/electronApp.ts`) forces the X11/Ozone backend and
strips `WAYLAND_DISPLAY` so Electron binds to Xvfb even on Wayland sessions.

### Real-model evaluation is opt-in

`pnpm test:eval` (also Xvfb-wrapped) spends real model budget against the
developer's production routing (repo `.env` / exported env). It never runs in
CI or `pnpm test:e2e`. Scenario failures are recorded data, not suite
failures — only broken measurement (missing routing, a scripted model, a
missing run) fails the suite.

The release decision (#132) pools exactly three complete captures per side:
each pass writes its own immutable artifact under `e2e/eval/pools/<side>/`
via `BINGBONG_EVAL_REPORT=e2e/eval/pools/<side>/pass-<n>-<commit8>.json
pnpm test:eval` (a finalized capture is never overwritten). A capture taken
to answer one issue rather than the release decision lives beside the pools
as `e2e/eval/report-<issue>[-<tag>].json`; it is evidence on that issue, and
`pnpm eval:accept` never reads it. The baseline
pool is captured from the pinned pre-#114 tree (`2343a3c` worktree + eval
overlay, see #130); all candidate passes come from one candidate commit.
`pnpm eval:accept --regressions=passed` validates both pools' provenance
and writes `e2e/eval/decision.json` from pooled nearest-rank statistics —
pass-level percentiles are never averaged. The rounds gate (#134) judges
the global pooled median (no regression), the Direct Action and
Lookup-class pooled medians (strict improvement), and corpus-declared
structural ceilings per scenario (`expectedEffort` in
`e2e/eval/scenarios.ts`); pooled p95 is reported, never gated.

Two measurements ride every capture since #214, because the deadline work
(#215–#217) cannot be judged without them. `secondsPerLlmRound` is recorded
per Run and aggregated per Effort Tier (median and p95) in the report's
`aggregate` — a tier's active-work deadline is only its round budget
expressed in time, so it has to be derived from what a round of that tier
actually costs rather than picked. `deterministicAnswer` records, per Run,
whether the Answer the user heard was the deterministic fallback or one a
model round wrote; it comes from the pipeline's own flag on the Answer's
display event, never from matching the fallback's wording, so rewording
those product-owned sentences can never move the number.

The corpus crosses a deadline in exactly one place
(`deadline-ledger-revisions`): two ledger chains whose revisions never
certify, each revision served slowly. That slowness is the mechanism, not
an accident — at the corpus's measured round latency the 24-round
Investigation budget would bind first, and a Run that stops for
`budget_exhausted` measures nothing about deadlines. The rule when either
number moves: `LEDGER_REVISION_DELAY_MS` (`e2e/fixtureServer.ts`) has to
stay above the tier's implied seconds per round (its deadline over its
round budget — 300 s ÷ 24 = 12.5 s for Investigation) minus the
orchestrator's own round latency, which `secondsPerLlmRound` now reports.
Expect that one scenario to cost about six minutes of every pass. Its
success is the Finalization Cause plus an Answer of either kind — which
kind is data the fixes are judged on, never a corpus gate.

When the corpus gains a scenario, the pinned baseline cannot grow with it —
it is a frozen capture of an old tree. Nothing needs re-pinning: the
comparison runs on the corpus both pools cover (#168), and
`decision.json`'s `sharedCorpus` records the baseline it rests on, the
shared corpus size, and the ids each side holds alone. The new scenario is
still judged — every absolute gate and its structural ceiling see it — it
just cannot appear in a before/after median no baseline observed. Two
things stay your job: add the scenario to `e2e/eval/scenarios.ts` *and* to
the `CORPUS` mirror in `e2e/eval/acceptance.test.ts` (a test pins them
equal). Then recapture the candidate — the `candidate-covers-corpus` gate
fails any candidate pool missing a scenario of record and names the ids to
recapture, so a stale candidate cannot ride a shrinking comparison to an
accept. The baseline is allowed to lag; recapture it from the pinned tree
(`2343a3c` worktree + eval overlay, #130) when `sharedCorpus.size` has
drifted far enough below `corpusOfRecordSize` that the comparison no
longer says much. A decision is refused outright only when the two sides
share no scenario, or when their shared ids run in a different order.

### Delegation is measured by its own probe, not by the release corpus

`pnpm test:delegation` (Xvfb-wrapped, real model budget, opt-in) runs the
#163 delegation corpus — `e2e/eval/delegationScenarios.ts` — and captures to
`e2e/eval/delegation/`, never `e2e/eval/pools/`. It exists because the
release corpus never delegates: the #132 decision pools identical scenario
ids against a baseline pinned to the pre-#114 tree, which has no Effort Tier
and so no #120 delegation gate, so a delegation scenario cannot live in the
corpus of record without invalidating three captured baseline passes to
measure something the baseline cannot do. `pnpm eval:accept` refuses any
candidate pool carrying an id `e2e/eval/scenarios.ts` does not declare; a
baseline id the corpus has since dropped is tolerated, listed as
`baselineOnly`, and never compared (#168).

Each pass writes its own artifact
(`BINGBONG_DELEGATION_REPORT=e2e/eval/delegation/pass-<n>.json`);
`pnpm delegation:summary` pools every capture in the directory and reports
spawn attempts, off-tier refusals, and the worker stop-cause breakdown.
Delegation is recorded, never asserted — a probe that answers correctly
without delegating is the finding, not a suite failure, and neither is one
that fails. Change the corpus's depth, never its ask: a command that names
delegation measures the harness, not the model.

The corpus is a control and a treatment separated by branch *depth* alone.
Breadth was never the variable — the first capture answered both shallow
objectives serially in 13 and 16 rounds against a 24-round Investigation
budget — and neither is depth on its own. Set depth from the measured
round-per-page rate rather than a guess: pass-2 walked three four-leg
chains serially in 15 rounds, about one round per page, so the treatment
(`delegation-consignment-chains`) is three eight-leg chains behind opaque
hops — 25 navigations, ~26 rounds serially, against 8 navigations per
branch inside a browse worker's own 12-round leash.

Two variables decide whether a spawn happens and the probe has separated
them. Depth is necessary: the four-leg treatment was absorbed serially
(pass-2; the stronger model was never asked to walk that version). It is not sufficient: at eight legs GLM-5.3-flash spent the
whole Investigation budget across 25 navigations and finalized
`budget_exhausted` rather than delegate (pass-3), while glm-5.3 on the
identical corpus and commit spawned two browse workers and met the
objective in 13 rounds (pass-4) — the first accepted spawn, and the first
non-empty `subagentFinalizations`, this eval has recorded. So a capture is
unreadable without its orchestrator model (`pnpm delegation:summary`
prints it per capture and never pools across models silently), and the
deep scenario is expected to fail under a flash-class orchestrator.

An empty
`no_progress` column is read by the rule of three over the workers that
reached a Finalization Cause of their own (a cancelled or failed worker
never had the chance to stop for no Progress): zero events in N such
workers bounds the rate below 3/N, so bounding it under 10% needs 30.

### The live-web study is measured by its own pass, and never by CI

`pnpm test:live` (Xvfb-wrapped, real model budget, opt-in) runs the #223
live-web performance study: four independently researched information hunts
against the **real web**, each from a fresh Session on a dedicated benchmark
Browser Profile, with two fixed follow-ups. It captures to `e2e/live/artifacts/`
— never `e2e/eval/pools/` or `e2e/eval/delegation/` — and changes neither the
pinned release comparison nor the delegation probe.

It is the only suite here that both spends budget *and* browses live sites, so
the guard rails are stricter than the other two. `*.live.test.ts` is matched by
no config but `vitest.live.config.ts`; the unit config excludes the pattern
explicitly, because `e2e/**/*.test.ts` would otherwise sweep it into
`pnpm test` and spend real money on a command a developer thought was free.
That whole arrangement is asserted in `e2e/live/config.test.ts` rather than
trusted — everything preventing an accidental paid run is a glob in a config
file, and globs get quietly edited.

A pass is **bounded at six commands**: four initial submissions plus the two
eligible predefined follow-ups, at most once each (`PILOT_COMMAND_CEILING` in
`e2e/live/schedule.ts`). There is no repeat flag and no loop — three baseline
passes need separate post-pilot authorization (#223), and a campaign that could
be started by passing a number is what that authorization exists to gate.
Production's own effort and retry behaviour is untouched; the cap is on user
commands, not on how hard a Run works.

Like the release evaluator, the suite fails only on **broken measurement**. A
hunt the assistant gets wrong is the finding the study exists to record, not a
red test. Correctness is graded manually and offline against private keys in
`e2e/live/keys.ts`, which nothing on the capture path may import — `e2e/live/
corpus.test.ts` walks the import graph and fails if anything does. Prompts are
digest-pinned to the text #223 approved, so a task cannot be edited after a
measured Answer has been seen.

No-spend verification of the same schedule runs at the real Electron seam:
`pnpm test:e2e e2e/live/schedule.e2e.test.ts`. The reproducible protocol is
`docs/liveweb-hunt-protocol.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
