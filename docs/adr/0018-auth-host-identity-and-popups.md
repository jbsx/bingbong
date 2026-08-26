# ADR 0018: Simplified identity on auth hosts, pane-opened auth popups

## Status

Accepted

## Context

Google (and some other providers) block account sign-in from embedded browser frameworks — since January 2021 by explicit anti-phishing policy, with the "This browser or app may not be secure" wall. Measurements on our Electron 43 pane (diagnostics under Xvfb, Octoverse 2026) showed the UA string was already clean (`Electron/x` stripped), client hints carried no Electron brand, and `navigator.userAgentData` was honest Chromium — yet two tells remained: the UA carried the **unreduced full build number** (`Chrome/150.0.7871.224`; real desktop Chromium freezes to `150.0.0.0`) while the brand set said Chromium-not-Chrome. No real browser produces that combination. A second independent blocker: sign-in flows often require their `window.open` popup to exist (postMessage back to the opener), and our popup policy denied everything.

Two implementation constraints shaped the mechanism:

- **Native `action: 'allow'` for popups is unusable here**: creating the child window synchronously inside CDP `Input.dispatchMouseEvent` handling wedges the in-flight input command forever (reproduced deterministically; the response never arrives). 
- **Disabling the adblocker clears every `webRequest` listener on the partition** (Electron allows one listener per event; `disableBlockingInSession` nulls them), so a header-rewrite listener must re-assert itself across that swap.

## Decision

- **Auth hosts get a simplified identity, everything else stays honest Chromium.** Default hosts: `accounts.google.com`, `accounts.youtube.com` (env-tunable: `BINGBONG_AUTH_HOSTS`, `BINGBONG_AUTH_UA`). Partition-wide, the UA's Chrome token is frozen to `major.0.0.0` like a real desktop build. On auth hosts only, requests carry the override UA (`Chrome`), no `Sec-CH-UA*` client hints, and an injected document-start script aligns `navigator.userAgent`/`userAgentData` — the server and the page see the same small unknown browser, which these providers serve a basic sign-in flow instead of running Chrome-specific embedded-framework checks. This deliberately follows Google's own published rule ("identify clearly, don't borrow Chrome's UA") rather than forging a full Chrome fingerprint.
- **Auth popups: deny-and-open.** `window.open` to an auth host is still denied (the wedge above), but the URL is queued and the pane opens the window itself outside any in-flight command — at the controller's outcome-time drain during agent runs, or via a 1.5 s fallback timer for manual clicks. The outcome line reports `auth popup opened: <url>`. The popup is a real BrowserWindow on the browse partition (cookies shared), and while one is open the **auth-popup director** routes the page-action tools (read/click/type/scroll/screenshot/press/media/pageFacts/describeRef/grounding/refAtPoint) to the newest live popup; navigation verbs and `state()` stay pane-owned. Closing it restores the pane.
- **L3 (driving a real Chrome via CDP) stays parked** — the honest-Chromium + simplified-auth-host stance is revisited only if providers escalate past it. A refusal that survives this policy would surface as a login-wall/network-block escalation (ADR 0007/0010); no new Blocker flavor was added.

## Consequences

- Google sign-in becomes possible in-pane without an architecture pivot; the win is verified live (manual check against `accounts.google.com`) and mechanically via the header-echo e2e — CI asserts the rewrite, not Google's verdict, so a future detection shift needs the live check to catch it.
- The identity rewrite survives adblock enable/disable through a re-assertion hook; if more webRequest listeners appear later, they must register through the same pattern.
- The popup exception is intentionally narrow: subagent panes and non-auth hosts keep the deny-and-report behavior (issue #18) unchanged; `data:`/`about:` targets never qualify.
- Auto-vision, Look, and screenshots all operate on the popup through the same routed controller, so a voice-driven sign-in flow is fully observable and steerable.
