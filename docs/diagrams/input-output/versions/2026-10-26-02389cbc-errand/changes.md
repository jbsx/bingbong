# Input-to-output chart — 2026-10-26, base `02389cbc` + the Errand (#467)

- **Source:** base `02389cbc` + accompanying implementation changes (#467) on branch `worktree-impl-467` (its first commit `1e244113` after the rebase onto `4f081a9e`, and the review commits that followed), in `src/main/run/errand.ts`, `src/main/run/commandRunner.ts`, `src/core/errand/errandLine.ts`, `confirmClass.ts`, `errandClock.ts`, `errandMemory.ts`, `plannerCommand.ts`, `src/main/index.ts` and `src/main/cli/runCliHarness.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `a1a470bb` + the Capture Op (#466), 26 October 2026: [`../2026-10-26-a1a470bb-capture/chart.html`](../2026-10-26-a1a470bb-capture/chart.html).

## Behavioral changes since `a1a470bb` + #466

Everything below holds only while `BINGBONG_ERRAND=1` (`errandArmed`, `src/main/index.ts`); the kiosk never sets it, and #468 will route instead.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line is submitted | it is exactly `errand <words>` | an Errand starts on `<words>` with no page read and no Jev call; with no Planner configured, “The planner is not set up: its key is missing.” | `errandGoalOf`, `startErrand`, `NO_PLANNER_LINE` |
| A Task (or a Step of a line) ends | it ended `cap`, `unsure` or `unavailable` and a Planner is configured | its line, its Steps’ “Done so far” and its last Answer go to an Errand; “I couldn’t finish that.” / “I’m not sure this is it.” is not said | `HANDS_OFF`, `handsOff`, `TaskHandOff` |
| — | no Planner configured | the old end is said as before | `handsOff` |
| An Errand step begins | — | a fresh card (Jev’s builder, Jev’s Card Budget) and the memory go to the Planner; the Capsule says “Errand” with the Goal Line | `errandCardNow`, `planning` |
| The Planner answers | an action that stays | fired through the runner’s executor, quietly: Answer shown, nothing spoken; stage “Errand” on the Planner’s why | `errandAct`, `quietTurns` |
| The Planner answers | an action that leaves (Planner `leaves`, or click/Enter/submit-type on a control labelled post, send, pay, buy, order, delete, submit, publish, reply, comment, (un)subscribe) | “This will <verb>: <text>. Yes or no?” by the Site Question road; only yes/ok/okay/confirm fires it; anything else or no line in the Hot Listen window refuses into the memory and the loop goes on | `confirmOf`, `confirmLine`, `isYes`, `errandAsk` |
| The Planner answers | an action not on the card | refused into the memory, the loop goes on | `resolveAction`, `drop` |
| The Planner answers | read part N | the part’s text into the memory, never aloud | `errandRead` |
| The Planner answers | ask | the question is said; the next line is its answer; none in the window ends it: “<question> Ending there.” | `askPerson`, `unansweredLine` |
| The Planner answers | done | its own sentence, said and shown | `ending('done', …)` |
| Before a step / after a call | 90 s of work spent (paused while asked) | “Done so far: …. Ran out of time.” | `errandClock`, `capLine` |
| A Planner call | gone or past 30 s | “The planner did not answer. Done so far: …” | `unavailableLine` |
| A Planner reply | none of the answers | goes back once as a step; a second in a row ends as unavailable | `slipped` |
| A later line, Escape or the Abort Head | an Errand under way | it ends, nothing said; a waiting confirm/question gets no answer | `endErrand` |
| A line arrives | a confirm or question is waiting | it is the answer, before anything reads it; no partial fires early | `errand.wait`, `consider` |

## Chart changes

- **The whole journey:** the view grew from 1930 to 3040. A new branch leaves “The Task stops here” (its note adds “(unless an Errand takes the line)”) into “An Errand begins”, which a new “Your line is exactly “errand <words>”” box also enters (“no Jev call”). From it: done (green, the Planner’s own sentence), an action that leaves → the spoken confirm → (an exact yes) the quiet act, an action that stays → the quiet act, the question back, and the red “It ends, saying “Done so far: …”” for the cap and the Planner gone; notes give the refusal, the unanswered question, the bounds, and “Repeat: plan → confirm if it leaves → act → check.” The intro gains one sentence. Also fixed a pre-existing touch: the Shelf note’s last line ran into the feedback box’s corner; the note moved up and left. `overview.png` recaptured and inspected.
- **How it chooses an action:** a new branch from “The app reads your words” on the exact line `errand <words>` to “An Errand begins, with no Jev call”, with a note that it holds only while `BINGBONG_ERRAND=1`. Also fixed a pre-existing clip: the green “Say the fact …” box ran past the right edge; it is narrower and re-wrapped. `decisions.png` recaptured and inspected.
- **Important details:** a #467 bullet with every end line and bound. **Source references:** five `errand` files added; the provenance line names this base.
- **When you speak:** unchanged; `voice.png` kept. The ear’s behavior does not change: while an Errand waits on a confirm or a question the run is not idle (`idle()` counts the Errand), so a Hot Listen stays open as for a Task in flight, and no partial fires early. The existing note (“a Task paused on the page’s question keeps it open”) covers it in spirit; it was not reworded.
- A narrow (700 px) capture of the whole journey was inspected: it scrolls sideways, labels stay readable.

## Simplifications and uncertainty

- The `errand <words>` line is drawn as its own box beside the Errand rather than an arrow from the top input box, to keep the long route off the chart.
- The cap check runs before each step and after an unavailable call; the chart folds both into one “out of time” arrow from the Errand box.
- 90 s and 30 s are guesses in the source (`errandClock.ts`).
