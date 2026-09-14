import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectCdp, type CdpClient } from '../cdpClient.ts'
import { openFixLedger } from './ledgerServer.ts'

// The Fix Ledger page (#251) in a real headless Chrome over the DevTools
// protocol, over the committed Round Audits — the acceptance criteria name
// their families and numbers. The server suite proves the JSON; this proves
// what the evaluator sees: the families in capture order with their default
// Reference, one delta cell with the numbers the aggregate audits print and
// the colour its direction gives it, one marker naming its axis, the
// drill-down for one Hunt, and a Reference chosen on the page.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url))
const PAGE = fileURLToPath(new URL('../../scripts/live-ledger.html', import.meta.url))
const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
  (path): path is string => typeof path === 'string' && path !== '' && existsSync(path),
)
const canDrive = CHROME !== undefined && typeof WebSocket === 'function'
const STEP_TIMEOUT_MS = 30_000

interface EvaluateResult {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
}

async function until<T>(probe: () => T | Promise<T>, what: string, timeoutMs = 10_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let value: T | undefined
    try {
      value = await probe()
    } catch {
      // A page mid-navigation has no context to evaluate in yet.
      value = undefined
    }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const created = createServer(handler)
    created.listen(0, '127.0.0.1', () => {
      const address = created.address()
      resolve({ server: created, port: typeof address === 'object' && address !== null ? address.port : 0 })
    })
  })
}

describe.skipIf(!canDrive)('the Fix Ledger page in a browser', () => {
  let profile: string
  let server: Server
  let base: string
  let chrome: ChildProcess
  let cdp: CdpClient

  async function evaluate<T>(expression: string): Promise<T> {
    const reply = await cdp.send<EvaluateResult>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const details = reply.exceptionDetails
    if (details) throw new Error(details.exception?.description ?? details.text)
    return reply.result?.value as T
  }

  const waitFor = (expression: string, what: string) => until(() => evaluate<boolean>(expression), what)
  const text = (selector: string) => evaluate<string | null>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)

  beforeAll(async () => {
    const ledger = openFixLedger({ reportsDir: REPORTS_DIR, pageHtml: readFileSync(PAGE, 'utf8') })
    const listening = await listen(ledger.handle)
    server = listening.server
    base = `http://127.0.0.1:${listening.port}/`

    profile = mkdtempSync(join(tmpdir(), 'bingbong-ledger-chrome-'))
    chrome = spawn(
      CHROME!,
      ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,900', 'about:blank'],
      { stdio: 'ignore' },
    )
    // Port 0 lets Chrome pick; it writes the one it took into the profile.
    const portFile = join(profile, 'DevToolsActivePort')
    const devtoolsPort = await until(() => (existsSync(portFile) ? readFileSync(portFile, 'utf8').split('\n')[0] : ''), 'Chrome to open its debugging port', 20_000)
    const target = await until(async () => {
      const targets = (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
      return targets.find((listed) => listed.type === 'page')
    }, 'a page target')
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
  }, 60_000)

  afterAll(async () => {
    cdp?.close()
    // Chrome still holds its profile until it has exited.
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve))
      chrome.kill()
      await exited
    }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    if (profile) rmSync(profile, { recursive: true, force: true })
  })

  it('lists the families in capture order, each on its default Reference', async () => {
    await cdp.send('Page.navigate', { url: base })
    await waitFor(`document.body.dataset.loaded === 'true'`, 'every row to be read')

    const families = await evaluate<Array<{ id: string; reference: string; baseline: boolean; select: string }>>(`[...document.querySelectorAll('section.family[data-family]')].map((section) => ({
      id: section.dataset.family,
      reference: section.dataset.reference,
      baseline: !!section.querySelector('.tag'),
      select: section.querySelector('select').value,
    }))`)
    const named = ['baseline', 'fix-236', 'fix-235', 'fix-237', 'fix-239', 'fix-240', 'fix-242', 'fix-242r', 'baseline2']
    expect(families.map((family) => family.id).filter((id) => named.includes(id))).toEqual(named)
    const byId = Object.fromEntries(families.map((family) => [family.id, family]))
    expect(byId.baseline).toEqual({ id: 'baseline', reference: 'none', baseline: true, select: 'none' })
    expect(byId.baseline2).toEqual({ id: 'baseline2', reference: 'baseline', baseline: true, select: 'baseline' })
    expect(byId['fix-240']).toEqual({ id: 'fix-240', reference: 'baseline', baseline: false, select: 'baseline' })
    expect(await text('#status')).toContain('reload to re-read')
    // A measurement_failed Pass is named as such beside the family.
    expect(await text('[data-family="fix-237"] .pass-state.failed')).toBe('fix-237-1 (failed)')
  }, STEP_TIMEOUT_MS)

  it('shows fix-240 against baseline: Off-key 80 of 252 against 55 of 225, the delta in points, coloured by its direction', async () => {
    const row = '[data-family="fix-240"] table.headline tr[data-metric="off_key"]'
    const cells = await evaluate<{ reference: string; subject: string; delta: string; deltaClass: string; referencePasses: string; subjectPasses: string; markers: number }>(`(() => {
      const row = document.querySelector(${JSON.stringify(row)})
      const cell = (side) => row.querySelector('td[data-population=initial][data-side=' + side + ']')
      return {
        reference: cell('reference').querySelector('.agg').textContent,
        subject: cell('subject').querySelector('.agg').textContent,
        delta: cell('delta').textContent,
        deltaClass: cell('delta').className,
        referencePasses: cell('reference').querySelector('.passes').textContent,
        subjectPasses: cell('subject').querySelector('.passes').textContent,
        markers: row.querySelectorAll('.marker').length,
      }
    })()`)
    expect(cells).toEqual({
      reference: '55 / 225 · 24%',
      subject: '80 / 252 · 32%',
      delta: '+7.3 pts',
      deltaClass: 'num delta bad',
      referencePasses: '26 · 12 · 17',
      subjectPasses: '22 · 42 · 16',
      markers: 0,
    })

    const omitted = await evaluate<{ subject: string; reference: string; delta: string }>(`(() => {
      const row = document.querySelector('[data-family="fix-240"] table.headline tr[data-metric="answer_omitted_primary"]')
      const cell = (side) => row.querySelector('td[data-population=initial][data-side=' + side + ']')
      return { reference: cell('reference').querySelector('.agg').textContent, subject: cell('subject').querySelector('.agg').textContent, delta: cell('delta').textContent }
    })()`)
    expect(omitted).toEqual({ reference: '5 of 12', subject: '7 of 12', delta: '+2' })

    // A metric that moved the right way is green: rounds_wasted 6 → 5.
    expect(await evaluate(`document.querySelector('[data-family="fix-240"] tr[data-metric="rounds_wasted_primary"] td[data-population=initial][data-side=delta]').className`)).toBe('num delta ok')
    // The follow-up population sits beside the initial one.
    expect(await text('[data-family="fix-240"] tr[data-metric="off_key"] td[data-population=followUp][data-side=subject] .agg')).toBe('8 / 48 · 17%')
    // The Markdown audit is linked, not re-rendered.
    expect(await evaluate(`document.querySelector('[data-family="fix-240"] a[href="/reports/audit-aggregate-fix-240.md"]')?.textContent`)).toBe('aggregate audit')
  }, STEP_TIMEOUT_MS)

  it('marks baseline2 on every metric for the sub-spans flag, and fix-239 on the judgement metrics only', async () => {
    expect(await text('[data-family="baseline2"] .markers-line')).toBe('△ Judged under different conditions: browser sub-spans off → on (every metric).')
    const subspans = await evaluate<Array<{ metric: string; marker: string | null }>>(`[...document.querySelectorAll('[data-family="baseline2"] table.headline tr[data-metric]')].map((row) => ({ metric: row.dataset.metric, marker: row.querySelector('.marker')?.textContent ?? null }))`)
    expect(subspans).toHaveLength(8)
    expect(subspans.every((entry) => entry.marker === '△ browser sub-spans')).toBe(true)
    expect(await evaluate(`document.querySelector('[data-family="baseline2"] tr[data-metric="verified"] .marker').title`)).toBe('judged under different conditions — browser sub-spans: off → on')

    const p1 = await evaluate<Array<{ metric: string; marker: string | null }>>(`[...document.querySelectorAll('[data-family="fix-239"] table.headline tr[data-metric]')].map((row) => ({ metric: row.dataset.metric, marker: row.querySelector('.marker')?.textContent ?? null }))`)
    expect(p1.filter((entry) => entry.marker !== null).map((entry) => entry.metric)).toEqual(['rounds_wasted_primary', 'answer_omitted_primary', 'off_key'])
    expect(p1.find((entry) => entry.metric === 'off_key')?.marker).toBe('△ reviewer prompt')
    expect(await evaluate(`document.querySelector('[data-family="fix-240"] .markers-line').hidden`)).toBe(true)
  }, STEP_TIMEOUT_MS)

  it('drills fix-240 down to one Hunt across the Passes of both sets', async () => {
    await evaluate(`document.querySelector('[data-family="fix-240"] details.drill').open = true`)
    const camera = await evaluate<{ checks: { reference: string; subject: string }; verified: { reference: string; subject: string }; rows: number }>(`(() => {
      const row = document.querySelector('[data-family="fix-240"] table.drill tr[data-hunt="compatibility-pi-camera"][data-step="initial"]')
      const cell = (metric) => ({ reference: row.querySelector('td[data-metric=' + metric + '] .ref').textContent, subject: row.querySelector('td[data-metric=' + metric + '] .subj').textContent })
      return { checks: cell('checks'), verified: cell('verified'), rows: document.querySelectorAll('[data-family="fix-240"] table.drill tbody tr').length }
    })()`)
    expect(camera.checks).toEqual({ reference: '9/10 · 9/10 · 8/10', subject: '9/10 · 9/10 · 9/10' })
    expect(camera.verified).toEqual({ reference: 'no · no · no', subject: 'no · no · no' })
    expect(camera.rows).toBeGreaterThanOrEqual(6)
    // The all-counters expander holds a raw delta with no colour.
    await evaluate(`document.querySelector('[data-family="fix-240"] details.counters').open = true`)
    const loops = await evaluate<{ cells: string[]; classes: string[] }>(`(() => {
      const row = document.querySelector('[data-family="fix-240"] table.counters tr[data-counter="Search Loop rounds"]')
      const cells = [...row.querySelectorAll('td')].slice(1, 4)
      return { cells: cells.map((cell) => cell.textContent), classes: cells.map((cell) => cell.className) }
    })()`)
    expect(loops).toEqual({ cells: ['11', '25', '+14'], classes: ['num', 'num', 'num'] })
  }, STEP_TIMEOUT_MS)

  it('re-reads a row against the Reference chosen on the page', async () => {
    await evaluate(`(() => { const select = document.querySelector('[data-family="fix-240"] select'); select.value = 'baseline2'; select.dispatchEvent(new Event('change')) })()`)
    await waitFor(`document.querySelector('[data-family="fix-240"]').dataset.reference === 'baseline2'`, 'the row to be re-read')
    expect(await text('[data-family="fix-240"] .markers-line')).toBe('△ Judged under different conditions: browser sub-spans on → off (every metric).')
    expect(await text('[data-family="fix-240"] tr[data-metric="off_key"] td[data-population=initial][data-side=reference] .agg')).not.toBe('55 / 225 · 24%')

    await evaluate(`(() => { const select = document.querySelector('[data-family="fix-240"] select'); select.value = 'none'; select.dispatchEvent(new Event('change')) })()`)
    await waitFor(`document.querySelector('[data-family="fix-240"]').dataset.reference === 'none'`, 'the row to stand alone')
    expect(await text('[data-family="fix-240"] tr[data-metric="off_key"] td[data-population=initial][data-side=delta]')).toBe('—')
  }, STEP_TIMEOUT_MS)

  it('never says comparison, dashboard or candidate in its own copy', () => {
    // #251, Decision 10 — the page's words; a tool name in the data (record_candidate) is the audit's, not the page's.
    expect(readFileSync(PAGE, 'utf8')).not.toMatch(/comparison|dashboard|candidate/i)
  })
})
