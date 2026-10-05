# ADR 0027: Browser Runs are bounded by Progress, effort, and Finalization

## Status

Accepted. ADR 0038 adds a separate Finalization Allowance and extends fallback
protection to bookkeeping failure; the active-work deadline and its exemption
for Finalization remain distinct from that new bound. ADR 0038 also records
outcome-first user-facing stopping, without changing diagnostic stop causes.
ADR 0042 (accepted, #216) supersedes the deadline's role as a terminal
boundary: a crossing while the Run's current Approach is still making Progress
becomes a one-time Tier Escalation rather than Finalization. The budgets,
Progress, and the Finalization Causes below stand.

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
  not merely a successful call. New evidence is the settled page state moving
  or an accepted Evidence Checkpoint. The first observation of the state the
  page sits in by an Observation Producer that has not yet observed it — the
  first page read of a state, the first Look at it — is neutral: new material,
  so not a no-progress action, but not Progress, so it resets nothing. Only a
  Producer repeating itself against a state it already observed is a
  no-progress action. For a loop whose catalog holds no checkpoint or
  state-change tool — a Browse Subagent has neither — Progress is the page
  moving and nothing else, and the neutral first observation is what lets it
  read and look at one source without exhausting an Approach on the spot.
  Two no-progress actions require a different Approach; two exhausted
  Approaches require an Answer or, before exhaustion, one high-information
  question. A rejected Evidence Checkpoint is a no-progress action, and a
  Tool Round's rejected checkpoints count once (#197): the calls of one round
  are made before the model can read any of their results, so a burst of one
  mis-shaped bookkeeping call is one mistake, not one exhausted Approach per
  sibling. The next round's first rejection counts again.
- The runtime mechanically nudges and eventually refuses repeated actions
  against equivalent state. Changed content, scroll position, pagination, or
  media state prevents false refusal. One exception, from the scroll delta
  (#194): a scroll whose outcome ends on `end of page` brought nothing into
  the viewport, so its position moving is not a change — the pair survives,
  and because the note itself already said there is nothing further, the next
  identical scroll is refused rather than nudged again.
- Work budgets warn internally near exhaustion. Exhaustion disables browser,
  vision, media, delegation, and user-question tools. Finalization still permits
  at most one Run Plan/Run Headline and Evidence Checkpoint bookkeeping Tool
  Round before one reserved Answer-only model round. The 32-Tool-Round hard
  ceiling includes bookkeeping but not the Answer-only round; ordinary work
  stops early enough to leave bookkeeping capacity when needed. A failed or
  tool-requesting reserved Answer produces a deterministic Answer from verified
  evidence rather than a raw limit error — and so does an off-contract one
  (ADR 0034, which superseded the two-member list this sentence first had).
- Navigation and meaningful browser actions return Action Outcomes containing
  the settled page state needed for the next decision. `read_page` remains an
  explicit inspection tool, but is not a mandatory follow-up to every action.
  A scroll is one of those actions (#194): it returns what entered the
  viewport — the refs and page text that were not visible before, under the
  same caps `read_page` uses — or `end of page` when nothing did. A ref
  number names the element the model was shown, or the action is refused with
  the page attached (ADR 0033, #196).
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
  event for every finished worker. (This ADR first let the Run's own
  Finalization cancel a worker before it reached a cause; ADR 0035 superseded
  that with the Report Grace, so every worker now ends with a cause.)
  Neither is model-facing text and
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

## Notes

- 2026-09-29 (#309, grilled from every retained capture): **an action that
  leaves for another document waits for that document's load before its
  snapshot is taken.** A navigate waited for its load and then 300 ms. A
  click, a type and a `press_key` waited 300 ms and for nothing else, and a
  `back` or a `go_forward` for the navigation to commit and then 300 ms, so
  the Action Outcome of a click that opened a page was a snapshot of the
  page 300 ms after the click.
  - **Measured** over 385 orchestrator turns and 54 Subagent runs in 65
    capture sets. Of 170 orchestrator clicks that changed the URL, 47 came
    back with a settled page, no refs, no page text and a scroll height at
    or below the viewport; of 5 Subagent clicks, 2. A `read_page` returned
    text in the next round after 44 of the 49, a round each. Of 68 types
    that changed the page, 7, all rmg.co.uk collection searches, each
    followed by a read with text. Of 7 `back`s, none; no capture holds a
    `go_forward` or a `press_key`. The title was the new page's in 27 of
    the 49 and empty in 22, never the old page's: the document had
    committed and often had not parsed its head.
  - **The load is enough, and content is not waited for.** Of 2,463
    orchestrator navigates, which wait for the load, 7 showed the same
    empty snapshot and no later read returned text from one (PDF hosts, a
    login page, an archive's index). A wait for content would have to say
    what content is, and a page with none would pay the whole bound.
  - **All five actions, by the navigation's start and never the URL.** The
    settle watches for a main-frame navigation to another document that
    starts during the action, and waits for that one's load, then the
    300 ms. A link to a slow server has not changed the URL at 300 ms and
    reported `urlChanged=false` over the old page; watching the start
    covers it. The captures cannot count those, which read as clicks that
    did nothing.
  - **The wait is bounded at 10 s, and its expiry is an Unfinished Load,
    not an Unsettled Action.** The action ended; only the page's load did
    not. The snapshot is taken of what is there, the outcome says the page
    was still loading, and no resource is withheld. A navigate's 95th
    percentile is 5.9 s, so a bound of 5 s would expire on about one load
    in twenty. An early click took a median of 954 ms and a navigate takes
    1,247 ms, so the wait costs under a second where it is needed.
  - **A navigate keeps its 30 s bound and its failure.** Its load is the
    action, and a load that outlives its wait is an Unsettled Action under
    the custody rules (#205). The two bounds differ for that reason.
  - **A change of address inside one document is left as it is**: 300 ms
    and the snapshot. No document loads, so there is no event to wait for.
  - **An Empty Landing is no longer a matter of the verb**
    ([ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md),
    note of this date).
  The Round Audit and the Fix Ledger report three counts a capture set,
  never gated: page arrivals by the five actions, those that showed no
  text, and Unfinished Loads. Older captures are recounted from their
  traces by the result's shape, as #304's were, and the 47 and the 7 are
  what the next capture is read against. Closes on tests, one e2e that
  clicks a link to a fixture whose response is held, and the recount; no
  capture.
- 2026-09-29 (#309, implementation): the pane counts main-frame navigations
  to another document as `did-start-navigation` reports them and takes the
  tab's `did-stop-loading` after the latest as its load finishing; an action
  takes a watch before it acts and asks it after its 300 ms settle.
  A click or a type that arrived says `arrived at another page` on its
  outcome's first line, since a change of address inside one document also
  moves the URL; an Unfinished Load says `the page was still loading when
  the wait for it ended at 10 s, so what is shown may be less than the
  page` there too. A `back` and a `go_forward` still wait 15 s for their
  commit, and then for the load. No tool is named `press_key`: the
  controller's key press, which `media_control` sends, waits for a load
  it starts, and no outcome of it carries a page. The Run Trace records
  `unfinishedLoad` on the tool result and becomes version 11, 10 being
  #303's on its branch. Recounted from the traces the committed audits
  name (62 capture sets), 166 clicks arrived, 46 showing no text, and 66
  types, 7 showing no text; over the 65 sets the grill swept, 170 and 48,
  the one beyond its 47 a click on `fix-257-3` whose snapshot listed refs
  and no text, which the grill's count of early snapshots left out. An e2e
  clicks a link whose document commits at once and whose body is held
  3 s: without the wait the outcome is `title=""`, `scroll 0/575`, no refs
  and no text, as the captures showed.
- 2026-09-29 (#308, grilled from every retained capture): **an Action
  Outcome names the page it carries, and a landing whose collection failed
  is collected again once the tab has stopped changing.** A navigate wrote
  its line from the tab's address, then collected the page. When the tab
  moved between the two, the line named the page the tab was leaving, the
  collection failed, and the outcome degraded to that line alone.
  - **Measured** over 2,803 successful navigate results in 258 log
    directories, orchestrator and Subagent. 26 carry no page, and each has
    a collector fault beside it in the host trace. 4 are Result Picks of
    one rmg.co.uk link whose line names the listing the tab had left; 20
    are Google challenge walls, whose address is right and whose Blocker
    marker is present; 1 names a DuckDuckGo redirect hop; 1 is a rewritten
    search. In the 4, the load's wait ended about 870 ms after the open
    began and the collection ran 3.2 to 3.6 s before it failed.
  - **It is a navigate's fault, not a Result Pick's.** A picked open is an
    ordinary navigate, and 22 of the 26 had no pick.
  - **The line is written from the collected page.** One collection gives
    the address, the title and the snapshot, so they cannot disagree.
  - **A failed collection waits for the tab to stop changing, then collects
    once more.** The wait is the one a mid-load abort already uses, entered
    only after a failure, so a navigate that collects pays nothing. A
    second settle alone was rejected: the tab may still be moving.
  - **A second failure says so.** The outcome names the address read after
    the failure and says the page could not be read and a Page Read will
    show it. A marker the landing earned is kept.
  - **The navigate does not wait for the commit.** A reload of the same
    address and a change of address inside one document commit
    differently, and the two decisions above remove both symptoms. It is
    reconsidered if a capture still shows collections repeated.
  - **No Run Trace field.** The Round Audit counts landings that carried no
    page from the result's text, reported and never gated. The collector's
    fault records the exception's description, which the retained traces
    lack: they say `Uncaught` and nothing of why.
  A `back` and a `go_forward` write their line the same way and are given
  the same treatment; no capture holds an instance. #309 changes what a
  click, a type, a key press and a step through history wait for and leaves
  a navigate's wait as it is, so neither issue waits on the other. Closes
  on tests and one e2e whose fixture leaves for another page after its
  load; on the next capture, outcomes whose line and page disagree are
  counted, and none is expected.
  - **Implemented** 2026-09-29. The retry's wait is the abort's polling,
    its settles named `landing-retry` beside `navigate-abort`. The second
    failure's sentence is `PAGE_NOT_READ` in `actionOutcome.ts`: "The page
    could not be read; read_page will show it." The page behind a
    dismissed consent wall is collected the same way, and says the same
    when it cannot be read. A `back` and a `go_forward` take the retry and
    the line but no consent dismissal, which they never had. The fault of a
    retry that failed is reported at `landingOutcome.retry`. The thrown
    value's description is added in the one page-evaluation seam, so any
    page evaluation that fails now says why. The audit's
    `pagelessLandings` reads the Run Trace's whole result; recounted, it
    finds each of the four rmg.co.uk picks, the rewritten search in
    `fix-265-267-3`, and in `baseline3-1` the DuckDuckGo hop and one
    Google challenge wall. The e2e
    fixture leaves when the collector first writes to it, which makes the
    first collection throw; against the old controller its line names the
    page left.
- 2026-10-05 (#315, [ADR 0038](0038-finalization-has-one-elapsed-time-allowance.md)).
  "A deterministic Answer … rather than a raw limit error" held for a
  failed reserved round and not for a working round that failed outright:
  a provider error that was neither a timeout nor a Transport Failure
  spoke one error line, showed the raw message and discarded what the Run
  had found. That Run now ends on the deterministic Answer too.
