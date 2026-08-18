# ADR 0003: Session-scoped transcript via session_started

## Status

Accepted

## Context

ADR 0001 defined what a session is (10-minute continuation window, last-run retention) and ADR 0002 gave the model a way out of a thread (`new_session`). The dashboard transcript, however, accumulated forever: every command, tool line, and answer since the window opened stayed on screen. Spec #25 asks that the transcript show only the current session — with a **lazy clear**: the window lapsing alone never wipes the view, and there are no session dividers; older sessions are simply never rendered.

## Decision

- **The session store announces the boundary.** `createSessionMemory` already decides when a new session begins (window check at command start) and when it is reset (`clear()`). It gains an `onSessionStart` callback fired at exactly those two moments — and never for the first-ever command, a no-op `clear()` on an empty store, a busy-rejected overlapping command, or the command following a reset (that command continues the fresh session; the reset run's answer stays visible).
- **A `session_started` event rides the existing pipeline channel.** Main stamps it (`systemClock` — the store itself has no clock) and injects it into the dashboard stream; the renderer clears its transcript entries on receipt. It is not emitted by the pipeline generator. It does reach the recorder seam (`emitPipelineEvent` feeds every consumer), but the shared projection maps it to no transcript entry, so nothing is ever written to `history.db` — recording is byte-for-byte unchanged.
- **Observers run before the dashboard send.** The run-observer seam (`deliver` in attachAssistant) now feeds observers ahead of the renderer send, because the session store makes its boundary decision on the `command` event itself — the `session_started` it triggers must arrive before the command echo it clears. Ordering within the single IPC channel is FIFO, so the swap is sufficient and behavior-neutral for every other observer.
- **The asymmetry is accepted.** After the window lapses, the model quietly retains the most recent exchange (ADR 0001) while the dashboard shows a fresh transcript. The two views of "session" diverge on purpose.
- **The window is env-overridable** (`BINGBONG_SESSION_WINDOW_MS`, mirroring `BINGBONG_ASK_TIMEOUT_MS`) so e2e can lapse the window in milliseconds instead of waiting out real minutes.

## Consequences

- The transcript's lifetime is exactly the session's: continuation accumulates, boundary clears, nothing older is ever re-rendered.
- A mid-run reset clears the view immediately; the reset run's own acknowledgment is the first content of the new view.
- Subagent cards, pending confirmations, and ask cards are not transcript entries and are unaffected.
