# Input-to-output chart — 2026-10-24, base `765548d3` + upload by voice (#424)

- **Source:** base `765548d3` (`main`, 24 October 2026, after #423 and the #419 kiosk flag), plus the #424 implementation on branch `worktree-implement-424-shelf`, rebased onto it: `2d542e26` (the Shelf ask) and `0aa0b7de` (its review), chiefly in `src/main/run/commandRunner.ts`, `src/core/command/shelfAsk.ts`, `src/core/shelf/shelf.ts`, `src/main/shelf/readShelf.ts`, `src/main/browser/createPaneBrowserController.ts`, `src/main/browser/createCdpBrowserController.ts`, `src/core/browser/snapshot.ts`, `src/core/command/jevReading.ts`, `src/core/command/appOp.ts`, `src/core/settings/settingKinds.ts`, `src/core/command/spokenFailure.ts`, `src/core/command/decisionRecord.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `a35d1386` + the Site Question (#423), 24 October 2026: [`../2026-10-24-a35d1386-site-question/chart.html`](../2026-10-24-a35d1386-site-question/chart.html).
- This version replaces a first draft of the same change, drawn on base `43105f45` from the #421 chart before #423 landed. The folder was renamed and the chart rebuilt from #423's.

## Behavioral changes since `a35d1386` + #423

### Added: upload by voice, the Shelf ask (#424, ADR 0092)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The pane attaches its debugger, or it detaches | always | every file chooser is intercepted, and interception is re-armed when the debugger detaches: the OS Open dialog never opens | `Page.setInterceptFileChooserDialog` in `createPaneBrowserController` |
| A `click` or `press` is about to fire | the page opened a chooser earlier | that chooser is taken and dropped, never answered by this line | `OPENS_CHOOSER`, `takeFileChooser` in `fire` |
| A `click` or `press` has fired | the page opened its file chooser (a file field, or a site's button over a hidden one) | the Shelf ask: which file on the Shelf the words mean, or `none` | `upload`, `fitShelfAsk` |
| The Shelf ask | the Shelf is empty | nothing is asked or set; reason `empty` | `upload` |
| The Shelf ask | no model is configured, or Jev does not answer | nothing is set; reason `unread` | `upload` |
| The Shelf ask | Jev answers `none` | nothing is set; reason `none` | `upload`, `readShelfAnswer` |
| A file is picked | it sets on the field | the page sees the change; nothing is submitted; "Attached &lt;name&gt;." shown and, with a voice, said | `upload`, `attachFiles` (`DOM.setFileInputFiles`), `fire` |
| A file is picked | setting it fails | a fault is logged; nothing is set; reason `unset` | `upload` |
| No file set | reason `empty` or `none` | "No file on the shelf fits that upload." shown in the failure colour and said | `SPOKEN_FAILURES.noShelfFile` |
| No file set | reason `unread` | "I couldn't finish that." shown in the failure colour and said | `SPOKEN_FAILURES.notFinished` |
| No file set | reason `unset` | "That didn't work." shown in the failure colour and said | `SPOKEN_FAILURES.failed` |
| Any upload outcome | — | the decision record carries `upload` with its `reason`; the Task ends (`terminal`): no later hop can send the form | `UploadDetail`, `settleHop` |
| A field whose chooser was left unanswered | the next line clicks it again | it opens its chooser again and the Shelf ask runs | `e2e/upload.e2e.test.ts` |
| The Shelf | read on each upload | the downloads folder and the Settings upload folder (`~` expanded, resolved by realpath, each read once), each flat, files only, hidden and still-downloading files left out, newest first, cut to the Card Budget (at most 254) | `readShelf`, `shelfFolders`, `onShelf`, `fitShelfAsk` |
| The action card | a ref is a file input | named `file field`, with `accepts "…"` and `takes several files` on its line; no new option | `fileFieldClause`, `jevReading.ts` ref line |
| The settings ask | the upload folder (`shelfFolder`) | set to the folder the words name, or cleared. The folder is looked up among the home folder's folders and those one below: its whole path below home among the words, else its own name; most words said, then the shallowest. The Answer names it; a folder not found fails | `opsOfSetting`, `folderOfWords`, `findFolder`, `appAnswer` |

## Chart changes

- **The whole journey:** a branch left of "The app performs the chosen action", labelled "the page opened its file chooser", leads to "Jev is asked which file on the Shelf your words mean". It splits into a green "The file is set on the field; “Attached …” said" ("a file is picked") and a red "“No file on the shelf fits that upload.”" ("the Shelf is empty, or Jev picks none"). A note under them reads: "No model or no answer: “I couldn’t finish that.”; a set that fails: “That didn’t work.” Nothing is sent; the Task ends here either way." To make room:
  - the action column moved right (x 440 → 520);
  - everything from "The page changes, or an answer is shown" down moved 370 units lower (height 1560 → 1930);
  - "Jev reads the new page" moved right;
  - #423's note "A page’s yes/no question pauses the action…" moved from the left of the action to the right of "The page changes", because the new branch takes its old place.
- **How it chooses an action:** below "Perform the command" (inside #423's shifted ordinary reading) there is a conditional follow-up ask, "Ask Jev which file on the Shelf the words mean, or none". Its arrow reads "a click or key opened the page’s file chooser". It has the same green and red outcomes and the same note. Other changes in this view:
  - the intro mentions the follow-up ask;
  - the closing note gains a paragraph on the `file field` ref line, the Shelf and the upload folder setting, and moved 540 units lower;
  - height 3320 → 3970.
- **Important details:** one bullet for #424. **Source references:** the revision line, plus `shelfAsk.ts`, `readShelf.ts`, `shelf.ts` and `createPaneBrowserController.ts`.

## Deliberate simplifications

- The red box carries the one #424-specific line. The other two failure lines ("I couldn't finish that.", "That didn't work.") are in the note under it, not drawn as boxes.
- A chooser the page opens outside a Command, dropped by the next click or key, is described only in Important details. So is a field left unanswered opening again.
- The upload folder setting goes through the existing "a setting op is picked" path. Its folder lookup is described in the closing note and Important details.

## Captures

- `overview.png` was recaptured (1440×2560) and inspected twice, the second time also as a full-resolution crop of the new branch. On the first capture the note with the failure lines nearly touched the "Read" note, so the "Read" note moved 20 units lower. The second capture was clean.
- `decisions.png` was recaptured (1440×4750) and inspected, the new ask and the closing note also as full-resolution crops. On the first capture (height 3910) the closing note's last lines were clipped. Height went to 3970 and the note moved up 50. The second capture was clean, with nothing clipped.
- `voice.png` was taken from `a35d1386` + #423, which changed that view. #424 does not change it: an upload line is heard, endpointed and fires like any other, and its Shelf ask comes after the action, never during capture.
- The view buttons were exercised by clicking each in headless Chrome over CDP: the heading and the pressed button follow. The direct `?view=main` and `?view=decision` URLs were loaded for the captures.

## Unresolved

- None. The change event the first draft left open is settled by `e2e/upload.e2e.test.ts`: the site sees the file that was set, and nothing is sent.
