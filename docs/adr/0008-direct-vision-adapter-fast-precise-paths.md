# ADR 0008: Vision served by a direct chat-completions adapter, split fast/precise paths

## Status

Accepted

## Context

Vision (`look`, `ground_visual`, auto-vision on anomalies) went through `@z_ai/mcp-server` over stdio: spawn a child process, write the screenshot to a temp file, call `analyze_image`, parse text content back. Two problems surfaced on 2026-08-23:

1. **The server hard-locks reasoning on.** `chat-service.js` sends `thinking: { type: 'enabled' }` on every call, with no env or argument to disable it. Direct-API probes on the same image and key: 9.8s with thinking, **1.4-1.8s** with `thinking: disabled` + a short answer-bounded prompt + a `max_tokens` cap. That is a ~7x latency lever the MCP path cannot reach. Worse, capping tokens through the server (its `Z_AI_VISION_MODEL_MAX_TOKENS`) makes calls *fail* — the cap starves the mandatory reasoning budget.
2. **Wall-clock variance is large.** The same request measured 9.8s and 24.8s minutes apart; a real Reddit screenshot took 62s (pre-deadline) and >30s (killed by the 30s deadline from ADR-era fix #58, run 46). A fixed deadline below real latency turns healthy calls into failures, after which the orchestrator browses blind.

The alternative endpoint/model routes (glm-4.5v, glm-4v-flash on the regular PAAS endpoint) are unavailable with a coding-plan key (unknown model / no balance), so the coding endpoint stays.

## Decision

- **Drop the MCP server; serve vision with a direct chat-completions adapter** (`fetch` against the same OpenAI-compatible endpoint routing already resolves for the vision role). We own request shaping; no child process, no temp files, no stdio hop.
- **Split the two vision capabilities:**
  - **Describe (`look`, auto-vision) is the fast path**: reasoning disabled, short answer-bounded prompt, small `max_tokens` cap. Target ~2s; it answers "is anything blocking/what changed", where reasoning adds latency, not value.
  - **Locate (`ground_visual` fallback) is the precision path**: reasoning enabled, larger token cap, generous deadline. It returns a viewport point that must survive element mapping, and it is the rare DOM-fallback case.
- **Capture once, cheaply**: full-width JPEG at reduced quality (no resize) — smaller upload, no coordinate scaling concerns for Locate.
- **Keep a per-call deadline as a safety net** (endpoint variance is real), with distinct values per path; on breach the failure surfaces to the model with an advisory nudge (proceed DOM-only or `ask_user`), mirroring the Blocker nudge pattern — never a silent blind browse.

## Consequences

- The `@z_ai/mcp-server` dependency is removed; its env knobs (`Z_AI_VISION_MODEL_*`) disappear with it.
- Latency levers (thinking mode, prompt shape, token cap) become first-class config of the adapter.
- The Describe fast path makes auto-vision cheap enough to fire more liberally; the per-run Vision Budget still bounds it.
- If Z.ai later exposes thinking control through the server, the adapter remains preferable: fewer moving parts and full lever access.
