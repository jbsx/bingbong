# Run Trace stays out of Recorded History

> **Superseded by [ADR 0031](0031-diagnostics-are-opt-in-traces.md).** The
> decision here — a Run's diagnostic records live in their own file family,
> never in the history store — stands. Its premise does not: Recorded History
> is being retired (#188), the file family is now `run-trace-*.jsonl` behind
> `BINGBONG_RUN_TRACE`, and the per-kind opt-in described below
> (`BINGBONG_TRACE_REASONING`) is gone — every kind rides the one flag. Read
> 0031 for the current rules.

Recorded History keeps a Run's *display* line for a `record_evidence` call and,
on failure, the error text the model saw. The raw arguments, the ledger record
the citation was graded against, and every successful checkpoint leave no trace
at all. #179 was diagnosed by re-running scenarios and reading tool results off
the wire, because a rejected or vanished checkpoint could not be diagnosed from
disk. The obvious fix — widen the history record — is the one we rejected.

The Run Trace is a separate, durable, machine-readable record of a Run's
internal decisions, written to `trace-*.jsonl` beside the perf logs, never into
Recorded History's database.

- **Diagnostics must not be recoverable from Recorded History.** Session
  Evidence disappears at Lapse and at Session Reset, and Recorded History is
  the one durable store a user can open. A checkpoint's raw arguments and the
  observation payload it was graded against are exactly the Session Evidence
  that must not outlive its Session in a readable view. Putting them in the
  history database would make Evidence reconstructable from disk, which ADR
  0028's lifetime rules forbid. The perf logs already hold Run-internal detail
  under a purge policy and no view; the Run Trace joins them.
- **Recorded History is a review record, not a diagnostic one.** It answers
  "what did this Session do" for a person. The Run Trace answers "why did this
  decision go that way" for a diagnosis, and is never rendered in any view. One
  store per audience keeps the history schema from growing fields no view
  reads.
- **The file is the contract.** Every record carries `v`, the turn id, run id,
  session id, and Session generation, so a trace joins to Recorded History and
  to the eval tape without either of them knowing the trace exists. The eval
  harness reads these files; nothing in the app reads them back.
- **It rides the perf sink's policy exactly.** Same rotating JSONL sink, same
  ~5 MB roll, same 7-day purge, same swallow-every-failure rule — diagnosis
  must never become the Run's problem. Each family purges only its own prefix,
  and the perf report, which owns `perf-*.jsonl`, ignores trace files by name.
- **Records outside a Run name the Session, not a turn.** The checkpoint
  record is written by a Run and carries its run id and turn id. The store and
  view records (#181) — what reached the store, what each view was answered,
  which renderers heard a change signal, and what the store held at the end —
  are written by main, outside any Run, so there is no run id or turn id to
  forge. They carry the version, the write time, and the Session identity and
  generation, which is what joins them to the checkpoint records around them.
  A reader keys on `kind` and treats the Run fields as present only on
  Run-written kinds. The one record that can name no Session at all is an
  evidence pull answered `no_session` — there was none to name, and that is
  the fact the record exists to state.
- **Rejections are traced as fully as acceptances.** The first record kind is
  the Evidence Checkpoint attempt: the tool, the arguments verbatim, every
  retention the citation was graded against with its Producer, observation
  time, payload length and head, and which one matched. A Look shadowing a page
  read — the #179 fault — is visible from the file alone.

- **The reasoning records are opt-in; everything else is not.** Every other
  record kind is bounded — arguments the model wrote, counts, 500-character
  heads. A round's reasoning is none of those: it is the model restating the
  user's words and its own private read of them, at whatever length it thought
  for, and it is the one thing the file would hold that the user never chose
  to put anywhere. So `reasoning` (#182) is written only when a developer sets
  `BINGBONG_TRACE_REASONING` in their own Env File, and with the flag unset no
  reasoning is retained for the file at all — not collected and dropped,
  never collected. A shared Kiosk cannot accumulate it by default, which is
  the whole point of making this the one kind that has to be asked for. The
  8,000-character cap bounds what an opted-in file holds; the record keeps the
  true length beside the cut text so a truncation is never mistaken for a
  short thought. A retried round leaves one record per attempt rather than one
  concatenation: an abandoned retry is one of the two cases the record exists
  for, and merging it into the attempt that survived would hide that two
  happened. `round` counts model rounds — bookkeeping, reserved Answer and
  deadline-aborted ones included — so it is not the Tool Round count a Run
  budgets against. Turning the flag on makes every round stream, because
  reasoning exists only as stream deltas.
- **A delegated worker's rounds are traced under the same flag (#183), and
  the flag is what makes them stream.** A Browse Subagent's rounds run through
  the workhorse loop, which has never streamed: nothing on that path listens
  to a delta, so the provider was never asked for one. With
  `BINGBONG_TRACE_REASONING` set, every worker round streams — the reasoning
  collector is the only listener, and the opt-in is the only thing that wires
  it — and with the flag unset the worker path is exactly what it was:
  non-streaming, collecting nothing. There is no second knob. Each worker
  record carries the worker's `agentId` beside `round` and `attempt`, and the
  parent Run's identity and turn like every Run-written kind, so a worker's
  thinking joins the Run that delegated it and the checkpoint records that
  already stamp the same `agentId` on the citations its observations graded.
  The 8,000-character cap and the one-record-per-attempt rule are the same;
  the worker's reserved Answer round and a round that failed leave a record
  like any other, since a worker's abandoned retry or a citation that failed
  its Evidence Checkpoint is the case this half of the record exists for.

**A Session Reset does not purge trace files, deliberately.** This is the
uncomfortable consequence and it is stated here rather than left implicit: the
trace holds a checkpoint's arguments verbatim and 500-character heads of the
observations it was graded against — page text, ask_user answers, Steering
Directives — so a user who resets a Session to discard what they were looking
at leaves that text readable under `userData/logs/` until the 7-day purge. Perf
spans carry no user text, so this is a new class of on-disk data, not more of
what was already there. We accept it because the file exists to diagnose Runs
that went wrong, and a Reset is often exactly how a user reacts to one —
purging on Reset would erase the traces most worth reading. The mitigations are
the ones already in the file contract: no view renders it, nothing in the app
reads it back, it is bounded to a head rather than the full payload, and it
purges on the perf sink's 7-day window. If the trade turns out wrong, the lever
is a shorter purge age for the trace family, not a move into Recorded History.

Considered and rejected: widening Recorded History's tool records (makes
Session Evidence durable and readable, the exact thing ADR 0028 forbids);
folding trace records into `perf-*.jsonl` as a new stage (the perf report
recomputes totals from every span it collects, and these are not stages with
durations); and tracing only rejections (the vanished-checkpoint case — an
accepted call whose Observation nobody can find later — is precisely the one
that leaves no error text to read).
