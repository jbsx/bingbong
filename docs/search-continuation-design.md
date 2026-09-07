# Reliable Search Continuation

Status: confirmed on 2026-09-06, including the outcome-first stopping policy.
This records the agreed design, not shipped behavior or authorization to start
application implementation. The design interview is complete.

## Scope

Address reliable termination, image verification failures, task drift, and
Candidate retention across continuing searches. Keep bounded Runs; neither
unbounded autonomous work nor a blanket budget increase is the goal.

## Accepted Decisions

- Bookkeeping failure must not prevent an Answer or discard accepted Evidence
  Checkpoints. Attempt the reserved Answer round only within the remaining
  Finalization Allowance; otherwise return a deterministic grounded Answer.
- The Finalization Allowance is shared from entry until the Card is available.
  It includes Report Grace, bookkeeping, retries, and Answer generation, but
  excludes speech playback. Explicit user Pause suspends it; Stop wins.
- Start with 60 seconds total: up to 30 seconds for Report Grace, up to 10
  seconds for bookkeeping, and a protected 20 seconds for the reserved Answer.
  Time saved by earlier phases remains available to the Answer. Retries share
  these limits; exhausted or unavailable phases are skipped rather than having
  their budgets restarted. These defaults are hypotheses, not measured optima.
- Finalization must be communicated to the model even when the Run has no
  tool-result history. A second full acquisition attempt is not finalization.
- If defining constraints cannot be verified, try a genuinely different
  available verification route within the Run's budget. Otherwise return an
  explicitly unverified Candidate or shortlist, naming the missing check.
  Search ranking alone does not establish a strong match. Do not repeatedly
  transfer image verification to the user.
- A continuation should pursue a different Approach rather than repeating an
  unavailable route. A vision deadline breach describes that attempt, not
  permanent unavailability throughout the Session.
- Do not automatically retry a failed vision request within the same Run. A
  later explicit continuation permits one fresh verification attempt when it
  could resolve a specific, still-eligible Candidate. If it fails again, use a
  genuinely different available route or return the limitation rather than
  gathering interchangeable Candidates behind the same verification obstacle.
- An Answer requesting Candidate inspection identifies its subject explicitly.
  A rejection targets that single Inspection Reference, not whichever page
  happens to be open. If multiple Candidates were presented without a clear
  subject, clarify rather than rejecting them all.
- Inspection commands preserve the Inspection Reference. Another Candidate
  presentation replaces it; changing objectives or ending the Session clears
  it. Intervening exchanges that make it ambiguous require clarification.
- Rejection is objective-scoped. User rejection stands until the user explicitly
  reopens it; model elimination may be revisited when genuinely new evidence
  overturns its rationale. Retain who decided and why.
- Preserve the user objective and constraints explicitly across "keep looking".
  A substantive user correction may change them. Model Assessments cannot
  become user facts through summarization. Rejected Candidates and failed
  Approaches remain relevant continuity.
- A constraint correction continues the same objective. Retain its Candidates
  and user rejections, while reconsidering model eliminations whose rationale
  the correction invalidated. A replacement objective does not inherit old
  rejection decisions, though underlying Observations can remain useful.
  Clarify genuinely ambiguous transitions and reuse existing objective Memory
  Entries rather than introducing a parallel identity system.
- Preserve the accepted utterance and its unambiguous Inspection Reference
  before the model starts. A first-request failure must not erase a rejection.
  Preserve mechanically observed failures without inventing an explanation;
  ambiguous language remains unresolved rather than automatically classified.
- Retaining a correction is not the same as interpreting it. If interpretation
  fails, preserve the exact utterance and its Inspection Reference as an
  unresolved user correction, authoritative over older model Assessments.
  The next Run must resolve it before accepting or presenting an affected
  Candidate again. Clear rejections become decisions; ambiguous ones require
  clarification. A timeout neither erases the utterance nor classifies it.
- `partial` means useful grounded progress even when a Candidate's match is
  unverified: distinguish verified constraints from unchecked ones. `blocked`
  applies when an unavailable capability prevents further useful work and
  there is no useful partial result. `needs_user` is not a way to transfer the
  assistant's verification work to the user.
- Diagnose vision with local stream fixtures and narrowly scoped timing first,
  without changing models or increasing caps. Paid live-model probes require
  separate approval with a stated request count and budget.
- If a non-interruptible action outlasts the Finalization Allowance, make the
  bounded Answer available on time and identify any uncertain action outcome.
  Late results cannot mutate that Answer or the finalized Run's continuity.
  Do not let a new Run act on a browser resource still owned by the unsettled
  action: it remains unavailable until settlement or safe isolation. Answer
  availability and safe resource reuse are different boundaries.
- Preserve the original Finalization Cause when a later Finalization request
  fails; record the later failure separately in diagnostics.

## User-Facing Stopping Policy

Model-written and deterministic Answers describe task progress, not resource
accounting. Time limits, work budgets, round counters, and provider failures
stay in diagnostics by default. Explain the actual internal stopping reason
when the user explicitly asks why work stopped.

State what was accomplished, what remains uncertain, and any actionable
external blocker. An unreadable tier-list image is an unresolved verification
step; a sign-in requirement may be an actionable blocker. Neither calls for a
default explanation about model timeouts or budgets.

- Never imply an exhaustive search merely because a work limit was reached.
- Never imply background work continues after the Run has ended.
- Do not routinely end with "say keep looking" or transfer verification to the
  user. Offer a next step only when it is specific and useful.
- If nothing changed, answer briefly instead of repeating the last shortlist.
- Claim a Candidate was ruled out only when the rejection was actually resolved
  and retained. An unresolved user correction is not yet a rejection decision.

For example, when supported by retained work, prefer "I found two possible
posts, but haven't verified that both titles are in the 10/10 tier" over "I ran
out of work budget." This changes presentation, not the requirement to disclose
uncertainty or accurately preserve the mechanical outcome and Finalization Cause.

## Verification Boundary

Require deterministic regressions for the captured timeout, user-intent, and
rejection failures, plus a scripted multi-Run scenario spanning presentation,
rejection, first-request failure, and continuation. These tests can establish
mechanical guarantees, not reliable live-model search quality or recovery of
provider vision latency. Those remain explicitly unverified until separately
approved live probes provide evidence; passing local tests alone does not
resolve those behavioral findings.

Cover outcome-first stopping for both model-written and deterministic Answers:
default endings must omit internal resource accounting while retaining relevant
uncertainty and actionable blockers. Direct questions about why work stopped
must still receive a truthful explanation.

## Existing Concepts and Conflicts

Use existing objective/constraint Memory Entries, User Observations, Candidate
identities, and Run Notes before introducing another identity system. The
Answer-to-Candidate Inspection Reference is a relationship over those
identities, not a new kind of Candidate: an Answer names the Candidate it
presents, the Session retains that relationship beside the Candidate, and a
later Run is told which subject its inspection command addresses.

ADR 0027 exempts Finalization rounds from the active-work deadline. The
Finalization Allowance is a distinct bound, not extra acquisition time.
[ADR 0038](adr/0038-finalization-has-one-elapsed-time-allowance.md) records the
shared allowance, its interaction with Report Grace and Pause, bounded fallback,
and outcome-first presentation. It refines ADRs 0027, 0035, and 0036.

[ADR 0039](adr/0039-user-corrections-and-candidate-decisions-retain-their-scope.md)
extends ADR 0028 with pre-model correction retention, explicit Inspection
References, and objective-scoped Candidate decisions without treating retained
utterances as already interpreted.

The current implementation also has model-invoked user-evidence retention and
Session-wide Candidate status. These do not yet fulfill the accepted retention
and objective-scoped rejection rules. Glossary changes record the intended
domain, not completion of those changes.

## Confirmation

The user confirmed the consolidated design after accepting the outcome-first
stopping revision. Architectural decisions are recorded in ADRs 0038 and 0039.
Application implementation remains a separate step; no live-model probe has
been authorized or run as part of this design interview.
