# ADR 0040: A vision attempt records what it observed

## Status

Accepted

## Context

The captured vision failures all read the same: a Look that failed after
about eight seconds. That sentence is every fact we have. It establishes
that no recognized generation progress reached the adapter inside the
first-token window (ADR 0016) and nothing else — not whether the provider
ever answered, not whether headers arrived and the body stayed silent, not
whether bytes flowed carrying content this adapter does not recognize. The
`vision_request` record (#186, ADR 0031) keeps the ask, a total duration and
an outcome of `ok` / `deadline` / `error`, which is enough to count spend and
not enough to tell provider queuing from network delay from an unparsed
stream.

The two Vision Deadlines are also indistinguishable in a record. A Look that
never began answering and a Look that streamed for fifteen seconds without
finishing are different failures with different fixes, and both arrive as
`outcome: 'deadline'` plus an English sentence.

Raising caps, switching models, or probing the live endpoint would all
produce evidence, and all cost money or change behaviour under a fault we
cannot yet describe. Diagnosis comes first.

## Decision

- **An attempt reports what it observed, once, at settlement.** The adapter
  collects milestones for one request — response headers and their status,
  first body byte, first recognized reasoning delta, first recognized answer
  delta, stream end, settlement — plus byte and event counts, the limits in
  force, and the model, answer cap and thinking setting the request carried.
  It reports them through an optional observer the caller supplies.
- **A milestone that did not happen is absent, never guessed.** An absent
  `responseAtMs` means no response arrived. The gaps are the diagnosis:
  headers but no first byte is queuing; bytes but no recognized delta is
  content this adapter does not parse; neither is silence.
- **Every ending is named, not inferred from a duration.** `answered`,
  `first_token_deadline`, `whole_look_deadline`, `aborted`, `http_error`,
  `empty_completion`, `stream_error`. `VisionDeadlineError` carries its phase
  as a property for the same reason, and the record keeps it beside the
  outcome.
- **Reasoning stays distinct from an answer.** Reasoning satisfies the
  first-token window exactly as it always has; the record says which kind of
  delta satisfied it and counts reasoning characters separately from content.
  Which stream events satisfy the deadline is unchanged.
- **The record rides the existing seam.** It lands on the `vision_request`
  event, so it inherits the Run Trace's opt-in, the fault route's boundary
  (ADR 0031), and its retention. No second store, no second flag.
- **The diagnostic can never fail the Look.** The observer is called inside
  a guard; an observer that throws is reported as a fault and the Look
  returns its answer. With nothing tracing, the observer discards.
- **A late arrival cannot rewrite a settled record.** The report is a
  snapshot taken when the caller's request settled. A stream that delivers
  content after its deadline already fired changes nothing about the record
  of the attempt that failed.

## Consequences

- A vision failure is diagnosable from a local trace: which deadline fired,
  how far the exchange got, under which limits, against which model.
- The fixtures that establish this are local and injected — no response,
  headers without deltas, reasoning before content, slow valid content, a
  mid-stream stall, an empty completion, SSE framing and unparseable
  payloads, an abort, a late settlement. They establish how this adapter
  parses and times a stream. They do not establish why the provider was slow
  in the captured failures, and they are not evidence that live vision has
  recovered. That remains unverified until a separately approved live probe
  provides evidence.
- The record grows the `vision_request` line. It stays free of credentials,
  prompts, images, and reasoning text — reasoning is counted, never quoted.
- Models, request caps and deadline semantics are unchanged by this
  decision. It adds observation, not policy.

## Relationships

Extends ADR 0016 (the deadlines this observes) and ADR 0031 (the opt-in
diagnostics boundary it rides). Records the diagnostic slice of the Reliable
Search Continuation design's "diagnose vision with local stream fixtures and
narrowly scoped timing first, without changing models or increasing caps".
