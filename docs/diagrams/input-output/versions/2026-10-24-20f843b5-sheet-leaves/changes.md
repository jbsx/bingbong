# Input-to-output chart — 2026-10-24, base `20f843b5` + a click on the pop-up that waits for it to leave (#417)

- **Source:** base `20f843b5` (`main`, 24 October 2026, #416), plus the #417 implementation changes on branch `worktree-implement-417-wall-clears` in `src/main/browser/collectPageScript.ts`, `src/main/browser/createCdpBrowserController.ts`, `src/core/perf/browserSubspans.ts` and `src/main/run/commandRunner.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `4d7b48a6` + #416, 24 October 2026 — [`../2026-10-24-4d7b48a6-dialog-text/chart.html`](../2026-10-24-4d7b48a6-dialog-text/chart.html).

## Behavioral changes since `4d7b48a6` + #416

### Changed: a click on the pop-up waits for its sheet (#417)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A click on a ref the model was shown on the dialog layer, or on a piece of the pop-up's text, has had its first effect | it went to no other document | the click waits until no dialog root is open, or the dialog shows something other than it did before the click (its text, its controls' states), at most `SHEET_LEFT_MS` (2 s), then reads its outcome (was: read at once, the sheet often still up) | `awaitSheetLeft`, `__bingbongDialogFace` |
| A click's target was in a frame | the frame went with the sheet | the outcome reads the target gone, the click done (was: the click threw "the frame … is gone") | `probeAction` |

### Changed: still open is read after every action on the pop-up (#417, CONTEXT.md Step Aside)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A Step Aside rung, or Jev's own action on the pop-up, is refused as covered or not shown (hidden, inert) | the pop-up has gone | the action landed; the Task goes on from the page it leaves (was: the Task ended `wall`) | `fire` |
| The same | a rung, the pop-up still open | the next rung fires; at the last, the Task ends `wall`, saying the pop-up is still open (was: ended `wall` at once, saying the click was blocked) | `fire`, `dismissalLadder` |
| An action on the pop-up throws (its frame gone) | the pop-up has gone | the action landed; the Task goes on (was: ended `wall`) | `fire` |

## Chart changes

- **Important details:** one bullet for #417. **Source references:** the revision line; `createCdpBrowserController.ts` added.
- No box or arrow changed: the wait is part of "The app performs the chosen action", and a Task that used to stop at a wall over a page with no pop-up now takes the "continuing action" arrow it already draws.

## Captures

- `overview.png` recaptured and inspected (unchanged layout). The Important details and Source references were inspected open in a scratch copy.
- `voice.png` and `decisions.png` retained from `4d7b48a6` + #416: those views did not change.
