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

## Jev decides; code shapes the ask

The app is as smart as Jev and the ask put to it, no smarter. Code raises
that ceiling when it changes how Jev is asked: what it sees on the card,
what it can choose, in how many steps, and what the loop around it does
with the answer (hops, the Verdict, the progress Noul, set-asides, learned
terms). Code lowers it when it answers in Jev's place: a rule, a list, a
site-specific path written for the line that failed. That patch holds on
the site it was written for and nowhere else, and the next site is the
next report.

When a line fails, first ask whether Jev had its best shot: did the card
carry everything on the page and in the appliance that bore on the line,
and every action it could have taken? Usually not, and the fix is to widen
the ask, by rule and for the whole class (every ref of that kind, every
site), which costs no latency. Only when Jev still fails with the whole
class in front of it is the ask itself the problem, and then the paid
strategies come in: a smaller card, a question split in two, a step before
the step. Each is another call, and the aim is still the fastest Task.

Widening is measured, never assumed. The card has a cap and every line on
it competes; a lure (the browser's `back` beside a media seek) is a real
cost. A widening is checked with `pnpm jev:gate`: the corpus asked once of
every gate model (`BINGBONG_GATE_MODELS` — the free, deterministic ones, so
one run each is exact), and a case is through only when every model passes
it. A weaker model's miss is a card problem until shown otherwise: a card a
weaker model reads right is one Jev cannot misread. A case that used to
pass on any model and no longer does is a regression. Jev is paid and is
asked only when the owner says so in the turn — `--with-jev`, never on a
session's own judgement; live runs go to whatever the root `.env` names.

Code keeps what is not a judgement: the facts (a media element's state, a
seekable range) and the mechanisms (one evaluate that fires an op on any
`<video>`), always by kind and never by site; hard policy; the exact
grammar lines that fire without an ask; the fallback when Jev is unsure
or unavailable. Jev keeps every choice.

The Player is the example. Its no-Jev search pick was a speed trade under
ADR 0076 and stands. The trade then spread: the control ops became a hand
list of Capabilities wired to YouTube's own scripts, so Jev was never
shown the media's state and could not be offered its ops on any other
site. ADR 0080 is the fix shape: the ref carries the state, offers every
op its kind allows, and Jev picks the op and the amount.

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
  unavailable landings, covered clicks) live in `src/core/browser/`. A
  media ref carries the element's own Media Ops on the action card (ADR
  0080, `src/core/command/mediaOp.ts`, #372): `forward-N`, `mute-N` and
  the rest, each one `mediaOp` evaluate on that element, the Amount Choice
  saying how far a seek goes; the ref's line carries its state.
- **Music** is the Player (`src/main/music/`, the Queue and the lines in
  `src/core/music/`, #343): `play <words>` opens YouTube in the pane and
  every music verb is one evaluate on the watch page's video. `play` is a
  verb the runner hands to it: an exact line from the grammar, anything
  with free words from Jev, which is offered the Player's own as Appliance
  Verbs (`src/core/command/jevReading.ts`, ADR 0079 as amended by #374). A `play` whose
  words Jev reads as pointing on the site open (`where`, the Site Scope)
  searches that site instead, and the landing's own media plays through
  the media ops; YouTube is the Media Engine (`siteScope.ts`), the default
  as DuckDuckGo is for `search`.
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
