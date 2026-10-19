import { app, BrowserWindow, crashReporter, ipcMain, session } from 'electron'
import { join } from 'node:path'
import type { BrowserController, PageLanding, VisualGroundingController } from '../core/ports/browser'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { createAgentActivityTracker, withAgentActivity } from '../core/downloads/agentActivity'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../core/pipeline/events'
import { attachAdblock } from './browser/attachAdblock'
import { attachMeasurementAccessGuard } from './browser/attachMeasurementAccessGuard'
import { attachIdentityHeaders } from './browser/attachIdentityHeaders'
import { createBrowserPane, BROWSER_PARTITION } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { registerLastPageIpc } from './browser/attachLastPage'
import { createLastPageStore } from './browser/lastPageStore'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { holdBrowserCustody } from '../core/browser/unsettledAction'
import { createAuthPopupDirector } from './browser/authPopupDirector'
import { resolveAuthIdentity } from '../core/browser/authIdentity'
import { attachDownloadRouter } from './browser/attachDownloadRouter'
import { runCliHarness } from './cli/runCliHarness'
import { saveScreenshotFile } from './run/saveScreenshotFile'
import { attachCommandRunnerToWindow, registerCommandRunnerIpc } from './run/attachCommandRunner'
import { createCommandRunner, type CommandRunner } from './run/commandRunner'
import type { ActionEffect, ActionEffects } from './browser/createCdpBrowserController'
import { createDecisionLogSink } from './run/decisionLogSink'
import { createAskLogSink } from './run/askLogSink'
import { resolveDownloadsDir } from './downloadsDir'
import { resolvePreloadPath } from './preloadPath'
import { holdFullscreenFit } from './kiosk/holdFullscreenFit'
import { createSettingsStore } from './settings/settingsStore'
import { registerSettingsIpc } from './settings/attachSettings'
import { settingsToEnv } from '../core/settings/settings'
import { layerEnv } from '../core/settings/dotEnv'
import { loadEnvFile } from './envFile'
import { systemClock } from '../core/ports/clock'
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
import { createBiasUnion } from '../core/voice/biasUnion'
import { pageTermsOf } from '../core/voice/pageTerms'
import { registerLearnedTermsIpc } from './voice/attachLearnedTerms'
import { attachVoiceToWindow, registerVoiceIpc } from './voice/attachVoice'
import type { VoiceSession } from '../core/voice/voiceSession'
import { attachFeedPanelOverlayToWindow, registerFeedPanelIpc } from './panel/createFeedPanelOverlay'
import { defaultFeedPanelWidth } from '../core/panel/feedPanelState'
import { audioDumpEnabled, createUtteranceDumper } from '../core/voice/utteranceDump'
import { silenceFramesForMs } from '../core/voice/vadEndpointing'
import { fsUtteranceDumpWriter } from './voice/utteranceDumpWriter'
import { resolveWakeConfig } from './wake/wakeConfig'
import { createMainWake } from './wake/createMainWake'
import { createChimeWav } from '../core/tts/chime'
import { createAlarmWav } from '../core/timer/alarm'
import { createTimer } from '../core/timer/timer'
import { registerTimerIpc } from './timer/attachTimer'
import { attachPlayer } from './music/attachPlayer'
import { attachNowPlayingToWindow, registerNowPlayingIpc } from './music/nowPlayingIpc'
import { YOUTUBE_FIXTURE_ENV, routeYouTubeToFixture } from './music/youtubeFixture'
import { createDucking } from '../core/music/ducking'
import { createRememberedSongsStore } from './music/rememberedSongsStore'
import { registerUsageIpc } from './usage/attachUsage'
import { registerCalendarIpc } from './calendar/attachCalendar'
import { attachTimerAlarm } from './timer/timerAlarm'
import { attachIdleShortcut } from './idleShortcut'
import { attachIdleTyping } from './idleTyping'
import { IDLE_IPC } from '../core/idle/ipcChannels'
import { createAplayPlayer } from './tts/createAplayPlayer'
import { KIOSK_FLAG, resolveLaunchConfig } from '../core/app/launchConfig'
import { attachGpuStability, gpuCrashRecordPath } from './attachGpuStability'
import { attachAppearance } from './attachAppearance'
import { VOICE_IPC } from '../core/voice/ipcChannels'
import { createWindowEventPublisher } from './session/windowEventPublisher'
import { createDecisionModelSource } from './decision/createDecisionModel'

// kachow: the browser, the interaction surface the agent drives (the
// numbered-ref snapshot over CDP), the dashboard and the local voice
// pipeline — and nothing that generates text. The one model this branch
// knows is Jev, the Decision Model (`decisionModel()` below), asked one
// Choice-triple per Command the Local Match cannot settle (#324, ADR 0076).

// Appliance mode (T11): --kiosk goes fullscreen; the idle timeout reaches the
// renderer through the preload's launch-config snapshot.
const launchConfig = resolveLaunchConfig(process.argv, process.env)

// e2e harness seam: isolate the profile (cookies, cache, singleton lock) per run.
if (process.env.BINGBONG_USER_DATA_DIR) {
  app.setPath('userData', process.env.BINGBONG_USER_DATA_DIR)
}

// GPU crash-loop recovery: a crash-looping GPU process ends in a
// browser-process FATAL ("GPU process isn't usable. Goodbye.") that takes
// the whole app with it, with no close handler left running. Boot with the
// GPU disabled when asked (BINGBONG_DISABLE_GPU=1 / --disable-gpu) or when
// the previous run's persisted deaths say it looped; relaunch with the
// switch when a loop shows up live. Must precede app ready like every
// appendSwitch.
attachGpuStability({
  app,
  argv: process.argv,
  env: process.env,
  recordPath: gpuCrashRecordPath(app.getPath('userData')),
  now: systemClock.now,
})

// Middle-click autoscroll (ADR 0020, ADR 0021): Chromium ships autoscroll
// off by default on Linux — one blink feature switch turns it on for every
// webContents. Must precede app ready.
app.commandLine.appendSwitch('enable-blink-features', 'MiddleClickAutoscroll')

// Crash evidence (ADR 0017): renderer death leaves a dump instead of
// vanishing silently; reports stay local — nothing uploads anywhere.
crashReporter.start({ uploadToServer: false })

// Terminal harness for browser control (issue #4): a REPL over the same CDP
// controller the runner uses, so browser actions are provable without the
// dashboard's UI.
const CLI_HARNESS_FLAG = '--browser-cli'
const runningCliHarness = process.argv.includes(CLI_HARNESS_FLAG) || process.env.BINGBONG_CLI === '1'

// Dashboard-editable settings (mic, wake word, voice, zoom, …) live beside
// the profile.
const settingsStore = createSettingsStore(join(app.getPath('userData'), 'settings.json'))

// The `.env` next to the app (#76): read once at boot and layered under
// process.env, completing the .env < process.env < settings precedence that
// currentEnv() resolves. Boot-scoped launch flags (kiosk, idle timeout) stay
// argv/process-env — the renderer's preload reads its own process env and
// must never disagree with main's.
const envFileValues = loadEnvFile(process.env, app.getAppPath())

// Always-on perf logging (#27): one JSONL span per finished stage under the
// profile's logs dir — zero configuration, no timers; rolling and the 7-day
// purge ride startup and writes. The decision log (#324) sits beside it:
// one record per Command and its Misfire signals, `pnpm perf:report` reads both.
// Each Jev call's whole ask goes to the asks sidecar the records name (#338).
const logsDir = join(app.getPath('userData'), 'logs')
const perfTracer = createPerfTracer({ sink: createJsonlPerfSink(logsDir) })
const decisionLog = createDecisionLogSink(logsDir)
const askLog = createAskLogSink(logsDir)

// Learned Terms ledger (ADR 0022): the Bias Lexicon's runtime-grown half —
// one app-global lexicon.json beside the settings file. The settings page
// is its human surface. Fails closed to seed-only on corruption.
const learnedTermsStore = createLearnedTermsStore(join(app.getPath('userData'), 'lexicon.json'), seedLexiconSet())
// Remembered Songs (#345): the words of a `play` whose pick stayed, against its video — songs.json beside it.
const rememberedSongs = createRememberedSongsStore(join(app.getPath('userData'), 'songs.json'))
// The Last Page (CONTEXT.md): the page the pane last showed, kept across
// restarts for the Idle Screen and `resume`.
const lastPageStore = createLastPageStore(join(app.getPath('userData'), 'last-page.json'))
registerLearnedTermsIpc(learnedTermsStore)

// Verbose browser sub-spans (#32), opt-in behind the established env-flag
// pattern. Flag off — the channel stays wired but writes nothing.
const browserSubspans = createBrowserSubspans({ tracer: perfTracer, enabled: browserSubspansEnabled(currentEnv()) })

// Opt-in utterance audio dumps (#34): BINGBONG_AUDIO_DUMP=1 writes each
// detected utterance under <userData>/audio-dumps as a 16 kHz mono WAV —
// exactly the artifact shape the offline STT benchmark replays.
const utteranceDumper = createUtteranceDumper({
  dir: join(app.getPath('userData'), 'audio-dumps'),
  writer: fsUtteranceDumpWriter,
  enabled: audioDumpEnabled(currentEnv()),
})

// Piper TTS: binary, voices dir, and base voice come from env (defaults
// suffice for a standard install); the settings page's voice wins per line.
const piperConfig = resolvePiperConfig(process.env, app.getPath('userData'))

// Ears (T9): Silero VAD + streaming Moonshine, shared by every window so
// the models load once. Scripted doubles ride the same seam for e2e. The
// STT tier is the settings snapshot at startup (#63).
const voiceConfig = resolveVoiceConfig(process.env, app.getPath('userData'), settingsStore.get().sttModel)

// Wake word: "bing bong" plus the "abort" interrupt head via the
// openWakeWord ONNX stack; the Python sidecar is the config-only fallback
// (BINGBONG_WAKE_ENGINE=python, wake head only).
const wakeConfig = resolveWakeConfig(process.env, app.getPath('userData'), app.getAppPath())
const wakeDetector = createMainWake(wakeConfig)
const chimeWav = createChimeWav()
const chimePlayer = createAplayPlayer()
// The Timer (CONTEXT.md): one app-global countdown, shown on the Idle
// Screen; its alarm plays through its own aplay, so the chime and speech
// never cut it.
const timer = createTimer({ clock: systemClock })
attachTimerAlarm(timer, createAplayPlayer(), createAlarmWav())

// The Decision Model (Jev, ADR 0068, pinned to jev-1.14.0 by ADR 0076):
// resolved from the live env on each read, kept while its config is
// unchanged. Null when no key is configured — the runner then fires the
// Local Match's best guess for what the Local Match cannot settle.
export const decisionModel = createDecisionModelSource(currentEnv)

function currentEnv(): Record<string, string | undefined> {
  return { ...layerEnv(envFileValues, process.env), ...settingsToEnv(settingsStore.get()) }
}

let cliHarnessStarted = false

// The harness drives the window's Command runner (#324, ADR 0076): a typed
// CLI line takes the same road as the Prompt Bar, and the harness prints
// what the runner publishes for its turn.
function startCliHarness(runner: CommandRunner, subscribe: (listener: (event: PipelineEvent) => void) => () => void): void {
  if (cliHarnessStarted) return
  cliHarnessStarted = true

  void runCliHarness({
    run: (line, options) => runner.run(line, options),
    subscribe,
    input: process.stdin,
    output: process.stdout,
    exit: () => app.quit(),
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

  // Fullscreen must sit where windowed does (#331, see fullscreenFit).
  if (launchConfig.kiosk) holdFullscreenFit(win)

  // A pane per window; the persistent `persist:browse` session partition is what
  // keeps logins alive across windows and restarts. One CDP controller is
  // shared by everything that drives the pane (CLI harness, runner) —
  // webContents.debugger allows a single attachment. The activity tracker
  // marks its download-capable verbs, so only agent-initiated downloads get
  // routed; manual ones keep the OS save dialog.
  const pane = createBrowserPane({ getZoomPercent: () => settingsStore.get().webZoomPercent })
  // The feed panel overlay (#45) stacks above the browser pane — attached
  // above it before the first frame.
  const feedPanel = attachFeedPanelOverlayToWindow(win, {
    preloadDir: join(__dirname, '../preload'),
    defaultWidth: defaultFeedPanelWidth(),
  })
  // The panel shortcut also fires while the pane owns focus.
  feedPanel.registerShortcut(pane.view.webContents)
  // The idle shortcut (Ctrl/Cmd+Shift+L) shows the Idle Screen now, from whichever surface owns focus.
  const enterIdle = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IDLE_IPC.enter)
  }
  for (const contents of [win.webContents, pane.view.webContents, feedPanel.contents()]) {
    if (contents !== null) win.on('closed', attachIdleShortcut(contents, enterIdle))
  }
  // Typing on the Idle Screen goes to the Prompt Bar, from whichever surface owns focus.
  let idleShown = false
  const onIdleShown = (event: Electron.IpcMainEvent, shown: unknown): void => {
    if (event.sender === win.webContents) idleShown = shown === true
  }
  ipcMain.on(IDLE_IPC.shown, onIdleShown)
  win.on('closed', () => ipcMain.removeListener(IDLE_IPC.shown, onIdleShown))
  const typeFromIdle = (text: string): void => {
    // The first key wakes the dashboard; the keys after it reach the overlay
    // directly, so the screen counts as down from here.
    idleShown = false
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IDLE_IPC.wake)
    feedPanel.typeIntoPrompt(text)
  }
  for (const contents of [win.webContents, pane.view.webContents]) {
    win.on('closed', attachIdleTyping(contents, { shown: () => idleShown, onType: typeFromIdle }))
  }

  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
  const eventPublisher = createWindowEventPublisher({
    sendPipelineEvent: (event) => sendToRenderer(PIPELINE_IPC.event, event),
    sendVoiceState: (state) => sendToRenderer(VOICE_IPC.stateChanged, state),
    sendVoiceHeard: (heard) => sendToRenderer(VOICE_IPC.heard, heard),
    sendVoiceError: (error) => sendToRenderer(VOICE_IPC.error, error),
    sendBrowserState: (state) => sendToRenderer(BROWSER_IPC.stateChanged, state),
    sendVoicePartial: (partial) => sendToRenderer(VOICE_IPC.partial, partial),
    overlayPipelineEvent: (event) => feedPanel.handlePipelineEvent(event),
    overlayVoiceHeard: (heard) => feedPanel.forwardHeard(heard),
    overlayVoiceError: (error) => feedPanel.forwardVoiceError(error),
  })
  attachBrowserPaneToWindow(pane, win, eventPublisher)
  // Every page the pane shows moves the Last Page.
  const unsubscribeLastPage = pane.onState((state) => lastPageStore.record(state))
  win.on('closed', unsubscribeLastPage)
  feedPanel.bringToTop()
  const agentActivity = createAgentActivityTracker()
  // Auth popups (ADR 0018): while a sign-in popup window is open, browser
  // actions route to it. The CLI harness and the runner share this routed
  // controller.
  const authPopups = createAuthPopupDirector(pane, {
    createController: (webContents) => createPaneBrowserController({ view: { webContents } }),
  })
  // The shared browsing resource, in custody (#205, ADR 0038): everything
  // that reaches the pane reaches it through the same handle — the runner,
  // the CLI harness — so an action abandoned by Stop cannot be worked
  // around by a caller that kept its own reference.
  // An action's first observable effect (#324): the controller reports it,
  // the runner hears it and closes the Reaction span on it.
  const effectListeners = new Set<(effect: ActionEffect) => void>()
  // How each navigation landed (#328): the runner keeps it on the hop's decision record.
  const landingListeners = new Set<(landing: PageLanding) => void>()
  const effects: ActionEffects = {
    observed: (effect) => {
      for (const listener of [...effectListeners]) listener(effect)
    },
    landed: (landing) => {
      for (const listener of [...landingListeners]) listener(landing)
    },
  }
  const paneCustody = holdBrowserCustody(
    withAgentActivity(authPopups.route(createPaneBrowserController(pane, { subspans: browserSubspans, effects })), agentActivity),
  )
  const controller: BrowserController & VisualGroundingController = paneCustody.controller
  // The Player (#343): YouTube in the pane is the player, the queue and the verbs live here.
  const youtubeFixture = process.env[YOUTUBE_FIXTURE_ENV]
  if (youtubeFixture) routeYouTubeToFixture(pane.session, youtubeFixture)
  // A song that stayed (#345) is remembered in songs.json beside lexicon.json, and its title learned.
  const music = attachPlayer(controller, pane.session, {
    songs: rememberedSongs,
    learn: (term) => {
      learnedTermsStore.admit(term)
    },
  })
  win.on('closed', music.stop)
  // Now Playing (#344): the Idle Screen's card follows the Player.
  win.on('closed', attachNowPlayingToWindow(win, music.player))

  const downloadsDir = resolveDownloadsDir(process.env, app.getPath('downloads'))
  // Spoken output (T8), wrapped in a speaking gate (T9): download
  // announcements and the runner's Page Reads and failure lines (#327)
  // share it. Piper starts now, so the first line pays no model load.
  const speakingGate = createSpeakingGate(
    createMainTts({
      config: piperConfig,
      pane: pane.view.webContents,
      getVoiceId: () => settingsStore.get().ttsVoice.trim() || piperConfig.voiceId,
      tracer: perfTracer,
      prefetch: true,
    }),
  )
  // Ducking (#344): the music drops under the ear, a spoken line and a ringing Timer.
  const ducking = createDucking((on) => void music.player.duck(on))
  win.on('closed', speakingGate.onSpeakingChange((speaking) => ducking.hold('speech', speaking)))
  win.on('closed', timer.onChange((state) => ducking.hold('ring', state.status === 'ringing')))
  attachDownloadRouter(pane.session, {
    dir: downloadsDir,
    tts: speakingGate.tts,
    isAgentActive: agentActivity.isActive,
    emit: (event) => eventPublisher.publish({ source: 'download', event }),
  })

  // The command seam (#324, ADR 0076): a typed or spoken line becomes one
  // Command — the Local Match, else one Jev call, else the best guess — and
  // acts at once. The CLI harness and the Prompt Bar take the same road.
  // The CLI harness hears the runner's events beside the window: it prints
  // what the Command's turn published.
  const commandListeners = new Set<(event: PipelineEvent) => void>()
  const runner = createCommandRunner({
    browser: controller,
    decisionModel,
    publish: (event) => {
      eventPublisher.publish({ source: 'run', event })
      for (const listener of [...commandListeners]) listener(event)
    },
    now: systemClock.now,
    tracer: perfTracer,
    decisionLog,
    askLog,
    onEffect: (listener) => {
      effectListeners.add(listener)
      return () => effectListeners.delete(listener)
    },
    onLanding: (listener) => {
      landingListeners.add(listener)
      return () => landingListeners.delete(listener)
    },
    // `read` speaks the page and a failure its one line (#327).
    speech: speakingGate.tts,
    // `resume` reopens the Last Page when a restart lost it.
    lastPage: () => lastPageStore.get(),
    // `timer` sets and cancels it; `stop` silences it ringing.
    timer,
    // `play` and the music verbs drive it; `stop` with nothing in flight pauses it.
    player: music.player,
    screenshotDir: () => downloadsDir,
    saveScreenshot: saveScreenshotFile,
    // The Learned Terms (ADR 0077): read for the Name Match, grown by it.
    terms: {
      learned: () => learnedTermsStore.list(),
      admit: (term) => {
        learnedTermsStore.admit(term)
      },
      propose: (term) => learnedTermsStore.propose(term),
      observe: (text) => learnedTermsStore.observeTranscript(text),
    },
  })
  // Escape aborts the Command and closes a Hot Listen (#326), each at once;
  // the voice session is attached below, so it is read when the key comes.
  let voiceSession: VoiceSession | null = null
  const escape = (): boolean => {
    const aborted = runner.abort()
    const closed = voiceSession?.closeHotListen() ?? false
    return aborted || closed
  }
  attachCommandRunnerToWindow(runner, win, escape)
  // Escape aborts from the pane too, where React never sees the key.
  const onPaneInput = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type === 'keyDown' && input.key === 'Escape' && escape()) event.preventDefault()
  }
  pane.view.webContents.on('before-input-event', onPaneInput)
  win.on('closed', () => pane.view.webContents.removeListener('before-input-event', onPaneInput))

  if (runningCliHarness) {
    startCliHarness(runner, (listener) => {
      commandListeners.add(listener)
      return () => commandListeners.delete(listener)
    })
  }

  // The decode's bias (ADR 0077): the Bias Lexicon, and the Page Terms of
  // the page collected at speech start, set for the one Utterance over it.
  const biasUnion = createBiasUnion({ lexicon: () => learnedTermsStore.biasPhrases() })
  const voice = await createMainVoice(voiceConfig, () => biasUnion.phrases())
  voiceSession = attachVoiceToWindow(win, {
    onPagePrepared: (snapshot) =>
      biasUnion.setPageTerms(snapshot === null ? [] : pageTermsOf({ title: snapshot.title, labels: snapshot.refs.map((ref) => ref.label), text: snapshot.viewportText })),
    vad: voice.vad,
    transcriber: voice.transcriber,
    tts: speakingGate.tts,
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
    // The Hot Listen (#326): its closing silence, live from its Setting,
    // and the speaking gate — the mic takes no Utterance while a line plays.
    getHotListenSilenceMs: () => settingsStore.get().hotListenSilenceMs,
    speaking: speakingGate,
    ducking,
    publisher: eventPublisher,
    tracer: perfTracer,
    dumper: utteranceDumper,
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
  registerLastPageIpc(lastPageStore)
  registerTimerIpc(timer)
  registerNowPlayingIpc()
  // The Calendar (CONTEXT.md): no provider is wired yet, so it shows the
  // month alone; a Google or Outlook source joins this list.
  registerCalendarIpc([])
  registerCommandRunnerIpc()
  registerSettingsIpc(settingsStore)
  registerUsageIpc(() => settingsStore.get().usageDashboard.url)
  registerFeedPanelIpc()
  registerTtsIpc({ voicesDir: () => piperConfig.voicesDir })
  registerVoiceIpc()

  // Auth-host identity rewrite (ADR 0018): before the adblocker so both own
  // webRequest listeners from the first request. Disabling the adblocker
  // clears every listener on the partition, so its hook re-asserts this.
  const identityHeaders = attachIdentityHeaders(
    session.fromPartition(BROWSER_PARTITION, { cache: true }),
    resolveAuthIdentity(currentEnv()),
  )

  // Embedder-level adblocker (issue #21): enabled before the first window so
  // the pane is covered from its first navigation. The await is a
  // deliberate tradeoff — a cold cache delays the first window by one list
  // download (bounded fetches; failures degrade to no blocking).
  const adblock = attachAdblock({
    session: session.fromPartition(BROWSER_PARTITION, { cache: true }),
    settingsStore,
    userDataDir: app.getPath('userData'),
    env: process.env,
    onWebRequestCleared: () => identityHeaders.refresh(),
  })

  // The measurement access guard (#224): file: loads refused on the
  // browse partition, only when a measured capture asked for it.
  const accessGuard = attachMeasurementAccessGuard({
    session: session.fromPartition(BROWSER_PARTITION, { cache: true }),
    env: process.env,
  })

  // Appearance (ADR 0020): resolve the tri-state Setting through
  // nativeTheme before the first window.
  const detachAppearance = attachAppearance(settingsStore)
  app.on('will-quit', () => {
    adblock.dispose()
    accessGuard.dispose()
    detachAppearance()
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
