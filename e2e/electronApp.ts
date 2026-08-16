import { spawn } from 'node:child_process'
import type { Writable } from 'node:stream'
import { createServer } from 'node:net'
import { connectCdp, type CdpClient } from './cdpClient'
import { sleep, waitFor } from './waitFor'

export interface LaunchedApp {
  cdp: CdpClient
  /** Writable stdin — only when launched with `pipeStdio`. */
  readonly stdin: Writable | null
  /** Resolves with the first stdout line matching (only with `pipeStdio`). */
  waitForStdoutLine(match: RegExp, since: number): Promise<string>
  /** Number of stdout lines captured so far — use as `since` to await only new output. */
  stdoutLineCount(): number
  /** Everything printed to stdout so far (only with `pipeStdio`). */
  stdoutText(): string
  quit(): Promise<void>
}

export interface LaunchOptions {
  electronBinary: string
  entry: string
  cwd: string
  debugPort: number
  userDataDir: string
  /** Extra CLI args forwarded to the app (e.g. ['--browser-cli']). */
  args?: string[]
  /** Pipe stdin/stdout so callers can drive/reap a CLI harness. */
  pipeStdio?: boolean
}

const STDERR_LIMIT = 10_000

function isFreePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

export async function pickFreeDebugPort(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 20000)
    if (await isFreePort(port)) return port
  }
  throw new Error('no free debug port found after 10 attempts')
}

export async function launchApp({
  electronBinary,
  entry,
  cwd,
  debugPort,
  userDataDir,
  args = [],
  pipeStdio = false,
}: LaunchOptions): Promise<LaunchedApp> {
  const proc = spawn(electronBinary, [entry, ...args, `--remote-debugging-port=${debugPort}`], {
    cwd,
    stdio: pipeStdio ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, BINGBONG_USER_DATA_DIR: userDataDir },
  })
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT)
    if (process.env.BINGBONG_E2E_VERBOSE) process.stderr.write(`[app] ${chunk}`)
  })
  const stdoutLines: string[] = []
  let stdoutBuffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    if (process.env.BINGBONG_E2E_VERBOSE) process.stderr.write(`[worker ${Date.now()}] stdout chunk: ${JSON.stringify(chunk.toString().slice(0, 80))}\n`)
    stdoutBuffer += chunk.toString()
    let newlineAt = stdoutBuffer.indexOf('\n')
    while (newlineAt !== -1) {
      stdoutLines.push(stdoutBuffer.slice(0, newlineAt))
      stdoutBuffer = stdoutBuffer.slice(newlineAt + 1)
      newlineAt = stdoutBuffer.indexOf('\n')
    }
  })

  try {
    const version = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
        return (await response.json()) as { webSocketDebuggerUrl: string }
      },
      { timeoutMs: 20000, intervalMs: 250 },
    )
    const cdp = await connectCdp(version.webSocketDebuggerUrl)

    return {
      cdp,
      stdin: proc.stdin,
      waitForStdoutLine: (match: RegExp, since = 0) =>
        // Result lines follow the 'bingbong> ' prompt on the same stdout line;
        // match against the line with the prompt prefix stripped.
        waitFor(
          async () =>
            stdoutLines
              .slice(since)
              .find((line) => match.test(line.replace(/^bingbong> /, '')))
              ?.replace(/^bingbong> /, ''),
          { timeoutMs: 20000, intervalMs: 100 },
        ),
      stdoutLineCount: () => stdoutLines.length,
      stdoutText: () => stdoutLines.join('\n'),
      async quit() {
        // Browser.close often never replies — the browser process exits first.
        cdp.send('Browser.close').catch(() => {})
        const outcome = await Promise.race([
          exited.then(() => 'exited' as const),
          sleep(10000).then(() => 'timeout' as const),
        ])
        cdp.close()
        if (outcome === 'timeout') {
          proc.kill('SIGKILL')
          await exited
          // Cookie persistence only flushes on a graceful quit, so a forced
          // kill must fail loudly instead of silently invalidating tests.
          throw new Error('graceful quit timed out after 10s; app was SIGKILLed')
        }
      },
    }
  } catch (error) {
    proc.kill('SIGKILL')
    await exited
    if (stderr) {
      throw new Error(`${(error as Error).message}\napp stderr (tail):\n${stderr.slice(-2000)}`, { cause: error })
    }
    throw error
  }
}
