# ADR 0051: A Held Page still loads, and its Action Outcome names what the Session holds from it

## Status

Accepted on 2026-09-14 for #240, grilled from the Round Audit (#234, ADR
0045). Rejects the change the issue proposed — answering a navigate to an
already-checkpointed page from Session Evidence instead of loading it — and
records why. Adds one Notice kind, one Run Trace field, two audit counts, one
sentence to the shared browsing policy and one line to the Session Evidence
block. The audit's `inherited` predicate, the Evidence Checkpoint's grounding
rule (ADR 0028) and the store's canonical URL are unchanged.

## Context

Of the Baseline's 117 budgeted follow-up rounds, nine were navigates that
landed on a page the initial attempt had already checkpointed into Session
Evidence: three in the pi-camera baseline-1 follow-up, one or two in every
other follow-up, in round 1 of all three Eurostar follow-ups. The issue read
this as the follow-up "fetching what the Session already holds" and proposed
that such a navigate be answered with the held Evidence and a Notice, without
loading the page.

Read from the code and the captures, that is not what was lost:

- The follow-up already sees the Evidence. Every request of every Run carries
  the Session Evidence snapshot as a system message — each Observation's text
  and canonical source URL — before the model calls anything. The model
  re-navigated with the Evidence in front of it.
- A checkpoint grounds in the Run's own ledger, not the Session's.
  `record_evidence` refuses `unknown_source` unless this Run observed the
  cited URL, and an excerpt must appear in what this Run retained. A navigate
  answered from Evidence leaves the ledger empty for that page: the follow-up
  could not checkpoint anything new from it, could not scroll, read or Look at
  it, and could not revalidate a volatile Observation, which a completed
  Resolution needs. The reviewer flagged exactly this on baseline-1 round 17,
  the navigate that let round 18's checkpoint be accepted, and on baseline-3
  Eurostar round 1: "this Run had not yet observed the page, and it could not
  read the page without loading it".
- The nine re-acquisitions were after material the Evidence did not hold.
  Both Hunts with a follow-up revise the objective. Eurostar changes the fare
  class, and every pass re-opened the luggage page and then clicked and
  scrolled to Premier material the initial's Standard-fare Observations never
  stated. Pi-camera's returns to the camera documentation were followed by
  Looks and scrolls hunting the mechanical section the initial never
  extracted either. Serving the held Observations instead of the page would
  have served the wrong material and cost a round to bounce.
- What the follow-ups did waste on those pages came after the navigate:
  re-scrolling what was held, re-recording facts the Session already had, and
  the rejected checkpoints that followed.
- The store keeps no excerpt. An accepted Observation carries its text, its
  canonical reference URLs, provenance and volatility; the excerpt is
  validated and written to the Run Trace only (ADR 0030).
- URL identity exists four times: the store's `canonicalizeMemoryUrl`
  (fragment dropped, host lowercased, default port and trailing slash
  dropped, query sorted; no www, scheme or tracker folding), a progress
  fingerprint and an audit copy that additionally strip tracker parameters,
  and the input coercion for typed addresses. Of the nine rounds, eight are
  exact string matches and one differs by a `#fragment`.

## Decision

- **A Held Page still loads.** A page the Session holds at least one
  accepted web Observation from is a Held Page, by canonical URL, whichever
  Run or Subagent recorded it and however many rounds ago. A navigate, click,
  back or forward that lands on one executes exactly as today: the browser is
  on the page, the Run's ledger holds it, and every later checkpoint, read,
  Look and revalidation works.
- **The landing's Action Outcome carries a Held Page Notice.** A new Notice
  kind rides the successful outcome of the action whose settled page state
  moved onto a Held Page — once per landing, never on the scrolls and reads
  that follow. It is immediate (rides that result or is dropped), rides
  `success`, and sits in the precedence right after `no_progress`, with the
  rail verdicts: it is about what this call did, not what the Run owes. Its
  text lists every held Observation for that page as `id: text`, full text,
  `volatile` marked, capped at eight with a count of the rest, then one fixed
  sentence: cite these rather than re-recording them, and read this page only
  for what they do not state. The full text repeats the system block on
  purpose: the block is where the model looked and did not see.
- **Held is a Session property.** Observations count whoever recorded them:
  the initial Run, a Browse Subagent (provenance subagent), or this Run a few
  rounds ago, so a within-Run return also carries the Notice. Volatile
  Observations count and are marked, since the page being open is exactly
  what makes them citable as revalidated. Contradicted pairs are both listed,
  as the store retains both. User Observations name no page and never qualify.
- **Both loops.** The Run loop and the Browse Subagent loop share the Tool
  Round implementation and feed one Session Evidence store; both attach the
  Notice from that store.
- **Identity is the store's rule, on the landed URL.** The landed URL of the
  outcome is canonicalised by `canonicalizeMemoryUrl` and matched against the
  Observations' reference URLs, which were written under the same rule, so a
  match is exact by construction and a redirect onto a Held Page is caught.
  The requested URL is not checked: the page loads regardless, so a
  pre-load check buys nothing. No new URL rule is introduced. The audit's
  copy strips tracker parameters the store does not; that drift is recorded
  here and left.
- **The Observation text is what is served, not the excerpt.** The
  Observation is what the model wrote as the fact and what it cites; the
  excerpt was the proof at checkpoint time and ADR 0030 keeps it out of
  recorded history. The page is loaded anyway, so the verbatim text is on the
  result.
- **The prompt says it once.** The shared browsing policy gains one sentence:
  a page Session Evidence holds Observations from is opened for what they do
  not state, never to re-record what they do. The Session Evidence system
  block gains a preface line before its JSON, `held pages:` with each source
  URL and the ids it holds, so pages already read are one glance; the JSON
  the model cites ids from is unchanged.
- **The Run Trace records a merge, and the audit counts two things.** An
  accepted `evidence_checkpoint` trace record gains `merged`, the store's own
  verdict that the checkpoint was an exact duplicate of an Observation the
  Session already held (the model-facing result already says "Session
  Evidence already held this Observation"). The Round Audit gains, per
  attempt and per population, code-counted from the Run Trace and outside the
  reviewer's digest: merged checkpoints, stated as a floor since the merge is
  exact-text; and Held Page rounds without Progress, the navigate excluded,
  where the held set at each round is the initial's accepted checkpoint URLs
  plus this attempt's own accepted checkpoints before that round, under the
  audit's canonical rule. The `inherited` predicate — initial-only, forcing
  Acquisition without Progress on the navigate — is left exactly as it is so
  the Baseline rows and the cached judgements stand; the two counts differ
  from it on purpose. Its reading of the navigate is wrong, as the reviewer
  said twice, and changing it is its own small issue after the fix capture.

## Considered options

- **Answer the navigate from Evidence, as the issue proposed.** Needs an
  escape for the case the corpus shows, a revised objective wanting what the
  Observations do not state: a second navigate to the same URL loads it, or
  an argument asks for a fresh load. The second-call escape costs one bounce
  round in every Eurostar follow-up and every pi-camera hunt for the
  mechanical section — all nine rounds — and the argument escape trains the
  model to always pass it. Either way the Run cannot checkpoint, read or Look
  at the page until it really loads. Rejected.
- **Prompt only.** No runtime change; the policy sentence and the grouped
  rendering. Kept as part of the decision, not the whole of it: the Baseline
  shows the model had the Evidence in front of it and re-navigated.
- **Widen the store's merge** to normalised text or same-source overlap, so
  paraphrased re-recordings count as merged. A store decision this issue has
  no evidence for; the count is stated as a floor instead and the reviewer's
  flags catch paraphrases as today.
- **A reviewer judgement "re-recorded"** laid over Bookkeeping rounds.
  Changes the reviewer prompt and re-keys every cached judgement for a
  number the Notice's effect shows up in anyway. Not added.
- **Let the normal Progress rule decide the inherited navigate** and keep
  `inherited` as a tag. Changes the Baseline's mechanical rows and the
  reviewer digest, so all three sets would be re-judged. Deferred.
- **Add the excerpt to the Session Observation** so it could be served.
  Widens the store envelope and the compaction budget for every Observation,
  against ADR 0030. Not done.

## Consequences

- The `inherited` navigate count will not move with this change and is not
  the number the capture is judged on. The numbers that have to move are
  merged checkpoints in follow-ups and Held Page rounds without Progress in
  follow-ups, with checks reached no worse; the Baseline values are counted
  when the trace field and audit counts exist.
- A Held Page landing costs its round as before. What the decision buys is
  the rounds after it: the model is told, on the page, what it already holds
  and what it is there for.
- The Notice repeats Observation text the system block already carries: up
  to eight Observations per landing, on pages the Session has been to. That
  is a deliberate token cost on the rounds that were being wasted.
- Old Run Traces have no `merged` field; the audit reads its absence as
  false, so the Baseline's merged count is what its checkpoints actually
  were, not zero by omission.
- The four URL rules stay four. This ADR names the drift between the store
  and the audit on tracker parameters; no rule is unified here.

## Implementation notes

Implemented 2026-09-14.

- **What a landing is.** The carrier is a successful page-facing call —
  navigate, click, back, go_forward, and any other page-facing tool that moves
  the tab, a submitted `type` included — whose landed URL, canonicalised by
  `canonicalizeMemoryUrl`, differs from the page the executor's last
  successful page-facing call settled on. That is the store's rule and no
  other; a first draft compared the progress fingerprint's source identity,
  which the review caught as a second URL rule. The URL is read from the
  visible tab, not the settled page state, which would collect a second
  snapshot per call. A Tool Round executor starts having settled nowhere, so a
  follow-up whose tab still sits on the initial's page is told on its first
  result there (the Baseline's round-1 Eurostar navigates), and a later reload
  of the same page is not. A failed call is no landing, so the Notice rides the
  next success on the page instead.
- **Only web Observations hold a page.** Vision Observations are excluded
  along with User Observations.
- **The seam.** `SessionEvidenceStore.heldObservations(url)` scans the store's
  own Observations, whose references are stored canonical. The Tool Round
  executor takes it as a `HeldObservationsLookup`: the Run pipeline passes its
  live evidence Session, and a browsing Subagent gets the same live store
  through the Subagent runtime. With no Session, nothing attaches.
- **The preface** is one line inside `<session_evidence>`, before the JSON:
  `held pages: <url> (id, id); <url> (id)`.
- **`merged` absent reads false, and the Baseline's 0 is real.** The Baseline
  Run Traces hold 46 accepted checkpoints and no result carrying "Session
  Evidence already held this", so no Baseline checkpoint merged.
- **Baseline values.** Replaying `audit-baseline-{1,2,3}` kept all 18 digest
  hashes, every cached judgement and every `inherited` row:

  | population | budgeted rounds | merged checkpoints | Held Page rounds without Progress | inherited rounds |
  | --- | --- | --- | --- | --- |
  | initial | 225 | 0 | 0 | 0 |
  | follow-up | 117 | 0 | 6 (baseline-1 4, baseline-2 1, baseline-3 1) | 9 |

- **What the capture can show.** Merged checkpoints in follow-ups start at 0
  and cannot fall; the capture is read on Held Page rounds without Progress
  (6 of 117 follow-up rounds) with checks reached no worse, and merged
  checkpoints are watched for rising.

## Relationships

Motivated by [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md)'s
Baseline audit. Keeps [ADR 0028](0028-checkpointed-session-evidence.md)'s
grounding rule and [ADR 0030](0030-run-trace-stays-out-of-recorded-history.md)'s
placement of the excerpt. Rides the Action Outcome
[ADR 0047](0047-a-page-is-read-in-one-round-and-an-action-outcome-carries-a-preview.md)
shaped, through the Notice precedence the glossary's Notice entry describes.
The Run Context Compaction reference of ADR 0028 ("cite the Observation
instead of re-reading") is the same instruction, delivered here at landing
time instead of at compaction time.
