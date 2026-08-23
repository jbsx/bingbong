# ADR 0006: Model-invoked UI control for hands-free operation

## Status

Accepted

## Context

The app's goal is hands-free after setup (Q1c: credentials/first-run by keyboard, everything else by voice), but every UI affordance today is mouse/keyboard-only: the feed panel's buttons, the settings page, back/forward chrome, quit. ADR 0002 already settled the philosophy for `new_session` — model-invoked tools over hard-coded phrase routing, because paraphrases work and the catalog stays honest. UI control is the same decision at wider scope.

## Decision

- **Small tools, not a mega-tool.** The orchestrator catalog gains: `toggle_panel`, `set_panel_mode` (overlay/docked), `set_panel_width`, `go_forward` (parity with `back`), `set_setting` (any Setting except credentials), `app_control` (quit/reload). No stringly-typed `ui_control(action, …)` — the existing catalog's grammar is one tool per verb.
- **Scope:** panel ops, navigation, settings (wake threshold, endpoint delay, TTS voice, adblock, web zoom, weather, model routing), app quit/reload. **Never** credentials, API keys, or mic selection — keyboard setup territory.
- **Risk gating:** `app_control` requires the existing voice yes/no confirmation; `set_setting` and panel ops fire immediately.
- **Feedback is asymmetric:** panel ops are silent; destructive actions (quit/reload) get a spoken ack.
- **Panel width** becomes a persisted View Preference (localStorage, like panel mode) set by drag-resize or voice — relative steps ("wider") and presets ("half screen"), no absolute pixels.
- **STT synergy:** the settings/panel vocabulary joins the bias lexicon (see ADR 0006-era transcription work) so Moonshine reliably hears "dock", "overlay", "wider".

## Consequences

- Every dashboard affordance gains a voice pathway; the mouse becomes optional everywhere except first-run setup.
- Phrase routing was considered and rejected (brittle, duplicates the model's job); if a phrase deserves instant local handling later, it can be added as an exception like abort/pause — not the default architecture.
