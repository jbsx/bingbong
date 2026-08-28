import { app, BrowserWindow, crashReporter, ipcMain, session } from 'electron'
import { join } from 'node:path'
import type { BrowserController, VisualGroundingController } from '../core/ports/browser'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { createAgentActivityTracker, withAgentActivity } from '../core/downloads/agentActivity'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import { attachAdblock } from './browser/attachAdblock'
import { attachIdentityHeaders } from './browser/attachIdentityHeaders'
import { createBrowserPane, BROWSER_PARTITION } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { createAuthPopupDirector } from './browser/authPopupDirector'
import { resolveAuthIdentity } from '../core/browser/authIdentity'
import { resetBrowserState } from './browser/resetBrowserState'
import { attachDownloadRouter } from './browser/attachDownloadRouter'
import { runCliHarness, saveScreenshotFile } from './cli/runCliHarness'
import { abortActiveRun, attachAssistantAbortHotkey, attachAssistantToWindow, pipelineFor, registerAssistantIpc } from './agent/attachAssistant'
import { createAssistantPipeline } from './agent/createAssistantPipeline'
import { createAssistantCommandRunner } from './agent/createAssistantCommandRunner'
import { createSubagentRuntime, type SubagentRuntime } from './agent/createSubagentRuntime'
import { registerSubagentIpc } from './browser/subagentPanePool'
import { resolveDownloadsDir } from './downloadsDir'
import { resolvePreloadPath } from './preloadPath'
import { createSettingsStore } from './settings/settingsStore'
import { registerSettingsIpc } from './settings/attachSettings'
import { settingsToEnv } from '../core/settings/settings'
import { layerEnv } from '../core/settings/dotEnv'
import { resolveRoutingStatus } from '../core/agent/modelRouting'
import { loadEnvFile } from './envFile'
import { createUsageStore } from './settings/usageStore'
import { USAGE_IPC } from '../core/settings/usageIpcChannels'
import { HISTORY_IPC, HISTORY_QUERY_LIMIT } from '../core/history/ipcChannels'
import { createHistoryRecorder } from '../core/history/historyRecorder'
import { systemClock } from '../core/ports/clock'
import {
  createSessionRuntime,
  parseSessionContinuityBudgets,
  type EndedSession,
  type SessionRuntime,
} from '../core/session/sessionRuntime'
import { createSessionIdentitySource } from './session/sessionIdentitySource'
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
import { createLearnedTermsStore, seedLexiconSet } from './voice/learnedTermsStore'
import { registerLearnedTermsIpc } from './voice/attachLearnedTerms'
import { attachVoiceToWindow, registerVoiceIpc } from './voice/attachVoice'
import { attachFeedPanelOverlayToWindow, registerFeedPanelIpc } from './panel/createFeedPanelOverlay'
import { defaultFeedPanelWidth } from '../core/panel/feedPanelState'
import { audioDumpEnabled, createUtteranceDumper } from '../core/voice/utteranceDump'
import { silenceFramesForMs } from '../core/voice/vadEndpointing'
import { fsUtteranceDumpWriter } from './voice/utteranceDumpWriter'
import { resolveWakeConfig } from './wake/wakeConfig'
import { createMainWake } from './wake/createMainWake'
import { createChimeWav } from '../core/tts/chime'
import { createAplayPlayer } from './tts/createAplayPlayer'
import { KIOSK_FLAG, resolveLaunchConfig } from '../core/app/launchConfig'
import { attachGpuStability, gpuCrashRecordPath } from './attachGpuStability'
import { attachAppearance } from './attachAppearance'
import { VOICE_IPC } from '../core/voice/ipcChannels'
import { createWindowEventPublisher } from './session/windowEventPublisher'
import { createPipelineAcceptanceGate } from './session/pipelineAcceptance'
import { attachSessionToWindow, registerSessionIpc } from './session/attachSession'

// Appliance mode (T11): --kiosk goes fullscreen; the idle timeout reaches the
// renderer through the preload's launch-config snapshot.
const launchConfig = resolveLaunchConfig(process.argv, process.env)

// e2e harness seam: isolate the profile (cookies, cache, singleton lock) per run.
if (process.env.BINGBONG_USER_DATA_DIR) {
  app.setPath('userData', process.env.BINGBONG_USER_DATA_DIR)
}

// GPU crash-loop recovery: a crash-looping GPU process ends in a
// browser-process FATAL ("GPU process isn't usable. Goodbye.") that takes
// the whole app — window, live Session, in-flight Run — with it, with no
// close handler left running. Boot with the GPU disabled when asked
// (BINGBONG_DISABLE_GPU=1 / --disable-gpu) or when the previous run's
// persisted deaths say it looped; relaunch with the switch when a loop
// shows up live. Must precede app ready like every appendSwitch.
attachGpuStability({
  app,
  argv: process.argv,
  env: process.env,
  recordPath: gpuCrashRecordPath(app.getPath('userData')),
  now: systemClock.now,
})

// Middle-click autoscroll (the appliance input pass, with ADR 0020 and ADR 0021): Chromium ships autoscroll
// off by default on Linux — one blink feature switch turns it on for
// every webContents. It coexists with the pane's middle-click-on-link
// rule: links still route through the window-open handler (current-pane
// navigation), autoscroll owns the page area. Must precede app ready.
app.commandLine.appendSwitch('enable-blink-features', 'MiddleClickAutoscroll')

// Crash evidence (ADR 0017): renderer death leaves a dump instead of
// vanishing silently; reports stay local — nothing uploads anywhere. The
// dump directory is resolved at start(), so this must follow the profile
// switch above — evidence lands beside the profile in use, still before
// any renderer process exists.
crashReporter.start({ uploadToServer: false })

// Terminal harness for browser control before voice exists (issue #4): a REPL
// over the same CDP controller the orchestrator will use, so browser actions
// are provable without the dashboard's UI.
const CLI_HARNESS_FLAG = '--browser-cli'
const runningCliHarness = process.argv.includes(CLI_HARNESS_FLAG) || process.env.BINGBONG_CLI === '1'

// Dashboard-editable settings (keys, routing, mic, …) live beside the profile.
// They layer over process.env, so a settings-page save re-routes the LLM on
// the next command without a restart.
const settingsStore = createSettingsStore(join(app.getPath('userData'), 'settings.json'))

// The `.env` next to the app (#76): read once at boot and layered under
// process.env, completing the .env < process.env < settings precedence that
// currentEnv() resolves. Boot-scoped launch flags (kiosk, idle timeout) stay
// argv/process-env — the renderer's preload reads its own process env and
// must never disagree with main's.
const envFileValues = loadEnvFile(process.env, app.getAppPath())

// Daily spend estimate (warn-only): every orchestrator/subagent turn with
// reported usage lands here and surfaces on the settings page.
const usageStore = createUsageStore(join(app.getPath('userData'), 'usage.json'))

// Learned Terms ledger (ADR 0022): the Bias Lexicon's runtime-grown half —
// one app-global lexicon.json beside the settings file. The pipeline's
// Mishear proposals grow it autonomously (recurrence-gated); the settings
// page is its one human surface. Fails closed to seed-only on corruption.
const learnedTermsStore = createLearnedTermsStore(join(app.getPath('userData'), 'lexicon.json'), seedLexiconSet())
registerLearnedTermsIpc(learnedTermsStore)

// Recorded History (spec #1, Persistence): every live event is recorded for
// explicit review, but launches never restore it into the Feed or continuity.
const historyStore = createSqliteHistoryStore(join(app.getPath('userData'), 'history.db'))
const historyRecorder = createHistoryRecorder(historyStore, { now: () => Date.now() })
// The window owns the Session runtime; module-level handle for the few IPC
// paths that need the live Session identity for history attribution (#85).
let activeSessionRuntime: SessionRuntime | null = null

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

// Session Window (default 30 min, ADR 0014): resolved once with the launch
// config — BINGBONG_SESSION_WINDOW_MS is the one e2e knob (the lapse flows
// can't wait out real minutes), driving only live runtime state.

// Piper TTS: binary, voices dir, and base voice come from env (defaults
// suffice for a standard install); the settings page's voice wins per line.
const piperConfig = resolvePiperConfig(process.env, app.getPath('userData'))

// Ears (T9): Silero VAD + streaming Moonshine, shared by every window so
// the models load once. Scripted doubles ride the same seam for e2e. The
// STT tier is the settings snapshot at startup (#63) — switching the
// Setting applies at the next start.
const voiceConfig = resolveVoiceConfig(process.env, app.getPath('userData'), settingsStore.get().sttModel)

// Wake word: "bing bong" plus the "abort" interrupt head via the
// openWakeWord ONNX stack ("hold on" is scored but unwired, ADR 0024); the
// Python sidecar is the config-only fallback
// (BINGBONG_WAKE_ENGINE=python, wake head only).
const wakeConfig = resolveWakeConfig(process.env, app.getPath('userData'), app.getAppPath())
const wakeDetector = createMainWake(wakeConfig)
const chimeWav = createChimeWav()
const chimePlayer = createAplayPlayer()

function currentEnv(): Record<string, string | undefined> {
  return { ...layerEnv(envFileValues, process.env), ...settingsToEnv(settingsStore.get()) }
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
    // The appliance commitment (ADR 0012): no OS title bar, no window
    // buttons — the renderer's Toolbar band is the drag region, Alt+F4
    // closes.
    titleBarStyle: 'hidden',
    // Kiosk = fullscreen appliance; the renderer reads the same flag and
    // the layout is pixel-identical to windowed (ADR 0012).
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
  const pane = createBrowserPane({ getZoomPercent: () => settingsStore.get().webZoomPercent })
  // The feed panel overlay (#45) stacks above the browser pane — attached
  // above it before the first frame. Main's state
  // fold rides the same pipeline events the dashboard receives; the fold's
  // width default matches the launch mode (#65) until the dashboard pushes
  // the persisted preference.
  const feedPanel = attachFeedPanelOverlayToWindow(win, {
    preloadDir: join(__dirname, '../preload'),
    defaultWidth: defaultFeedPanelWidth(),
  })
  // The panel shortcut also fires while the pane owns focus.
  feedPanel.registerShortcut(pane.view.webContents)

  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
  let sessionRuntime: SessionRuntime | null = null
  let lastEndedSession: EndedSession | null = null
  // The one acceptance predicate every pipeline-level consumer shares (#97):
  // late subagent, browser, or Feed work from an ended or foreign Session
  // is rejected before it can render, record, or speak.
  const acceptPipelineEvent = createPipelineAcceptanceGate({
    liveSession: () => sessionRuntime?.state(),
    lastEndedSession: () => lastEndedSession,
  })
  const eventPublisher = createWindowEventPublisher({
    acceptPipelineEvent,
    createHistoryRunObserver: () => {
      const run = historyRecorder.run()
      return (event) => run.event(event)
    },
    historyEvent: (event) => historyRecorder.event(event),
    historyHeard: (heard, sessionId) => historyRecorder.heard(heard, sessionId),
    historyVoiceError: (error, sessionId) => historyRecorder.voiceError(error.message, error.at, sessionId),
    sendPipelineEvent: (event) => sendToRenderer(PIPELINE_IPC.event, event),
    sendVoiceState: (state) => sendToRenderer(VOICE_IPC.stateChanged, state),
    sendVoiceHeard: (heard) => sendToRenderer(VOICE_IPC.heard, heard),
    sendVoiceError: (error) => sendToRenderer(VOICE_IPC.error, error),
    sendBrowserState: (state) => sendToRenderer(BROWSER_IPC.stateChanged, state),
    sendSubmissionFeedback: (feedback) => sendToRenderer(PIPELINE_IPC.submissionFeedback, feedback),
    observeVoicePipelineEvent: (event) => voiceSession.handlePipelineEvent(event),
    overlayPipelineEvent: (event) => feedPanel.handlePipelineEvent(event),
    overlayVoiceHeard: (heard) => feedPanel.forwardHeard(heard),
    overlayVoiceError: (error) => feedPanel.forwardVoiceError(error),
    overlaySubmissionFeedback: (feedback) => feedPanel.forwardSubmissionFeedback(feedback),
  })
  attachBrowserPaneToWindow(pane, win, eventPublisher)
  feedPanel.bringToTop()
  const agentActivity = createAgentActivityTracker()
  // Auth popups (ADR 0018): while a sign-in popup window is open, browser
  // tools route to it — the flow is voice-interactable. The CLI harness and
  // the assistant share this routed controller.
  const authPopups = createAuthPopupDirector(pane, {
    createController: (webContents) => createPaneBrowserController({ view: { webContents } }),
  })
  const controller: BrowserController & VisualGroundingController = withAgentActivity(
    authPopups.route(createPaneBrowserController(pane, { subspans: browserSubspans })),
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
    emit: (event) => eventPublisher.publish({ source: 'download', event }),
  })

  if (runningCliHarness) startCliHarness(controller, downloadsDir)

  // Subagents (T12): tab machine + pane pool + workhorse manager behind the
  // orchestrator's spawn/cancel/results tools. Events (live cards, spoken
  // announcements) ride the same pipeline channel as everything else. The
  // surface is Session-owned (#97): spawns stamp the live Session on the
  // agent, and every event — TTS lines included — passes the window's
  // acceptance gate, so an ended Session's late work neither renders nor
  // speaks, whatever Session is live by then.
  const subagentRuntime = createSubagentRuntime({
    win,
    session: pane.session,
    downloadsDir,
    getEnv: currentEnv,
    tts: speakingGate.tts,
    emit: (event) => eventPublisher.publish({ source: 'subagent', event }),
    owner: () => {
      const state = sessionRuntime?.state()
      return state?.sessionId != null
        ? { sessionId: state.sessionId, generation: state.generation }
        : null
    },
    canPublish: acceptPipelineEvent,
    onUsage: (record) => usageStore.record(record.role, record.model, record.usage),
    tracer: perfTracer,
    onEscape: () => {
      const activePipeline = pipelineFor(win)
      return activePipeline ? abortActiveRun(activePipeline) : false
    },
    // A subagent pane reopened into the main browsing area rises above the
    // main pane — the feed overlay re-tops itself so the panel stays
    // reachable above it. Parked thumbnail views are exempt (ADR 0004).
    onViewAdded: () => feedPanel.bringToTop(),
    // Subagent panes inherit the web-zoom setting (#53).
    getZoomPercent: () => settingsStore.get().webZoomPercent,
    // The cards' Reopen control moves a subagent pane into the main
    // browsing area (#57) — it mirrors the main pane's rect from then on.
    mainPane: pane,
  })
  subagentRuntimes.set(win, subagentRuntime)
  win.on('closed', () => {
    subagentRuntime.dispose()
    subagentRuntimes.delete(win)
  })

  const voice = await createMainVoice(voiceConfig, () => learnedTermsStore.biasPhrases())
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
    // Both endpoint timings ride this seam (#60): the silence threshold and
    // the resumption-merge window, each live from its Setting (#59).
    getEndpointerConfig: () => ({
      endFrames: silenceFramesForMs(settingsStore.get().endpointDelayMs),
      resumptionMergeMs: settingsStore.get().resumptionMergeMs,
    }),
    publisher: eventPublisher,
    tracer: perfTracer,
    dumper: utteranceDumper,
    onExtendSession: (sessionId, generation) => {
      sessionRuntime?.extend({ sessionId, generation })
    },
    onDeclineSession: (sessionId, generation) => {
      sessionRuntime?.decline({ sessionId, generation })
    },
  })
  // Model-invoked Session Reset (#99): the pipeline consumes the resetting
  // run at the new_session boundary; this seam ends the live Session —
  // history end record, Browser State, Subagents, Feed cleanup — before the
  // command runner admits the original command as fresh work.
  const pipeline = createAssistantPipeline({
    controller,
    env: currentEnv(),
    getEnv: currentEnv,
    // The tool-round ceiling (settings slider) applies to the next command.
    getMaxToolRounds: () => settingsStore.get().maxToolRounds,
    tts: speakingGate.tts,
    subagentTools: subagentRuntime.tools,
    subagentControl: subagentRuntime,
    // Panel voice tools (#64): the same overlay seam the dashboard buttons
    // and the shortcut drive.
    panel: feedPanel,
    // Settings voice tool (#67): the same store the settings page drives,
    // so a voice change persists and broadcasts exactly like a typed one.
    settings: settingsStore,
    // App voice tool (#67): quit/reload behind the confirmation gate, acks
    // spoken through the same speaking gate as every other line.
    app: {
      quit: () => {
        app.quit()
        return 'quitting'
      },
      reload: () => {
        if (win.isDestroyed()) return 'unavailable'
        win.webContents.reload()
        return 'reloading'
      },
      speakAck: async (text, turnId) => {
        // A dead speaker never blocks a confirmed action.
        await speakingGate.tts.speak(text, turnId).catch(() => {})
      },
    },
    // Learned Terms (ADR 0022): the run's transcript feeds the LRU order;
    // done runs' Mishear proposals land in the ledger at the commit tail.
    learnedTerms: {
      applyProposals: (proposals) => learnedTermsStore.applyProposals(proposals),
      observeTranscript: (text) => learnedTermsStore.observeTranscript(text),
    },
    // The prompt's learned-vocabulary block reads the live ledger, so the
    // model never re-proposes a term it can already hear.
    getLearnedTerms: () => learnedTermsStore.list(),
    onLlmUsage: (record) => usageStore.record(record.role, record.model, record.usage),
    tracer: perfTracer,
    browserSubspans,
    // Progress detail (#43): mid-await signals ride the same channel; the
    // history projection maps them to no entry, so recording is unchanged.
    emitDetail: (event) => eventPublisher.publish({ source: 'detail', event }),
  })
  sessionRuntime = createSessionRuntime({
    clock: systemClock,
    identities: createSessionIdentitySource(),
    continuityModel: () => currentEnv().BINGBONG_LLM_SCRIPT ? 'scripted' : currentEnv().BINGBONG_ORCHESTRATOR_MODEL ?? 'unconfigured',
    continuityBudgets: parseSessionContinuityBudgets(currentEnv().BINGBONG_CONTINUITY_BUDGETS),
    sessionWindowMs: launchConfig.sessionWindowMs,
    warningLeadMs: launchConfig.sessionWarningMs,
    onExpiring: (expiring) => {
      void speakingGate.tts.speak(
        'Your session is about to expire. Say yes to keep it, or no to end it now.',
      ).catch(() => {})
      eventPublisher.publish({
        source: 'lifecycle',
        event: {
          type: 'session_expiring',
          expiresAt: expiring.expiresAt,
          at: expiring.at,
          sessionId: expiring.sessionId,
          sessionGeneration: expiring.generation,
        },
      })
    },
    onExtended: (extended) => {
      eventPublisher.publish({
        source: 'lifecycle',
        event: {
          type: 'session_extended',
          expiresAt: extended.expiresAt,
          at: extended.at,
          sessionId: extended.sessionId,
          sessionGeneration: extended.generation,
        },
      })
    },
    onEnded: (ended) => {
      lastEndedSession = ended
      historyStore.finishSession(ended.sessionId, ended.reason, ended.endedAt)
      // Every end reason discards Browser State through the same reusable
      // cleanup (#96); the runtime fires onEnded exactly once per Session.
      resetBrowserState(pane, subagentRuntime)
      eventPublisher.publish({
        source: 'lifecycle',
        event: {
          type: 'session_ended',
          reason: ended.reason,
          at: ended.endedAt,
          sessionId: ended.sessionId,
          sessionGeneration: ended.generation,
        },
      })
    },
  })
  // Renderer session re-adoption (ADR 0017): both session-bearing pages —
  // dashboard and feed panel overlay — re-adopt the live Session on any
  // finished load, and a gone render process reloads into recovery.
  attachSessionToWindow(win, sessionRuntime, { overlayContents: feedPanel.contents })
  activeSessionRuntime = sessionRuntime
  const commandRunner = createAssistantCommandRunner({
    pipeline,
    runtime: sessionRuntime,
    clock: systemClock,
    onSessionReset: () => {
      // The resetting run has fully unwound; end its Session so the
      // replacement admission mints a fresh identity (generation advances).
      sessionRuntime?.end('reset')
    },
    onSessionStarted: (admission) => {
      historyStore.startSession(admission.sessionId, admission.acceptedAt)
      lastEndedSession = null
      eventPublisher.publish({
        source: 'lifecycle',
        event: {
          type: 'session_started',
          at: admission.acceptedAt,
          sessionId: admission.sessionId,
          sessionGeneration: admission.generation,
        },
      })
    },
    createRunPublisher: (ownership) => eventPublisher.run(ownership),
    publishFeedback: (feedback) => eventPublisher.publish({ source: 'submission-feedback', feedback }),
    canPublish: () => !win.isDestroyed(),
    tracer: perfTracer,
  })
  attachAssistantToWindow(pipeline, win, commandRunner)
  win.on('close', () => sessionRuntime?.end('app_closed'))
  const detachPaneAbort = attachAssistantAbortHotkey(pipeline, pane.view.webContents)
  win.on('closed', detachPaneAbort)
  // The session store dies with its window (#73): a pending Lapse boundary
  // must never fire into the channels a closed window left behind.
  win.on('closed', () => {
    sessionRuntime?.dispose()
    if (activeSessionRuntime === sessionRuntime) activeSessionRuntime = null
  })

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
  registerSettingsIpc(settingsStore, () => resolveRoutingStatus(currentEnv()))
  registerFeedPanelIpc()
  ipcMain.handle(USAGE_IPC.getToday, () => usageStore.summary(dailySpendWarnUsd()))
  ipcMain.handle(HISTORY_IPC.recentEntries, () => historyStore.recentEntries(HISTORY_QUERY_LIMIT))
  ipcMain.handle(HISTORY_IPC.recentRuns, () => historyStore.recentRuns(50))
  ipcMain.handle(HISTORY_IPC.recentSessions, () => historyStore.recentSessions(50))
  ipcMain.handle(HISTORY_IPC.recordVoiceError, (_event, message: unknown) => {
    if (typeof message !== 'string' || message.trim() === '') return null
    const at = Date.now()
    historyRecorder.voiceError(message, at, activeSessionRuntime?.state().sessionId ?? null)
    return at
  })
  registerTtsIpc({ voicesDir: () => piperConfig.voicesDir })
  registerVoiceIpc()
  registerSessionIpc()

  // Auth-host identity rewrite (ADR 0018): before the adblocker so both own
  // webRequest listeners from the first request. Disabling the adblocker
  // clears every listener on the partition, so its hook re-asserts this.
  const identityHeaders = attachIdentityHeaders(
    session.fromPartition(BROWSER_PARTITION, { cache: true }),
    resolveAuthIdentity(currentEnv()),
  )

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
    onWebRequestCleared: () => identityHeaders.refresh(),
  })

  // Appearance (ADR 0020): resolve the tri-state Setting through
  // nativeTheme before the first window — renderers and pages read the
  // resolved prefers-color-scheme from their first paint, and the native
  // pane backgrounds repaint on every change.
  const detachAppearance = attachAppearance(settingsStore)
  app.on('will-quit', () => {
    adblock.dispose()
    detachAppearance()
    historyStore.close()
  })
  await adblock.ready()
  // Enabling the blocker re-registers its listeners; re-assert ours so the
  // ordering is deterministic regardless of enable/disable sequencing.
  identityHeaders.refresh()

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
