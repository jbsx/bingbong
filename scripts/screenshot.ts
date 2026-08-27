#!/usr/bin/env node
// Regenerates docs/screenshot.png for the README: launches the built app
// under Xvfb, drives one scripted assistant run through the prompt bar
// (BINGBONG_LLM_SCRIPT — the same e2e double), and captures the screen with
// ffmpeg x11grab. Self-contained on purpose: the e2e harness's imports are
// vitest-resolved, while node's type stripping needs .ts specifiers, so the
// minimal pieces (launch env, CDP eval, prompt-bar driver) are mirrored
// here instead of imported.
//
// Usage: pnpm shot

import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const outPath = join(repoRoot, 'docs', 'screenshot.png')
// Kiosk fullscreen on a 16:10 screen: the windowed default (1280x800) is too
// short for the whole session transcript — the answer card clips behind the
// prompt bar. Kiosk layout is pixel-identical to windowed (ADR 0012).
const WIDTH = 1920
const HEIGHT = 1200

const DEMO_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Meridian Post</title>
<style>
  :root { color-scheme: light; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #faf9f5; color: #17161a; font: 16px/1.55 Georgia, 'Times New Roman', serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 28px 32px 48px; }
  header { border-bottom: 3px double #17161a; padding-bottom: 14px; margin-bottom: 8px; }
  h1 { font-size: 44px; letter-spacing: 0.5px; font-weight: 700; }
  .dateline { font: 12px/1 'Helvetica Neue', Arial, sans-serif; letter-spacing: 2.5px;
    text-transform: uppercase; color: #6b6860; display: flex; justify-content: space-between; padding-top: 10px; }
  nav { font: 13px/1 'Helvetica Neue', Arial, sans-serif; letter-spacing: 1.5px; text-transform: uppercase;
    color: #17161a; padding: 12px 0; border-bottom: 1px solid #d9d5cc; margin-bottom: 26px;
    display: flex; gap: 26px; }
  .lead { display: flex; gap: 28px; align-items: flex-start; padding-bottom: 26px; border-bottom: 1px solid #d9d5cc; }
  .lead h2 { font-size: 34px; line-height: 1.18; font-weight: 700; }
  .kicker { font: 12px/1 'Helvetica Neue', Arial, sans-serif; letter-spacing: 2px; text-transform: uppercase;
    color: #a03327; margin-bottom: 10px; }
  .lead p { margin-top: 12px; color: #3d3a34; font-size: 17px; }
  .figure { flex: 0 0 300px; height: 200px; border-radius: 4px;
    background: linear-gradient(160deg, #10131f 0%, #2a3352 45%, #6b7ba8 80%, #c9d4ea 100%);
    position: relative; overflow: hidden; }
  .figure::after { content: ''; position: absolute; left: 18px; bottom: 0; width: 2px; height: 90px;
    background: rgba(255,255,255,0.45); box-shadow: 120px 0 rgba(255,255,255,0.28), 60px -34px rgba(255,255,255,0.18); }
  .byline { font: 12px/1 'Helvetica Neue', Arial, sans-serif; color: #6b6860; margin-top: 14px; }
  .cols { display: flex; gap: 28px; padding-top: 26px; }
  .col { flex: 1; }
  .col article + article { margin-top: 22px; padding-top: 22px; border-top: 1px solid #e4e0d6; }
  .col h3 { font-size: 19px; line-height: 1.3; font-weight: 700; }
  .col p { margin-top: 8px; color: #4a473f; font-size: 15px; }
  .video { background: #17161a; color: #f4f2ec; border-radius: 6px; padding: 18px 20px 20px; }
  .video .label { font: 11px/1 'Helvetica Neue', Arial, sans-serif; letter-spacing: 2px;
    text-transform: uppercase; color: #b7b2a4; margin-bottom: 14px; }
  .thumb { height: 110px; border-radius: 4px; position: relative; margin-bottom: 12px;
    background: linear-gradient(140deg, #23283d, #454f74 60%, #8b97bd); }
  .thumb::after { content: ''; position: absolute; inset: 0; margin: auto; width: 0; height: 0;
    border-left: 22px solid rgba(255,255,255,0.92); border-top: 13px solid transparent; border-bottom: 13px solid transparent;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)); }
  .video h4 { font-size: 16px; line-height: 1.35; }
  .video .meta { font: 12px/1 'Helvetica Neue', Arial, sans-serif; color: #b7b2a4; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>The Meridian Post</h1>
    <div class="dateline"><span>Thursday, August 27, 2026</span><span>Edition No. 4,812</span></div>
  </header>
  <nav><span>World</span><span>Science</span><span>Energy</span><span>Culture</span><span>Opinion</span></nav>
  <section class="lead">
    <div>
      <div class="kicker">Science &amp; Space</div>
      <h2>Ariel mission returns first images of Europa&rsquo;s plumes</h2>
      <p>The flyby cameras caught a filament of water vapor rising 200&nbsp;km off the ice —
      the clearest sign yet that the ocean below breaches the surface.</p>
      <div class="byline">By Rosa Villanueva &middot; 6 min read</div>
    </div>
    <div class="figure"></div>
  </section>
  <section class="cols">
    <div class="col">
      <article>
        <h3>Grid batteries outpace gas peakers in Texas summer</h3>
        <p>For the first full season, big storage discharged more evening peak hours than the gas fleet.</p>
      </article>
      <article>
        <h3>EU accessibility act reshapes web defaults</h3>
        <p>Contrast minimums and focus rings move from waivers to baseline across member-state sites.</p>
      </article>
      <article>
        <h3>A field guide to quiet keyboards</h3>
        <p>Linear, tactile, or silent — what the switch literature actually says about noise at the desk.</p>
      </article>
    </div>
    <div class="col">
      <div class="video">
        <div class="label">Watch</div>
        <div class="thumb"></div>
        <h4>The Europa flyby, minute by minute</h4>
        <div class="meta">4:12 &middot; Meridian Video</div>
      </div>
    </div>
  </section>
</div>
</body>
</html>`

const COMMAND = 'open the meridian post and tell me what is on the front page'
const ANSWER = {
  speak:
    "The lead is Europa — the Ariel mission's first images of the plumes. Grid batteries, the EU accessibility act, and a quiet-keyboard guide below, plus one video.",
  display:
    "Opened **The Meridian Post** — the lead is the Ariel mission's first Europa plume images, plus grid batteries, the accessibility act, and one flyby video.",
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  { timeoutMs = 30000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await Promise.resolve(probe()).catch(() => undefined)
    if (value !== undefined && value !== null && value !== false && value !== '') return value as T
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(intervalMs)
  }
}

function startDemoServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/favicon.ico') {
        res.writeHead(204).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DEMO_PAGE)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no demo server address')
      resolve({ server, url: `http://127.0.0.1:${address.port}/` })
    })
  })
}

function isFreePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function pickFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 20000)
    if (await isFreePort(port)) return port
  }
  throw new Error('no free debug port found after 10 attempts')
}

interface TargetInfo {
  sessionId: string
  targetId: string
  type: string
  url: string
}

class Cdp {
  private nextId = 0
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly socket: WebSocket
  onTargets:
    | ((method: 'Target.attachedToTarget' | 'Target.detachedFromTarget', params: { sessionId: string; targetInfo?: TargetInfo }) => void)
    | null = null

  constructor(webSocketUrl: string) {
    this.socket = new WebSocket(webSocketUrl)
    this.socket.onmessage = (event) => this.handleMessage(String(event.data))
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out connecting to CDP socket')), 10000)
      this.socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      this.socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('failed to connect to CDP socket'))
      }
    })
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    const id = ++this.nextId
    const frame: Record<string, unknown> = { id, method, params }
    if (sessionId !== undefined) frame.sessionId = sessionId
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
    this.socket.send(JSON.stringify(frame))
    return promise
  }

  handleMessage(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number
      result?: unknown
      error?: { message?: string }
      method?: string
      params?: unknown
    }
    if (message.id !== undefined) {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? 'CDP error'))
      else request.resolve(message.result)
      return
    }
    if (message.method === 'Target.attachedToTarget' || message.method === 'Target.detachedFromTarget') {
      this.onTargets?.(message.method, message.params as { sessionId: string; targetInfo?: TargetInfo })
    }
  }

  close(): void {
    this.socket.close()
  }
}

async function evaluate<T>(cdp: Cdp, sessionId: string, expression: string): Promise<T> {
  const response = await cdp.send<{ result?: { value?: T }; exceptionDetails?: { text: string } }>(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (response.exceptionDetails) throw new Error(`evaluation failed: ${response.exceptionDetails.text}`)
  return response.result?.value as T
}

const promptBarScript = (text: string): string => `(async () => {
  const input = document.querySelector('.prompt-input')
  if (!input) return 'no-prompt-input'
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  document.querySelector('.prompt-form').requestSubmit()
  return 'submitted'
})()`

/**
 * Hermetic spoken output: fake `piper` (silence PCM on stdout, exit 0) and
 * fake `aplay` (discard stdin) plus the voice files the config resolution
 * expects — TTS succeeds without piper, voices, or a sound device.
 */
async function writeFakeTts(userDataDir: string): Promise<{ piperBin: string; binDir: string; voicesDir: string }> {
  const binDir = join(userDataDir, 'fake-bin')
  const voicesDir = join(userDataDir, 'voices')
  await mkdir(binDir, { recursive: true })
  await mkdir(voicesDir, { recursive: true })
  const piperBin = join(binDir, 'piper')
  await writeFile(piperBin, '#!/bin/sh\nhead -c 22050 /dev/zero\n')
  await chmod(piperBin, 0o755)
  await writeFile(join(binDir, 'aplay'), '#!/bin/sh\ncat > /dev/null\n')
  await chmod(join(binDir, 'aplay'), 0o755)
  await writeFile(join(voicesDir, 'en_US-ryan-medium.onnx'), '')
  await writeFile(join(voicesDir, 'en_US-ryan-medium.onnx.json'), '{"audio":{"sample_rate":22050}}\n')
  return { piperBin, binDir, voicesDir }
}

/** A hermetic environment: no inherited routing, keys, or adblock fetches. */
function buildEnv(
  userDataDir: string,
  llmScript: string,
  tts: { piperBin: string; binDir: string; voicesDir: string },
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('BINGBONG_') && !key.startsWith('ZAI_') && !key.startsWith('DEEPSEEK_')) {
      env[key] = value
    }
  }
  return {
    ...env,
    BINGBONG_USER_DATA_DIR: userDataDir,
    BINGBONG_LLM_SCRIPT: llmScript,
    BINGBONG_PIPER_BIN: tts.piperBin,
    BINGBONG_PIPER_VOICE_DIR: tts.voicesDir,
    PATH: `${tts.binDir}:${process.env.PATH ?? ''}`,
    BINGBONG_VISION_SCRIPT: '[]',
    BINGBONG_VISION_DESCRIPTION_SCRIPT: '[]',
    BINGBONG_VAD_SCRIPT: '[0.01]',
    BINGBONG_STT_SCRIPT: '["ready"]',
    BINGBONG_WAKE_ENGINE: 'off',
    BINGBONG_ADBLOCK: 'off',
    BINGBONG_ENV_FILE: join(userDataDir, 'env-file-not-set'),
    ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    XDG_SESSION_TYPE: 'x11',
    DISPLAY: process.env.DISPLAY ?? ':0',
  }
}

async function main(): Promise<void> {
  const demo = await startDemoServer()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-shot-'))
  const tts = await writeFakeTts(userDataDir)
  const llmScript = JSON.stringify([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: demo.url } }] },
    { kind: 'tool_calls', calls: [{ id: 'c2', name: 'read_page', args: {} }] },
    { kind: 'answer', speak: ANSWER.speak, display: ANSWER.display },
  ])
  const debugPort = await pickFreePort()

  const proc = spawn(
    `${repoRoot}/node_modules/.bin/electron`,
    ['out/main/index.js', '--ozone-platform=x11', `--remote-debugging-port=${debugPort}`, '--kiosk'],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: buildEnv(userDataDir, llmScript, tts),
    },
  )
  proc.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[app] ${chunk}`))

  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      return (await response.json()) as { webSocketDebuggerUrl: string }
    })
    const cdp = new Cdp(version.webSocketDebuggerUrl)
    await cdp.connect()

    const sessions = new Map<string, TargetInfo>()
    cdp.onTargets = (method, params) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo) {
        sessions.set(params.sessionId, { ...params.targetInfo, sessionId: params.sessionId })
      } else {
        sessions.delete(params.sessionId)
      }
    }
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })

    const find = (kind: 'dashboard' | 'overlay' | 'pane'): string | undefined =>
      [...sessions.values()].find((info) => {
        if (kind === 'overlay') return info.url.includes('out/renderer/overlay.html')
        if (kind === 'dashboard') return info.url.includes('out/renderer') && !info.url.includes('overlay.html')
        return info.type === 'page' && !info.url.includes('out/renderer')
      })?.sessionId

    const dashboardSid = await waitFor(async () => {
      const sid = find('dashboard')
      if (!sid) return undefined
      // Wake the idle screen the same way real keypresses do.
      const ready = await evaluate<boolean>(
        cdp,
        sid,
        `(window.dispatchEvent(new KeyboardEvent('keydown')), !!document.querySelector('.url-input'))`,
      )
      return ready ? sid : undefined
    })
    const overlaySid = await waitFor(() => find('overlay'))

    const collapsed = await evaluate<boolean>(cdp, overlaySid, `!!document.querySelector('.overlay-chrome--collapsed')`)
    if (collapsed) {
      await evaluate(cdp, overlaySid, `window.bingbong.feedPanel.toggle()`)
      await waitFor(() => evaluate<boolean>(cdp, overlaySid, `!!document.querySelector('.overlay-chrome--open')`))
    }

    const submitted = await evaluate<string>(cdp, overlaySid, promptBarScript(COMMAND))
    if (submitted !== 'submitted') throw new Error(`prompt bar returned: ${submitted}`)

    await waitFor(
      () =>
        evaluate<string>(
          cdp,
          overlaySid,
          `document.querySelector('.feed-entry--display')?.textContent ?? ''`,
        ),
    )
    await waitFor(() => evaluate<boolean>(cdp, dashboardSid, `!!document.querySelector('.status-orb--idle')`))
    await sleep(1500)

    // The feed panel lapses (collapses) once the run idles — re-open it so the
    // screenshot shows the prompt bar and the session transcript.
    const relapsed = await evaluate<boolean>(cdp, overlaySid, `!!document.querySelector('.overlay-chrome--collapsed')`)
    if (relapsed) {
      await evaluate(cdp, overlaySid, `window.bingbong.feedPanel.toggle()`)
      await waitFor(() => evaluate<boolean>(cdp, overlaySid, `!!document.querySelector('.overlay-chrome--open')`))
    }
    // A wider panel (default 380px) unwraps the command and answer cards —
    // the whole session then fits the feed viewport without clipping.
    await evaluate(cdp, dashboardSid, `window.bingbong.feedPanel.setWidth(560)`)
    // The overlay view resizes asynchronously after the state change — wait
    // for the width to settle so the capture isn't mid-resize.
    await waitFor(async () => {
      const first = await evaluate<number>(cdp, overlaySid, 'innerWidth')
      await sleep(300)
      const second = await evaluate<number>(cdp, overlaySid, 'innerWidth')
      return second === first && second > 300 ? second : undefined
    })

    // Expand the finished run's details (collapsed by default) with a real
    // input-pipeline click — React controls the `open` attribute, so a
    // synthetic el.click() can race the re-render and snap shut. The feed's
    // auto-scroll can park the summary outside the view, so scroll to the
    // session top first and recompute the click point every attempt.
    const overlayTarget = [...sessions.values()].find((s) => s.sessionId === overlaySid)
    await cdp.send('Target.activateTarget', { targetId: overlayTarget?.targetId ?? '' })
    await sleep(1000)
    let runOpen = false
    for (let attempt = 0; attempt < 5 && !runOpen; attempt++) {
      await evaluate(cdp, overlaySid, `document.querySelector('.feed-list').scrollTop = 0`)
      await sleep(300)
      const center = await evaluate<{ x: number; y: number } | null>(cdp, overlaySid, `(() => {
        const el = document.querySelector('.feed-run-summary')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
      })()`)
      if (!center) throw new Error('run summary not found')
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', buttons: 1, clickCount: 1 }, overlaySid)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', buttons: 0, clickCount: 1 }, overlaySid)
      runOpen = await waitFor(
        () => evaluate<boolean>(cdp, overlaySid, `!!document.querySelector('.feed-run[open]')`),
        { timeoutMs: 3000, intervalMs: 100 },
      ).then(
        () => true,
        () => false,
      )
    }
    if (!runOpen) throw new Error('failed to expand run details after 5 attempts')
    await sleep(800)

    // Show the whole session: command → run detail → answer. The feed
    // auto-scrolls to the frontier; scroll back to the top of the session.
    await evaluate(cdp, overlaySid, `document.querySelector('.feed-list').scrollTop = 0`)
    // Pre-fill the prompt bar with the README's example command — shows the
    // affordance, and avoids the placeholder clipping at this panel width.
    await evaluate(cdp, overlaySid, `(() => {
      const input = document.querySelector('.prompt-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'open youtube and play the first MKBHD result')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(500)

    const capture = spawnSync(
      'ffmpeg',
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'x11grab', '-draw_mouse', '0',
        '-video_size', `${WIDTH}x${HEIGHT}`,
        '-i', process.env.DISPLAY ?? ':0',
        '-frames:v', '1',
        outPath,
      ],
      { stdio: 'inherit' },
    )
    if (capture.status !== 0) throw new Error(`ffmpeg exited with ${capture.status}`)

    cdp.send('Browser.close').catch(() => {})
    await Promise.race([
      new Promise<void>((resolve) => proc.once('exit', () => resolve())),
      sleep(10000).then(() => {
        proc.kill('SIGKILL')
      }),
    ])
    cdp.close()
  } finally {
    demo.server.close()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }

  process.stdout.write(`wrote ${outPath}\n`)
}

await main()
