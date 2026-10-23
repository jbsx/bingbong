# Input-to-output chart — 2026-10-23, base `c74404d7` + the shows last under the Card Budget (#407)

- **Source:** base `c74404d7` (`main`, 23 October 2026), plus the #407 implementation changes in `src/core/command/jevReading.ts` and `src/core/decision/cardBudget.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `21b5925a` + #406, 23 October 2026 — [`../2026-10-23-21b5925a-card-budget/chart.html`](../2026-10-23-21b5925a-card-budget/chart.html).

## Behavioral changes since `21b5925a` + #406

### Changed: what is further down yields in a new order (#407)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any Jev ask is built | the card's options pass the Choice's 255 | the room the refs leave goes to the shows first, then the links to open, then the right-clicks (was opens, right-clicks, shows) | `actionQuestion` |
| Any Jev ask is built | the card is over the Card Budget | the right-clicks yield first, then the farthest links to open, then the farthest shows (was shows first) | `fitCard`, `actionQuestion` |
| Text Further Down is listed | the blocks below the view make more than 6000 characters of entries | every block is listed; the room and the budget are the only bounds (was a stop at 6000) | `textTargetsOf` |
| The budget in characters | — | 2.38 characters a token, 38,993 for 16,384 tokens (was 2.6, 42,598): link-heavy GitHub cards were refused at 2.48–2.56 | `CARD_CHARS_PER_TOKEN` |

Before this change, on uptime-kuma's README at a hop past the first, the opens filled the card and the block with its port was cut, and the card was still refused (17,151 tokens); on jellyfin's README the port was past the 6000-character stop, so Jev searched the web and hit the five-action limit.

## Chart changes

- **How it chooses an action:** the footnote's last two lines say the right-clicks and links yield before the shows. The line count is unchanged, so nothing moves.
- **Important details:** the Card Budget bullet names the new order, the room under the 255 options, and the stop's removal.
- **Source references:** the revision line.

## Simplifications

- As before, the fit is inside "Jev reads the action card"; no box or arrow is drawn for it.

## Verification

`decisions.png` (1440×2700) was recaptured with headless Chrome and inspected directly: the footnote's new lines fit the old lines' place and clear the details rule. `overview.png` and `voice.png` are retained from `21b5925a` + #406: those views are unchanged (the changed bullet is in the collapsed details).

## Unresolved

None.
