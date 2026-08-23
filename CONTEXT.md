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

### Session

**Session**:
A chain of runs connected by gaps shorter than the Session Window. The unit of
continuity for both the model's thread and every rendered view.
_Avoid_: conversation, thread (the thread is what the model retains)

**Session Window**:
The maximum idle gap (default 30 minutes) that keeps a Session open.

**Active Session**:
A Session whose newest run finished within the Session Window, or a run in
progress. While active, the Idle Screen never renders.
_Avoid_: open session

**Lapse**:
The Session Window expiring. Eagerly wipes the rendered views; the model still
retains the most recent exchange (an accepted asymmetry).

**Run**:
One command execution: pipeline start to done/failed/cancelled.

**Boot Hydration**:
What a restart renders from recorded history: at most the last exchange of an
Active Session; a lapsed Session boots blank. Recording is never trimmed by
it. Its Lapse timer arms at boot from the hydrated last-run finish.
_Avoid_: restore, session replay

### Views

**Feed**:
The session-scoped projection of pipeline events. One projection feeds the
dashboard, the overlay panel, and (formerly) the idle digest.

**Feed Entry**:
One rendered item in the Feed (command, display, speak, error, voice-heard).
_Avoid_: message

**Feed Panel**:
The activity panel over the browser pane. Three states: Overlay, Docked,
Collapsed. A View Preference, resizable.
_Avoid_: activity bar, sidebar, activity sidebar

**Idle Screen**:
What renders when no Active Session exists: clock and weather only. Never shows
Feed Entries; never renders while a Session is active.
_Avoid_: screensaver

**View Preference**:
A persisted UI choice owned by the renderer (panel mode, panel width) — never
written to app Settings.

**Setting**:
A persisted app configuration value owned by main (models, voice tuning,
adblock, weather). Credentials are Settings; Settings are keyboard-setup
territory, everything else voice-reachable.

### Browser

**Consent Dialog**:
A cookie/consent wall auto-dismissed on read, privacy-preferring controls
first.

**Blocker**:
Anything between the agent and page content: Consent Dialogs, CAPTCHAs, login
walls, paywalls, age gates, file-select dialogs. Detected dynamically, then
escalated — never auto-cleared (the Consent Dialog is the one exception).
_Avoid_: obstacle

**Escalation**:
Handing a Blocker from the agent to the user via a spoken ask — the fallback
when no automatic path exists.

### Vision

**Look**:
A vision-model inspection of the current page screenshot, returned as text.
The tool named `look` is one Look; Auto-vision is another.
_Avoid_: screenshot analysis, image check

**Auto-vision**:
A Look the pipeline fires itself when an anomaly is suspected (stale ref, click
with no observable change) — not requested by the model.

**Describe / Locate**:
The two Look capabilities. Describe answers "what does the page show" (fast,
answer-bounded). Locate answers "where is the visually described target" as a
viewport point (precise, DOM-first — vision only when the DOM cannot identify
one target).
_Avoid_: vision call for both (say which capability)

**Vision Budget**:
The maximum number of Looks one run may spend, orchestrator and subagents alike.

**Vision Deadline**:
The maximum wall-clock one Look may take, per capability — a safety net against
endpoint variance, not a latency target. Breach surfaces as a failure plus a
nudge, never a silent blind browse.
