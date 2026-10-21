# The Failed Lines ledger

One file per spoken or typed line that did not do what was meant (#371):
the words, when, the decision log it came from, the **first failing
stage** of the pipeline, what happened, what was meant, and who claims
it. The unit is the observed line, never the hypothesis about it: the
cause is what `pnpm bugs` lets the reader derive by looking at the whole
pile grouped by stage. Nine lines under one stage is a strategy problem;
one is a one-off.

Stages, in the pipeline's order: `stt` (the words heard were not the
words said), `turn` (the Utterance cut or joined wrong), `local_match`
(the Local Match fired where it should not have), `reading` (Jev picked
wrong among options that existed), `missing_option` (no Appliance Verb, op or
verb could do it), `runner` (the hop policy: cap, unchanged, undo, the
Verdict, what was said), `player`, `page` (a stale label, late
hydration, a wall).

- `pnpm bugs` prints the ledger: a count per stage, then every line under
  its stage, open and unclaimed first.
- `pnpm bugs:candidates` lists the lines in the decision logs that look
  failed and are not here yet — the same words again within 30 s, a Task
  ended `cap`/`unsure`/`wall`/`unchanged`/`not_found`, a hop-0 `none` Jev
  was unsure of, a resume right after, an undo, a Misfire signal.
- `pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…"`
  writes one from its logged record; `--claimed #NNN`, `--fixed <sha>`,
  `--case <name>` and `--ruled "…"` update it.

A line is **open** until it carries `fixedBy` or `ruled`. An issue that
fixes behaviour claims every open line it covers (`claimedBy`), and says
so in one line when it claims only one. Closing it marks each claimed
line `fixedBy`, guarded by a Jev corpus case or e2e test in `case`, or
`ruled` with the owner's words. See `docs/agents/bugs.md`.
