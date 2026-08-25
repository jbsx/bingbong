# ADR 0002: Model-invoked session reset via new_session

## Status

Superseded by ADR 0014 (explicit Session runtime and structured continuity)

## Context

ADR 0001 gave follow-up commands continuity, but there was no way out of a thread: after ten minutes of "find a pizza place" → "the second one" → …, a user who says "bing bong, forget all that — different question" still has every prior exchange riding along, so the model keeps resolving references against a topic the user abandoned.

## Decision

- **Reset is model-invoked, not phrase-routed.** No wake-word-style phrase is hard-coded in the voice session. The orchestrator itself recognizes "forget all that" intent and calls a `new_session` tool; paraphrases work because the decision is the model's.
- **Live semantics.** The pipeline already reads the session store per LLM round (ADR 0001). `clear()` empties the store — overriding the active run's frozen turns — so the reset lands on the very next round *within the same run*. No re-request machinery.
- **The clearing run leaves nothing.** `clear()` also suppresses recording for runs in flight, so the reset command and its answer never join the thread; the command after a reset starts with empty history.
- **Conditional registration.** `new_session` declares `requiresHistory`; the LLM client offers such tools only in rounds whose request carries prior turns. Fresh sessions keep the pre-reset tool catalog byte-for-byte — the provider's empty-completion bug scales with prompt size, and the tool list is the biggest lever.
- **Acknowledgment is the model's reply.** The tool result confirms the clear; no canned voice line exists anywhere.

## Consequences

- The catalog a fresh session sees is identical to pre-#24 builds; only sessions with history pay one extra tool definition.
- After a reset the tool disappears from later rounds until new history accumulates. Catalog gating is advisory to the model, not an enforcement layer: if the model still emits a `new_session` call, the pipeline executes it and `clear()` is an idempotent no-op on an empty store.
- `history.db` is unaffected: resets touch only the in-memory store, so past runs stay reviewable on the dashboard.
