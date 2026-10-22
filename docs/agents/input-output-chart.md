# Updating the input-to-output chart

## Goal

Create a new version of Bing Bong's input-to-output diagram explaining **what happens after the user types or speaks a request**.

The deliverable is a self-contained HTML file that opens directly in a browser, reflects a named source revision, and is understandable without reading code. Preserve the approved visual language and verify the result by capturing and personally inspecting screenshots.

**Explain cause and effect:** boxes describe what happens; arrow labels explain when or why it happens.

## Starting material and version storage

The initial HTML template is [`../input-output.prototype.html`](../input-output.prototype.html), with an [approved-style screenshot](../input-output.reference.png). It documents source revision `32f7348`, dated 2026-10-22. Treat its behavior as historical, not as proof of the current implementation.

Original visual inspiration:

<https://pbs.twimg.com/media/HVHyOOYa4AA9MlZ?format=jpg&name=4096x4096>

The reference's communication principles matter more than pixel-perfect imitation. The user explicitly prefers direct multimodal image inspection; do not delegate image interpretation to Z.ai.

The initial working branch is `docs/input-output-state-diagram`. Its worktree was relocated from `/tmp/opencode/bingbong-input-output` to `.claude/worktrees/input-output-chart` under the repository before committing. Temporary visual references from that session were:

- `/tmp/opencode/input-output-reference-style.png` — redesigned main view.
- `/tmp/opencode/input-output-voice.png` — voice view, before the final supporting-note position adjustment.
- `/tmp/opencode/input-output-decisions.png` — decision view.
- `/tmp/opencode/diagram-reference.jpg` — original inspiration.

These temporary paths may disappear. The HTML template and this runbook are the reusable starting material. Generate fresh screenshots from the template if the original captures are unavailable.

For subsequent versions, use:

```text
docs/diagrams/input-output/
  index.md
  reference/
    approved-style.png
  versions/
    YYYY-MM-DD-<source-sha>/
      chart.html
      overview.png
      voice.png
      decisions.png
      changes.md
```

Create this layout on the first versioned update. Preserve the template's approved appearance as a reference screenshot. Keep earlier versions intact; `index.md` links to the latest chart and the history. Each version must remain independently readable.

## 1. Establish the source snapshot

1. Read the repository's current agent instructions.
2. Inspect HEAD, working-tree status, branches and existing worktrees.
3. For a standalone chart request, create a dedicated worktree from the requested revision, or current HEAD when no revision was specified. For a chart update accompanying an implementation change under the `AGENTS.md` pre-commit rule, use that implementation's existing worktree.
4. Record the full source SHA and date.
5. Locate the previous chart and its source SHA.

For a standalone request, chart committed source by default. For a pre-commit update, chart the intended implementation changes as well as the base revision; inspect both staged and unstaged changes to establish that scope. Preserve unrelated work.

A pre-commit chart cannot name its own containing commit in advance. Use the base SHA in the version directory with a descriptive change suffix to distinguish it from a chart of that base alone, and label the chart and change notes “base `<sha>` + accompanying implementation changes.” Describe those changes precisely; the eventual containing commit records the exact snapshot. Include the chart, change notes, index and affected screenshots in the implementation commit. Do not amend merely to replace this provenance with a self-referential SHA.

**Done when:** the documented snapshot is unambiguous, work is isolated, and the previous chart remains intact.

## 2. Trace current behavior

Use the previous chart as a visual template, **not as behavioral evidence**. Follow the repository's graph-query instructions when a knowledge graph exists, then verify transitions in source. Consult relevant tests when they clarify branches or edge cases.

Initial source entry points:

| Concern | Starting location |
| --- | --- |
| Shared command entry | `src/main/run/attachCommandRunner.ts` |
| Reading, execution, continuation and cancellation | `src/main/run/commandRunner.ts` |
| Voice lifecycle | `src/core/voice/voiceSession.ts` |
| Voice-to-runner wiring | `src/main/voice/attachVoice.ts` |
| Endpoint detection | `src/core/voice/vadEndpointing.ts` |
| User-visible events | `src/core/pipeline/events.ts` |
| Public runner state | `src/core/pipeline/runState.ts` |

Follow moved or renamed modules. These paths are navigation hints, not a permanent architecture contract.

Trace all applicable paths:

- Typed submission.
- Voice activation, capture, partial transcripts and final transcription.
- Local command matching.
- Model-assisted selection and conditional follow-up asks.
- Action execution.
- Visible, spoken and appliance output.
- Task continuation and completion.
- Multi-step requests.
- Empty input, unavailable decisions, errors, cancellation and supersession.

Build a compact evidence table while researching:

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| … | … | … | … |

Compare against the previous version: identify added, removed and changed behavior, plus terminology-only changes. Read executable control flow rather than trusting old comments when they disagree. Do not make paid model calls merely to document the code.

**Done when:** every diagrammed transition is supported by source and every material change since the prior chart is accounted for. Mark unresolved uncertainty explicitly rather than inventing a transition.

## 3. Choose focused views

The approved chart has three views. Retain them while they fit the architecture; reorganize only when necessary to keep each diagram readable.

### The whole journey

Answer: **What happens after I ask Bing Bong to do something?**

Show input, local/model selection, execution, feedback, continuation and completion. Keep specialized decision details in their own view.

### When you speak

Answer: **What happens between activating listening and my words becoming an action?**

Show the current activation modes, transcription, early-action behavior if supported, and the conditions that keep listening open or close it.

Represent concurrency honestly. Early execution during capture belongs to the same utterance, not a second independent request. Branches should not falsely imply mutually exclusive events when both can occur.

### How it chooses an action

Answer: **How does the app turn my words into something it can do?**

Show local matching, model choices, conditional follow-ups, no-action outcomes and preparation required before execution.

**Done when:** each view answers one clear question and can be understood without opening an inspector or another view.

## 4. Apply the approved visual language

The reference works because it tells a downward-reading story, uses ordinary language, labels the reasons for branches, and gives connections ample room. The earlier dark dashboard grid was rejected: its arrows were cramped and hidden behind cards, and its inspector required interaction to understand the flow.

### Layout

- White background and a black starting dot near the top.
- Predominantly downward reading direction; branches spread horizontally.
- Lightly rounded rectangular boxes.
- Small decision diamonds only where they clarify a split.
- Thin, dark connectors with clearly visible arrowheads.
- Dedicated routing space between boxes and generous room for labels.
- All essential explanations visible without stepping through a walkthrough.

Place nodes according to the story and branch structure, rather than forcing them into a uniform grid. Use separate branches for separate conditions. Avoid ambiguous crossings and shared lines that imply an unintended merge.

### Wording

Boxes describe events or outcomes:

- “You type or speak what you want.”
- “The app performs the chosen action.”
- “You see ‘No response’ with a reason.”

Arrow labels describe conditions:

- “an exact command matches”
- “the first answer selects ‘none’”
- “there is another Step”

Use source terminology when necessary and explain it nearby. Prefer ordinary language over function names. Keep most boxes to one or two short lines; put implementation references and qualifications below the chart.

### Color and typography

| Meaning | Fill | Border |
| --- | --- | --- |
| Ordinary behavior | `#f2f3f4` | `#878e93` |
| Successful outcome | `#edf5ed` | `#278341` |
| Stopped / no result | `#fcf0ec` | `#bc493b` |

Keep the legend explicit. The original inspiration colored bugs and fixes; **our chart colors flow outcomes**. Red does not mean a verified defect. Text must carry the meaning independently of color.

Starting values from the approved template:

- Arial/Helvetica/system sans-serif.
- Approximately 20 px node text in a 1200-unit SVG viewBox.
- Approximately 18 px branch labels and 16 px supporting notes.
- Approximately 28 px line spacing.
- Approximately 1.5–1.8 px ordinary connector/border strokes.
- Stronger borders for colored outcomes.

Adjust these values after inspecting rendered screenshots. Reserve space for labels and arrowheads; break long labels across lines. A label's white backing must not erase unrelated connections. Supporting notes must not overlap arrows.

### Simplification

When a long return arrow would obscure the chart, a bounded loop may end with an explicit instruction such as “Repeat: act → show result → check.” State its limits nearby or in the details section.

Shared interruption behavior may be explained once below the diagram rather than with an abort edge from every box. Explain significant omissions and exceptions in an “Important details” section.

Distinguish conceptual processing states from actual state enums. Distinguish a command finishing from the whole Task or line finishing. These distinctions must be verified against the current implementation.

**Done when:** the main path and every branch can be followed without guessing which connector a label belongs to.

## 5. Build the single-file HTML

Use inline HTML, CSS, JavaScript and SVG. The file must:

- Open through `file://` and work offline.
- Require no framework, build step, CDN, remote fonts or model calls.
- Offer directly selectable views with keyboard-accessible controls.
- Support direct view URLs: `chart.html?view=main`, `?view=voice`, `?view=decision`.
- Remain readable on narrow screens; horizontal scrolling is preferable to illegibly shrinking labels.
- Include a text color legend, source revision, date and source references.
- Keep source links valid from the saved version directory, or use explicitly revision-pinned links.

The original implementation uses small SVG helpers for nodes, multiline text, labeled arrows, starting dots and notes. Explicit coordinates are appropriate for a small curated chart. Keep one authoritative drawing implementation; consolidate layout changes instead of stacking override functions or styles.

This is an explanatory diagram, not a simulation of application execution. Avoid adding controls or animations that distract from reading the chart.

**Done when:** every view renders offline, view controls work, direct view URLs work, and version metadata and source links are correct.

## 6. Capture and inspect screenshots

**Rendering successfully is not sufficient.** Use a headless browser to capture the page, then inspect the images directly with the agent's image capability. If direct image inspection is unavailable, state the limitation instead of claiming visual verification. Do not use Z.ai for this task.

Avoid opening windows on the developer's real display. For this standalone HTML, headless Chrome is sufficient; any Electron e2e work must follow the repository's Xvfb rules.

Example command, with absolute paths substituted:

```bash
google-chrome \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --screenshot="<absolute-output-path>/overview.png" \
  --window-size=1440,2200 \
  --timeout=3000 \
  "file://<absolute-chart-path>/chart.html?view=main"
```

Check that the output directory exists before running. Adjust viewport height to include the entire diagram, or use full-page capture. Add environment-specific browser flags only when needed.

Capture and inspect:

1. Main journey.
2. Voice view.
3. Decision view.
4. A narrow-screen view for overflow and readability.

For every view check:

- Text fits inside boxes.
- Arrowheads terminate at the intended boxes.
- Connections remain visible and do not pass through unrelated boxes.
- Branch labels clearly belong to their connections.
- Notes and label backgrounds do not obscure connectors.
- Branches have sufficient separation.
- Bottom-most nodes and notes are not clipped.
- Colors match the legend.
- Text remains legible.

Exercise the view controls as well as directly loading each URL. Fix visual defects, recapture affected views, and inspect the new screenshots. Syntax checking alone does not verify layout or interaction.

For a pre-commit update, recapture and inspect every affected view; unchanged views may retain their previously verified screenshots. A shared layout change affects every view. Record which captures were refreshed or retained.

**Done when:** every changed view has been visually inspected after its last layout change, unchanged views retain verified captures, and controls and direct URLs have been checked.

## 7. Preserve the version and report changes

Save the new dated/source-stamped version and update the index. Keep earlier versions intact.

In `changes.md`, record:

- Source SHA and date.
- Previous chart's source SHA.
- Behavioral additions, removals and changed transitions.
- Layout or terminology changes.
- Deliberate simplifications.
- Unresolved uncertainty, if any.

A code change does not automatically need a new box: explain whether it changes the depicted flow or only internal implementation.

Follow the user's authorization for committing and publishing. Creating a chart does not itself authorize a commit, push or PR.

The final response must link to the HTML and overview screenshot, name the source revision, summarize important differences, and state which views were screenshot-verified. Report any incomplete verification plainly.

**Done when:** the version is independently readable, indexed, accompanied by change notes and verified screenshots, and its location and status have been reported to the user.

## Invocation

Once this runbook and template are available, the user can request:

> Update our input-to-output chart for the current HEAD. Follow `docs/agents/input-output-chart.md`, use a separate worktree, and preserve the previous version. Verify the flow against current source, keep the approved reference-style layout, and capture and personally inspect screenshots of every view. Give me the new HTML and a summary of what changed.
