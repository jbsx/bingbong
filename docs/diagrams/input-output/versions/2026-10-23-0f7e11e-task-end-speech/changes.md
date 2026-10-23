# Input-to-output chart — 2026-10-23, base `0f7e11e` + the Task-end speech (#399)

- **Source:** base `0f7e11e`, 23 October 2026 (`main`), plus the accompanying #399 implementation changes in `src/main/run/commandRunner.ts` and `src/core/command/spokenFailure.ts`. The containing commit records the exact snapshot.
- **Previous chart:** `b1f9c34`, 23 October 2026 — [`../2026-10-23-b1f9c34/chart.html`](../2026-10-23-b1f9c34/chart.html).

## Behavioral changes since `b1f9c34`

### Added: a Task's end says one fixed line (#399)

`endTask` speaks one line through `say`, when there is a voice, on the turn last answered (its Card is already on the Feed, so the line adds no entry):

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Task ends `done` | more than one action, and not a Step with Steps still to come | says "Done.", not a failure | `endLineOf` → `DONE_LINE` |
| Task ends `done` | one action | silent, as before | `endLineOf` returns null |
| Task ends `cap` | five actions fired | says "I couldn't finish that.", a failure | `SPOKEN_FAILURES.notFinished` |
| Task ends `unavailable` | past hop 0 (`hops > 1`) | says "I couldn't finish that.", a failure | `SPOKEN_FAILURES.notFinished` |
| Task ends `unavailable` | at hop 0 (the best guess fired) | silent, as before | `endLineOf` returns null |
| Step stops its line | its Task said its end line | no second "I'm not sure this is it." | `stopSteps`, `StepEnd.said` |

Every other ending is unchanged: a wall, `unsure` and `not_found` keep their own lines, and a superseded Task says nothing.

Docs commits between `b1f9c34` and `0f7e11e` (`8e9add0c`, `82afffd6`, `0f7e11eb`, the ledger claim `e5777f86`, the fault log `4505d918`/`8ccabd79`) do not change the depicted flow.

## Chart changes

- **The whole journey:** the green "This Step is finished" box now reads "after 2+ actions it says “Done.”" (widened 260 → 300). The note under "The Task stops here" adds the action-limit / no-answer line "I couldn’t finish that." above "Any later Steps are not run." (moved down 30). The output note now ends "a Task’s end may say one line."
- **Important details:** new bullet on the end line.
- **Source references:** revision line, and `spokenFailure.ts` added.

## Simplifications

- The Step exception (no "Done." while Steps remain) is in the details, not drawn.
- That the line is spoken only with a voice attached is in the details bullet.

## Verification

`overview.png` was recaptured with headless Chrome at 1440×2200 and inspected directly: text fits its boxes, arrowheads end at their boxes, and the new notes clear every connector. A 420 px narrow capture of the main view (not kept) scrolls sideways with labels legible. A headless DOM dump of `?view=voice` shows that view's heading with its button pressed; the view code and buttons are otherwise unchanged from `b1f9c34`. `voice.png` and `decisions.png` are retained from `b1f9c34` (those views and the shared helpers are unchanged).

## Unresolved

None.
