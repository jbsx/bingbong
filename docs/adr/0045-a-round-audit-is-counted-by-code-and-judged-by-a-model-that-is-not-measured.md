# ADR 0045: A Round Audit is counted by code and judged by a model that is not measured

## Status

Accepted on 2026-09-13 for #234, implemented the same day (`pnpm live:audit`,
`e2e/live/audit.ts`, docs/live-web-reporting.md §The Round Audit). Adds a
reader of the Run Trace and the retained capture sets; changes nothing the
trace, the report (#226) or the summary (#233) record.

Two departures from the decision as grilled, both measured rather than
chosen. The digest was to carry a head of the measured model's reasoning
(~1,500 characters per round); Opus 5's safeguards refuse a message that
carries it in any form tried, and a head kept only in the committed file
collided with the key's wording where both restate the hunt's question, so
the digest counts the reasoning and never quotes it. And the key-text guard
over the outputs checks the key's own words — facts, constraints, pitfalls,
uncertainties — not its source statements, which quote public pages that an
attempt's own Evidence Checkpoints excerpt verbatim; the reviewer's prose is
still checked against every string.

## Context

The live-web Baseline (#223) says the assistant does not complete the
corpus's Hunts, and that the rounds are where the time goes: 0 of 12 initial
Hunts verified, 11 of 18 attempts ending at the Investigation cap of 24 Tool
Rounds, and an LLM stage an order of magnitude larger than the tool stage.
The cross-pass summary derives nothing about where the rounds went, by
design (ADR 0044). `improvements.md` (2026-09-09) ordered the performance
work with one override — if model rounds dominate, find the wasted ones
before touching the browser — and nothing in the repository can say which
rounds those are.

Three retained attempts show why a count is not enough: one spent 16 of 24
rounds navigating and recorded evidence once; one exhausted a Lookup budget
of 12 that never escalated; one spent 368 s on three rounds with no tool
call. "Ran out of rounds" is three different findings, and a fix for one is
noise for the others.

## Decision

A **Round Audit** classifies every orchestrator Tool Round of an attempt by
one of the glossary's kinds — Acquisition with Progress, Acquisition without
Progress, Collection, Bookkeeping (a rejected Evidence Checkpoint counted
apart), failed round, Finalization — and gives the attempt a verdict from a
closed set: rounds wasted, tier too small or never escalated, budget too
small for the Hunt, stopped early, failed rounds. A primary verdict, at most
one secondary, each with a stated reason.

The kinds code can check are assigned by code from the Run Trace and the
perf log, and the same trace classifies identically every time. What needs
judgement — membership of a Search Loop, an **Off-key** Acquisition, an
early stop, the verdict — goes to a model that is not the one measured and
is not in the report path: one `claude -p` call per attempt, no tools, the
same invocation shape and Grading Key bundle as `live:grade`, a per-round
digest as input rather than the trace. The reviewer may overrule a
mechanical label with a reason the report shows, and flags the calls a
careful human might make the other way; flags ship as caveats and
adjudication never gates the report. The ranking of causes across attempts
and Passes is arithmetic over the verdicts, never the reviewer's opinion,
and it is refused across sets whose shared provenance differs, as the
summary refuses it.

The audit is read against the private Grades so each attempt names the
check ids it never reached, and its outputs name check ids and pages only,
so they are committed beside the Baseline reports and diffed after each fix.
The audit fixes nothing; each fix it motivates is its own issue with its own
three-pass capture.

## Considered options

- **Classify by hand.** Rejected by the owner: eighteen attempts of up to 26
  rounds is a day of reading that has to be repeated after every fix.
- **Let the reviewer classify every round from the raw trace, with tools.**
  Rejected: traces run 25 KB to 5.8 MB, mostly whole-page tool results;
  agentic reading is neither reproducible nor costable, and a model
  assigning the mechanical kinds would make the deterministic part of the
  count drift between readings.
- **A numeric rule for "wasted".** Rejected: with eighteen attempts any
  threshold is tuned to the data it judges. The script reports the shares,
  the reviewer chooses and cites them.
- **A more capable reviewer.** Fable was considered and set aside for cost;
  Opus at high effort is the reviewer, overridable by flag and recorded in
  every output.
- **Exempt follow-ups from the no-Progress reading of pages their initial
  already checkpointed.** Rejected: that is the Session-continuity waste
  #218 was about. Such rounds are classed without Progress and tagged
  inherited, so the follow-up population reads both ways.

## Consequences

- Two glossary terms: Round Audit and Off-key. Off-key is a judgement over
  Acquisition rounds, not a seventh kind, so the kinds stay checkable.
- Subagent rounds are counted per attempt, not classified; the exhausted
  budget is the orchestrator's and the Subagent's browsing is already known
  not to be fully on the tape.
- Baseline sets only; pilots are not Baseline evidence.
- The reviewer's invocation must carry `--strict-mcp-config`, an explicit
  system prompt and `--tools ''`: a bare `claude -p` on the owner's machine
  loaded ~158k tokens of MCP definitions and cost $3.16 for four output
  tokens on 2026-09-13. Calls run one at a time, resumable per attempt,
  under the $3 per-call cap `live:grade` uses.
- "Budget too small for the Hunt" is an admissible finding. An audit that
  can only find waste is not one.
