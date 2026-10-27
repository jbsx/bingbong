# Input-to-output chart — 2026-10-27, base `da107e12` + where the Planner enters (#468)

- **Source:** base `da107e12` (`main`, 27 October 2026, after #478's whole hearing, #482's answer section and #475's Ledger Strip), plus the #468 implementation on branch `worktree-impl-468`, in `src/main/index.ts`, `src/core/planner/plannerRouting.ts`, `src/core/errand/errandLine.ts`, `src/main/run/errand.ts`, `src/main/run/commandRunner.ts` and `src/core/errand/confirmClass.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `3aebe32b` + the whole hearing (#478), 27 October 2026: [`../2026-10-27-3aebe32b-whole-hearing/chart.html`](../2026-10-27-3aebe32b-whole-hearing/chart.html). This version is drawn on that chart.

## Behavioral changes since `3aebe32b` + #478

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A Task ends at its limit, unsure or unavailable | a Planner key is set and `BINGBONG_PLANNER` is not `off` (before: only while `BINGBONG_ERRAND=1`, which the kiosk never set) | the line is handed to an Errand, as #467 drew it; this is now the shipped road (ADR 0095, arm C) | `createWindow` (`plannerSwitchedOff`), `handsOff` |
| A line is exactly `errand <words>` | as above | an Errand starts with no Jev call | `errandGoalOf` |
| `BINGBONG_PLANNER=off` | — | no Errand is reached: the Task's end is said as before and `errand <words>` is Jev's to read | `plannerSwitchedOff` |
| The Planner answers done or asks back | — | a Feed entry (`command` event) in the Planner's own words, its stage ended; before, only acting steps had one | `told` |
| The Planner says done after a confirm was refused, nothing fired since | — | the Errand is recorded `declined` (said as before, in the Planner's sentence) | `runErrand` |
| An Enter in an Errand | any field typed into on that page carries a leaving word (before: the last typed field only) | said back as a confirm | `confirmOf` |

The losing arms of #468 (an `errand` option on the hop-0 card; a hedge Planner call beside every Jev ask) were built and measured and left the tree; neither is drawn.

## Chart changes

- **The whole journey:** the intro says a line a Task could not finish goes on under the Planner unless it is switched off; the hand-off arrow's label drops "the Errand is on"; the note under the Errand says done and a question are Feed entries and names `BINGBONG_PLANNER=off` in place of `BINGBONG_ERRAND=1`. `overview.png` recaptured and inspected.
- **How it chooses an action:** the note beside the `errand <words>` box reads "Unless BINGBONG_PLANNER=off". `decisions.png` recaptured and inspected.
- **When you speak:** no change; `voice.png` carried over.
- **Important details:** the Errand bullet says it is on by default since #468 with the kill switch, the Feed entries, `declined` and the Enter rule; the source references name `plannerRouting.ts`.
