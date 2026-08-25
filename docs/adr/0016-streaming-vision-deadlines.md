# ADR 0016: Streaming vision deadlines

## Status

Accepted

## Context

Vision runs GLM-4.6V on the shared coding endpoint (ADR 0008), whose measured
latency on identical requests swings from 9.8 s to 24.8 s. The adapter sends
`stream: false`, so the deadline racing the exchange cannot distinguish a hung
request from one that is slowly generating — the full completion must land
before any byte is visible. The 15 s describe deadline therefore kills healthy
calls, "Auto-vision failed … timed out" pollutes click and read results, and
the orchestrator's `look` fails with "Vision is unavailable right now" — the
same failure mode that motivated abandoning the original 30 s MCP deadline.
Bing Bong is heavily reliant on vision and cannot afford long wall-clock per
Look, so raising caps alone is not an acceptable fix.

## Decision

- **The deadline waits for the start of an answer, not its completion.** The
  vision adapter streams (`stream: true`); the deadline is enforced as
  time-to-first-token — a request that has not begun answering within it is
  hung and fails immediately. Once tokens flow, a separate cap bounds the
  whole Look.
- **Total wall-clock never exceeds the prior caps**: 15 s describe, 60 s
  locate (still scalable via `BINGBONG_VISION_TIMEOUT_MS`, seconds).
- **Auto-vision gets a smaller budget plus a per-run cooldown** — it is
  advisory, so one slow patch must not tax every subsequent click and read.
  Its failure remains a one-line note in the tool result, never a nudge.
- **Subagent Looks get the same deadline nudge as the orchestrator's**: on
  breach, "use read_page or ask_user, do not keep retrying look".

## Consequences

- Hung or queued requests die at time-to-first-token instead of burning the
  full cap; healthy-but-slow requests stream to completion within it. Slow
  and hung are no longer conflated.
- Partially supersedes ADR 0008: its fast/precise capability split, DOM-first
  Locate, and screenshot quality choices stand; only its deadline mechanics
  (whole-exchange abort on a non-streaming request) are replaced.
- A future reader of the adapter will see streaming used solely to make
  progress observable; that is why this record exists.
