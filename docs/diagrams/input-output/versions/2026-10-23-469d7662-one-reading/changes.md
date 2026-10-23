# Input-to-output chart — 2026-10-23, base `469d7662` + one reading on every page (#408)

- **Source:** base `469d7662` (`main`, 23 October 2026, the #408 grill's docs), plus the #408 implementation changes on branch `worktree-implement-408-one-reading` (commits `49eb89b3`, `ca117faa`, `69bbd972`) in `src/core/command/localMatch.ts`, `src/core/music/musicWords.ts`, `src/core/command/jevReading.ts`, `src/core/command/mediaOp.ts`, `src/core/browser/knownAddresses.ts`, `src/core/command/spokenFailure.ts`, `src/core/browser/blockerNudge.ts`, `src/core/browser/unavailablePage.ts`, `src/core/browser/dialogPolicy.ts`, `src/core/command/dismissDialog.ts` and `src/main/run/commandRunner.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `c74404d7` + #407, 23 October 2026 — [`../2026-10-23-c74404d7-shows-last/chart.html`](../2026-10-23-c74404d7-shows-last/chart.html).

## Behavioral changes since `c74404d7` + #407

### Changed: an exact line is local only when it has one reading on the page (ADR 0089)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A line is read | it is `stop` | fires at once, the page unread (an abort) | `pageFree` |
| A line is read | any other line | the page is read first, and the Local Match runs over it (was: page-free lines fired without it) | `read`, `readPartial` |
| The Local Match | a ref's label is the whole line ("next" beside a Next link, "continue" beside Continue) | no Local Match: Jev is asked | `aRefIsLabelled` |
| The Local Match | "not that one", "the other one", "wrong one", "show it", "last page", "where was i", "the first result" | no Local Match: Jev is asked (was: the Player's correction, `show`, `resume`, the Nth result) | `WHOLE_LINES`, `VERB_PHRASES` |
| The Local Match | `open <one word>` | navigates the Known Address the word names, a host landed on; else Jev is asked (was: `<word>.com`) | `openableAddress`, `knownAddressOf` |
| Jev's action card | the Queue holds a song | also offers `correct`, `correct_back`, `forget` | `applianceVerbsOf` |
| Jev's action card | a media ref | `volume-N` / `rate-N`, the amount Choice saying up, down or to and how far (was: up or down read from the words) | `amountQuestion`, `volumeLevel`, `rateLevel` |

### Changed: a landing ends the Task unasked only on a fact

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| An action lands | status 404/410/5xx, a challenge host or token | the class line, the Task stops (as before) | `spokenFailureOf` |
| An action lands | only the title or text reads as not found, unavailable, a wall or empty | the Task goes on to the next hop, even after a Local-Matched open, whose Verdict reads the landing (was: the Task stopped with the line) | `suspectedFailureOf`, `settleHop` |
| The next hop | Jev does not answer and the landing was suspected | the class line is said; the Task stops | `continueTask` |

### Changed: the Dismissal Ladder over a cookie wall

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A pop-up is dismissed | a cookie wall the rule reads | Jev is asked too; its sure pick is the first rung, the rule's reject (never one that pays or subscribes) then accept the fallback (was: the rule's reject first, no ask) | `dismissalLadder`, `dismissalOf`, `dismissConsentIfOpen` |

## Chart changes

- **The whole journey:** the local arrow reads "an exact command with one reading on this page"; the follow-up arrow "a continuing action, or a landing that reads as a wall"; the stop arrow "failure, a wall by a fact, no answer, no progress or limit"; the stop note adds that a landing that only reads as a wall says its line when Jev cannot judge it.
- **How it chooses an action:** the local arrow reads "Local Match resolves it: one reading on this page"; the footnote adds the lines that are Jev's, the Known Address, the correction verbs and the amount Choice's direction. View height 2200 → 2400; the footnote moved down to make room.
- **Important details:** one bullet for #408. **Source references:** the revision line, plus `localMatch.ts`, `knownAddresses.ts`, `dismissDialog.ts`.

## Simplifications

- The Dismissal Ladder and the cookie chooser are not drawn; they stay in the details bullet.
- The landing's suspected path is folded into the existing "Jev reads the new page" box rather than a box of its own.

## Verification

`overview.png` (1440×2200) and `decisions.png` (1440×3000) were recaptured with headless Chrome and inspected directly: labels fit, arrows reach their boxes, the footnote clears the details rule. A 600 px narrow capture of the decision view scrolls sideways as designed and stays legible. `voice.png` is retained from `c74404d7` + #407: that view is unchanged.

## Unresolved

None.
