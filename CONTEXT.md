# Bing Bong

A voice-first assistant: a local voice pipeline (wake word, STT, TTS) drives LLM
agents operating a real embedded browser, shown on a dashboard. The design goal
is hands-free operation — voice is the primary interface for everything except
first-run setup.

## Language

### Voice

**Wake Word**:
The phrase that opens a Listen. Latches until reset — one wake, one activation.
During a running Run, the Wake Word pauses that Run and opens the Pause Listen.
_Avoid_: hotword, trigger phrase

**Listen**:
An open microphone window in which one Utterance is captured and transcribed.
One utterance per activation — the Pause Listen is the one exception.
_Avoid_: recording session

**Utterance**:
A single span of user speech from speech-start to Endpoint, submitted as one
command.
_Avoid_: command (a command is what an utterance becomes after routing)

**Endpoint**:
The decision that an Utterance has ended — silence timeout, hard cap, or
disarm. The seam where half-commands are born.
_Avoid_: silence detection

**Barge-in**:
Cutting speech in flight by activating (wake word or hotkey), not by arbitrary
speech. The Abort Head is the one bare-speech exception.

**Pause**:
A live Run parked mid-flight. Entered by the Wake Word or hotkey during a
running Run; left by speaking "continue" or "resume", by a Steering Directive,
or by the Pause Listen's timeout. Paused Runs stay steerable and keep their
Session.
_Avoid_: hold, suspend

**Pause Listen**:
The Listen opened by pausing. Ignores non-directive utterances without closing,
and auto-resumes the Run after five seconds of mic silence.
_Avoid_: steering window, hold mode

**Abort Head**:
The always-on recognizer for "stop now" — the one bare-speech activation path.
Fires only while a Run is live and aborts it outright. Its false-positive risk
is accepted until observed in practice.
_Avoid_: cancel word, stop head

**Bias Lexicon**:
The app's own vocabulary that the STT decoder is biased toward while decoding
— panel, view, settings, and navigation terms, plus mishears discovered in
use ("pop up"). Two parts: the Seed Lexicon and Learned Terms. Extending it
is the first response to a misheard domain word.
It preferences what is heard; it never restricts what can be said.
_Avoid_: hotword list, dictionary, custom vocabulary

**Seed Lexicon**:
The compiled-in part of the Bias Lexicon: the app's shipped vocabulary.
_Avoid_: base lexicon, default words

**Mishear**:
A divergence between what was said and what the transcript carries. The
assistant proposes its repair at the end of its message; a proposal admits
nothing by itself — the same proposed term must recur across Runs before it
becomes a Learned Term. The user is never asked; the pipeline handles it.
_Avoid_: typo, STT error

**Transcription Failure**:
Any failure between spoken input and the transcript presented to the assistant:
a Mishear, an empty transcript after valid speech, clipped speech, one command
split across utterances, or background noise accepted as speech. A correctly
transcribed command that the assistant misunderstands is not a Transcription
Failure.
_Avoid_: recognition bug, STT issue

**Command Accuracy**:
Whether a transcript preserves the meaning needed to execute the spoken
command, even when wording, articles, or punctuation differ. The primary
measure of transcription quality; verbatim word accuracy is diagnostic.
_Avoid_: exact match, transcript accuracy

**Learned Term**:
A Bias Lexicon entry admitted at runtime after its proposal recurred across
Runs. Same decode effect as the Seed Lexicon; capped (default 500,
least-recently-used evicted), survives Sessions and restarts, and is
inspected or edited only in Settings — never voice-reachable.
_Avoid_: custom word, user dictionary entry

### Session

**Session**:
A user-visible chain of accepted Runs connected by gaps shorter than the Session
Window. It begins with its first accepted Run and ends at Lapse or explicit
reset, or when Bing Bong closes. Runs within it share continuity; no model
context crosses its boundary, and entries from ended Sessions never render.
Each Session has one explicit identity carried by its Runs, Memory Entries,
Feed events, and Recorded History.
_Avoid_: conversation, thread (the thread is what the model retains)

**Session Lifecycle**:
The identity-bearing sequence `session_started`, `session_expiring`,
`session_extended`, and `session_ended`. An end records one reason: `lapsed`,
`reset`, `app_closed`, or `interrupted`. Views and records react to these events
directly; they never infer Session boundaries from timestamps. Closing the main
window ends the Session; minimizing, hiding, and losing focus do not.

**Session Window**:
The maximum gap after the latest accepted Run finishes (default 30 minutes)
that keeps a Session open. A live Run suspends expiry. Only another accepted
Run or explicit Session Extension restarts the full window.

**Active Session**:
A Session whose newest run finished within the Session Window, or a run in
progress. While active, the Idle Screen never renders.
_Avoid_: open session

**Expiring Session**:
An Active Session inside its warning period (default: the final five minutes of
the Session Window). Bing Bong asks once whether to extend it and shows a
persistent countdown in the Status Capsule. The warning is not a Run, Feed
Entry, or Memory Entry.

**Session Extension**:
The user's explicit choice to keep an Expiring Session active. It restarts the
full Session Window without creating a Run or changing Session Working Memory.
Starting an accepted Run while the warning is visible has the same timing
effect. Incidental voice, browsing, pointer, and rejected-command activity does
not extend a Session. Extensions may repeat without a fixed limit; each new
window receives at most one warning.
_Avoid_: keepalive

**Lapse**:
The Session Window expiring. Ends the Session and eagerly wipes its rendered
views and model context. A declined expiry warning lapses immediately; no
response lapses at the original deadline, without another warning.

**Session Reset**:
A model-recognized request to leave the current Session. It atomically ends that
Session, clears its Feed, Session Working Memory, Run Journal, and Browser State,
then creates a new Session and restarts the resetting Run from its original
command. No prior model messages, tool observations, Subagent Reports, or sibling
tool calls cross the reset.
_Avoid_: clear history, new conversation

**Run**:
One accepted command execution: pipeline start to done/failed/cancelled. The
pipeline creates the first Session atomically when it accepts that Session's
first Run. A busy-rejected submission is not a Run and cannot alter Session
state.

**Run Plan**:
The orchestrator's current declaration of a Run's objective, Run Headline, and
Effort Tier. It changes when Steering changes the objective or evidence proves
that the current tier is insufficient.
_Avoid_: plan, task plan

**Effort Tier**:
The bounded class of autonomous work a Run may spend: Direct Action, Lookup, or
Investigation. The smallest tier sufficient for the objective is preferred.
_Avoid_: complexity, mode

**Effort Epoch**:
The current bounded-effort window: one Effort Tier's Tool Round budget,
warnings, and active-work deadline. It counts the Run's Tool Rounds, owes the
internal budget warnings, and arms each acquisition round against the deadline
as a cancellation boundary. A tier change or Steering replan re-arms it while
cumulative Tool Rounds keep counting toward the hard ceiling. It is also
Finalization's one door: every mechanically known Finalization Cause — budget,
deadline, hard limit, no Progress — is decided there, and entry cancels
unfinished delegated work once and supersedes the Run's owed advisory notices.
A Browse Subagent's loop is the module's second adapter (#149): the same
epoch in Subagent configuration — that Subagent's own 12-round budget, the
parent Run's shared deadline ahead of its remaining rounds, no Effort Tier —
so both loops stop for the same reasons in the same Finalization Cause
vocabulary. It is the same pairing the Tool Round has (#158): both loops
count the same rounds because both execute the same round.
_Avoid_: tier window, budget window

**Tool Round**:
One model decision that requests one or more tools. It consumes one unit of a
Run's effort regardless of how many independent calls travel together. Its
execution — the gate order every call passes, sibling suppression around a
terminal result, and the Notices its results carry — has one implementation
with two adapters: the Run loop and the Browse Subagent loop.
_Avoid_: tool call, model round

**Notice**:
An advisory line the runtime appends to a tool result for the model, never
shown or spoken to the user. An immediate Notice rides the result that
triggered it or is dropped; an owed Notice persists until a later result can
carry it. Notices ride only successful text results, in one fixed
precedence — except a directive that closes the loop rather than advising
inside it, which rides whatever the result it lands on read.
_Avoid_: nudge, warning text, hint

**Progress**:
New decision-relevant evidence or a requested state change that moves a Run
toward its objective. A successful call, changed URL, or fresh screenshot is
not Progress by itself.
_Avoid_: activity, successful tool call

**Approach**:
A coherent method for resolving a Run's objective, distinguished by its source
route, hypothesis, candidate set, or interaction strategy. Rewording one search
or changing search engines does not necessarily create a new Approach.
_Avoid_: attempt, action

**Finalization**:
The terminal phase in which a Run stops acquiring evidence and acting on pages,
then produces the best grounded Answer available. Finalization never asks the
user a new question after the work budget is exhausted.
_Avoid_: failure, timeout

**Finalization Cause**:
The reason a Run entered Finalization, such as satisfying the objective,
exhausting its budget, reaching its deadline, making no Progress, meeting a
Blocker, or reaching a hard safety limit.
_Avoid_: Run Resolution, outcome

**Run Resolution**:
The semantic result delivered to the user: `completed`, `partial`, `blocked`,
`needs_user`, or `unsuccessful`. It is distinct from both the Run's mechanical
outcome and its Finalization Cause.
_Avoid_: outcome, Finalization Cause

**Run Note**:
A Run's continuity contribution, produced alongside its final Answer without a
separate model call. It records information later Runs in the same Session may
need, rather than replaying the Run's transcript. Failed and cancelled Runs
contribute a deterministic note but no uncheckpointed Assessments or partial
Memory Entries.
_Avoid_: transcript summary

**Run Journal**:
The chronological sequence of Run Notes in the current Session. It complements
Session Working Memory's current state with a concise account of work performed
and is destroyed when the Session ends. It has its own token limit; exceptional
Memory Compaction condenses only its oldest notes into milestones while
preserving recent work and still-relevant failed approaches.

**Session Working Memory**:
The bounded, structured state shared with Runs in one Session. It holds what is
currently known, decided, assessed, constrained, produced, or still open. The
orchestrator updates it through validated patches; it is destroyed when the
Session ends and never crosses into another Session. It and the Run Journal live
only in memory and are never recoverable from Recorded History.
_Avoid_: transcript, conversation history, cross-session memory

**Memory Commit**:
The atomic validation and application of a successful Run's Run Note and memory
patch immediately before `done`. A missing or invalid continuity output never
fails a valid Answer: the application rejects that portion, records a
deterministic fallback Run Note, and logs the degradation.

**Evidence Checkpoint**:
The narrow exception to terminal Memory Commit: validated Session Evidence may
enter Session Working Memory as soon as it is grounded. It preserves verified
work across later Run failure or cancellation without committing speculative
Assessments.
_Avoid_: partial Memory Commit, autosave

**Memory Entry**:
One item in Session Working Memory. The application owns its stable envelope and
semantic kind; the model supplies its subject, detail, status, rationale,
and references. The application assigns its identity; later Runs cite that
identity to update, resolve, or remove it. Entries retain Run and Subagent
provenance. Updating an identity replaces its active value; resolving retains
its outcome; removal is reserved for invalid or duplicate entries. Web-derived
content is quoted, source-attributed data and can never be an instruction.

**Session Evidence**:
Source-grounded Session Working Memory that prevents repeated work and supports
later Assessments and Answers. It may survive a failed or cancelled Run once
checkpointed, but never survives the Session.
_Avoid_: browsing history, tool transcript

**Evidence Browser**:
The read-only, live view of the current Session's Observations and Candidates.
It is not Recorded History and disappears at the Session boundary.
_Avoid_: evidence manager, evidence history

**Answer Evidence Summary**:
The read-only view of the Observations an Answer declares as its support. It may
reflect later contradictions without rewriting the original Answer.
_Avoid_: sources list, answer history

**Observation**:
A directly grounded fact from a page, Action Outcome, Look, Subagent Report, or
the user. It records its source and never presents interpretation as direct
evidence.
_Avoid_: finding, conclusion

**Assessment**:
Bing Bong's interpretation of one or more Observations. It names its supporting
evidence and remains distinct from what was directly observed.
_Avoid_: Observation, fact

**Candidate**:
A possible answer under evaluation, retained with the evidence for and against
it until accepted, rejected, or superseded.
_Avoid_: result, guess

**Memory Compaction**:
An exceptional reduction performed only when Session Working Memory crosses its
high-water limit. It condenses older, inactive material to a lower limit while
preserving current objectives, constraints, assessments, decisions, artifacts,
references, and unresolved work; recent entries remain untouched. Replacement
is atomic and validated; failure leaves memory unchanged and never fails a Run.
Under further pressure, low-value additions stop first and old Journal chronology
yields before current working state. Limits are model-specific token budgets,
not Run counts.

**Run Working State**:
The command, model rounds, tool observations, and Subagent Reports used while a
Run executes. It is private to that Run and discarded when the Run finishes;
it is not a second durable memory layer. A Run uses the stable Session Working
Memory snapshot taken when that Run is accepted, plus the results and identities
of Evidence Checkpoints that the Run itself creates.
_Avoid_: run memory

**Run Context Compaction**:
The deterministic replacement of older checkpointed tool observations in one
Run's model context with their Session Evidence references. It is distinct from
Memory Compaction and never invokes a summarization model.
_Avoid_: Memory Compaction, compact command

**Search Loop**:
A run flailing blind — consecutive searches rewording one intent. Reads
between searches do not break it (reading is inspection, not escape);
only escape breaks it — opening a result, or any other successful tool
call that makes Progress. One search observation is the visible search
signature: a navigate to a q=-carrying search URL (plain search terms
normalize to exactly that) or text typed into a search input. Similar searches
remain one Approach and follow the Run's no-progress Notice and refusal policy.
_Avoid_: search spam, retry storm

**Boot State**:
Bing Bong starts with no Session and renders no entries from recorded history.
Recorded history remains available outside the live Session experience.
_Avoid_: hydration, restore, session replay

**Recorded History**:
The durable review and diagnostic record of past Runs. It may render only when
the user explicitly opens a history view; it never hydrates the live Feed or
provides continuity to a Session. It records each Session's identity, start,
end, end reason, and Run membership.
_Avoid_: session memory

### Views

**Prompt Bar**:
The single typed-input surface, living in the Feed Panel's footer. Carries one
of two verbs depending on run state: _submit_ starts a Run when none is live;
_steer_ directs the live Run. The verb is chosen by the same run-live signal,
never by which surface you typed in. The draft survives verb flips; a
delivered draft clears on Enter, and a rejected one is restored — never
silently dropped.
_Avoid_: command box, steer box, input bar, activity bar

**Steering**:
Redirecting a live Run mid-flight with one Directive. Paused Runs stay
steerable; Steering pauses-if-needed and resumes-with-directive as one atomic
step. The typed path drives the exact seam the spoken Pause flow drives.
_Avoid_: interrupting, mid-flight correction

**Directive**:
One instruction aimed at a live Run via Steering. Distinct from a command: a
command starts a Run; a Directive bends one that already exists.
_Avoid_: steer command, follow-up prompt

**Feed**:
The session-scoped projection of pipeline events. One projection feeds the
dashboard, the overlay panel, and (formerly) the idle digest.

**Feed Entry**:
One rendered item in the Feed (command, Answer, error, voice-heard).
_Avoid_: message

**Answer**:
One assistant turn's single output, carrying two renderings: a Spoken one
for the ear and a Card one for the view. An Answer renders as at most one
Feed Entry — the Card when it exists, otherwise the Spoken rendering.
_Avoid_: message, reply, response

**Spoken Rendering**:
The ear-facing half of an Answer: what TTS says. Never renders beside its
Card.
_Avoid_: speak line, voice line

**Card**:
The view-facing half of an Answer: markdown shown in the Feed. Replaces the
live answer stream and the Spoken rendering.
_Avoid_: display text, answer card

**Feed Panel**:
The activity panel over the browser pane. Three states: Overlay, Docked,
Collapsed. A View Preference, resizable.
_Avoid_: activity bar, sidebar, activity sidebar

**Peek Card**:
The system-pushed surface that reports the live Run and then its Answer
(or failure) while the Feed Panel is Collapsed. While a Run is live, a
Pause included, exactly one of the Feed Panel or the Peek Card renders —
any close of the panel summons the card. The Answer persists until the
next Run, a panel open, or the Session ends; a cancelled Run hides it
promptly. Not a state of the Feed Panel; clicking it opens the panel and
dismisses it. Voice activity may show it; only a human act opens the
panel. Its live title is the Run Headline. It floats translucently over
the browsing pane without resizing it, stands in for the Collapsed
panel's edge tab while visible, and never covers the same page region as
the panel — switching between card and panel reveals the page beneath
the other.
_Avoid_: toast, notification, mini panel, activity card, transient card

**Command Echo**:
The raw transcript of a Run's first Utterance, shown as the live Peek
Card's title until the Run Headline arrives — the fallback, never the
description.
_Avoid_: transcript line, caption

**Run Headline**:
The Run's current task description — what the Run is doing now, not what
was first said. Owned by the orchestrator: set when the Run starts and
revised whenever understanding changes, Directive or otherwise. The
command echo stands in until the first one arrives; a missing or invalid
one never fails the Run.
_Avoid_: command echo, task title, status line

**Idle Screen**:
What renders when no Active Session exists: clock and weather only. Never shows
Feed Entries; never renders while a Session is active. `session_ended` renders
it immediately, clears the Feed, hides the feed overlay, and resets Browser
State. Lifecycle events never count as user activity or delay that transition.
_Avoid_: screensaver

**Toolbar**:
The one reserved band at the window's top: Status Capsule left, address
field center, feed and settings controls right. The window's only drag
region; never covers the browsing pane.
_Avoid_: header, dashboard header, browser chrome, title bar

**Status Capsule**:
The single control naming the assistant's state — orb, pill, and the live
run/voice hints collapsed into one pill-shaped surface. Its orb is the feed's
assistant mark: one visual identity for "this is Bing Bong".
_Avoid_: status bar, status row, status line

**View Preference**:
A persisted UI choice owned by the renderer (panel mode, panel width) — never
written to app Settings.

**Setting**:
A persisted app configuration value owned by main (models, voice tuning,
adblock, weather, appearance — `system | light | dark`). Credentials are
Settings; Settings are keyboard-setup territory, everything else
voice-reachable.

**Env File**:
The `.env` file next to the app, read once at boot. The bottom configuration
layer: Env File below process environment below Settings. Never persists,
never overrides a value that is set anywhere above it.

### Browser

**Browser Profile**:
Durable browser-owned data such as login cookies, site storage, consent choices,
and preferences. It persists across Sessions but is not agent or model context.

**Auth Host**:
A host whose pages authenticate the user (sign-in flows, identity popups).
It sees a simplified, self-consistent browser identity; every other host sees
the ordinary one.
_Avoid_: trusted site, Google host

**Auth Popup**:
A sign-in flow's child window, opened by Bing Bong itself on the browse
profile. While one is open, page actions act on it; closing it returns them
to the pane. Popups to non-Auth-Host targets stay denied and reported.
_Avoid_: login window, OAuth popup

**Browser State**:
The visible page, navigation state, media state, and transient tabs used during
a Session. It is discarded when the Session ends; the Browser Profile remains.
_Avoid_: browser context, browser workspace

**Action Outcome**:
The resulting state returned by a browser, media, application, setting, panel,
or Session action, including a fresh page snapshot when a browser action
meaningfully changes the page. It is the next decision's observation, not merely
confirmation that a call ran.
_Avoid_: tool result, success flag

**On-Screen Principle**:
Every web read and write happens in a rendered, visible tab. Off-screen fetching of web content does not exist.
_Avoid_: background fetch, scraping, headless lookup

**Mirror**:
A third-party site that visibly renders material originating elsewhere. It is
an ordinary accessible source even when the original host is blocked, and a
distinct source from the original; a first-party alternate representation of a
page is the same source, not a Mirror.
_Avoid_: proxy, cache, clone

**Consent Dialog**:
A cookie/consent wall auto-dismissed on read, privacy-preferring controls
first.

**Blocker**:
Anything between the agent and page content: Consent Dialogs, CAPTCHAs,
login walls, paywalls, age gates, file-select dialogs. Detected mechanically
— in code, at navigation and at read — then escalated; never auto-cleared
(the Consent Dialog is the one exception).
_Avoid_: obstacle

**Challenge**:
A Blocker the user can clear on screen — a CAPTCHA or human-verification
wall. Escalation asks the user to complete it in view.
_Avoid_: captcha wall

**Network Block**:
A Blocker no in-view action clears — the site refuses this network or
session outright. Escalation offers sign-in or a different route.
_Avoid_: IP ban, blacklist

**Escalation**:
Handing a Blocker from the agent to the user via a spoken ask — the fallback
when no automatic path exists.

### Delegation

**Subagent**:
A delegated worker spawned mid-run. Browse kinds work in their own visible
tab; background kinds do approved non-web file work. No subagent fetches the
web off-screen. A Subagent executes the shared Tool Round (#158) as its
second adapter, in Subagent configuration: its own Observation ledger and
Notices, the ASK_USER relay as both its Blocker escalation and the result
that ends a round, every Confirmation refused because it has no user to ask,
and the Run's search-loop, no-progress, and per-call deadline rails all off.
What stays its own is what a Run has no counterpart for: the reserved Answer
round and the deterministic bounded Subagent Report behind it.
_Avoid_: research agent, worker, task runner

**Subagent Report**:
A Subagent's structured return to its orchestrator, carrying findings, evidence,
and unresolved items. A Subagent may read only the Memory Entries selected for
its task and cannot mutate Session Working Memory directly.

### Autonomy

**Confirmation**:
The pipeline's ask-before-acting gate, reserved for Consequential Actions.
It asks once — card, spoken prompt, and a yes/no mic window — and on deny or
silence the Run continues with "do not retry" fed back to the model.
Non-consequential actions never ask.
_Avoid_: approval, permission prompt

**Consequential Action**:
An action whose effects outlive the page or spend something: persisting or
sending data, buying, downloading files, quitting the app. Searching — typing
a query and submitting it — merely navigates to results and is never
Consequential.
_Avoid_: risky action, dangerous action

### Vision

**Look**:
A vision-model inspection of the current page screenshot, returned as text.
The tool named `look` is one Look; Auto-vision is another.
_Avoid_: screenshot analysis, image check

**Auto-vision**:
A Look the pipeline fires itself when an anomaly is suspected (stale ref, click
with no observable change) — not requested by the model. Advisory: shorter
deadline than a Look, a per-run cooldown between attempts, and failure is a
one-line note in the tool result — never a Notice.

**Describe / Locate**:
The two Look capabilities. Describe answers "what does the page show" (fast,
answer-bounded). Locate answers "where is the visually described target" as a
viewport point (precise, DOM-first — vision only when the DOM cannot identify
one target).
_Avoid_: vision call for both (say which capability)

**Vision Budget**:
The maximum number of Looks one run may spend, orchestrator and subagents alike.

**Vision Deadline**:
The maximum time one Look may wait before the model starts answering, per
capability; once answering has begun, a separate cap bounds the whole Look. A
safety net against silent endpoint hangs, not a latency target. Breach
surfaces as a failure plus a Notice, never a silent blind browse.

### Hardware

**Kiosk**:
The dedicated appliance machine Bing Bong ships to: one Linux box with screen,
microphone, and speakers, running the app full-screen as its only
application. The Hardware Floor is defined against it.
_Avoid_: server, deployment environment, target machine

**Hardware Floor**:
The reference minimum machine every default must satisfy — currently the
target kiosk: a dual-core mobile-class CPU (i3-7100U) with integrated
graphics and 4 GB of RAM, shared with the dashboard and OS. Defaults are
chosen against the Floor; capability above it may be offered but is never
required for acceptable operation.
_Avoid_: minimum spec, supported hardware, low-end profile
