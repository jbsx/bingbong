# Reliability: what "just works" is made of

The owner judges the app by how simple the words were, never by how hard
the line was to build. "Pause" is a light switch; five words of intent
can take seconds. Reliability is the wait matching the words, the same
words getting the same wait, and nothing needing saying twice. Ruled by
the owner on 2026-10-27.

## Felt Reaction

The Reaction (CONTEXT.md) runs from the Endpoint. The owner waits from
the last speech frame, through the silence and Smart Turn check that make
the Endpoint, so the promises are set on the Felt Reaction:
`end-of-speech` + `reaction` in the perf log. An Early Fire's Felt
Reaction runs from the last speech frame of the partial it fired on.

## Tiers

| Tier | scenarios (yield.md) | Felt Reaction p50 | p95 | Frustration bar |
|---|---|---|---|---|
| Instant | control, read (scroll), back, stop | ≤ 700 ms | ≤ 1.2 s | ≥ 500 Commands between |
| Quick | open, search, play | ≤ 2 s | ≤ 4 s | ≥ 50 between |
| Task | question, Errand | Receipt ≤ 100 ms, narrated | done ≤ 15 s | ≥ 10 between |

The Frustration bars are guesses (2026-10-27), set where one Frustration a
week on the owner's normal day (yield.md counts) would land; the next
month of kiosk logs settles them. An Instant line Jev reads holds the
Quick promise until a small card measures inside Instant.

A scenario over its Tier's promise is `slow` in yield.md.

## The budget behind each promise

Measured on the kiosk (i3-7100U), 25–27 October 2026, 181 spoken
Commands, `pnpm perf:report` over `kiosk-logs/kiosk`:

| stage | p50 | p95 | note |
|---|---|---|---|
| end of speech to Endpoint | 780 ms | 1,340 ms | the floor; only Early Fire goes under it |
| STT, ElevenLabs | 250 ms | 510 ms | |
| STT, Parakeet | 850 ms | 6,370 ms | cold loads; no Tier holds its p95 on this ear |
| Jev, card 6k+ tokens | 1,320 ms | 2,430 ms | today's p50 card is 7.8k |
| Jev, card under 3k tokens | ~600 ms | ~1,500 ms | |
| page collect | 610 ms | 5,790 ms | |
| fire to effect | 140 ms | 3,200 ms | |

So an exact line at the Endpoint on the cloud ear has a Felt Reaction of
about 1.1 s p50 / 2 s p95 at best; Instant's 700 ms needs the Early Fire
(633 ms p50, 5 turns). Quick needs the cloud ear, a small card and the
page collected while the owner is still speaking.

## The rules, with their reasons

1. **An exact line fires on its words.** `Pause.` took 7.4 s and
   `Scroll.` 4.5 s with no Jev call: each waited on a page collect it
   did not need (8.3 s, 5.1 s; turn-mvqi18id-v3, turn-mvpduhyn-v16).
   It is mechanism, so code keeps it (AGENTS.md, Jev decides). On a
   partial that already is the exact line, it fires there.
2. **An Instant line Jev reads gets the smallest card that carries its
   ref.** Media lines read by Jev ran 2.2 s p50 / 17.3 s p95. A smaller
   card is a paid strategy under "Jev decides", reached by the gate,
   never by widening the grammar by hand.
3. **An Instant line fires when every host fails.** 17 Tasks ended
   `unavailable` on 429s. The Local Match's best guess fires instead.
4. **A Misfire is recovered by the next Command, and that recovery is
   Instant.** Asking first is ruled out (CONTEXT.md, Misfire); cheap
   recovery is what makes firing at once safe.
5. **Every line is answered.** 83 of 181 spoken lines read `none`; the
   owner cannot tell noise from a swallowed command. A `none` is shown
   and said (ui.md, Receipt and Narrated wait).
6. **Same words, same wait.** The spread (p99 ÷ p50 by verb) is watched
   beside p95: the Local Match ran 720 ms p50 and 14.7 s p95, and the
   spread is what feels flaky.

## Commands between Frustrations

A Frustration is a Command that ended not done, `unavailable` or
`unsure`; a Misfire; a line said again or reworded within 15 s (the same
verb, or transcripts at 0.7 similarity or more); or a real command read
as `none`, labelled from the audio dumps. Today, by that heuristic,
about one Command in five is followed by a repeat (36 of 181).
`perf:report` counts every part but the repeat today.

## Today, 2026-10-27

| Tier | Felt Reaction p50 / p95 | met |
|---|---|---|
| Instant | ~1.5 s / 15+ s | no |
| Quick | ~3 s / 15+ s | no |
