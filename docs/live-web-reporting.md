# Grading and reporting live-web captures

How a retained live-web capture (#224) becomes a graded, reportable result
(#226), for the [live-web performance baseline](performance-baseline.md) (#223).

Two commands, one human step between them:

```sh
pnpm live:review --capture=<capture-set.json> --keys=<key-manifest.json> --grades=<your-grades.json>
# … the reviewer reads each Answer against the grading key at the Grading Bench, which writes the grades file …
pnpm live:report --capture=<capture-set.json> --keys=<key-manifest.json> --grades=<reviewed-grades.json> \
                 [--format=markdown|json] [--pricing=<dated-prices.json>] [--out=<report.md>]
```

The bench (see [Grading at the bench](#grading-at-the-bench)) opens its own
pending grades in memory; `pnpm live:report init-grades … --out=<pending-grades.json>`
still writes a pending file for a reviewer who edits JSON by hand.

Both commands are offline. They read files and nothing else: no model, no
browser, no Electron, no network, no scheduler, and no discovery — every input
is an explicit path. Checking a source against the key is the reviewer's job,
done in a browser of their own; this tool cannot fetch a page and never tries.

## The rule everything else follows

**Task Success is an independent verification, not something the app can
report about itself.** A Run that ended `done` proposing the `completed` Run
Resolution has made a claim. The claim is printed in the report, beside the
verdict, and it is never the verdict. `init-grades` opens every slot as
`pending`, and there is no code path from a `done` outcome, a Run Resolution,
an accepted Evidence Checkpoint or a successful tool call to a `pass`.

## Files

| File | Who writes it | Where it lives |
| --- | --- | --- |
| Capture set + Session captures | the capture runner (#224) / scheduler (#225) | `e2e/live/artifacts/` — raw, local, out of Git |
| Substantive key | the evaluator, before the hunt is accepted | `e2e/live/keys.ts` (#225) — committed and versioned |
| Key manifest | derived from the key | carries the key's version, digest and check ids, never its content |
| Grades | the Grading Bench (`pnpm live:review`), or `init-grades` and the reviewer by hand | `e2e/live/private/`, one file per reviewer; reviewer prose and notes stay out of the report |
| Grading drafts | the Grading Bench, on every change | beside the grades file as `<grades>.drafts.json` — never committed |
| Compact report | the report command | `e2e/live/reports/` — committed |

> `e2e/live/artifacts/` and `e2e/live/private/` are ignored by Git (#224).
> Raw traces, Browser Profiles and credentials must never be committed —
> inspect generated output before staging, and never `git add .`.

**Why the key is committed, when "private" suggests otherwise.** The rule the
key has to satisfy is that it never enters the *measured assistant's context* —
which is a different requirement from staying out of Git. The assistant under
measurement is a browser agent with no repository access, and #225's corpus test
walks the import graph to prove nothing on the capture path loads the keys.

Committing them buys something the alternative cannot: **tamper evidence**. This
document forbids "rewriting a key simply to agree with the measured model", and
that rule is only enforceable when an edit after the fact is visible in history
and breaks a recorded digest. A key nobody can diff is a key nobody can be held
to. If a key ever does need to hold a genuine secret, that secret belongs in
`e2e/live/private/` with the committed key referencing it — not the other way
around.

### The key manifest

The *substantive* key — required conclusions, supporting passages, known near
matches, valid alternatives — is prepared before the task is accepted, and lives
in `e2e/live/keys.ts` (#225), versioned with its own revision history. It never
enters the measured assistant's context and never enters a report.

What the manifest carries is the key's public face: which key, at which
version, and what it requires of each hunt step.

```json
{
  "kind": "bingbong.live.key-manifest",
  "schemaVersion": 1,
  "keyVersion": "k1",
  "keyDigest": "sha256:…",
  "preparedAt": "2026-01-01T00:00:00.000Z",
  "tasks": [
    {
      "huntId": "compatibility",
      "stepId": "initial",
      "promptVersion": "p1",
      "keyRef": "keys.ts#compatibility",
      "checks": [
        { "checkId": "c1", "description": "qualified yes, with both cable ends named" },
        { "checkId": "c2", "description": "explicitly rejects the legacy stack for this module" }
      ],
      "referenceSources": ["https://example.invalid/spec"]
    }
  ]
}
```

A task with no checks is refused: a key that requires nothing can never be
failed, so a review against it would be a formality. `referenceSources` is
advisory — see *Equivalent sources* below.

### The grades file

`init-grades` writes one `pending` entry per **scheduled slot**, including the
slots nothing was dispatched into. The reviewer edits entries in place.

```json
{
  "attemptId": "a1",
  "huntId": "compatibility",
  "stepId": "initial",
  "captureId": "capture-compatibility",
  "answer": { "at": 1800000020000, "digest": "sha256:…" },
  "keyVersion": "k1",
  "keyDigest": "sha256:…",
  "status": "pass",
  "checks": [{ "checkId": "c1", "satisfied": true }, { "checkId": "c2", "satisfied": true }],
  "support": [{ "claim": "both cable ends", "sourceUrl": "https://…", "passageRef": "S1" }],
  "rationale": "both required checks are met by the cited passages",
  "reviewer": "evaluator-1",
  "reviewedAt": "2026-01-15T00:00:00.000Z"
}
```

`answer` is the publication stamp plus a **digest** of the exact Answer text,
never the text. It exists so a review cannot drift onto a different Answer than
the one that was read: a `pass` whose binding does not match what the capture
recorded is refused.

#### The five states

| status | means |
| --- | --- |
| `pending` | not yet reviewed. Counted in every denominator, never as a success. |
| `pass` | the predefined expected outcome was independently verified. |
| `useful_partial` | real verified work, short of the expected outcome. |
| `help_access_blocked` | the Run hit an access wall or asked for help it did not get. |
| `unsuccessful` | no useful result or actionable next step was established. |

A slot that was never dispatched has **no** reviewed state. It stays `pending`
and carries an execution disposition instead — not-reached is a fact about the
protocol, not a judgment about an Answer, and grading it either way would be
inventing a review. For the initial pilot hunts, only `pass` counts: graceful
stopping is not the expected outcome.

#### What the code checks, and what it cannot

It checks the **binding and the completeness** of the record: every required
check judged exactly once, no unknown checks, a `pass` supported by at least
one cited claim and named reviewer, and the graded Answer being the captured
one. It does **not** check that the reviewer was right. There is no automated
judge and no keyword match anywhere in this path, by design.

**Read the key's constraints before judging its checks.** A check id exists for
everything a reviewer can answer yes or no about the Answer in front of them —
a required fact was reached or it was not, a pitfall was walked into or it was
not, an uncertainty survived or it was flattened. A key's `constraints` are
deliberately *not* checks, because they are instructions to the reviewer rather
than things an Answer can satisfy: how to decompose the verdict ("grade the
cable, the hardware pairing and the software stack separately"), what not to
grade at all, and — the ones that change verdicts — which alternatives count as
acceptable. Judging the checks without having read them will produce a
defensible-looking record with the wrong verdicts in it.

### Equivalent sources

An Answer that reached the key's conclusion by another route is not thereby
wrong, and one that cites the key's own URL is not thereby supported. The
reviewer decides, and records the decision:

```json
{ "claim": "…", "sourceUrl": "https://mirror.invalid/copy", "passageRef": "M1",
  "equivalentTo": "https://example.invalid/spec" }
```

Genuine source uncertainty is preserved rather than resolved: where the source
itself is qualified ("probably", "circa"), a passing Answer is expected to be
qualified too.

### When live facts change

Live sources move. The response is a **documented recheck**, never a penalty
against a newly correct Answer and never a key quietly rewritten to agree with
what the model happened to say. Add to the entry:

```json
"recheck": {
  "priorKeyVersion": "k1", "newKeyVersion": "k2",
  "recheckedAt": "2026-01-20T00:00:00.000Z",
  "evidence": "both cited passages still read as they did",
  "conclusion": "unchanged"
}
```

- `unchanged` — the older review stands, and the report flags it.
- `revised` — the sources moved under the review, so it is **refused** until
  re-reviewed under the new key. Letting it stand would be the rewrite the
  study forbids.
- `unresolved` — kept as-is, and never counted as verified success.

## Grading at the bench

Reading six Answers out of `capture.json`, sixty-eight check descriptions out of
a manifest and every key's constraints out of `keys.ts`, then typing a grades
file the validator accepts, is not a pass anyone does twice. The **Grading
Bench** (#228) is where a human does it instead:

```sh
pnpm live:review --capture=e2e/live/artifacts/pilot-2.json \
                 --keys=e2e/live/private/key-manifest.json \
                 --grades=e2e/live/private/pilot-2-grades-<you>.json \
                 [--reviewer=<name>] [--compare=<another-reviewers-grades.json>] [--port N] [--no-open]
```

It is a loopback-only server (port 4227 by default) serving one page, in the
mould of `pnpm trace:ui`. Every input is an explicit path, and it is a script,
never an app view — one of the two scripts `corpus.test.ts` allows to import the
keys.

The sidebar lists the set's slots in schedule order with each one's state:
pending, drafted, graded, or not reached with the capture's reason. Under the
slots are `live:report`'s own counts over the saved file. Each screen holds one
attempt:

- **The Answer**, rendered server-side with the app's own `react-markdown`, so
  the reviewer grades what the Feed showed, with a raw toggle. A follow-up
  carries its initial's Answer in a collapsed panel.
- **What the assistant read**, from the attempt's event tape: every `navigate`,
  `read_page` and `look` in order with its URL and outcome — loaded, walled
  (the app's own Blocker marker, as challenge-walled, network-blocked or
  login-walled), errored — each with its full page text, collapsed. Then every
  `record_evidence` call, rejected ones included. This is what separates
  `help_access_blocked` from `unsuccessful`. A Run that spawned Subagents says
  so, because their browsing is not on its tape. Failure screenshots are linked
  when the capture kept any.
- **The whole key**: its constraints first, then the step's checks with their
  descriptions, then the required facts, pitfalls, uncertainties, sources, live
  facts and follow-up delta. A support row picks its URL from the key's sources
  (a follow-up's own first), or names another URL as an equivalent.

Judging writes nothing to the grades file. Every change — a check, a support
row, a note, the rationale — goes to a drafts sidecar beside it
(`<grades>.drafts.json`), so closing the page loses nothing. **Save** composes
the entry and runs the real `parseLiveGrades` over the file it would produce.
Only a file the validator accepts is written, so the grades file is always one
`live:report` accepts. A rejected save shows the validator's message verbatim;
the page shows the same message while the reviewer works, and keeps Save
disabled while there is one.

**The bench never picks a verdict.** It has only three rules of its own. A
status has to be chosen. A slot nothing was dispatched into stays pending. An
attempt that published no Answer is `unsuccessful` or `help_access_blocked`:
one click marks every check unsatisfied, and the rationale is still typed.

**One grades file per reviewer.** The reviewer is `--reviewer`, else
`git config user.name`, and the bench refuses to open a grades file anyone else
has reviewed in. To compare, pass the other reviewer's file as `--compare`. The
other Grade for a slot is not sent to the page at all until the reviewer's own
entry for that slot is saved. After that it appears as a per-check
agree/disagree with both notes, and the two statuses and rationales side by
side. The blank start is deliberate: a pre-filled Grade anchors the reviewer to
the other one's interpretation calls.

It reads only the paths it was given and the files the capture set names. It
writes only the grades file and its drafts sidecar, and warns when they are
outside `e2e/live/private/`. It refuses to open a key that has moved past the
manifest the checks came from, so key prose and check wording cannot silently
disagree. It answers only requests addressed to loopback from its own page. Both
files it writes carry reviewer notes about Answers — never commit them.

## The report

### Populations, each with its own denominator

Three are reported separately and never merged:

- **initial** — one row per scheduled initial hunt.
- **revised_objective** — the predefined constraint-changing follow-ups.
- **both_step** — one row per scheduled pair; passes only when *both* grades
  pass.

`corrective` continuations get a fourth population of their own, kept apart
from the predefined follow-ups.

A correct follow-up cannot repair the initial that failed. The worked example
the tests pin: two initials fail, one fixed follow-up passes and the other is
never reached → initials **0/2**, follow-ups **1/2**, both-step **0/2**. A
third hunt with no scheduled follow-up changes only the initial denominator.

Every row carries an execution disposition, so nothing leaves the denominator
quietly:

| disposition | means |
| --- | --- |
| `answered` | dispatched, accepted, and a final Answer was published |
| `no_answer` | ran, published no final Answer |
| `acceptance_unconfirmed` | submitted, but the app never confirmed an accepted command |
| `not_reached` | the protocol decided against dispatching it; the reason is kept |
| `unaccounted` | scheduled, and no Session capture mentions it at all |

Verified successes are reported over the **scheduled** population — that is the
headline in both output formats. `verifiedOverReviewed` carries the secondary
reviewed-only rate with its own denominator, and is `null` when nothing has been
reviewed. It exists because partial grading makes the primary rate read low for
a reason that is not the assistant's; it never stands in for the scheduled rate,
because substituting it is exactly how unreachable work disappears.

### Timestamps, exactly

| Figure | Boundary |
| --- | --- |
| `observedAnswerLatencyMs` | accepted `command` event → the `display` the pipeline marked as the final Answer. Event publication, **not** renderer paint and **not** audible onset. |
| `successfulTaskCompletionTimeMs` | the same fixed observation, present only for an independently verified Answer. |
| `runDurationMs` | accepted command → the `done` event. A different question from the Answer. |
| `censoredElapsedMs` | accepted command → where observation actually stopped, when the Run reached no terminal. Not a Run duration, and not a second copy of the Answer latency: a Run that answered at 15 s and was then watched to a 300 s timeout spent 300 s. It is the one figure crossing two clocks — the app's wall stamp and the evaluator's, both `Date.now()` on the same machine. |
| `userWaitMs` | resolved ask and confirmation intervals. |
| speech input latency | `not_applicable` on a typed command — never zero. |

Rules these encode:

- **Grading never moves a timestamp.** A `pass` qualifies the already-recorded
  observation; the time of review does not enter it.
- **A wrong, absent or ungraded Answer earns no successful Task Completion
  Time, and keeps its observed latency.** A wrong Answer that arrived in nine
  seconds is a measurement, not a blank.
- **Correctness and timing are independent.** A verified Answer whose command
  stamp is missing is a verified success with no completion time — it counts in
  `verifiedSuccess` and not in `timedSuccess`, and both are printed.
- **A published Answer and a later mechanical failure are separate facts.** A
  `failed` outcome does not retract an independently verified Answer.
- **Missing, invalid, not-applicable and observed-zero stay distinct** — the
  `Observed<T>` statuses from #224 pass straight through. A negative interval is
  reported `invalid` and is never clamped into a plausible one.
- **A corrective chain is timed from the command that opened it**, so the
  failed work before the correction is inside the completion time, and the
  failed attempts keep their own rows. The chain is followed only through the
  explicit `corrective` relation and its parent link — never inferred from
  wording.

For a pair that both steps passed, a separately named `sequenceElapsedMs` spans
the initial acceptance to the follow-up's Answer, beside each step's own time
and the inter-command gap. Per-step medians are never averaged into a total.

### Statistics

Individual observations, plus min / median / max with observed and missing
counts. An empty distribution returns **null**, never a zero standing in for no
data. Successful-task latency and unverified-attempt latency are reported
separately, and unverified attempts are never dropped for lacking a completion
time.

**No p95.** Three repeats per task do not support a tail estimate, and none is
offered at any effort.

If the input mixes modes, commits or prompt versions, those cohorts are
reported separately rather than silently pooled.

### Where the time went

Built from diagnostics that already exist — perf spans per stage, retry
markers, tool and browser sub-spans, vision records, user waits, speech spans,
`llm_round` usage — and from nothing else.

The one thing to understand before reading it: **stage totals are not
additive**. A `tool` span contains the `browser-*` sub-spans beneath it, and a
Subagent's rounds overlap the tools they drive. Each stage therefore reports its
own count, its plain sum, and the union of its own intervals; there is no
cross-stage total, no exclusive wall-time split, and no
`unexplained = wall − sum(stages)` remainder. Unions are only meaningful within
one launch, so each carries its `clockOrigin`. The synthetic `summary` record
and the zero-length `llm-retry` markers are excluded from durations — retries
are counted, never timed.

Attempts with no span coverage are counted as such rather than treated as
instant.

Subagents are counted by distinct `agentId`, never by tape witness: a Subagent
whose rounds were published twice is one Subagent. They are broken down by how
each one stopped — its own Finalization Cause where it reached one, else
`cancelled` or `failed`, else `uncaused` when no cause reached the tape. A Run
that delegated three and cancelled all three must never read as one that
delegated none, which is why the cancelled and failed ones appear beside the
rest instead of being dropped for lacking a clean finish.

### Usage and cost

Per role — orchestrator, subagent, vision — with prompt and completion tokens,
rounds, rounds that actually reported usage, and a `complete` flag that is false
when the sum is a floor. Read from raw `llm_round` records, never from the daily
spend ledger, which turns missing usage into zero and binds nothing to an
attempt. Vision usage is always unavailable: vision records carry request
duration and never tokens.

The section states its own limits every time, not only when a price list is
supplied, because they are properties of the data rather than of the request:
tokens are summed **per role, not per model**, so a role that used two models
has no per-model split and none is inferred; vision has no tokens at all; the
daily ledger is never read; and any role whose rounds did not all report usage
is named, with its token count marked a floor.

Dollars appear **only** with an explicit `--pricing` file:

```json
{ "source": "provider list price", "dated": "2026-01-15",
  "models": { "model-o": { "inputPerMTok": 0.6, "outputPerMTok": 2.2 } } }
```

There is no fallback price for an unknown model. A role whose tokens span
several models is left unpriced rather than split by guess, and every uncovered
model, incomplete role and vision request is listed beside the subtotal. The
figure is a labelled estimate over observed priced usage — not a billing
figure, not a spend limit, and not a guarantee.

## Safety of the exported report

Both output formats carry the same facts, and neither carries raw prompts,
Answers, tool results, screenshot bodies, reviewer prose, reviewer notes, key
content, credentials, Browser Profiles or absolute local paths. Retained
artifacts appear as identities only — family, digest, size, completeness — so a
reader can find them locally; the report never publishes them, and no trace
server is involved.

Output is written once and never over. The command refuses to write onto any
capture, key, grade input, existing report or referenced diagnostic artifact,
including aliases reached through symlinks, and validates everything before it
writes anything. Raw observations are never modified during grading: the
end-to-end test asserts the input files are byte-identical afterwards.

Error output names files, never their contents.

## Exit codes

`0` — a valid report, **including** one full of failed hunts and pending
grades. That is a finding, not a tool error.

`1` — unreadable or structurally mismatched input: bad JSON, an unknown option,
a grades file bound to another capture set or key, a stale key binding with no
documented recheck, a slot graded twice, or one attempt captured in two
Sessions.

## Verifying a change here

```sh
pnpm exec vitest run e2e/live/grades.test.ts e2e/live/report.test.ts e2e/live/gradingBench.test.ts e2e/live/gradingBenchServer.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

The suites run under the ordinary unit run — they spend nothing and launch
nothing. `report.test.ts` invokes `scripts/live-report.ts` as a real Node
subprocess, which is what catches an accidental Electron import or an
extensionless runtime import on the CLI's graph. `gradingBenchServer.test.ts`
serves a fixture set on a real loopback socket, saves Grades through it, and
checks the file it wrote against `scripts/live-report.ts` run the same way.
The page itself has no automated test; after changing `scripts/live-review.html`,
open a set at the bench and walk a draft, a reload and a save.
