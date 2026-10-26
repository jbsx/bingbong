# Input-to-output chart — 2026-10-26, base `a63fde2d` + every Try line parses (#445)

- **Source:** base `a63fde2d` (`main`, 26 October 2026, after the ear's waits #442), plus the #445 implementation on branch `worktree-impl-445-try-lines-timer-lint`, in `src/core/command/tryLine.ts` and `src/core/command/answer.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `815d4c6c` + the ear's waits narrated (#442), 26 October 2026: [`../2026-10-26-815d4c6c-ear-waits/chart.html`](../2026-10-26-815d4c6c-ear-waits/chart.html).

## Behavioral changes since `815d4c6c` + #442

No transition changes. Three spoken and shown Try lines change, because the Local Match could not read them without Jev:

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A cookie notice stayed after the consent rule's click | — | `Try “back”.` (was `click accept`, which fires only beside a button labelled “Accept”) | `BY_FAILURE` |
| An address would not open | any host, an IP or localhost included | `Try “back”.` (was `search <host>`: no search line is the grammar's, and `navigate <host>` opens it again) | `BY_KIND.navigate` |
| Nothing found here, with the words | the words are no address | `Try “navigate <words>”.` (was `search <words>`, Jev's); words that read as an address (one bare word: `loop` → loop.com) get `Try “help”.` | `searchLine` |
| A song would not play | — | no Try line (was `not that one`, Jev's under ADR 0089; the Queue already moved on) | `BY_KIND.play` |

## Chart changes

- **Important details:** the narrated-wait bullet's list of Try lines is the new one, with a sentence that every Try line is read by the Local Match with no Jev call (#445).
- **Source references:** the base line updated.
- **The whole journey, When you speak, How it chooses an action:** unchanged; no box or arrow names a Try line's words. Their captures (`overview.png`, `voice.png`, `decisions.png`) are retained from the previous version.
