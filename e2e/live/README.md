# Live-web capture (#224)

The single-hunt capture foundation for the live-web performance baseline
([#223](https://github.com/jbsx/bingbong/issues/223)). One launch of the
real app in a fresh benchmark Browser Profile, one command at a time
through the real Prompt Bar, and a durable local record of what the app
itself published about each. The scheduler (#225) builds a four-hunt
protocol on the handle; the grader/reporter (#226) reads the files.
Neither needs to edit anything here.

## Modules

| File | Loads under | What it owns |
| --- | --- | --- |
| `types.ts` | plain Node (type-only src imports) | The contract: `LiveCaptureSet`, `LiveScheduledAttempt`, `LiveSessionCapture`, `LiveAttemptCapture`, `LiveNotReachedAttempt`, `LiveArtifactReference`, `LiveLaunchProvenance`, `LiveMetrics`, `Observed<T>`. |
| `artifacts.ts` | plain Node | Roots (`LIVE_ARTIFACTS_ROOT`, `LIVE_PRIVATE_ROOT`), `claimCaptureDir`, `writeSessionCapture`, `writeCaptureSet`, `readSessionCapture`, `readCaptureSet`, `validateSessionCapture`, `validateCaptureSet`, `verifyArtifacts`, `archiveLogsDir`, `parseJsonl`, `redactText`, `digestOf`, `promptIdentity`. |
| `metrics.ts` | plain Node | `extractLiveMetrics(input)`, plus the selections it is built from: `finalAnswerDisplay`, `waitIntervals`, `roleUsage`, `spanAggregates`. |
| `profile.ts` | vitest / e2e | `createBenchmarkProfile` — the fresh userData seed. |
| `launch.ts` | vitest / e2e | `composeMeasuredLaunch`, `composeVerificationLaunch`, `loadEnvFile`, `gitProvenance`, `SCRIPTED_SERVING_HOOKS`, `TEST_ONLY_OVERRIDES`. |
| `capture.ts` | e2e (launches Electron) | `startCaptureSession(options) → CaptureSession { captureCommand, continuationState, close }`. |

`*.test.ts` are launch-free unit tests in the normal `pnpm test` config;
`capture.e2e.test.ts` runs under `pnpm test:e2e e2e/live/capture.e2e.test.ts`
(Xvfb, scripted model, local fixture pages — never baseline evidence).
No paid entry point lives here; #225 adds it.

## Lifecycle

```ts
const session = await startCaptureSession({
  mode: 'measured' | 'verification',
  captureId, huntId, setId?,               // identity — a captureId is never reused
  root?,                                   // default e2e/live/artifacts
  profile?: { settings: 'defaults' | {...} },
  verification?: { env, fixture? },        // required in verification mode
  bounds?: { acceptanceMs, attemptMs, drainMs, abortMs },
})
try {
  const initial = await session.captureCommand({ attemptId, stepId, order, relation: 'initial', text, prompt })
  const state = await session.continuationState()   // bounded; never waits
  if (state.ready) await session.captureCommand({ ..., relation: 'revised_objective', parentAttemptId })
} finally {
  await session.close()                              // archive → quit → archive → verify → remove profile
}
```

- `startCaptureSession` claims the capture directory (refusing an existing
  identity), seeds the profile, composes the launch, writes `capture.json`
  with `closeState: 'open'`, launches, and installs the event tape in the
  dashboard. It submits nothing: the first accepted command creates the
  application Session.
- `captureCommand` submits exactly one command and never retries, steers,
  answers an Ask or approves a confirmation. It returns an attempt record
  even when the app fails (`stop.reason` says how); it throws only on a
  protocol error — a concurrent call, a reused `attemptId`, a closed
  session. For any attempt after the first it checks
  `continuationState()` first and returns a `not_reached` record without
  submitting when the Session cannot take it.
- A **fresh hunt is a new `startCaptureSession`**: a new userData
  directory from the same seed recipe, so cookies, local storage and
  Session evidence cannot carry over. A **follow-up is the same handle**:
  same app process, same profile, same Session.
- `continuationState()` is a bounded read of the current state, in this
  order: unresolved ask/confirmation (`awaiting_help`), an observation in
  flight or an unsettled initial submit or a steering verb (`run_active`),
  a not-reached or unaccepted previous attempt, no live Session
  (`session_unavailable`), a live Session that is not the accepted one
  (`session_lost`, which is also what a model-requested reset replay
  reads as — the replacement Session is never used). It does not gate on
  correctness, on the Run Resolution, or on an ask that already timed out
  and let the Run finish.

## Observation boundaries

| Field | Source | Meaning |
| --- | --- | --- |
| `accepted` | the app's `command` event after the attempt's tape cursor, with `runId`/`sessionId`/`sessionGeneration`/`submissionId`/`turnId` | Pipeline acceptance. The Prompt Bar's form having submitted is **not** acceptance; a busy rejection is recorded as `stop.reason: 'rejected'`. |
| `finalAnswer` | the one `display` event the pipeline stamped `finalAnswer: true` (model Answer or deterministic fallback) | Final Answer availability at the **event publication** stamp. Not renderer paint, not audible onset. Earlier displays, streams and speak lines are never candidates; two marks are `invalid`. |
| `terminal` | the `done` event | Full Run boundary: outcome, the model-proposed `resolution` (never Task Success), Finalization Cause. |
| `settlement` | the Prompt Bar form's `aria-busy` clearing | The submit IPC settled — the runner unwound, failure screenshot included. Evaluator clock (ISO). |
| `metrics.answerLatencyMs` | `finalAnswer.at − accepted.at` | The primary recorded latency. |
| `metrics.runDurationMs` | `terminal.at − accepted.at` | Kept separately; never substituted for the Answer. |
| `metrics.userWaitMs` | resolved ask/confirmation intervals | `observed 0` when the Run never waited; `unavailable` while one is open. |
| `metrics.speech` | perf `tts-synthesis` / `tts-playback` spans | Voice-input latency is `not_applicable` for typed capture, never zero. |

All `at` values are the app process's `Date.now()` (epoch ms); ISO
strings are the evaluator process clock. Same machine, two clocks —
they are never subtracted from each other.

The Feed's assistant card carries `data-event-at` with the same stamp,
so the user-visible Answer can be correlated with the event; the e2e
suite verifies the marked card is visible before a delayed `done` using
a fake piper binary as the deterministic delay.

## Missing is never zero

Every fallible figure is an `Observed<T>`:

```
{ status: 'observed', value }              // zero included
{ status: 'unavailable', reason }          // the source never produced one
{ status: 'invalid', reason }              // produced, refused (e.g. a terminal before the command)
{ status: 'not_applicable', reason }       // the question does not arise
```

Usage comes from raw `llm_round` records per role (`rounds`,
`roundsWithUsage`, `complete`), never from the daily ledger; vision usage
is always `unavailable` because vision records carry request duration
and no tokens (`metrics.vision` has the durations). `metrics.spans`
gives per-stage perf `count`/`totalMs`/`unionMs` within one launch
clock; totals are not additive across stages.

## On disk

```
e2e/live/artifacts/<captureId>/
  capture.json          LiveSessionCapture (validated by readSessionCapture)
  events/<attemptId>.json   the attempt's PipelineEvent tape
  logs/run-trace-*.jsonl    copied whole valid lines; torn tail dropped and flagged
  logs/run-trace-*.png      failure screenshots
  logs/perf-*.jsonl, logs/host-trace-*.jsonl
  usage.json            the daily ledger, provenance only
  stderr.txt            bounded app stderr
e2e/live/private/       evaluator-only inputs (#225 keys) — never read by a capture
```

Both roots are ignored by Git. Archiving copies only the named diagnostic
families, never recursively, never `settings.json`, cookies or storage;
known secret values (every `*_API_KEY`/`*_TOKEN`/`*_SECRET` value in the
launched env) and credential-bearing URL shapes are redacted before any
byte lands. An archive that cannot be completed keeps the profile
directory and says so in `retention`.

## Measured vs verification

`composeMeasuredLaunch` resolves the developer's production routing the
way the app does (env file under process env), pins it explicitly,
points the app at the same env file, and refuses an env file that
carries any scripted hook or test-only override (the app would read it
past any unset). `BINGBONG_LLM_SCRIPT`, `BINGBONG_SUBAGENT_LLM_SCRIPT`,
both vision hooks, the STT/VAD/wake scripts, and every
`BINGBONG_*_MS`/`BINGBONG_CONTINUITY_BUDGETS` override are unset; wake
monitoring is off (recorded); Run and Host traces are on; downloads go to
the profile-owned directory; the access guard is on. The harness's
`productionDefaults` branch sends nothing else — no fixture adblock
list, no empty vision scripts, no nonexistent env file — and starts no
fixture server. The adblocker reads the process env at boot, so its
provenance is read from there and env-file overrides are not promoted.

`composeVerificationLaunch` rides the ordinary hermetic harness template,
requires a scripted orchestrator, and refuses any real routing key.

## The evaluator-material boundary

What the guard closes: `file:` loads on the browse partition (main pane,
Subagent tabs, auth popups, redirects, clicks), when
`BINGBONG_MEASUREMENT_ACCESS_GUARD=1`. That is the route by which a
private key file, a capture, or `/proc/self/environ` on the same machine
could reach the measured assistant. Production is unchanged with the
flag unset — the e2e canary proves the same file loads without it.
Measured launches start no evaluator-local HTTP service; the only
loopback listener is the CDP debug port, which serves no evaluator
material; `download_url` is HTTP(S)-only into the profile-owned
downloads directory.

What it cannot close: public mirrors of the answer material and the
model's prior knowledge. Those cannot be made secret; the study flags
observed contamination rather than grading it as discovery.

## Diagnostic limits

- Run Trace `tool_result` text is cut at the trace's own limit (page
  reads exempt); `metrics.coverage.truncatedToolResults` counts them.
- Trace files roll at 5 MB and purge after 7 days; the capture archives
  before close, so a purge cannot erase a hunt's records.
- A Subagent's stop can land after `done`; the drain waits for settlement,
  not for every Subagent.
- Perf `llm`/`subagent-llm` spans include client retries; `llm-retry` is
  a zero-length marker, excluded from `spans`.
