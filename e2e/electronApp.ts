import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { connectCdp, type CdpClient } from './cdpClient'
import { sleep, waitFor } from './waitFor'

export interface LaunchedApp {
  cdp: CdpClient
  quit(): Promise<void>
}

export interface LaunchOptions {
  electronBinary: string
  entry: string
  cwd: string
  debugPort: number
  userDataDir: string
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

export async function launchApp({ electronBinary, entry, cwd, debugPort, userDataDir }: LaunchOptions): Promise<LaunchedApp> {
  const proc = spawn(electronBinary, [entry, `--remote-debugging-port=${debugPort}`], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, BINGBONG_USER_DATA_DIR: userDataDir },
  })
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT)
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
