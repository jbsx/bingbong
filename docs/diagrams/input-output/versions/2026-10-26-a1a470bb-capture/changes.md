# Input-to-output chart — 2026-10-26, base `a1a470bb` + the Capture Op (#466)

- **Source:** base `a1a470bb` (`main`, 26 October 2026, after #470), plus the #466 implementation on branch `worktree-impl-466`, in `src/core/command/captureOp.ts`, `src/core/command/jevReading.ts`, `src/core/command/command.ts`, `src/core/command/localMatch.ts`, `src/core/command/cliGrammar.ts`, `src/core/browser/pageText.ts`, `src/core/browser/frames.ts`, `src/main/browser/collectPageScript.ts`, `src/main/browser/createCdpBrowserController.ts`, `src/main/shelf/keepCapture.ts`, `src/main/run/commandRunner.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `2030f3d7` + the Peek Card goes (#470), 26 October 2026: [`../2026-10-26-2030f3d7-peek-card/chart.html`](../2026-10-26-2030f3d7-peek-card/chart.html). This version was first drawn on `ac3d9cd3`'s chart and drawn again on #470's when the branch was rebased.

## Behavioral changes since `2030f3d7` + #470

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The page is collected | an `<img>` no cue took as a control is drawn in view at 48 px or more on each side (inside the open dialog when one is open) | it is a ref of kind `image`, named by its alt text, numbered after every control (a frame's too); it carries no click or right-click, and its alt text is never a label a spoken verb matches | `collectElements`, `refKindOf`, `mergeFrames`, `localMatch` |
| The page is collected | a block of text lies wholly above the view | it is Text Further Up: on the card under “Text further up the page, scrolled past”, numbered `[text-N]` in page order before the blocks further down, with its Show Op; it yields to the Card Budget after the blocks further down | `renderPageText`, `textTargetsOf`, `nearestFirst` |
| The action card is built | any card but the Where Ask and the Mark Ask | it offers a Capture Op by kind: `capture-N` on each link (its address) and image, `capture-view-N` on each block the Text in view line quotes, `capture-text-N` on each block off the view, `capture-page` on a real page, all last on the card (measured on the gate: between the right-clicks and the verbs they lost a case); the copies yield to the Card Budget after the shows and the links, before the right-clicks | `actionQuestion`, `captureRefLine`, `captureTextLine`, `CAPTURE_PAGE_LINE` |
| A line is `capture <ref>` or `capture page` | the ref is a link or an image (any other ref is Jev's) | the Local Match fires it with no ask | `parseCliCommand`, `fromGrammar` |
| A capture fires | — | one evaluate reads it (a link's address; an image's bytes by the page's own fetch, a screenshot of its box when that fails; a block's whole text; the page's title over its address); it is written to bingbong_downloads as `capture-<yyyymmdd-hhmmss>-<slug>.<ext>` and put on the clipboard (an image of a type Electron cannot decode, as the PNG the page draws of it; by its path when it cannot); “Copied the link to the Shelf.” (text, image, page) is shown and said | `captureOn`, `captureImage`, `createCaptureKeeper`, `captureAnswer` |
| A capture Jev read has fired | — | the Task goes on: “Done so far” names the copy, the next hop's Verdict ends it, and what was copied is set aside for the rest of the Task | `CONTINUING`, `doneLine`, `setAsideOf` |
| A capture fires | no Shelf is wired (no keeper) | the failure line | `perform` |

## Chart changes

- **The whole journey:** (on #470's chart, whose speech note moved down) the feedback box reads “The page changes, an answer is shown, or a copy goes to the Shelf”; a new note beside it says a copy is said (“Copied the link to the Shelf.”) and the Task goes on. `overview.png` recaptured and inspected.
- **How it chooses an action:** the action card box adds “copies to the Shelf”, moved down a little so the label above it stays clear; the long note gains a paragraph on the copies and Text further up, and its Card Budget sentence names the copies; the note moved down and the view grew to 4200 so the note's last paragraph is not clipped (it was clipped by the longer note, never before). `decisions.png` recaptured and inspected.
- **Important details:** a #466 bullet; the source references add `captureOp.ts` and `keepCapture.ts`.
- **When you speak:** unchanged; `voice.png` kept from the previous version.
- A narrow (700 px) capture of the whole journey was inspected: the chart scrolls sideways and its labels stay readable.
