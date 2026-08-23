# ADR 0007: Blockers are detected and escalated, never auto-cleared (except consent)

## Status

Accepted

## Context

Today there is zero CAPTCHA handling: the snapshot collector is top-frame text-only (cross-origin challenge iframes are invisible), vision is pull-only, and the prompt has no Blocker vocabulary. The wishlist (`todo: "get past captchas"`) and an early proposal in this session both leaned toward auto-attempting challenges (vision-grounded clicks, solver services, ad-skip reversal). That was rejected: auto-attempts mostly fail, feed an arms race, and burn long agent runs — too much overhead. What the user actually wants is *dynamic realization*: the agent notices any blockage and says so, prompting the user.

## Decision

- **A Blocker is anything between the agent and page content**: consent dialog, CAPTCHA, login wall, paywall, age gate, native file-select dialog.
- **Policy: detect → announce → ask.** Consent dialogs keep their existing auto-clear (privacy-preferring control first). Every other Blocker is escalated to the user via `ask_user` (spoken) — the agent never attempts to clear, solve, or click through it. The prompt's "never skip, close or fast-forward through ads" prohibition is retained unchanged.
- **Detection is three layers:**
  1. **Snapshot iframe-awareness** — the page collector lists cross-origin iframes (with src) as refs, so challenge widgets become visible to `read_page` instead of invisible.
  2. **Prompt Blocker vocabulary** — the orchestrator prompt names the classes and instructs: recognize → verify with vision → escalate.
  3. **Passive nudge on navigation** — a cheap URL/title pattern check (`cf-challenge`, `recaptcha`/`turnstile`, "unusual traffic", sign-in redirects) injects a system nudge telling the model to look, so realization doesn't depend on the model happening to call `look`.

## Consequences

- No CAPTCHA is ever auto-cleared; the agent stops pretending a blocked page is readable and asks the user instead.
- `todo` "get past captchas" is resolved as *detect and escalate*, superseding the auto-solve wish.
- Adding auto-attempt later is additive per-class (the detection layers stand regardless).
