# ADR 0027: Browser Runs are bounded by Progress, effort, and Finalization

## Status

Accepted

## Context

The orchestrator can spend dozens of model rounds on mechanically successful
browser actions that add no decision-relevant evidence. A single ceiling at 80
tool rounds both permits long flailing Runs and then prevents the model from
producing a final Answer. Prompt instructions alone also duplicate tool
mechanics and encourage redundant reads, clicks, screenshots, and vision calls.

## Decision

- Every Run begins with a model-declared Run Plan and the smallest sufficient
  Effort Tier: Direct Action, Lookup, or Investigation. Initial tool-round
  budgets are 6, 12, and 24, with active-work deadlines of 45 seconds, 2
  minutes, and 5 minutes. Evaluation may tune these defaults.
- Progress means new decision-relevant evidence or a requested state change,
  not merely a successful call. Two no-progress actions require a different
  Approach; two exhausted Approaches require an Answer or, before exhaustion,
  one high-information question.
- The runtime mechanically nudges and eventually refuses repeated actions
  against equivalent state. Changed content, scroll position, pagination, or
  media state prevents false refusal.
- Work budgets warn internally near exhaustion. Exhaustion disables browser,
  vision, media, delegation, and user-question tools. Finalization still permits
  at most one Run Plan/Run Headline and Evidence Checkpoint bookkeeping Tool
  Round before one reserved Answer-only model round. The 32-Tool-Round hard
  ceiling includes bookkeeping but not the Answer-only round; ordinary work
  stops early enough to leave bookkeeping capacity when needed. A failed or
  tool-requesting reserved Answer produces a deterministic Answer from verified
  evidence rather than a raw limit error.
- Navigation and meaningful browser actions return Action Outcomes containing
  the settled page state needed for the next decision. `read_page` remains an
  explicit inspection tool, but is not a mandatory follow-up to every action.
  The model-facing byte-count-only screenshot tool is removed; Look and visual
  grounding capture images internally.
- Mechanical tool usage belongs in tool descriptions. The shared orchestrator
  and Subagent prompt policy contains strategy, Progress and stopping rules,
  product policy, and compact answer contracts.
- Browse Subagents are reserved for genuinely parallel work, at most three at
  once, with independent 12-round budgets and the same Progress and
  Finalization discipline — a Subagent's loop runs the same bounded-effort
  module as the Run, in a Subagent configuration whose budget is that
  Subagent's own, whose deadline is the parent Run's shared active-work
  deadline taken ahead of its remaining rounds, and which carries no Effort
  Tier; its stop causes are Finalization Causes. Its Tool Round is the Run's
  too — the same executor, the same gate order — and it runs with the Run's
  rails and deadline gate: the search-loop rail, the no-progress rails, and
  the per-call deadline gate all apply to a Browse Subagent, so a worker
  that reaches the search cap is refused, a worker whose second Approach
  makes no progress finalizes for `no_progress`, and no sibling call in a
  worker's round begins after the shared deadline has passed. A worker with
  no tab of its own observes nothing, so its rails are inert. How a worker
  ended is recorded like every other mechanical counter — its Finalization
  Cause as hidden provenance on its report, and a turn-stamped diagnostic
  event for every finished worker, including one the Run's own Finalization
  cancelled before it reached a cause. Neither is model-facing text and
  neither reaches the user-facing Subagent card. The
  orchestrator has a 32-round hard ceiling; aggregate work is bounded by
  concurrency and the shared active-work deadline.
- User-dependent waits pause active-work time. Steering creates a fresh Run Plan
  and tier budget for the corrected objective while retaining telemetry and
  Session Evidence; repeated Steering remains subject to the hard ceiling.
- The active-work deadline is a cancellation boundary, not a value polled only
  between rounds (#135). Expiry aborts the in-flight acquisition model request
  through its abort signal and enters Finalization as `deadline_reached` without
  surfacing a provider, abort, or round-limit error; no acquisition action that
  has not started may begin afterwards, while an already-executing
  non-interruptible browser action settles once and is never followed by a
  sibling. An in-flight request remains active work while it is live: a Pause
  that lands mid-round suspends deadline consumption only from the next parked
  checkpoint, so the deadline may abort the round during the pause. A tier
  escalation or Steering replan cancels the old deadline and arms the complete
  fresh epoch deadline; Finalization's own rounds — bookkeeping and the reserved
  Answer — are never deadline-aborted.
- Completion standards depend on the tier: Direct Actions require the returned
  state to confirm the requested change; Lookups require an authoritative page
  or a supported best Candidate; Investigations require multiple independent
  relevant sources and disclose disagreement; identification tasks return an
  exact match when possible or an explicitly labeled Candidate or shortlist.
- Run Resolution records what the user received separately from the pipeline's
  mechanical outcome and the Finalization Cause.
- Any valid model Answer, including `partial`, `blocked`, `needs_user`, and
  unsuccessful Resolutions, completes mechanically as `done` and receives the
  normal terminal Memory Commit. A deterministic hard-limit Answer completes
  mechanically as `failed`, adds no model Assessment or memory patch, and keeps
  only already accepted Evidence Checkpoints plus a deterministic Run Note.

## Consequences

- Simple commands use fewer model round trips, while difficult work degrades to
  an honest grounded Answer instead of failing at an arbitrary ceiling.
- The user-facing maximum-round setting is removed; product defaults are tuned
  through evaluation rather than allowing configurations that re-enable
  unbounded Runs.
- After release acceptance (#128), the legacy surfaces — the `report_headline`
  tool's remaining compatibility path and the maximum-round setting with its
  dynamic limit wiring — were removed outright (#129). There is no feature
  flag and no old/new behavior branch: production runs exactly one browsing
  behavior, and rollback is reverting the release commit in version control,
  never a runtime switch.
- Independent calls may share one model round, but browser actions that depend
  on resulting refs or state remain sequential. Run Headline updates ride
  useful work and never consume a standalone round.
- The strongest supporting source or the completed action's resulting page
  remains visible when the Run ends; cleanup navigation is not extra work unless
  requested.
- Budget warnings remain internal. Finalization may update the Run Headline but
  does not expose counters outside diagnostics.
