# A line fires without an ask only when it has one reading on every page

Code settled meaning in Jev's place on the main path in six places
(#408): a word list read the volume's direction (and "turn it down a bit
more" up), the Player's phrase table took "next" past a page's own Next
link, a title regex ended the Task on a landing Jev never read, a
bare word became `<word>.com`, "the first result" counted ads, and a
consent-reject rule picked "Reject all and subscribe". Each was a speed
trade under ADR 0076 that had stopped being a fact.

We decided that a whole line is the grammar's, and fires without an ask,
only when it has one reading whatever the page holds. A line whose
words a ref on the page carries as its label goes to Jev, as the bare-word
`open` already did (#341). A line that reads intent rather than naming an
action — "the other one", "not that one", "wrong one", "show it", "last
page", "where was i" — is never the grammar's; the Player's `correct` and
`forget` join its Appliance Verbs so Jev can choose them. `pause`, `mute`,
`louder`, `volume 40` and the other exact lines stay instant.

The same test settles the other places:

- `open <bare word>` fires without an ask only for a **Known Address**,
  a host the appliance has landed on. It opens that host, not `<word>.com`.
  Any other bare word goes to Jev with the open-address op on the card.
- "the first result" is Jev's, read with the results' refs. Which link is
  a result is a judgement, and code cannot tell an ad from a result by
  kind.
- A landing ends the Task without an ask only on a fact: an HTTP status
  (404, 410, 5xx), a challenge host or token. A title or body that reads as
  not found, unavailable or blocked goes to the Verdict. The class line
  stays as what is said when Jev does not answer. No landing rule names a
  site.
- On a pop-up, Jev's sure pick ranks first. The consent-reject rule
  joins the close-label rule as the fallback under the bar. The
  through-veto stays: it is hard policy (owner's rule 2026-10-19) and
  guards whatever Jev picks.

What stays code's, and why: the dismiss phrase only chooses which question
Jev is asked; the close-label and consent-reject rungs are the fallback
when Jev is unsure; the through-veto is policy.

## Considered Options

- Keep the phrase table first and let a Misfire be recovered (ADR 0076).
  Rejected: "next" on a page with a Next link is wrong every time, not by
  chance, and a recovery costs more than the one call.
- Filter ads out of "the first result" in code. Rejected: an ad's marking
  differs by engine, so the filter would go by site.
- A list of bare words that are sites. Rejected: a list. The Known Address
  is a fact the appliance gathers itself.

## Consequences

Each line that moves costs one Jev call (about 0.7 s) when it fires. A
bare word the appliance has never landed on costs a call the first time
only.
