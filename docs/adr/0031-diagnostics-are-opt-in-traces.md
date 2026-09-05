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
- **Every swallowed `catch` binds its error and reports it (#186).** About
  seventy `catch {}` sites in `src/main` and `src/core` were each a decision
  that the work must survive a failure, and none of them was a decision that
  nobody should ever learn the failure happened. Each is now
  `catch (error) { reportFault('module.fn', error) }` under a stable dotted
  site name, and an ESLint rule — `CatchClause[param=null]` — keeps it that
  way, so the convention is enforced by `pnpm lint` rather than by review.
  Two kinds of site are exempt and say why at the site: the rotating sink
  and each trace writer's own guard (a fault reported from inside the write
  that failed would re-enter the same failing write), and each reporter
  itself. The renderer was exempt until it had somewhere to report to; #187
  gave it one, and the rule covers it now. The rule is
  deliberately about the binding, not about the call: a catch that already
  handles its error — rethrows, returns it, wraps it — binds one and passes
  untouched. The cost is real and accepted: predicates that swallow by
  design, like a URL parse behind `hostFromUrl`, now report a fault every time
  they refuse. With both flags off that is a call that does nothing, and with
  the Host Trace on it is the truth about how often that path is taken.
- **A fault carries the turn only where the caller genuinely had one.** Most
  swept sites report no ids, so they route to the Host Trace — which is the
  honest answer, because most of them are reached from places that have no
  Run identity in hand. The handful that do (the perf spans keyed to a turn,
  the Run's own ledger and Learned Terms calls, a worker's reserved Answer
  round) pass it, and their faults join that Run's decisions in the Run Trace.
  The four ad-hoc lines the app already printed — `[llm] empty completion`,
  the `[gpu]` lines, the adblock warning, the unreadable Env File — report a
  fault as well and keep printing: the console line serves whoever is watching
  the run, the record serves whoever reads the file afterwards.
  The two spans the ear records stay host-scoped even though a turn id has
  been minted by then: the ear runs outside every Run, its other records name
  the Active Session, and a fault about the ear belongs beside them.
- **The voice pipeline's six record kinds are the Host Trace's first real
  content (#186).** `voice_wake` (the detection that fired, with the score and
  VAD maximum against the threshold and gate it cleared), `voice_endpoint`
  (the utterance's durations, the cap flag, and which listen was open),
  `voice_stt` (the transcript, its duration, the size of the bias set and the
  Learned Terms the text actually contains), `learned_term` (admissions and
  removals, with whether proposals or the settings page made them),
  `tts_line` (the exact text handed to piper, per line) and `tts_dropped`
  (every line a barge-in dropped, and whether it was still queued, already
  rendered, or speaking). Two `console.log` lines in the Learned Terms ledger
  are gone: the growth of the lexicon is ADR 0022's whole story, and it now
  lands in a file that can be read after the fact beside the transcripts the
  admissions came from. A wake record is written for the detection that
  fired and never for the chunks that did not — the ear scores every 80 ms,
  and a record per chunk would be a file about nothing.
- **The vision records take the fault route rather than a family (#186).** A
  Look happens inside a Run and belongs beside that Run's decisions, so
  `vision_request` and `vision_budget` are routed by identity exactly as a
  fault is: the Run Trace with a turn in hand, the Host Trace without one.
  The reporter is threaded as a dependency rather than installed as a global —
  vision has three call sites (the model's `look`, the pipeline's auto-vision
  Describe, `ground_visual`'s Locate) and every one of them already holds a
  ToolContext, so the argument that justified the global for `reportFault`
  does not apply. Both reporters share one `routeByTurn`: the rule is a single
  decision, and a second copy of it is a second place for it to drift. A
  vision record names only the turn — a tool knows the turn it is executing
  in and nothing else about the Run — because a record naming ids the caller
  never held would be a joinable-looking lie. A request is recorded when it settles, not when it starts,
  because the Vision Deadline guarantees settlement: one line per request
  holds the ask and its outcome — `ok`, `deadline` or `error` — together, and
  a Run's vision spend is countable by reading them. A worker's Look rides
  the spawn like its reasoning (#183) and its Tool Round events (#185), so it
  lands under the parent Run's turn stamped with the worker's `agentId`.
- **The renderer gets a channel of its own, and five records on it (#187).**
  `window.bingbong.diagnostics.report(event)` → one IPC send → the Host Trace,
  stamped main-side with the Active Session. Every renderer record is
  host-scoped by the boundary rule for a structural reason rather than a
  circumstantial one: a page holds no turn identity at all, so there is never
  a Run for one of its records to join. The five are the renderer's unhandled
  errors and rejections (as `fault`, under a `renderer.<surface>.<seam>` site),
  `feed_cleared` with its cause, `feed_panel` open/close, `evidence_rendered`,
  and `session_readopt`. They name the page they came from — `dashboard` or
  `feed_panel`, the same two words the Run Trace's `requester` already uses —
  because the two pages fail, clear and re-adopt independently and a record
  that could not tell them apart would answer neither.
- **A renderer record carries ids and counts, and main rebuilds it.** The
  published stream's tap (#185) already holds every Feed Entry's text and the
  store (#181) already holds every Observation's, so a renderer record that
  repeated either would be a second copy of the user's own words written from
  the least trusted side of the app. That is enforced structurally rather than
  by convention: `rendererReportOf` *rebuilds* each record main-side out of
  the declared fields, so a field a future renderer bug adds cannot ride into
  the file, and a fault whose site does not start with `renderer.` is refused
  outright — a page may say a page failed, not that the voice pipeline did.
  A malformed report is dropped in silence, because a report that fails to
  parse must never become a second failure.
- **`evidence_rendered` is the other half of `evidence_answered`.** #181
  records what main handed each view; this records what the view kept, as the
  same three counts. The pair is the diagnosis "evidence is either not saved
  or not rendered" was missing: equal counts mean a correct store reached a
  correct view; `received` above `rendered` means the fold discarded the
  answer — a foreign Session, or a read that crossed a clear — rather than the
  store having lost anything. They land in different files, which the boundary
  rule requires and the shared `requester`/`surface` vocabulary makes joinable.
- **The Feed's wipe is recorded where only the projection can see it.** The
  projection takes an `onCleared` callback rather than the renderer inferring
  a wipe from an empty list, because a Session boundary's wipe and a reloaded
  page's fresh projection are indistinguishable from outside — and both are
  the bug report "something cleared the activity feed", which is why
  `page_load` is a cause beside `session_ended`. The panel record is written
  on a change to open/mode only: the fold broadcasts every frame of a width
  drag, and a record per frame would be a file about a mouse.
- **`recordVoiceError` becomes a fault (#187).** It was the one renderer→history
  IPC in the app, and a mic failure is a swallowed failure like every other one
  #186 swept. The Feed line it produced now stamps its own clock — the shared
  timestamp existed only to join the line to a history row nobody read. The
  history API keeps the dead method until the retirement slice (#188) deletes it.
- **The renderer joins the swallowed-catch rule.** With a reporter of its own —
  `reportRendererFault`, the page's `reportFault`, no-op until the page installs
  diagnostics at its entry point — the ESLint `CatchClause[param=null]` rule now
  covers `src/renderer` as well, and the exemption this ADR granted it is spent.
  The surface is a module-level binding installed once at the page edge for the
  same reason the fault sink is: the seams most worth hearing from are the ones
  nobody would remember to wire.
- **Recorded History is retired rather than widened.** The obvious way to widen
  diagnostics was to record more into the store that already writes by default.
  Nothing read it: no view opens it, no Session restores from it, and every
  diagnosis of the faults that prompted this widening was done by re-running
  scenarios. So the answer to "what should Recorded History record now" is
  nothing at all (#188). What replaced it is not a smaller history: it is two
  files nobody writes unless they ask.
- **A trace reader is a developer tool, never an in-app view.** These files are
  read with `jq`, or with the Trace UI (#189): `pnpm trace:ui`, a script beside
  `pnpm perf:report` that serves one loopback-only page joining the perf log
  and both traces on the ids each line carries — one timeline per `turnId`, a lane
  per Session for what was written outside one — and tails the logs dir. It
  has no IPC because the files are the contract, and it is reachable from
  nothing electron-vite bundles and nothing the Kiosk image copies. Nothing in
  the app reads the files back, and no view renders them — the property that
  lets them hold the user's own words in the first place.

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
threading a fault reporter through every call site instead of the global
(the change lands in every seam it touches, for a call that is allowed to do
nothing); a vision *family* of its own beside the two (a Look is a Run's
decision, and a third file would split a Run's records across two of them);
recording a vision request at its start as well as its settlement (the
Vision Deadline guarantees settlement, so the second record would only ever
restate the first); forwarding the renderer's reported object to the sink
instead of rebuilding it main-side (the page is the least trusted writer in
the app and the closest to the user's own words, and a forwarded object is a
promise kept by convention); a `renderer_*` prefix on every kind (the record
already names its surface, and `feed_cleared` says its subject the way
`voice_wake` does); and a second record per re-adoption subscriber rather than
one per page (both Session-bearing hooks adopt through the same hook, and the
record is about the page).
