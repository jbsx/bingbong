# ADR 0001: Session continuity for follow-up commands

## Status

Accepted

## Context

Every utterance starts a brand-new orchestrator conversation. Saying "bing bong, find a pizza place" and then "bing bong, what about the second one?" makes the model re-ask or guess, because the second request has no idea the first exchange happened. Back-to-back commands should feel like one seamless conversation.

## Decision

- **Continuation policy.** A new command continues the session if the last run finished less than **10 minutes** ago, evaluated at command start (from the pipeline event timestamps — no timers). When the window lapses, the thread restarts but the **most recent exchange is always retained**, so a long pause (watching a video) followed by "pause it" still resolves.
- **Session state.** An in-memory store per window in the main process (`src/core/session/sessionMemory.ts`), fed from the same pipeline run-observer seam as the history recorder. It dies on app quit. `history.db` stays **review-only** — nothing is written to it for memory purposes.
- **What rides along.** Distilled turns only: user command + assistant answer (`display` text with `speak` as fallback), oldest first, **≤ 8 exchanges / ~3k estimated tokens** (oldest dropped first), each turn truncated to ~1,000 characters. Cancelled/failed runs join the thread as the user command plus a brief "(run was cancelled)" / "(run failed)" note.
- **Wire shape.** The LLM port's request gains an optional `history` field; the pipeline reads the store live on every LLM round. Message order: system prompt → continuation system line (only when history is non-empty) → prior turns oldest-first → current command → current run's tool results. Requests with no history are byte-identical to pre-session requests.

## Consequences

- References like "the second one" or "pause it" resolve against the thread without the model re-asking.
- Restarting the app forgets the thread — acceptable for a voice assistant; persistence stays out of scope.
- Explicitly excluded from session history: subagent context, steering text, heard-but-not-command voice entries, and ask_user answers (they remain tool results inside their run).
