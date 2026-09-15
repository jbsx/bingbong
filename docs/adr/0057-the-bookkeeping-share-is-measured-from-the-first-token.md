# ADR 0057: The bookkeeping share is measured from the round's first token

## Status

Accepted on 2026-09-15 for the rework of #256, from the Round Audit of the
post-#252 levers capture (`fix-253-256-1..3`). Amends ADR 0038's bookkeeping
share — ten seconds of silence, then ten more from the first token, never
past the reserved Answer's protected floor — and ADR 0056's kept round, whose
share this is. ADR 0056's skip stands unchanged.

## Context

ADR 0056 skipped the Finalization bookkeeping round when nothing new had been
acquired since the last accepted Evidence Checkpoint, on the premise that most
stopped Runs had already checkpointed everything. The capture did not bear
that out. Of 11 Finalization entries that reached the decision, 3 skipped and
8 kept the round because the rail had seen Progress after the last checkpoint:
a Run its budget or deadline stops is usually mid-acquisition.

The 8 kept rounds split evenly. Four completed, in 5 to 8 seconds, with one or
two checkpoints each — at rounds 25 and 32, on prompts of 20k to 42k tokens,
so neither lateness nor prompt size predicts the cut. Four were cut at the
10-second share having returned nothing: two had streamed nothing at all, and
two had streamed 291 and 1,621 characters of reasoning and were mid-thought
when the share ran out. Every cut round was followed by a reserved Answer of
20 to 31 seconds, and no Run fell back to the deterministic Answer.
Finalization seconds per Run went from 27.6 to 29.1; `allowance` rounds from 8
to 4 against a gate of 0.

Across the capture, completed rounds under 300 output tokens took 4.8 s at
the median, 7.8 s at the ninetieth percentile and 9.3 s at the ninety-fifth,
output included. A request silent for ten seconds is in the provider's tail;
no shorter silence bound follows from those numbers, and no trace so far says
when a round's first fragment arrived.

## Decision

- **The bookkeeping share bounds silence and streaming separately.** A kept
  bookkeeping round that has streamed nothing by the end of its share is cut,
  as before. At the round's first streamed fragment — reasoning, content or a
  tool intent — the share starts again from that moment, clamped as every
  share is to what remains before the reserved Answer's protected floor. A
  checkpoint the provider is already writing is worth the seconds it has
  left; a silent request is not. A round that does not stream keeps the
  single bound.
- **The reserved Answer round's share does not restart.** It is everything
  left, and a restart would be a second cut on the same clock.
- **Every `llm_round` record says when its first fragment arrived**
  (`firstTokenMs`, from the client's reported dispatch; absent when nothing
  streamed). The Run Trace is version 4. The Round Audit splits the rounds
  the Allowance cut into cut after a first token, cut silent, and not
  recorded — a trace below version 4 — and reports first-token latency at
  the median and ninetieth percentile over each population's rounds, beside
  the rounds so no cached judgement re-keys. The Fix Ledger reads them.

## Considered options

- **Skip every kept round late in a Run.** Rejected: four of the eight kept
  rounds completed at rounds 25 and 32 with six checkpoints between them,
  and the cuts fell on the same rounds. Lateness is not the discriminator.
- **A shorter silence bound.** Rejected for now: the ninety-fifth percentile
  of a completed small round is 9.3 s including its output, and there is no
  first-token data to set a bound from. This decision produces that data.
- **Raise the share flat.** Rejected, as in ADR 0056: it pays for silence as
  much as for writing, and the two silent cuts would have cost more.

## Consequences

- A kept bookkeeping round may take up to twenty seconds instead of ten, and
  only while the provider is answering; a silent round costs what it did.
  The Answer's protected floor is untouched in every case.
- The measurement for the rework gates on Finalization rounds cut after a
  first token at zero. Silent cuts, Finalization seconds per Run,
  deterministic Answers and the first-token distribution are reported; the
  distribution is the number the next Finalization lever is set from.
- The streaming-or-silent split of a cut round is null on every capture
  before this one; the ledger reads it as nothing, not as zero.
