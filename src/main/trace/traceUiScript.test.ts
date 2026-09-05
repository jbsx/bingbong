import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TraceTimeline } from '../../core/trace/traceTimeline'

// The #189 entry point, `pnpm trace:ui`, spawned the way the npm script
// spawns it: plain node with type stripping over a fixture logs dir. It is
// the same regression pin `pnpm perf:report` carries (#36) — every runtime
// import on the script's graph must resolve as real ESM — plus the tool's
// own contract: a local page, one timeline per turn across the three
// families, a per-Session lane for the rest, and a live tail.

const SCRIPT = fileURLToPath(new URL('../../../scripts/trace-ui.ts', import.meta.url))
const T0 = 1_700_000_000_000

const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes = major > 22 || (major === 22 && minor >= 18)

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record) + '\n'
}

interface Started {
  child: ChildProcess
  url: string
  stdout: string
}

function start(dir: string): Promise<Started> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, dir, '--port', '0', '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`trace:ui never printed its URL\n${stdout}\n${stderr}`)), 15_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout)
      if (match) {
        clearTimeout(timer)
        resolve({ child, url: match[0], stdout })
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`trace:ui exited ${code} before printing its URL\n${stdout}\n${stderr}`))
    })
  })
}

interface TimelineResponse {
  logsDir: string
  filePaths: string[]
  skippedLines: number
  timeline: TraceTimeline
}

async function timeline(url: string): Promise<TimelineResponse> {
  const response = await fetch(new URL('/api/timeline', url))
  expect(response.status).toBe(200)
  return (await response.json()) as TimelineResponse
}

describe.skipIf(!stripsTypes)('trace:ui script', () => {
  let dir: string
  let started: Started | null = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-trace-ui-'))
  })

  afterEach(async () => {
    if (started !== null) {
      const exited = new Promise((resolve) => started?.child.once('exit', resolve))
      started.child.kill('SIGTERM')
      await exited
      started = null
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves the page and one timeline per turn across the three families, plus a Session lane', async () => {
    writeFileSync(
      join(dir, 'perf-1-1.jsonl'),
      line({ turnId: 'turn-1', stage: 'stt', durMs: 100, at: T0 + 50, t: 1 }) +
        line({ turnId: 'turn-1', stage: 'llm', durMs: 400, at: T0 + 900, t: 2 }),
    )
    writeFileSync(
      join(dir, 'run-trace-1-1.jsonl'),
      line({
        v: 1,
        at: T0 + 100,
        turnId: 'turn-1',
        runId: 'run-a',
        sessionId: 'sess-1',
        generation: 1,
        kind: 'pipeline_event',
        event: { type: 'command', turnId: 'turn-1', text: 'open the news', at: T0 + 100 },
      }),
    )
    writeFileSync(
      join(dir, 'host-trace-1-1.jsonl'),
      line({ v: 1, at: T0 + 10, sessionId: null, kind: 'fault', site: 'gpu.attach', message: 'no gpu' }) +
        line({ v: 1, at: T0 + 950, sessionId: 'sess-1', turnId: 'turn-1', kind: 'tts_line', text: 'Here.', chars: 5 }),
    )
    started = await start(dir)

    const page = await fetch(started.url)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('<title>Bing Bong Trace UI</title>')

    const body = await timeline(started.url)
    expect(body.logsDir).toBe(dir)
    expect(body.filePaths).toHaveLength(3)
    expect(body.timeline.counts).toEqual({ perf: 2, run: 1, host: 2 })
    expect(
      body.timeline.lanes.map((lane) => [
        lane.scope,
        lane.scope === 'turn' ? lane.turnId : lane.sessionId,
        lane.entries.map((entry) => `${entry.family}:${entry.label}`),
      ]),
    ).toEqual([
      ['session', null, ['host:fault']],
      ['turn', 'turn-1', ['perf:stt', 'run:command', 'perf:llm', 'host:tts_line']],
    ])
  })

  it('tails the logs dir: an appended line reaches the next read, and the event stream says so', async () => {
    const path = join(dir, 'run-trace-1-1.jsonl')
    writeFileSync(path, line({ v: 1, at: T0, turnId: 'turn-1', kind: 'fault', site: 'a', message: '1' }))
    started = await start(dir)
    expect((await timeline(started.url)).timeline.lanes[0].entries).toHaveLength(1)

    const controller = new AbortController()
    const stream = await fetch(new URL('/api/events', started.url), { signal: controller.signal })
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let seen = ''
    // The stream opens with a comment line; wait for it so the append
    // cannot race the subscription.
    while (!seen.includes('\n')) seen += decoder.decode((await reader.read()).value)

    appendFileSync(path, line({ v: 1, at: T0 + 1, turnId: 'turn-1', kind: 'fault', site: 'a', message: '2' }))

    while (!seen.includes('data: changed')) seen += decoder.decode((await reader.read()).value)
    controller.abort()

    expect((await timeline(started.url)).timeline.lanes[0].entries).toHaveLength(2)
  })

  it('tails a logs dir that does not exist at launch once it appears', async () => {
    const logsDir = join(dir, 'logs')
    started = await start(logsDir)
    expect((await timeline(started.url)).timeline.lanes).toEqual([])

    const controller = new AbortController()
    const stream = await fetch(new URL('/api/events', started.url), { signal: controller.signal })
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('\n')) seen += decoder.decode((await reader.read()).value)

    mkdirSync(logsDir)
    writeFileSync(join(logsDir, 'host-trace-1-1.jsonl'), line({ v: 1, at: T0, sessionId: null, kind: 'fault', site: 'a', message: '1' }))

    while (!seen.includes('data: changed')) seen += decoder.decode((await reader.read()).value)
    controller.abort()
    expect((await timeline(started.url)).timeline.lanes.map((lane) => lane.scope)).toEqual(['session'])
  }, 20_000)

  it('serves nothing but the page and its two endpoints, and only on loopback', async () => {
    started = await start(dir)
    expect(started.url.startsWith('http://127.0.0.1:')).toBe(true)
    const missing = await fetch(new URL('/etc/passwd', started.url))
    expect(missing.status).toBe(404)
    const empty = await timeline(started.url)
    expect(empty.timeline.lanes).toEqual([])
  })
})
