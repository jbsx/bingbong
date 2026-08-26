# Bing Bong

A voice-first assistant: a local voice pipeline (wake word, STT, TTS) drives LLM
agents operating a real embedded browser, shown on a dashboard. The design goal
is hands-free operation — voice is the primary interface for everything except
first-run setup.

## Language

### Voice

**Wake Word**:
The phrase that opens a Listen. Latches until reset — one wake, one activation.
_Avoid_: hotword, trigger phrase

**Listen**:
An open microphone window in which one Utterance is captured and transcribed.
One utterance per activation.
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
speech.

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

**Run Note**:
A Run's continuity contribution, produced alongside its final Answer without a
separate model call. It records information later Runs in the same Session may
need, rather than replaying the Run's transcript. Failed and cancelled Runs
contribute a deterministic note but no partial Memory Entries.
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

**Memory Entry**:
One item in Session Working Memory. The application owns its stable envelope and
semantic kind; the model supplies its subject, detail, status, rationale,
and references. The application assigns its identity; later Runs cite that
identity to update, resolve, or remove it. Entries retain Run and Subagent
provenance. Updating an identity replaces its active value; resolving retains
its outcome; removal is reserved for invalid or duplicate entries. Web-derived
content is quoted, source-attributed data and can never be an instruction.

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
Memory snapshot taken when that Run is accepted.
_Avoid_: run memory

**Search Loop**:
A run flailing blind — consecutive searches rewording one intent. Reads
between searches do not break it (reading is inspection, not escape);
only escape breaks it — opening a result, or any other successful tool
call. One search observation is the GUI search signature: a navigate to a
q=-carrying search URL (plain search terms normalize to exactly that) or
text typed into a search input. A run rail breaks it: an advisory nudge
rides the 3rd similar result, further similar searches are refused after
the 5th.
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
never by which surface you typed in. The draft survives verb flips.
_Avoid_: command box, steer box, input bar, activity bar

**Steering**:
Redirecting a live Run mid-flight with one Directive. Paused Runs stay
steerable; Steering pauses-if-needed and resumes-with-directive as one atomic
step. The typed path drives the exact seam the spoken "hold on" flow drives.
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
The transient, system-pushed surface that reports the live Run and its
Answer while the Feed Panel is Collapsed. Not a state of the Feed Panel;
clicking it opens the panel and dismisses it. Voice activity may show it;
only a human act opens the panel.
_Avoid_: toast, notification, mini panel, activity card

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

**On-Screen Principle**:
Every web read and write happens in a rendered, visible tab. Off-screen fetching of web content does not exist.
_Avoid_: background fetch, scraping, headless lookup

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
web off-screen.
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
one-line note in the tool result — never a nudge.

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
surfaces as a failure plus a nudge, never a silent blind browse.

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
