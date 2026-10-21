# Bing Bong

The `main` branch, which `kachow` became on 2026-10-17 by the owner's
ruling. The browser, the interaction surface an agent drives
(the numbered-ref snapshot over CDP — see `src/main/browser/collectPageScript.ts`
and `src/core/browser/snapshot.ts`), the dashboard, and the local voice
pipeline (wake word, STT, TTS). No generating model: the orchestrator, its
subagents, the Session and evidence machinery, vision and the evaluation
harnesses were stripped on the `kachow` branch and are gone. The one model
this branch knows is Jev,
the Decision Model (`src/main/decision/`, `src/core/ports/decisionModel.ts`),
armed by `TYPESAFE_API_KEY`. The aim is an agent that completes a task as
fast as it can, built on top of this shell.

## Where things land

- **The command seam** is `src/main/run/commandRunner.ts`. A typed or spoken
  line enters `CommandRunner.run` and becomes one Command (ADR 0076,
  `src/core/command/`): the Local Match first (the CLI grammar —
  `navigate <url>`, `read`, `click <ref>`, `type <ref> <text>`,
  `scroll up|down`, `press <key> [n]`, `screenshot`, `back`, `reload`,
  `resume` — or a plain
  verb and the label exactly one ref carries), else one Jev call, else the
  Local Match's best guess; it fires with no confirmation. A spoken Slot
  that is search terms or text to type passes the Name Match (ADR 0077,
  `src/core/command/nameMatch.ts`) against the page's names (Page Terms,
  `src/core/voice/pageTerms.ts`, which also bias the decode of that
  Utterance) and the Learned Terms. Every step is
  published as a `PipelineEvent` (`src/core/pipeline/events.ts`) that the
  Feed, the Status Capsule and the voice session read: one `command` per
  Command carrying the words and the action, a `reaction` perf span and one
  record in `decision-*.jsonl` beside the perf log (`pnpm perf:report`
  reads both). Each Jev call's whole ask goes to `asks-*.jsonl`, which the
  record names. `pnpm jev:candidates`, `jev:case` and `jev:replay` grow
  and replay the Jev corpus in `fixtures/jev-cases/` (#338).
- **The browser** is `BrowserController` (`src/core/ports/browser.ts`),
  implemented over CDP in `src/main/browser/createCdpBrowserController.ts`.
  Action Outcome classifiers (blockers, consent walls, empty/not-found/
  unavailable landings, covered clicks) live in `src/core/browser/`.
- **Music** is the Player (`src/main/music/`, the Queue and the lines in
  `src/core/music/`, #343): `play <words>` opens YouTube in the pane and
  every music verb is one evaluate on the watch page's video. `play` is a
  verb the runner hands to it: an exact line from the grammar, anything
  with free words from Jev, which is offered the Player's ops as
  Capabilities (`src/core/command/capability.ts`, ADR 0079).
- **The CLI harness** (`pnpm cli`, `--browser-cli`) drives the same
  controller from a terminal.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Bugs

Every line that did not do what was meant goes in the Failed Lines ledger
(`fixtures/failed-lines/`, #371), tagged by the first failing stage;
`pnpm bugs` prints it grouped by stage, open first. A post mortem ends by
adding its lines; a fix issue claims the lines it covers. See `docs/agents/bugs.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
`CONTEXT.md` is inherited from `main` with the removed sections cut; the
ADRs before 0076 are the orchestrator's history and many describe machinery this branch no longer
has.

## Testing

`pnpm test` is the unit suite. The `e2e/*.chrome.test.ts` collector tests
run inside it against a headless Chrome and skip themselves when none is
installed.

### E2E tests must run under Xvfb

Never run e2e tests against the developer's real display — Electron windows
would pop up on screen. Always use `pnpm test:e2e` (it wraps vitest in
`xvfb-run`). When invoking the e2e vitest config directly, wrap it yourself:
`xvfb-run -a -s "-screen 0 1280x800x24" vitest run --config vitest.e2e.config.ts`.
The launch harness (`e2e/electronApp.ts`) forces the X11/Ozone backend and
strips `WAYLAND_DISPLAY` so Electron binds to Xvfb even on Wayland sessions.

The e2e suite on this branch covers the shell only: the pane, the CLI
harness, settings, the adblocker, kiosk mode, and the YouTube snapshot gate
(`BINGBONG_YOUTUBE_E2E=1`). Every suite that scripted an orchestrator run
was removed with the orchestrator.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
