# Bing Bong

Voice assistant with a live web-browsing dashboard. Local voice pipeline
(wake word, STT, TTS) + LLM agents (GLM-4.6 orchestrator, DeepSeek subagents)
driving a real embedded Chromium via CDP.

## Status

T1 scaffold + command-pipeline seam, T2 browser pane, T3 CDP controller +
CLI harness complete. T4 adds the **text-driven assistant**: a model router
(config-only provider swapping), an OpenAI-compatible orchestrator client, and
a command text box on the dashboard — type a command, watch the browser act,
get a spoken one-liner plus full detail in the transcript.

T5 adds the **risk gate**: every click/type is classified from snapshot facts
(collected in-page, policy in code). Form submissions and downloads pause on a
spoken + on-screen confirmation (auto-deny after 60 s); credential fills and
payment submissions are hard-denied in code — no confirmation, no override.

## Configuring models

Model routing is env-only — no model ids are hardcoded. Per role
(`ORCHESTRATOR`, `SUBAGENT`, `VISION`):

```sh
BINGBONG_ORCHESTRATOR_BASE_URL   # e.g. https://ai.z.ai/api/coding/paas/v4 (z.ai coding plan)
BINGBONG_ORCHESTRATOR_MODEL      # e.g. glm-5.3
BINGBONG_ORCHESTRATOR_API_KEY    # or rely on the default key env (ZAI_API_KEY for
                                 # orchestrator/vision, DEEPSEEK_API_KEY for subagent),
                                 # or point elsewhere with BINGBONG_ORCHESTRATOR_API_KEY_ENV
```

Any OpenAI-compatible provider works for any role — swapping providers is a
config change. `BINGBONG_LLM_SCRIPT` (a JSON array of scripted turns) replaces
the live model entirely — used by the e2e suite and keyless demos.

## Try it

```sh
export ZAI_API_KEY=… BINGBONG_ORCHESTRATOR_BASE_URL=https://ai.z.ai/api/coding/paas/v4 BINGBONG_ORCHESTRATOR_MODEL=glm-5.3
pnpm dev
```

Type `open youtube and play the first MKBHD result` into the command box and
watch the loop navigate, read, type, and click.

## The seam

Everything is tested through one boundary: a text command goes in, a typed
event stream comes out (`src/core/pipeline`). The stream covers status
transitions, tool calls/results, confirmation requests and resolutions,
speak/display payloads, and errors.

- **Above the seam** (thin adapters, later tickets): voice pipeline, dashboard UI.
- **Below the seam** (interfaces + test doubles, `src/core/ports`): LLM client,
  browser controller, TTS, search, clock (injectable for timeout tests).

## Commands

```sh
pnpm install    # install
pnpm dev        # launch the app in dev mode
pnpm test       # run the test suite
pnpm typecheck  # tsc over main/preload/core + renderer
pnpm lint       # eslint
pnpm build      # production build to out/
```

## Layout

```
src/
  main/        Electron main process
    agent/     model-routed OpenAI client, orchestrator prompt, pipeline glue, IPC
  preload/     contextBridge preload
  renderer/    React dashboard (command box, transcript, status orb, browser pane)
  core/
    agent/     model routing config + the answer contract (speak/display)
    pipeline/  command pipeline + event types (the seam)
    ports/     interfaces for LLM, browser, TTS, search, clock
    testing/   test doubles (scripted LLM, fake clock, fakes)
```
