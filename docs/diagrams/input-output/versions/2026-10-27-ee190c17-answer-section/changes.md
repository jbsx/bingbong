# Input-to-output chart — 2026-10-27, base `ee190c17` + the Answer Passage by section (#482)

- **Source:** base `ee190c17` (`main`, 27 October 2026, after #475 and #481), plus the #482 implementation on branch `worktree-impl-482`, in `src/core/command/passageSections.ts`, `src/core/command/jevReading.ts` (`readPassage`) and `src/main/run/commandRunner.ts` (`endDone`, `passageText`). The containing commit records the exact snapshot.
- **Previous chart:** base `66dc5873` + the Ledger Strip (#475), 27 October 2026: [`../2026-10-27-66dc5873-ledger-strip/chart.html`](../2026-10-27-66dc5873-ledger-strip/chart.html). This version is drawn on that chart.

## Behavioral changes since `66dc5873` + #475

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A hop's Verdict (or the Where Ask's) is a sure yes | the passage Choice's blocks of one section — a heading and the blocks under it to the next heading, or, before any heading, a run of table rows, list items or code — sum to 0.7 or more | the Task ends done and says that section, every block of it, in reading order. Before, one block had to reach 0.7 alone, so an answer split over a heading and its command (0.65 + 0.22 + 0.11) said nothing | `readPassage`, `sectionsOf` |
| The section is said | its blocks have nodes on the page | each block is read whole off its node (one evaluate each, as a capture reads a block) and said and shown whole; before, the card's 300-character hold was said (“…except FreeB”) | `passageText`, `BrowserController.capture` |
| The section is said | a block has no node, or the page no longer has it | that block is said as the card held it | `passageText` |
| A sure yes | no section reaches 0.7 | ends done saying nothing, as before | `endDone` |

The passage Choice on the card is unchanged: one option a block (measured; see #482).

## Chart changes

- **The whole journey:** the green end box reads “This Step is finished; it says the section that answers, whole, else “Done.” after 2+ actions”. `overview.png` recaptured and inspected.
- **How it chooses an action:** the Where Ask footnote says “the section Jev surely chose”. `decisions.png` recaptured and inspected.
- **When you speak:** unchanged; `voice.png` recaptured.
- **Important details:** a #482 bullet after the Answer Passage's names the section rule, the summed 0.7 bar, the whole read off the page and the fallback to the held text.
- A narrow (700 px) capture of the whole journey was inspected: the chart scrolls sideways and its labels stay readable.
