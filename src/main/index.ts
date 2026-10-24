import { app, BrowserWindow, crashReporter, ipcMain, Menu, session } from 'electron'
import { join } from 'node:path'
import type { BrowserController, PageLanding, VisualGroundingController } from '../core/ports/browser'
import { BROWSER_IPC } from '../core/browser/ipcChannels'
import { createTaskActivityTracker, routesDownload } from '../core/downloads/taskActivity'
import { createSiteQuestionDesk } from '../core/browser/siteQuestionDesk'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import type { PipelineEvent } from '../core/pipeline/events'
import { attachAdblock } from './browser/attachAdblock'
import { attachMeasurementAccessGuard } from './browser/attachMeasurementAccessGuard'
import { attachIdentityHeaders } from './browser/attachIdentityHeaders'
import { createBrowserPane, BROWSER_PARTITION } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { registerLastPageIpc } from './browser/attachLastPage'
import { createLastPageStore } from './browser/lastPageStore'
import { createKnownAddressStore } from './browser/knownAddressStore'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { holdBrowserCustody } from '../core/browser/unsettledAction'
import { createAuthPopupDirector } from './browser/authPopupDirector'
import { resolveAuthIdentity } from '../core/browser/authIdentity'
import { attachDownloadRouter } from './browser/attachDownloadRouter'
import { runCliHarness } from './cli/runCliHarness'
import { saveScreenshotFile } from './run/saveScreenshotFile'
import { attachAbortHotkey, attachCommandRunnerToWindow, registerCommandRunnerIpc } from './run/attachCommandRunner'
import { createCommandRunner, type CommandRunner } from './run/commandRunner'
import type { ActionEffect, ActionEffects } from './browser/createCdpBrowserController'
import { createDecisionLogSink } from './run/decisionLogSink'
import { createFlagKeeper } from './logs/flagKeeper'
import { createAskLogSink } from './run/askLogSink'
import { createFaultLogSink } from './logs/faultLogSink'
import { createLogBucketUploader } from './logs/logBucketUploader'
import { createS3Client } from './logs/s3Client'
import { logBucketStartup } from '../core/logs/logBucket'
import { reportFault, setFaultSink } from '../core/trace/fault'
import { resolveDownloadsDir } from './downloadsDir'
import { resolvePreloadPath } from './preloadPath'
import { holdFullscreenFit } from './kiosk/holdFullscreenFit'
import { createSettingsStore } from './settings/settingsStore'
import { registerSettingsIpc } from './settings/attachSettings'
import { registerEnvFileIpc } from './settings/attachEnvFile'
import { settingsToEnv } from '../core/settings/settings'
import { layerEnv } from '../core/settings/dotEnv'
import { loadEnvFile, resolveEnvFilePath, type EnvFileHome } from './envFile'
import { resolveAppDirs } from './appDirs'
import { checkThisHost } from './hostChecks'
import { registerHostChecksIpc } from './settings/attachHostChecks'
import { attachNightDim, type NightDimGlue } from './nightDim/attachNightDim'
import { attachUpdater, exitsAfterInstall, type Updater } from './update/attachUpdater'
import { ensurePiper, fsPiperInstallDeps } from './tts/piperInstall'
import { createRetriable } from './moonshine/retriable'
import { systemClock } from '../core/ports/clock'
import { resolvePiperConfig } from './tts/piperConfig'
import { createMainTts } from './tts/createMainTts'
import { registerTtsIpc } from './tts/attachTts'
import { attachAppControl } from './app/attachAppControl'
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
import { attachWeighInViewToWindow } from './scale/attachWeighInView'
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
import { registerWeatherIpc } from './weather/attachWeather'
import { attachPlayer } from './music/attachPlayer'
import { attachNowPlayingToWindow, registerNowPlayingIpc } from './music/nowPlayingIpc'
import { YOUTUBE_FIXTURE_ENV, routeYouTubeToFixture } from './music/youtubeFixture'
import { createDucking } from '../core/music/ducking'
import { createRememberedSongsStore } from './music/rememberedSongsStore'
import { registerUsageIpc } from './usage/attachUsage'
import { registerCalendarIpc } from './calendar/attachCalendar'
import { CALENDAR_FIXTURE_ENV, createStandInCalendarSource } from './calendar/standInCalendar'
import { registerNewsIpc } from './news/attachNews'
import { attachScaleListener, type ScaleListener } from './scale/attachScale'
import { createBluezScaleTransport } from './scale/bluezScale'
import { createStandInScaleTransport, SCALE_FIXTURE_ENV } from './scale/standInScale'
import { createWeighInStore } from './scale/weighInStore'
import { attachTimerAlarm } from './timer/timerAlarm'
import { appMenuTemplate, attachAppShortcuts, type AppShortcutActions } from './appShortcuts'
import { attachIdleShortcut } from './idleShortcut'
import { attachIdleTyping } from './idleTyping'
import { IDLE_IPC, type IdleShown } from '../core/idle/ipcChannels'
import { createAplayPlayer } from './tts/createAplayPlayer'
import { KIOSK_ENV, KIOSK_FLAG, resolveLaunchConfig } from '../core/app/launchConfig'
import { muteOffScreen } from './muteOffScreen'
import { attachGpuStability, gpuCrashRecordPath } from './attachGpuStability'
import { attachAppearance } from './attachAppearance'
import { VOICE_IPC } from '../core/voice/ipcChannels'
import { createWindowEventPublisher } from './session/windowEventPublisher'
import { createDecisionModelSource } from './decision/createDecisionModel'
import { createConsentChooser } from '../core/browser/consentChooser'
import { DEFAULT_DECISION_THRESHOLDS } from '../core/ports/decisionModel'

// kachow: the browser, the interaction surface the agent drives (the
// numbered-ref snapshot over CDP), the dashboard and the local voice
// pipeline — and nothing that generates text. The one model this branch
// knows is Jev, the Decision Model (`decisionModel()` below), asked one
// Choice-triple per Command the Local Match cannot settle (#324, ADR 0076).

// The updater runs a freshly installed AppImage once with this set and
// waits for it to exit (#419): it is not a launch.
if (exitsAfterInstall(process.env)) process.exit(0)

// Appliance mode (T11): --kiosk goes fullscreen; the idle timeout reaches the
// renderer through the preload's launch-config snapshot.
const launchConfig = resolveLaunchConfig(process.argv, process.env)
// The updater starts the new AppImage with no arguments but this process's
// env (#419), so a hand-run `--kiosk` is carried there to stay kiosk after an update.
if (launchConfig.kiosk) process.env[KIOSK_ENV] = '1'

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

// A test or an agent under xvfb-run plays nothing through the speakers.
muteOffScreen(app, process.env)

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

// The `.env` (#76): next to the app in a checkout, in the profile in the
// packaged app, whose own path is read-only (#419). Read once at boot and
// layered under process.env, completing the .env < process.env < settings
// precedence that currentEnv() resolves. Boot-scoped launch flags (kiosk, idle timeout) stay
// argv/process-env — the renderer's preload reads its own process env and
// must never disagree with main's.
// The Settings page's Environment section rewrites the file and hands the
// new values back here, so what currentEnv() reads live follows at once.
const envFileHome: EnvFileHome = { isPackaged: app.isPackaged, appPath: app.getAppPath(), userDataDir: app.getPath('userData') }
let envFileValues = loadEnvFile(process.env, envFileHome)
// What the boot-scoped engines read (#419): the `.env` under the process env,
// so a Piper, voice or wake line in the file takes effect at the next start.
const bootEnv = layerEnv(envFileValues, process.env)
// The models and the sidecar script that ship with the app (ADR 0090).
const appDirs = resolveAppDirs({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath })

// Always-on perf logging (#27): one JSONL span per finished stage under the
// profile's logs dir — zero configuration, no timers; rolling and the 7-day
// purge ride startup and writes. The decision log (#324) sits beside it:
// one record per Command and its Misfire signals, `pnpm perf:report` reads both.
// Each Jev call's whole ask goes to the asks sidecar the records name (#338).
// Every failure the app swallows through `reportFault` goes to the fault log (#397).
const logsDir = join(app.getPath('userData'), 'logs')
setFaultSink(createFaultLogSink(logsDir))
const perfTracer = createPerfTracer({ sink: createJsonlPerfSink(logsDir) })
const decisionLog = createDecisionLogSink(logsDir)
const askLog = createAskLogSink(logsDir)
// A Flag (#421) keeps its Task's records and the pane's shot under logs/flags/, past the purge.
const flagKeeper = createFlagKeeper(logsDir)

// Learned Terms ledger (ADR 0022): the Bias Lexicon's runtime-grown half —
// one app-global lexicon.json beside the settings file. The settings page
// is its human surface. Fails closed to seed-only on corruption.
const learnedTermsStore = createLearnedTermsStore(join(app.getPath('userData'), 'lexicon.json'), seedLexiconSet())
// Remembered Songs (#345): the words of a `play` whose pick stayed, against its video — songs.json beside it.
const rememberedSongs = createRememberedSongsStore(join(app.getPath('userData'), 'songs.json'))
// The Last Page (CONTEXT.md): the page the pane last showed, kept across
// restarts for the Idle Screen and `resume`.
const lastPageStore = createLastPageStore(join(app.getPath('userData'), 'last-page.json'))
// The Known Addresses (ADR 0089): the hosts the pane has landed on, which a bare `open <word>` opens without an ask.
const knownAddresses = createKnownAddressStore(join(app.getPath('userData'), 'known-addresses.json'))
registerLearnedTermsIpc(learnedTermsStore)
// The Scale Listener (CONTEXT.md): started once the app is ready and kept
// for its life; every window's dashboard and overlay hear it.
let scaleListener: ScaleListener | null = null

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
const piperConfig = resolvePiperConfig(bootEnv, app.getPath('userData'))
// Piper and its voice download on first launch (#419): started now, so the
// first reply finds them; a failure is retried by the next spoken line.
const piperReady = createRetriable(() => ensurePiper(piperConfig.install, fsPiperInstallDeps))
void piperReady().catch((error: unknown) => reportFault('tts.piperInstall', error))

// The host checks (#419): what the machine must provide and the app cannot
// ship, looked at once — each one missing is a line in the fault log and on
// the Settings page.
const hostFindings = checkThisHost(process.env, piperConfig.playerBin)
for (const finding of hostFindings) reportFault(`app.hostChecks.${finding.check}`, finding.message)

// Ears (T9): Silero VAD + streaming Moonshine, shared by every window so
// the models load once. Scripted doubles ride the same seam for e2e. The
// STT tier is the settings snapshot at startup (#63).
const voiceConfig = resolveVoiceConfig(bootEnv, { userDataDir: app.getPath('userData'), bundledModelsDir: appDirs.bundledModelsDir }, settingsStore.get().sttEngine)

// Wake word: "bing bong" plus the "abort" interrupt head via the
// openWakeWord ONNX stack; the Python sidecar is the config-only fallback
// (BINGBONG_WAKE_ENGINE=python, wake head only).
const wakeConfig = resolveWakeConfig(bootEnv, appDirs)
const wakeDetector = createMainWake(wakeConfig)
const chimeWav = createChimeWav()
// The chime and the alarm play through the same player as speech, so a muted run is silent.
const chimePlayer = createAplayPlayer({ bin: piperConfig.playerBin, device: piperConfig.playerDevice })
// The Timer (CONTEXT.md): one app-global countdown, shown on the Idle
// Screen; its alarm plays through its own aplay, so the chime and speech
// never cut it.
const timer = createTimer({ clock: systemClock })
attachTimerAlarm(timer, createAplayPlayer({ bin: piperConfig.playerBin, device: piperConfig.playerDevice }), createAlarmWav())
// The weather the Idle Screen shows (#402): what the appliance knows, read
// by the Command runner for a question it answers.
const weatherFacts = registerWeatherIpc()

// The Decision Model (Jev, ADR 0068, pinned to jev-1.14.0 by ADR 0076):
// resolved from the live env on each read, kept while its config is
// unchanged. Null when no key is configured — the runner then fires the
// Local Match's best guess for what the Local Match cannot settle.
export const decisionModel = createDecisionModelSource(currentEnv)

function currentEnv(): Record<string, string | undefined> {
  return { ...layerEnv(envFileValues, process.env), ...settingsToEnv(settingsStore.get()) }
}

// What each window last said of its Idle Screen, which the updater installs under (#419, ADR 0090).
const idleWindows = new Map<number, IdleShown>()
let updater: Updater = { shownChanged: () => {} }
// Night Dim on the monitor itself (#413), told whenever any window's Idle Screen comes up or goes down.
let nightDim: NightDimGlue = { idleChanged: () => {} }

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
    // On Linux Electron frames a title-bar-less window with its own 4 px
    // resize border on three sides (_GTK_FRAME_EXTENTS 4,4,0,4), painted in
    // GTK's light ground — a white border around the dark shell. Only a
    // translucent window drops it (hasShadow does not); the dashboard paints
    // its own ground, so nothing shows through.
    transparent: true,
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
  // What the dashboard last said of the Idle Screen (#361): typing opens its Prompt, and the Feed stays shut under it.
  let idleShown: IdleShown = { up: false, open: false, prompting: false }
  const feedPanel = attachFeedPanelOverlayToWindow(win, {
    preloadDir: join(__dirname, '../preload'),
    defaultWidth: defaultFeedPanelWidth(),
    shortcutHeld: () => idleShown.up,
  })
  // The panel shortcut also fires while the pane owns focus.
  feedPanel.registerShortcut(pane.view.webContents)
  // The Weigh-in pop-up's own view over the browsing pane, above the feed overlay.
  const weighInView = attachWeighInViewToWindow(win, { preloadDir: join(__dirname, '../preload') })
  // The Weigh-ins and the Weigh-in pop-up reach every surface the pop-up shows on.
  for (const contents of [win.webContents, feedPanel.contents(), weighInView.contents()]) if (contents !== null) scaleListener?.addReceiver(contents)
  // The idle shortcut (Ctrl/Cmd+Shift+L) shows the Idle Screen now, from whichever surface owns focus.
  const enterIdle = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IDLE_IPC.enter)
  }
  for (const contents of [win.webContents, pane.view.webContents, feedPanel.contents()]) {
    if (contents !== null) win.on('closed', attachIdleShortcut(contents, enterIdle))
  }
  // Typing on the Idle Screen goes to its Prompt, from whichever surface owns focus.
  const onIdleShown = (event: Electron.IpcMainEvent, shown: unknown): void => {
    if (event.sender !== win.webContents) return
    const report = shown as Partial<IdleShown> | null | undefined
    idleShown = { up: report?.up === true, open: report?.open === true, prompting: report?.prompting === true }
    idleWindows.set(windowId, idleShown)
    updater.shownChanged()
    nightDim.idleChanged()
  }
  const windowId = win.id
  idleWindows.set(windowId, idleShown)
  ipcMain.on(IDLE_IPC.shown, onIdleShown)
  win.on('closed', () => {
    ipcMain.removeListener(IDLE_IPC.shown, onIdleShown)
    idleWindows.delete(windowId)
  })
  const typeFromIdle = (text: string): void => {
    // Each key goes over IPC until the dashboard says the Prompt's field is
    // focused; from then the keys reach the field directly and none is lost.
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.focus()
    win.webContents.send(IDLE_IPC.typed, text)
  }
  for (const contents of [win.webContents, pane.view.webContents]) {
    win.on('closed', attachIdleTyping(contents, { shown: () => idleShown.up && !idleShown.prompting, onType: typeFromIdle }))
  }
  // A load in the hidden pane takes focus (a `play` opening the watch page): with the Idle Prompt open, focus goes back to its field,
  // or main would go on routing keys itself and Escape, Backspace and Space would never reach it.
  const onPaneFocus = (): void => {
    if (!idleShown.up || !idleShown.open) return
    // After the pane's own focus change has run its course; taken back within it, the pane keeps it.
    setTimeout(() => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus()
    }, 0)
  }
  pane.view.webContents.on('focus', onPaneFocus)
  win.on('closed', () => {
    if (!pane.view.webContents.isDestroyed()) pane.view.webContents.removeListener('focus', onPaneFocus)
  })

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
    overlayVoiceState: (state) => feedPanel.forwardVoiceState(state),
    overlayVoicePartial: (partial) => feedPanel.forwardVoicePartial(partial),
  })
  attachBrowserPaneToWindow(pane, win, eventPublisher)
  // Every page the pane shows moves the Last Page, and its host is a Known Address.
  const unsubscribeLastPage = pane.onState((state) => {
    lastPageStore.record(state)
    knownAddresses.record(state)
  })
  win.on('closed', unsubscribeLastPage)
  feedPanel.bringToTop()
  weighInView.bringToTop()
  // Which downloads are a Task's (#423): the runner's Tasks are tracked below, and the pane's navigations each began during one.
  const taskActivity = createTaskActivityTracker()
  pane.view.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) taskActivity.navigationStarted(details.url)
  })
  // The page's own question (#423): the pane raises its confirm here, the runner says it and answers it with the next line.
  const siteQuestions = createSiteQuestionDesk()
  // Auth popups (ADR 0018): while a sign-in popup window is open, browser
  // actions route to it. The CLI harness and the runner share this routed
  // controller.
  const authPopups = createAuthPopupDirector(pane, {
    createController: (webContents) => createPaneBrowserController({ view: { webContents }, consumePermissionDenials: pane.consumePermissionDenials }, { siteQuestions }),
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
    authPopups.route(createPaneBrowserController(pane, { subspans: browserSubspans, effects, siteQuestions, chooseConsent: createConsentChooser(decisionModel, DEFAULT_DECISION_THRESHOLDS.choice, askLog) })),
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
      ready: piperReady,
    }),
  )
  // Ducking (#344): the music drops under the ear, a spoken line and a ringing Timer.
  const ducking = createDucking((on) => void music.player.duck(on))
  win.on('closed', speakingGate.onSpeakingChange((speaking) => ducking.hold('speech', speaking)))
  win.on('closed', timer.onChange((state) => ducking.hold('ring', state.status === 'ringing')))
  attachDownloadRouter(pane.session, {
    dir: downloadsDir,
    tts: speakingGate.tts,
    // The kiosk has no mouse to answer a Save dialog: every download is routed; the desktop routes a Task's.
    routes: (urls) => routesDownload({ kiosk: launchConfig.kiosk, byTask: taskActivity.isActive() || taskActivity.startedByTask(urls) }),
    emit: (event) => eventPublisher.publish({ source: 'download', event }),
  })

  // The command seam (#324, ADR 0076): a typed or spoken line becomes one
  // Command — the Local Match, else one Jev call, else the best guess — and
  // acts at once. The CLI harness and the Prompt Bar take the same road.
  // The CLI harness hears the runner's events beside the window: it prints
  // what the Command's turn published.
  const commandListeners = new Set<(event: PipelineEvent) => void>()
  // The app itself on the card (#420, ADR 0091): its panel, views and settings.
  const appControl = attachAppControl(win, { panel: feedPanel, settings: settingsStore, voicesDir: () => piperConfig.voicesDir })
  win.on('closed', appControl.detach)
  const commandRunner = createCommandRunner({
    browser: controller,
    decisionModel,
    publish: (event) => {
      eventPublisher.publish({ source: 'run', event })
      for (const listener of [...commandListeners]) listener(event)
    },
    now: systemClock.now,
    tracer: perfTracer,
    subspans: browserSubspans,
    decisionLog,
    askLog,
    flags: flagKeeper,
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
    dropLastPage: (url) => lastPageStore.drop(url),
    // `open <one word>` opens the host it names, once the pane has landed there.
    knownAddress: (word) => knownAddresses.addressOf(word),
    // The page's own question (#423): said when it opens; the next line answers it.
    siteQuestions,
    // `timer` sets and cancels it; `stop` silences it ringing.
    timer,
    // `play` and the music verbs drive it; `stop` with nothing in flight pauses it.
    player: music.player,
    // What the appliance knows (#402): a question one of them answers is said, not searched.
    facts: () => ({
      now: systemClock.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weather: weatherFacts.latest(),
      nowPlaying: music.player.nowPlaying(),
      timer: timer.state(),
    }),
    // The app's panel, views and settings (#420): each op an option on the card, a change one hop.
    app: appControl.control,
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
  // A Task under way (#423): a line run, or a partial that may fire, until it settles — a download it starts is routed.
  const runner: typeof commandRunner = {
    ...commandRunner,
    run: (text, options) => taskActivity.run(() => commandRunner.run(text, options)),
    consider: (partial) => taskActivity.run(() => commandRunner.consider(partial)),
  }
  // Escape aborts the Command and closes a Hot Listen (#326), each at once;
  // the voice session is attached below, so it is read when the key comes.
  let voiceSession: VoiceSession | null = null
  const escape = (): boolean => {
    const aborted = runner.abort()
    const closed = voiceSession?.closeHotListen() ?? false
    return aborted || closed
  }
  attachCommandRunnerToWindow(runner, win, escape)
  // Escape aborts from the pane and the feed panel too, where the dashboard never sees the key.
  for (const contents of [pane.view.webContents, feedPanel.contents()]) {
    if (contents !== null) win.on('closed', attachAbortHotkey(escape, contents))
  }
  // The app's shortcuts (reload, back and forward, listen) act on the pane from every surface.
  const shortcuts: AppShortcutActions = {
    reload: (ignoringCache) => pane.reload(ignoringCache),
    back: () => pane.goBack(),
    forward: () => pane.goForward(),
    listen: () => {
      if (voiceSession === null) return
      if (voiceSession.getState().listening) voiceSession.disarm()
      else voiceSession.arm()
    },
    // A packaged appliance keeps its DevTools shut; detached, they never squeeze the layout.
    ...(app.isPackaged ? {} : { devTools: (contents: Electron.WebContents) => contents.openDevTools({ mode: 'detach' }) }),
  }
  for (const contents of [win.webContents, pane.view.webContents, feedPanel.contents(), weighInView.contents()]) {
    if (contents !== null) win.on('closed', attachAppShortcuts(contents, shortcuts))
  }

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
    pageTerms: () => biasUnion.pageTerms(),
    vad: voice.vad,
    transcriber: voice.transcriber,
    turn: voice.turn,
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
    // The pause-cap slider (#357, the endpoint delay of #37) applies to the
    // next utterance, live. Both endpoint timings ride this seam (#60): the
    // pause cap and the resumption-merge window, each live from its Setting (#59).
    getEndpointerConfig: () => ({
      endFrames: silenceFramesForMs(settingsStore.get().pauseCapMs),
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
  // No default menu: its accelerators reloaded, zoomed and closed whichever surface held focus (appShortcuts.ts).
  const menu = appMenuTemplate(process.platform)
  Menu.setApplicationMenu(menu === null ? null : Menu.buildFromTemplate(menu))
  registerBrowserIpc()
  registerLastPageIpc(lastPageStore)
  registerTimerIpc(timer)
  registerNowPlayingIpc()
  // The Calendar (CONTEXT.md): no provider is wired yet, so it shows the
  // month alone; a Google or Outlook source joins this list. The e2e's
  // stand-in answers from a file when its env names one.
  const calendarFixture = process.env[CALENDAR_FIXTURE_ENV]
  registerCalendarIpc(calendarFixture ? [createStandInCalendarSource(calendarFixture)] : [])
  registerCommandRunnerIpc()
  registerSettingsIpc(settingsStore)
  registerEnvFileIpc({
    path: resolveEnvFilePath(process.env, envFileHome),
    processEnv: process.env,
    onWritten: (values) => {
      envFileValues = values
    },
  })
  registerHostChecksIpc(hostFindings)
  nightDim = attachNightDim({ settings: settingsStore, idleUp: () => [...idleWindows.values()].some((shown) => shown.up), userDataDir: app.getPath('userData'), env: process.env })
  registerUsageIpc(() => settingsStore.get().usageDashboard.url)
  registerNewsIpc({ storePath: join(app.getPath('userData'), 'repos.json'), currentEnv })
  // The Log Bucket (#418): on a machine that names itself, the logs dir is
  // copied to R2 every five minutes. Read once at boot; a settings change
  // takes a restart.
  const logBucket = logBucketStartup(currentEnv())
  if (logBucket.line) console.log(logBucket.line)
  if (logBucket.start) {
    const stopLogBucket = createLogBucketUploader({
      ...logBucket.start,
      logsDir,
      client: createS3Client(logBucket.start),
    }).start()
    app.on('will-quit', stopLogBucket)
  }
  // The e2e's stand-in replaces Bluetooth whenever its env names a script, so no test reaches the real scale.
  const scaleFixture = process.env[SCALE_FIXTURE_ENV]
  scaleListener = attachScaleListener({
    transport: scaleFixture ? createStandInScaleTransport(scaleFixture) : createBluezScaleTransport(),
    store: createWeighInStore(join(app.getPath('userData'), 'weighins.json')),
    settings: settingsStore,
  })
  app.on('will-quit', () => scaleListener?.stop())
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
  // The packaged app follows the Releases, installing at the Idle Screen (#419, ADR 0090).
  updater = attachUpdater({ windows: () => [...idleWindows.values()], env: process.env })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
