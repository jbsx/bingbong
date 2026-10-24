# Bugs: the Failed Lines ledger

Every line that did not do what was meant lives in `fixtures/failed-lines/`
(#371), one JSON file per line, tagged with the first stage of the pipeline
that failed it. GitHub Issues hold the hypotheses and the fixes; the ledger
holds the evidence they are judged against. Memory notes and post mortems
are prose about the ledger, never a second copy of it.

## Commands

- `pnpm bugs` — the ledger as one table: a count per stage (open, claimed,
  fixed, ruled), then every line under its stage, open and unclaimed first.
  This is the widest-net view: the stage counts show where in the
  pipeline a scenario breaks; what to fix comes from the yield list
  (`docs/agents/yield.md`).
- `pnpm bugs:candidates [logs-dir]` — lines in the decision logs that look
  failed and are not in the ledger, each with what pointed at it. Flagged
  lines come first, with their hints.
- `pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…"` —
  one entry from its logged record. On an entry that exists, `--claimed
  #NNN`, `--fixed <sha>`, `--case <name>` and `--ruled "…"` update it.

## Flags

A Flag (#421) is the owner saying "mark this as a failure [with the hint
…]" in normal use: the previous Task, its records and the pane's shot are
kept in `<logs>/flags/<taskId>/`, past the 7-day purge, and reach
`pnpm logs:pull` from the kiosk. It is the strongest candidate and the one
source of failed lines from a normal day, but it is still a candidate:
read the copy and the shot, then `bugs:add <taskId> --stage <s> --meant
"…"` — the hint stands for `--happened` when none is given, and the copy
stands for the decision log once that has rolled away.

## After a post mortem

End it by adding its failed lines to the ledger, one `bugs:add` per line,
with the stage that failed first and one line each for what happened and
what was meant. A line whose logs are gone takes a `pm-<date>-<n>` id and
is written by hand with the same fields. The memory note then points at the
ledger, not the other way round.

## Before filing a fix

Run `pnpm bugs`. The new issue lists every open line it claims and sets
`claimedBy` on each. An issue that claims one line is a one-off by
construction: say so in one line, and look at the stage's other open lines
first for the wider net ([[jev-widest-net]]).

## Before closing a fix

Every claimed line is marked `fixedBy` with the commit and guarded by a Jev
corpus case (`pnpm jev:case`, named in `case`) or an e2e test, or marked
`ruled` with the owner's words. `pnpm bugs` after the close shows the
stage's open count down by what the issue claimed.
