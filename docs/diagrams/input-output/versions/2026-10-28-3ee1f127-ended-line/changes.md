# Input-to-output chart — 2026-10-28, base `3ee1f127` + #499’s line just ended

- **Source:** base `3ee1f127` (`main`, 28 October 2026), plus the #499 changes in `src/core/command/runningCommand.ts` (`EndedCommand`, `ENDED_WINDOW_MS`, `endedWithin`, `withEnded`, `doingAnswer`’s ended line), `src/core/command/applianceCard.ts` (`ApplianceView.ended`) and `src/main/run/commandRunner.ts` (`lastEnded`, `noteEnd`, `noteEnded`, `endedBefore`, `ReadOptions.ended`, the doing fact). The containing commit records the exact snapshot.
- **Previous chart:** base `f0d275a0` + #490’s eighth pass: [`../2026-10-28-f0d275a0-over-speech-off/chart.html`](../2026-10-28-f0d275a0-over-speech-off/chart.html). This version is drawn on that chart.

## Behavioral changes since `f0d275a0` + #490

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line ends | its Task is over and its sentence has ended; it was not read `none`, did not give way into a join, and was not a doing question | it is kept as the line just ended, with its words, outcome and Answer | `noteEnded`, `retire` |
| A line is read with nothing running | the Appliance Card is on, and a line ended within 15 s (`PEEK_CARD_LINGER_MS`) of this one’s Endpoint | the card offers `say_doing` for it before `page`, its option kept to “a question about the user’s line just before this one, whether it worked and how it ended, never a new request” and carrying the sentence it says; the state is unchanged and no Fate is asked (before: no `say_doing` on an idle card) | `endedBefore`, `withEnded` |
| `say_doing` fires | nothing running, a line just ended | “Done, 3 seconds ago: &lt;its Answer’s first sentence&gt;.” (or “Didn't work, …” / “Stopped, …”), shown and said (before: “Nothing is running.”, and never offered) | `doingAnswer` |
| A line is read with a line running | — | unchanged: the running line is on the card, never the one ended | `applianceState` |

## Chart changes

- **The whole journey:** the Overlap foot’s note “A line with nothing running sees the Appliance Card as before.” now reads “With nothing running, a line that ended in the last 15 s is offered as say_doing (#499): “is it working?” says “Done, 3 seconds ago: &lt;its sentence&gt;”.” `overview.png` recaptured and inspected (the foot fits the width, no overlap).
- **Important details:** the Overlap bullet’s “a line with nothing running sees the card byte for byte as before” is replaced by the line just ended (offered as `say_doing`, the state as before, measured), and notes a `none` is still shown muted and not said (#500). The provenance names this base.
- **When you speak** and **How it chooses an action:** no change; `voice.png` and `decisions.png` carried over.
