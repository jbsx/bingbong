# ADR 0073: A link that asks for a new window opens in the pane, and a window a script opens stays denied

## Status

Accepted on 2026-09-28 for #299, grilled the same day from the retained live
Run Traces with every recommendation taken. Narrows the consequence of
[ADR 0018](0018-auth-host-identity-and-popups.md) that non-auth hosts and
Subagent panes keep deny-and-report unchanged.

## Context

Since #18 every attempt by a page to open a window is denied, and the address
rides the click's Action Outcome as `popup blocked: <url>`, cut to 160
characters. ADR 0018 made one exception, for an Auth Host. The pane's own
handler made a second for the user: a middle- or ctrl-click navigates the
pane, since no tabs exist. A plain click on a link with `target="_blank"` is
denied like a script's `window.open`, for the model and for the user alike.

The traces hold 28 denied opens in 294 run directories, pilot to `fix-291`:

| Link | Events | Cut at 160 | Last seen |
|---|---|---|---|
| A Bing result's redirect, clicked on a Bing results page | 24 | 24 | `fix-265-267-4` |
| One Eurostar help page's link to the luggage page | 4 | 0 | `fix-283-3` |

- **All 28 are links.** None is a window a script opened unasked.
- **A whole address is used.** After each of the 4 the model navigated to
  it. Three landed; one was rewritten into a site search and reached the
  page a click later. Each cost a round.
- **A cut address is not.** Of the 24, one navigated to the cut address and
  failed, three clicked the same link again and were denied again, and 20
  left the link: 10 composed an address on the destination site, 6 changed
  search engine.
- **Eight were in Subagent panes**, on a 12-round budget.
- **The rate has fallen.** Since `fix-270`: 99 run directories, 58 clicks,
  one event. No Bing event is among them; that searches moving to the Run
  Engine (#270) is the reason is inferred, not read from a trace.

The window cannot be allowed natively. ADR 0018 records that creating it
inside an in-flight CDP mouse event wedges the command forever.

## Decision

- **A New-window Link opens in the pane.** When a click lands on a link and
  the page asks to open that link's address in a new window, the open is
  denied and the pane navigates there itself.
- **The link's address is either of two.** The address the snapshot showed
  for the link, or the address the link carries right after the click. A
  site that swaps a redirect in as the link is pressed is still followed.
- **Every other open stays denied and reported**, as a popup: a window a
  script opens from a button, from a link to some other address, or unasked.
- **One click, several opens.** The first that matches is followed. The rest
  are denied and reported on the same outcome.
- **The outcome of a followed click is a navigating click's**, with its
  landing and settled page, and one clause: `the link asked for a new
  window; opened here`.
- **A denied address is printed whole**, up to 2,000 characters. A target
  that is not an address to navigate to (`data:`, `javascript:`, `about:`)
  is printed as its scheme and a short cut. The `auth popup opened:` line
  takes the same rule.
- **A denied address is an Offered Address**, when it is one to navigate
  to. The app printed it as where the page meant to go.
- **Subagent panes take the same rule.** The Auth Popup stays the main
  pane's alone.
- **The user's own click takes the same rule, silently.** It is a user
  navigation like the middle-click, and nothing reports it to the model.
- **The Round Audit counts followed and denied opens per attempt.**
  Reported, never gated.

## Considered and refused

- **Following every open.** A script that opens an advertiser's window on
  any click would take the pane from the page the model was reading.
- **Keeping the denial and printing the whole address.** It works, by the
  four uncut events, and it costs a round each time. It is what a denied
  popup still gets.
- **Matching the snapshot's address alone.** It denies the links a results
  page rewrites as they are clicked.
- **Following any open made during a click on a link.** It follows the
  advertiser's window when the click was on a link.
- **A capture with a gate.** At one event in 99 run directories, three
  passes would most likely hold none, and the gate would measure chance.

## Consequences

- The page holding the link is replaced, not kept beside the new one. Back
  returns to it.
- A page that expects the window it opened to talk back to it gets no
  window. Only an Auth Popup is a real one.
- A link whose address a script changes to something the snapshot never
  showed, and which the link does not carry after the click, is denied and
  reported. The model can still navigate to the printed address.
- An outcome line can be 2,000 characters longer than before.

## Closing

On tests: the outcome lines in unit tests, and one e2e fixture with a
New-window Link, a link rewritten on click, and a window a script opens.

## Relationships

Narrows [ADR 0018](0018-auth-host-identity-and-popups.md). Adds a source to
the Offered Address of
[ADR 0050](0050-a-not-found-landing-is-neutral-and-a-composed-address-is-allowed-once-per-site.md) and leaves the
Composed Address rule otherwise as it is.
