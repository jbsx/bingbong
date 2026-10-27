# Input-to-output chart — 2026-10-27, base `36c1f57a` + update by voice (#422)

- **Source:** base `36c1f57a` (`main`, 27 October 2026), plus the #422 implementation on branch `worktree-impl-422b`. The behaviour is in `src/core/command/applianceCard.ts` (`applianceQuestions`), `src/core/command/appOp.ts` (`updateOption`), `src/main/update/checkNow.ts` (`createCheckNow`, `CHECK_NOW_WAIT_MS`), `src/core/update/updateCheck.ts` (`updateAnswer`), `src/main/update/attachUpdater.ts` and `src/main/run/commandRunner.ts` (the `app` verb's `update` op, the install after the Answer). The containing commit records the exact snapshot.
- **Previous chart:** base `57b5ecac` + #484 (a page scroll ends on a cheap check), 27 October 2026: [`../2026-10-27-57b5ecac-scroll-check/chart.html`](../2026-10-27-57b5ecac-scroll-check/chart.html).

## Behavioral changes since `57b5ecac` + #484

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The Appliance Card is built | the app's state is in hand | It offers `app_update`, "app: update — now version X", beside the settings line. The page card and the Where Ask do not offer it. | `applianceQuestions`, `updateOption` |
| Jev picks `app_update` surely | — | A Release check runs, waiting at most 8 s. One fixed Answer is shown and said, and the line ends. There is no page collect and the page is untouched. | `perform` (`app` verb), `createCheckNow` |
| The same | a Release is already downloaded | "Installing version X, back in a moment." When the Answer has been said (or cut, or has failed), the app quits, installs and restarts; under systemd it exits 75. A later line that comes first, `stop` among them, keeps the app running. | `afterAnswer`, `IdleInstall.installNow` |
| The same | a newer Release is found | "Downloading version X; it installs when the screen is idle." It installs at the Idle Screen, as the hourly check's does. | `createCheckNow` |
| The same | no newer Release | "Up to date, version X." | `updateAnswer` |
| The same | not the installed AppImage | "Updates only run in the installed app." No fault. | `attachUpdater` |
| The same | the check fails (the feed 404s) or does not answer in 8 s | "Couldn't check for updates." The Command ends. A failure reports the updater's fault; a check that answers after the 8 s goes on in the background, and a Release it finds installs at the Idle Screen. | `CHECK_NOW_WAIT_MS` |

Unchanged: the hourly check, the Idle Screen install gate, and every other road.

## Views

- **Whole journey:** recaptured and inspected. The note under "It does what Jev picked, and the line ends there" now says that an update says what it found and, with a Release downloaded, restarts into it. The Flag's "Flagged." stays in its own box at the top left, and "an op that cannot fire goes on" stays in the Appliance Card's details bullet. A new details bullet, "Update by voice (#422)", lists the five Answers.
- **When you speak:** unchanged; its capture is kept.
- **How it chooses an action:** unchanged (the update is one of the app's ops on the Appliance Card); its capture is kept.
