# ADR 0088: A hop's card fits the smallest host, and what is further down yields first

## Status

Accepted on 2026-10-23 by the owner ("go with recommended"), grilled from
#406. Of the grill's six questions, five were decided by AGENTS.md's widen
and ties rules, ADR 0076, ADR 0086, the issue's own text, #353 and the
naming rule; the owner ruled the sixth, that Jev is asked once at the end.
Amends ADR 0086 (the room the Choice has left is now also a size).

## Context

A hop past the first offers every unvisited link on the page. Each link
rides the card twice, as a `[link-N]` state line and as its `open-N`
option; so does every ref (`click-N` repeats the ref line) and every block
of Text in view (a `view-N` passage option). Nothing bounds the whole ask:
the bounds are counts (254 options, 75 refs, 1000 links, 60 blocks) and
ADR 0086's 6000 characters of Text Further Down. On 2026-10-23
(`cli-2-mvl5n3jn`, main 413191a9, Mammoth) "how do i install it" on the
Playwright repo picked the Install Show at hop 0 and put the answer in
view; hop 1's ask was 54.6k characters, 156 links on the card twice
(33k of it), and the host answered 422 "16645 tokens, exceeding max_len
16384". The Task ended `unavailable` with the answer on screen. Elephant
answers the same; `cli-2-mvkwcigu` died the same way at hop 3. The record
kept `reason: "http"` alone.

Jev 1.14 takes 64k tokens a request and 32k a question; the card would
have fit it. The 16,384 cap is Baseten's for the free gate models. Jev's
own guidance says accuracy falls as the state fills with detail unrelated
to the decision.

## Decision

Every ask fits a **Card Budget**: a size in the host's tokens, one number
for every model, Jev included, defaulting to the smallest host the gate
asks (16,384) and set in one place (`BINGBONG_DECISION_PROMPT_TOKENS`).
The card is built to it in characters, at a chars-per-token ratio measured
from the asks log against the hosts' own token counts, with margin. The
card Jev gets is the card the gate measured; a larger card for Jev alone
would be a widening no gate reaches.

What makes the hop is never cut: the words, the page line, the refs in
view, Text in view, the Verdict, Noul, passage and slot Choices, the verbs
and the appliance's facts. What is further down competes for the room
left, in ADR 0086's order: opens, then menus, then shows, each list in
reading order so what is nearest the view survives.

A refusal that still comes (a 422, Jev's 400 `max_tokens_exceeded`) ends
the hop `unavailable` as today, with no second call and no guess; the
record now carries the status and the host's message, and the fault log
(#397) the fault. The answered record carries the host's `input_tokens`,
so a card's size reads from `pnpm perf:report`; replay and the gate print
each case's size and flag one over the budget.

Two ties are measured at build, not argued, on `pnpm jev:gate` over
hop-1+ cases grown first from the two ledgered runs and `jev:candidates`
(the corpus had none this size), each arm a script over the stored cases:

- **Which further-down list yields first**: (A) opens before shows, ADR
  0086's order, the baseline; (B) shows before opens. (C), one list of
  links and blocks interleaved by position so nearness decides whatever
  the kind, needs a position on every collected link and block and is
  named here, unbuilt, unless A and B tie or both lose a case the other
  keeps.
- **The double ride**, for links, refs and passage blocks alike: (i) as
  today, on the state line and whole in the option; (ii) the state line
  dropped, the option whole, since the action Choice is the only question
  that acts on a link and the Verdict reads the state; (iii) the option
  names the ref alone, the text on the state only. ADR 0087 found the
  Choice wants the text in its options, which argues against (iii).

The winner is the arm that measures best with nothing that passed before
lost; a measured tie goes to (ii), cheapest to reverse. Jev is asked once,
`--with-jev`, on the winning arms after the free-model gate passes.

### Measured at build (#406)

Built on base `21b5925a`, 2026-10-23. Gate: Mammoth ∩ Elephant
(`decision-models/baseten-{mammoth-27b,elephant-9b}-latest`), each arm a
script over the stored cases, one run each (both models deterministic:
arm A run twice gave the same cells).

**Grown cases** (6): `turn-mvl5n50y-1` (the Playwright install hop of
`cli-2-mvl5n3jn`, also `turn-mvl59cdi-1`), `turn-mvkwcnu2-3`
(`cli-2-mvkwcigu` hop 3), `turn-mvl5g89b-4`, `turn-mvl5dtuv-4`,
`turn-mvl5kpp9-1`, each 51–63k characters and refused 422 by both hosts
as recorded; and the live hop below, `turn-mvl7tbjr-1`. With them the
corpus is 149 cases; the baseline is Mammoth 136/144, Elephant 122/144,
121 through.

**What the host counts.** Baseten answered asks it reported at up to
17,615 `input_tokens` and refused one whose "prompt" was 16,645: the cap
is on one prompt, the state with one question, not the request (Jev's own
limits are per request and per question). Over the four refusals the
state plus the action card ran 2.70–3.25 characters per counted token, the
link-heavy GitHub card lowest; the largest such prompt that was answered
was 46,035 characters, the smallest refused 48,031. So the budget reads
the largest prompt an ask makes (`promptChars`), built at 2.6 characters
a token: 16,384 tokens is 42,598 characters. The whole ask is kept only
for the chars-per-token line against `input_tokens`.

**Which list yields first.** A (opens, then right-clicks, then shows) and
B (shows first), with the budget measured over the whole ask: identical,
cell for cell — Mammoth 140/144, Elephant 125/144, 124 through, the four
422s through on both, and both losing `turn-mvkwclvb-2` on Elephant (yes
0.73 → 0.69). A measured tie. C needs a position on every collected link
and block, which no stored ask carries, so the measure cannot reach it
without collecting every case again: named and unbuilt, and the tie goes
to A, the order the builder already had.

**The double ride**, on A with the whole-ask budget: (i) 125 through
(Mammoth 141/145, Elephant 126/145); (ii) 113 (Mammoth 135, Elephant
114), losing 18 cells that passed before; (iii) 120 (Mammoth 135,
Elephant 122), losing 9 and failing the Turing case. (i) wins: links,
refs and passage blocks ride the card as before. With the per-prompt
budget no recorded case needs (ii) or (iii) to fit.

**The measure of the budget**, on A (i): the whole ask (above) against
the largest prompt. Both 125 through; the whole-ask budget loses
`turn-mvkwclvb-2` on Elephant, the per-prompt budget cuts it 3.5k
characters instead of 6.5k and keeps it, and loses nothing that passed
before. Its one miss is a new case, `turn-mvl5n50y-1` on Elephant, whose
passage pick goes to the "Install" heading (view-3 0.43) over the command
under it; the Verdict still reads yes. Per prompt is built; the nine cases
over the budget are stored as it cuts them.

**Jev** (`--with-jev`, once, on the built cards): 124/149, 115 through on
all three. Of the nine cut cases Jev fails `turn-mvkwclvb-2` (not_yet
0.58); Jev was not asked the uncut corpus, so whether the cut moved it is
not known.

**Live**, Mammoth under the CLI harness: "how do i install it" on
github.com/microsoft/playwright picked the Install show (0.61); hop 1's
ask was 45.6k characters, the host counted 15,993 tokens and answered,
the Verdict read yes 0.97 and the Task ended done. The passage pick, the
install command, was 0.65, under the Choice bar, so nothing was said
(ledger `cli-2-mvl7t9z8`); the stored case of the same page gets 0.75.

## Considered options

- **A budget per model**, so Jev sees every link: rejected; the gate would
  measure a card Jev never gets, and Jev's own guidance favours the
  smaller state.
- **Re-ask once with the card cut to the size the refusal names**: a paid
  second call for a case the budget rules out; the paid strategies come
  after widening, never beside it (AGENTS.md).
- **Counting tokens with a tokenizer**: each host's is different and
  Jev's is not published; a measured ratio with margin is exact enough and
  the host's own count on every record shows when it drifts.

## Consequences

- A hop's ask can no longer end a Task on the host; the Task ends done or
  on the Verdict.
- On a link-heavy page some links further down are no longer offered. That
  is a narrowing, measured on the gate before it lands, with the grown
  cases as the guard.
- The glossary gains **Action Card** and **Card Budget**; the old **Card**
  is marked as the orchestrator's.
