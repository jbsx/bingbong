# Input-to-output chart — 2026-10-28, base `b746a5c5` + the Overlap (#489)

- **Source:** base `b746a5c5` (`main`, 28 October 2026), plus the #489 implementation on branch `worktree-impl-489`: commits `e0a02fb5` (the runner reads a line given while another runs against it, and the Appliance Card carries the running Command and asks its Fate), `245c7d01` (the card says how long before the line the running one was given, and goes on names a remark) and the uncommitted work beside them. The behaviour drawn is in `src/main/run/commandRunner.ts` (`live`, `runningBefore`, `runningOf`, `floor`, `isEnded`, `endRunning`, `fateOf`, `takesPane`, `actsOnMedia`, `settleFate`, `stopSaid`, `sayStop`, `abort`, `considerOne`, the Early Fire), `src/core/command/runningCommand.ts` and `src/core/command/applianceCard.ts` (`fateOfAnswers`, the `running` view). Tests: `src/main/run/commandRunner.test.ts`, describe "an Overlap (#489)". The containing commit records the exact snapshot.
- **Previous chart:** base `deef0aa5` + #488 (a song plays before it says Playing), 27 October 2026: [`../2026-10-27-deef0aa5-media-start/chart.html`](../2026-10-27-deef0aa5-media-start/chart.html).

## Behavioral changes since `deef0aa5` + #488

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line is given while another runs | the Appliance Card is on | Its arrival ends nothing. Before, it superseded the running Command, Task or Errand before it was read; the ended one showed “Stopped: a later Command came first.” grey and said nothing. | `run` (`floor` set only with the card off) |
| The same, a line no exact line settles | — | The Appliance Card carries the running line: its words on a labelled line, how long before the new line it was given, its stage in the Status Capsule's words, its Task's actions so far, the media a `play` is opening. It offers the fact `say_doing` and asks one more question, the Fate: ends, joins, waits, goes on. | `runningOf`, `withRunning`, `runningLines`, `fateQuestion` |
| The doing fact is picked | — | Says “Still on “&lt;words&gt;”: &lt;stage&gt;.” (“Nothing is running.” with none). | `doingAnswer` |
| The Fate is read | below 0.7, or none, or the host failed | goes on | `readFate` |
| Fate ends | — | The running line ends: its action cancelled, its Task and any Errand ended. Its grey Answer and spoken line are “Stopped &lt;its Acting stage&gt;.”, said ahead of the new line's own sentence (alone if that says none). Then the new line runs. | `endRunning`, `stoppedLine`, `stopSaid`, `say` |
| Fate joins | — | The running line gives way unsaid (“Stopped: a later Command came first.”, grey). Both lines' words in order (“play yellow, no, by coldplay”) are read again as one line, on one more ask. | `settleFate` (joins) |
| Fate waits | — | The Capsule shows “Waiting” with what it waits for (the media opening, else the running words). The line waits until the running one ends, however it ends, then is read again against what is there. | `settleFate` (waits), `WAITING_WORD`, `LiveLine.over` |
| Fate goes on | — | The new line fires beside the running one, which keeps its own end. | `settleFate`, `inFlight` by generation |
| An exact line (or an Early Fire) while a line runs | — | Fires on its words with no ask. Its Fate is by kind: `stop` ends it; one that takes the pane (navigate, search, back, forward, reload, resume, a play that opens now, an `errand` line) ends it; a control on media a `play` is still opening waits (an Early Fire then does not fire early); any other goes on. | `fateOf`, `takesPane`, `actsOnMedia`, `considerOne` |
| A Jev-read Command that takes the pane | its Fate is not joins or waits | ends the running line | `fateOf` |
| `stop`, “never mind”, an abort (Escape, the Abort Head) | — | Say “Stopped.” aloud (before, shown grey and unsaid). “Paused.” and “Nothing to stop.” are said too. | `sayStop`, `abort` |
| A line with nothing running | — | The card is byte for byte as before. | `applianceQuestions` |
| `BINGBONG_APPLIANCE_CARD=off` | — | The old road: arrival supersedes the running line and ends an Errand. | `run`, `considerOne` |

## Views

- **Whole journey:** recaptured and inspected.
  - New section at the foot, with its own start dot: “You give another line while an earlier one is still running”. It splits into “an exact command, or an Early Fire” (Fate by kind) and “any other line” (Jev reads the Appliance Card with the running line on it and picks the action and its Fate).
  - Both meet at a Fate diamond, which splits four ways: ends (red: the running line stops; “Stopped &lt;what it was doing&gt;.”), joins (both lines read again as one), waits (the Capsule says “Waiting”), goes on (green: the new line fires; the running one keeps its own end). Each has a note, and a closing note covers the Jev-read pane rule, the idle card, “Stopped.” said and `BINGBONG_APPLIANCE_CARD=off`.
  - The intro has one more sentence pointing to the foot. The Errand's note now reads “A later line that ends or joins it (below), Escape or the Abort Head ends it.” (it said “A later line, … ends it, saying nothing.”).
  - The view's height grows from 3420 to 4620. Everything above the foot is unchanged.
  - `overview.png` is now captured at full height (1440 × 5100), so the foot is in it.
- **How it chooses an action:** recaptured and inspected. One note was added beside the Appliance Card: while a line runs, the card carries it and asks its Fate, and offers “what are you doing”. It points to the whole journey's foot. No arrow changed. `decisions.png` is captured at full height (1440 × 5400).
- **When you speak:** unchanged; the voice view's code is identical to the previous version, and `voice.png` is carried over. The Early Fire's Fate is drawn on the whole journey, not here.
- **Important details:** a new bullet, “The Overlap (#489)”. The closing bullet on interruptions now names “stop” and a later line whose Fate ends it, and says the Overlap is drawn once. In the #488 bullet, a later line that ends the play now ends the wait, where before any later Command superseded it. Two source references were added (`commandRunner.ts` for the Overlap, `runningCommand.ts`).
- **Narrow screen:** checked at 600 px. The chart scrolls sideways as before.

## Simplifications and uncertainty

- The Overlap is drawn once, as its own section, rather than as an edge from every running box. The same goes for the earlier interruption rule.
- “waits” does not draw a loop back to the Appliance Card. Its box and note say it is read again once the running line ends (`settleFate` calls itself, so a second Fate can follow).
- The case where the line being joined or waited on has already ended when the Fate is acted on is in the source but not drawn: the new line is then read again alone.
- No paid model call was made; drawn from source and its unit tests.

## Merged on the rebase

The voice view carries #490’s change (speech over the app’s own voice: the duck, a line of its own dropped, yours to the runner), applied from `2026-10-28-7559ae7b-over-speech` hunk for hunk; `voice.png` is that version’s capture. The whole journey and the decision view are #489’s.
