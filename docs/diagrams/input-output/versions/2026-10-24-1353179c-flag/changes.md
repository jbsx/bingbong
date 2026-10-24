# Input-to-output chart — 2026-10-24, base `1353179c` + the Flag (#421)

- **Source:** base `1353179c` (`main`, 24 October 2026, after #420), plus the #421 implementation changes on branch `worktree-flag-421` in `src/core/command/cliGrammar.ts`, `src/core/command/decisionRecord.ts`, `src/core/command/answer.ts`, `src/core/command/help.ts`, `src/main/run/commandRunner.ts`, `src/main/logs/flagKeeper.ts`, `src/main/bugs/ledger.ts` and `src/main/index.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `6c642783` + #420, 24 October 2026 — [`../2026-10-24-6c642783-app-on-card/chart.html`](../2026-10-24-6c642783-app-on-card/chart.html).

## Behavioral changes since `6c642783` + #420

### Added: the Flag (#421)

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A typed line or a spoken Endpoint | its words are "mark this as a failure", "flag that" or "that was wrong", optionally with "with the hint <words>" | read before the Local Match: no Jev call, no Command, no submission (what is in flight or being read goes on), no overrun signal | `readFlagLine`, `CommandRunner.run` |
| The same | a Task has fired or been logged in this run (a `stop` or `help` is no Task) | the pane's shot is taken; the Task's records, asks and the shot are copied to `logs/flags/<taskId>/`; a `flag` record is logged; "Flagged." is shown and, with a voice, said | `flag`, `createFlagKeeper` |
| The same | no Task yet | "Nothing to flag yet." shown (grey) and said; nothing kept | `flag` |
| The shot fails | — | the flag is kept and logged without a shot; a fault is logged | `flag` |
| A spoken partial | a flag head's first word whole ("mark", "flag", "that"), more of a head, or a head and more | waits for its Endpoint; never Jev's, never an Early Fire | `headsFlagLine`, `readPartial` |

## Chart changes

- **The whole journey:** a green box left of "You type or speak what you want", reached by "you flag the last Task", with the note "No page action, no Jev; what runs goes on."
- **Important details:** one bullet for #421. **Source references:** the revision line; `cliGrammar.ts` and `flagKeeper.ts` added.

## Captures

- `overview.png` recaptured and inspected on #420's chart (the layout was settled in three rounds on #417's: the first label overlapped both boxes, the second note the box and the label below).
- `voice.png` and `decisions.png` retained from `6c642783` + #420: those views did not change. A flag partial waiting for its Endpoint is one more partial that does not fire early, which the voice view already draws.
