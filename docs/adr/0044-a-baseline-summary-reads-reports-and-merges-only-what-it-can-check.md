# ADR 0044: A Baseline summary reads reports, and merges only what it can check

## Status

Accepted on 2026-09-12 and implemented in #233 the same day. Extends the
live-web reporting contract of #226 (one capture set → one report) with a
second, offline projection over N reports. It changes nothing a single report
derives; the one additive change to the report — `reportVersion 2`, carrying
the reviewer identities and the per-row prompt version — exists so that this
summary can refuse without reaching past the report.

## Context

The live-web baseline (#223) is three Passes of one protocol on one route,
and the protocol asks for what the three say together: every result, and
descriptive medians per task, never a p95. `pnpm live:report` takes one
capture set by design. The three per-set reports sat side by side, and the
cross-pass picture — the Eurostar follow-up verified at 288 s and 297 s and
then failed; eight of twelve initials ended `budget_exhausted` — lived in a
chat message and a memory note. A summary written by hand from three reports
can drift from them, and nothing would notice.

Two ways to build the summary were open:

- Read the capture sets and grades again and count across them. Every
  disposition, grade binding, timing and usage question would be answered a
  second time, by a second implementation of the rules #226 settled — the
  digest binding of a grade to its Answer, the corrective-chain start, the
  censored elapsed time, the per-role usage floor — and the two would
  diverge the first time one of them changed.
- Read the JSON reports `live:report` already writes. The report resolved
  every one of those questions once, and the summary counts what it says.

The second needs the report to say enough for the summary to refuse a mix.
Version 1 named the key, the routing and the study, but not who graded and
not which prompt each row ran under; the reviewer was in the grades file the
summary must never read, and the prompt version only as a set-wide list.

## Decision

- **The input is the report, never the captures or the grades.** The summary
  is a projection over `live:report --format=json` files named explicitly. It
  imports no capture reader, no grades parser and no key module, and it
  re-derives nothing: a Task Completion Time in the summary is the one the
  report earned.
- **It merges nothing it cannot check.** A Baseline is the Passes on one
  route under one Grading Key version and one reviewer. Inputs that differ in
  key version, key digest, routing (any role's model), the prompt version of
  any task, reviewer, study, protocol version, mode, adblock setting,
  reasoning-effort override or effort overrides are refused with the
  differing values named. A capture set named twice, or two sets with the
  same `createdAt`, is refused: one Pass counts once. Fewer than two inputs is
  refused: for one Pass, read its report. A Pass with no reviewed entry is
  refused by name — it has no reviewer to agree with the others, and reporting
  its absence as a disagreement would be false. A Pass with two rows for one
  task is refused, since every per-task figure counts against N Passes and a
  task is one Hunt's step under one relation: a corrective retry carrying its
  parent's step id is its own task, not a second row of the step it corrects.
- **Commit, dirty tree and grades revision are listed per input, never
  compared.** They are what a Pass records about itself; three Passes on
  three commits are still one Baseline when everything the protocol fixes
  agrees, and the summary says which commits they were.
- **The reviewer is a protocol fact, read from the report.** A model
  reviewer's identity (`claude-opus-5 via live:grade`) is checked like
  routing: a different reviewer means a different model graded, which is a
  different Baseline. So `reportVersion 2` carries `provenance.reviewers`
  — the distinct identities over reviewed entries — and `promptVersion` on
  every row. Neither is asserted by a flag.
- **Min, median and max only, with N in the sentence.** The output says, with
  N substituted: "Min, median and max only, over N passes. N repeats do not
  support a p95, a mean or a confidence interval, and none is offered. A
  median of an even count is the mean of its two middle values." With three
  Passes the even case arises whenever exactly two attempts qualify — the
  Eurostar follow-up's two verified times are the first instance — which is
  why the rule is stated rather than left implicit. It is a different rule
  from the per-set report's, whose distributions take the lower nearest rank
  (`src/core/report/stats.ts`): the same pair of values can print two
  medians in the two documents, and this sentence is the record of why. The
  summary's rule is #233's decision; the report's predates it and is
  unchanged.
- **Missing stays missing, and stays in the denominator.** A Pass with no
  verified attempt contributes nothing to a task's Task Completion Time and
  the row says `n=2 of 3 passes`; it is never a zero and never dropped. A
  verified attempt whose time is unavailable or invalid is a different
  absence — correctness and timing are independent — and is counted apart, as
  a qualifying attempt without an observation. An input whose set state is
  not `complete` is accepted; the warning its own report carries says so,
  with its set id, and its holes show as `not_reached` / `unaccounted` in the
  per-task rows.
- **Per-Pass rates stand beside every pooled count.** A population's verified
  over scheduled is summed across Passes and printed with each Pass's own
  ratio next to it, never as one rate alone.
- **No attribution section.** Where the time went is a within-launch question
  the per-set reports answer with their stage tables; nothing about it is
  derived across Passes, and the summary says so in one line.
- **Written once, never over; discovers nothing.** Like `live:report`.

## Considered options

- One `live:report` invocation over several capture sets. It would put the
  refusal rules and the cross-pass statistics into a command whose contract is
  one set → one report, and every reader of that report would have to ask
  which mode it was in.
- A summary that also compares routes or reviewers side by side. That is a
  different document with a different question; a Baseline is one route, and
  the command refuses a mix rather than tabulating one.
- Any statistic beyond min / median / max. Three repeats do not support one,
  and the protocol says so.

## Consequences

The three baseline JSON reports and the summary over them are committed
beside the markdown reports, so the cross-pass picture is a generated file
that can be regenerated and diffed, not prose. A later Baseline on another
route produces its own summary; putting the two in one table is a job for a
different tool, if it is ever wanted.

The report's version moved to 2. A summary given a version-1 report refuses
it and says to regenerate; nothing else reads the version. `report.test.ts`
covers the two added fields, and `corpus.test.ts` did not change: the summary
command is not on the capture path and imports no key module.

The glossary gained **Hunt**, **Pass** and **Baseline** (CONTEXT.md
§Performance Evaluation) so that "a task" in this document means one Hunt's
step and "three passes" means three retained capture sets graded as one each.
