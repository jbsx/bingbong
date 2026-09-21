# ADR 0061: A consent wall is recognised by position and its controls, not by role or vendor, and dismissed where it is met

## Status

Accepted on 2026-09-21 for #263, grilled from the `fix-258-259` capture
(#259, ADR 0058). Extends ADR 0007's consent exception — the one Blocker
class that is auto-cleared — to walls that declare no dialog role, and
moves the dismissal to where the wall is met. Amends nothing.

**Note (#263 implementation, 2026-09-21).** The rule lives in the collect
script (`src/main/browser/collectPageScript.ts`), fed `CONSENT_LABEL_RE`'s
source; the dismissal and retry live in the controller. The calls this ADR
left open: the rule tests only button- and link-like controls, by their
aria-label, value and text content rather than the laid-out label, so it
costs no layout on the many pages that carry no wall, and never takes the
body or the root element as a root. "Optional" is reject-style only in a
phrase that declines the optional cookies ("without optional cookies"),
never as the bare word, which "Accept optional cookies", a "Manage
optional cookies" control and a toggle all carry. The navigate outcome
keeps its `navigated:` head and carries the dismissal on the second line,
above the listing. A block first reads the open dialog root's control
labels in place and collects only when they make it a Tier-1 consent root:
a block under no dialog or a Tier-2 one stands exactly as before, with no
collect to renumber the refs the model holds, and a failure while clearing
the wall leaves the block standing rather than failing the call. The retry
is measured against the post-dismissal page, so its changes clause says
what the retried click did rather than crediting it with the wall's
departure, and the post-dismissal listing rides it whatever it did; a
dismissal that took the named node with it (a reload) refuses the ref with
the page as it stands, as any dead ref is. Back and forward are not call
sites: the read or the blocked action after them still clears the wall.
The audit's hand consent click reads the label from the last whole listing
(one with a page signature) that numbered the ref, and pairs each Blocked
Action with at most one such click.

## Context

The museum collections page every longitude-watch Run opens carries a
Cookiebot consent wall. As served, its root is a `role="region"` landmark
labelled by its title, with a sibling underlay covering the viewport and
`overflow: hidden` on the body: no `dialog` role, no `aria-modal`. The
snapshot finds its dialog root by role and attribute alone, so the wall was
never a dialog root, the Tier-1 dismissal never ran, and the Blocker
classifier keeps consent out of its signals on purpose. The wall was
neither cleared nor a Blocker. Every longitude Run in the capture paid two
rounds for it: a type into the collection search box blocked by the
underlay, then a hand click on "Reject all cookies". In one pass the hand
recovery led the model to the wrong search box afterwards and nine rounds
went on one URL.

Two more shapes sit in the captures. Raspberry Pi's own banner is
role-less too, reads "Accept optional cookies" / "Reject optional cookies",
and is a static strip at the top of the page that covers nothing. Eurostar's
role-bearing wall was dismissed with "Accept all cookies" because "Continue
with necessary cookies only" was not reject-style to the dismissal.

Dismissal today runs only on read_page and on a click that opened a dialog,
never on navigate — although the navigate outcome already lists the refs
the model acts on — and never inside a blocked action. The click
preparation resolves the covering element and reduces it to a boolean.

## Decision

- **A Consent Dialog is a wall, recognised by a rule, not a vendor list.**
  When no role-bearing dialog root exists, the collector takes as the
  dialog root the outermost ancestor with computed position `fixed` or
  `sticky` of a control whose label is consent-style; the root must
  intersect the viewport, its controls need only size, like dialog refs
  today. Two such roots resolve to the last in document order, as the
  existing selector does. A role-bearing root always wins. `absolute`-only
  banners are left out rather than guessed at by z-index.
- **The rule-found root is the snapshot's dialog root**, with everything
  that follows: `dialogOpen`, its controls listed first on the dialog
  layer, the dialog suffix on blocked outcomes, Tier-1 dismissal, and
  Tier-2 presentation if its labels are ever unrecognised. Roots found by
  the rule are Tier-1 by construction.
- **A consent strip that covers nothing is not a Consent Dialog.** The
  Raspberry Pi shape is static and blocks nothing; the model may click it
  or ignore it, and the audit counts what that costs rather than the rule
  widening to it.
- **Dismissal runs where the wall is met.** Navigate becomes a call site:
  settle, collect, dismiss a Tier-1 consent root, recollect, then classify
  Blockers on the post-dismissal snapshot, and carry the one-line
  "dismissed consent dialog" note above the listing. A login wall behind
  a consent wall is only the root after the wall is gone.
- **A blocked click or type while a Tier-1 consent root is open dismisses
  once and retries in the same call.** The trigger is the open consent
  root, never containment of the covering element — Cookiebot's underlay
  is a sibling of the root, so containment fails on the case that
  motivated this. The retry acts on the element node the model named, the
  outcome names the ref the model used and reports both steps in one line,
  its listing is the post-dismissal one, and a second block in the same
  call is reported as blocked with the dismissal noted and no second
  dismissal. What a non-consent cover is named by stays #264's.
- **The consent vocabulary widens.** Consent-style admits
  `(accept|reject|allow|decline) (optional|necessary|essential) cookies`;
  reject-style admits `necessary|essential … only` and `optional`. The
  risk gate imports the consent-style pattern to exempt consent submits
  and widens with it: those labels are consent choices, and two lists that
  drift apart is the failure the import avoided. The reject-style widening
  never reaches the gate.
- **The prompt does not change.** It already promises that consent
  dialogs are dismissed automatically and reported in one line; the rule
  makes that sentence true. Naming strips would hand the model a term to
  copy and a reason to hunt for them.

## Measurement

Three deterministic per-round tags in the Round Audit, beside the rounds
so no cached judgement is re-keyed and no reviewer prompt bump is needed:
dismissals (rounds carrying the "dismissed consent dialog" line), hand
consent clicks (click rounds on a ref whose label is consent-style, not
auto-produced), and blocked-then-hand-consent (a blocked outcome followed
within two rounds by a hand consent click — two, because pass 2 read the
page between the block and the click). Summed per Run and pooled; the
fragments are pinned to source by the audit's existing test, never
imported. The gate on the `fix-263` capture is blocked-then-hand-consent
at zero across three passes; dismissals and hand clicks are reported per
hunt so a zero is not silence. The Fix Ledger's Reference is the
`fix-260-262` capture. The unit-level test of the rule runs the collect
script in headless Chrome, as the grading bench tests do, because the rule
reads computed style that jsdom cannot supply.

## Considered options

- **Vendor selectors** (`#CybotCookiebotDialog`, `#onetrust-banner-sdk`,
  Usercentrics roots), alone or ahead of the rule. Rejected: a list to
  keep in step with third parties' markup, and on the evidence it finds
  nothing the rule misses.
- **A rule over any element with consent controls, covering or not.**
  Rejected: it would dismiss the Raspberry Pi strip, which blocks nothing,
  and make the term mean "anything with a cookie button".
- **A separate consent-overlay class beside the dialog root.** Rejected: a
  second collector field and a second dismissal path for a thing every
  downstream consumer already handles as a dialog.
- **Containment of the covering element as the retry trigger.** Rejected
  on the sibling-underlay fact.
- **A narrower submit vocabulary for the risk gate.** Rejected: the
  exemption's reason is "this submit is a consent choice", which the new
  labels are.

## Consequences

- Every longitude Run after this is measured against a page whose consent
  wall is dismissed before the model sees its refs; the captured
  before/after on that hunt is not comparable to earlier captures on the
  rounds it spends before the first search.
- A fixed or sticky site header carrying an "Accept cookies" link would
  qualify as a root; the last-in-document tie-break and the viewport test
  are the only guards, and the audit's counters are where that would show.
- `absolute`-positioned walls with no fixed ancestor stay undetected; the
  blocked-then-hand-consent counter is the signal that one exists.

## Notes

- 2026-09-21, ADR 0062 (#264): a blocked action under an open Tier-1
  consent root whose target is Not Shown — absent from the page's own hit
  test at its centre — is dismissed for but not retried; the retry's result
  is known, and the outcome reports the dismissal and the not-shown fact in
  one line. A Covered target retries as this ADR says. What a non-consent
  Cover is named by is ADR 0062's.
