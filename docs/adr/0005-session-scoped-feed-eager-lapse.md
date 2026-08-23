# ADR 0005: Session-scoped feed — eager lapse wipe and filtered boot hydration

## Status

Accepted — amended twice. First: the idle-screen digest consequence below no longer holds; the idle screen is now gated on the Active Session (never renders while one is active) and shows clock/weather only, with the digest removed pending a future idle-screen redesign (#70). The feed/overlay wipe behavior is unchanged. Second (#73): boot hydration is capped at the last exchange, and the eager-Lapse timer arms at boot from the hydrated last-run finish.

## Context

ADR 0001 defined the session (continuation window, last-run retention), ADR 0002 the model-invoked reset, and ADR 0003 scoped the transcript/feed to the current session with a **lazy clear**: the window lapsing alone never wiped the view — the wipe waited for the next command. Spec #49 (dashboard modernization) rejects both halves of that experience: a feed full of stale, inaccessible old-session chatter after a pause, and a restart that resurrects hours-old content. The user wants the view to always reflect the workable session: only the current session ever renders, a lapse clears the feed on its own, and a restart hydrates only a still-open session.

The 10-minute window (ADR 0001) is simultaneously widened to **30 minutes**: a comfortable pause ("watch this video") keeps both the model's continuation thread and the view alive.

## Decision

- **The clear is eager, not lazy.** `createSessionMemory` keeps deciding boundaries (window check at command start, `clear()` on reset) and now also detects lapse on a **timer**: while idle with a non-empty thread, a timer armed at `lastFinishedAt + windowMs` fires `onSessionStart` the moment the window expires. Main stamps and injects the same `session_started` event on the same pipeline channel as before; the feed projection (and the idle screen's digest, which renders from the same feed) empties on receipt — no next command needed.
- **Lapse is detected only while idle.** Any `command` event cancels the pending boundary; when the (possibly long) run finishes and the store is idle again, the timer re-arms from the newest exchange's finish. A running command's view is never wiped underneath it. One lapse announces once: a command that arrives after an eager wipe consumes the boundary silently (the lazy path still covers event-stamp clock skew). The timer also **arms at boot** (#73): main reads the recorded run spans and, while the session is still active, arms from the hydrated last-run finish — so a restart's hydrated view wipes on schedule without a live run first. The boot anchor only ever serves a thread that never started; any command or the model's `clear()` cancels it, a window close disposes it, and a live thread's own exchanges own the boundary from then on. Nothing joins the model's thread at boot.
- **The window default widens from 10 to 30 minutes** (amending ADR 0001; the continuation thread lengthens intentionally with the view). `BINGBONG_SESSION_WINDOW_MS` remains the e2e knob and now drives both the live store and the boot-hydration scope.
- **Boot hydration is filtered to the Active Session, capped at the last exchange (#73).** The `history:recentEntries` IPC returns recorded entries beside `openSessionStart`'s successor `lastExchangeStart(runs, now, window)` — a pure function over run records reusing the same activeness rule as the live store (the session is active while the newest run finished within one window of now; an unfinished run ages from its start). The renderer's feed projection applies the scope: entries stamped at/after the **newest run's start** render — at most the last exchange, mirroring the model-side retention asymmetry (ADR 0001) — so connected run chains spanning hours never re-render wholesale on any screen (dashboard, overlay, idle digest all render from the one projection), and a **lapsed session hydrates nothing** — a blank feed on restart.
- **history.db recording is unchanged.** The store still records everything exactly as before; `session_started` still projects to no entry. Only rendering and hydration scope changed. Surfacing or exporting older sessions remains out of scope.
- **Testing seams:** session-memory boundary callbacks (extended with the injected clock for lapse timing) and the pipeline-events-to-feed-projection pure function (wipe on `session_started`, hydration scope filtering), both exercised under the e2e lapse flow via the env-override knob.

## Consequences

- Supersedes ADR 0003's lazy clear (its `session_started` channel, observer ordering, and recording-unchanged guarantees carry over unchanged).
- After a lapse the view is blank but the model still retains the most recent exchange (ADR 0001's asymmetry) — "pause it" keeps resolving after a long pause.
- A restart within the window rehydrates at most the last exchange while the model's thread (in-memory, ADR 0001) starts fresh — the accepted asymmetry, now on restart too, and on both sides of it (#73: the view retains no more than the model would across a Lapse).
- The idle screen's digest, the dashboard feed, and the overlay panel all wipe together: they render from the same projection/feed — on the eager boundary and on the boot-armed one alike.
