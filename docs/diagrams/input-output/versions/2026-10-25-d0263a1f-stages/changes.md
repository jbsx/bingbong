# Input-to-output chart — 2026-10-25, base `d0263a1f` + the Status Capsule's stages (#428)

- **Source:** base `d0263a1f` (`main`, 25 October 2026, after #425), plus the #428 implementation on branch `worktree-impl-428-stage-feedback`, chiefly in `src/main/run/commandRunner.ts`, `src/core/pipeline/events.ts`, `src/core/pipeline/runProgress.ts`, `src/renderer/src/useAssistant.ts`, `src/renderer/src/AssistantPanel.tsx`, `src/renderer/src/IdleScreen.tsx` and `src/core/feed/feedProjection.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `765548d3` + upload by voice (#424), 24 October 2026: [`../2026-10-24-765548d3-shelf/chart.html`](../2026-10-24-765548d3-shelf/chart.html).

## Behavioral changes since `765548d3` + #424

No transition changes: what is read, fired and ended is the same. What changes is the visible output while a line runs.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A typed line or an Endpoint's transcript enters the runner | not the Endpoint of an Utterance a partial already fired, not a Flag | `status: thinking`, hop 0, detail = the heard words, before the Site Question's answer (when one is open), the page read or any ask | `run` |
| A later Step of a line read as Steps | its line still stands | `status: thinking`, hop 0, detail = the Step's words | `runSteps` |
| A Command fires | not a `stop`, not on a blank pane | `status: acting`, its hop, detail = the `command` event's action words | `fire` |
| A fired action shows its first effect | still performing, not a spoken `read` | `status: loading`, its hop, through its navigation or settle | `fire` (`onEffect`) |
| A hop past the first begins | the last hop's action awaits being read (`task.pending`), not superseded | `status: loading`, the firing hop's number, while the page settles and draws; the tracker keeps the first `loading`'s anchor | `continueTask`, `createRunProgressTracker` |
| Closing what a dead end opened | after each move | `status: loading` while the page it left is read | `closeOpened` |
| A Flag line | — | no stage published; the pill stays on the Task it leaves | `run` |
| Escape, abort or a `stop` | a line or hop is being read | `status: cancelled` for that reading's turn: "Stopped" at once | `abort` |
| That hop's page is in hand | not superseded | `status: thinking`, its hop, before the links and the hop's ask | `continueTask` |
| A `read` speaks | — | `status: speaking`, its hop | `fire` |
| The Capsule's hint | a stage is active | the stage's detail (heard words quoted while thinking), `hop N` past hop 0, the stage's own seconds | `runProgressParts` |
| The Capsule's hint | one stage past 5 s | adds "still thinking", "still acting" or "page still loading" (bound a guess) | `STUCK_STAGE_MS` |
| The pill | a `done` | returns to Ready only for the turn whose stage it shows, after a 300 ms hold a newer stage cancels | `useAssistant` |
| The Idle Screen | any working stage, `thinking` included | shows the Capsule with the run hint; unmounts only on a Command that touches the pane, as before | `IdleStatus` |
| The Feed | `loading` | stage line "Waiting for the page" | `STEP_NAMES` |

## Chart changes

- **The whole journey:** a note between the two first branches, "From the moment you ask, the Status Capsule says “Thinking…” with your words, on the Idle Screen too". The loop note under "Jev reads the new page" gains "Each hop shows “Thinking…”, then “Acting…” with the action, then “Loading…”." and moved 6 units lower. Re-captured and inspected (`overview.png`).
- **Important details:** a bullet on the stages, the per-stage seconds, the stuck-stage line, the Idle Screen, and that nothing names Jev or chimes.
- **Source references:** `runProgress.ts` added; the base line updated.
- **When you speak** and **How it chooses an action:** unchanged; their captures (`voice.png`, `decisions.png`) are retained from the previous version.
