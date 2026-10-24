# Input-to-output chart

What happens after you type or speak a request to Bing Bong. Open the HTML in a browser; `?view=main`, `?view=voice` and `?view=decision` select a view. How to make a new version: [`docs/agents/input-output-chart.md`](../../agents/input-output-chart.md).

**Latest:** [2026-10-24, base `a35d1386` + #423](versions/2026-10-24-a35d1386-site-question/chart.html), in which a page's own yes/no question (a native confirm) holds its Task and your next line answers it before anything else (#423). [Overview](versions/2026-10-24-a35d1386-site-question/overview.png) · [changes](versions/2026-10-24-a35d1386-site-question/changes.md)

## History

| Date | Source | Chart | Notes |
| --- | --- | --- | --- |
| 2026-10-24 | `a35d1386` + #423 | [chart](versions/2026-10-24-a35d1386-site-question/chart.html) | A page's confirm pauses its Task and is said aloud; your next line answers it first: yes/ok/confirm or no/cancel with no Jev, else one Jev ask (OK, Cancel, or a new command run after a refusal); unsure refuses. An alert is accepted and said. [changes](versions/2026-10-24-a35d1386-site-question/changes.md) |
| 2026-10-24 | `1353179c` + #421 | [chart](versions/2026-10-24-1353179c-flag/chart.html) | "mark this as a failure [with the hint …]" keeps the previous Task's records and a shot under logs/flags/ and says "Flagged."; never Jev's, nothing in flight is superseded. [changes](versions/2026-10-24-1353179c-flag/changes.md) |
| 2026-10-24 | `6c642783` + #420 | [chart](versions/2026-10-24-6c642783-app-on-card/chart.html) | The panel, views and one settings line are on the card (not on the Where Ask); `settings` opens a second ask offering every setting's ops; a chosen op changes the app, says the new value and ends the Task; `open settings` (and weight, dashboard, panel, feed) is Jev's. [changes](versions/2026-10-24-6c642783-app-on-card/changes.md) |
| 2026-10-24 | `20f843b5` + #417 | [chart](versions/2026-10-24-20f843b5-sheet-leaves/chart.html) | A click on the pop-up waits up to 2 s for it to leave or show something else; a refused or frame-gone action on a pop-up that left goes on. [changes](versions/2026-10-24-20f843b5-sheet-leaves/changes.md) |
| 2026-10-24 | `4d7b48a6` + #416 | [chart](versions/2026-10-24-4d7b48a6-dialog-text/chart.html) | Over a pop-up Jev may pick a piece of its own text no control holds, clicked where it shows; the "never" sentence is said by class. [changes](versions/2026-10-24-4d7b48a6-dialog-text/changes.md) |
| 2026-10-23 | `469d7662` + #408 | [chart](versions/2026-10-23-469d7662-one-reading/chart.html) | Every line but `stop` reads the page; a line a control bears, an intent line, "the first result" and an unknown `open <word>` are Jev's; a title-only wall goes to the Verdict; Jev's sure pick leads a cookie wall. [changes](versions/2026-10-23-469d7662-one-reading/changes.md) |
| 2026-10-23 | `c74404d7` + #407 | [chart](versions/2026-10-23-c74404d7-shows-last/chart.html) | What is further down yields right-clicks first, then links, then shows; every block below is listed; 2.38 characters a token. [changes](versions/2026-10-23-c74404d7-shows-last/changes.md) |
| 2026-10-23 | `21b5925a` + #406 | [chart](versions/2026-10-23-21b5925a-card-budget/chart.html) | Every Jev ask fits the Card Budget: on a long page what is further down yields, the farthest first; a refusal keeps its status. [changes](versions/2026-10-23-21b5925a-card-budget/changes.md) |
| 2026-10-23 | `162939dd` + #401 | [chart](versions/2026-10-23-162939dd-answer-passage/chart.html) | A done Task with a sure passage pick shows the page title over the block and speaks it word for word. [changes](versions/2026-10-23-162939dd-answer-passage/changes.md) |
| 2026-10-23 | `b2796ba1` + #402 | [chart](versions/2026-10-23-b2796ba1-appliance-facts/chart.html) | The time, weather, song and timer are options on the card (not on the Where Ask); a chosen fact is said, the Idle Screen stays up, the Task ends. [changes](versions/2026-10-23-b2796ba1-appliance-facts/changes.md) |
| 2026-10-23 | `0f7e11e` + #399 | [chart](versions/2026-10-23-0f7e11e-task-end-speech/chart.html) | A Task's end says one line: "Done." after 2+ actions, "I couldn't finish that." at the cap or Jev lost. [changes](versions/2026-10-23-0f7e11e-task-end-speech/changes.md) |
| 2026-10-23 | `b1f9c34` | [chart](versions/2026-10-23-b1f9c34/chart.html) | The Hearing: spoken lines carry the names they sound like to Jev. [changes](versions/2026-10-23-b1f9c34/changes.md) |
| 2026-10-22 | `32f7348` | [prototype](../../input-output.prototype.html) | First chart; the approved template. |

The approved visual style: [reference/approved-style.png](reference/approved-style.png).
