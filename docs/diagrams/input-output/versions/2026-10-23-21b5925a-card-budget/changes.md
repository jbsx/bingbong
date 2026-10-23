# Input-to-output chart — 2026-10-23, base `21b5925a` + the Card Budget (#406)

- **Source:** base `21b5925a` (`main`, 23 October 2026), plus the #406 implementation changes in `src/core/command/jevReading.ts`, `src/core/decision/cardBudget.ts`, `src/core/decision/decisionRouting.ts`, `src/core/command/decisionRecord.ts`, `src/main/decision/createJevDecisionModel.ts` and `src/main/run/commandRunner.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `162939dd` + #401, 23 October 2026 — [`../2026-10-23-162939dd-answer-passage/chart.html`](../2026-10-23-162939dd-answer-passage/chart.html).

## Behavioral changes since `162939dd` + #401

### Added: every ask fits the Card Budget (#406, ADR 0088)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any Jev ask is built (hop 0, a later hop, the Where Ask, the Mark Ask, a partial, a dismiss phrase) | the card fits the Card Budget (16,384 of the host's tokens, built at 2.6 characters a token) | sent as before | `fitCard`, `cardBudgetChars` |
| Any Jev ask is built | the card is over the budget | what is further down yields until it fits: the shows first, then the right-clicks, then the farthest links to open; the state names only the links its card opens. The words, refs and text in view, Verdict, passage, verbs and facts are never cut | `fitCard`, `actionQuestion`, `commandState` |
| The host still refuses the ask | an HTTP error | the hop ends unavailable as before; the record keeps `httpStatus` and the host's message, and the fault log a `run.commandRunner.jevUnavailable` fault | `jevUnavailableOf`, `askJev` |

Before this change a hop past the first on a link-heavy page (the Playwright README, a Wikipedia article, a GitHub repo) sent a 51–63k-character card, the host answered 422, and the Task ended unavailable with the answer on screen.

## Chart changes

- **How it chooses an action:** footnote ¹ ends with two lines on the Card Budget; it moves down 42 (y 1952) so its top stays where it was, and the view's canvas grows from 2110 to 2200.
- **Important details:** a new first bullet on the Card Budget.
- **Source references:** the revision line; `jevReading.ts` names `fitCard`; `cardBudget.ts` added.

## Simplifications

- The fit is inside "Jev reads the action card"; no box or arrow is drawn for it.

## Verification

`decisions.png` (1440×2700) was recaptured with headless Chrome and inspected directly. The first capture, before the footnote moved, put its first line over "straight to the numbered screenshot ask"; moved down 42 it clears that note, and its last line clears the details rule. `overview.png` and `voice.png` are retained from `162939dd` + #401: those views are unchanged (the new bullet is in the collapsed details).

## Unresolved

None.
