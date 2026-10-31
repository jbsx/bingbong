# Input-to-output chart — 2026-10-31, base `59183990` + #547 (accompanying implementation changes)

- **Source:** base `59183990` (`main`, 31 October 2026), plus #547: `src/core/ports/decisionModel.ts`, `src/core/browser/consentChooser.ts`, `src/main/run/commandRunner.ts`.
- **Previous chart:** base `0807395b` + #546: [`../2026-10-31-0807395b-run-throws/chart.html`](../2026-10-31-0807395b-run-throws/chart.html), which this one replaces.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A model answers without the lead question or the Slot, or an answer is not its question's shape | any ask of a line, or the consent ask | The ask reads as `unavailable`, reason `malformed`, the word a host's adapter already uses. It then takes the drawn "no answer" road: the reason shown, an Instant line's best guess on the Appliance Card, a Site Question refused aloud. Nothing throws. | `malformedAsUnavailable`, `askJev` |
| A throw in an Early Fire's action | with or without its Endpoint | The line ends where it fired, as the note says: one failed `done`, "That didn't work.", one fault, its record and Reaction closed. `consider` resolves, and the Endpoint adds nothing. | `considerOne`, `endingOnThrow` |
| A throw reading a Site Question's answer | the question open | The line ends the same way, cancelled if a stop came first. The Task that raised the question stays in flight, and the question stays open for the next line. | `run`, `endingOnThrow` |

## Not changed

A throw on a Flag's road still rejects, with no `done`: ruled by #547. A throw before a line's first event still rejects (#545).

## Layout and terminology

- **All three views:** no box, arrow or note added, removed or moved. The note beside the action's result, "A line whose run breaks at any stage", now holds on these two roads too, and the failures note's "no answer" holds for a malformed one. Only the source line changes, under the closed "Source references"; `overview.png`, `voice.png` and `decisions.png` are retained, and the rendered chart was opened and inspected.
