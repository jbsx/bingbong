# ADR 0010: Mechanical Blocker detection and a same-wall gate

## Status

Accepted

Extends ADR 0007 (detect → announce → ask); supersedes its layer 2
("prompt Blocker vocabulary" as the realization mechanism).

## Context

ADR 0007 made detection three layers, with model judgment (prompt
vocabulary) as the realization step and a passive URL/title nudge on
navigation only. In runs 46/47 that failed completely: Reddit's walls don't
match the title patterns ("Prove your humanity" vs "verify you are human"),
the challenge redirect (`?solution=…&js_challenge=1`) carried no URL signal,
detection never ran on `read_page` even though the snapshot contained the
reCAPTCHA iframe ref and wall text — and the model, seeing all of it, ground
for 80 rounds instead of escalating. Judgment that can be ignored forty
times is not detection.

## Decision

- **Detection is mechanical, in code**, running at two choke points:
  navigate-settle (existing) and `read_page` (new). One pure classifier
  (pattern → decision, no side effects) consuming URL, title, leading body
  text, dialog text, and refs — including challenge-host iframes combined
  with ref poverty (a page that *is* a challenge, not one that merely
  embeds one).
- **Signal table** adds: `google.* /sorry/` path; `js_challenge`,
  `solution`, `sei` as query params; titles "prove your humanity",
  "unusual traffic"; body text "blocked by network security" /
  "prove your humanity" near the start of the digest.
- **Two flavors, one parent.** Challenge (user can clear it on screen —
  CAPTCHA/human verification) vs Network Block (no in-view action clears
  it — the site refuses this network/session). The nudge names the flavor
  so the escalation ask is actionable.
- **A per-run Blocker gate** in the orchestrator pipeline and the subagent
  runner (mirroring the search-loop rail and vision budget): a detected
  marker arms it (flavor + host); while armed, browser tool calls on the
  same host other than read_page/look/ask_user are refused pre-execution
  with the escalation instruction. Any successful interaction with a
  different host disarms it. Subagents cannot ask_user directly — the
  refusal names the ASK_USER relay.
- **ERR_ABORTED recovery on navigate**: when a site's JS re-navigates
  mid-load (consent redirect, challenge reload) and the tab settles
  somewhere readable, navigate reports the actual current URL and the
  classifier runs on it, instead of throwing away where we landed.
  Timeouts remain hard errors.

## Consequences

- Detection no longer depends on the model cooperating with a nudge; the
  worst case is one wasted same-wall interaction, not forty.
- The signal table is fixture-tested against captured walls (Google
  `/sorry`, Reddit challenge/humanity/block pages) and negatives (pages
  that merely mention captchas).
- Consent dialogs remain the auto-cleared exception (ADR 0007, unchanged).
