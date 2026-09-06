# ADR 0034: An off-contract reply in a reserved round is a failed round

## Status

Accepted. Supersedes the sentence in ADR 0027 that reads a failed reserved
Answer as a thrown or tool-requesting one; that list now has a third member.

## Context

The Answer contract is JSON with `speak` and `display`. The parser tries the
raw reply, a fenced block, and a JSON slice, and when none of them is that
shape it falls back to prose: the whole text becomes the Card and its first
sentences the Spoken rendering. That fallback is right for an ordinary round —
a model that answers a simple question in prose is answering — and every
round used it, including the two reserved ones: the Run's Answer-only round
at the end of Finalization and a Browse Subagent's report round.

In those two rounds the contract was stated one message earlier, in the
finalize directive the model has just read, and the model has no tools. A
prose reply there is not an answer; it is the model narrating. The 2026-09-06
session (#198) showed the cost: after a no-progress trip the orchestrator's
reserved round returned "The candidate schema needs an evidence reference —
retrying with the observation id. 3/3 retries exhausted, continuing without
candidate records." — a note to itself, with a retry count nothing in the
runtime produced — and the pipeline displayed and spoke it as the run's
Answer, then closed the run `done`. A worker's report round has the same hole:
its prose becomes the report's text with an empty findings list, so a worker
that narrates looks to its orchestrator like a worker that found nothing.

ADR 0027 already promised that a failed or tool-requesting reserved Answer
yields a deterministic Answer from verified evidence rather than a raw limit
error. Prose was a third failure shape the promise did not name, and nothing
in the trace said it had happened.

Three responses were on the table: route prose to the deterministic fallback
at once; retry once with a stricter instruction, then fall back; keep the prose
as the Card and replace only the Spoken line.

## Decision

- **One shape, one term.** A reserved round's reply that is not an Answer or
  a Subagent Report in the contract's shape — prose, or JSON of the wrong
  shape — is an **Off-contract Reply**. The parser marks the shape; the
  boundary is exactly what the JSON branch accepts. There is no finer cut
  between "no JSON found" and "JSON of the wrong shape": both route the same
  way, and the trace keeps the raw text for anyone who wants the cut later.
- **A failed round, never rendered.** The Run's reserved round routes an
  Off-contract Reply to the deterministic fallback Answer, beside the thrown
  and tool-requesting cases, with the Finalization Cause the phase already
  holds. A Subagent's report round routes it to the bounded Subagent Report;
  the text is dropped from the report and never becomes findings.
- **No retry.** The client already retries an empty completion, the directive
  was already read, and every extra round costs ten to eighty seconds on a run
  that has just declared itself out of budget or progress. A retry buys a
  second chance at exactly the behaviour the model just showed.
- **A reserved round streams nothing.** The partial Answer streams to the
  Card as it arrives, and prose streams raw; in a reserved round that would
  flash the narration before the fallback replaced it. The Card renders only
  the final Answer or the fallback.
- **Recorded, not stored.** An Off-contract Reply is a Run Trace record on the
  reserved round — the raw text, the round's role, the cause the fallback
  used — plus a fault report. Nothing enters Recorded History: it is a
  per-model behaviour the eval reads from traces, and Recorded History's
  Finalization Cause and Run Resolution already find the affected runs
  (ADR 0030).
- **Outside a reserved round nothing changes.** A prose reply in an ordinary
  round is still an Answer.

## Consequences

- The shape marker is the parser's, so both loops read the same fact; neither
  the Run loop nor the Subagent loop judges prose itself.
- The deterministic fallback's `no_progress` wording now lists the sources the
  Run observed, which in the #198 session would have been the search pages and
  the post the orchestrator opened itself — less than a right answer, more
  than a retry note.
- A worker whose narration used to arrive as an empty-findings report now
  arrives as a bounded report with a cause, so the orchestrator can tell "found
  nothing" from "did not report".
