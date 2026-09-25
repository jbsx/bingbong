# ADR 0066: A Transport Failure is retried once at the client, and a second is a Finalization Cause

## Status

Accepted on 2026-09-25 for #271, grilled from the two live-web Runs that died
on the orchestrator's own request to z.ai rejecting at the transport
(`baseline3-2` longitude initial, round 1; `fix-265-267-5` Voyager initial,
round 3). Adds one Finalization Cause (`model_unreachable`), one client error
class (`LlmTransportError`), one `llm_round` outcome (`transport`) and field
(`failure`), and three Round Audit counters. The #219 request timeout, the
empty-completion retry, the Finalization Allowance (ADR 0038) and the
deterministic Answer (ADR 0027) are unchanged.

## Context

Both failures were a `fetch` call rejecting with no response at all:
`fetch failed` 973 ms after dispatch in one, 7 s in the other (the "88 s"
first filed was the Run's elapsed time, not the round's). Neither streamed a
token. The client rethrew the rejection unchanged, the pipeline's round catch
had no arm for it, and it reached the Run's outer catch: outcome `failed`,
no Finalization, no bookkeeping, no reserved Answer, no deterministic Answer,
"I could not finish that request." — with Observations already on the tape
that an Answer could have been built from. Each cost one of the capture's
Runs, 2 of the last 48.

The sweep also found that the trace could not tell this from a gateway's
502 — both were `failed`, and the undici cause code was dropped at every
layer — and that the Run's outer catch reported no fault, so the stack was
lost too.

## Decision

- **A Transport Failure is the fetch call's own rejection with no response
  at all**, whatever its duration, raised only when neither the client's
  timeout nor the caller's signal aborted. An HTTP error status is the
  provider answering; a stream that breaks after its first token and a body
  that fails to parse are something that went wrong after a response. All
  three are out of scope and are not retried.
- **One Transport Retry per model round, at the client.** After a fixed 1 s
  pause the identical request — the same body, byte for byte — is sent once
  more. It wraps the single request, not the empty-completion loop, so it
  never spends one of that loop's three attempts or brings its nudge
  forward, and it has its own ceiling of two. Each attempt runs under its
  own #219 request timeout; the caller's signal bounds the whole and cuts
  the pause short. The pause is an injected dependency so tests never wait.
  A Subagent constructs the same client and gets the same retry.
- **The abandoned attempt is its own `llm_round` record** with outcome
  `transport`, closed through the retry hook, which now names its reason
  (`empty` or `transport`) and hands over the rejection. Every thrown
  outcome — `transport`, `timeout`, `failed` — carries
  `failure: { message, code? }`, so a fetch that never connected and a 502
  are finally told apart on the record.
- **A second Transport Failure in an acquisition round is a Finalization
  Cause, `model_unreachable`**, entered in the pipeline's round catch beside
  the #219 timeout arm and after the Stop, deadline-abort, reserved-Answer
  and bookkeeping arms. Finalization then runs as it does for any cause: the
  Steering checkpoint, bookkeeping when there is something new, the reserved
  Answer round (itself covered by the retry), the deterministic Answer if
  that fails. No Tier Escalation is offered: a higher tier reaches the same
  unreachable model. The cause is runtime-only, so a model that proposes it
  is dropped; the model-facing reason is "The model could not be reached";
  the Stop Record's detail names the attempts and the transport code; it
  earns the failure screenshot the old `failed` path took. What the user
  hears does not change: the deterministic Answer names no cause.
- **A Subagent whose round fails twice returns its bounded report under
  `model_unreachable`** straight away — as it does when the Report Grace
  ends — rather than spending a reserved round on the model that just
  failed to answer one, and rather than being marked `failed` with a bare
  message.
- **Anything else that still escapes the Run reports a fault**
  (`pipeline.createCommandPipeline.runFailedOutsideFinalization`) with its
  stack, before the error event that carries only the message.

## Considered and rejected

- **Retrying in the pipeline instead of the client.** The pipeline sees one
  thrown error per round and would have to rebuild and resend the request
  itself, outside the attempt numbering the client already reports. The
  client owns the request and its body; the repeat is identical there by
  construction.
- **Reusing `deadline_reached`.** The #219 timeout reused it because a cut
  is a cut whichever timer fired. A request that failed in 973 ms crossed no
  deadline; naming one is the substitution ADR 0038 forbids, and the Stop
  Record would tell a later "why did you stop?" something false.
- **Keeping the Run `failed`.** That is what cost the two Runs: a failure
  outside Finalization discards every Observation an Answer could be built
  from. A cause keeps the guarantee that a Run always ends in an Answer.
- **Retrying HTTP errors and broken streams.** A 429 or 5xx is the provider
  answering, with its own retry semantics; a stream that broke after its
  first token has already been partly shown to the Feed. Neither was
  observed in the failures this answers, and both are separate decisions.
- **A backoff or more than one retry.** Both observed failures rejected
  within seconds; one retry after a short pause covers a dropped connection,
  and a second failure is better spent finalizing than waiting.
- **A fault-injected e2e.** The e2e harness runs a scripted LLM with no
  network, so it would need a fake completions server for a 2-in-48 event.
  The client's `fetchFn` is injected, so the retry is tested where it lives,
  and the pipeline and Subagent tests throw the client's own error.

## Consequences

A dropped connection costs a Run one second and a record instead of the Run.
A Run whose model stays unreachable ends in the reserved or deterministic
Answer under a truthful cause. The Round Audit counts Transport Failure
attempts, rounds a Transport Retry recovered and Runs that finalized
`model_unreachable`; a recovered round is classed by its final attempt and is
never a failed round. The live-web capture gate is conditional: over the
transport failures observed, Runs ending `failed` with no Answer on a
transport error should be 0, and a pass set that observes none says the gate
is vacuous.

## Relationships

Sits beside [ADR 0038](0038-finalization-has-one-elapsed-time-allowance.md)'s
Finalization and the #219 timeout arm, and adds a cause rather than reusing
the deadline's (see ADR 0038's note). Uses the reserved Answer round and the
deterministic Answer of [ADR 0027](0027-bounded-progressive-browsing.md).
