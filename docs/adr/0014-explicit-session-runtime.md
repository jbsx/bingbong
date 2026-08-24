# ADR 0014: Explicit Session runtime and structured continuity

## Status

Accepted

## Context

Bing Bong currently has no identity-bearing Session. Model continuity, the live
Feed, Active Session rendering, history hydration, reset, and lapse each infer
boundaries independently from pipeline events and timestamps. The legacy
`turnId` correlates observability and events, but it is minted before admission
and also exists for busy-rejected submissions, so it cannot identify an
accepted Run.

This makes lifecycle ownership ambiguous. A rejection can look like a Run,
late work can cross a reset, Recorded History can appear live despite providing
no model continuity, and the model receives transcript replay whose size and
relevance degrade as work continues.

Browser lifetime has a separate ambiguity. Login cookies, site storage,
consent choices, and preferences should survive a Session, while visible pages,
navigation, media, and transient Subagent tabs should not.

## Decision

- **One runtime owns Session lifecycle.** A central Session runtime is the
  authority for Session identity, lifecycle phase, accepted Run membership,
  expiry state, extensions, reset generations, continuity, and Session cleanup.
  Its phases are `absent`, `active`, and `expiring`. Boot begins `absent`.
- **Identity follows admission.** Every attempted command first receives a
  distinct Submission identity. A Run identity exists only after admission is
  accepted. The first accepted Run atomically creates its Session identity;
  later accepted Runs reuse it. Busy rejection is a Submission outcome, not a
  Run, and cannot mutate Session state.
- **Admission is explicit.** Accepted admission returns the Submission, Run,
  Session, reset generation, and acceptance time together. Domain identity
  minting and time are injected so the runtime is deterministic and independent
  from performance tracing.
- **Lifecycle is explicit.** The runtime emits identity-bearing
  `session_started`, `session_expiring`, `session_extended`, and
  `session_ended` events. End reasons are `lapsed`, `reset`, `app_closed`, and
  `interrupted`. End and cleanup happen exactly once. Closing the main window
  ends the Session; hiding, minimizing, and losing focus do not. An unclosed
  historical Session is recorded as interrupted on the next boot, but it is
  never resumed.
- **Views follow lifecycle, not timestamps.** The Feed, Idle Screen, Status
  Capsule, streaming state, and live-Run projections consume explicit Session
  identity and lifecycle. They do not infer Session boundaries from event
  timestamps or hydrate a live Session from Recorded History. Events for an
  ended or foreign Session are ignored.
- **Continuity is structured and Session-owned.** Session Working Memory stores
  bounded, validated current objectives, constraints, findings, assessments,
  decisions, artifacts, and open work. The Run Journal stores concise
  chronological Run Notes. Each Run receives one immutable snapshot and keeps
  model rounds, tool observations, and Subagent Reports in private Run Working
  State. A successful Run atomically commits its validated memory patch and Run
  Note immediately before `done`; invalid continuity output degrades without
  invalidating a useful Answer. Neither structure is persisted or reconstructed
  from Recorded History.
- **Reset invalidates stale work.** Explicit reset ends the old Session,
  advances a generation, clears all Session-owned state, and restarts the
  original command as the first accepted Run of a new Session. Late model,
  tool, browser, and Subagent completions must match both Session identity and
  generation before they can mutate state.
- **Recorded History is review-only.** It durably records true Session identity,
  lifecycle, end reason, and Run membership for diagnostics and explicit
  review. It never supplies live continuity or automatically renders in the
  live Feed.
- **Browser Profile outlives Browser State.** Browser Profile data, including
  authentication, cookies, site storage, consent choices, and preferences,
  persists across Sessions. Browser State, including the visible page,
  navigation and media state, transient tabs, and Session-owned Subagent panes,
  is discarded when the Session ends. Session lifecycle owns this cleanup; no
  Browser Workspace abstraction is introduced.

This decision supersedes the architecture in ADR 0001, ADR 0002, ADR 0003, and
ADR 0005. Those records remain as implementation history until the migration is
complete.

## Migration

The replacement follows an expand-and-contract migration. Identity types, an
accepted-admission result, optional shared event ownership fields, and a
deterministic runtime shell are added first. Legacy `turnId`, transcript
continuity, `session_started` clearing, timestamp-derived Active Session views,
history hydration, busy-rejection events, and current Browser State behavior
remain unchanged during this expand phase. Producers and consumers migrate
together before the obsolete mechanisms are removed.

## Consequences

- Session and Run ownership become explicit and testable without wall-clock
  sleeps or production adapters.
- Rejected submissions can no longer be mistaken for Runs after admission is
  migrated to the new contract.
- Reset and Session end gain a uniform stale-work guard and cleanup boundary.
- Live views and model continuity will agree because both follow one lifecycle.
- In-Session model input remains bounded and task-oriented rather than growing
  through transcript replay.
- Browser logins remain convenient while visible work is isolated between
  Sessions.
- During migration, old and new contracts coexist. New identity fields must
  remain additive until every producer, projection, persistence adapter, and
  renderer consumer has migrated.
