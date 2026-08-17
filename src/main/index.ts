import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { BrowserController } from '../core/ports/browser'
import type { TtsSpeaker } from '../core/ports/tts'
import { createAgentActivityTracker, withAgentActivity } from '../core/downloads/agentActivity'
import { PIPELINE_IPC } from '../core/pipeline/ipcChannels'
import { createBrowserPane } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { attachDownloadRouter } from './browser/attachDownloadRouter'
import { runCliHarness, saveScreenshotFile } from './cli/runCliHarness'
import { attachAssistantToWindow, registerAssistantIpc } from './agent/attachAssistant'
import { createAssistantPipeline } from './agent/createAssistantPipeline'
import { resolveDownloadsDir } from './downloadsDir'
import { resolvePreloadPath } from './preloadPath'
import { createSettingsStore } from './settings/settingsStore'
import { registerSettingsIpc } from './settings/attachSettings'
import { settingsToEnv } from '../core/settings/settings'
import { resolvePiperConfig } from './tts/piperConfig'
import { createMainTts } from './tts/createMainTts'
import { registerTtsIpc } from './tts/attachTts'

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

// Piper TTS: binary, voices dir, and base voice come from env (defaults
// suffice for a standard install); the settings page's voice wins per line.
const piperConfig = resolvePiperConfig(process.env, app.getPath('userData'))

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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Bing Bong',
    webPreferences: {
      preload: resolvePreloadPath(join(__dirname, '../preload')),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
  const agentActivity = createAgentActivityTracker()
  const controller: BrowserController = withAgentActivity(createPaneBrowserController(pane), agentActivity)

  const downloadsDir = resolveDownloadsDir(process.env, app.getPath('downloads'))
  // Spoken output (T8). The pipeline and download announcements share this
  // speaker, and tts.stop() is the barge-in hook the wake word (T10) will call.
  const tts: TtsSpeaker = createMainTts({
    config: piperConfig,
    pane: pane.view.webContents,
    getVoiceId: () => settingsStore.get().ttsVoice.trim() || piperConfig.voiceId,
  })
  attachDownloadRouter(pane.session, {
    dir: downloadsDir,
    tts,
    isAgentActive: agentActivity.isActive,
    emit: (event) => {
      if (!win.isDestroyed()) win.webContents.send(PIPELINE_IPC.event, event)
    },
  })

  if (runningCliHarness) startCliHarness(controller, downloadsDir)
  attachAssistantToWindow(
    createAssistantPipeline({ controller, env: currentEnv(), getEnv: currentEnv, tts }),
    win,
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerBrowserIpc()
  registerAssistantIpc()
  registerSettingsIpc(settingsStore)
  registerTtsIpc({ voicesDir: () => piperConfig.voicesDir })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
