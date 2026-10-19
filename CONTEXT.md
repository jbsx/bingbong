# Bing Bong

A voice-driven browser shell: a local voice pipeline (wake word, STT, TTS), a
real embedded browser with a numbered-ref interaction surface for an agent to
act through, and a dashboard that shows what is happening. This branch
strips the generating-model layers — the orchestrator, its subagents, the
Session and evidence machinery, vision — and keeps one model, Jev, the
Decision Model (the `kachow` branch, `main` since 2026-10-17). The glossary
below is inherited from the orchestrator's `main` with the removed
sections cut; an entry in Voice, Views or Browser that names a Run Plan, a
Session, a Subagent or an Answer contract describes machinery that is gone
here and names what is left to build.

## Language


### Voice

**Wake Word**:
The phrase that opens a Listen. On this branch it opens a Hot Listen, and a
wake heard while one is open changes nothing: one wake, one spoken session.
_Avoid_: hotword, trigger phrase

**Listen**:
An open microphone window in which one Utterance is captured and transcribed.
One utterance per activation — the Hot Listen is the one exception.
_Avoid_: recording session

**Hot Listen**:
The Listen one Wake Word opens on this branch: it stays open after an
Utterance is submitted, takes the next Utterance as the next command without
another wake, and closes after a stretch of silence, or at once when the user
closes it (disarm, Escape, the abort head). A wake heard while it is open
changes nothing. It is why one wake, not one per command, is the
price of a spoken session.
_Avoid_: conversation mode, follow-up window, always-on listening

**Reaction**:
The one clock the user feels: the time from an Utterance's Endpoint to the
first change in the browser pane that the command caused, or to the first
spoken word when the command's output is speech. The measure of "instant";
wake-to-chime is a separate clock. Judged by its distribution, never by one
turn.
_Avoid_: latency, response time, end-to-end time, speed

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

**Ducking**:
The music dropping under the voice (#344): while the ear is open — from a
wake, a push-to-talk or a Hot Listen's next speech until that Utterance
ends, its Command fired or the line dropped — while a line is spoken and
while the Timer rings, main sets the playing video's volume to 15 % of
what it was, low but never silent, and puts it back when the last of them
lets go. YouTube's own remembered volume is never told the floor, and a
`volume` verb spoken meanwhile sets the volume put back. The system's
volume is never touched, and the music is never paused for it.
_Avoid_: muting, auto-pause

**Abort Head**:
The always-on recognizer for "stop now" — the one bare-speech activation path.
Halts whatever the app is doing: speech in flight, or a Command whose action
has not ended. Its false-positive risk is accepted until observed in practice.
_Avoid_: cancel word, stop head

**Task**:
What an Utterance becomes on this branch: one or more Commands the shell
fires on its own reading, without the user speaking between them, until the
Decision Model reads the page as what was asked for. The first Command is
read as any Command is; a Task goes on after a Command the Decision Model
read and ends after one the Local Match settled, since the grammar and exact
labels are whole by construction and plain English is where "and then"
lives — save a Local-Matched `navigate` of an address with words past it
("go to twitter and open donald trumps profile"), which goes on to read the
rest on the landing. It searches each site at most once. Capped at five
actions; ended by the next Utterance, Escape or the Abort Head like any
Command; never confirmed.
_Avoid_: plan, goal, intent, errand, run, session

**Hop**:
One Command of a Task after the first, fired on the reading of the page the
previous Command landed on: the same three Choices, with `done` among the
verbs and the pages already visited never offered. A Hop types only words
the user said and never guesses when the Decision Model does not answer.
Hops are numbered from the first Command, hop 0; a reading that ends the
Task without firing (a Verdict) is a hop of its own on the record.
The state a Hop is read on tells what each earlier action did, in facts
("nothing changed", "opened x.com/elonmusk", "the address did not change; a
pop-up appeared over the page: "Close", "Log in" and "Sign up""): what the
Verdict reads, since over the refs alone a sheet over a profile and a
sign-in bar at the foot of the post itself look the same. A Hop that
changed nothing sets its target aside, and two such Hops in a row end the
Task. A Hop never searches
the words again, except that on a site the Task has not searched it may
search that site once (a **Site Scope**). A Hop that names no target opens
the likeliest result only on a page whose address is a Search URL; anywhere
else the Task ends on the page where it stands.
_Avoid_: step, round, turn, continuation

**Verdict**:
The fourth answer every Hop carries beside its Command: is this page what
the user asked for — yes, something is in the way of it (a sign-in prompt, a
pop-up, a cookie notice, a challenge), or not yet. An end is a Verdict,
never a verb's plurality: a Task ends `done` only on a sure yes; a sure "in
the way" is a wall, its line spoken ("A pop-up is in the way."), unless the
Command acts on the pop-up itself, which fires; a reading with no next step
and no sure yes ends `unsure` and says so ("I'm not sure this is it."). Sure
is the Choice bar, 0.7. Either end is read against the page as it is now: a
page that moved under the reading (another address or title, a pop-up
opened or closed, a different count of refs) is read again, once per Task.
The same Jev call as the Command's reading: no round trip is added.
_Avoid_: check, verification, judge, confirmation

**Set Aside**:
A target a Hop acted on that changed nothing: no navigation, and the click's
own verdict "no observable change". It is known by its label and its address
(the link's own, or the page's for a control with none), never by its ref
number, which changes between Hops, and it is not offered again in that Task.
_Avoid_: excluded, blacklisted, retried

**Dismiss Phrase**:
Words that close the pop-up covering the page: exit, close, dismiss, get rid
of, go away, cancel, x or no thanks, alone or with "this", "that", "it", "out
of this", "the pop-up" or "the dialog". With a dialog open they are settled
before the Decision Model is asked: the dialog's own close control is clicked
(never a link), else Escape is pressed, and the Answer is "Closed the
pop-up.". With no dialog open the same words read as they always did.
_Avoid_: close command, escape phrase

**Command**:
One verb, at most one target on the page and one Slot, performed at once.
A verb is an action the browser can take — `navigate` to an address,
`search` for words, `click`, `type`, scroll, back, press, read, clear, stop
— never a word the user said: "open" is words, and whether it means a
navigate, a search or a click is the reading's to settle. There is no plan
and no confirmation: a Command is the unit a Task is made of, and an
Utterance is a Task of one or more. A Command that is not for the page at
all is dropped, not answered.
_Avoid_: run, request, intent; `open` as a verb

**Slot**:
The words of an Utterance a Command carries verbatim: the search terms, the
text to type, the address to navigate to. Chosen from the Utterance's own words,
never composed — a Name Match may carry them in the page's spelling, and
that is the one amendment.
_Avoid_: argument, parameter, entity, free text

**Site Scope**:
The site a `search` spoken on a page is looked for on, when the Decision Model
reads its words as pointing on that site but not on that page ("go to donald
trumps profile" on x.com). The site is the page's host without `www.`
(`x.com`, `en.wikipedia.org`), on a real page that is no Web Engine's web
search (its front page or results; its maps or finance pages are a site); a
site's own search page is still the site. A scoped `search` is a DuckDuckGo
search with `site:<host>` ahead of the Slot's words, never the site's own
search box, and its Answer names the site ("Searched x.com for …"). Asked in
the same call as the other Choices, at hop 0 and at any later Hop on a site
the Task has not yet searched. Words the Decision Model reads as pointing at
this page are never searched: the likeliest element it offered is opened,
or nothing is. A wrong `where` is a Misfire.
_Avoid_: site search (a Search URL on a site), domain filter

**Page Terms**:
The names the page shows at the moment speech starts — link titles, channel
names, the suggestions under a search box, the page's title — read off the
page collected at speech start, ranked by how often the page shows them and
capped. They bias the decode of the one Utterance spoken over that page,
less than the Bias Lexicon does, and they are the first candidates a Name
Match reads against. Replaced at the next speech start; never kept.
_Avoid_: dynamic vocabulary, on-screen hotwords, context phrases

**Name Match**:
Reading a spoken Slot — search terms, text to type — after recognition
against the names it could have been: the Page Terms, then the Learned
Terms, by sound. The nearest within tolerance is the spelling the Command
carries; what was heard stays on the decision record. An address and a key
are never matched, a typed line never is, and nothing asks "did you mean":
a wrong Name Match is a Misfire. It is how the recogniser is allowed to be
wrong about a name.
_Avoid_: fuzzy match, autocorrect, spell check, entity resolution

**Local Match**:
A Command settled from the Utterance and the page alone, without asking the
Decision Model — fixed phrases only: the CLI grammar, the control words
(scroll, back, reload, read, clear, stop, resume, a key), the Timer's and
the Player's lines, an opening phrase with an address-shaped Slot ("open
youtube", "go to x.com"), and a plain verb with the one element the words
name exactly — the label exactly one element carries, or the Nth result on a
search page ("the first result"). Search terms ("search for …", "look up
…") and words about the page are never its: they go to the Decision Model.
It is the fastest reading, and the only one that fires when the Decision
Model does not answer — a line it does not settle is then no Command. It
never guesses: there is no lenient reading, no nearest label, no words
turned into a search.
_Avoid_: grammar hit, regex path, offline mode, best guess

**Early Fire**:
Acting on a partial transcript, before the Endpoint, once the words so far
read as a complete Command. The Endpoint then only closes the Utterance; a
Command that no partial settled is read at the Endpoint as usual.
_Avoid_: speculative execution, eager execution, streaming intent

**Misfire**:
A Command that did what was heard rather than what was meant: a split
Utterance, a mishear, a wrong target, an Early Fire on half a sentence, a
Hop that went on when the user wanted to stop (an overrun). It is recovered
by the next Command and never prevented by asking first. Counted, so
accuracy can be worked on once Reaction is won.
_Avoid_: error, wrong action, false positive, hallucination

**Ask**:
What one Jev call was sent: the state text and the questions with their
options, exactly as asked. Every Ask is kept beside the decision log, and
the record of the Command it was read for names it, so a misread can be
asked again.
_Avoid_: prompt, request log

**Jev Case**:
An Ask the owner promoted from a real misread, with the answer each
question should get: a label, or a label it must not be. The Jev Corpus is
the folder of them that every change to Jev's state text or question
wording is replayed against. A change is accepted only if it passes its own
case and leaves no other case worse. Misreads are fixed through the corpus,
never by a rule for the one case.
_Avoid_: test prompt, golden, eval

**Bias Lexicon**:
The app's own vocabulary that the STT decoder is biased toward while decoding
— the CLI grammar's verbs, settings, dashboard and navigation terms, plus
mishears discovered in use ("scroll" heard as "Screw that."). Two parts:
the Seed Lexicon and Learned Terms. Extending it is the first response to a
misheard domain word.
It preferences what is heard; it never restricts what can be said.
_Avoid_: hotword list, dictionary, custom vocabulary

**Seed Lexicon**:
The compiled-in part of the Bias Lexicon: the app's shipped vocabulary.
_Avoid_: base lexicon, default words

**Mishear**:
A divergence between what was said and what the transcript carries. On this
branch two things repair one without asking: a Name Match carries the name
the page shows, and the name is learned at once; a chain of retries that
ends with the user moving on proposes its last Slot, admitted only when it
recurs. The user is never asked; the pipeline handles it.
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
A Bias Lexicon entry admitted at runtime: a name the page witnessed a Name
Match on is admitted at once; a name a retry chain settled on is admitted
when it recurs; the title of a song that stayed (Player, #345) is admitted
at once. Same decode effect as the Seed Lexicon, and the second
candidate list a Name Match reads; capped (default 500, least-recently-used
evicted, every spoken transcript touching the terms it carries), survives
Sessions and restarts, and is inspected or edited only in Settings — never
voice-reachable. A term deleted there is never readmitted by either door.
_Avoid_: custom word, user dictionary entry

### Views

**Prompt Bar**:
The single typed-input surface, living in the Feed Panel's footer. A typed
line is a Command exactly as a spoken one is, read the same way; a delivered
draft clears on Enter, and a rejected one is restored — never silently
dropped.
_Avoid_: command box, steer box, input bar, activity bar

**Feed**:
The session-scoped projection of pipeline events. One projection feeds the
dashboard, the overlay panel, and (formerly) the idle digest.

**Feed Entry**:
One rendered item in the Feed. On this branch a Command is one entry: the
words heard and the action taken; an Utterance read as no Command is one
greyed entry of the words alone. A Task is one entry too: its words once,
one line beneath them for each Hop that fired (an abandoned last Hop greyed,
a Hop that met a wall in the failure colour), every Hop's steps in one Run
Detail, and one Answer, the last Hop's. A closing Hop that fires nothing
(`done`, `no next step`, `not read`) adds nothing.
_Avoid_: message

**Answer**:
One assistant turn's single output, carrying two renderings: a Spoken one
for the ear and a Card one for the view. An Answer renders as at most one
Feed Entry — the Card when it exists, otherwise the Spoken rendering. Both
renderings are written in English, the product's one language, whatever
language the command or the pages read were in.
Every Command leaves exactly one Answer (#333), and no model writes it: a
Page Read's Card is the page title over the page's own words (what `read`
speaks); a failure's plain line, shown once in the failure colour; else the
verb's fixed sentence filled from facts the Command and the page hold
("Opened Lighthouse page.", "Clicked “Say hello”.", "Scrolled down.").
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
Collapsed. A View Preference, resizable. Opened only by a human act, and it
stays open through a Command's end and a Stop (2026-10-18 ruling). Hidden
while the settings page shows — edge tab and Peek Card too — and back
exactly as it was on leaving: open or collapsed, Overlay or Docked, same
width. Hiding is not a change of its state, so it is not the system opening
or closing it (owner ruling 2026-10-18, #334).
_Avoid_: activity bar, sidebar, activity sidebar

**Idle Screen**:
What renders while nothing is happening: a bento of glass tiles on the Card
Slot grid over a quiet glow (#352) — the clock and date bare in the
top-left cell, the owner's Pinned Cards in the rest — the weather (the current
conditions, today's high, low, rain chance and sun times, the six coming
hours and the three coming days, all in the city's own clock — the sky as a
colored glyph, every temperature in its hue from blue through green to red,
rain in blue, so the day reads from across the room; the hours' temperature
row shows even when every hour reads the same), the AI Usage card, the
Calendar, the News card with Today's Highlight and Big News, the Weight
card with each Person's latest Weigh-in and their line, and the Last Page with its way
back — and under them, only while any of them is there,
a dock of chips: the Timer when one is set, today's next event when the
Calendar has one, and Now Playing while the Player holds a song; the grid's
rows shrink to make its room. The canvas is the sheet's own with one
radial glow from above the top edge, tinted by the weather — rain blue for
anything falling, cloud grey for overcast and fog, sun amber for a clear or
partly cloudy sky while the sun is up, night violet from today's sunset to
its sunrise, none with the weather unset — and nothing on it moves but the
clock and the progress bars (owner, 2026-10-19: "i like e but without the
distracting background"). Every redesign keeps every field the screen
shows and changes only placement, order and styling (owner, 2026-10-19: "i
dont want to collapse the information"). It is laid out for the appliance's 21-inch 1920×1080 display
(owner, 2026-10-19), to be read from a couple of metres away (owner,
2026-10-19: "the components are too small"): nothing is set below 16 px,
and the figures that matter — the temperatures, the gauges, the countdown,
today's date — are far larger. A smaller window shows the same layout
scaled down to fit. Never shows Feed Entries (#70); never comes up over a running
Command, an open mic or the settings page. Once up it stays up through the
voice half and the pipeline — the ear opening, a heard line, a reading —
with the Status Capsule shown on it while they run, so a Command that never
needs the pane (the Timer, a Stop, `done`, a line read as no Command, and
every Player verb, `play <words>` included — #344) is heard and performed
over it: a song is searched for and played in the hidden pane, and the
music plays on there. Input, a Command that acts on the pane, or "show the
video" / "show it" (the one music line that wakes it, onto the watch page)
unmounts it; the browser pane is only hidden beneath it, never reset. A
printable key typed on it starts a line in the Prompt Bar: the Feed panel
opens if collapsed and the key is the draft's first character. The
2026-10-18 ruling put the Last Page on it — the one piece of history the
screen carries, and the owner's reversal of #70's "clock and weather only".
_Avoid_: screensaver

**Now Playing**:
The Idle Screen's chip of the song the Player holds (#344), in the dock
under the grid while it holds one (in a Card Slot for a day on 2026-10-19,
back in the dock with #352; pinning `music` still decides whether it
shows): its thumbnail, title · channel, a progress bar
with the time played and the length, a loop glyph while it loops, a pause
glyph while paused, and the next three queued titles on one line. It follows the
Player's once-a-second read, so nothing new crosses CDP for it. A song that
ran out with nothing queued stays on it, shown ended, and `play` plays it
again from the start. A tap pauses or plays it, on the pointer going down
like the other idle controls, and unlike them leaves the Idle Screen up. A
ringing Timer takes its place.
_Avoid_: mini player, media card

**Card Slot**:
A box of whole cells on the Idle Screen's grid — three columns of 600 px by
four rows sharing the canvas's height, the dock's row taken off while it
shows, on the 1920×1080 canvas (#352) — that a card is handed and draws its
pieces inside as glass tiles, one a cell, with the grid's gap between them,
so the screen reads as one bento (owner, 2026-10-19: "i plan on having more
widgets and cards"; the bento picked from the prototype's variants the same
day). The top-left cell is the clock's, never a card's. The box itself has
no fill. A card offers the sizes it can draw at, largest first: the weather
1×3 (now, the hours, the days), 1×2, 1×1; the AI Usage 1×2 (rings, chart),
1×1; the Calendar 1×2 (the month with entries) only while it has events,
else 1×1 (this week and next); News 2×2 (the highlight beside Big News),
1×2 (one over the other), 1×1; the Weight card 1×2 (a row per Person: the
weight, the change against a week ago and the body fat over their own
line), 1×1 (each name, the weight and the change) while there is a
Weigh-in, else a 1×1 note; the
Last Page 1×1; a note 1×1. As many Pinned Cards are shown as the grid
holds before any of them takes a larger box (owner, 2026-10-19: "why is the
calendar hidden now?" — the News card's 2×2 had pushed the event-less
Calendar off); then each gets the largest that still fits, the cards with
something to show sized first, so an empty one — the Calendar with no
events this month — yields its room down to its smallest size, and a card
that fits nowhere is left off. The boxes are laid down in pinned order a
column at a time — or, when that order cannot hold every box, the cards
with something to show first. A tile holds to its box: its words fit or
step down, never sizing a row (the overlap the 2026-10-19 screenshot
found). Not yet built: a rotating Card Slot for
cards past what fits (deferred until pinned cards no longer fit).
_Avoid_: widget

**Tile**:
One piece of a card on the Idle Screen, one Card Slot cell or more: glass —
the panel let through and the canvas blurred behind it, a large radius, no
hairline, no shadow — or bare, its words straight on the glow (the clock,
the weather now). A card is drawn as tiles with the grid's gap between
them, so the screen reads as one bento (#352).
_Avoid_: panel, box

**Dock**:
The row of chips under the Idle Screen's grid — the Timer, Up Next and Now
Playing — shown only while one of them is there; the grid's rows shrink to
make its room (#352). A ringing Timer takes Now Playing's place.
_Avoid_: strip, tray

**Pinned Cards**:
The Idle Screen's cards the owner chose in settings, in the order they fill
the grid's columns (untouched: weather, Calendar, Last Page, Weight, AI
Usage, News, Now Playing — the order that puts the weather down the left,
the Calendar and the Last Page over the Weight card in the middle and the
AI Usage over News down the right, #352, #350; the Weight card ahead of
the AI Usage and News so its two cells come from News's 2×2, not the usage
chart); one left out is not shown. A card added after the list was saved
(News, #346; Weight, #350) joins its end once; unpinned after that, it
stays off. A list saved as an earlier default — from before the
three-by-four grid, or from before the Weight card — is read as today's
default.
A card that has nothing to say — the weather unset or loading, the usage
dashboard unreachable, no news yet — keeps a small Card Slot with its line.

**AI Usage**:
The Idle Screen's card of AI providers' limits, read from the owner's
usage dashboard on the LAN (an HTTP server outside this repo,
`http://192.168.1.73:4321` by default, set in settings; empty hides it;
2026-10-19 ask: "the line chart and the gauges for codex and claude").
Two tiles down the right of the grid (#352). Each shown provider is a
ring in its tone (owner, 2026-10-19: "i like the ring progress bars"): the
outer arc the share of the limit used, the number in the middle, a thin
inner arc how much of the window has run to its reset — the two clocks the
dashboard's dot gauge showed — then its name and plan and "7d · resets 1d
1h". Its other shown windows are smaller rings beside it while the row
holds three or fewer, else bars under it; four or five providers shrink
their rings to stay in one row. Under them, the last twelve hours of the
charted windows as lines over a faint fill, a dot where each ends, a
5-hour one solid, a longer one dashed, and when the dashboard last
refreshed, amber once that is over five minutes old. What it shows is
chosen in settings the way the dashboard's ⚙ Metrics panel chooses it
(2026-10-19 ruling: kept in Bing Bong, any of the dashboard's providers):
which providers (Codex and Claude untouched), and per provider which
windows show, which one is the gauge (untouched, the 5-hour, else the
7-day) and which are charted (untouched, the gauge alone). The dashboard
keeps its own choices in that browser's storage, so the two never share
them. Main fetches it (the dashboard sends no CORS headers), polled once a
minute while the Idle Screen shows; a failed poll keeps the last numbers.
Read-only: a tap only wakes the dashboard.
_Avoid_: quota, billing

**Calendar**:
A month view on the Idle Screen, a card in the row with the weather and
the AI Usage (2026-10-19 asks: "have a calendar in the idle screen", then
"in a card by the ai usage dashboard and the weather widget", "a proper
sized calender so that the events on the days can go within the date
itself"): the locale's weeks, each day a box holding its entries — its
bank holiday by name on green ("bank holidays in the UK marked", England
and Wales's), then its events, an all-day one as a red bar and a timed one
as a dot and its title, "+N" beside the date past one — today's date in a
red disc, the next bank holiday named in the header when it falls this
month or next, else "No events" when there are none. A glass tile (#352):
a 1×2 Card Slot while the month has events, the whole month with its
entries; a month with no events asks for one cell and yields the rest to
cards with something to show — in one cell it draws this week and next, a
dot under a day with an entry. Bank holidays are computed, not
fetched — the rules plus the proclaimed one-offs, matching
gov.uk/bank-holidays.json 2019–2028; a new proclamation is added by hand.
Events come from Calendar Sources — one per provider, each
answering the events in a range — that main asks together, a failing one
left out; the Idle Screen leads its bottom band with Up Next, today's
timed event under way or coming (an all-day one only when nothing timed
is left) and how many more today. No source is wired yet: the owner named
Google Calendar and Outlook as the ones to come, so today the Calendar is
the month alone and Up Next never shows. Read-only.
_Avoid_: agenda (for the month), schedule

**News**:
The Idle Screen's card of what is going on in the owner's world (2026-10-19
ask: "i want to be in the know about what is going on in the world.
specifically the world i interact with mostly"): a story belongs on it when
something in one of the owner's circles jumped far above that circle's
normal day and the owner has not been shown it yet, and what is still
big. A Pinned Card offering 2×2, 1×2 and 1×1 Card Slots, drawn as glass
tiles (#352): at 2×2 Today's Highlight beside Big News, at 1×2 the
highlight over Big News, at 1×1 the highlight alone; with nothing in Big
News the highlight takes the whole box, with no filler line. The
highlight is its Story Image, two chips — "Today's highlight" and the
topic — its headline in two beats, then its number large, its comments,
its source and site. Where its Story Brief is written, the headline's
lead stands alone and the brief's two lines follow it, each a line of its
own (owner, 2026-10-19: "the list of github repo names say nothing about
them and why theyre worth my attention. the daily news is a big blob of
text that requires careful parsing"). A headline breaks into its lead, bold and never cut,
and its tail, quiet (`leadAndTail`: at the first of ": ", ", and ",
", with ", " — ", ", " at least fifteen characters in, the "and" or "with"
kept; a GitHub repo's name over its description; else all lead) — so a
long one reads in two beats rather than as a wall (owner, 2026-10-19: "the
news currently looks like a big text wall"). A Big News line is a number,
its Story Image as a thumbnail, its lead whole, its tail on one line with
an ellipsis where it runs on — the one place a line is cut, by design —
and its number in a pill; with its Story Brief, the lead on two lines at
most, then what it is and why it matters, each on two lines at most. The highlight's words step down to a floor,
then its picture shrinks and goes behind them under a dark scrim, then its
tail goes to one line; a Big News line the box cannot hold whole is left
off. A tap on any
story, or its picture, opens it in the pane. An empty Interest Profile
or a source with nothing yet keeps a small note. Kept deliberately short
(2026-10-19: the owner felt overwhelmed by eleven headlines).
_Avoid_: news feed, headlines, widget

**Interest Profile**:
The owner's circles as a topic list in settings' News section, each topic
carrying the words that match it and the subreddits polled for it (one or
two by default; none polls none); by default the seven read from the
owner's X follows on 2026-10-19 (AI coding agents and harnesses, frontier
AI research, developer tooling and terminal culture, startups and
business, markets and finance as the big event, the Musk orbit, one-offs).
A story matches a topic when its title holds one of the topic's words as a
whole word, or when it came from one of the topic's subreddits; the match
counts topics, not words, so the AI topics — half the follows — weigh no
more for having many words.
_Avoid_: interests, keywords, filter

**Today's Highlight**:
The one story of the last 24 hours that scored highest against the
Interest Profile and has not been shown before: its Story Image, its
title, its source, and the number that made it a story ("1,840 points"). A story's score is its
magnitude's percentile against its own source's recent days (its day and
the six before), so sources compare on one scale, boosted by the topics it
matches; one matching no topic ranks under every one that matches one. The
same story on several sources (the clustering Big News uses) counts once,
at its peak percentile, boosted half again for each source past the first,
and is marked shown under every source's key; a feed's post, counting
nothing, shows no number.
Main polls hourly while the Idle Screen asks, and once on its first show; a
story is shown once, the shown keys kept in userData (news.json) so that
holds across a restart; a poll no source answered keeps the last
highlight. A tap opens the story in the pane through `navigate <link>`, on
the pointer going down like the Last Page's tap, leaving the Idle Screen.
_Avoid_: top story, headline, pick of the day

**Big News**:
The News card's one rolling list of what is still big: at most three
stories, may be fewer or none, read from the story history main keeps in
news.json (every polled story's best score by the day it was polled, and
its cluster, kept 31 days). Stories are clustered as they are recorded —
the same link, the same site with a near-identical title, or the same
proper name (a model named with letters and digits like "GPT-6", a repo
or model "owner/repo" in the title or a GitHub or Hugging Face link) is
one story. A cluster stands at its best score — its percentile in its
source boosted per source past the first, not per topic: the topics rank
a story, the sources make it big — faded by the time since that day,
halving every 20 days, and is listed while it clears a bar
(0.93), best first: a story at the top of its source, on a topic and on
two sources stays about fourteen days; at the top of one source about
two days; one on no topic is never listed. A bar, not a count — a quiet
stretch lists fewer and is never filled up, a busy one keeps its three
biggest. The cluster that is Today's Highlight is never in it. Replaced
This Week and This Month (#349), whose fixed lists showed filler in a
quiet week and repeated one story three times.
_Avoid_: This Week, This Month, digest, top stories, trending

**Story Brief**:
The two short lines a generating model writes for each story the News
card shows — what it is, in plain words, and why it is worth the owner's
attention (the thing in it the owner follows, how big it is on its
source, the other sources carrying it) — from the facts the sources give
(a repo's description, language and stars; a model's task, licence and
tags; a paper's abstract) and nothing else. GLM on Z.ai writes them, by
the owner's ruling (2026-10-19: "i am restricting ourselves to using only
jev is because i want it to be snappy. since its async, i am fine with
using glm for this"): the Command path stays Jev-only; the card is
asynchronous. Written once per story after a poll, in one request, kept
in news.json and dropped with the story history; a story with none — no
key, the writer down, a reply not read — shows its headline as before,
and is asked about again at the next poll. Armed by `ZAI_API_KEY` (or
`BINGBONG_NEWS_WRITER_API_KEY`).
_Avoid_: summary, blurb, description (a repo's description is one of its
facts)

**Story Image**:
The one picture each story the News card shows carries — Today's
Highlight and each Big News line, a handful a poll. In order: the
source's own image for the story (a feed post's media content, image
enclosure or media thumbnail; a GitHub repo's social preview; a Reddit
post's preview or thumbnail), else the article page's preview image
(og:image, then twitter:image, read from the page's head only), else the
source's tile — a box in the source's colour with its name, or its
initial on a thumbnail — never an empty box or a broken image. An SVG, a
favicon, anything under 300 px wide, and the image a site has served for
another story (its logo or default banner) are passed over. Main
downloads each picture once into userData's news-images, drops it with
its story when the history prunes it, and serves it to the dashboard on
its own scheme: the renderer never fetches one. An animated picture
plays through once and holds its last frame, the screen being always
on; animations are shown only when a source supplies them. A story left
with its tile is asked about again a day later, not every poll. No
generated images, no paid APIs.
_Avoid_: thumbnail (for the picture itself; a thumbnail is its small
form in Big News), hero image, og image

**NewsSource**:
Where News stories come from: one site's public listing, answering the
stories published since a time, each with title, link, source, published
time and the source's own magnitude (points, stars, likes). The sources
(#346, #348): Hacker News (its keyless Algolia API, the front page's
points and comments); GitHub trending (the day's trending page, the stars
gained today); Hugging Face, as two sources since their numbers are two
scales — trending models by likes and the daily papers by upvotes; one
source per subreddit an Interest Profile topic names (r/neovim, its top
posts of the day by upvotes); and one source per feed — an RSS or Atom
feed in settings' News section, by default OpenAI, Anthropic (a community
mirror: it publishes none), Google DeepMind, Ars Technica, The Verge and
Electrek (Meta AI and xAI publish none). A feed counts nothing, so its
posts carry no magnitude and score at the feed floor — an ordinary day's
story, the 50th percentile — lifted only by the topics they match and by
the same story on a source that counts. Main asks them together each hour,
each request with its own timeout; a failing one is reported and left
out, never blanking the others, as a failing Calendar Source is; one that
refuses the appliance (403, 429, a challenge page where data was asked
for) rests until local midnight.
_Avoid_: feed for a NewsSource in general (a feed is the RSS or Atom kind),
provider (a provider is a Calendar or AI Usage term)

**Last Page**:
The page the browser pane last showed — its address and title — kept in
userData across restarts. While the app runs it is the live page; after a
restart it is what the pane boots without. The Idle Screen names it in a
one-cell tile of its grid, the `lastPage` Pinned Card (#352), and
`resume` (spoken "resume", "continue", "where was I", "last page", or the
grammar's `resume`) comes back to it: a pane still on a page needs nothing
reopened, so the Command names the page and fires no action; a pane that
boots blank navigates to it. Tapping the Idle Screen's card runs the same
Command. `resume` is the grammar's alone, like `screenshot` and `help`: Jev
is never offered it.
_Avoid_: history, recent page, session restore, bookmark

**Timer**:
One countdown the appliance runs itself, with no website and no model
(2026-10-19 ruling: "an in house timer widget that runs on the idle
screen"). Set by the grammar's `timer <length>` (`5m`, `1h30m`, `2:30`,
`ten minutes`) or spoken ("set a timer for five minutes", "ten minute
timer"); a new one replaces the one running. `timer off`, "cancel the
timer" or "stop the timer" turns it off; "cancel" and "stop" alone are
still the stop verb, and a stop also silences a Timer that is ringing.
The Idle Screen shows it beside the Last Page: the countdown while it
runs, "Time's up" while it rings, and a tap on the ringing card turns it
off. At zero it rings: a synthesized alarm, played back to back through
its own player for at most a minute. It lives in main and does not
survive a restart. `timer` is the grammar's alone: Jev is never offered it.
_Avoid_: alarm (for the countdown), stopwatch, reminder

**Weigh-in**:
One stepping-on of the household's bathroom scale, recorded (#350; owner,
2026-10-19: "keeps track of my weight, along with other metrics the scale
can measure"): the time the reading settled, the weight in kg and the
scale's two resistances — nothing worked out from them, so a Body Profile
edit or a formula fix recomputes the whole history. Kept in
`weighins.json` in userData. Its figures are worked out on every read:
BMI from the height; body fat, water, muscle, bone and lean mass from the
weight, the first resistance and the whole Body Profile (openScale's Trisa
formulas, fed as its QNHandler feeds them); BMR (Mifflin–St Jeor) from the
weight and the profile. A figure the profile cannot support is
unavailable, never a made-up number; one stepping-on with no resistance
measured has no impedance figures. No visceral fat or metabolic age: no
published formula. Deleted from the Weight page for a mis-weigh or a guest.
Each belongs to one Person (#351): the one whose latest Weigh-in is
nearest, with no asking (owner, 2026-10-19: "rather than confirmation, go
with the closest guess"); a wrong guess is moved with one tap, on the
Weigh-in pop-up or on the Weight page. Those recorded before #351 are
Jaish's.
Bing Bong is the scale's only reader (owner: "ill stop using the renpho
app"), so there is no history import and no cloud.
_Avoid_: measurement, reading (for the record), entry

**Scale Listener**:
The part of main that reads the scale over Bluetooth while Bing Bong runs
(#350): BlueZ over the system D-Bus with a pure-JS client (dbus-next — no
native module, no root, no Python), discovery filtered to LE adverts of
the QN service. The scale (a QN-Scale, RENPHO's OEM) only advertises when
stepped on, and its advert carries no weight, so the listener connects:
answers its handshake (the unit set to kg on every connection), reads the
weight frames and records the first stable one of at least 5 kg as the
Weigh-in — its repeats and later stable frames ignored until the owner
steps off. The first QN-family scale it connects to is remembered by
address in settings and others are ignored after that; Forget in the Weight
section clears it. A scale quiet for 15 s is let go. With Bluetooth
missing, off or without LE, it says so once to the log and in the Weight
section, and tries again when an adapter or BlueZ appears; nothing else is
disturbed. The e2e replaces it with a stand-in scale that plays captured
frames from a file, so no test reaches the real scale.
_Avoid_: scale driver, BLE service

**Person**:
Someone the scale serves, with a name and a Body Profile (#351; owner,
2026-10-19: "i live with my brother"): Jaish, the owner, always there and
never removed, and Barun, Jaish's brother; more are added by name in the
Weight section. A Person with no Weigh-in yet is never guessed — the first
one lands on the nearest Person and is moved by a tap — and one whose
"guess me" is off is left out of the guess. Removing a Person, after a
confirm, deletes their Weigh-ins with them. No privacy between People:
everyone at the screen sees every Person.
_Avoid_: user, account, member, profile

**Body Profile**:
A Person's height, date of birth and sex, in settings' Weight section
(#350, #351), that their Weigh-ins' figures are worked out from — the age
is taken on each Weigh-in's own day. Any field may be unset: weight is
still recorded and shown, BMI needs the height, and the rest need all
three; a missing figure says "set your body profile in Settings".
_Avoid_: user profile, account

**Weight section**:
The Settings section for the scale and its People (#351, replacing #350's
Body section; owner: "a new settings ui for in depth customizations for
weigh ins"): the People, each with a Body Profile and "guess me"; the
scale's status, the remembered scale and Forget; the Weight card's People,
the figures each row carries and its line's range (7, 30 or 90 days); and
the Weigh-in pop-up on or off and how long it lingers. Kilograms only.
_Avoid_: body settings, scale settings

**Weight card**:
The Idle Screen's Pinned Card of each Person's latest Weigh-in (#350,
#351; owner: "idle screen should show the weights for both me and my
brother including the line chart"): in a 1×2 Card Slot one row per Person
with a Weigh-in — the name, the weight, its change against their last
Weigh-in a week or more before it, the body fat and their own line of the
last 30 days, each line on its own axis; in one cell each name with the
weight and the change. The People, figures and range are chosen in the
Weight section. With no Weigh-in yet it is a note, "Step on the scale". A
tap on a row opens the Weight page on that Person, on the pointer going
down like the other idle controls.
_Avoid_: weight widget, scale card

**Weight page**:
A full-window view beside Settings, with its own Back (#350; owner:
"idle screen which being clicked on navigates to a full screen page with
all the details and longer historic data"), one Person at a time with a
switch between them (#351): their latest Weigh-in with every
figure and its change since the one before, a chart per figure over 30
days, 90 days, a year or all of it, and every Weigh-in newest first, each
with a Delete and a name chip that moves it to another Person. It says the impedance figures are estimates. Charts are SVG,
drawn like the AI Usage chart; no chart library.
_Avoid_: weight dashboard, history screen

**Weigh-in pop-up**:
While the owner stands on the scale, the weight settling, shown over
whatever is on screen (#350): the live weight while it moves, then the
settled weight with a stable mark, the guessed Person's name and the change
since their previous Weigh-in, and a chip per other Person that moves the
Weigh-in with one tap (#351) — tappable over the browsing pane too; it goes
about 8 s after stepping off (the linger set in the Weight section). Bottom-centre in
the Peek Card's place and size — drawn by the dashboard over the Idle
Screen, Settings and the Weight page, and in the overlay over the browsing
pane, where it outranks the Peek Card and rides an open panel's top. Never
spoken (owner: "never spoken"; nor asked by voice, #351), never focused,
and never activity: it does
not wake the Idle Screen away or hold it off.
_Avoid_: toast, notification, scale overlay

**Player**:
The appliance's music, with YouTube in the browser pane as the player and
the Queue and the verbs in main (2026-10-19 consultation, #343). `play
<words>` opens YouTube's results in the pane, takes the first plain video
(no ad, Short, channel, playlist or "People also watched" shelf), and opens
its watch page. It reads the results' `ytInitialData`, not the cards (a
results page that lands before its cards are drawn is no Empty Landing for
it), and no Jev call is made. A wrong pick is a Misfire. The words are a Slot and
pass the Name Match. `queue <words>` or `add <words>` puts a song at the
end of the Queue, and `play <words> next` at its front. These search
without leaving the song playing: main fetches the results with the
pane's session. The other verbs are one evaluate each on `#movie_player`'s
video:
- `pause`, and `play` alone to unpause.
- `skip` / `next`, and `previous` / "go back a song".
- `loop` / `repeat`, and `loop off` / "stop looping". These set the
  element's `loop` flag.
- `restart` / "start over" / "from the top".
- `louder`, `quieter`, `volume <0–100>`, `mute`, `unmute`. These set the
  element's volume, not the system's.

Main hears the song end through a once-a-second read and opens the next
queued song. An ad plays in the same element, and its end (while
`ad-showing`) is not the song's. A song that is not looping is paused in its
last second, through YouTube's own pause, before YouTube can load an ad and
Autoplay another video. That is its end. With nothing queued, the
song ends and the Player stops. A landing that is not a watch page fails
the Command, and the Player moves to the next queued song. `stop` with
nothing in flight pauses the music, as it silences a ringing Timer. With a
Command in flight, `stop` is still the abort and the music plays on.
YouTube's own "Video paused. Continue watching?" after hours of play is a
pause the Player did not make: the read sees the prompt and clicks Yes,
and Now Playing never shows it paused. "show the video" / "show it" brings
the dashboard up over the watch page (#344).
`play` is the grammar's alone, as `timer` is: Jev is never offered it, and
no partial fires it early. "click play" and "press play" stay the page's
button. `back` stays history and `resume` the Task's.

A wrong pick is corrected in one line (#345). The Player keeps the plain
videos the last `play <words>` read. `not that one`, `next result`, `the
other one` or `wrong one` opens the next of them in the wrong pick's
place, answering `Playing “<title>” instead.`; `the one before` goes back
one; past the last, `No more results.` A pick that plays past 30 s (the
element's own time, an ad's not counted) with no correction, `skip`,
`previous` or `forget` has stayed: its words, normalized as the Name Match
normalizes them, are remembered against its video in `songs.json` beside
the Learned Terms, and survive a restart (the Queue does not). The next
`play` of the same words opens the watch page at once, no results page;
`queue` uses it too. One video per Slot, the latest stay winning; no
match beyond normalizing. A correction forgets the words (a remembered
pick's results are searched then, the wrong video passed by), and
`forget this song` forgets every Slot pointing at the song playing. The
title of a song that stayed joins the Learned Terms, trimmed of bracket
noise (`(Official Video)`, `[unreleased]`), a pipe's tail (`| prod. x`)
and `ft.`/`prod.` credits; a title of "artist - song" teaches each side
too, every one that fits a Learned Term's four words. The decision record
marks a search's pick `remembered` or `searched`.
_Avoid_: music app, media player (for the page's own controls), playlist (for the Queue), liked songs (for the remembered ones)

**Queue**:
The Player's one queue. It holds the song playing (or paused), the songs
queued after it, the songs played before it (what `previous` returns to),
and whether the song loops. `play <words>` replaces the current song and
keeps the Queue. A song queued with nothing playing plays at once. `skip`
clears the loop, and a pause keeps it. It lives in main and does not
survive a restart, as the Timer does not.
_Avoid_: playlist, up next (for the whole queue)

**Toolbar**:
The one reserved band at the window's top: Status Capsule left, address
field center, feed and settings controls right. The window's only drag
region; never covers the browsing pane.
_Avoid_: header, dashboard header, browser chrome, title bar

**Status Capsule**:
The single control naming the assistant's state — orb, pill, and the live
run/voice hints collapsed into one pill-shaped surface. It names each state
once — the pill says the state, the hint carries only instruction, the live
words or the elapsed time — and never grows past its third of the Toolbar:
long text ellipsizes. Its orb is the feed's assistant mark: one visual
identity for "this is Bing Bong" — save that a failed Command's mark (the
Peek Card's dot, the Feed Answer's mark and rail) takes the failure colour,
so a failure never reads as a success (owner ruling 2026-10-18, #329).
Awake and waiting it says "Ready" (never "Idle": the Idle Screen is another
state); after a Stop it says "Stopped" in a neutral colour — a Stop is the
user's own act, not a failure (#334).
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
The visible page, navigation state, media state, and transient tabs. On this
branch nothing discards it: there is no Session to end, and the Idle Screen
hides the pane rather than resetting it, so the page is there when the
dashboard returns. A restart loses it; the Last Page is what survives. The
Browser Profile (logins, storage) remains across both.
_Avoid_: browser context, browser workspace

**Action Outcome**:
The resulting state returned by a browser, media, application, setting, panel,
or Session action, including a fresh page snapshot when a browser action
meaningfully changes the page. It is the next decision's observation, not merely
confirmation that a call ran. The address and title it names are those of the
page it carries, never a separate reading of the tab; one that carries no page
says the page could not be read.
_Avoid_: tool result, success flag

**Landing**:
The page an action that left the previous one arrived at, taken when its
document has gone quiet: the navigation committed, `dom-ready` passed, then
a short window with no DOM mutation, or the load event if that comes first,
capped at a few seconds. Never the load event alone, which on a slow
connection waits on every tracker after the refs are long in place. It is
what the landing classifiers judge and what the next Hop is read against.
A Command given while a navigation is still under way touches the page only
at its Landing (#330); Stop ends the load itself, leaving the page it was on.
_Avoid_: page load, load complete, network idle

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
can be reached. Covers that paint nothing at that point — no background,
border, shadow, image or text of their own there — are a **Blank Cover**: a
person sees the target, so it is activated directly, as a Vimium hint is, and
the outcome says so. A modal dialog is never blank.
_Avoid_: overlay, blocker, obstruction, dialog covering the target, invisible overlay

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

**Cover Rule**:
How a pop-up that declares no dialog role and offers no consent choice is
found (X's logged-out sign-in sheet: three plain divs): by what it does,
not what it says. A fixed layer that is on top at three or more of the
viewport's five sample points, spans at least half the viewport, and holds
fewer than half of the page's controls is the dialog root — its controls on
the dialog layer, its text the dialog's, a Dismiss Phrase settled against
it. A fixed app shell that holds the page's own controls is the page; a
fixed bar at the foot is on top nowhere that is sampled. A role-bearing
root wins over the consent rule, and the consent rule over this one.
_Avoid_: overlay heuristic, scrim detection, modal guess

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
