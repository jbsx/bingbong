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
  "start": { "url": "…" } | { "playing": "…" } | { "asked": { "url": "…", "line": "…" } },
  "input": "typed" | "spoken",
  "listen": "wake" | "hotkey",
  "lines": [
    { "words": "…", "audio": "….wav" },
    { "words": "…", "at": { "ms": 2200 } | { "ms": [300, 4000] } | { "while": "loading" | "speaking" | "media-not-started" } | { "after": "shown" | "changed" | "asked" } }
  ],
  "noise": [ { "audio": "…", "at": { } } ],
  "expect": {
    "url": { "host": "…" } | { "is": "…" },
    "view": { "has": ["…"] },
    "media": { "playing": true, "has": "…", "position": [30, 60], "volume": 0.7, "loop": true },
    "said": [ { "is": "…" } | { "means": "…" } ],
    "lines": [ "done", "cancelled" ]
  },
  "evidence": ["turn-…"],
  "state": { "is": "red", "on": "<commit>", "date": "2026-10-27", "models": ["…"] }
}
```

- **start**: a page at a fixed URL; a song playing (`play <words>` given and
  heard playing first); or a question the app has just asked (the URL
  opened, the line given, and the app asking before line 1). The start is
  only the precondition, however it got there. A song on screen that has
  not started 10 s after its line is started with the media's own play, as
  a person would press it: YouTube's autoplay sometimes never fires on a
  fresh profile. A start that still never comes, or one whose run met a 429
  from the Decision Model's host, is run again, twice at most, and counted
  under the table. A start still not reached after that is a `wall` whose
  cell says "start never reached" (below).
- **input**: `typed` lines go in the way the Toolbar's box sends them, so a
  line can arrive while the one before it is still running. `spoken` lines
  are heard through the microphone.
- **listen** (spoken only): `wake` (the default) says the wake word once and
  speaks every line into that one Hot Listen; `hotkey` presses the hotkey
  before each line.
- **lines**: the words, and for a spoken line its audio. The first line has
  no time: it is the clock's zero.
- **noise** (spoken only): what else is heard (another voice, a remark),
  with its time.
- **evidence**: the Failed Lines ledger turns the case was drawn from, or
  `["none yet"]`.
- **state**: `red` or `green` as one full gate run measured it, the commit
  it ran on, the date and the models. Written by hand; the gate never edits
  a case. `pnpm overlap:gate --check-state` fails when the table disagrees.

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
each calibration (`<dir>/<case>/<model>/calibration.json`) and
`--calibration dir` reuses it. A fixed `ms` needs none.

## What is checked

Only what a person could see or hear once the run has settled. A run has
settled when nothing has happened for 2.5 s, the app is not speaking or
hearing, the page and its media have held still, and nothing begun since
line 1 is still going: no line still running, and no stage (thinking,
acting, loading) entered with no end after it, a step of an Errand or a
Plan included, since a step thinks without a sign. A question the app has
asked waits on the person, so what was thinking before it does not count.
A run that never settles is read at the bound, 90 s past its last line.

- `url`: the pane's address. `host` matches the host or any subdomain of it.
- `view.has`: text in view in the pane (case and spacing ignored).
- `media`: every `<video>` and `<audio>` in the pane. `playing` asks whether
  any is playing; `has` is looked for in the page title or the media's
  source (case ignored); `position` is a range in seconds; `volume` is a
  level (±0.01) or a range; `loop` is the media's own loop.
- `said`: the sentences the app said. An `is` is exact, each one after the
  one before it. A `means` goes to a judge (GLM-5.3-flash, as `goal:gate`'s)
  that reads every sentence said. It is the one check that is not exact.
- `lines`: what the Feed shows each line came to, in order: `done`,
  `failed`, `cancelled`, `dropped` (heard, read as no Command), or `none`
  (no Command of its own: taken into another line, or not heard). A line
  is a Command whose first hop came at or after line 1, and later hops of
  the same Task are its own. A `dropped` entry counts only in a case that
  expects a line `dropped`, since by order alone a remark or noise that was
  heard and did nothing cannot be told from a line.

A **wall** (a page the browser classes a Blocker: a challenge, a network
block, a sign-in wall, or a page asking a person to prove they are no bot)
seen before line 2 arrives makes that point `wall`, neither red nor green:
line 1 never ran far enough for the overlap to be tested. A start never
reached is the same: the cell is `wall` and says "start never reached".

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
```

Every point gets a fresh app on a fresh profile: muted, under Xvfb,
launched the way the e2e harness launches it, against real pages (rows
that play go to real YouTube). The Decision Model is each of
`BINGBONG_GATE_MODELS` (or `--models`), with the Planner on its default
(`--planner id` sets one). Jev is asked only with `--with-jev`. The report
has one table per model, case × point, and its footer carries the seed,
points, repeat, commit and calibrated spans. A red cell names the first
failed check. `--keep dir` writes each run as
`<dir>/<case>/<model>/p<point>.json`: the end state, the records, the
app's logs and its stderr. The gate is not part of `pnpm test`: it needs
real models and real pages.
