import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserPane } from './browser/createBrowserPane'
import { createBrowserPane } from './browser/createBrowserPane'
import { attachBrowserPaneToWindow, registerBrowserIpc } from './browser/attachBrowserPane'
import { createPaneBrowserController } from './browser/createPaneBrowserController'
import { runCliHarness } from './cli/runCliHarness'
import { resolvePreloadPath } from './preloadPath'

// e2e harness seam: isolate the profile (cookies, cache, singleton lock) per run.
if (process.env.BINGBONG_USER_DATA_DIR) {
  app.setPath('userData', process.env.BINGBONG_USER_DATA_DIR)
}

// Terminal harness for browser control before voice exists (issue #4): a REPL
// over the same CDP controller the orchestrator will use, so browser actions
// are provable without the dashboard's UI.
const CLI_HARNESS_FLAG = '--browser-cli'
const runningCliHarness = process.argv.includes(CLI_HARNESS_FLAG) || process.env.BINGBONG_CLI === '1'

let cliHarnessStarted = false

function startCliHarness(pane: BrowserPane): void {
  if (cliHarnessStarted) return
  cliHarnessStarted = true

  const screenshotDir = join(app.getPath('downloads'), 'bingbong_downloads')
  void runCliHarness({
    controller: createPaneBrowserController(pane),
    input: process.stdin,
    output: process.stdout,
    exit: () => app.quit(),
    screenshotDir: () => screenshotDir,
    saveScreenshot: async (path, bytes) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    },
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
  // keeps logins alive across windows and restarts.
  const pane = createBrowserPane()
  attachBrowserPaneToWindow(pane, win)
  if (runningCliHarness) startCliHarness(pane)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerBrowserIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
