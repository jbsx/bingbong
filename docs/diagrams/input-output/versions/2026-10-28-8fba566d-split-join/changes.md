# Input-to-output chart — 2026-10-28, base `8fba566d` + #494’s join (a joined line is the line it joins, on its Task, reaching a first half that already fired)

- **Source:** base `8fba566d` (`main`, 28 October 2026), plus the #494 implementation on branch `worktree-impl-494` in `src/main/run/commandRunner.ts` (`settleFate`'s `into`, the standing join in `run`, `runStep`'s `hop`, `givenWay`, `endRunning`), `src/core/command/command.ts` (`sameCommand`) and `src/core/command/runningCommand.ts` (`withRunning`: the running lines right after the words). Landed rebased onto `58dace4f`, whose changes since `8fba566d` are the voice process's and the Overlap case states only (#490), none of them drawn here. The containing commit records the exact snapshot.
- **Previous chart:** base `5568cde6` + #490’s finish, 28 October 2026: [`../2026-10-28-5568cde6-over-speech-finish/chart.html`](../2026-10-28-5568cde6-over-speech-finish/chart.html). This version is drawn on that chart.

## Behavioral changes since `5568cde6` + #490

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line's Fate on the line running is `joins` | the running line is still being read (no Command yet) | it gives way: a `done` is published for it at the join and its late reading publishes nothing; both lines' words are read as one line (J1) (before: the same, but the late reading could still publish) | `givenWay`, `settleFate` |
| A line's Fate on the line running is `joins` | the running line already fired, and J1 reads the same Command it fired, or `none` | the join stands: nothing fires again, the first line's sentence is not cut, the record is `stood: true`, and a `done` is published for the second line (before: J1 fired again as a new line, and the first line's sentence was silenced) | `run` (`into.stands`), `sameCommand` |
| A line's Fate on the line running is `joins` | the running line already fired, and J1 reads another Command | the joined Command fires as the running line's Task's next hop, not as a new line (before: a new Task) | `runStep` (`hop`), `continueTask` |
| The Appliance Card is built with a line running | always | the running line's words, stage, actions so far and the media a play is opening sit right after the user's words, before the page and the media (before: at the card's foot). Measured on Mammoth over the Overlap cases: 12/12 (from 10/12), row 8's `joins` 0.62–0.81 (from 0.38–0.56) | `withRunning` |
| A decision record with a Fate asked | always | it keeps the Fate's confidence and probabilities | `jevDetailOf` |

Not drawn: an undo of a landed first half is not built (no case reaches a landed pane move followed by a joined line that keeps the pane; a joined Command that takes the pane replaces it by itself).

## Chart changes

- **The whole journey:** the Overlap's `joins` box says both lines are read again as one line on the first one’s Task (before: on one more ask); its note says a first half that fired stands if both fire the same, else the joined line adds a hop. `overview.png` recaptured and inspected (the Overlap's foot).
- **Important details:** the Overlap bullet carries the standing join, the next hop and the give-way; the source references name this base and the symbols above.
- **When you speak** and **How it chooses an action:** no change; `voice.png` and `decisions.png` carried over.
