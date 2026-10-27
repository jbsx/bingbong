# Input-to-output chart — 2026-10-27, base `3aebe32b` + a line wholly heard as an exact line (#478)

- **Source:** base `3aebe32b` (`main`, 27 October 2026, after #482), plus the #478 implementation on branch `worktree-impl-478b`, in `src/core/command/cliGrammar.ts` (`FLAG_HEADS`), `src/core/command/nameMatch.ts` (`wholeCommandHearing`), `src/core/command/heardLine.ts` (`exactLineHeard`), `src/core/command/decisionRecord.ts` (`lineHeard`) and `src/main/run/commandRunner.ts` (`run`, `heardExactly`). The containing commit records the exact snapshot.
- **Previous chart:** base `ee190c17` + the Answer Passage by section (#482), 27 October 2026: [`../2026-10-27-ee190c17-answer-section/chart.html`](../2026-10-27-ee190c17-answer-section/chart.html). This version is drawn on that chart.

## Behavioral changes since `ee190c17` + #482

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A typed line or a spoken Endpoint | its words are “mark as failure”, optionally with “with the hint <words>” | the Flag, as for its other heads | `FLAG_HEADS`, `readFlagLine` |
| A spoken Endpoint, no Errand answer pending | its Hearing over the command phrases (and the Learned Terms, never the Page Terms) is one command phrase over every word, the line's first word is the phrase's own, and the phrase is a Flag head or a Local Match with no page | read as that phrase from here on, before the Flag read: the Flag and the Local Match read the phrase, with no Jev call. The Capsule and the Feed still show the words heard (the Receipt), and the record carries them (`lineHeard`) beside the phrase as its `transcript` | `wholeCommandHearing`, `exactLineHeard`, `CommandRunner.run` |
| The same | only part of the line is covered, two phrases are heard, the first word was heard as another verb, or the phrase is one Jev reads (an app option, a dismiss phrase) | as before: the line goes on as heard, the Hearing on Jev's card | `exactLineHeard` |

This is a new road from the ear to the exact-line readers. Before, a spoken line reached the Local Match or the Flag only when it was spelled exactly.

## Chart changes

- **The whole journey:** the arrow into “The app recognizes an exact command” reads “an exact command, or a spoken line that all sounds like one”. The Flag bullet names “mark as failure”, and the Hearing bullet names the road that skips Jev.
- **When you speak:** the runner box adds “a line that all sounds like one command is read as it”. The box moved 12 px down to clear its arrow label.
- **Source references:** the revision line is updated and `heardLine.ts` is added.

## Captures

- `overview.png` and `voice.png` were recaptured and inspected. A first four-line arrow label overlapped the Flag note and the box below, so it was cut to two lines.
- `decisions.png` is retained from `ee190c17` + #482: the decision view did not change.
