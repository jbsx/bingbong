# Input-to-output chart — 2026-10-24, base `43105f45` + upload by voice (#424)

- **Source:** base `43105f45` (`main`, 24 October 2026, after #420's sttEngine fix), plus the #424 implementation changes on branch `worktree-implement-424-shelf` (uncommitted when charted), chiefly in `src/main/run/commandRunner.ts`, `src/core/command/shelfAsk.ts`, `src/core/shelf/shelf.ts`, `src/main/shelf/readShelf.ts`, `src/main/browser/createPaneBrowserController.ts`, `src/main/browser/createCdpBrowserController.ts`, `src/core/command/jevReading.ts`, `src/core/command/appOp.ts`, `src/core/settings/settingKinds.ts`, `src/core/command/spokenFailure.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `1353179c` + #421, 24 October 2026 — [`../2026-10-24-1353179c-flag/chart.html`](../2026-10-24-1353179c-flag/chart.html).

## Behavioral changes since `1353179c` + #421

### Added: upload by voice, the Shelf ask (#424, ADR 0092)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The pane attaches its debugger | always | every file chooser is intercepted: the OS Open dialog never opens | `Page.setInterceptFileChooserDialog` in `createPaneBrowserController` |
| A `click` or `press` is about to fire | a chooser the page opened earlier is pending | it is taken and dropped, never answered by this line | `OPENS_CHOOSER`, `takeFileChooser` in `fire` |
| A `click` or `press` has fired | the page opened its file chooser (a file field, or a site's button over a hidden one) | the Shelf ask: which file on the Shelf the words mean, or `none` | `upload`, `fitShelfAsk` |
| The Shelf ask | the Shelf is empty, or no model is configured | nothing is asked or set | `upload` |
| The Shelf ask | Jev does not answer, or answers `none` | nothing is set | `upload`, `readShelfAnswer` |
| A file is picked | it sets on the field | the page's change fires; nothing is submitted; "Attached &lt;name&gt;." shown and, with a voice, said | `upload`, `attachFiles`, `fire` |
| A file is picked | setting it fails | a fault is logged; treated as no file | `upload` |
| No file set | any of the above | "No file on the shelf fits that upload." shown in the failure colour and said | `SPOKEN_FAILURES.noShelfFile` |
| Any upload outcome | — | the Task ends (`terminal`): no later hop can send the form | `settleHop` |
| The Shelf | read on each upload | the downloads folder and the Settings upload folder, each flat, files only, hidden and still-downloading files left out, newest first, cut to the Card Budget (at most 254) | `readShelf`, `shelfFolders`, `onShelf`, `fitShelfAsk` |
| The action card | a ref is a file input | named `file field`, with `accepts "…"` and `takes several files` on its line; no new option | `jevReading.ts` ref line |
| The settings ask | the upload folder (`shelfFolder`) | set to the folder the words name, looked up among the home folder's folders and those one below; or cleared; the Answer names it; not found fails | `opsOfSetting`, `folderOfWords`, `findFolder`, `appAnswer` |

## Chart changes

- **The whole journey:** a branch left of "The app performs the chosen action", labelled "the page opened its file chooser", to "Jev is asked which file on the Shelf your words mean", then a green "The file is set on the field; “Attached …” said" ("a file is picked") and a red "“No file on the shelf fits that upload.”" ("empty Shelf, none, or no answer"), with the note "Nothing is sent. Either way the Task ends here." To make room the action column moved right (x 440 → 520) and everything from "The page changes, or an answer is shown" down moved 370 units lower; "Jev reads the new page" moved right to sit under the wider spacing.
- **How it chooses an action:** below "Perform the command", a conditional follow-up ask, "Ask Jev which file on the Shelf the words mean, or none", reached by "a click or key opened the page's file chooser", with the same green and red outcomes and the same note. The intro mentions the follow-up ask; the closing note gains a paragraph on the `file field` ref line, the Shelf and the upload folder setting. The closing note moved 530 units lower.
- **Important details:** one bullet for #424. **Source references:** the revision line; `shelfAsk.ts`, `readShelf.ts`, `shelf.ts` and `createPaneBrowserController.ts` added.

## Simplifications

- The two outcome boxes leave out a set that fails after a pick (it reads as no file, the red box) and the fault it logs.
- A chooser the page opens outside a Command (dropped by the next click or key) is in Important details only.
- The upload folder setting is drawn by the existing "a setting op is picked" path; its folder lookup is in the closing note and Important details.

## Captures

- `overview.png` recaptured (1440×2560) and inspected twice: the first capture had the red outcome box over the action's down arrow and the "the action returns" label's backing cutting that arrow, and the two notes on the left touching; the outcomes were narrowed and moved left, the label centred on its arrow and the "Read" note moved down. The second capture was clean; the new branch was also inspected at full resolution.
- `decisions.png` recaptured (1440×3800) and inspected, the new ask and outcomes also at full resolution: clean on the first capture.
- `voice.png` retained from `1353179c` + #421: the voice view did not change. An upload line is heard, endpointed and fires like any other; its Shelf ask comes after the action, never during capture.
- A narrow (420 px) capture of the decision view scrolls sideways with labels legible. The view buttons were exercised by clicking each in headless Chrome over CDP (heading and pressed button follow), and the direct `?view=main` and `?view=decision` URLs were loaded for the captures.

## Uncertainty

- None left. "the page's change fires" when a file is set was not run while drawing; `e2e/upload.e2e.test.ts` proves it (the fixture page's own `change` echoes `invoice.pdf` and `me.png`, the form unsent, no Open window on the display).
