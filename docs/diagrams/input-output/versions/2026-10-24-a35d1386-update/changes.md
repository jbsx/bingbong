# Input-to-output chart — 2026-10-24, base `a35d1386` + update by voice (#422)

- **Source:** base `a35d1386` (`main`, 24 October 2026), plus the #422 implementation changes on branch `worktree-implement-422-update-by-voice`: `src/core/update/updateCheck.ts` (new), `src/main/update/checkNow.ts` (new), `src/main/update/idleInstall.ts`, `src/main/update/attachUpdater.ts`, `src/core/command/appOp.ts`, `src/main/app/attachAppControl.ts`, `src/main/run/commandRunner.ts`, `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `1353179c` + #421, 24 October 2026: [`../2026-10-24-1353179c-flag/chart.html`](../2026-10-24-1353179c-flag/chart.html).

## Behavioral changes since `1353179c` + #421

The commits between `1353179c` and `a35d1386` (Night Dim over DDC/CI, the app shortcuts, e2e harness fixes) do not change the depicted flow.

### Added: the update is on the card, and picking it checks for a Release now (#422)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Any ask that builds the action card but the Where Ask | an app control is wired | the card offers one `app_update` line after the `settings` line, carrying the running version ("now version X") | `appCardOptions`, `updateOption`, `UPDATE_LABEL` |
| Jev's answer is `app_update` | any hop | a Command `{ verb: 'app', app: { kind: 'update' } }` | `readCommandAnswers`, `appOpOf` |
| An update Command fires | a Release already downloaded | "Installing version X, back in a moment." shown and spoken; once the speech ends (or is cut, or fails; at once with no voice), the app quits, installs and relaunches (exit 75 under systemd), past the Idle Screen's gate; a download that lands while the check is out installs the same way | `perform` case `app` (`afterAnswer`), `AppControl.checkUpdate`, `createCheckNow`, `IdleInstall.installNow` |
| The installing Answer has been said | a later line was submitted or fired first (`stop` among them) | nothing installs; the app keeps running (a guess) | `generation`, `submitted` in the `say`/`app` branch |
| The same | a newer Release found, not yet downloaded | "Downloading version X; it installs when the screen is idle."; its install waits for the Idle Screen as the hourly check's does (a guess, see the issue) | `createCheckNow`, `createIdleInstall` |
| The same | no newer Release | "Up to date, version X." | `createCheckNow` |
| The same | not the installed AppImage | "Updates only run in the installed app."; no fault | `attachUpdater` |
| The same | the check fails | "Couldn't check for updates."; the updater's `error` event reports the fault as before | `createCheckNow`, `attachUpdater` |
| The Task after an update | always | ends `terminal`; no page action | `endedByReading` |
| A spoken partial reads as `app` | always | never Early Fires (unchanged #420 guard) | the partial reading |

Card wording only, not drawn: the action card's `none` now reads "not a command: a remark, a question, a name, noise" (no longer "…for this page"), measured on the gate with the update line.

"update" alone has no exact grammar line: "update the page" reads as reload, so by ADR 0089 it is Jev's.

## Chart changes

- **The whole journey:** the green app box reads "…panel, view or a setting, or updates; says so"; its note now ends "A downloaded update restarts the app once it is said." The Idle Screen rule for a setting or a panel/view op moved out of that note into Important details (the #420 bullet already states it), so the note stays four lines and clears the Task-finished connector.
- **How it chooses an action:** the card box ends "the panel, the views, one “settings” line, the update"; the fact/app exit reads "Jev picks a fact, a panel or view op, or the update" and leads to "Say the fact, change the panel or view, or check for an update; say so" (four lines, x 1100 → 1092 and y 740 → 728, so it clears the "Jev picks “settings”" label and the viewBox edge). The intro names the update.
- **When you speak:** unchanged.
- **Important details:** a new #422 bullet: each result, its Answer, the install after the speech, the download's Idle Screen gate, not on the Where Ask, never early, and "update" being Jev's.
- **Source references:** the revision line; `checkNow.ts` and `updateCheck.ts` added; `attachAppControl.ts` names the updater.

## Simplifications

- The update shares the fact and app-op box and exit in both views: it is a terminal, page-free Answer. The relaunch is in the main view's note and in Important details, not a box.

## Captures

- `overview.png` (1440×2200) and `decisions.png` (1440×3150) were recaptured with headless Chrome after the last layout change and inspected directly. Text fits its boxes, the note clears the connectors, the update box clears the settings label and the right edge, and arrowheads end at their boxes. A 420 px narrow capture of the decision view (not kept) scrolls sideways and stays legible.
- `voice.png` is retained from `1353179c` + #421, since that view did not change.

## Unresolved

None.
