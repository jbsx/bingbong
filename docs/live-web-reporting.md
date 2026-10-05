# Grading and reporting live-web captures

How a retained live-web capture (#224) becomes a graded, reportable result
(#226), for the [live-web performance baseline](performance-baseline.md) (#223).

One human step between the capture and the report:

```sh
pnpm live:review [--port N] [--no-open]
# … the reviewer confirms a capture set on the bench's setup page, then reads each Answer against the grading key, which writes the grades file …
pnpm live:keys --out=<key-manifest.json>
pnpm live:report --capture=<capture-set.json> --keys=<key-manifest.json> --grades=<reviewed-grades.json> \
                 [--format=markdown|json] [--pricing=<dated-prices.json>] [--out=<report.md>]
pnpm live:summary --reports=<a.json>,<b.json>[,…] --out=<summary.md|json> [--format=markdown|json]
pnpm live:audit --capture=<set.json> [--capture=…] [--model=<id>] [--effort=<level>] [--max-usd=<n>]
```

The bench (see [Grading at the bench](#grading-at-the-bench)) opens its own
pending grades in memory; `pnpm live:report init-grades … --out=<pending-grades.json>`
still writes a pending file for a reviewer who edits JSON by hand. `live:summary`
reads the JSON reports of several Passes and writes what they say together
(see [The cross-pass summary](#the-cross-pass-summary)). `live:audit` reads the
captures and the grades back and says where each attempt's rounds went (see
[The Round Audit](#the-round-audit)); like `live:grade`, it is paid and opt-in.

All four are offline. They read files and nothing else: no model, no browser,
no Electron, no network and no scheduler. `live:keys`, `live:report` and
`live:summary` discover nothing — every input is an explicit path. The bench is the one exception, and
a bounded one: it proposes from its two fixed roots and the reviewer confirms on
a page before anything opens. Checking a source against the key is the
reviewer's job, done in a browser of their own; this tool cannot fetch a page
and never tries.

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
| Key manifest | derived from the key: in memory by the bench, as a file by `pnpm live:keys` for `live:report` | carries the key's version, digest and check ids, never its content |
| Grades | the Grading Bench (`pnpm live:review`), or `init-grades` and the reviewer by hand | `e2e/live/private/`, one file per reviewer, which the bench names `<setId>-grades-<reviewer slug>.json`; reviewer prose and notes stay out of the report |
| Grading drafts | the Grading Bench, on every change | beside the grades file as `<grades>.drafts.json` — never committed |
| Compact report | the report command | `e2e/live/reports/` — committed, as markdown and as the JSON the summary reads |
| Cross-pass summary | `pnpm live:summary`, from the JSON reports of several Passes | `e2e/live/reports/` — committed beside the per-set reports |
| Round Audit | `pnpm live:audit`, from the captures' Run Traces and perf logs, the grades and a model reviewer | `e2e/live/reports/audit-<setId>.{json,md}` and one aggregate — committed; the per-attempt reviewer cache stays in `e2e/live/artifacts/audit-cache/` |

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
pnpm live:review [--port N] [--no-open]
```

It is a loopback-only server (port 4227 by default), in the mould of
`pnpm trace:ui`. It is a script, never an app view — one of the two scripts
`corpus.test.ts` allows to import the keys — and it takes no paths.

### The setup page

The bench opens on a setup page, and nothing else happens until the reviewer
presses **Start**. The rule it follows: **the bench proposes from its two fixed
roots and the reviewer confirms; it never opens anything silently.** It replaced
#228's three path flags (#229), and it is the bench's rule only — `live:report`
and `live:keys` keep their explicit paths. The roots are `e2e/live/artifacts/`
and `e2e/live/private/`, with no override.

- **Capture set.** Every capture set in the artifacts root, recognised by its
  `kind`, so the preflight record beside them is skipped. Each shows its id,
  when it was created, its mode and state, its slot count, and the reviewer's
  progress: graded, drafted, pending and not reached. Some sets are listed
  greyed out with the reason and cannot be started:
  - a verification-mode set;
  - an incomplete one (`in_progress`, `interrupted`, `measurement_failed`);
  - one that does not validate;
  - one whose id another file also claims;
  - one a bench would refuse to open.

  The newest set that can be started, where the reviewer still has an ungraded
  slot, is proposed. When nothing can be graded, the page says how a pass is
  run.
- **Reviewer.** Filled from `git config user.name`, editable here until the
  first Start, and fixed from then on — across every set that process grades.
  A typo guard flags a name before Start when nothing in the private root was
  graded or drafted under it but other names have work
  there. The flag lists the names that do. It cautions and never refuses:
  every second reviewer is new too.
- **Grades file.** Shown under the chosen set, read-only:
  `<setId>-grades-<reviewer slug>.json` in the private root, with its drafts
  sidecar beside it. The slug is the name lowercased, each run outside `[a-z0-9]`
  one `-`, none at either end. A name with nothing a slug keeps gets
  `reviewer-<12 hex of its digest>`. The file's `reviewer` field keeps the
  exact name.

  A file already holding the reviewer's work is found **by content** and
  reopened, whatever it is called: a grades file for the set with an entry by
  this reviewer, or a drafts sidecar bound to them. The set is greyed out, and
  no second file is ever started, when:
  - two files match;
  - the matching file mixes reviewers;
  - it or its sidecar is bound to another key than the current one. A grades
    file is resolved through the documented recheck in
    [When live facts change](#when-live-facts-change); a draft has no recheck
    and is moved aside;
  - the derived name is already taken by something that is not the reviewer's.
- **Another reviewer's Grade.** Every grades file in the private root, whatever
  it is called, that is bound to the chosen set and the current key and holds
  one other reviewer's reviews and none of this reviewer's. Each is labelled by
  its `reviewer` string, so a model-graded file reads as exactly that. A file
  mixing two other reviewers has no one name to label it, and is not offered;
  nor is one that does not validate against the set, so a comparison on offer
  is one Start can open. When exactly one file is offered it is preselected;
  otherwise **none** is, and none is always on offer. A default is safe here,
  as it was not for the reviewer's own file, because the bench keeps the other
  Grade blind until each save ([At the bench](#at-the-bench)): it is shown
  beside the reviewer's own slot by slot, and only once that slot is saved, so
  it cannot anchor them.
- **Key.** Its version and a shortened digest, the whole digest on hover, at
  the foot of the page. The manifest is built in memory from the
  committed keys, so there is no manifest file to name, and no way for key
  prose and check wording to disagree. `pnpm live:keys` is needed only for
  `live:report`, and writes the same manifest byte for byte.

Start opens the bench on the chosen set.

**Switching sets.** The bench's **change set** link comes back to this page
without restarting `live:review` (#231). The list is read again, so the set just
left shows its new graded, drafted and pending counts. Start opens the next set
in the same process, any number of times. Leaving mid-draft loses nothing: every
change is already in the drafts sidecar, and re-entering the set restores it.
The reviewer is fixed from the first Start for every set that process grades;
to grade under another name, restart `live:review`. A bench page still open on
a set that has been left is refused rather than served, so it cannot write into
the set that is open now. Another reviewer's Grade to compare against is not
carried over: each Start takes the one chosen for its own set.

### At the bench

The bench is laid out to be read in one order, with nothing on screen that the
current step does not need (#232). The header names the set, the slot's
position in it and the reviewer, with **change set** as its only action. The
sidebar groups the set's slots by hunt, in schedule order — each hunt's
initial, then its follow-up — with each slot's state: pending, drafted, the
saved verdict, or not reached, with the capture's reason on hover and in full
on the slot itself. One line under it counts the slots saved, drafted and not
reached; `live:report`'s own counts are read in the report, not here.

Each slot is two panes. The left pane holds what to read, in three tabs, and
every slot opens on the first:

- **Answer** — rendered server-side with the app's own `react-markdown`, so the
  reviewer grades what the Feed showed, with a rendered/raw switch in the tab
  bar. The command as submitted is folded above it; a follow-up folds its
  initial's Answer there too.
- **What it read** — from the attempt's event tape: every `navigate`,
  `read_page` and `look` in order, one line each (tool, outcome, host and path,
  page title) with its full page text folded under the line. The outcome is
  loaded, walled (the app's own Blocker marker, as challenge-walled,
  network-blocked or login-walled) or errored. This is what separates
  `help_access_blocked` from `unsuccessful`, and the tab is not opened on every
  slot, so its label carries the number of reads and a marker when any was
  walled, blocked or errored: *What it read · 8 · 1 walled*. Then the evidence
  the assistant recorded; entries the app rejected, or never answered, are
  folded behind a count, because they diagnose the Run rather than the Answer.
  A Run that spawned Subagents says so, because their browsing is not on its
  tape. Failure screenshots are linked last when the capture kept any.
- **Key** — the key beyond its checks: sources, uncertainties, live facts and
  the follow-up delta. Nothing that is already a check on this slot is
  repeated: an initial's checks are the key's required facts and pitfalls, and
  a follow-up's are its delta's, so a follow-up's Key tab adds only the delta's
  sources.

The right pane is the Grade form, in the order a reviewer works:

1. **Constraints**, open on every slot. They decide verdicts without being
   checks: how to decompose the verdict, what not to grade, which alternatives
   count.
2. **Checks**, one row each: the check id, its description, *satisfied* or *not
   satisfied*, and an optional note behind the pencil. The note is kept in the
   grades file and never exported into a report.
3. **Verdict** — the Grade's status: pass, useful partial, help / access
   blocked, or unsuccessful.
4. **Support** — a row picks its URL from the key's sources (a follow-up's own
   first), or names another URL as an equivalent.
5. **Rationale**, required.

A save bar is pinned under the form, with **Save** and **Discard** (enabled
once a draft exists). It says what is left before a save, in the form's order —
*4 of 10 checks · verdict · rationale* — and opens into the whole checklist.
The checklist is the validator's rule said as work left, not as errors: every
check judged, a verdict, what a pass needs (every check satisfied, support for
a claim), finished support rows, a rationale, and, once all of those are done,
any other rule the validator still names, in its own words, unaltered. Save is
enabled only when the validator would accept the entry, and the checklist can
never enable it on its own.

Judging writes nothing to the grades file. Every change — a check, a support
row, a note, the rationale — goes to a drafts sidecar beside it
(`<grades>.drafts.json`), so closing the page loses nothing. **Save** composes
the entry and runs the real `parseLiveGrades` over the file it would produce.
Only a file the validator accepts is written, so the grades file is always one
`live:report` accepts. A refused save, or a draft that could not be written,
shows the server's message verbatim, in red, in the save bar. Nothing on the
page is red before that.

**The bench never picks a verdict.** It has only three rules of its own. A
verdict has to be chosen. A slot nothing was dispatched into stays pending. An
attempt that published no Answer is `unsuccessful` or `help_access_blocked`:
one click marks every check unsatisfied, and the rationale is still typed.

**One grades file per reviewer.** The bench refuses to open a grades file anyone
else has reviewed in. It can still show another reviewer's Grade, but blind:
the other Grade for a slot is not sent to the page at all until the reviewer's
own entry for that slot is saved. After that it appears under the form: the
disagreements first — the verdict if it differs, and each check judged
differently, with both notes — then both rationales and both reviewers' support
side by side, which are never judged agree or disagree, with the agreements
behind a toggle. The blank start is deliberate: a pre-filled Grade anchors the
reviewer to the other one's interpretation calls. The other Grade shown is the
one chosen on the setup page, from the files it offers for the set, or none.

Before Start it reads only the two roots' top-level files, and each set it
offers, with each comparison beside it, the way a bench would open them. After
Start it reads the chosen set and the files that set names. It writes only the
grades file and its drafts sidecar, both in `e2e/live/private/`, and nothing at
all before Start. It answers only requests addressed to loopback from its own
pages. Both files it writes carry reviewer notes about Answers — never commit
them.

## Grading by a model reviewer

The protocol as #223 first wrote it had a human grade every slot. It was
amended on 2026-09-12: the reviewer of record is a model, driven through the
Claude Code CLI, and the human adjudicates only the calls it flags.

```sh
pnpm live:grade --capture=e2e/live/artifacts/<setId>.json
#   [--reviewer=<name>] [--model=<id>] [--out=<grades.json>] [--only=<attemptId>]
#   [--prompts-dir=<dir>] [--dry-run] [--max-usd=<per call>]
```

It is the same review the bench asks a person for, one `claude -p` call per
dispatched slot, with **no tools and no session**: the model is handed the
Answer, the trail the Run left (every navigate, read and look, with its
outcome, and the evidence the assistant recorded), the key as the bench's Key
tab shows it — constraints first, then the facts, pitfalls and uncertainties
with their check ids, then the verified sources — and the exact list of check
ids to judge. A follow-up slot also gets its initial's command and Answer, as
context, not as something to grade. The reply is structured output: a verdict,
every check judged with a note, support rows, a rationale, and a list of
**calls a careful human might make the other way**, each naming its check id
and what the alternative reading would change.

What it never does:

- **Grade a slot nothing was dispatched into.** Not reached stays `pending`,
  as at the bench.
- **Pick a verdict itself.** The output is composed into a grade entry and run
  through `parseLiveGrades` — the same validator the bench's Save runs. A
  refused output goes back to the model once, with the validator's own words
  and an instruction not to change a judgment merely to satisfy it; a second
  refusal leaves the slot `pending` and says why in the adjudication file.
- **Overwrite.** It writes `<setId>-grades-<reviewer slug>.json` in the private
  root — the bench's own name for this reviewer, so the setup page offers the
  file as another reviewer's Grade to compare against — and refuses to write
  where a file already exists.
- **Run unasked.** It is opt-in and paid, excluded from every test config, and
  `live:report` never calls it. The measured model is `GLM-5.3`; the reviewer
  is `claude-opus-5` (the CLI's served model is checked against the name the
  grades file carries, and a mismatch fails the run rather than mislabel it).

Beside the grades file it writes `<grades>.adjudicate.md`: slot by slot, the
flagged calls, the rationale, the check notes and the served model, then the
spend the CLI reported. **That file is the human's work item.** A decision
that changes a verdict is recorded in the key's `constraints` as a key
revision with provenance — the two rules `SHARED_GRADING_RULES` carries were
the first — never silently in the grades file. It quotes reviewer prose about
Answers, so it is never committed.

Measured on `pilot-1`: about 45 seconds and $0.18 per slot, so a six-slot set
grades in about five minutes for about a dollar. A prompt can be inspected
before anything is spent with `--dry-run --prompts-dir=<dir>`.

What this does not change: there is still no judge in the report path, no
keyword matching anywhere, and no code path from a `done` outcome or a
proposed Run Resolution to a `pass`. What it does change is honest to name:
the verdicts in a report are a model's, under rules the owner wrote, and the
`reviewer` field says so.

## The report

The JSON form carries `kind: bingbong.live.report` and `reportVersion: 2`.
Version 2 (#233) added `provenance.reviewers` — the distinct reviewer
identities over the entries a reviewer judged, printed in the markdown
provenance block — and `promptVersion` on every row, so the cross-pass summary
can check who graded and which prompt each task ran under from the report
alone. Nothing the report derives changed with the version.

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

## The cross-pass summary

A Baseline is several Passes read together (CONTEXT.md §Performance
Evaluation), and `pnpm live:summary` is the one document that reads them:

```sh
pnpm live:report … --format=json --out=e2e/live/reports/<set>.json   # once per Pass
pnpm live:summary --reports=e2e/live/reports/baseline-1.json,e2e/live/reports/baseline-2.json,e2e/live/reports/baseline-3.json \
                  --out=e2e/live/reports/baseline-<date>.md
```

**Its input is the JSON report, never the captures or the grades** (ADR 0044).
`live:report` already answered every disposition, grade-binding, timing and
usage question once; a summary that re-derived them from raw captures would be
a second implementation of the same rules, and the two would diverge. The
command imports no capture reader, no grades parser and no key module —
`corpus.test.ts` did not change for it — and it re-derives nothing: a Task
Completion Time in the summary is the one the report earned.

**It merges nothing it cannot check.** Every input must share everything the
protocol fixes — key version, key digest, routing (any role's model), the
prompt version of every task, reviewer, study, protocol version, mode, adblock,
reasoning-effort override, effort overrides and the browser sub-spans flag — or
the command refuses and names the differing values per set id. (The sub-spans
flag, `BINGBONG_BROWSER_SUBSPANS`, is recorded since #247; a report written
before then reads as captured with it off. It retains timing records only and
never changes what the model sees or does, but two Passes that differ on it
carry different perf artefacts, so it is checked like the rest.) A mixed set of
inputs is a protocol
break, not a merge: a Baseline is one route under one key and one reviewer,
and a comparison across routes is a different document this command is not.
Commit, dirty tree and grades revision are listed per input and never
compared. A capture set named twice, or two inputs with the same `createdAt`,
is refused — one Pass counts once — and so is a single input: for one Pass,
read its report. A Pass with no reviewed entry is refused by name rather than
reported as a reviewer disagreement, and so is a Pass with two rows for one
task (a task is one Hunt's step under one relation; a corrective retry under
its parent's step id is its own task). An input whose set state is not
`complete` is accepted; its report's own warning is carried with its set id,
and its unreached slots appear as `not_reached` / `unaccounted` in the
per-task rows.

What it writes, in either format (`kind: bingbong.live.summary`,
`summaryVersion: 1`):

- **Provenance** — every input by set id, report path, commit(s) and
  dirty-tree flag, ordered by `createdAt` whatever order `--reports` named
  them in; the shared key version, routing and reviewer once.
- **Populations** — verified over scheduled summed across Passes, with every
  Pass's own ratio printed beside the sum; never one pooled rate alone.
  `corrective` appears only when some input scheduled one.
- **Tasks** — one section per Hunt step with one row per Pass (disposition,
  grade, finalization cause, Answer latency, Task Completion Time, Run
  duration, flags), then attempts / answered / verified over Passes, Task
  Completion Time min / median / max over verified attempts with `n=k of N
  passes` stated, Answer latency over unverified attempts, full Run duration,
  and finalization causes and flags with counts. A Pass with no verified
  attempt contributes nothing and stays in N; it is never a zero. A verified
  attempt whose time is unavailable or invalid is counted apart, as a
  qualifying attempt without an observation, so `n=2 of 3 passes` never
  hides which kind of absence it is.
- **Both-step sequences** — per Hunt with a follow-up, the initial-acceptance
  to follow-up-Answer elapsed over the pairs both steps of which verified.
- **Usage** — per role summed across Passes with `live:report`'s `complete`
  semantics: a role incomplete in any Pass is incomplete here, and the Passes
  are named; vision stays unavailable. No cost estimate.
- **Data quality and protocol anomalies** — every warning and anomaly from
  every input, carried with its set id, never dropped.

**Min, median and max only.** The summary states, with N substituted: "Min,
median and max only, over N passes. N repeats do not support a p95, a mean or
a confidence interval, and none is offered. A median of an even count is the
mean of its two middle values." That even-count rule is the summary's own
(#233); the per-set report's distributions take the lower nearest rank, so the
same two values can print different medians in the two documents, and ADR
0044 records why. There is no attribution section: one line says the per-set
reports keep the stage tables.

Like the report, the summary carries no reviewer notes, rationales, Answer
text or key material — the inputs hold none, and `summary.test.ts` asserts
the output holds none — and it is written once, never over.

The first Baseline is `e2e/live/reports/baseline-2026-09-12.md` (and `.json`),
over `baseline-{1,2,3}.json`. The pilots are not inputs: they ran on two routes
under a different reviewer file, and #227 kept them out of baseline evidence.

## The Round Audit

The Baseline says the assistant does not complete these Hunts and that the
rounds are where the time goes: 11 of 18 attempts ended at the Investigation
cap of 24 Tool Rounds, and the LLM stage was an order of magnitude larger than
the tool stage. The summary derives nothing about where the rounds went, by
design. The **Round Audit** (#234, ADR 0045) is the document that does:

```sh
pnpm live:audit --capture=e2e/live/artifacts/baseline-1.json \
                --capture=e2e/live/artifacts/baseline-2.json \
                --capture=e2e/live/artifacts/baseline-3.json
#   [--model=claude-opus-5] [--effort=high] [--max-usd=3] [--out-dir=e2e/live/reports]
#   [--aggregate=audit-aggregate] [--grades=<grades.json>]… [--only=<attemptId>]
#   [--prompts-dir=<dir>] [--dry-run] [--fresh]
```

It reads each set's captures, the Run Trace and perf log each capture retained,
the grades file bound to the set in the private root (or the one `--grades`
names), and the committed keys; it writes `audit-<setId>.json` and `.md` per
set and one aggregate across the sets named, all written once, never over.

### The taxonomy

One kind per orchestrator Tool Round, glossary terms only:

| kind | means |
| --- | --- |
| Acquisition with Progress | the productive class: the page moved to somewhere the Run had not acquired, a first read or Look of a page state, a scroll that brought material into view, a delegation |
| Acquisition without Progress | a repeat observation of a state already observed, a navigate to a URL this Run already acquired, a scroll that answered End of Page, a search after a search with nothing opened between them (streak 2 or beyond), or a re-acquisition of a page the initial already checkpointed (tagged `inherited`, follow-ups only) |
| Collection | reading a finished Subagent Report (`agent_results`) |
| Bookkeeping | `record_evidence`, `record_candidate`, `report_run_plan`; a rejected Evidence Checkpoint is counted beside the round |
| Failed round | a timeout, an empty or failed reply, a round cut by the deadline, or a round whose every call was refused (a stale ref, a closed tool) |
| Finalization | the bookkeeping round and the reserved Answer, after the Run stopped acquiring; outside the budget |

**Off-key** — an Acquisition on a page that can carry none of the key's
required facts for the task — is a judgement laid over Acquisition rounds,
never a seventh kind, so the kinds stay checkable.

### The division of labour

**Code assigns the mechanical kinds**, deterministically, from the Run Trace
(`llm_round`, the `pipeline_event` tool calls and results, `evidence_checkpoint`)
joined to per-round latency from the perf `llm` spans by turn id and stamp, the
way `trace:ui` joins them. Finalization is read from the app's own marks: the
Finalize Instruction riding a result, an `allowance` outcome, the Finalization
rung (#215, skipped under a reasoning override), and the last round replying
with no tool call under a known Finalization Cause. Since Run Trace version
14 a round names the reason for its rung (`rungReason`, #321), and the
Finalization rung is read from that reason alone; a round below version 14
is read by the rung's value, `low` under a higher tier rung, as before. Progress is read from the
result texts the app wrote — the navigated line and page header, the page
signature, `end of page`, the no-progress Notice — and the search streak is the
Search Loop rail's own rule, imported from `searchLoopRule.ts` rather than
copied (ADR 0048, ADR 0058): a search after a search with nothing opened
between them is streak + 1 whatever its terms, an escape resets, and a page
read, a Look, a scroll or a Not-found Landing between them is inspection that
never resets the streak; nor does a checkpoint tool (`record_evidence`,
`record_candidate`), accepted or not (#289). Since #293 escape is something
new put in front of the Run: only a page-facing call can escape, with an
`ask_user` the user answered and an `agent_results` that collected a Subagent
Report, so a Run Plan report, a spawn, a cancel, a question left unanswered
and a wait that collected nothing hold the streak, as do visual grounding, a
landing on a Blocker (the call's `wall`) and a Composed Address rewrite (its
`rewritten` stamp), which is no search of the loop and carries no search
line, whatever Search Observation an older trace holds for it. Whether the
user answered is the trace's own `ask_resolved` record, never the wording of
the result; a call says what it delivered in `delivered` only where its
result's head cannot, so a report that opens the result leaves the digest as
it was. The count of Unavailable Landings followed by a search reads the
same move (#294): the wait after a landing holds on whatever holds the
streak, ends uncounted on escape, and counts when the next move is a search,
so a Composed Address rewrite after a landing holds it and the function
keeps no list of its own. Since #304 an Empty Landing holds the streak too:
a navigate, a `back` or a `go_forward` that settled on a page the Run was
shown no text from, with no wall and no other landing on it, never a click.
It is the call's `emptyLanding`, the host, read from the Run Trace's field
from version 9 and, on a trace below it, from the result's own shape — a
settled page with no `page text:` section — where the trace kept the result
whole (`chars` no greater than the text it holds). The Page Read that returns
text from the page a landing settled on, before the next page arrival, ends
the streak and is the call's `readEmptyLanding`; a landing that was itself a
search leaves no such read, its page being a listing. `emptyLandings` counts
the landings, those followed by a search and those read with text, beside the
rounds; reported, never gated. Since #308 `pagelessLandings` counts, beside
the rounds and out of the digest, the navigate, `back` and `go_forward` calls
that succeeded with no settled page in their whole result — no signature
line — a Result Pick's by the page after its Opened line. It reads the
result text of the Run Trace, so a trace written before the fix reads the
same, its degraded outcome being the line alone; reported, never gated.
Where the trace carries the rail's Search
Observations (#243, ADR 0049), which calls were searches — typed and refused
ones included — and their query and signature (`url` or `input`) are read from
them, and the attempt's `searchSource` reads `rail`; the streak itself is the
rule replayed over those calls, never the number the observation recorded, so a
capture taken under the older same-intent rule (fix-257 and before) is read by
the current one, and on a trace the current rail wrote the two agree. From
streak 2 a search line carries `rewords` — whether it shares a Search Intent
with the one before it — as the reviewer's aid beside the streak, no longer the
rule. A trace written before observations were
kept holds no element facts, so a query typed into a page's search box cannot
be told from other typing; the rule is re-run over its `navigate` searches
(`searchSource: replay`, or `none` when the replay finds no search) and the
reviewer judges the rest. The two sources cannot mislabel an attempt: a
`navigate` search the replay finds is one the rail would have observed, so an
observation-free attempt with one is provably retained. A loop the streak rule catches counts
its head too — the round whose search started the streak — as
`searchLoopHeads` beside the digest's rounds, never in them, so counting it
re-keys no cached judgement; `mechanicalSearchRounds` is the rounds at streak 2
or beyond plus those heads, and beside it `searchRoundsAtStreak2` and
`searchRoundsAtStreak3` (#259) count the rounds at streak 2 or beyond and at 3
or beyond. The rail nudged from streak 3 until #289 and nudges from 2 since,
so the rounds the live rail nudged or refused on are the second count on a
capture before it and the first on one after; the counters keep their
streaks. An attempt says which reading of the rule counted it in
`searchStreakRule` (`SEARCH_STREAK_RULE`, 2 since #289, 3 since #293 and 4
since #304; absent on an audit written before it, which counted an accepted
checkpoint as an opening).
`replaySearchStreaks` re-derives the streaks of a
report already written: the Fix Ledger uses it to recount an audit that
predates the two counters, or whose attempts were counted by an older reading
of the rule, when it reads one, so a Subject under the rule
compares like for like with a Reference audited under an older one,
and `audit.test.ts` pins the recount of the committed fix-257 audits and of
the two captures audited under rule 2. One recount is of what no audit kept
(#304): an audit keeps 240 characters of a result, which cannot say an Empty
Landing, so `pnpm live:empty-landings` reads the Run Traces of every attempt
the committed audits name and writes `e2e/live/emptyLandingMarks.ts` — the
round and the call of each landing — and the Fix Ledger puts those marks
back on the rounds before it replays them. Run it where the captures are; a
worktree holds none. A capture set with no trace on disk (`fix-235`,
`fix-236`, `fix-237`, `fix-239`, `fix-240`, `fix-242`, `fix-242r`,
`fix-256r2`) is left out of the marks, keeps the counts its replay gives
without them, reads its three Empty Landing counters as nothing, and is
named in its family's notes. The same sweep writes `e2e/live/pageArrivalMarks.ts`
(#309): each page arrival by a click, a type, a `back` or a `go_forward`,
whether it showed no text and whether it was an Unfinished Load. The audit
counts the three beside the rounds — reported, never gated — reading a click
or a type as an arrival by the clause its outcome carries on a Run Trace of
version 11 or later, and by the result's shape on an older one (a click that
left the URL, typing the page changed under), which cannot tell a change of
address inside one document. The Fix Ledger sums the marks for an audit
written before the counter; they hold no streak, since a click read by its
shape came back before its page loaded. Rounds are numbered by position in the digest,
with the trace's round and attempt beside them, because a retried round repeats
its number. The same trace classifies identically on every run, and every attempt carries a `digestHash` over the
digest the reviewer was shown; `audit.test.ts` pins the copied budgets, rungs and
marker sentences to the app's constants.

**Code builds a per-round digest**: round number, kind and the rule behind it,
tool names and bounded arguments, the page each call put in front of the
assistant, the result head, checkpoint verdict, Notices, tokens, latency, and
how much the assistant reasoned, as a length. A search prints its query, its
streak and whether it rewords the one before it; a Composed Address the app
rewrote into a search prints the search that ran, marked rewritten and with
no streak, and a search whose result a Result Pick opened prints the pick
under it, with the link's label and address, and a landing on a Not-found or
an Unavailable Page prints its mark as a wall does (#294). The lines are
`digestCallLines` in `e2e/live/audit.ts`, which the script sends as they are. A 24-round attempt is tens of
kilobytes; raw traces never enter a prompt.

**A model that is not the measured one judges** what needs judgement, from the
digest plus the same key bundle `live:grade` shows, with no tools: Search Loop
membership, Off-key, the Early Stop and the Answer Omission, and the
per-attempt verdict. It may
overrule a mechanical label with a stated reason, shown in the report, and it
flags every call a careful human might make the other way; flags ship as
caveats and never gate the report. The invocation is `live:grade`'s
(`--strict-mcp-config`, an explicit system prompt, `--tools ''`,
`--no-session-persistence`, `--max-budget-usd 3`) plus `--effort high`; the
default reviewer is `claude-opus-5`. Calls run one at a time, one per attempt,
and each judgement is cached under `e2e/live/artifacts/audit-cache/` keyed by
attempt, digest hash, model, effort and prompt version, so a refused or failed
call never redoes the others and a rerun after a mechanical change asks again
only where the digest changed. A call the model does not answer — a safeguard
refusal, an API error — is retried once and then left without a judgement,
with the reason as a caveat, and nothing is cached for it, so the next run asks
again. `--only=<attemptId>` judges one attempt into the cache and writes no
audit file: a set's audit is only ever written over the whole set.

**The digest quotes no reasoning.** #234 planned a head of the assistant's
reasoning, capped at 1,500 characters, per round. Measured on 2026-09-13:
Opus 5's safeguards refuse a message carrying the measured model's own
reasoning — whole, cut to 300 characters, relabelled, or either half of the
rounds' — with `stop_reason: refusal` and zero output tokens, and the same
prompt without it is answered. A head kept only in the committed file then
tripped the key-text guard on its own: the assistant restating the hunt's
question in its reasoning shares eight words with the key's fact that answers
it. So the digest counts the reasoning and never quotes it, and holds exactly
what the reviewer judged: the calls, pages, results and Notices, which is what
the mechanical labels are read from too. The Run Trace keeps the reasoning for
anyone diagnosing an attempt by hand.

**The Early Stop and the Answer Omission** (#244) are two per-attempt
judgements, each `{ value, reason, checks }`, over the checks the Grade left
unsatisfied (`checksUnsatisfied`; for an ungraded attempt every check, labelled
"ungraded: every check" rather than unsatisfied). For each such check the
reviewer decides one thing only: did it need a page the Run had not read, or
does it follow from material on a page the Run had read, recorded as Evidence
or not? The Grade decides what the Answer established and the reviewer never
re-judges a check.

- `stoppedEarly` — the Run ended with Tool Rounds and time left, and an
  unsatisfied check needed a page the Run had not read. Whether that page was
  findable does not enter: with budget left, not finding it is the stop. An
  attempt that ran to its budget never stopped early.
- `answerOmitted` — an unsatisfied check follows from material on a page the
  Run had read, and the Answer left it unstated, however the attempt ended.

The validator refuses a check id outside `checksUnsatisfied`, an id in both
lists, a list that is empty when its value is true or non-empty when false,
and an empty reason on either.

**The verdict** is from a closed set, primary plus at most one secondary, each
with a stated reason: `rounds_wasted`, `tier_too_small_or_never_escalated`,
`budget_too_small_for_the_hunt`, `stopped_early`, `answer_omitted`,
`failed_rounds`. A `stopped_early` or `answer_omitted` verdict, primary or
secondary, is refused unless its judgement's value is true; the reverse is
legal, since a judgement may be true while the reviewer finds another cause
more decisive. An attempt with one check of each kind takes whichever the
reviewer finds decisive as its primary verdict. No numeric threshold is baked
in: the script reports the shares, the reviewer chooses and cites them. "Budget
too small for the Hunt" is an admissible finding — an audit that can only find
waste is not one.

**Aggregation is arithmetic.** The script counts kinds and verdicts across
attempts and sets, reported as two populations — the initials and the
follow-ups — never pooled; the ranked cause list is the primary verdicts
counted, most counted first. Before counting, the aggregate checks the shared
provenance the cross-pass summary checks (key version and manifest digest,
routing, grades reviewer, study, protocol, mode, adblock, overrides, browser
sub-spans flag, prompt versions) plus the audit's own reviewer model, effort
and prompt version, and refuses sets that differ. Every output says in one
line that it counts and
does not judge.

**Outputs judged before #244** carry reviewer prompt `audit-p1`: the old
verdict set, a single `stoppedEarly { value, reason }` with no checks, and the
unsatisfied checks under the name `checksNotReached` ("checks not reached").
Under `audit-p1` a fact the Answer left unstated from a page already read was
judged stopped early by construction. The three Baseline sets and their
aggregate are re-judged under `audit-p2`; the fix-235 through fix-239 audits are
not, and since the aggregate refuses a differing audit prompt version they
aggregate only among themselves.

**`audit-p4` (#294)** defines a Search Loop as the rule has stood since #289
and #293: a loop ends only when something new is put in front of the
assistant — a page opened, the user's answer to a question, or a Subagent
Report. It names what holds: inspection, a checkpoint or a Run Plan report,
a call that acts on no page, a landing on a Not-found page, an Unavailable
Page or a wall, and a rewritten search. `audit-p3` (#259) told the reviewer
that every successful call that is not a search was an opening, which the
rule stopped saying at #289. The reviewer keeps both freedoms: to say a
marked streak is not one loop, and to extend a loop across an opening that
put nothing before the assistant. Nothing was re-judged for the change. The
Reference is re-judged under `audit-p4` when the next capture is taken, as
`fix-258-259` was for `audit-p3`; until then every committed audit is
`audit-p3` or older, the aggregate refuses an `audit-p4` set with an
`audit-p3` one, and the Fix Ledger marks the reviewer-prompt axis on the
judgement metrics of a row across the two.

**Regenerating an audit.** Outputs are written once, and the prompt version is
bumped by hand (`AUDIT_PROMPT_VERSION` in `scripts/live-audit.ts`) — nothing
re-keys on its own, though the version is part of every cache key, so a bump
asks the reviewer again. To regenerate a set, remove its four files first —
`audit-<setId>.json` and `.md`, and the aggregate's `.json` and `.md` it was
counted in — then run `pnpm live:audit` over the same sets. Over many attempts,
judge one attempt per call with `--only=<attemptId>` to fill the cache, then run
over the whole sets, which reads every judgement from it. Outputs record HEAD as
`auditCommit`, so run the final pass after committing the code it reflects.

### What the outputs hold

Per attempt: a kind per orchestrator round with its reason, the counts and
shares per kind (over the budgeted rounds; Finalization over all rounds), the
Tool Rounds used against the tier's budget, the Finalization Cause, the grade
and the checks unsatisfied (`checksUnsatisfied`; "ungraded: every check" when
the attempt has no grade), the Subagent round count with how each Subagent
stopped, the inherited and walled rounds, the reviewer's verdict with reasons,
its Early Stop and Answer Omission with the checks each names, its Search
Loops, Off-key rounds, overrules and flags, and the provenance of the judgement
(model served, effort, prompt version, digest hash, cost). Per set: the two
populations' tables, whose judgement line counts both `N stopped early` and
`N answer omitted`, and the capture's provenance. The aggregate: the ranked
causes, the populations per set and summed, and the shared provenance.

Each population also counts tool rounds per tool (#235, ADR 0047): for every
tool, the rounds outside Finalization that called it — a round counts once
however many calls it made to that tool, refused calls included — and that
count's share of the population's tool rounds used. It is code-counted from the
Run Trace and never enters the reviewer's digest, so adding it re-keyed no
cached judgement. It is the number a fix to how pages are read is measured by:
the Baseline's scroll rounds were 104 of 340 tool rounds.

Per attempt and per population, two more counts sit beside the rounds (#240,
ADR 0051), code-counted and outside the digest in the same way. **Merged
checkpoints** are accepted Evidence Checkpoints the store merged into an
Observation the Session already held, read from the `merged` field the Run
Trace records on an accepted checkpoint; a trace written before the field
merged none, and the count is a floor, since the merge is exact-text and a
paraphrased re-recording is not one. **Held Page rounds without Progress** are
Acquisition rounds without Progress with a call — never a navigate — on a Held
Page: a page the initial attempt checkpointed, or one this attempt checkpointed
in an earlier round, canonical under the audit's rule. The `inherited` tag is
unchanged and differs from both on purpose.

A third sits beside them (#254): **bundled checkpoint rounds** are Acquisition
rounds, with or without Progress, carrying at least one accepted Evidence
Checkpoint beside the action — the checkpoints that rode the next action rather
than a round of their own. It is the counter the bookkeeping-only Notice is
measured by, code-counted and outside the digest like the others, and it is not
merged checkpoints: those count exact-duplicate re-recordings. An audit written
before it has no such field, and the Fix Ledger reads that as nothing.

A fourth sits beside it (#257, ADR 0054): **same-source unsupported rounds**
are rounds carrying an `excerpt_unsupported` Evidence Checkpoint rejection
whose source — canonical under the audit's rule — the previous or next
round's `excerpt_unsupported` rejection also cites: the retries of one
refused source, which a cluster scores at two or more. It is the counter the
passage-naming refusal and the reference-marker tolerance are measured by
(5 on `fix-253-256`), not the raw rejected count, which keeps the first
refusal of every genuine paraphrase. Code-counted from the trace's verdict
word and outside the digest like the others; an audit written before it has
no such field, and the Fix Ledger reads that as nothing. A refusal that cites
a Subagent counts like any other (#296). An audit written before the round
join kept those records missed them, so the Fix Ledger adds the rounds it
missed, restored from the reason word its rounds keep in the error head: 3 on
`baseline3`'s initials, where the audit wrote 0, and nothing anywhere else.

A fifth pair sits beside it (#272, ADR 0054): **subagent citations** refused
`excerpt_unsupported`, and those **applied with a dropped excerpt** — a kind
"subagent" citation that offered an excerpt, which is dropped and never
checked, so its acceptance carries a Notice. The #272 gate reads both: the
first should stay at zero now that no excerpt is checked on this kind, and the
second shows how often the orchestrator still offers one. They are counted
straight from the trace's `evidence_checkpoint` records by their `agentId`
(the cited Subagent) and `correction`, not from the rounds, which keep no
Notice. Outside the digest like the others; an audit written before the pair
reads "subagent citations not counted".

The round join keeps those records too (#296). It leaves out what a Subagent
wrote itself, and a checkpoint record is never that: only the Run's own
grading writes one, and the `agentId` on it is the Subagent its citation
names. Until #296 the join skipped every record carrying an `agentId`, so the
verdict of a refused citation of a Subagent reached the digest as the
result's error head. Fourteen attempts among the committed audits hold such a
refusal, all the Pi camera's: the initials of `baseline2-3`, `baseline3-3`,
`fix-250-3`, `fix-260-262-3` and `fix-265-267-1`, and the follow-ups of
`fix-235-1`, `fix-236-2`, `fix-237-1`, `fix-242-3`, `fix-242r-3`, `fix-250-3`,
`fix-257-3`, `fix-258-259-1` and `fix-260-262-3`. Their committed audits stay
as written. Auditing one of them again gives a digest with the verdict word in
it, which no cached judgement is keyed on, so the reviewer is asked again for
that attempt; no other attempt's digest moves.

Two more counts ride the same field (#301): subagent citations **refused for
a wall or error source** (`wallSourceRefusals`) — `unknown_source` because
the Subagent reached the address only as a Blocker, a Not-found Page or an
Unavailable Page, which the record says in `sourceUnheld` — and those
**applied under no finding's address** (`offFindingCitations`), an accepted
citation whose `source_url` is a reference of none of that Subagent's kept
findings, which the record says in `citesFinding`. The Run Trace writes both
facts when it writes the record, from the test the grading used and from the
findings the report kept: the trace holds a report only as the text
`agent_results` rendered, cut at 8,000 characters, so nothing read back from
it could say either. A refusal of an address the Subagent never observed is
not the first count. The second is left out where any accepted citation's
record does not say, as in a trace written before the field. Both are absent
on an audit written before them, never zero, and a population sums them over
the attempts that counted them. Reported, never gated: the #301 gate rides
the next capture that spawns, where findings kept with a walled reference
should be 0.

One more sits beside them (#284, ADR 0071): the **accepted records answered
with the contradiction Note**, by round — the Note the checkpoint tool
appended until #284 whenever an earlier Observation shared the record's
address and differed in text. It is read from the whole result text, since
the Note sat past the digest's result head, and only on the Run's own
accepted records. It gives the captures before #284 their number (15, 19 and
30 over `jev-off`, `jev-on` and `fix-281`) and shows every later one's is
zero. Outside the digest like the others; an audit written before it reads
"contradiction Notes not counted".

Two more sit beside them for the Answer (#246, ADR 0028): the **Answers with an
Identity Slip** and the **ids slipped** in them, counted from the Run's own
`identity_slip` Run Trace records — one per Answer whose Card, Spoken
Rendering or listed Asked Items carried an internal id, one entry per id, a
range of ids (`memory-1..6`) one entry as written; a Subagent Report never
passes the display boundary, so it writes none, and the Subagent Announcement
made from one is repaired without a record. An id in an Asked Item's name or
statement is recorded under the surface `asked_item` from Run Trace version 8
(#300) and counts in the same two numbers; a trace below version 8 wrote none,
so the seven Answers the retained captures hold with an id in a statement are
not in their audits' counts, and no audit is recounted. Neither number enters
the digest or bears on a verdict. A trace
written below Run Trace version 2 predates the record, so its attempt reads
"not recorded" rather than zero (`identitySlips: null`); a population says how
many of its attempts were not recorded and counts only the rest, and reads
"Identity Slips not recorded" when none was.

The **Answer Checkpoints** (#288, ADR 0072) sit beside them too, and two
counters read them. **Bookkeeping rounds right before the Answer** is, per
attempt, the unbroken run of rounds that ends at the Answer and whose kind is
Bookkeeping after the reviewer's overrules: the rounds an Answer carrying its
own checkpoints has no reason to spend. The Answer is the attempt's last
round when that round is a Finalization round that made no call; the
bookkeeping round Finalization grants is a Finalization round and is never
counted. It rides the attempt beside `countsAfterOverrules`
(`bookkeepingBeforeAnswer`, the rounds by number), because it reads the same
overrules. **Bookkeeping rounds right before the cut** (#295) is the run that
counter cannot see, because another round stands between it and the Answer:
the unbroken run of Bookkeeping rounds, by the same overrules, that ends at
the round the active-work deadline cut, when every round after that one is a
Finalization round; or, where the deadline cut none, at the end of rounds
that never entered Finalization. Rounds the deadline cut one after another
are one cut. A Run that recorded, began its next round and lost that round
to the deadline has its recording counted here, with the reserved Answer
after it or without. A deadline-cut round the Run worked on after is no cut,
and a round ended any other way is retried and is none either; rounds that
end on a Finalization round and hold no deadline-cut round count nothing.
The trace does not say what the cut round would have been, so the counter
says what was spent recording as the deadline arrived and never that an
Answer was next. It is a counter of its own (`bookkeepingBeforeCut`): the
first stays as written, with the table #288's gate was set from, and a round
the first counts is left out of this one, so none is counted by both.
Reported, never gated. **Answer Checkpoints** counts, from the `answer_checkpoints`
record each Answer that carried the field leaves, the Answers that carried
any, the entries offered, accepted and dropped, and the dropped by reason —
the reason the entry's tool refuses a call for, `over_cap` for an entry past
the sixth, `malformed` for one of neither kind, and `not_a_list` for a field
that was not a list, counted as one entry offered and dropped. An entry belongs to no call:
its `evidence_checkpoint` record says `origin: answer` and joins no round, so
no round's kind or checkpoint count moves and the digest does not move. A
trace written below Run Trace version 6 predates the record and reads "not
recorded" (`answerCheckpoints: null`); an audit written before a counter
reads "not counted" for it, and the Fix Ledger recounts both bookkeeping
counters for such an audit from its rounds and its review.

The **Asked Items** (#250, ADR 0052) sit beside the rounds on the same terms:
`declared` is what the attempt's last model Run Plan carried in `asked_items`,
`stated` and `unverified` count the standings the final Answer's display event
carried, and `shapeFailures` counts the `asked_items_shape` records — Answers
whose list was not the declared one — with `shapeRetried` the ones the Answer
Retry was spent on. A retried record written since #311 also says whether the
retry asked for the list alone (`listOnly`); how the round that carried it
resolved is its `answer_retry` record. Neither is counted. Each population
counts the attempts that declared any and the attempts whose Answer carried an
`unverified` standing. A trace written
before the field reads "not recorded", and the digest does not move.

Two more sit beside those, for an Answer the runtime could not read (#245),
read from the records and never from Answer text. **Malformed Answers** are
the attempt turn's `malformed_answer` records,
the Run's and its Subagents': a reply outside a reserved round that carried the
Answer contract's keys but not its shape. **Retried** counts its `answer_retry`
records, one per Answer Retry whose round resolved. A malformed round keeps its
class and reason, and the digest does not move. A trace written before the
records existed counts none, and the Baseline audits read zero for that reason
alone: baseline-1's Eurostar initial replied with a Malformed Answer in its
round 7, before the record, and re-parsing old Answer text to count it would be
the audit replaying a decision the Run never recorded (ADR 0049). The set's
caveats name that occurrence instead, from `PRE_RECORD_MALFORMED_ANSWERS`.

**Off-language Answers** (#286, ADR 0034) count the Answers whose Card or
Spoken Rendering had more than half of its letters outside Latin script, by
the app's own function (`offLanguageRenderings`). The Answers the app refused
are the Run's own `off_language_answer` records, each with its round, the
renderings that failed and their shares, whether the Answer Retry was spent,
and the cause the deterministic Answer used. An Answer a Run rendered is
judged from the Card and the Spoken Rendering that followed it, which only a
Run older than the rule can fail, so one count reads both and asks no trace
version. That is unlike the Malformed Answer above, which is never re-parsed
from text: this rule is a function of the rendering alone, so judging old
text replays nothing the Run decided. The deterministic Answer and a Subagent's replies are not judged. An
`answer_retry` record whose reply was an Off-language Answer has the outcome
`off_language`. The count sits beside the rounds and does not move the digest.
An audit written before the counter has no field for it and prints "not
counted". A committed audit keeps no Answer text, so the Fix Ledger recounts
such an audit from `PRE_RULE_OFF_LANGUAGE_ANSWERS`, the Answers the same
function finds over the captures themselves: one, the Voyager initial of
`fix-283-3`, in 371 attempts on disk on 2026-09-28. It is reported, never
gated.

**Window opens** (#299, ADR 0073) count the opens a page made, by what
became of each. **Followed** is the round of every click whose outcome
carries `the link asked for a new window; opened here`: a New-window Link the
pane navigated to. **Denied** is the round of every open reported as `popup
blocked:`, one entry an open, so a click that opened two windows counts its
round twice. Both are read from the full result text, since a report can sit
past the digest's head, and only from where the app prints its reports: the
first line of an outcome, and the lines under a Page Read. A page whose own
text says `popup blocked:` is not counted, unless that text is the last of
the page and a Page Read printed a report under it. An `auth popup opened:`
line is neither. The user's own click is reported to nobody and is not in
the trace. The count sits beside the rounds and does not move the digest. An
audit written before the counter has no field for it and prints "not
counted"; its denied opens can be recounted from its traces, and a followed
one cannot exist in it. It is reported, never gated: on 2026-09-28 the traces
held 28 denied opens in 294 run directories, and one in the 99 since
`fix-270`.

Two more count the Finalization bookkeeping round (#256, ADR 0056).
**Skipped bookkeeping rounds** are the Run's own `finalization_entry` records
whose `bookkeeping` is `skipped`: Finalization entries that went straight to
the reserved Answer because nothing was acquired with Progress and no Subagent
Report collected since the last accepted Evidence Checkpoint. A Run Trace below
version 3 could not record one, so its attempt reads "not recorded" and a
population says how many of its attempts did. **Rounds cut by the Finalization
Allowance** are the Finalization rounds whose outcome is `allowance`, read off
the rounds, so every audit has them. Neither moves the digest. Since ADR 0057
a cut round's `llm_round` record says whether it had streamed (`firstTokenMs`),
so the audit splits the cut rounds into **cut after a first token**, **cut
silent**, and **not recorded** — a Run Trace below version 4 — and reports the
**first-token latency** at the median and ninetieth percentile over each
population's rounds that streamed, with every round's latency listed beside
the attempt's rounds. The Fix Ledger reads all of them. None of these moves
the digest either.

**The rounds that wrote an Answer** (#321, ADR 0075) are marked beside the
rounds, by round number: the one whose Answer was taken, the ones whose
Answer was sent back, and the Answer Retries. They are read from the
records the Run wrote after each round (`answer_retry`, `malformed_answer`,
`off_language_answer`, `asked_items_shape`, `early_card`) and from whether
the Answer shown was a model's. A round's kind does not move: a first
Answer that was sent back is still a failed round, and its retry is still
Finalization. With the marks the audit reports **reasoning by kind of
round**: the reasoning characters, output tokens and seconds of the
bookkeeping-only rounds (the rounds of kind Bookkeeping) and of the rounds
that wrote an Answer, per attempt and, in a section of its own, per
population with a mean over the Runs. An audit written before the marks
prints "not counted" and has no such section. Reported, never gated, and
outside the digest.

They name check ids and URLs only, never key text: the reviewer is told to
refer to checks by id, every output is checked for any key string or any run of
eight consecutive words of one before it is written, and `audit.test.ts`
asserts the same over the committed files. Nothing under `e2e/live/private/`
appears in them — the grades are read for check ids and reviewer names only.
A Run that finds a required fact checkpoints it in the key's own words, so
before that check a call argument, result head or search query that restates
key text is replaced by `[withheld: restates Grading Key text]`, and the set's
caveats say how many (#235). Only the written output changes; the digest the
reviewer judged, and its cache key, do not.

The audit fixes nothing. Each fix it motivates is its own issue with its own
three-pass capture on the frozen route, so the change stays attributable, and
the audit is re-run over the new sets and diffed.

## The Fix Ledger

Since the Round Audit, every fix issue was judged by hand: open
`audit-aggregate-fix-N.md` and its predecessor's, find the metric the fix
aimed at, read both numbers, and remember which sets were judged under
`audit-p1`. The **Fix Ledger** (#251; glossary: Fix Ledger, Reference,
Subject) is the one page that reads them:

```sh
pnpm live:ledger [--reports=<dir>] [--port N] [--no-open]
```

It is a loopback-only `node:http` server beside `live:review` and `trace:ui`,
never an app view and reachable from nothing the app bundles. It serves one
page from `scripts/live-ledger.html`; the decisions are in `e2e/live/ledger.ts`
(pure, under vitest) and the door in `e2e/live/ledgerServer.ts`. It writes
nothing.

**What it reads.** Round Audit JSON only: every `audit-*.json` in
`e2e/live/reports` (or the `--reports` directory; one directory, never merged
across two), on page load — a browser reload re-reads, there is no watcher.
Pass reports, cross-pass summaries, pilots, preflights, Grades and captures are
out: every number the fix issues cited is in the audit's per-attempt
`mechanical` record or its populations. Files are grouped into **families** by
stripping the Pass suffix from the set id in the provenance (`fix-240-1..3` →
`fix-240`; `fix-242` and `fix-242r` are two families; the first Baseline's
aggregate, `audit-aggregate.json`, joins `baseline` by its set ids), ordered
by the earliest `provenance.createdAt`. A family is a **Baseline** when its id
begins with `baseline` — provenance carries nothing that says so, and this
convention is the ledger's one assumption. A file that is not a Round Audit,
a second audit for a set already read, or an aggregate over more than one
family is listed as ignored with its reason, never silently dropped.

**The Reference rule.** By default a Subject's Reference is the most recent
Baseline captured before it; a Baseline's Reference is the Baseline before it;
the first Baseline has none. Any family may be chosen as Reference on the
page, or none. Choosing never joins the two into one Baseline — the cross-pass
summary and the aggregate audit still refuse a mixed set; the ledger compares
across one and says so with a marker.

**The headline**, per population with initial first and follow-up beside it,
each metric with the direction that is better so its delta knows its colour:
verified attempts (Grade status `pass`; higher), under them the second
reading of #287 (verified, or failing only on unasked facts; no direction and
no colour, see below), checks satisfied as
`n / total` (higher), `rounds_wasted` primary verdicts (lower),
`answer_omitted` primary verdicts (lower), Off-key rounds (lower), failed
rounds (lower), attempts at budget (lower), median run duration in seconds
(lower). Where a per-round denominator exists (Off-key, failed rounds) the
count is shown with its share of the budgeted rounds — the audit's own
denominator — and the delta and its colour follow the share, in points.
Verified and checks use their own denominators (attempts read, total checks);
the verdict counts and attempts at budget compare on the count. The family's
whole-set value is the aggregate audit's when one exists (the number its
Markdown prints), summed from the Passes with a note when none does; verified
attempts, checks and run durations are always read from the per-Pass attempts,
since the aggregate does not carry them, and the median is the summary's. The
per-Pass values sit small beside the whole-set one; a missing or
`measurement_failed` Pass shows as such, never as a number. Every other
counter of the population sits in the all-counters expander with a raw delta
and no colour, a per-round counter (the kind counts, Search Loop, Off-key)
with its share of the budgeted rounds beside the count — useful partials and help-blocked attempts included, never in
the headline. A counter an older audit did not record reads as nothing, not
zero; an audit judged under `audit-p1` has no `answer_omitted` verdict and
carries its unsatisfied checks as `checksNotReached`, and the ledger reads
both names. One exception (#259, ADR 0058): the two search-streak counters
of an audit that predates them are recounted from its rounds under the
rail's current rule, because the rule changed and a nothing there would
leave a Subject with no like-for-like Reference. The same holds since #289
for an audit whose attempts do not say they were counted by the rail's
current rule, which is every audit committed before it: the two counters,
and `Search Loop rounds by the streak rule` with them, are recounted with
the streak held across a checkpoint tool, and the files stay as written.
Over the audits from `fix-258-259` on, four attempts moved, each by one round
at streak 2 or beyond. Since #293 the recount is by rule 3, which takes the
Composed Address rewrites out of the streak and holds it across a Blocker
landing and a call that acts on no page: from each call's name, `wall` and
`rewritten` stamp, never its arguments, which an audit keeps cut, so the
Search URL names #293 added are not recounted. On initials the `fix-284`
Reference reads 14 and 5 where its aggregate wrote 15 and 5, `fix-288-290`
17 and 7 where it wrote 22 and 8, and `fix-291` 11 and 6 where it wrote 14
and 7. `Unavailable landings followed by a search` is recounted with them
since #294, its wait reading the same rule: `fix-258-259` reads 2 on
initials where the older wait gave 1, pass 3's landing having three
checkpoints between it and the search, and no audit that wrote the counter
moves. And since #288 for `Bookkeeping rounds
right before the Answer`: an audit written before the counter is recounted
from its rounds and its reviews' overrules, with no trace and no reviewer.
Over `fix-270`, `jev-off`, `jev-on`, `fix-281`, `fix-284` and `fix-283` that
reads 103 on initials (13, 16, 18, 19, 20 and 17) and 91 on follow-ups (13,
18, 15, 15, 16 and 14), the table the gate of ADR 0072 was set from. It is a
judgement counter, since an overrule moves it. The Answer Checkpoint
counters are not recounted: no trace before version 6 says what an Answer
carried, so they read as nothing there.

`Reasoning characters per Run in bookkeeping-only rounds` and `Reasoning
characters per Run in rounds that wrote an Answer` (#321) are means over the
Runs, summed from each attempt's rounds. An audit that marked its Answer
rounds is read by its marks. One written before them is recounted from the
shape of its rounds, with no trace and no reviewer: a round that completed
with no call and was not the Run's last was sent back, the last attempt of
the round after it is the Answer Retry, and a last round that completed
with no call wrote the Answer taken. `main-4dc72e9` reads 7,504 and 4,511
on initials and 2,558 and 9,354 on follow-ups. Neither line is gated here;
#314's capture gates on their sum.

The counters #263 and #264 were gated on sit in the expander beside the
Unavailable Landing rows (#297): `Consent dismissals`, `Hand consent clicks`,
`Blocked Actions` and `Vision rounds after a Blocked Action`, read from the
population's `consentWalls` and `blockedOrInert` as the audit wrote them.
`Blocked Actions` is one count of every kind: Covered, Not Shown, and those
under the pre-#264 head. Lower is better for each; none is a headline metric
and none is gated. None is recounted, so an audit written before them reads
as nothing: every set before `fix-260-262` on all four, and `fix-260-262`,
audited before #264, on the vision rounds. A family summed from such Passes
holds a zero there that nobody counted, and one summed from both kinds a
part of the count; the ledger takes neither.
On initials `fix-263-264` against `fix-260-262` reads hand consent clicks 3
to 0 and Blocked Actions 4 to 1.

**The markers**, per metric, never a refusal. Judgement metrics (the verdicts,
Off-key, and in the expander Search Loop, Early Stop, Answer Omission,
overrules, flags) are marked when `reviewerPromptVersion` differs between
Reference and Subject. Every metric is marked when `keyVersion`,
`gradesReviewers`, `roles` or the browser sub-spans flag differs (an audit
written before #247 reads as captured with the flag off). The app commit never
marks — it is what a Subject is measured for. A marker names the axis and both
values; the row also says once, above the table, what differs. So `fix-239`
against `baseline` marks the judgement metrics only (`audit-p1` against
`audit-p2`), `baseline2` against `baseline` marks every metric for the
sub-spans flag, and `fix-240` against `baseline` marks nothing.

**The drill-down**, one level: a Hunt × step table of the headline metrics
across the Passes of both sets, Reference Passes above Subject Passes, a yes/no
per attempt where the metric is one. The Tool Round timeline stays where it
is, in the Markdown audit, which each row links by name. No hand-maintained
set → issue → metric file exists: what a set was captured for is on its issue.

### Facts the command did not ask

Decided on #287, grilled 2026-09-28 from the `fix-283` and `fix-284` traces.
A key may require a fact its command never asks for (glossary: Unasked
Fact). The Eurostar command asks for "the smallest reduction", and its key
also requires that removing the guitar would work (`fact-07`) and that the
suitcases are within the length limit (`fact-03`). Of the 32 Eurostar initials with any
missed fact across the graded sets on disk, 19 failed on those two alone, and
every such Run had stated every Asked Item it declared.

Neither the key nor the product changes for it. A key is not revised after its
Answers have been read, and an assistant that lists alternatives nobody asked
for is tuned to the corpus. What changes is that the audit aggregate and the
ledger's headline report a second reading beside verified attempts:
**verified, or failing only on unasked facts** — the attempts verified, plus
those not verified whose unsatisfied checks are all on a list of unasked
checks. It is reported, never gated, and never replaces the verified count.

The list lives in its own module, `e2e/live/unaskedFacts.ts`, outside
`keys.ts`: the key's digest is over its content, so a mark inside the key
would make every existing grade stale. It holds check ids and a reason each,
no check wording, and starts with `fact-03` and `fact-07` of the Eurostar
initial. A check joins it only when the command's text does not ask for it.
It imports nothing and nothing on the capture path loads it; `corpus.test.ts`
pins both, and that every id on it is a check the key manifest declares for
that Hunt and step.

**The rule**, per attempt, from its Grade status and its `checksUnsatisfied`:
verified when the status is `pass`; failing only on unasked facts when it is
not, the unsatisfied checks are not empty, and every one of them is on the
list for that attempt's Hunt and step. An attempt with no Grade or a pending
one, and an attempt of an audit written before `checksUnsatisfied`, is **not
recorded**: it counts on neither side and leaves the denominator, so a
reading is `n of the attempts recorded` with the not recorded said beside it,
never a zero; so is a graded attempt in a slot the key has no task for.
`fix-235`, `fix-236`, `fix-237` and `fix-239` were judged under
`audit-p1`, which kept the list under the name `checksNotReached`; they read
as not recorded, their verified attempts included, so a family reads whole or
not at all. The `Checks satisfied` metric still reads both names.

**Where it shows.** The Round Audit writes it per population as
`verifiedOrUnasked { verified, failingOnlyOnUnasked, notRecorded }`, in the
pooled populations of an aggregate and in each set's under `perSet`, and
prints a section of its own before the tool rounds: a row per population and,
in an aggregate, a row per set under it, with the Unasked Facts named by
check id.
An attempt's own section says which of the four it is. The Fix Ledger shows
it in the headline right under verified attempts, with the per-Pass values
and the Hunt × step drill-down the other headline metrics have. It is the one
headline metric with no direction: its delta is printed and never coloured,
and no gate may be set on it. `n/r` on the page is an attempt or a Pass not
recorded. The ledger reads it from the per-Pass attempts, as it reads the
verified count, so it needs no aggregate to have been restated.

**Past captures** gained it with no capture and no reviewer spend:

```sh
pnpm live:unasked [--reports=<dir>] [--dry-run]
```

restates every aggregate audit in the directory from the per-Pass audits
beside it. It restates rather than rebuilds: a whole rebuild of an aggregate
written by an older audit adds every counter introduced since as a zero
nobody counted and re-words its Markdown, so the command adds the one field
to each population and the one section to the Markdown and leaves every other
byte as written — taking the reading out of a restated file gives back the
file as it was, for all 28 committed aggregates. It refuses, writing nothing,
when an aggregate names a Pass with no audit beside it. Run it again when the
list changes; an aggregate `pnpm live:audit` writes carries the reading
already. The per-Pass audit files are read and never rewritten. The pass
reports carry no per-check results, which is why `live:summary` does not
print it.

On initials, from the committed audits:

| Capture | Verified | Failing only on unasked facts | Second reading |
| --- | --- | --- | --- |
| baseline | 0/12 | 1 | 1/12 |
| fix-240 | 2/12 | 0 | 2/12 |
| fix-242 | 2/12 | 1 | 3/12 |
| fix-242r | 5/12 | 1 | 6/12 |
| baseline2 | 4/12 | 2 | 6/12 |
| fix-250 | 4/12 | 0 | 4/12 |
| fix-252 | 4/12 | 0 | 4/12 |
| fix-253-256 | 7/12 | 0 | 7/12 |
| fix-256r | 4/12 | 2 | 6/12 |
| fix-256r2 | 2/12 | 2 | 4/12 |
| fix-257 | 4/12 | 1 | 5/12 |
| fix-258-259 | 6/12 | 0 | 6/12 |
| fix-260-262 | 1/12 | 2 | 3/12 |
| fix-263-264 | 6/12 | 1 | 7/12 |
| baseline3 | 3/12 | 2 | 5/12 |
| fix-265-267 | 14/20 | 1 | 15/20 |
| fix-270 | 9/12 | 1 | 10/12 |
| jev-off | 9/12 | 0 | 9/12 |
| jev-on | 9/12 | 1 | 10/12 |
| fix-281 | 8/12 | 1 | 9/12 |
| fix-284 | 8/12 | 3 | 11/12 |
| fix-283 | 9/12 | 1 | 10/12 |
| fix-288-290 | 8/12 | 0 | 8/12 |

No follow-up fails only on unasked facts: the list names no follow-up check.

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
pnpm exec vitest run e2e/live/grades.test.ts e2e/live/report.test.ts e2e/live/summary.test.ts e2e/live/audit.test.ts e2e/live/gradingBench.test.ts e2e/live/gradingSetup.test.ts e2e/live/gradingBenchServer.test.ts e2e/live/gradingBenchPage.test.ts e2e/live/ledger.test.ts e2e/live/ledgerServer.test.ts e2e/live/ledgerPage.test.ts e2e/live/corpus.test.ts e2e/live/unasked.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

The suites run under the ordinary unit run — they spend nothing and launch
nothing. `report.test.ts` invokes `scripts/live-report.ts` as a real Node
subprocess, which is what catches an accidental Electron import or an
extensionless runtime import on the CLI's graph; `summary.test.ts` does the
same for `scripts/live-summary.ts`, over three hand-built version-2 reports.
`audit.test.ts` classifies a fixture trace that holds every kind, asserts the
classification is byte-identical across two runs, validates and refuses
reviewer outputs against the digest, checks the key-leak guard, and reads every
committed `audit-*` file against the real keys; it loads `scripts/live-audit.ts`
under Node too, on a usage error, so the paid path is never run by a test.

`gradingSetup.test.ts` covers the setup page's decisions as functions:
- discovery and preselection, of sets and of another reviewer's grades file;
- resume-by-content and the slug;
- the refusals.

`gradingBenchServer.test.ts` works on a real loopback socket:
- it serves a fixture set, saves Grades through it, and checks the file it
  wrote against `scripts/live-report.ts`, run the same way;
- it drives one setup→Start round trip against a fixture pair of roots, with
  another reviewer's Grade chosen for comparison;
- it switches sets without restarting — setup → Start → change set → Start on a
  second fixture set with the same attempt ids — and checks the first set's
  files are untouched, the reviewer stays fixed, a page left on the old set is
  refused, and the draft is back on re-entry;
- it starts `scripts/live-review.ts` itself.

`gradingBenchPage.test.ts` drives both pages in a real headless Chrome over the
DevTools protocol, against the same fixture set (#232). It is skipped, not
failed, where no Chrome or no global `WebSocket` is found; set `CHROME_PATH` to
point it at one. It walks:
- setup lists the sets, greys out the rehearsal, proposes the set and the
  comparison, and Start lands on the bench's first pending slot;
- the bench opens on the Answer tab, and the three tabs switch;
- a blank slot shows the work left, not an error;
- a judged check lands in the drafts sidecar;
- a refused save shows the validator's words, and writes nothing;
- the other Grade appears only after a save, disagreements first.

What it does not walk is still checked by hand after changing
`scripts/live-review-setup.html` or `scripts/live-review.html`, in a real
browser; headless Chrome over CDP will do.
1. On the setup page, check the listed sets and the proposed one.
2. Check the greyed-out rows and their reasons.
3. Check that the grades file follows the reviewer field.
4. Check that a set picked by hand stays picked.
5. Check the comparisons offered for the chosen set: each labelled by its
   reviewer, the proposed one, "none", and that the choice follows a change of
   set.
6. Press Start.
7. At the bench, walk a draft, a reload and a save; with a comparison chosen,
   the other Grade appears only after the save.
8. Change a draft and follow **change set** straight away. Back on the setup
   page, check that the reviewer is read-only and the set shows the draft.
9. Start another set, follow change set again, re-enter the first set, and
   check that the draft is restored.

`ledger.test.ts` reads the committed Round Audits — the families #251 names
in capture order with their References, `fix-240` against `baseline` with the
numbers the two aggregate audits print, the three marker cases — and fixtures
cut from them for a family with no aggregate, a Pass the aggregate names but
no file holds, a chosen Reference, each marker axis alone, and a file that is
not an audit. `ledgerServer.test.ts` works the door on a real socket (listing,
rows, the loopback and file-name refusals) and starts `scripts/live-ledger.ts`
itself. `ledgerPage.test.ts` drives the page in headless Chrome over CDP, over
the committed audits, and is skipped where no Chrome is found: the families
and their default Reference, one delta cell with its colour, one marker with
its axis, the drill-down for one Hunt, and a Reference chosen on the page.
