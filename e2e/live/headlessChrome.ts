// A real headless Chrome over the DevTools protocol, for the page tests of the
// evaluator's loopback pages (the Grading Bench #232, the Fix Ledger #251).
// Chrome is found on the usual paths or at CHROME_PATH; a suite that needs one
// skips, not fails, where none is found (`canDriveChrome`). Port 0 lets Chrome
// pick its debugging port; it writes the one it took into the profile.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { connectCdp, type CdpClient } from '../cdpClient.ts'

export const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
  (path): path is string => typeof path === 'string' && path !== '' && existsSync(path),
)
/** A Chrome and a global WebSocket (Node ≥ 22). */
export const canDriveChrome = CHROME !== undefined && typeof WebSocket === 'function'

interface EvaluateResult {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
}

/** Polls until the probe returns something truthy; a throwing probe (a page mid-navigation) reads as not yet. */
export async function until<T>(probe: () => T | Promise<T>, what: string, timeoutMs = 10_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let value: T | undefined
    try {
      value = await probe()
    } catch {
      value = undefined
    }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

/** A loopback server on a port the OS picks. */
export function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const created = createServer(handler)
    created.listen(0, '127.0.0.1', () => {
      const address = created.address()
      resolve({ server: created, port: typeof address === 'object' && address !== null ? address.port : 0 })
    })
  })
}

export interface HeadlessChrome {
  readonly cdp: CdpClient
  /** Evaluates in the page, awaiting a promise, and throws the page's own exception text. */
  readonly evaluate: <T>(expression: string) => Promise<T>
  /** Closes the protocol, exits Chrome, and removes its profile once Chrome has let go of it. */
  readonly close: () => Promise<void>
}

export async function launchHeadlessChrome(profilePrefix: string): Promise<HeadlessChrome> {
  if (CHROME === undefined) throw new Error('no Chrome found; set CHROME_PATH')
  const profile = mkdtempSync(join(tmpdir(), profilePrefix))
  const chrome: ChildProcess = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,900', 'about:blank'],
    { stdio: 'ignore' },
  )
  const portFile = join(profile, 'DevToolsActivePort')
  const devtoolsPort = await until(() => (existsSync(portFile) ? readFileSync(portFile, 'utf8').split('\n')[0] : ''), 'Chrome to open its debugging port', 20_000)
  const target = await until(async () => {
    const targets = (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    return targets.find((listed) => listed.type === 'page')
  }, 'a page target')
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const reply = await cdp.send<EvaluateResult>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const details = reply.exceptionDetails
    if (details) throw new Error(details.exception?.description ?? details.text)
    return reply.result?.value as T
  }

  const close = async (): Promise<void> => {
    cdp.close()
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve))
      chrome.kill()
      await exited
    }
    // Chrome's helper processes can still be writing into the profile after
    // the main process has exited, so a removal can land on ENOTEMPTY; it is
    // retried with a pause, and a profile that will not go is left in the
    // temp dir rather than failing a suite whose tests have all passed.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true })
        return
      } catch (error) {
        if (attempt === 24) console.warn(`headless Chrome profile ${profile} was left behind: ${String(error)}`)
        else await sleep(200)
      }
    }
  }

  return { cdp, evaluate, close }
}
