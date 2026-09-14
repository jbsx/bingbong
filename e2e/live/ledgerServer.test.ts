import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openFixLedger, readLedgerFiles, type LedgerListing } from './ledgerServer.ts'
import type { LedgerRow } from './ledger.ts'

// The Fix Ledger's loopback door (#251) on a real socket, over a directory
// holding two committed families and one file that is not an audit: the
// listing, a row with its default and a chosen Reference, the refusals, and
// the Markdown file route. The last test starts `scripts/live-ledger.ts`
// itself as a Node subprocess — what catches an extensionless runtime import
// on the CLI's graph.

const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))
const PAGE = fileURLToPath(new URL('../../scripts/live-ledger.html', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../../scripts/live-ledger.ts', import.meta.url))
const FIXTURE_FILES = [
  'audit-baseline-1.json',
  'audit-baseline-2.json',
  'audit-baseline-3.json',
  'audit-aggregate.json',
  'audit-aggregate.md',
  'audit-baseline2-1.json',
  'audit-baseline2-2.json',
  'audit-baseline2-3.json',
  'audit-aggregate-baseline2.json',
  'audit-aggregate-baseline2.md',
]

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const created = createServer(handler)
    created.listen(0, '127.0.0.1', () => {
      const address = created.address()
      resolve({ server: created, port: typeof address === 'object' && address !== null ? address.port : 0 })
    })
  })
}

describe('the Fix Ledger server', () => {
  let root: string
  let server: Server
  let base: string

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bingbong-ledger-'))
    mkdirSync(join(root, 'reports'))
    for (const name of FIXTURE_FILES) copyFileSync(join(REPORTS_DIR, name), join(root, 'reports', name))
    writeFileSync(join(root, 'reports', 'audit-notes.json'), '{"kind":"notes"}')
    writeFileSync(join(root, 'reports', 'audit-broken.json'), '{')
    const ledger = openFixLedger({ reportsDir: join(root, 'reports'), pageHtml: readFileSync(PAGE, 'utf8') })
    const listening = await listen(ledger.handle)
    server = listening.server
    base = `http://127.0.0.1:${listening.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('reads every audit-*.json in the directory, and reports one it cannot parse', () => {
    const files = readLedgerFiles(join(root, 'reports'))
    expect(files.map((file) => file.name)).toEqual([...FIXTURE_FILES.filter((name) => name.endsWith('.json')), 'audit-broken.json', 'audit-notes.json'].sort())
    expect(files.find((file) => file.name === 'audit-broken.json')?.error).toMatch(/JSON/)
  })

  it('serves the page, and lists the families with their Reference and Markdown files', async () => {
    const page = await fetch(`${base}/`)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('<title>Fix Ledger</title>')

    const listing = (await (await fetch(`${base}/api/ledger`)).json()) as LedgerListing
    expect(listing.reportsDir).toBe(join(root, 'reports'))
    expect(listing.families.map((family) => [family.id, family.baseline, family.defaultReference])).toEqual([
      ['baseline', true, null],
      ['baseline2', true, 'baseline'],
    ])
    expect(listing.families[0]!.aggregate).toEqual({ fileName: 'audit-aggregate.json', markdown: 'audit-aggregate.md' })
    // No per-Pass Markdown was copied: the link is offered only for a file that exists.
    expect(listing.families[0]!.passes.map((pass) => pass.markdown)).toEqual([null, null, null])
    expect(listing.families[1]!.conditions?.browserSubspans).toBe(true)
    expect(listing.ignored).toEqual([
      { name: 'audit-broken.json', reason: expect.stringMatching(/^unreadable: SyntaxError/) },
      { name: 'audit-notes.json', reason: 'not a Round Audit: kind "notes"' },
    ])
  })

  it('answers a row against the default Reference, a chosen one, or none', async () => {
    const byDefault = (await (await fetch(`${base}/api/row?subject=baseline2`)).json()) as LedgerRow
    expect(byDefault.reference).toBe('baseline')
    expect(byDefault.markers.every).toEqual([{ axis: 'browser sub-spans', reference: 'off', subject: 'on' }])

    const chosen = (await (await fetch(`${base}/api/row?subject=baseline&reference=baseline2`)).json()) as LedgerRow
    expect(chosen.reference).toBe('baseline2')
    expect(chosen.markers.every).toEqual([{ axis: 'browser sub-spans', reference: 'on', subject: 'off' }])

    const alone = (await (await fetch(`${base}/api/row?subject=baseline2&reference=none`)).json()) as LedgerRow
    expect(alone.reference).toBeNull()
    expect(alone.headline[0]!.populations.initial.delta).toBeNull()

    expect((await fetch(`${base}/api/row?subject=nobody`)).status).toBe(404)
    expect((await fetch(`${base}/api/row?subject=baseline&reference=nobody`)).status).toBe(404)
    expect((await fetch(`${base}/api/row`)).status).toBe(400)
  })

  it('serves an audit file by name and nothing else', async () => {
    const markdown = await fetch(`${base}/reports/audit-aggregate.md`)
    expect(markdown.status).toBe(200)
    expect(markdown.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await markdown.text()).toContain('# Round Audit')
    expect((await fetch(`${base}/reports/audit-nowhere.md`)).status).toBe(404)
    expect((await fetch(`${base}/reports/..%2Faudit-aggregate.md`)).status).toBe(404)
    expect((await fetch(`${base}/reports/baseline-1.json`)).status).toBe(404)
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404)
  })

  it('refuses a request not addressed to loopback, from another page, or not a GET', async () => {
    // fetch drops a Host header it did not set; a raw request carries the rebound name.
    const rebound = await new Promise<number>((resolve, reject) => {
      const port = Number(new URL(base).port)
      request({ host: '127.0.0.1', port, path: '/api/ledger', headers: { host: 'ledger.example' } }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
        .on('error', reject)
        .end()
    })
    expect(rebound).toBe(403)
    expect((await fetch(`${base}/api/ledger`, { headers: { origin: 'https://elsewhere.example' } })).status).toBe(403)
    expect((await fetch(`${base}/api/ledger`, { method: 'POST' })).status).toBe(405)
  })

  it('starts scripts/live-ledger.ts itself, on the directory it is given', async () => {
    const child = spawn(process.execPath, [SCRIPT, `--reports=${join(root, 'reports')}`, '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`live:ledger did not announce a URL\nstdout: ${stdout}\nstderr: ${stderr}`)), 20_000)
        const look = () => {
          const match = /live:ledger at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout)
          if (match) {
            clearTimeout(timer)
            resolve(match[1]!)
          }
        }
        child.stdout.on('data', look)
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`live:ledger exited with ${code}\nstdout: ${stdout}\nstderr: ${stderr}`))
        })
      })
      const listing = (await (await fetch(`${url}api/ledger`)).json()) as LedgerListing
      expect(listing.families.map((family) => family.id)).toEqual(['baseline', 'baseline2'])
      expect(stdout).toContain('live:ledger ignored audit-notes.json: not a Round Audit: kind "notes"')
    } finally {
      child.kill()
    }
  }, 30_000)

  it('refuses a usage error before listening', async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, '--port', 'many', '--no-open'], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
      child.on('exit', (code) => resolve({ code, stderr }))
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--port needs an integer 0–65535')
  }, 20_000)
})
