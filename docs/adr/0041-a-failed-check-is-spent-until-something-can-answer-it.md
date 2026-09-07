# ADR 0041: A failed check is spent until something eligible can answer it

## Status

Accepted on 2026-09-07, implemented in #212. Implements the Reliable Search
Continuation design's verification and retry policy. Extends ADR 0039 (which
retains what the user decided) with what the *application* observed, and ADR
0040 (which records what a Vision Attempt observed) with what is done about it.
Session lifetime, the Vision Budget, the Vision Deadlines, and the model routes
are unchanged.

## Context

The tier-list search could not read the image that defined the objective. Four
continuations later it had four shortlists, no verified match, and one sentence
of evidence about why: a Look that failed after about eight seconds.

Nothing recorded that the *check* was what failed. Each Run started with an
open vision route, spent it on the same unreadable image, read the failure as
the route being gone, and gathered another set of interchangeable candidates
behind the step it had not completed. The user was told about posts that had
never been checked, and asked to check them.

Three things made that loop possible, and each of them was ours:

- The Session retained nothing about the attempt, so every continuation had to
  rediscover that the route was spent — by spending it.
- The advisory nudge a breached deadline carries opened "Vision is unavailable
  right now" and offered `ask_user` as the way out. One attempt establishes
  that one attempt failed (ADR 0040); the sentence claimed the Session, and the
  escape it named was handing the assistant's own work to the user.
- The Answer had no way to say "found, not checked". `needs_user` was available
  and read as reasonable, and the deterministic Answer let one sentence stand
  in for two, so a list of posts appeared under "I could not read the image" as
  though the posts had been checked.

Raising the Vision Budget, lengthening the deadlines, or switching models would
each change spend under a fault none of them addresses: the loop is not short
of attempts, it is short of a memory of them.

## Decision

- **The Session retains the attempt, in the route's own words.** A verification
  failure is retained with the route it spent, what that route reported
  verbatim and bounded, the objective it was spent under, the Run that spent
  it, and the Candidate it was checking when the Session held an unambiguous
  subject. No cause is derived from it and none is invented. The advisory nudge
  the round appends is ours, not the route's, and is stripped before retention.
- **A route is what makes two Approaches different.** Rewording a Look's
  question or searching somewhere else stays on the route it was already on. A
  spent Look leaves reading the page exactly as open as it was.
- **Within a Run, a failed route is spent.** The rail refuses the repeat before
  the Vision Budget is charged — a check this Run will not make must not spend
  the budget for one — and the refusal names the route still open and the
  honest ending, never that the route is unavailable.
- **A later Run reopens it once, for something specific.** A later Run is a new
  explicit command from the user, so it may spend one fresh attempt — but only
  while a Candidate exists that the attempt could settle. A Candidate rejected
  or superseded under the objective in force is not one, and neither is one
  carrying words the user spoke that no Run has resolved (ADR 0039): checking
  it would settle on the model's own authority the very thing they are waiting
  to be asked about. A second failure closes the route again.
- **Eligibility is read live, and from inherited words only.** A Candidate this
  Run has just found is exactly the specific lead a fresh check exists for, so
  the set is resolved per call rather than at admission. And the corrections
  that make a Candidate ineligible are the ones this Run *inherited* — the rule
  the store already applies to a decision and a presentation. A Run's own
  command is what it is there to answer, and checking is one of the ways it
  answers it.
- **A replacement objective starts with every route open.** Retention is scoped
  exactly as a Candidate Decision is, and adopted at the same commit-time beat:
  a Run that spends a route before its own Memory Commit names the task at the
  next admission.
- **An unmade check is not a user choice.** A Run proposing `needs_user` while
  holding a check it could not complete records what it actually has instead —
  `partial` with retained sources, `blocked` with none. Only `needs_user` is
  touched, and never upward: a Run reporting `blocked` or `unsuccessful` keeps
  its own honest reading.
- **Both Answers distinguish what was established from what was not.** The
  deterministic Answer says both sentences when both are true — the leads are
  unverified, and the check that would have settled them did not happen. The
  model-written half rides the orchestrator prompt, which owns the Answer's
  prose: search ranking is a reason to consider a result, never evidence about
  a constraint that was never checked.

## Consequences

A continuing search stops paying for the same unanswerable question. What it
gains is bounded and specific: one attempt per Run, and only against a
Candidate a check could actually settle. What it loses is the accidental
retry — a Run whose Look fails cannot look again at a different page in that
Run either. That is deliberate. The failure this addresses is a route that
stopped answering, and distinguishing "this page's image" from "that page's
image" would reopen the loop under a different name.

The retention is Session-lifetime, bounded at five failures, and dies with the
Session and with a replaced objective. It is not diagnostics: the Run Trace's
`vision_request` record (ADR 0031, ADR 0040) still holds the milestones and the
limits, and this holds only what a later Run needs to decide what to do next.

What is established here is mechanical: which calls the rails refuse, what the
Session retains, what the next Run's request carries, and which Resolution a
Run records. It is not evidence that a live model honours the instruction it is
given, and not evidence that provider vision has recovered. Both remain
unverified until a separately approved live probe provides evidence — see
[Reliable Search Continuation](../search-continuation-design.md), "Verification
Boundary".

## Relationships

Extends [ADR 0039](0039-user-corrections-and-candidate-decisions-retain-their-scope.md)
(objective-scoped decisions and unresolved corrections, which eligibility
reads) and [ADR 0040](0040-a-vision-attempt-records-what-it-observed.md) (an
attempt reports what it observed; this decides what is done with it). Refines
ADR 0016's deadline nudge and ADR 0038's outcome-first stopping policy, and
rides ADR 0027's bounded Run without adding to its budgets.
