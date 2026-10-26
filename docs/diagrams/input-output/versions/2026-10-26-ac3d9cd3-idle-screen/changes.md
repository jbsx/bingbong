# Input-to-output chart — 2026-10-26, base `ac3d9cd3` + the Idle Screen by voice (#458)

- **Source:** base `ac3d9cd3` (`main`, 26 October 2026, after #447–#462), plus the #458 implementation on branch `worktree-impl-458`, in `src/core/command/appOp.ts`, `src/core/command/command.ts`, `src/main/app/attachAppControl.ts`, `src/main/run/commandRunner.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `39196428` + a failed ear load ends the Starting wait (#447), 26 October 2026: [`../2026-10-26-39196428-ear-fault/chart.html`](../2026-10-26-39196428-ear-fault/chart.html).

## Behavioral changes since `39196428` + #447

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The action card is built | the app is wired and the Idle Screen is not up (any view, any page; never on the Where Ask) | the card offers `show_idle`, the Idle Screen's line, just before `show_dashboard` (placed as measured) | `viewOptions`, `AppState.idle` |
| Jev picks `show_idle` | — | the Command keeps the Idle Screen (`keepsIdle`), and the app brings it up by the idle shortcut's road (`IDLE_IPC.enter`): the pane, the Player and the Last Page kept; “Showing the Idle Screen.” is shown in the Feed and never spoken; the Task ends | `commandKeepsIdle`, `attachAppControl.apply`, `appOpSpeaks` |
| The Idle Screen is asked for (its op, or the shortcut) | a turn is still running | it comes up at once, over the running turn, and the turn's later events (its Answer, its status, a Hot Listen opening) leave it up; input or a Command that acts on the pane wakes it as before | `App.tsx` `idleAsked` |
| A line names the Idle Screen | the Local Match | no exact line: it is Jev's, and the bare word `idle` is never a Known Address | `appWords` |

Before, the Idle Screen came up only by the idle timeout and its keyboard shortcut, and the shortcut pressed during a running turn was woken again by that turn's next event; “Go to Idle Screen” read none.

## Chart changes

- **The whole journey:** the green app box adds “or brings the Idle Screen back, silent”; its note adds that the Idle Screen is its own receipt, nothing said, the music playing on. `overview.png` recaptured and inspected.
- **How it chooses an action:** the green fact/panel/view box adds “or bring the Idle Screen back”, moved up a little so the “Jev picks settings” label stays clear of it; the note on the panel's ops and views names the Idle Screen while it is not up. `decisions.png` recaptured and inspected.
- **Important details:** the #420 bullet names the Idle Screen's view and its road; the source references add `appOp.ts` and `attachAppControl.ts`.
- **When you speak:** unchanged; `voice.png` kept from the previous version.
- A narrow (700 px) capture of the whole journey was inspected: the chart scrolls sideways and its labels stay readable.
