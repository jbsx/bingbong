# Input-to-output chart — 2026-10-31, base `0807395b` + #546 (accompanying implementation changes)

- **Source:** base `0807395b` (`main`, 31 October 2026), plus #546: `src/main/run/commandRunner.ts`.
- **Previous chart:** base `2afdab0a` + #530: [`../2026-10-31-2afdab0a-ear-no-mic/chart.html`](../2026-10-31-2afdab0a-ear-no-mic/chart.html), which this one replaces.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line's run throws | a turn of it is still open | Each open turn gets a failed `done`. The last says “That didn’t work.” and a line to try, shown and said. The fault is reported, and the record (`unavailable`), `reaction` span and `task` span close unless the run closed them. `run` resolves true. | `endThrown` |
| The same | a stop or a later line already ended it | The open turns end cancelled, with nothing said over the ender's words. The record says `superseded`. | `endThrown` |
| The same | every turn already has its `done` | The fault is reported and the record closes, with no second `done` and nothing said. This silence is a marked guess in the code. | `endThrown` |
| A throw before the line's first event | any | `run` rejects as before, and #545's tap road takes its mark back. | `run` |

## Not changed

A throw on the roads that do not pass `perform` is not caught: the Endpoint of a line an Early Fire took, the answer to a Site Question, and a Flag. They still reject, with no `done`. #546 ruled the catch around `perform`.

## Layout and terminology

- **The whole journey:** no box or arrow added or removed. One note is added in the free space right of the action's result. It does not join the failures note, whose foot would reach the connector below it. Recaptured wide and narrow, and inspected: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
- The source line now names this base and the chart before it.
