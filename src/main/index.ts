import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import type { BrowserController, VisualGroundingController } from '../core/ports/browser'
import { createAgentActivityTracker, withAgentActivity } from '../core/downloads/agentActivity'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../core/pipeline/events'
import { attachAdblock } from './browser/attachAdblock'
import { createBrowserPane, BROWSER_PARTITION } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { attachDownloadRouter } from './browser/attachDownloadRouter'
import { runCliHarness, saveScreenshotFile } from './cli/runCliHarness'
import { abortActiveRun, attachAssistantAbortHotkey, attachAssistantToWindow, pipelineFor, registerAssistantIpc } from './agent/attachAssistant'
import { createAssistantPipeline } from './agent/createAssistantPipeline'
import { createSubagentRuntime, type SubagentRuntime } from './agent/createSubagentRuntime'
import { registerSubagentIpc } from './browser/subagentPanePool'
import { resolveDownloadsDir } from './downloadsDir'
import { resolvePreloadPath } from './preloadPath'
import { createSettingsStore } from './settings/settingsStore'
import { registerSettingsIpc } from './settings/attachSettings'
import { settingsToEnv } from '../core/settings/settings'
import { createUsageStore } from './settings/usageStore'
import { USAGE_IPC } from '../core/settings/usageIpcChannels'
import { HISTORY_IPC, HISTORY_HYDRATE_LIMIT } from '../core/history/ipcChannels'
import { openSessionStart, type HydrationSnapshot } from '../core/history/hydrationScope'
import { createHistoryRecorder } from '../core/history/historyRecorder'
import { createSessionMemory, SESSION_WINDOW_MS } from '../core/session/sessionMemory'
import { systemClock } from '../core/ports/clock'
import { createSqliteHistoryStore } from './history/createSqliteHistoryStore'
import { DEFAULT_DAILY_SPEND_WARN_USD } from '../core/agent/spendEstimate'
import { resolvePiperConfig } from './tts/piperConfig'
import { createMainTts } from './tts/createMainTts'
import { registerTtsIpc } from './tts/attachTts'
import { createSpeakingGate } from '../core/tts/speakingGate'
import { createPerfTracer } from '../core/perf/perfTracer'
import { browserSubspansEnabled, createBrowserSubspans } from '../core/perf/browserSubspans'
import { createJsonlPerfSink } from './perf/jsonlPerfSink'
import { resolveVoiceConfig } from './voice/voiceConfig'
import { createMainVoice } from './voice/createMainVoice'
import { attachVoiceToWindow, registerVoiceIpc } from './voice/attachVoice'
import { attachFeedPanelOverlayToWindow, registerFeedPanelIpc } from './panel/createFeedPanelOverlay'
import { audioDumpEnabled, createUtteranceDumper } from '../core/voice/utteranceDump'
import { silenceFramesForMs } from '../core/voice/vadEndpointing'
import { fsUtteranceDumpWriter } from './voice/utteranceDumpWriter'
import { resolveWakeConfig } from './wake/wakeConfig'
import { createMainWake } from './wake/createMainWake'
import { createChimeWav } from '../core/tts/chime'
import { createAplayPlayer } from './tts/createAplayPlayer'
import { KIOSK_FLAG, resolveLaunchConfig } from '../core/app/launchConfig'

// Appliance mode (T11): --kiosk goes fullscreen; the idle timeout reaches the
// renderer through the preload's launch-config snapshot.
const launchConfig = resolveLaunchConfig(process.argv, process.env)

// e2e harness seam: isolate the profile (cookies, cache, singleton lock) per run.
if (process.env.BINGBONG_USER_DATA_DIR) {
  app.setPath('userData', process.env.BINGBONG_USER_DATA_DIR)
}

// Terminal harness for browser control before voice exists (issue #4): a REPL
// over the same CDP controller the orchestrator will use, so browser actions
// are provable without the dashboard's UI.
const CLI_HARNESS_FLAG = '--browser-cli'
const runningCliHarness = process.argv.includes(CLI_HARNESS_FLAG) || process.env.BINGBONG_CLI === '1'

// Dashboard-editable settings (keys, routing, mic, …) live beside the profile.
// They layer over process.env, so a settings-page save re-routes the LLM on
// the next command without a restart.
const settingsStore = createSettingsStore(join(app.getPath('userData'), 'settings.json'))

// Daily spend estimate (warn-only): every orchestrator/subagent turn with
// reported usage lands here and surfaces on the settings page.
const usageStore = createUsageStore(join(app.getPath('userData'), 'usage.json'))

// Transcript + agent-run history (spec #1, Persistence): every event the
// dashboard renders is recorded here through the same projection, so a
// restart hydrates exactly what was on screen.
const historyStore = createSqliteHistoryStore(join(app.getPath('userData'), 'history.db'))
const historyRecorder = createHistoryRecorder(historyStore, { now: () => Date.now() })

// Always-on perf logging (#27): one JSONL span per finished stage under the
// profile's logs dir — zero configuration, no timers; rolling and the 7-day
// purge ride startup and writes.
const perfTracer = createPerfTracer({ sink: createJsonlPerfSink(join(app.getPath('userData'), 'logs')) })

// Verbose browser sub-spans (#32), opt-in behind the established env-flag
// pattern: one shared channel between the pipeline's tool gate (which opens
// the turn scope) and the main pane's controller (which emits). Flag off —
// the channel stays wired but writes nothing, so the default log keeps
// whole browser actions as plain tool spans, byte-identical.
const browserSubspans = createBrowserSubspans({ tracer: perfTracer, enabled: browserSubspansEnabled(currentEnv()) })

// Opt-in utterance audio dumps (#34): BINGBONG_AUDIO_DUMP=1 writes each
// detected utterance under <userData>/audio-dumps as a 16 kHz mono WAV —
// exactly the artifact shape the offline STT benchmark replays. Off by
// default (a benchmarking tap, not a recorder); the dumper stays wired but
// touches nothing until an utterance arrives with the flag on.
const utteranceDumper = createUtteranceDumper({
  dir: join(app.getPath('userData'), 'audio-dumps'),
  writer: fsUtteranceDumpWriter,
  enabled: audioDumpEnabled(currentEnv()),
})

// Subagent runtime (T12) is per-window: panes attach to the window's content
// view. The IPC layer resolves the window from the event sender.
const subagentRuntimes = new WeakMap<BrowserWindow, SubagentRuntime>()

function dailySpendWarnUsd(): number {
  const raw = Number(currentEnv().BINGBONG_DAILY_SPEND_WARN_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_SPEND_WARN_USD
}

// Session window override (default 30 min, ADR 0005 amends ADR 0001) — an
// e2e knob, like BINGBONG_ASK_TIMEOUT_MS: the lapse flows can't wait out
// real minutes. One knob for both the live store and boot hydration scope.
function sessionWindowMs(env: Record<string, string | undefined>): number | undefined {
  const value = Number(env.BINGBONG_SESSION_WINDOW_MS)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** The window the live session store and the hydration scope both use. */
function effectiveSessionWindowMs(): number {
  return sessionWindowMs(currentEnv()) ?? SESSION_WINDOW_MS
}

// Piper TTS: binary, voices dir, and base voice come from env (defaults
// suffice for a standard install); the settings page's voice wins per line.
const piperConfig = resolvePiperConfig(process.env, app.getPath('userData'))

// Ears (T9): Silero VAD + streaming Moonshine, shared by every window so
// the models load once. Scripted doubles ride the same seam for e2e.
const voiceConfig = resolveVoiceConfig(process.env, app.getPath('userData'))

// Wake word: "bing bong" plus the "abort" / "hold on" interrupt heads via the
// openWakeWord ONNX stack; the Python sidecar is the config-only fallback
// (BINGBONG_WAKE_ENGINE=python, wake head only).
const wakeConfig = resolveWakeConfig(process.env, app.getPath('userData'), app.getAppPath())
const wakeDetector = createMainWake(wakeConfig)
const chimeWav = createChimeWav()
const chimePlayer = createAplayPlayer()

function currentEnv(): Record<string, string | undefined> {
  return { ...process.env, ...settingsToEnv(settingsStore.get()) }
}

let cliHarnessStarted = false

function startCliHarness(controller: BrowserController, downloadsDir: string): void {
  if (cliHarnessStarted) return
  cliHarnessStarted = true

  void runCliHarness({
    controller,
    input: process.stdin,
    output: process.stdout,
    exit: () => app.quit(),
    screenshotDir: () => downloadsDir,
    saveScreenshot: saveScreenshotFile,
  }).catch((err: unknown) => {
    process.stderr.write(`browser cli harness failed: ${err instanceof Error ? err.message : String(err)}\n`)
    app.quit()
  })
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Bing Bong',
    // Kiosk = fullscreen appliance; the renderer reads the same flag and lets
    // the browser pane take over the layout.
    ...(launchConfig.kiosk ? { fullscreen: true, autoHideMenuBar: true } : {}),
    webPreferences: {
      preload: resolvePreloadPath(join(__dirname, '../preload')),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // App args don't reach the renderer's argv; additionalArguments is how
      // the preload learns about --kiosk. The idle timeout rides the env.
      additionalArguments: launchConfig.kiosk ? [KIOSK_FLAG] : [],
    },
  })

  // A pane per window; the persistent `persist:browse` session partition is what
  // keeps logins alive across windows and restarts. One CDP controller is
  // shared by everything that drives the pane (CLI harness, assistant) —
  // webContents.debugger allows a single attachment. The activity tracker
  // marks its download-capable verbs, so only agent-initiated downloads get
  // routed; manual ones keep the OS save dialog.
  const pane = createBrowserPane()
  attachBrowserPaneToWindow(pane, win)
  // The feed panel overlay (#45) stacks above the browser pane — attached
  // after it so the z-order is right from the first frame. Main's state
  // fold rides the same pipeline events the dashboard receives.
  const feedPanel = attachFeedPanelOverlayToWindow(win, { preloadDir: join(__dirname, '../preload') })
  // The panel shortcut also fires while the pane owns focus.
  feedPanel.registerShortcut(pane.view.webContents)

  const emitPipelineEvent = (event: PipelineEvent): void => {
    historyRecorder.event(event)
    if (!win.isDestroyed()) win.webContents.send(PIPELINE_IPC.event, event)
    feedPanel.handlePipelineEvent(event)
  }
  const agentActivity = createAgentActivityTracker()
  const controller: BrowserController & VisualGroundingController = withAgentActivity(
    createPaneBrowserController(pane, { subspans: browserSubspans }),
    agentActivity,
  )

  const downloadsDir = resolveDownloadsDir(process.env, app.getPath('downloads'))
  // Spoken output (T8), wrapped in a speaking gate (T9): the pipeline,
  // download announcements and the confirmation window share it, so the
  // 12 s voice window opens only after the prompt finishes speaking.
  const speakingGate = createSpeakingGate(
    createMainTts({
      config: piperConfig,
      pane: pane.view.webContents,
      getVoiceId: () => settingsStore.get().ttsVoice.trim() || piperConfig.voiceId,
      tracer: perfTracer,
    }),
  )
  attachDownloadRouter(pane.session, {
    dir: downloadsDir,
    tts: speakingGate.tts,
    isAgentActive: agentActivity.isActive,
    emit: emitPipelineEvent,
  })

  if (runningCliHarness) startCliHarness(controller, downloadsDir)

  // Subagents (T12): tab machine + pane pool + workhorse manager behind the
  // orchestrator's spawn/cancel/results tools. Events (live cards, spoken
  // announcements) ride the same pipeline channel as everything else.
  const subagentRuntime = createSubagentRuntime({
    win,
    session: pane.session,
    downloadsDir,
    getEnv: currentEnv,
    tts: speakingGate.tts,
    emit: emitPipelineEvent,
    onUsage: (record) => usageStore.record(record.role, record.model, record.usage),
    tracer: perfTracer,
    onEscape: () => {
      const activePipeline = pipelineFor(win)
      return activePipeline ? abortActiveRun(activePipeline) : false
    },
    // New subagent views append above older ones — the feed overlay
    // re-tops itself so the panel never slides beneath a tab viewport.
    onViewAdded: () => feedPanel.bringToTop(),
  })
  subagentRuntimes.set(win, subagentRuntime)
  win.on('closed', () => {
    subagentRuntime.dispose()
    subagentRuntimes.delete(win)
  })

  const voice = await createMainVoice(voiceConfig)
  // Voice before assistant: the pipeline's event tap feeds the session's
  // confirmation window, so the session must exist when events start.
  const voiceSession = attachVoiceToWindow(win, {
    vad: voice.vad,
    transcriber: voice.transcriber,
    tts: speakingGate.tts,
    ttsIdle: speakingGate,
    wake: wakeDetector
      ? {
          detector: wakeDetector,
          // The settings slider applies to the next 80 ms chunk.
          getThreshold: () => settingsStore.get().wakeWordThreshold,
          chime: () => {
            // The cue must never break activation — a player failure is silent.
            chimePlayer.play(chimeWav).done.catch(() => {})
          },
        }
      : undefined,
    // The endpoint-delay slider (#37) applies to the next utterance, live.
    getEndpointerConfig: () => ({
      endFrames: silenceFramesForMs(settingsStore.get().endpointDelayMs),
    }),
    recordHeard: (heard) => {
      historyRecorder.heard(heard)
      // The panel's feed carries voice lines too (#45): the same stamped
      // payload the dashboard gets rides the overlay's voice channel.
      feedPanel.forwardHeard(heard)
    },
    recordError: (message, at) => {
      historyRecorder.voiceError(message, at)
      feedPanel.forwardVoiceError({ message, at })
    },
    tracer: perfTracer,
    dumper: utteranceDumper,
  })
  // Session continuity (spec #23): one in-memory thread per window, fed from
  // the same run-observer seam as the history recorder. The pipeline reads it
  // live on every orchestrator round; it dies on quit and never persists.
  // Session-scoped feed (spec #25; ADR 0005 supersedes ADR 0003's lazy
  // clear): when the store reports a new session — the eager lapse timer
  // firing while idle, a window-lapsed command, or a model-invoked reset —
  // the dashboard gets a session_started event and wipes the view eagerly.
  // history.db is untouched: the event projects to no transcript entry.
  const sessionMemory = createSessionMemory({
    windowMs: effectiveSessionWindowMs(),
    onSessionStart: () => emitPipelineEvent({ type: 'session_started', at: systemClock.now() }),
  })
  const pipeline = createAssistantPipeline({
    controller,
    env: currentEnv(),
    getEnv: currentEnv,
    tts: speakingGate.tts,
    subagentTools: subagentRuntime.tools,
    subagentControl: subagentRuntime,
    onLlmUsage: (record) => usageStore.record(record.role, record.model, record.usage),
    session: sessionMemory,
    tracer: perfTracer,
    browserSubspans,
    // Progress detail (#43): mid-await signals ride the same channel; the
    // history projection maps them to no entry, so recording is unchanged.
    emitDetail: emitPipelineEvent,
  })
  attachAssistantToWindow(
    pipeline,
    win,
    (event) => {
      voiceSession.handlePipelineEvent(event)
      // Run events reach the panel's fold through the same observer tap —
      // one seam, every event (the fold's command/done pair drives peek).
      feedPanel.handlePipelineEvent(event)
    },
    () => {
      const historyRun = historyRecorder.run()
      const sessionRun = sessionMemory.run()
      return (event) => {
        historyRun.event(event)
        sessionRun.event(event)
      }
    },
  )
  const detachPaneAbort = attachAssistantAbortHotkey(pipeline, pane.view.webContents)
  win.on('closed', detachPaneAbort)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  registerBrowserIpc()
  registerAssistantIpc()
  registerSubagentIpc((event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? subagentRuntimes.get(win) : undefined
  })
  registerSettingsIpc(settingsStore)
  registerFeedPanelIpc()
  ipcMain.handle(USAGE_IPC.getToday, () => usageStore.summary(dailySpendWarnUsd()))
  ipcMain.handle(HISTORY_IPC.recentEntries, (): HydrationSnapshot => {
    // Restart hydration (ADR 0005): entries ship unfiltered — recording and
    // the read stay review-only — beside the still-open session's start,
    // computed with the same window the live store uses. The renderer's
    // projection decides what renders; a lapsed session boots blank.
    const windowMs = effectiveSessionWindowMs()
    const entries = historyStore.recentEntries(HISTORY_HYDRATE_LIMIT)
    const runs = historyStore.recentRuns(HISTORY_HYDRATE_LIMIT)
    return { entries, sessionStartAt: openSessionStart(runs, systemClock.now(), windowMs) }
  })
  ipcMain.handle(HISTORY_IPC.recentRuns, () => historyStore.recentRuns(50))
  ipcMain.handle(HISTORY_IPC.recordVoiceError, (_event, message: unknown) => {
    if (typeof message !== 'string' || message.trim() === '') return null
    const at = Date.now()
    historyRecorder.voiceError(message, at)
    return at
  })
  registerTtsIpc({ voicesDir: () => piperConfig.voicesDir })
  registerVoiceIpc()

  // Embedder-level adblocker (issue #21): enabled before the first window so
  // every view on the persistent browse partition (main pane + subagent
  // tabs) is covered from its first navigation. The await is a deliberate
  // tradeoff — a cold cache delays the first window by one list download
  // (bounded fetches; failures degrade to no blocking) so "on at startup"
  // is never "racing the first navigation".
  const adblock = attachAdblock({
    session: session.fromPartition(BROWSER_PARTITION, { cache: true }),
    settingsStore,
    userDataDir: app.getPath('userData'),
    env: process.env,
  })
  app.on('will-quit', () => {
    adblock.dispose()
    historyStore.close()
  })
  await adblock.ready()

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
