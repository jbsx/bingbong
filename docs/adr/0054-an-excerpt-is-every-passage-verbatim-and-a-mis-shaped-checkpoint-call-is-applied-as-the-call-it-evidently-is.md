# ADR 0054: An excerpt is every passage verbatim, and a mis-shaped checkpoint call is applied as the call it evidently is

## Status

Accepted on 2026-09-15 for #253, grilled from the Round Audit of the Run
Plan rung capture (#252, `fix-252-1..3`). Refines the excerpt clause of ADR
0028: "the supporting excerpt must be verified against" the source
observation stands, and this decision fixes what verification admits. It
touches nothing in ADR 0043: the application still mints a User Observation
only for a correction handed on from a Run that never answered.

## Context

After #252 a Run's time is its round count times a provider floor of about
4 s per round. In fix-252, 15 rounds carried a rejected checkpoint and cost
362 s — about 20 s per Run, a tenth of LLM time — and nearly every rejection
cost a second round for the retry the model then made. The 18 rejected calls
were read against the raw traces and, for the web excerpts, against the live
pages.

Eight excerpts were `excerpt_unsupported`. Seven are built only from text the
Run retained: six stitch non-contiguous passages — table rows with rows
skipped, sentences with sentences skipped, a passage from each of two page
reads — and one drops a single comma. The `|` in the table excerpts is the
Run's own rendering of a table row, copied faithfully. One prepends an
invented lead-in to a verbatim tail, and that rejection was right. The
verifier admits one contiguous run of the retained text, whitespace and case
tolerant, and nothing else; the read cap explains none of the eight.

Five `record_candidate` calls mixed the two shapes. Four are unambiguous: a
decision carrying a stray `detail` or `subject`, a creation carrying a
`status`. The refusal already computes and prints the corrected call, then
spends a round asking for it.

Four kind "user" citations, all on the Pi follow-up and 52 to 113 s each,
carried the user's exact words wrapped in quotes, behind a "verbatim:"
lead-in, or duplicated into an `excerpt` field beside a paraphrase. The
words the Run heard were inside every one.

## Decision

**An excerpt is every passage verbatim.** The excerpt is split on line
breaks, `|`, `...` and `…`; every fragment of four or more normalized
characters must appear verbatim, whitespace and case tolerant, in what this
Run retained from the cited source. When the strict check fails, a second
attempt strips punctuation from both sides. The excerpt is stored as the
model gave it: every passage in it is literally on the page, and the joins
are the model's visible seams. Grounding stays per Run and per source, and a
paraphrase stays refused.

**A mis-shaped checkpoint call is applied as the call it evidently is.** A
Candidate decision carrying a stray creation field is applied as the
decision. A creation carrying a `status` is created active, and the result
says the decision was not applied and shows the call that would. A kind
"user" citation is accepted when its observation and a user utterance this
Run heard contain each other once wrapping quotes and a lead-in are
stripped; a stray `excerpt` that verifies is used as the observation; the
Observation stores the utterance itself. An unknown Candidate id stays
refused, with the Session's Candidates listed.

**Every acceptance with a correction carries a Notice** naming the canonical
shape, so the model corrects itself inside the Run, and the trace records an
accepted checkpoint, so the audit no longer counts a rejection.

## Considered options

- **Anchored spans.** The model names a start and an end and the pipeline
  copies the text between them. Rejected: a new tool contract, and the
  evidence says the existing one only needs to admit seams.
- **Pre-minting the continuation command's User Observation.** Rejected: it
  changes who may mint evidence (ADR 0043), and containment fixes all four
  observed failures without it.
- **Accepting the verbatim tail of a paraphrased excerpt.** Rejected: the
  pipeline would be rewriting the model's claim.
- **Punctuation tolerance alone.** Rejected: it admits the dropped comma and
  none of the six stitched excerpts.

## Consequences

- Session Evidence may hold an excerpt whose passages are not adjacent on
  the page. A reader of the Observation sees the seams; the Answer's
  grounding is unchanged, because each passage is still something the Run
  saw.
- The audit's `rejectedCheckpoints` falls by construction for these classes;
  the measurement (#253) gates on rejected checkpoint calls (18 in fix-252)
  at four or fewer, alongside the shared correctness and Run-median gates.
- The model is still told the canonical shape on every corrected call, so a
  Run that keeps mis-shaping its bookkeeping is still visible in the trace
  and can still exhaust an Approach through a genuinely unsupported
  excerpt (#197).
