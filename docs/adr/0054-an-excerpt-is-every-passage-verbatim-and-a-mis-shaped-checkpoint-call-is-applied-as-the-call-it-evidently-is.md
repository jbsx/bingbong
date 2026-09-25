# ADR 0054: An excerpt is every passage verbatim, and a mis-shaped checkpoint call is applied as the call it evidently is

## Status

Accepted on 2026-09-15 for #253, grilled from the Round Audit of the Run
Plan rung capture (#252, `fix-252-1..3`). Refines the excerpt clause of ADR
0028: "the supporting excerpt must be verified against" the source
observation stands, and this decision fixes what verification admits. It
touches nothing in ADR 0043: the application still mints a User Observation
only for a correction handed on from a Run that never answered.

Amended on 2026-09-15 for #257, grilled from the Round Audit of the post-#252
levers capture (`fix-253-256-1..3`): the punctuation-tolerant attempt also
strips bracketed reference markers, and the `excerpt_unsupported` refusal
names each passage that failed beside the retained text nearest to it. The
capture showed two Runs retrying one source in three consecutive rounds
each, editing the joiner and the reference markers the refusal and the page
suggested while the real defect — an interpolated phrase, a sentence deleted
without a seam — stayed untouched, and both Runs ended `budget_exhausted`.
What an excerpt is, and that a paraphrase stays refused, are unchanged.

Amended on 2026-09-25 for #272, grilled from the run-traces of the four
Browse Subagents the live-web study has spawned: a kind "subagent" citation
takes no excerpt. One offered is dropped, never checked against the page or
the report and never stored; the call is applied on the no-excerpt path, the
Subagent's freshest retention of the cited source grounds it, and the result
carries a Notice saying so. Before this the check grounded an offered excerpt
against the Subagent's own page observations while its refusal told the
orchestrator to "copy every passage verbatim from the report you are
citing": all four refused excerpts in the traces were verbatim from the
report and none was in the retained page, so the orchestrator did what it
was told and was refused again, one Tool Round each in Investigations that
ended at their own budget. Grounding against the report instead was rejected
because the report is the Subagent's words, and an excerpt stored under the
page's URL would tell a later Run the page holds words it never did. The
refusal was also the one place this ADR's "nothing new enters the Run" was
false: it quoted the Subagent's retained page text to an orchestrator that
never read it, which is why a better message alone could not repair it.
The Round Audit counts subagent citations applied with a dropped excerpt
beside its rejection counts, so the gate reads as two numbers, never as
silence.

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
attempt strips punctuation and bracketed reference markers — `[84]`, `[a]`,
`[note 3]`, `[citation needed]` — from both sides: a marker is the page's
rendering, not its words, as the Run's `|` is its own rendering of a table
row (#257). The excerpt is stored as the model gave it: every passage in it
is literally on the page, and the joins are the model's visible seams.
Grounding stays per Run and per source, and a paraphrase stays refused.

**A refusal names the passage that failed.** When an excerpt is refused as
unsupported, the refusal names each passage the retained text does not hold
and, for each, quotes the retained text nearest to it — anchored on the
longest stretch of the passage that is there, for the passage's length and
a margin either side — so the model sees its own edit against what the page
said and corrects that passage, not the joiner. The advice on how passages
may be joined lives in the tool description, not in the refusal. No source
is ever closed and no per-source count is kept: a rejected checkpoint
already counts once per Tool Round against the no-progress rail (#197), and
in both observed clusters the words were retained and a named passage would
have been accepted on the next round (#257).

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
- **Closing a source after its second unsupported excerpt** (#257).
  Rejected: it would have saved about 23 s across the two observed clusters
  and lost the evidence in both, and in one the page held every word. A
  third attempt is right once the model is told which passage failed.

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
- A refusal quotes retained text back to the model (#257). It quotes the
  page the Run already saw, behind a label, so nothing new enters the Run
  and nothing the model wrote is paraphrased. The audit counts same-source
  unsupported rounds — a round whose refused excerpt cites the source the
  previous or next round's refused excerpt cites — and #257 gates on that
  counter (5 in fix-253-256), not on the raw rejected count, which still
  holds the first refusal of every genuine paraphrase.
