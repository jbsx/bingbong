# Bing Bong (kachow)

A voice-driven browser shell: a local voice pipeline (wake word, STT, TTS), a
real embedded browser with a numbered-ref interaction surface for an agent to
act through, and a dashboard that shows what is happening. This branch
strips the generating-model layers — the orchestrator, its subagents, the
Session and evidence machinery, vision — and keeps one model, Jev, the
Decision Model. The glossary below is inherited from `main` with the removed
sections cut; an entry in Voice, Views or Browser that names a Run Plan, a
Session, a Subagent or an Answer contract describes machinery that is gone
here and names what is left to build.

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

**Standing Directive**:
The last Directive a Run consumed, in the user's own words, sent on every
later round of that Run — the original command never leaves the request, so
without it a correction survives only while the model keeps restating it. It
takes precedence over the command wherever the two differ, and is never
cleared by anything the model says: only the Run ending retires it. Distinct
from the corrected objective, which is the model's restatement of the same
correction.
_Avoid_: sticky steering, persistent correction

**Feed**:
The session-scoped projection of pipeline events. One projection feeds the
dashboard, the overlay panel, and (formerly) the idle digest.

**Feed Entry**:
One rendered item in the Feed (command, Answer, error, voice-heard).
_Avoid_: message

**Answer**:
One assistant turn's single output, carrying two renderings: a Spoken one
for the ear and a Card one for the view. An Answer renders as at most one
Feed Entry — the Card when it exists, otherwise the Spoken rendering. Both
renderings are written in English, the product's one language, whatever
language the command or the pages read were in.
_Avoid_: message, reply, response

**Spoken Rendering**:
The ear-facing half of an Answer: what TTS says. Never renders beside its
Card. It is spoken as soon as it closes in the model's stream, before the
rest of the Answer has arrived; once spoken, it is the Answer's Spoken
Rendering even if an Answer Retry rewrites the rest, and even if its round
is then cut: the Answer the Run ends on is not spoken after it, because the
user is not told that a limit was reached (ADR 0034, #312).
_Avoid_: speak line, voice line

**Card**:
The view-facing half of an Answer: markdown shown in the Feed. Replaces the
live answer stream and the Spoken rendering. It is shown once what it is made
from has been written, before the Answer Tail, and once shown it stands
(ADR 0074).
_Avoid_: display text, answer card

**Answer Tail**:
The part of an Answer written after everything its Card is made from: the Run
Resolution and Finalization Cause the model proposes, the Run Note, the memory
patch, the mishear proposals and the Answer Checkpoints. Nothing the user sees
or hears waits on it. One that is cut or cannot be read never fails the Answer:
each part falls back as a missing one does, and no Answer Retry is spent
(ADR 0074).
_Avoid_: bookkeeping fields, metadata, trailer

**Identity Slip**:
An internal identity — a Memory Entry id or a Run Observation id — that the
model wrote into a user-facing rendering of an Answer, against the contract
that the user never sees one. The renderings are the Card, the Spoken
Rendering, and the Asked Items the Card lists, each item's name and its
statement. The rendering is repaired at the display boundary and the slip is
recorded. In the Card an id that names a Session Evidence Observation becomes
a link to that Observation's source, or a fixed phrase when the Observation
is the user's own words; in the Spoken Rendering, in an Asked Item, and for
an id the boundary cannot resolve, the token is removed, a range of ids and
the brackets a removal leaves empty with it. A slip never changes the
Answer's declared support. A Subagent Report is model-facing, not a
rendering, so it carries no slip and is not repaired; the Subagent
Announcement made from one is repaired by removal and records no slip. The
account of a Run's work, its reasoning and its tool calls, is no rendering of
an Answer: an id there is how the work is read, and is left as written.
_Avoid_: id leak, hole, scrub, hollowed answer, scrubbed id

**Exhibit**:
The optional third rendering of an Answer: an interactable HTML page for the
eye, laid out after the Answer lands and shown in place of its Card while
the Session lives. Only an Investigation whose question benefits from a
visual carries one; the model decides the benefit, the app enforces the
tier. It is self-contained — its links open in the browsing pane and nothing
else crosses back. Never authored by a Subagent; at most one per Answer.
_Avoid_: artifact, visual, report, HTML card

**Exhibit Brief**:
The Answer's declaration that an Exhibit is warranted and what it should
show, naming the Session Evidence it draws on. The Exhibit is authored from
the Brief after the Answer is delivered; a malformed or out-of-tier Brief is
dropped and the Card stands.
_Avoid_: exhibit spec, render request

**Exhibit Shape**:
The closed vocabulary an Exhibit Brief must name to opt into an Exhibit:
Comparison (Candidates set against the same attributes), Structure
(relationships, hierarchy, or a branching flow), Timeline (ordered events
whose spacing carries meaning), or Quantities (numbers across items that want
a chart). Naming a shape is the opt-in; a Brief that names none carries no
Exhibit. The test behind every shape is that the Card cannot carry it.
_Avoid_: visual type, chart kind, exhibit category

**Exhibit Gate**:
The mechanical check the app runs on an Exhibit Brief before anything is
rendered: the Run's Effort Tier is Investigation, its Run Resolution is
completed or partial, and the Answer cites at least three distinct Session
Evidence Observations. A Brief that fails it is dropped and the Card stands.
The Gate is the app's judgement; whether the visual is warranted stays the
model's.
_Avoid_: exhibit validation, tier check

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
to the pane. It is the only window a page is ever given.
_Avoid_: login window, OAuth popup

**New-window Link**:
A link whose click asks the browser for a new window. It opens in the pane
it was clicked in, replacing the page that held it, and its Action Outcome
says the link asked for a new window. The rule is the same for the model's
click, a Subagent's and the user's own. A window a script opens that is not
the clicked link's address is a popup: denied, and its address reported
whole.
_Avoid_: popup (for the link), new tab, blank link

**Browser State**:
The visible page, navigation state, media state, and transient tabs used during
a Session. It is discarded when the Session ends; the Browser Profile remains.
_Avoid_: browser context, browser workspace

**Action Outcome**:
The resulting state returned by a browser, media, application, setting, panel,
or Session action, including a fresh page snapshot when a browser action
meaningfully changes the page. It is the next decision's observation, not merely
confirmation that a call ran. The address and title it names are those of the
page it carries, never a separate reading of the tab; one that carries no page
says the page could not be read.
_Avoid_: tool result, success flag

**Unsettled Action**:
A started browser action whose underlying operation has not been observed to
end. Neither ending the Run's wait on one nor a bounded adapter wait expiring
is that observation — only the operation's own resolution, or the destruction
of the surface it was acting on. An abandoned action is reported as uncertain,
never as undone, and its late result reaches nobody: no Action Outcome, no
Observation, no Evidence Checkpoint, no finalized Answer or Run Note.
_Avoid_: hung action, timed-out navigation, cancelled action

**Withheld Resource**:
The browser resource an Unsettled Action holds. Every later action on it is
refused outright rather than queued — a later Run's and a new Session's
included — and it reports no page at all in place of the stale one. Reuse
resumes only once the action is observed to end, so Answer availability and
safe reuse are separate boundaries: a Run can finish while its resource stays
withheld, and one whose action never ends stays withheld.
_Avoid_: locked tab, busy browser, browser lock

**Browsing Custody**:
The holder of one browser resource, and the only way anything reaches it. It
is held by whoever owns the resource — the app for the shared tab, the tab
pool for a Subagent's — never by a Run, because it outlives every Run that
uses it. Abandoning it ends the waits in flight and withholds the resource;
nothing else can act on that resource behind those waits' backs.
_Avoid_: browser lease, tab guard, controller wrapper

**Abandon**:
Ending a Run's or a Subagent's wait on a browser action without ending the
action. A decision does it — Stop, the orchestrator's cancel, a Session Reset
— and Finalization never does: a Subagent's bounded report is not a
cancellation. What is abandoned becomes an Unsettled Action.
_Avoid_: cancel the action, kill the navigation, abort

**Ref**:
A numbered handle in a page read naming one element in the viewport at the
moment of that read, never one inside an inert container, for click, type,
and Look to act on. A number names the same element until the page is
collected again; a number used after a collect the model did not see in full
names an element only if it still is that element, otherwise the action is
refused.
_Avoid_: selector, element id, index

**Cover**:
What a click or type finds over its target's centre: the element the page's
own hit test answers with in the target's place. The Action Outcome names it
as a page read names refs, and it is what must be acted on before that target
can be reached.
_Avoid_: overlay, blocker, obstruction, dialog covering the target

**Not Shown**:
A listed target the page's own hit test does not find at its centre at all —
inside an inert, clipped or hidden container. It is not covered: no dismissal
reaches it, and the next move is a target that was shown.
_Avoid_: hidden ref, blocked by overlay, unreachable, covered

**Page Preview**:
The opening stretch of a page's text, capped, that an Action Outcome carries so
the model can orient and choose without reading. It is not the page: a preview
that was cut says how much of the page it shows and how many parts a Page Read
of it comes in (#290), and the rest is reached by a Page Read, never by
scrolling it into view.
_Avoid_: digest, page text, snippet

**Page Read**:
The whole text of a page as `read_page` returns it — headings, paragraphs,
list items, table rows, pre blocks, and a container's own prose where a page
wraps a paragraph in no element (#265) — from the top, in numbered parts when
it exceeds one result. Every Page Read says which part it is of how many, a
page of one part included (#290). Reading a page is one Page Read, or one per
part, never a sequence of scrolls; each part of an unchanged page is its own
first observation.
_Avoid_: full read, page dump, read the whole page by scrolling

**Selected Passage**:
One text block of a landed page or a Page Read that the Decision Model chose
as stating an Asked Item, which the Run carried verbatim in the Action
Outcome and recorded as an Evidence Checkpoint in the same round. Removed on
2026-09-28 (ADR 0069, superseded; #283): no Run makes one. The term names
what the captures, Round Audits and Shadow Replays taken before then record.
_Avoid_: highlight, snippet, auto-excerpt, extracted quote

**New In View**:
What a scroll's Action Outcome reports: the refs and page text that entered the
viewport, formatted and capped as a Page Preview is. A scroll
that moved the window without bringing anything in answers End of Page instead.
_Avoid_: scroll delta, diff, what changed

**Held Page**:
A page the Session holds at least one accepted web Observation from, by
canonical URL, whichever Run or Subagent recorded it and however many rounds
ago. It is not a page to avoid: it is opened for what its Observations do not
state, and the Action Outcome that lands on it names what they do, so nothing
held is recorded twice. User Observations name no page and never make one.
_Avoid_: inherited page, cached page, already-read page, page in hand

**End of Page**:
The one-line answer a scroll gives in place of New In View when nothing entered
the viewport. It is a fact about the page, not advice: the repeat rail reads it
as the page not moving, so the next identical scroll is refused.
_Avoid_: bottom reached, nothing new, no-op scroll

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
A consent wall: an element rendered over page content whose controls offer
a cookie or consent choice, whether or not it declares a dialog role.
Auto-dismissed wherever it is met — at navigation, at read, and when it
blocks an action — privacy-preferring control first. A consent strip that
covers nothing is not a Consent Dialog and is left to the model.
_Avoid_: cookie banner, consent banner, GDPR popup, cookie wall

**Not-found Page**:
A page whose server or title says the address names nothing — a 404 or 410
answer, or a title that says the page was not found. It is not a Blocker:
there is no content behind it to reach, and no Escalation clears it. It is
not an Unavailable Page either: a not-found answer is about the address, an
outage is about the site.
_Avoid_: 404, dead link, broken URL, soft 404

**Not-found Landing**:
A browser action settling on a Not-found Page. Its Action Outcome says so, as
a fact about the page, on whatever action landed there; it is neutral to
Progress; and it is not escape from a Search Loop. Only a Composed Address
landing there spends the site's allowance.
_Avoid_: 404 hit, failed navigate, bad guess

**Unavailable Page**:
A page whose server or title says the site could not serve the address right
now — a 5xx answer, or a title that says the service is offline, unavailable,
in error or under maintenance. It says nothing about the address: the same
address may serve later. It is not a Blocker — there is no content behind it
to reach and no Escalation clears it, the user cannot bring a site back
online — and not a Not-found Page, which is about the address.
_Avoid_: outage page, error page, 5xx, down, wall, interstitial

**Unavailable Landing**:
A browser action settling on an Unavailable Page. Its Action Outcome says so,
as a fact about the page, on whatever action landed there, with the advice
to retry once later or use another source; it is neutral to Progress; it is
not escape from a Search Loop; and it spends no Composed Address allowance,
because it is not evidence the address was wrong.
_Avoid_: outage hit, failed navigate, timeout, wall

**Empty Landing**:
A browser action arriving at another document — a navigation, a step through
history, a click, or typing or a key press the page left under — and settling
on a page the Run was shown no text from, and that is no Blocker, Not-found
Page or Unavailable Page. It is a fact about what the Run was shown, never about the page or its address:
a site's template around nothing, a document whose text was not collected
and a page not yet rendered all land the same. Its Action Outcome says so,
with the advice to read it or Look at it once or use another source; it is
neutral to Progress; it is not escape from a Search Loop, though a Page Read
that returns text from that page is; it spends no Composed Address
allowance, because it is not evidence the address was wrong; and it takes
no page out of a Run's sources. An Unfinished Load that showed no text is
one. A change of address inside one document is not: no document arrived,
and what it shows may not be there yet.
_Avoid_: blank page, empty page, soft 404, failed render, rendered empty

**Unfinished Load**:
A page arrival by a click, by typing, by a key press or by a step through
history whose load had not finished when the wait for it ended. The action
itself ended, so nothing is unsettled and no resource is withheld: its Action
Outcome carries the page as it stood and says the page was still loading, so
what is shown may be less than the page. A navigation is never one — its load
is the action, and a load that outlives its wait is an Unsettled Action.
_Avoid_: slow page, timeout, still loading, partial page, Unsettled Action

**Blocked Action**:
A click or type the browser did not perform because the page's hit test at
the target's point did not reach the target: the target was Covered — a
consent banner's underlay sat over it, and the outcome names that Cover — or
Not Shown, inside a hidden or inert container such as a closed drawer. The
call succeeded in the sense that it ran and reported; it reached nothing, so
its Action Outcome says so and it is not escape from a Search Loop. It is
distinct from a refused call, which a gate stopped before it ran, and from a
failed call, which ran and errored.
_Avoid_: overlay error, intercepted click, blocked by overlay (as a category)

**Composed Address**:
A URL the model navigates to that it was not shown this Run — not an href in a
result it read, not a page the Run landed on, not a source in Session
Evidence, not the address of a popup the Run was told was denied, not the
address of a Result Pick. An Offered
Address is any of those five, and an href is offered
whole: the address the link carries, not the shortened form a snapshot may
print it in. A Result Pick's address is offered from the moment it is picked,
since the page showed it to the Run; the listing's other links below the fold
are not, since the model never read them. A site allows one
Not-found Landing by a Composed Address per Run; after it, a Composed Address
to that site is rewritten into a search of that site, and searches and
Offered Addresses stay open. The search it is rewritten into is a search to
everything but a Search Loop, which it neither continues nor escapes and
which never refuses it. An Unavailable Landing spends nothing. A site
is a registrable domain, so jpl.nasa.gov and science.nasa.gov are one site.
_Avoid_: guessed URL, made-up URL, typed URL, direct URL

**Unseen Phrase**:
A quoted span in a search's terms that appears in nothing the Run was shown —
no observation, not the user's command, no Steering directive, no Subagent
Report — and a Search Echo is not being shown. It is searched unquoted, its
words kept, and the outcome says so (#267, ADR 0064). A phrase quoted from
the user's own words is never unseen; for a Subagent, its brief plays the
command's part. Sight is the Run's own: what an earlier Run in the Session
showed is not what this Run was shown.
_Avoid_: hallucinated title, invented quote, fabricated phrase

**Search Echo**:
A line of a search results observation that carries the search's own terms
back — the page title, the search box's value, a "results for" heading. It
is the engine repeating the Run's words, not a page carrying them, so it is
not sight for an Unseen Phrase (#267, ADR 0064). A result's snippet that
carries the phrase is not an echo.
_Avoid_: query echo, reflected query

**Web Engine**:
A general web search engine from a fixed list, known by its registrable
domain — Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu, Brave Search (on
search.brave.com only), Startpage, Ecosia, Mojeek, Qwant, Kagi — as against a
site's own search. Only its web search is a search on it — its maps, books or
finance pages are not. A Search URL on any other site is a site search,
whatever parameter it names. An engine missing from the list is a capture finding, not
a bug (#270, ADR 0067).
_Avoid_: search engine (when a site search is meant), surface

**Run Engine**:
The Web Engine every search of a Run composes on: the engine the user named in
their own words this Run — the command or a Steering directive, the last one
named — else the app's default, DuckDuckGo. Per Run only; a follow-up starts
at DuckDuckGo again. A Subagent's is the Run Engine of the Run that spawned
it, since its brief is not the user's words. A Composed Address rewrite runs
its site search on it (#270, ADR 0067).
_Avoid_: default engine, search provider

**Engine Rewrite**:
A model search on a Web Engine other than the Run Engine, rewritten in the
same round to the Run Engine's Search URL with its terms kept, the outcome's
first line saying so. First in the rewrite chain: the Composed Address and
Unseen Phrase rewrites see the call it produced, and when more than one
applies each adds its own line, the engine's first. An engine's home page is
no search, and what is typed into its box is never rewritten (#270, ADR 0067).
_Avoid_: engine normalisation, redirect

**Blocker**:
Anything between the agent and page content: Consent Dialogs, CAPTCHAs,
login walls, paywalls, age gates, file-select dialogs. Detected mechanically
— in code, at navigation and at read — then escalated; never auto-cleared
(the Consent Dialog is the one exception). A landing on one is not escape
from a Search Loop: the content is behind it.
_Avoid_: obstacle

**Challenge**:
A Blocker the user can clear on screen — a CAPTCHA or human-verification
wall. Escalation asks the user to complete it in view.
_Avoid_: captcha wall

**Network Block**:
A Blocker no in-view action clears — the site refuses this network or
session outright. Escalation offers sign-in or a different route.
_Avoid_: IP ban, blacklist

**Login Wall**:
A Blocker whose content needs a signed-in session — only the user can sign
in, and the session persists in the app profile afterwards. Escalation asks
them to sign in once in the browser tab.
_Avoid_: paywall, auth error

**Escalation**:
Handing a Blocker from the agent to the user via a spoken ask — the fallback
when no automatic path exists. Not a Tier Escalation, which raises a Run's
Effort Tier.

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
