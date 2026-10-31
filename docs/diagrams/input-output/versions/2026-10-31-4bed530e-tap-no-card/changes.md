# Input-to-output chart — 2026-10-31, base `4bed530e` + #525 (accompanying implementation changes)

- **Source:** base `4bed530e` (`main`, 31 October 2026), plus #525: `src/core/idle/turnCard.ts`, `src/renderer/src/tapCommand.ts`, `src/renderer/src/useTurnCard.ts`, `src/renderer/src/NowPlayingCard.tsx`, `src/renderer/src/IdleScreen.tsx`, `src/renderer/src/App.tsx`.
- **Previous chart:** base `c35c75b1` + #516: [`../2026-10-30-c35c75b1-remembered-address/chart.html`](../2026-10-30-c35c75b1-remembered-address/chart.html), which this one replaces.

## Behavioral changes since `c35c75b1` + #516

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A tap on an Idle Screen control that leaves the screen up (a Now Playing control, the ringing Timer) | the line runs and ends | No Turn Card: the control shows what it did, and the next tap lands on it. The line is still a Command, in the Feed and the logs, and the fold still folds it. | `tapCommand`, `onControlTap`, `turnCardShows` |
| The same tap | its line fails | The card comes up on Failed, as any failed line's does. | `turnCardShows` |
| The ear opens, or speech starts in an ear already open | over a tap's line | The card comes up. A sentence said with the ear open does not bring it. | `onVoice` |
| A typed or spoken line | over a tap's running line | Its card shows from its first event. | `adopt` |
| The same tap | a card shows a running line | That card stays up. | `claimTap` |

A tap whose only effect is an Answer ("Nothing queued.") is said and goes to the Feed with no card, and a `previous` or `skip` that loads a song on the page road has no narrated wait. Both are a labelled guess in `turnCardShows`, not a settled behaviour.

## Layout and terminology

- **The whole journey:** no box or arrow added or removed. The failures note gains one line, the details bullet on the Ledger Strip gains the tap, and the source references gain `tapCommand.ts`. Recaptured: `overview.png`.
- **When you speak** and **How it chooses an action:** no drawn change; `voice.png` and `decisions.png` are retained.
- The source line named `f2c21d13`, as #516's version left it; it now names this base and the one before it.
