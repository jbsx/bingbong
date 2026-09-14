// The Fix Ledger's loopback door (#251): the handler `scripts/live-ledger.ts`
// listens with, between the page and the reports directory. It reads every
// `audit-*.json` in one directory on each page load (`/api/ledger`), keeps
// that reading for the rows the page then asks for (`/api/row`), and serves
// the Markdown audits by name so the page can link the Tool Round timeline
// where it already lives. A browser reload re-reads; there is no watcher.
//
// It only reads. It answers GET, addressed to loopback, from its own page —
// the same Host and Origin rule the Grading Bench applies — and it serves a
// file only when the name is one an audit owns: `audit-…​.md` or `.json`,
// never a path.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { buildLedger, compareFamilies, defaultReferenceOf, type Ledger, type LedgerConditions, type LedgerFile, type LedgerRow } from './ledger.ts'

export interface FixLedgerOptions {
  readonly reportsDir: string
  readonly pageHtml: string
}

/** What `/api/ledger` answers: the families with everything the page needs to list them and to name their files. */
export interface LedgerListing {
  readonly reportsDir: string
  readonly families: readonly {
    readonly id: string
    readonly baseline: boolean
    readonly createdAt: string
    readonly passes: readonly { readonly setId: string; readonly state: string; readonly fileName: string | null; readonly markdown: string | null }[]
    readonly aggregate: { readonly fileName: string; readonly markdown: string | null } | null
    readonly defaultReference: string | null
    readonly conditions: LedgerConditions | null
    readonly notes: readonly string[]
  }[]
  readonly ignored: readonly { readonly name: string; readonly reason: string }[]
}

export interface FixLedgerServer {
  readonly handle: (request: IncomingMessage, response: ServerResponse) => void
  /** Re-reads the directory, as a page load does. */
  readonly read: () => Ledger
}

const AUDIT_FILE_NAME = /^audit-[\w.-]+\.(?:md|json)$/
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Every `audit-*.json` in the directory, by name. */
export function readLedgerFiles(reportsDir: string): LedgerFile[] {
  const names = existsSync(reportsDir) ? readdirSync(reportsDir).filter((name) => name.startsWith('audit-') && name.endsWith('.json')) : []
  return names.sort().map((name) => {
    try {
      return { name, json: JSON.parse(readFileSync(join(reportsDir, name), 'utf8')) as unknown }
    } catch (error) {
      return { name, json: null, error: String(error) }
    }
  })
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Why a request is refused, or null. The Host check refuses a DNS-rebound name; the Origin check refuses another page. */
function refusalOf(request: IncomingMessage): string | null {
  const host = request.headers.host
  if (host === undefined || !LOOPBACK_HOSTNAMES.has(hostnameOf(`http://${host}`) ?? '')) return 'the ledger answers only requests addressed to this machine’s loopback address'
  const origin = request.headers.origin
  if (origin !== undefined && !LOOPBACK_HOSTNAMES.has(hostnameOf(origin) ?? '')) return 'the ledger answers only its own page'
  return null
}

function listingOf(ledger: Ledger, reportsDir: string): LedgerListing {
  const markdownOf = (fileName: string | null): string | null => {
    if (fileName === null) return null
    const markdown = fileName.replace(/\.json$/, '.md')
    return existsSync(join(reportsDir, markdown)) ? markdown : null
  }
  return {
    reportsDir,
    families: ledger.families.map((family) => ({
      id: family.id,
      baseline: family.baseline,
      createdAt: family.createdAt,
      passes: family.passes.map((pass) => ({ setId: pass.setId, state: pass.state, fileName: pass.fileName, markdown: markdownOf(pass.fileName) })),
      aggregate: family.aggregate === null ? null : { fileName: family.aggregate.fileName, markdown: markdownOf(family.aggregate.fileName) },
      defaultReference: defaultReferenceOf(family, ledger)?.id ?? null,
      conditions: family.conditions,
      notes: family.notes,
    })),
    ignored: ledger.ignored,
  }
}

export function openFixLedger(options: FixLedgerOptions): FixLedgerServer {
  let ledger: Ledger | null = null
  const read = (): Ledger => {
    ledger = buildLedger(readLedgerFiles(options.reportsDir))
    return ledger
  }
  const current = (): Ledger => ledger ?? read()

  const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(body))
  }
  const sendText = (response: ServerResponse, status: number, text: string, type = 'text/plain'): void => {
    response.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
    response.end(text)
  }

  const rowOf = (url: URL): { status: number; body: LedgerRow | { error: string } } => {
    const subjectId = url.searchParams.get('subject')
    const referenceId = url.searchParams.get('reference')
    if (subjectId === null) return { status: 400, body: { error: 'a row needs ?subject=<family>' } }
    const known = current()
    const subject = known.families.find((family) => family.id === subjectId)
    if (subject === undefined) return { status: 404, body: { error: `no family ${subjectId} among the audits read` } }
    if (referenceId === null || referenceId === 'none') return { status: 200, body: compareFamilies(subject, referenceId === null ? defaultReferenceOf(subject, known) : null) }
    const reference = known.families.find((family) => family.id === referenceId)
    if (reference === undefined) return { status: 404, body: { error: `no family ${referenceId} among the audits read` } }
    return { status: 200, body: compareFamilies(subject, reference) }
  }

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const refusal = refusalOf(request)
    if (refusal !== null) {
      sendText(response, 403, refusal)
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      sendText(response, 200, options.pageHtml, 'text/html')
      return
    }
    if (url.pathname === '/api/ledger') {
      sendJson(response, 200, listingOf(read(), options.reportsDir))
      return
    }
    if (url.pathname === '/api/row') {
      const row = rowOf(url)
      sendJson(response, row.status, row.body)
      return
    }
    if (url.pathname.startsWith('/reports/')) {
      const name = url.pathname.slice('/reports/'.length)
      if (!AUDIT_FILE_NAME.test(name) || !existsSync(join(options.reportsDir, name))) {
        sendText(response, 404, `no audit file ${name}`)
        return
      }
      // Markdown as plain text: a browser shows it in place rather than downloading it.
      sendText(response, 200, readFileSync(join(options.reportsDir, name), 'utf8'), name.endsWith('.json') ? 'application/json' : 'text/plain')
      return
    }
    sendText(response, 404, 'not found')
  }

  return { handle, read }
}
