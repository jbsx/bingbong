# Input-to-output chart — 2026-10-28, base `5f3a440b` + #500’s spoken `none` (a line to the app the app could not read is answered aloud)

- **Source:** base `5f3a440b` (`main`, 28 October 2026), plus #500’s changes: `src/core/command/answer.ts` (`NONE_SAID`, `NONE_SAID_LEVEL_DB`, `noneIsALine`), `src/core/voice/overLevel.ts` (`speechLevelDb`), `src/core/voice/voiceSession.ts` (the Speech Level on `SubmittedCommand` and the `stt` span’s `levelDb`), `src/main/run/commandRunner.ts` (the Task’s none road: `endedOn`, the said sentence and its `reaction` span). The containing commit records the exact snapshot.
- **Previous chart:** base `df603a62` + #504’s timed-out Overlap road: [`../2026-10-28-df603a62-overlap-timeout/chart.html`](../2026-10-28-df603a62-overlap-timeout/chart.html). This version is drawn on that chart.

## Behavioral changes since `df603a62` + #504

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A spoken line ends read `none` at hop 0 | not over the app’s voice, not a Step; the reading it ended on (the Where Ask’s, else the Mark Ask’s, else the line’s own) gives `none` under the 0.7 choice bar; its Speech Level is −26 dBFS or louder | Before: the greyed words and a muted “No response” with its reason, nothing said. Now: “I didn’t catch that, say it again.” is shown as the line’s failure Answer and said; a `reaction` span (`verb: none`, `effect: spoken`) at the first sound. | `noneIsALine`, `NONE_SAID`, the Task’s none road |
| The same | a sure `none` (≥ 0.7), a level under −26 dBFS, a line over the app’s voice, a Step, no host read it, or a typed line | Unchanged: the greyed words and the muted “No response”, unsaid. | `noResponseAnswer` |
| A spoken Utterance is transcribed | always | The `stt` span carries the Speech Level (`levelDb`): the mean RMS of the loudest fifth of its 512-sample frames, in dBFS. | `speechLevelDb` |

## Chart changes

- **The whole journey:** the note under “You see “No response”, its reason and a line to try instead” gains two lines: spoken at the mic and Jev unsure of its none, “I didn’t catch that, say it again.” is shown and said instead. The note was moved down so its first line clears the box. `overview.png` was recaptured at full height (1440 × 7400) and the none box and its note inspected.
- **Important details:** the “No response” sentence in the Answers bullet gains the spoken `none`’s rule. A details-open copy was captured and the bullet inspected.
- **When you speak** and **How it chooses an action:** unchanged; `voice.png` and `decisions.png` carried over.

## Simplifications

- The Speech Level’s floor (−26 dBFS) and the 0.7 bar are named in the details, not on the chart.
- No new box: the said sentence is the same red outcome, answered in words instead of a reason.
