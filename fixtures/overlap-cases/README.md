# Sequence Cases

One JSON file per case, run by `pnpm overlap:gate` (#486; CONTEXT.md
**Sequence Case**, **Overlap**). A case is black-box. It says what is in
front of the person, what they say or type and when, what else is heard,
and what a person sees and hears at the end. It never names a reading, a
model's answer, or how the app gets there; a case stays true whatever a
later fix does.

## The shape

`<row>-<slug>.json`, the row being the owner's list in #486 (1–14). One
file or more per row; a variant (`pause`, `resume`, a seek) is its own file.

```json
{
  "start": { "page": { "url": "…", "behind": ["…"] }, "music": "…", "asked": "…" },
  "input": "typed" | "spoken",
  "listen": "wake" | "hotkey",
  "echo": true,
  "lines": [
    { "words": "…", "audio": "….wav" },
    { "words": "…", "at": { "ms": 2200 } | { "ms": [300, 4000] } | { "while": "loading" | "speaking" | "media-not-started" } | { "after": "shown" | "changed" | "asked" } }
  ],
  "noise": [ { "audio": "…", "at": { } } ],
  "expect": {
    "url": { "host": "…" } | { "is": "…" },
    "view": { "has": ["…"] },
    "media": { "playing": true, "has": "…", "position": [30, 60], "volume": 0.7, "loop": true },
    "said": [ { "is": "…" } | { "startsWith": "…", "endsWith": "…", "notFirstMedia": true } | { "means": "…" } ],
    "speech": "whole",
    "lines": [ "done", "cancelled" ],
    "nothingElse": true
  },
  "evidence": ["turn-…"],
  "state": { "pane": { "is": "red", "on": "<commit>", "date": "2026-10-27", "models": ["…"] }, "audio": { "is": "start not met", … } }
}
```

- **start**: what is in front of the person before line 1 (CONTEXT.md
  **Sequence Case**, #509), each part given apart, at least one of them:
  - `page`: the page shown, `url`, and the pages behind it, `behind`,
    nearest first: the pages `back` steps through. The gate opens the pages
    behind, oldest first, then the page shown.
  - `music`: a song heard, wherever it plays: `play <music>` given after the
    pages and heard playing first. On the pane road the song takes the pane;
    on the audio road it leaves the pane alone.
  - `asked` (with a `page`): a line the app has just asked a question about,
    given last; the app asking before line 1.

  The start is only the precondition, however it got there. A song that has
  not started 10 s after its line is started with the media's own play, as
  a person would press it: YouTube's autoplay sometimes never fires on a
  fresh profile. A start that still never comes, or one whose run met a 429
  from the Decision Model's host, is run again, twice at most, and counted
  under the table.

  The start is checked before line 1 (before the line asked, with
  `asked`): the page shown is `page.url`, at least as many real pages are
  behind it as `behind` names, and a song is heard, on the pane or the
  road. A start the run could not put is **`start not met`**, its own
  result beside red and green: it measured nothing, is never red, and is
  not counted. A step that never came (a page that never loaded, a song
  that never played) is run again first; a start that came but is not the
  case's (on the pane road a song takes the pane, so a page and a song
  together cannot be held there) is not.
- **input**: `typed` lines go in the way the Toolbar's box sends them, so a
  line can arrive while the one before it is still running. `spoken` lines
  are heard through the microphone.
- **listen** (spoken only): `wake` (the default) says the wake word once and
  speaks every line into that one Hot Listen; `hotkey` presses the hotkey
  before each line.
- **echo** (spoken only): the app's own voice is heard by the microphone, as
  it is in a room. Without it a spoken case is heard muted: the microphone
  hears the person and the noise and never the app.
- **lines**: the words, and for a spoken line its audio. The first line has
  no time: it is the clock's zero.
- **noise** (spoken only): what else is heard (another voice, a remark),
  with its time.
- **evidence**: the Failed Lines ledger turns the case was drawn from, or
  `["none yet"]`.
- **state**: a result for each road the case was run on (`pane`,
  `audio`): `red`, `green` or `start not met` as one full gate run on that
  road measured it, the commit it ran on, the date and the models. Written
  by hand; the gate never edits a case. A case is through when it is green
  on every road that can hold its start. `pnpm overlap:gate --check-state`
  fails when a road's table disagrees, or names a road the file has no
  state for.

## When a line arrives

Counted from the first line's arrival (a typed line's submit, a spoken
line's first sound):

- `{ "ms": 2200 }`: at that moment.
- `{ "ms": [300, 4000] }`: a window. The gate runs the case at `--points`
  points in it (default 3), one in each equal part of the window, chosen by
  `--seed` (default 1, so a bare run reproduces). The case passes only if
  every point passes.
- `{ "while": … }`: during a span a person could see or hear in line 1's
  life: `loading` (the page loading), `speaking` (the app talking),
  `media-not-started` (the words shown, the media not playing yet). Sampled
  at seeded points like a window.
- `{ "after": … }`: at a moment a person could see: `shown` (line 1's words
  in the Feed), `changed` (the page's address changed), `asked` (the app
  asked a question).

Where in the span a point falls comes from a **calibration** run: the case
with line 1 alone, once per Decision Model, its timeline read from what the
app published. A spoken case needs one for every named point, since its
audio is laid out before the app starts. A typed case needs one only to
size a `while` span: it sends an `after` line the moment the point is seen,
and a `while` line that far into the span as it begins. `--keep dir` keeps
each calibration (`<dir>/<road>/<case>/<model>/calibration.json`) and
`--calibration dir` reuses it. A fixed `ms` needs none.

## What is checked

Only what a person could see or hear once the run has settled. A run has
settled when nothing has happened for 2.5 s, the app is not speaking or
hearing, the page and its media have held still, and nothing begun since
line 1 is still under way: no line running, and no Thinking, Acting or
Loading entered since line 1 without its end, an Errand's own steps
included. A question the app has asked waits on the person, so it counts
as an end. A run that never settles is read at the bound, 90 s past its
last line.

- `url`: the pane's address. `host` matches the host or any subdomain of it.
- `view.has`: text in view in the pane (case and spacing ignored).
- `media`: every `<video>` and `<audio>` in the pane. `playing` asks whether
  any is playing; `has` is looked for in the page title or the media's
  source (case ignored); `position` is a range in seconds; `volume` is a
  level (±0.01) or a range; `loop` is the media's own loop.
- `said`: the sentences the app said. An `is` is exact, each one after the
  one before it. A shape is exact too, in the same order: one sentence that
  starts with `startsWith` and ends with `endsWith` (either may be left out);
  with `notFirstMedia`, what lies between them, quotes trimmed, is not the
  title of the first page the pane held with media on it from line 1 on (a
  correction's "Playing … instead." names another song than the one opened
  first). A `means` goes to a judge (GLM-5.3-flash, as `goal:gate`'s) that
  reads every sentence said. It is the one check that is not exact: a
  sentence whose words the app writes itself is checked on its shape.
- On every case, whatever its `expect`: a stop said of what still plays is
  red (#508). A play's stop, "Stopped playing …" or "Stopped queueing …",
  with no "Playing …" after it, whose words (the doing word and "by" aside)
  are at least half in the title of media playing at the end, is the app
  saying it stopped a song a person still hears. A bare "Stopped." and the
  stop of a page ("Stopped opening youtube.com.") name no song and are never
  held against the media.
- `speech`: `whole` says no sentence the app began was cut: none ended
  sooner than nine tenths of the time it takes said whole (the app's own
  voice, rendered once to time it). A sentence still sounding when the run
  ended was not cut, since every end, a stop's too, is marked. A dip in its
  level is not a cut.
- `lines`: what the Feed shows each line came to, in order: `done`,
  `failed`, `cancelled`, `dropped` (heard, read as no Command), `none`
  (no Command of its own: taken into another line, or not heard), or
  `running` (still under way when the run's bound came: a read longer than
  the run). A line
  is a Command whose first hop came at or after line 1, and later hops of
  the same Task are its own. A `dropped` entry counts only in a case that
  expects a line `dropped`, since by order alone a remark or noise that was
  heard and did nothing cannot be told from a line. `nothingElse: true` says
  the Feed shows those lines and nothing more, a `dropped` one included: in
  a case where the only other sound is the app's own voice, any further
  line was taken from it.

On the pane road the pane is one: a search or an open from a playing song
leaves the song, so a case whose line 1 does that checks the URL and the
lines, never the song: `5-independent-volume`'s "volume down" is through
on "Nothing is playing.", which is true (#489, F1 arm a). On the audio
road the song plays on through a search (#502).

A **wall** (a page the browser classes a Blocker: a challenge, a network
block, a sign-in wall, or a page asking a person to prove they are no bot)
seen before line 2 arrives makes that point `wall`, neither red nor green:
line 1 never ran far enough for the overlap to be tested.

## Audio

A spoken line's audio is an utterance dump where one exists (a path such as
`fixtures/stt-dumps/utterance-….wav`). Otherwise it is a bare file name in
`audio/`, synthesized with Piper from `audio/stand-ins.json`: the person
speaks in `en_US-lessac-medium`, another voice is
`en_GB-northern_english_male-medium`, and neither is alba, the app's own
voice. **A synthesized line is a stand-in until a dump of the real line
exists**; when one does, point the case at the dump. To add a stand-in, add
its words and voice to `stand-ins.json` and run `pnpm overlap:audio` (Piper
and the voices in `~/.config/bingbong/`, and ffmpeg). The wavs are 16 kHz
mono, like every dump, and are committed.

## The app's own voice

A case with `echo` runs in a room: a private PulseAudio server for the run
alone, whose one device is a null sink. The app's speech plays into it, the
wav of the lines and the noise is played into it from the moment the
microphone opens, and the microphone is the sink's monitor, so the person
and the app are heard mixed, and the app's voice is heard to dip or stop
when it does. The room loads no device and is checked for that before the
run; the app's player is held to the room and plays nowhere if the room is
gone. The pane's own sound stays muted. Both voices go in at the level they
were made at, a guess until a kiosk dump of the app speaking says how loud
its voice is at the microphone. `--keep` keeps what the microphone heard as
`<point>-room.wav` beside the run.

## Adding a case

1. Pick the row it belongs to and name it `<row>-<slug>.json`.
2. Write the start, the lines and their times as a person would live them,
   and the end state as a person would see and hear it. If the outcome
   can't be said without naming how the app works, leave that part out.
3. Cite the ledger turns in `evidence`.
4. Run it: `pnpm overlap:gate --cases <slug> --keep logs/overlap/<dir>`.
   Then set `state` by hand from the full run that measures it, and name
   that commit.

## Running

```
pnpm overlap:gate [--cases substr,…] [--models id,…] [--repeat N] [--seed N] [--points N]
                  [--keep dir] [--calibration dir] [--planner id] [--check-state] [--with-jev]
                  [--road pane|audio|both] [--resume]
```

`--road` is where a song plays: `audio` (the default, as shipped), `pane`,
or `both`, one road after the other. Every fresh profile is written its
road's audio-only music setting, off as plainly as on, so no run reads the
default; every read takes the road's hidden window and the dashboard's Now
Playing beside the pane, whichever the road. Both roads are run for an
issue's final measure and for any change to the Player or the road (owner,
#509 grill); the audio road alone otherwise.

Every point gets a fresh app on a fresh profile: muted, under Xvfb,
launched the way the e2e harness launches it, against real pages (rows
that play go to real YouTube). The Decision Model is each of
`BINGBONG_GATE_MODELS` (or `--models`), with the Planner on its default
(`--planner id` sets one). Jev is asked only with `--with-jev`. The report
has one table per road and model, case × point, and its footer carries the seed,
points, repeat, commit and calibrated spans. A red cell names the first
failed check. `--keep dir` writes each run as
`<dir>/<road>/<case>/<model>/p<point>.json`: the end state, the records, the
app's logs and its stderr. The gate is not part of `pnpm test`: it needs
real models and real pages.

### A slow host

`BINGBONG_OVERLAP_SLOW_HOST=1` (off by default; harness-only, #504) puts
a stand-in in front of the Decision Model's host (`e2e/overlap/slowHost.ts`)
and points the app at it, with no Fallback Hosts. Every ask whose body
carries the words of a line after line 1 is held unanswered until the app
gives it up at its own `BINGBONG_DECISION_TIMEOUT_MS`, which the switch
never changes; every other ask reaches the host as it came. So line 1 is
read as ever and every later line's reading times out: the road a slow host
takes under a line that arrives over a running one (#504, the run of record's
`1-replace-new-goal` p3). Each run prints how many asks were held and passed.
A run with the switch on measures that road and is never a run of record.
