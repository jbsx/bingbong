# Diagnostics are two opt-in traces

Supersedes ADR 0030. That ADR's decision — a Run's diagnostic records live in
their own file family beside the perf logs, never in Recorded History — stands.
Its *premise* does not: Recorded History is retired in the last slice of this
widening (#188), so there is no readable history store left for evidence to be
kept out of. The invariant is restated here in the form that survives its
retirement, and the widening's own decisions are recorded alongside it.

**Session Evidence is never in an always-on store.** ADR 0028 gives a
checkpoint's arguments and the observations it was graded against a lifetime
that ends with the Session. A store that writes by default is a store that
outlives it for everyone, on every machine, without anyone choosing that. The
Run Trace was allowed to hold this text because it was a developer's file
under a purge window and no view; #184 makes that literal rather than
incidental — nothing is written unless a developer asked for it.

- **Two families, two flags, each flag named for exactly the glossary term it
  gates.** `BINGBONG_RUN_TRACE=1` gates the **Run Trace**
  (`run-trace-*.jsonl`); `BINGBONG_HOST_TRACE=1` gates the **Host Trace**
  (`host-trace-*.jsonl`). Both are Env File flags in the established
  BINGBONG_* shape (#32, #34), off unless set. The names are the same words in
  the env, in the file listing, and in CONTEXT.md, so a developer who reads one
  can find the other two without a translation step. A deployed Kiosk sets
  neither and writes neither.
- **Everything a family holds rides its one flag.** The reasoning records
  (#182) had their own opt-in; they no longer do — `BINGBONG_TRACE_REASONING`
  is gone, and the evidence kinds, always-on until now, went behind
  `BINGBONG_RUN_TRACE` with them. A diagnostic that has to be enabled a second
  time is the one nobody has on when the bug happens, and a file whose contents
  depend on a matrix of flags cannot be read at face value. The cost is that
  the evidence records now need an opt-in they did not need before; the
  benefit is that "turn on the Run Trace and reproduce it" is a complete
  instruction.
- **The perf log stays always-on.** It carries no user words and no page
  content — stages and durations — and the eval rung reads it, so putting it
  behind a flag would break a measurement that has to work by default. It is a
  different kind of file, and it keeps its different rule.
- **The boundary between the families is identity, not subject matter.** A
  record written where a Run identity is in hand goes to the Run Trace;
  everything else goes to the Host Trace. This is the rule precisely because
  subject matter would not decide it: a TTS failure inside a Run and a TTS
  failure at idle are the same event about the same subsystem, and what
  differs is what a reader can join it to. Host Trace records carry `v`, `at`,
  and the Active Session id or `null` — explicitly null, because "the app did
  this with no Session live" is a diagnosis, not missing data.
- **`reportFault(site, error, ids?)` is the one sanctioned global in core.**
  A module-level reporter with a sink main installs at startup; with no sink
  installed it is a no-op, and it swallows a sink that throws. It routes to the
  Run Trace when a turn id is in hand and to the Host Trace otherwise. The
  global is justified by the rule the trace writers already rest on —
  diagnosis must never become the work's problem — extended to the seam
  itself: a reporter threaded as a dependency would have to reach every
  `catch {}` in the codebase, and a swallowed failure is exactly the place
  where a required dependency is most likely to be skipped instead of wired.
  A `fault` record carries `site`, `message`, `stack`, and the turn and
  Session ids when they were known.
- **A turn-scoped fault with the Run Trace off is dropped, not rerouted.** The
  boundary rule is about identity, so a Run-scoped record does not become a
  host record because a flag is unset. A Host Trace that quietly held records
  naming turns would be a file nobody could read at face value, and the
  developer who wants that fault is one flag away from having it.
- **Retention is unchanged, per family.** The shared rotating sink, ~5 MB roll,
  7-day purge, every fs failure swallowed. Each family's purge matches only its
  own prefix, so the three cannot delete each other, and the perf report —
  which collects only `perf-*.jsonl` — ignores both traces by name.
- **The published stream is recorded where the views read it (#185).** The
  Run Trace's third record kind, `pipeline_event`, is one record per published
  PipelineEvent, tapped at the publisher — where the history recorder attaches
  — and holding the event object as published, owner stamps included. That
  placement is the point: the record is not a paraphrase of what the Run
  decided, it is the thing every view was told, so a Feed that showed the
  wrong headline and a file that says which headline was published answer the
  same question. Two kinds never land: `llm_delta` and `llm_tool_intent` are
  streaming chunks whose assembled result the `reasoning` record and the
  `display`/`done` events already carry. A `tool_result`'s text is cut at
  8,000 characters with the true length beside it, the shape `reasoning` uses
  — one page read is 40 KB, and the roll and purge below stop meaning anything
  if every read is kept whole. Everything else is verbatim. A delegated
  worker's Tool Rounds never reach the main stream at all — a worker publishes
  only its `agent_update` cards and its `subagent_finalized` — so they are
  tapped inside the worker and land under the parent Run's identity and turn,
  stamped with its `agentId`: the road the reasoning (#183) and checkpoint
  (#123) records already take.
- **Recorded History is retired rather than widened.** The obvious way to widen
  diagnostics was to record more into the store that already writes by default.
  Nothing read it: no view opens it, no Session restores from it, and every
  diagnosis of the faults that prompted this widening was done by re-running
  scenarios. So the answer to "what should Recorded History record now" is
  nothing at all (#188). What replaced it is not a smaller history: it is two
  files nobody writes unless they ask.
- **A trace reader is a developer tool, never an in-app view.** These files are
  read with `jq`, or one day by a script that ships beside `pnpm perf:report`.
  Nothing in the app reads them back, and no view renders them — the property
  that lets them hold the user's own words in the first place.

**A Session Reset still does not purge trace files**, and ADR 0030's discussion
of that trade stands unchanged, narrowed only by the flags: the text is on disk
for the developer who turned the flag on, on their own machine, until the
7-day purge.

Considered and rejected: one flag for both families (the Kiosk case wants
host-side faults with no Run text on disk, and the two files answer different
questions); a level or category knob per family (a matrix of flags is a file
you cannot read at face value, and the level you need is always the one you
did not set); keeping the evidence kinds always-on while gating reasoning
(leaves Session Evidence in an always-on store, which is the invariant above);
and threading a fault reporter through every call site instead of the global
(the change lands in every seam it touches, for a call that is allowed to do
nothing).
