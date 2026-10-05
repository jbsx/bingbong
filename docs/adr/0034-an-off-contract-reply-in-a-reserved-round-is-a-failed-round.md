# ADR 0034: An off-contract reply in a reserved round is a failed round

## Status

Accepted. Supersedes the sentence in ADR 0027 that reads a failed reserved
Answer as a thrown or tool-requesting one; that list now has a third member.

Note of 2026-09-14 (#245): the no-retry stance is the reserved round's,
because it has no round to spend; outside one there is. Baseline-1's Eurostar
initial replied in an ordinary round with prose followed by an Answer whose
"display" was over-escaped. The parser fell back to prose, the whole text was
displayed and spoken with the JSON inside it, and the reply's `objective_met`
claim, its resolution and its run note were lost with the parse; the journal
recorded `model_answered` and the audit and grade read the raw text. A reply
outside a reserved round that carries the contract's keys but not its shape is
a Malformed Answer, a third shape the parser marks and a reserved round still
treats as off-contract. The next request, whichever round the loop makes it,
carries what could not be read and asks for the Answer alone, once per Run or
Subagent, and that round's own rule judges the reply. Nothing is repaired: a
guessed repair changes what the user is told, and this reply also carried
`\\n` throughout its "display", legal JSON that a repair of the quotes would
have rendered as literal text. The retry is not a Tool Round and spends none
of that budget.

Note of 2026-09-28 (#286): a reply can be in the contract's shape and still
be unusable. In fix-283-3 the Voyager initial reached `budget_exhausted` and
its reserved round answered an English command in Chinese: the Card (725 Han
characters, 64% of its letters) and the Spoken Rendering (100), with the
Asked Items, the source titles and the round's own reasoning in English, and
no Chinese in anything the Run had read. It is 1 of 362 final Answers on
disk, 1 of 132 written by the model in a Finalization round against 0 of 217
in an ordinary one, which one event cannot tell apart from chance. No prompt
named a language. Decided:

- **An Answer is written in English**, the product's one language, not the
  command's: a typed command has no language the speech recogniser heard,
  every product-owned sentence is English and so is the voice.
- **An Off-language Answer** is one whose Card or Spoken Rendering has more
  than half of its letters outside Latin script, each judged alone. Script,
  not language detection: over 727 renderings the one bad Card reads 64% and
  every other 0%, none is non-English in Latin script, and a detector is
  least reliable on a two-sentence Spoken Rendering. Asked Items and Subagent
  Reports are not judged.
- **In a reserved round it is a failed round**, as an Off-contract Reply is:
  never rendered, the deterministic Answer under the cause the phase holds.
  That throws away an Answer the reviewer found right on 14 of 15 checks. A
  second reserved request in English was the alternative, and was declined
  as a permanent allowance bought for one Answer in 132.
- **In an ordinary round it spends the one Answer Retry**, shared with the
  Malformed Answer and the Asked Items check. With the retry spent, or its
  reply off-language too, the deterministic Answer stands in, where a
  Malformed Answer would stand as written: that one is still prose the user
  can read. The Run then completes `failed` with no Finalization Cause, since
  it entered no Finalization, and the Stop Record's failure says why; no
  cause is added to the set, and the record never says `hard_limit`.
- **The prompt says it once**, in the Answer contract. It is prevention and
  is never gated.
- **Reported, never gated, and closed on tests.** Zero events in an 18-Run
  capture bound the rate below about 1 in 6, which says nothing about 1 in
  362, so no capture can show the rule working; the fix-283-3 Answer as a
  fixture can.
- **Text streamed in an ordinary round may show before it is replaced.** A
  reserved round streams nothing, so #286's own case would have shown none.

Note of 2026-09-28 (#286, built): what building it settled.

- **A round that is not reserved can still be inside Finalization**: the
  bookkeeping round, when the model answers in it. An Off-language Answer
  there spends the retry like any ordinary round, and a deterministic Answer
  that follows uses the cause the phase holds. Only a Run whose phase is
  still working ends with no Finalization Cause.
- **An Off-language Answer is judged before the Asked Items.** An Answer
  failing both is asked for English, and its list settles on the reply.
- **A reply the runtime could not take is left to its own rule.** An
  Off-contract Reply, and a Malformed Answer with the retry unspent, are
  handled as before whatever script they are in, and leave no
  `off_language_answer` record: there is no Card to judge. Neither is
  rendered. A Malformed Answer that would stand as prose, the retry spent,
  is judged, and if that prose is off-language the deterministic Answer
  stands in.
- **A population holding audits from before the counter and after it** adds
  the listed Answers for the attempts that carry no count, so neither kind
  is lost.
- **The fault names round 0 when nothing is tracing**, since the loop
  numbers its rounds only for the trace. The record is always numbered.
- **The `answer_retry` record gained the outcome `off_language`**, in the
  orchestrator loop only, and the Run Trace is version 7.
- **The Fix Ledger cannot recount from text.** A committed Round Audit keeps
  an Answer round's lengths and none of its words, and the ledger reads
  audits alone. An audit written before the counter is recounted from a list
  of the Answers known to have been rendered off-language
  (`PRE_RULE_OFF_LANGUAGE_ANSWERS`). A Malformed Answer before its record is
  named in a list too, but only as a caveat, its count left at zero (ADR
  0049); this one is counted, because the rule is a function of the
  rendering alone and judging old text replays nothing the Run decided. The
  list was checked against the captures with the audit's own function: one
  in 371 attempts on disk.
- **The record keeps the Answer's text**, cut as an Off-contract Reply's is,
  since nothing else does.

Note of 2026-09-28 (#302): the fault names the real round. The note above
says it names round 0 when nothing is tracing; that was a defect, not a
decision. The loop now counts its own LLM rounds, whether or not a Run Trace
is written, and the count is the one the `llm_round` record carries. The
fault and the record name the same round, and neither says 0.

Note of 2026-10-01 (#312): the Answer's sentence is spoken when it closes in
the stream, before its round ends, so the Answer Retry can now meet an Answer
whose sentence the user has already heard. In `main-4dc72e9` the sentence
closed 8.4 to 36.9 s before it was spoken, median 16.7 s, because `speak` was
published only when the whole round ended. Decided:

- **What the user heard is the Answer's sentence.** A round that spoke its
  sentence early and then ended with an Answer, whatever its shape, holds that
  sentence for the Run. A Malformed Answer, an Off-language Answer whose
  sentence passed and an Asked Items list that falls short each still spend
  the one Answer Retry, but the retried Answer's own `speak` is not spoken:
  the held sentence is the one the Answer records, the one the Identity Slip
  repair reads and the one the Off-language check judges. A Steering replan
  lets the sentence go, because the corrected objective's Answer is a new one.
- **A round that called tools after closing a sentence spoke for none.** The
  Run worked on, and the Answer that finally lands, the deterministic one
  included, is spoken as before: the user hears it as a second utterance.
  This is counted (`second_utterance`, and in the Round Audit), not guarded
  against. The Answer waits out the playback of every sentence spoken early,
  as it waits out a spoken line, so a failed one is reported and the Run is
  not done while one is still queued. The `speaking` status is still set
  when the Answer lands, not when a sentence is published mid-round.
- **A sentence whose reply never landed stands** (the owner's ruling of
  2026-10-05, which replaces the first reading of this note: a second
  utterance there told the user that a limit had been reached, and the user
  is not to hear about the application's limits). That covers a round cut
  after it spoke — a deadline, a client timeout, a transport failure — and a
  sentence closed by an attempt the client then retried (#271). The Run
  holds the sentence, and the Answer it ends on is not spoken after it: the
  reserved Answer when that lands, the deterministic Answer when it does
  not. The Card is that Answer's, with one exception: when no model round
  writes another and the cut round had closed its `display` in the stream,
  that text is the Card, after the Off-language check and the Identity Slip
  repair, and it is not marked `deterministicAnswer`. A Card that differs
  from the sentence heard is accepted. The Asked Items of an Answer cut
  before its list show `unverified`, which says how sure the Answer is and
  is no report of a limit. A sentence from an attempt the client retried
  never takes the retry's text as its Card. The same holds, by the same
  rule and beyond the cases the ruling named, for a sentence whose Answer
  landed and could not be taken — a Malformed or an Off-language one, the
  retry spent: the deterministic Answer that stands in gives the Card and
  is not spoken. Recorded as `stood_sentence` with where the Card came
  from, and counted in the Round Audit. A hard failure of a working round
  after a sentence still speaks its one line; what an error may say is
  #315's.
- **A cut round is never followed by a Tier Escalation.** At its deadline a
  Run still making Progress rises a tier and the round in flight goes on; a
  round that is cut has entered Finalization. So a sentence is never left
  standing over work that browses on.
- **No sentence is spoken early in a list-only retry round** (#311). The
  reply is read for its list alone, and a whole Answer written there would
  otherwise speak a sentence beside the held Answer's own.
- **Only the checks the sentence can meet alone run before it is spoken**:
  the two-sentence cap, the Identity Slip repair (deletion, as for any
  Spoken Rendering) and the Off-language check. A sentence that fails one is
  not spoken early, and its round is handled as before.
- **The sentence is spoken once `speak` has closed and the object's
  `"display"` key has opened**, the key that marks the object as the Answer.
  The reserved rounds still stream nothing, so they speak at their end. A
  Subagent's reply is never spoken.
- **The stream reader finds the object behind a preamble.** Eight of that
  capture's eighteen final Answers wrote a sentence of prose before the
  object, and the whole envelope then streamed as text. Prose cannot be held
  back, because 61 of its 216 tool rounds streamed narration that reads
  exactly like a preamble. So prose streams as before, a brace at the tail
  that may yet open an object is held back, and once an object opens the
  stream restarts at its value. The feed drops what streamed before, so the
  preamble does not stay on screen and the envelope never shows.
- **No new ADR, and no Run Trace version.** `early_sentence`,
  `second_utterance` and `stood_sentence` are new records whose absence in
  an older trace means what it means now: no sentence was spoken early.

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
