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
pnpm test:eval` (a finalized capture is never overwritten). The baseline
pool is captured from the pinned pre-#114 tree (`2343a3c` worktree + eval
overlay, see #130); all candidate passes come from one candidate commit.
`pnpm eval:accept --regressions=passed` validates both pools' provenance
and writes `e2e/eval/decision.json` from pooled nearest-rank statistics —
pass-level percentiles are never averaged. The rounds gate (#134) judges
the global pooled median (no regression), the Direct Action and
Lookup-class pooled medians (strict improvement), and corpus-declared
structural ceilings per scenario (`expectedEffort` in
`e2e/eval/scenarios.ts`); pooled p95 is reported, never gated.

### Delegation is measured by its own probe, not by the release corpus

`pnpm test:delegation` (Xvfb-wrapped, real model budget, opt-in) runs the
#163 delegation corpus — `e2e/eval/delegationScenarios.ts` — and captures to
`e2e/eval/delegation/`, never `e2e/eval/pools/`. It exists because the
release corpus never delegates: the #132 decision pools identical scenario
ids against a baseline pinned to the pre-#114 tree, which has no Effort Tier
and so no #120 delegation gate, so a delegation scenario cannot live in the
corpus of record without invalidating three captured baseline passes to
measure something the baseline cannot do. `pnpm eval:accept` refuses any
pool carrying an id `e2e/eval/scenarios.ts` does not declare.

Each pass writes its own artifact
(`BINGBONG_DELEGATION_REPORT=e2e/eval/delegation/pass-<n>.json`);
`pnpm delegation:summary` pools every capture in the directory and reports
spawn attempts, off-tier refusals, and the worker stop-cause breakdown.
Delegation is recorded, never asserted — a probe that answers correctly
without delegating is the finding, not a suite failure. An empty
`no_progress` column is read by the rule of three over the workers that
reached a Finalization Cause of their own (a cancelled or failed worker
never had the chance to stop for no Progress): zero events in N such
workers bounds the rate below 3/N, so bounding it under 10% needs 30.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
