# Bing Bong

Voice assistant with a live web-browsing dashboard. Local voice pipeline
(wake word, STT, TTS) + LLM agents (GLM-4.6 orchestrator, DeepSeek subagents)
driving a real embedded Chromium via CDP.

## Status

T1 scaffold complete: Electron + TypeScript (electron-vite, React renderer)
with an empty dashboard shell and the **command pipeline** seam.

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
  preload/     contextBridge preload
  renderer/    React dashboard (React)
  core/
    pipeline/  command pipeline + event types (the seam)
    ports/     interfaces for LLM, browser, TTS, search, clock
    testing/   test doubles (scripted LLM, fake clock, fakes)
```
