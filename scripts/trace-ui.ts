#!/usr/bin/env node
// The #189 entry point (`pnpm trace:ui`): the Trace UI, a developer-only
// timeline reader for the perf log, the Run Trace and the Host Trace.
// Diagnosing a turn otherwise means joining `perf-*.jsonl`,
// `run-trace-*.jsonl` and `host-trace-*.jsonl` on `turnId` / `sessionId`
// by hand with `jq`. This is that join, on a page.
//
// It is a script beside `pnpm perf:report`, not an app view (ADR 0031):
// the glossary commits both traces to "never rendered in any view", and
// this file is reachable from nothing electron-vite bundles and nothing
// the Kiosk image copies. Because the files are the contract it needs no
// IPC — a loopback-only node:http server reads the logs dir, serves one
// page, answers `/api/timeline` with the lanes, and pushes a `changed`
// event over `/api/events` whenever the dir changes, so the page can
// re-read. Node runs this .ts directly via type stripping, so it needs
// Node >= 22.18 and .ts-extension imports on its whole runtime graph (#36).
//
// Usage:
//   pnpm trace:ui [logs-dir] [--port N] [--no-open]
//
// Without a dir: <BINGBONG_USER_DATA_DIR>/logs, else the platform default
// user-data dir's logs — the same resolution as `pnpm perf:report`.

import { spawn } from 'node:child_process'
import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { buildTraceTimeline } from '../src/core/trace/traceTimeline.ts'
import { createTraceTail, resolveTraceLogsDir } from '../src/main/trace/traceTail.ts'

const DEFAULT_PORT = 4189
/** How long after the last fs event the page is told; a Run writes many lines in a burst. */
const CHANGE_DEBOUNCE_MS = 150
/** The fallback when the dir cannot be watched (it does not exist yet, or the platform refuses). */
const POLL_FALLBACK_MS = 1000

const args = process.argv.slice(2)
const port = portFrom(args)
const open = !args.includes('--no-open')
const logsDir = resolveTraceLogsDir(args, process.env)
const pageHtml = readFileSync(fileURLToPath(new URL('./trace-ui.html', import.meta.url)))
const tail = createTraceTail(logsDir)
const subscribers = new Set<ServerResponse>()

function portFrom(argv: readonly string[]): number {
  const index = argv.indexOf('--port')
  if (index === -1) return DEFAULT_PORT
  const value = Number(argv[index + 1])
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    console.error(`trace:ui: --port needs an integer 0–65535, got ${JSON.stringify(argv[index + 1])}`)
    process.exit(2)
  }
  return value
}

function broadcast(): void {
  for (const subscriber of subscribers) subscriber.write('data: changed\n\n')
}

// The tail is polled by the page's reads, not here: the watcher only says
// "something changed", debounced, and the page fetches the whole timeline
// again. A bursty writer therefore costs one re-read per burst, and the
// collector re-reads only the appended bytes.
let debounce: NodeJS.Timeout | null = null
function noteChange(): void {
  if (debounce !== null) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    broadcast()
  }, CHANGE_DEBOUNCE_MS)
}

let watcher: FSWatcher | null = null
let fallback: NodeJS.Timeout | null = null
let lastFingerprint = ''
/** Watches the logs dir; false when it cannot be watched (it does not exist yet, or the platform refuses). */
function watchLogsDir(): boolean {
  try {
    watcher = watch(logsDir, { persistent: false }, noteChange)
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      pollLogsDir()
    })
    return true
  } catch (error) {
    if (fallback === null) console.log(`trace:ui cannot watch ${logsDir} yet (${String(error)}); polling instead`)
    return false
  }
}
/** The fallback: poll until the dir can be watched, telling the page about any change meanwhile. */
function pollLogsDir(): void {
  if (fallback !== null) return
  fallback = setInterval(() => {
    if (watchLogsDir()) {
      clearInterval(fallback as NodeJS.Timeout)
      fallback = null
      noteChange()
      return
    }
    const collection = tail.poll()
    const fingerprint = `${collection.filePaths.join('|')}#${collection.records.length}#${collection.skippedLines}`
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint
      noteChange()
    }
  }, POLL_FALLBACK_MS)
  fallback.unref()
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method !== 'GET') {
    response.writeHead(405).end()
    return
  }
  switch (url.pathname) {
    case '/': {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(pageHtml)
      return
    }
    case '/api/timeline': {
      const collection = tail.poll()
      const body = JSON.stringify({
        logsDir,
        filePaths: collection.filePaths,
        skippedLines: collection.skippedLines,
        timeline: buildTraceTimeline(collection.records),
      })
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(body)
      return
    }
    case '/api/events': {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      subscribers.add(response)
      const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000)
      request.on('close', () => {
        clearInterval(heartbeat)
        subscribers.delete(response)
      })
      return
    }
    default:
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const url = `http://127.0.0.1:${bound}/`
  console.log(`trace:ui reading ${logsDir}`)
  console.log(`trace:ui at ${url}`)
  if (!watchLogsDir()) pollLogsDir()
  if (open) openInBrowser(url)
})

function openInBrowser(url: string): void {
  const [command, commandArgs] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log(`trace:ui could not open a browser; open ${url} yourself`))
    child.unref()
  } catch (error) {
    console.log(`trace:ui could not open a browser (${String(error)}); open ${url} yourself`)
  }
}

function shutdown(): void {
  watcher?.close()
  if (fallback !== null) clearInterval(fallback)
  for (const subscriber of subscribers) subscriber.end()
  server.close(() => process.exit(0))
  // A subscriber that never closes must not keep the process alive.
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
