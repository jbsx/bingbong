# Input-to-output chart — 2026-10-24, base `a35d1386` + the Site Question (#423)

- **Source:** base `a35d1386` (`main`, 24 October 2026, after #413 and the Night Dim range), plus the #423 implementation changes, uncommitted in the worktree `worktree-implement-423-native-popups` when this chart was drawn: new `src/core/command/siteQuestion.ts`, `src/core/browser/siteQuestionDesk.ts` and `src/core/browser/panePermissions.ts`; changes in `src/main/run/commandRunner.ts`, `src/main/browser/createCdpBrowserController.ts`, `src/main/browser/createPaneBrowserController.ts`, `src/main/browser/createBrowserPane.ts`, `src/main/browser/attachDownloadRouter.ts`, `src/core/downloads/taskActivity.ts` (renamed from `agentActivity.ts`), `src/core/pipeline/events.ts`, `src/core/command/decisionRecord.ts`, `src/core/decision/askRecord.ts`, `src/core/feed/transcriptProjection.ts`, `src/core/perf/commandReport.ts`, `src/core/tts/speakingGate.ts`, `src/main/cli/runCliHarness.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `1353179c` + #421, 24 October 2026: [`../2026-10-24-1353179c-flag/chart.html`](../2026-10-24-1353179c-flag/chart.html).

## Behavioral changes since `1353179c` + #421

### Added: the Site Question (#423)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The pane's page raises a native `confirm()` | a Site Question desk is wired (the app, not a bare controller) | the dialog stays open and the page freezes; the action that raised it (its Task) stays in flight and is not superseded; the desk holds the question | `Page.javascriptDialogOpening` handler, `SiteQuestionDesk.raise` |
| The desk opens a question | — | a `site_question` event is published and "The page asks: <text> Yes or no?" is said (no text: "The page asks a question. Yes or no?"); the line in flight is noted as what raised it | `deps.siteQuestions.subscribe`, `tellSite`, `siteQuestionLine` |
| A typed line or a spoken Endpoint | a question is open | read as its answer first, after the turn id is minted and before the Flag, the Local Match and the action card | `CommandRunner.run`, `answerSite` |
| The same | the line is exactly `yes`, `ok`, `okay` or `confirm` | the page gets OK; no Jev call; "Answered OK." | `exactSiteAnswer` |
| The same | the line is `no`, `cancel` or any Dismiss Phrase | the page gets Cancel; no Jev call; "Answered Cancel." | `exactSiteAnswer`, `isDismissPhrase` |
| The same | any other line | one Jev ask, kind `site`: the question, the line that raised it, your words; one Choice of `accept`, `refuse`, `command` | `siteQuestionAsk`, `askJev` |
| Jev's answer | a sure `accept` or `refuse` (choice probability ≥ 0.7) | the page gets OK or Cancel; "Answered OK." / "Answered Cancel." shown | `readSiteAnswer`, `SITE_ANSWERS` |
| Jev's answer | a sure `command` | the page gets Cancel; then the line runs as an ordinary Command (the Flag, the Local Match, Jev's card) | `answerSite` returns false |
| Jev's answer | unsure, or Jev unavailable / no model | the page gets Cancel; "Refused the page's question." shown and said | `SITE_ANSWERS.fallback` |
| Any reading | the page closed its question meanwhile (it navigated away) | the line runs as usual | `SiteQuestionDesk.answer` returns false |
| After an answer | — | a `command` event ("answer the page's question: OK/Cancel"), a `site_answer` decision record, a `reaction` span (verb `answer`); the frozen Task goes on from its action | `answerSite` |
| A spoken partial | a question is open | ignored: no Early Fire until the Endpoint | `consider` |
| The page raises an `alert()` | — | accepted at once; "The page says: <text>" is published and said (nothing for an empty alert) | dialog handler, `SiteQuestionDesk.told`, `alertLine` |
| A leave-page warning (`beforeunload`) | a navigate, back, forward or reload Command is leaving the page | accepted (the pane lets Electron settle it); "leave-page warning accepted: left as asked" on the outcome line | `leaving`, `createPaneBrowserController` |
| The same | no Command is leaving | the page stays; reported on the outcome line | dialog handler |
| `prompt()` | — | Electron never opens it (it throws), so there is no prompt answer | `SiteQuestion` comment |

### Changed (internal, not depicted)

- A confirm with no desk (a bare controller) is refused, as every dialog was before; the old "auto-dismissed" outcome line becomes "accepted", "answered OK/Cancel by the user" or "refused".
- Permission requests the pane's policy denies are reported on the next outcome line (`panePermissions.ts`). This is browser-side policy feeding Jev's next card, not a new transition in the depicted flow.
- **Downloads (appliance output):** on the kiosk every download is saved to the downloads folder and announced; on the desktop one started during a Task (or its 5 s tail, or a navigation a Task began) is; a mouse download keeps the OS Save dialog (`routesDownload`, `createTaskActivityTracker`, `attachDownloadRouter`). The chart has never drawn downloads, so this stays outside the depicted flow.

## Chart changes

- **The whole journey:** a green box right of "You type or speak what you want", reached by "the page asked a yes/no question": "Your line answers it; the paused Task goes on", with the note "Said: “The page asks: … Yes or no?” Jev reads any line but yes or no; a new command runs after a refusal." A note left of "The app performs the chosen action" says where the question comes from and that an alert is said and closed.
- **When you speak:** the note under the early-fire branch adds "While the page asks a question, nothing fires early."; the Hot Listen note adds that a Task paused on the page's question keeps it open. Height 1570 → 1600.
- **How it chooses an action:** a new top section. "Your words reach the command runner" splits into "a page's question is open" → "Read your line as the answer to the page's question", which goes three ways: the exact lines (no Jev) → green "Answer the page: OK or Cancel"; any other line → "Jev reads your line beside the question" → a sure OK or Cancel (same green box), Jev unsure or unavailable → red "Refuse it; say “Refused the page's question.”", or a new command → refuse the question, then into the ordinary reading. "no page question is open" goes straight down to the former flow, whose first box is renamed "The app reads your words for a command" and which is drawn unchanged 760 units lower (one `shifted` helper translates it). Height 2560 → 3320. The intro sentence names the Site Question first.
- **Important details:** one bullet for #423. **Source references:** the revision line; `siteQuestion.ts` and `siteQuestionDesk.ts` added; `commandRunner.ts` and `createCdpBrowserController.ts` descriptions extended.

## Deliberate simplifications

- The whole journey draws the Site Question as one green outcome; the refusal fallback and the new-command path are in its note and drawn in full in the decision view.
- The leave-page warning and `prompt()` are explained in Important details only: neither asks the user.
- The `site_answer` record and the `reaction` span are named here, not drawn.

## Captures

- `overview.png`, `voice.png` and `decisions.png` all recaptured with headless Chrome (1440 wide; the decision view 3900 tall) and inspected directly, the decision view also in crops at full resolution. No overlaps, hidden arrows or clipped labels found on the first capture.
- A 420 px narrow capture of the decision view scrolls sideways as before (the chart keeps its 780 px minimum).
- View buttons and `?view=main|voice|decision` checked over CDP: each sets the heading, the pressed button and the drawing.

## Unresolved

- Not run live: the chart follows the source and its unit tests; no confirm was raised in the app for this chart.
