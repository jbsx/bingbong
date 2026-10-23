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

_Filled in by the build: the ratio, the grown cases, each arm's count on
Mammoth and Elephant, the Jev run, and the live line ending done._

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
