# Input-to-output chart — 2026-10-29, base `c1ec6124` + #511’s pending play on the joined card

- **Source:** base `c1ec6124` (`main`, 29 October 2026), plus #511’s change: `src/core/command/applianceCard.ts` (`pickLines`, `withPicked`, `applianceState`), `src/core/command/jevReading.ts` (`JoinedLine.opening`) and `src/main/run/commandRunner.ts` (`settleFate`). The containing commit records the exact snapshot.
- **Previous chart:** base `9fe97ba0` + #508’s `resume` over a running line: [`../2026-10-29-9fe97ba0-resume-read/chart.html`](../2026-10-29-9fe97ba0-resume-read/chart.html). This version is drawn on that chart.

## Behavioral changes since `9fe97ba0` + #508

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A correction joins a running `play` (“play yellow”, then “no, by coldplay”) | the play has fired and is still in flight, and the Player holds no pick for it yet (its search has not answered) | Before: the joined ask carried the joined words, the page and “Playing: nothing”, nothing of the song being looked up; on the audio road Jev read the Slot `by coldplay` and “Best of Coldplay” played. Now: the joined ask says the search in the pick’s place, right after the words: “Music being looked up: a search for “yellow”, nothing picked or playing yet”; no `correct` is offered (there is no pick). Jev reads `yellow by coldplay` and Yellow by Coldplay plays. | `pickLines`, `settleFate` |
| The same | the Player holds the pick (“Music picked: …”), or the song already plays | Unchanged: the pick’s line, or the `Playing:` line, as before. | `pickLines` |

## Chart changes

- **The whole journey:** the Overlap’s foot note gains one line under the joined pick’s: “Before anything is picked it is read with the search still being looked up (#511): “no, by coldplay” keeps “yellow”.” The note block was moved down 15 units and the audio road’s section 20 units (the view 20 units taller) so the longer block clears the joins column’s note above and the section below by the gaps they had. `overview.png` was recaptured at full height (1440 × 7400); the Overlap foot and the audio road’s section were inspected, and a details-open copy of the Overlap bullet.
- **Important details:** the Overlap bullet’s joins clause gains the pending search. **Source references** name the new base.
- **When you speak** and **How it chooses an action:** unchanged; `voice.png` and `decisions.png` carried over.

## Simplifications

- No new box or arrow: the joins road is unchanged; only what its one ask carries grows.
