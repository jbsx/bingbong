# The live-web hunt protocol

The reproducible protocol for the live-web performance study (#223). It
describes what a pilot pass submits, in what order, under what isolation, and
what it records when something cannot happen. It is deliberately separate from
the release evaluation (`pnpm test:eval`) and the delegation probe
(`pnpm test:delegation`), and changes neither.

Scope: this document covers the **schedule** (#225) and the corpus it runs.
The single-hunt capture foundation is #224 and the manual grading and report
are #226; the pilot itself is #227.

## What a pass is

Four independent information hunts, run sequentially, two of which carry one
fixed follow-up each. **Six commands, at most once each.** That is the whole
work bound of a pilot pass.

| # | Hunt | Kind | Follow-up |
|---|------|------|-----------|
| 1 | `compatibility-pi-camera` | compatibility | yes — an enclosure constraint |
| 2 | `historical-longitude-watch` | historical identification | none |
| 3 | `rule-eurostar-luggage` | rule applicability | yes — a fare-class change |
| 4 | `superseded-voyager-interstellar` | superseded information | none |

The order is fixed so two passes are comparable. It is not otherwise
load-bearing: every hunt starts from a fresh Session and a restored profile, so
no hunt can inform another.

## The corpus

`e2e/live/hunts.ts` holds prompt text and nothing else.
`e2e/live/keys.ts` holds the evaluator-only grading keys — required
facts, constraints, near-match pitfalls, uncertainties, primary sources, and
the follow-up grading deltas.

**Nothing on the capture path imports `keys.ts`.** That split is the
enforcement of the separation rule rather than a convention: the runner cannot
leak a key it never loaded. `corpus.test.ts` pins the two apart — no key
string, source URL, source hostname, or answer token may appear in any prompt,
and no prompt may contain a URL at all.

### Changing a prompt or a key

Both carry a `version` and a `revisions` list, and `revisions.length ===
version` is asserted. Every accepted prompt version is additionally pinned by a
content digest in `corpus.test.ts`.

- Editing prompt text without bumping `version` **fails the digest pin**.
- Bumping `version` requires a new pin and a new dated revision reason.
- A pin is **never edited in place** — an edited pin would silently invalidate
  every capture already taken against that text.

This is what stops a task or an expected answer being adjusted after a measured
response has been observed. Facts may still legitimately change: `liveFacts` on
a key names the statements that are current-state rather than settled history
(today, only the Eurostar allowance), and those must be rechecked against their
sources before a paid pass. A changed live rule is a key revision with
provenance — never a failed Answer.

## Isolation

Each independent hunt gets:

- a **fresh Session**, and
- a **dedicated benchmark Browser Profile restored to the same clean starting
  state** — cookies and local storage included, not merely a cleared Feed.

The personal profile is never used. A hunt's follow-up rides the *same* context
object as its initial command, so preserving the Session and profile within a
hunt is structural rather than remembered: there is nowhere else to submit it.

Hunts run one at a time. The previous hunt's context is ended before the next
begins, so no two are ever live at once.

## Follow-up delivery

A follow-up is delivered when, and only when:

1. its initial command was **accepted** by the pipeline (a Run exists and
   carries an identity — not that a DOM form submitted, and not that the task
   succeeded), and
2. the same Session reports it **can take another command**, within the capture
   contract's own bounded readiness budget.

**Correctness is never consulted.** The schedule has no access to a grade and
the port exposes no answer text to judge. A follow-up goes out after a wrong
Answer exactly as it does after a right one — conditioning delivery on
correctness would hand a weaker assistant an easier evaluation population.

Between the two commands the schedule does not steer, reset, coach, supply the
correct answer, or create a replacement Session. The port exposes no method for
any of it, so none is reachable under pressure.

### When a follow-up cannot happen

It is recorded as **not reached, with a reason** — never as a success, and
never silently omitted.

| Reason | Means |
|---|---|
| `awaiting_help` | The initial Run ended waiting on the user. Answering it is forbidden, so the hunt stops. |
| `session_lost` | The Session that ran the initial is gone. Continuing would need a replacement Session. |
| `session_unavailable` | The Session is alive but could not take a command inside the readiness bound. |
| `initial_not_accepted` | The initial command was never accepted, so there is no Run to continue. |
| `capture_failed` | The harness broke. Broken measurement, reported as such. |

The assistant is never helped past a wall. Sign-in, confirmations, CAPTCHAs,
purchases and installations are never automated; an unresolved access blocker
is a non-completion and a finding.

## What a pass records

Per hunt: the initial command and the follow-up as **separate fields**. A
failed initial Answer cannot be overwritten by a successful follow-up, because
there is no assignment that could overwrite it — downstream grading always sees
both.

Each scheduled command is either `attempted` (with its capture) or
`not-reached` (with a reason and detail). There is no third state and no absent
one.

Task failure and broken measurement are different records. A capture carrying a
`measurementFault` is retained — the latency of a broken capture is not
discarded — but it is never read as a task result, and its follow-up is
`capture_failed` rather than a task outcome.

A hunt that breaks does not abort the pass. The remaining hunts are independent
by construction, so they still run; abandoning them would silently shrink the
study.

## What lands on disk

A pass produces one **capture set** plus one **session capture** per hunt
(#224's artifacts, under `e2e/live/artifacts/`, gitignored).

The set file carries the pass's *planned* population — all six scheduled
commands, with each follow-up filed under its own initial as a
`revised_objective` — alongside the session captures that were actually
produced. The slots come from the corpus rather than from the results, which is
what lets a reader name a command that never happened at all; a set whose slots
were read back off its own results could only describe what did.

A set is `measurement_failed` when any scheduled command could not be observed,
and `complete` otherwise — **including when hunts simply failed**. That
asymmetry is deliberate: a task the assistant got wrong is a finding and the
pass that recorded it is complete, while a command the harness could not
observe is a broken measurement and the pass has to say so rather than present
a hole as a result.

Evaluator-only material (the grading keys and anything derived from them) stays
out of the artifacts and out of Git.

## The work bound

Four initial submissions plus the two eligible predefined follow-ups, at most
once each. The schedule submits each prompt exactly once by construction — no
loop can repeat one — and a `CommandBudget` guard makes that a property
something checks rather than a claim about the code's shape. A later edit that
adds a retry trips `CommandBudgetExceeded` instead of quietly doubling a paid
capture.

Explicitly not part of a pass: automatic task retries, extra exploratory
commands, failure-only reruns, best-of selection, and any automatic three-pass
baseline campaign. Production's own internal effort and retry behaviour is
unchanged — the cap is on user commands, not on how hard a Run works.

## Measured mode versus verification

Measured mode is **live web only**. Fixture pages and scripted model responses
exist to verify the runner and can never be selected as measured pilot tasks:
`runLiveWebPass` refuses any hunt the approved corpus does not declare, and
refuses to run one twice in a pass.

Verification runs no-spend through the real Electron seam. Measured passes
require production routing with no scripted model hook active.

Neither mode modifies or populates the pinned release corpus
(`e2e/eval/pools/`) or the delegation corpus (`e2e/eval/delegation/`). Live-web
results are diagnostic-only and gate no release — the `canaries` slot in
`e2e/eval/acceptance.ts` is where that house rule is already written down.

## Running it

Unit checks — the corpus rules and the whole schedule, no Electron, no spend:

```
pnpm test
```

Electron verification and any real capture run under Xvfb, one app at a time,
as everything else in this repo does. Paid captures are opt-in, never ride CI
or `pnpm test:e2e`, and are bounded by the pilot cap above.

## Stop point

The pilot stops after its report. Three complete baseline passes need separate
post-pilot approval. Three repeats per task support individual results and
descriptive medians — not an asserted reliable p95.
