# ADR 0065: A Delegated Page still loads, and its outcome names the Subagent that holds it

## Status

Accepted on 2026-09-25 for #273, grilled from the run-traces of the three
live-web captures that ever spawned a Browse Subagent (baseline3-3,
fix-263-264-1, fix-265-267-1, all `compatibility-pi-camera`). A sibling of
ADR 0051's Held Page: the page loads, and the Action Outcome says what the
Run already has for it. Adds one glossary term, one Notice kind, one
lookup on the Tool Round executor, one sentence to the delegation prompt
and three Round Audit counts. ADR 0051's predicate, the spawn gate, the
Evidence Checkpoint's grounding rule (ADR 0028) and the On-Screen
Principle (ADR 0009) are unchanged.

## Context

Delegation is meant to buy completion (#163): a branch handed to a Browse
Subagent is rounds the orchestrator does not spend. In every spawned Run
the orchestrator still ended at its own 24-round budget, because it read
the delegated branch itself. Read from the interleaved Run Traces with the
predicate below, the re-reads fall into three phases:

| trace | Subagent running | finished, report uncollected | report collected |
|---|---|---|---|
| baseline3-3 | 9 | 0 | 3 |
| fix-263-264-1 | 0 | 0 | 7 |
| fix-265-267-1 | 0 | 0 | 3 |

baseline3-3 is the live case: the spawn task named
`camera_software.html`, the Subagent opened it in its round 1, and the
orchestrator opened it 16 seconds later and read parts 1, 2, 5, 6 and 7
over its rounds 7 to 16 — the parts the Subagent was reading. The other
two are the collected case: after `agent_results` returned the report, the
orchestrator went back to `camera_software.html` and to the camera
documentation page and re-read the parts the report's findings already
cited. The issue as filed read fix-263-264-1 as a live re-read of the
product page; the trace shows the orchestrator landed there first and the
Subagent after it, so the union predicate below counts it in neither
phase.

Four facts decided the seam:

- **A live Subagent's page is never a Held Page.** Held means an accepted
  web Observation cites the URL (ADR 0051). A Browse Subagent has no
  `record_evidence`; its ledger is private, and its findings enter the
  store only when the orchestrator checkpoints them with kind `subagent`
  after collection. No Subagent Observation existed while any of the three
  ran, so the orchestrator's landing on the delegated page carried no
  Notice. Extending Held Page cannot cover this; it needs its own
  predicate.
- **A spawn-time refusal does not prevent the measured duplication.** In
  baseline3-3 the orchestrator had not read `camera_software.html` before
  spawning; the duplication began after. A refusal on task URLs the
  orchestrator had already read would instead have refused both
  fix-263-264-1 spawns, each of which named the 404 page and the giant
  hardware page the orchestrator had landed on — and delegating a page
  already opened is sometimes right, as it was there.
- **The task's URLs are free text.** `spawn_agent` carries `task` and
  `memory_ids`; the only reader of URLs in it is the regex that seeds the
  Composed Address rail's offered addresses (`subagentRunner.ts`).
- **The orchestrator is never told which pages the Subagent read.** The
  report renders a URL per finding; the Subagent's full observation list
  is provenance, never rendered. `subagent_finalized` is diagnostic only.
  The delegation prompt says "keep working, then collect outcomes" and
  nothing about the delegated branch.

## Decision

- **A Delegated Page is a page a Browse Subagent of the current Run was
  sent to or has landed on.** Sent to: every URL in its task, read by the
  existing regex at spawn. Landed on: every URL its own page-facing calls
  settled on, appended as they happen. All are canonicalised by the
  store's rule, `canonicalizeMemoryUrl`, so no fifth URL rule appears.
  Search-results pages count like any other: the rule sorts the query, so
  only the same search matches, and re-running a Subagent's search is a
  re-read.
- **It stays delegated until the Run ends, in three states.** Running;
  finished with its report uncollected; collected. A cancelled or failed
  Subagent releases its pages at once, since no report is coming.
- **A Delegated Page still loads.** A navigate, click, back, forward or
  read on one executes exactly as today. The On-Screen Principle, the
  ledger and every later checkpoint, Look and revalidation are untouched.
- **The Action Outcome carries a Delegated Page Notice.** One Notice kind,
  immediate — it rides the successful result that triggered it or is
  dropped — placed right after `held_page` in the precedence table, so a
  page both held and delegated carries both. Its text is by state:
  - running: `a-1 [browsing] was sent to this page for: <task, first 160
    characters>. Its report will carry what it reads here; keep to what
    you did not delegate, or wait with agent_results.`
  - finished, uncollected: `a-1 has finished with this page; collect its
    report with agent_results before reading it.`
  - collected: `a-1's report already covers this page:` then one
    `subject: detail` line per finding citing it, capped at eight with a
    count of the rest, then `Record these from the report rather than
    re-reading them, and read this page only for what they do not state.`
  A page delegated to more than one Subagent names each holder.
- **It fires once per page, holder and state, per executor,** on any
  successful page-facing call whose current page is delegated — not once
  per landing as ADR 0051's Notice does. A landing rule misses the race
  where the orchestrator is already on a page when a Subagent is sent
  there, and misses a state change on a page the orchestrator stays on.
- **Both loops.** The Run loop and the Browse Subagent loop take the same
  lookup; a Subagent's lookup excludes its own pages, so it hears only of
  siblings, and only in the running state, since a Subagent collects
  nothing.
- **The registry is the Subagent manager's.** Each record already carries
  task and status; it gains the page set and, once collected, the report's
  findings by cited URL. The Tool Round executor takes a lookup beside
  `heldObservations`, threaded through the Subagent runtime and workhorse
  the same way.
- **The prompt says it once.** The delegation block gains one sentence: a
  page a running subagent was sent to or is reading is its branch, its
  report will carry what it finds there, so keep to what you did not
  delegate or wait with `agent_results`. The spawn result's "or keep
  working" gains "on what you did not delegate".
- **The Round Audit counts three things,** per attempt and per population,
  code-counted from the interleaved Run Trace under the audit's canonical
  rule, in the style of the Held Page count: orchestrator navigate or
  read_page rounds on a Delegated Page while its holder runs, while it is
  finished and uncollected, and after its report is collected. No new
  trace field: every Subagent call is already stamped with its agent id.

## Considered options

- **Make a delegated page a Held Page**, the issue's first option.
  Rejected on the facts above: Held is defined by evidence the Session
  holds, and a page a Subagent is reading holds nothing yet. Widening
  the term would make "held" mean two things.
- **Refuse the spawn when the task names a page the orchestrator has
  read**, the issue's second option. Rejected: it would have refused two
  of the three real spawns and prevented none of the measured re-reads.
- **Refuse the navigate or read on a Delegated Page.** Saves the most
  rounds, but needs an escape for a legitimate second use of the page, and
  ADR 0051 already recorded why an escape argument trains itself on. Kept
  as the next rung if the capture shows the Notice ignored.
- **Notice on every read of the page while delegated,** not once per
  state. Declined as token cost on the rounds being saved; the count of
  Delegated Page rounds shows whether once was enough.
- **A `delegated pages:` preface in the system block,** as ADR 0051 added
  `held pages:`. Declined: delegation is Run-scoped and that block is
  built from the Session store; the Notice and the sentence are the lever,
  and a per-request line is measured before it is added.
- **Leave the collected phase to #272.** The first draft did, because the
  collected Notice asks the orchestrator to record from the report, and
  #272 is why such citations are rejected half the time. Taken back on
  the counts: the collected phase is the larger waste, in every trace,
  and its Notice needs nothing #272 provides. Its gate waits on #272.

## Consequences

- The live gate is an absolute zero: orchestrator Delegated Page rounds
  while the holder runs or is uncollected, 0 on any attempt that spawns;
  spawned Runs' orchestrator rounds below 24. The collected count is
  reported, not gated, until #272 lands, because a rejected kind-subagent
  citation sends the orchestrator back to the page whatever the Notice
  says. All three are conditional on a spawn occurring: only pi-camera
  has ever spawned, 5 of 66 attempts, so a capture with no spawn closes
  the issue on tests and leaves the counts armed, as #264 was closed.
- A Delegated Page landing costs its round as before; what the decision
  buys is the reads after it.
- The orchestrator learns a Subagent has finished only on a page it
  delegated, from the finished-state Notice. Nothing else tells it, and
  this ADR does not add a general signal.
- A Subagent is never told that the orchestrator read a page
  uncheckpointed. Not measured, not done.

## Relationships

Sibling of [ADR 0051](0051-a-held-page-still-loads-and-its-outcome-names-what-the-session-holds.md):
the same shape — the page loads, the outcome names what the Run already
has — on a different predicate, with a different firing rule. Depends on
[ADR 0009](0009-on-screen-browsing.md)'s visible Subagent tab for the
landed URLs. The collected-state Notice's success rides on #272's fix to
[ADR 0028](0028-checkpointed-session-evidence.md)'s kind-subagent grounding.

## Notes

- 2026-09-25, grilled before implementation (#273). Reference values for
  the three audit counts, from the three spawning traces: running 9, 0,
  0; finished-uncollected 0, 0, 0; collected 3, 7, 3. The tests to pin:
  the executor fires once per page, holder and state, in both loops, own
  pages excluded, and attaches nothing without a lookup; the manager
  parses and canonicalises task URLs at spawn, appends landed pages,
  releases on cancel or failure, and exposes findings by URL once
  collected; the prompt sentence in `orchestratorPrompt.test.ts`; the
  three counts on a synthetic interleaved trace.
- 2026-09-25, implemented (#273). The Notice's words and its firing record
  live in `src/core/pipeline/delegatedPage.ts` (`createDelegatedPageNotices`,
  keyed page + holder + state); the registry is
  `SubagentManager.delegatedHolders`, and a worker's landings reach it
  through the runner's `observe` sink — only a page-facing call's
  observation carries a source URL, so the executor needed no second hook.
  Three calls the Decision left open: the orchestrator's lookup is scoped to
  the Subagents its own turn spawned, so a page a Subagent held in an earlier
  Run of the Session is no longer delegated ("until the Run ends"); a
  collected report whose findings cite nothing from the page adds no Notice,
  since the Run then has nothing to record from it and the page is its own to
  read; and a cancelled Subagent is released the moment the cancel is
  decided, not when its loop notices. `urlsInTask` is now the one reader of
  a task's addresses (the Composed Address rail's offered addresses read
  through it too) and leaves a sentence's closing punctuation off; the audit
  keeps its own copy of the regex because `delegatedPage.ts` cannot load
  under plain Node. The audit field is `delegatedPageRounds` (round numbers
  per state per attempt, summed per population), optional so audits written
  before it still load, and outside the digest, so no cached judgement is
  re-keyed.
