# Input-to-output chart — 2026-10-24, base `4d7b48a6` + the pop-up's own text on the dismiss Choice (#416)

- **Source:** base `4d7b48a6` (`main`, 24 October 2026, the #417 grill's docs), plus the #416 implementation changes on branch `worktree-implement-416-dialog-text` in `src/main/browser/collectPageScript.ts`, `src/core/browser/snapshot.ts`, `src/core/browser/frames.ts`, `src/core/browser/pageText.ts`, `src/core/command/command.ts`, `src/core/command/jevReading.ts`, `src/core/command/dismissDialog.ts`, `src/main/browser/createCdpBrowserController.ts` and `src/main/run/commandRunner.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `469d7662` + #408, 23 October 2026 — [`../2026-10-23-469d7662-one-reading/chart.html`](../2026-10-23-469d7662-one-reading/chart.html). #414 (`6486d6e1`, `d15dcc32`) changed only which controls the collect finds and drew no new transition.

## Behavioral changes since `469d7662` + #408

### Changed: the dismiss Choice offers the pop-up's own text (#416, ADR 0076)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A page is collected | a dialog is open | each element of its layer in view with text of its own and inside no ref is listed with its node (a frame in the top's dialog included) | `collectPageScript` `dialogTexts`, `mergeFrames` |
| Jev is asked over a pop-up | the pop-up has controls or such text | the dismiss Choice offers `escape`, the controls, then `text-N` for each piece whose words are no way through, within the 255-option cap and its prompt's Card Budget (was: controls only; no Choice without a control) | `dismissQuestion`, `fitDialogText` |
| The dismiss instructions | always | "Never one that does what the pop-up asks of you … Only one that leaves without doing it." (was: "Never one that goes through it: …") | `DISMISS_NEVER` |
| Jev picks `text-N` | sure, or unsure | a click at the piece's box centre, rung 1 or rung 4 of the Dismissal Ladder like a control; a pop-up still open goes on down the ladder | `readDismissChoice`, `dismissalLadder`, `clickText` |

## Chart changes

- **Important details:** one bullet for #416. **Source references:** the revision line; `dismissDialog.ts` notes the text rung; `collectPageScript.ts` added.
- No box or arrow changed: the click on a piece of text is one more thing "The app performs the chosen action" may do over a pop-up.

## Captures

- `overview.png` recaptured and inspected (unchanged layout). The Important details were inspected open in a scratch copy.
- `voice.png` and `decisions.png` retained from `469d7662` + #408: those views did not change.

## Simplifications

- The text options' place under the Card Budget (they yield only when the dismiss Choice's own prompt is over) is left to the details and the code.
