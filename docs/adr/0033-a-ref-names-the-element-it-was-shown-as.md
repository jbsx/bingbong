# ADR 0033: A ref names the element the model was shown, or the action is refused

## Status

Accepted

## Context

A ref is a number in a page read: position 1..n over the elements in the
viewport, in DOM order, at the moment the page was collected. The page keeps
the collected nodes in a registry and an action indexes into it, so a number
keeps naming the same node until the next collect — a scroll or a layout
shift alone retargets nothing. What retargets a number is a collect the model
did not see in full: the re-collect an action performs when the last snapshot
was invalidated by a prior action, the re-collect a click performs when the
registry died with a navigation, and the collect a scroll performs for its
`new in view` delta (#194), which prints only the refs that entered. After any
of those, a number the model read earlier is looked up in the new numbering:
a number past the end fails, but one still in range silently names whatever
element now sits there. The risk gate assesses that element too, so the gate
reads the wrong target even when it happens to be safe. #196 surfaced this
from the #194 review; the mechanism predates #194.

Three rules were on the table:

1. **Invalidate on any unseen collect.** Every number is void until the model
   reads again. Safe, and it reintroduces the `read_page` round after every
   inert click that #113 and #194 removed.
2. **Remap.** The browser knows old-number → node → new-number and could
   translate. It cannot know which numbering the model meant: after a scroll
   the model holds the old full numbering and the delta's new numbers, and
   `[3]` is a valid number in both.
3. **Identity.** A number is valid iff the node it was shown as is the node at
   that number now; otherwise the action is refused. Nothing the model read
   correctly ever costs a round; only the number that would mis-target is
   stopped.

## Decision

- **Identity, by DOM node.** The page keeps two registries: the current
  collect, and the *shown* registry — the node behind each number the model
  was last shown. A number resolves iff `shown[N]` is the node at `N` in the
  current collect. A number with no shown node — past anything a read
  printed, or a guess — is refused the same way. A node that is no longer
  connected (the registry died with a navigation) fails the comparison, so
  the click path's silent re-collect-and-retry becomes a refusal.
- **What "shown" means.** A page read or a settled page in an Action Outcome
  replaces the shown registry with the current one. A scroll's `new in view`
  block overlays only the numbers it printed; every other number keeps the
  node it was shown as, so a retained element that kept its number stays
  valid and one that shifted is refused.
- **A refusal carries the page.** The browser holds the fresh snapshot at the
  moment it refuses, so the refusal is the stale-ref line followed by the
  settled page in the `navigate` shape — the model continues from current
  numbers in the same round. It is not the old "run read_page" message and
  it does not fire auto-vision: the page state is the answer vision was
  standing in for.
- **One identity.** The scroll delta's "same element" is the same DOM-node
  identity, through the collector's previous-index mapping, not a
  kind/label/href tuple that reads two unlabeled buttons as one.
- **Every ref-taking path checks**, through the one resolver: click, type,
  the risk gate's describe, and visual grounding.

## Consequences

- Node identity means the collector reports, per element, which index it
  held in the previous collect; the controller owns the shown registry and
  updates it exactly where it returns numbers to the model.
- The `scroll` description states the rule rather than warning about
  renumbering: a pre-scroll number is refused, with the page, if it no longer
  names the same element.
- **Where a scroll's numbers collide with the old ones, the delta wins —
  deliberately.** A scroll that renumbers everything prints the entered refs
  as `[1]`, `[2]`, … and overlays exactly those positions, so a pre-scroll
  number the delta *also* printed resolves — to the delta's element, not the
  pre-scroll one. This is the ambiguity rejecting remap accepts: the model
  holds both numberings and the browser cannot tell which it meant, so the
  numbers it was shown *last* are the ones that stand. Only a pre-scroll
  number the delta did not print is refused. The rule is still honest about
  what it can know — it never aims a number at an element no page ever
  showed under it — but it does not make a scroll's overlap unambiguous, and
  nothing downstream should be written as though it did.
- Nothing is left to fire auto-vision on a stale ref. The refusal carries the
  page state, which is what the screenshot was standing in for, so the
  stale-ref trigger loses its last producer and goes with it.
- A number handed to the model outside a page read has to be recorded as
  shown, or the action after it is refused. `ground_visual` answers with one
  ref out of a collect the model never reads as a page, so the grounding port
  records that number. Marking the whole grounding collect shown instead
  would re-open this ADR's bug: it would silently revalidate every older
  number against the new numbering.
- A refused action is a failed call to the no-progress rail — neutral, as
  every failed call is.
