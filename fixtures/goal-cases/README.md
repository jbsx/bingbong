# Goal cases

The goal corpus (#464, ADR 0095): Goal Lines the owner would say on a
normal day, supplied and confirmed by the owner on 2026-10-26, so they
measure the day and not the arm. One file per line:

- `transcript`: the words, as spoken.
- `start`: the page or state the line is said on.
- `meant`: what done-right is, in words. Where it says "ask back", the
  right outcome is a question, not a guess.
- `source`: who wrote the line and when.

Unlike `jev-cases/`, these are not frozen asks: an Errand touches live
pages, so a case is scored by running it under the CLI harness, on a
fixture page where one exists and on the real site for the numbers,
`--repeat` for the noise. The score is done-right and seconds. The
runner and its scorer are piece 1 of #464; until it exists this folder
is the corpus only.

Lines that come from use are added by the ledger's `goal` stage.
