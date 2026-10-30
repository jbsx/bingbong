# ADR 0099: The app speaks; only the Page Read is removed

## Status

Accepted 2026-10-30, by the owner's ruling of the same day (#514). Built on
gitlab main 087b4ed3. Supersedes ADR 0098 for the voice. Amends ADR 0076, 0081,
0082, 0086 and 0087 where they name the Page Read.

## Context

ADR 0098 stopped all speech to end the trouble of talking over the app's voice
(#490, #512). In use, losing every spoken line cost more than that trouble was
worth. The Page Read was the part not worth keeping: the longest line by far,
and the one most talked over.

## Decision

Every line the app said before ADR 0098 is said again, by Piper, by default.
The Line Overlay, the line chimes and `BINGBONG_VOICE` are removed, and lines
show as the Command's Answer in the Feed and on the Peek Card. The Page Read
stays removed: no spoken line reaches it, Jev is not offered it, and typed
`read` is a silent listing.

## Consequences

Talking over the app is unsolved again, over shorter lines: the mic is muted
while the app speaks and the wake word cuts in. #490 and #512 stay open. The
Peek Card holds no Speaking face for a short line; it shows a Speaking row.
`cli-2-mvphvq44` stays lost until a measured card change or the owner accepts
it.
