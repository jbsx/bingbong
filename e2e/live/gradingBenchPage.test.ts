import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseLiveGrades, type LiveGradingInputs } from './grades.ts'
import { REVIEWED_AT, keys, manifest, reviewerBGrades, writeFixtureSet } from './gradingBenchFixtures.ts'
import { openGradingSetup } from './gradingBenchServer.ts'

// The Grading Bench's two pages (#232), driven in a real headless Chrome over
// the DevTools protocol, against the same invented fixture set the server
// suite uses — never a pilot. The server suite proves the JSON; this proves
// what a reviewer sees: setup lists the sets and Start lands on the bench, the
// bench opens on the Answer, the three tabs switch, a judged check lands in the
// drafts sidecar, a blank slot shows work left rather than errors, a refused
// save shows the validator's words, and the other Grade appears only after a
// save, disagreements first. The tests run in the order a reviewer works, and
// later ones read what earlier ones did.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed.

const PAGE = fileURLToPath(new URL('../../scripts/live-review.html', import.meta.url))
const SETUP_PAGE = fileURLToPath(new URL('../../scripts/live-review-setup.html', import.meta.url))
const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
  (path): path is string => typeof path === 'string' && path !== '' && existsSync(path),
)
const canDrive = CHROME !== undefined && typeof WebSocket === 'function'
const STEP_TIMEOUT_MS = 30_000

interface CdpReply {
  readonly id?: number
  readonly result?: {
    readonly result?: { readonly value?: unknown }
    readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
  }
  readonly error?: { readonly message: string }
}

interface Cdp {
  readonly send: (method: string, params?: Record<string, unknown>) => Promise<CdpReply>
  readonly close: () => void
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

async function connect(url: string): Promise<Cdp> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('the DevTools socket did not open')))
  })
  let next = 0
  const waiting = new Map<number, (reply: CdpReply) => void>()
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data)) as CdpReply
    if (reply.id === undefined) return
    waiting.get(reply.id)?.(reply)
    waiting.delete(reply.id)
  })
  return {
    send: (method, params = {}) =>
      new Promise((resolve) => {
        next += 1
        waiting.set(next, resolve)
        socket.send(JSON.stringify({ id: next, method, params }))
      }),
    close: () => socket.close(),
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

describe.skipIf(!canDrive)('the Grading Bench pages in a browser', () => {
  let root: string
  let profile: string
  let privateRoot: string
  let inputs: LiveGradingInputs
  let server: Server
  let base: string
  let chrome: ChildProcess
  let cdp: Cdp

  async function evaluate<T>(expression: string): Promise<T> {
    const reply = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (reply.error) throw new Error(reply.error.message)
    const details = reply.result?.exceptionDetails
    if (details) throw new Error(details.exception?.description ?? details.text)
    return reply.result?.result?.value as T
  }

  const waitFor = (expression: string, what: string) => until(() => evaluate<boolean>(expression), what)
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bingbong-grading-page-'))
    const artifactsRoot = join(root, 'artifacts')
    privateRoot = join(root, 'private')
    mkdirSync(artifactsRoot)
    mkdirSync(privateRoot)
    inputs = writeFixtureSet(artifactsRoot, 'set-1.json')
    writeFileSync(join(artifactsRoot, 'rehearsal.json'), JSON.stringify({ ...inputs.set, setId: 'rehearsal', mode: 'verification' }))
    writeFileSync(join(privateRoot, 'set-1-grades-reviewer-b.json'), `${JSON.stringify(reviewerBGrades(inputs), null, 2)}\n`)

    const setup = openGradingSetup({
      artifactsRoot,
      privateRoot,
      manifest,
      keyFor: (huntId) => keys[huntId],
      defaultReviewer: 'reviewer-a',
      setupHtml: readFileSync(SETUP_PAGE, 'utf8'),
      benchHtml: readFileSync(PAGE, 'utf8'),
      now: () => new Date(REVIEWED_AT),
    })
    const listening = await listen(setup.handle)
    server = listening.server
    base = `http://127.0.0.1:${listening.port}/`

    profile = mkdtempSync(join(tmpdir(), 'bingbong-grading-chrome-'))
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
      return targets.find((candidate) => candidate.type === 'page')
    }, 'a page target')
    cdp = await connect(target.webSocketDebuggerUrl)
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
    for (const directory of [root, profile]) if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('lists the sets on setup, proposes the one to grade, and Start lands on the bench', async () => {
    await cdp.send('Page.navigate', { url: base })
    await waitFor(`document.readyState === 'complete' && !document.getElementById('start').disabled`, 'Start to be enabled')

    const setup = await evaluate<{
      sets: Array<{ value: string; checked: boolean; disabled: boolean }>
      files: string | null
      caution: string | null
      comparison: string | null
      key: string
    }>(`(() => ({
      sets: [...document.querySelectorAll('#sets input[name=set]')].map((input) => ({ value: input.value, checked: input.checked, disabled: input.disabled })),
      files: document.querySelector('#sets .set-files')?.textContent ?? null,
      caution: document.getElementById('caution').hidden ? null : document.getElementById('caution').textContent,
      comparison: document.querySelector('#comparisons input:checked')?.value ?? null,
      key: document.getElementById('key-line').textContent,
    }))()`)
    expect(setup.sets).toContainEqual({ value: 'set-1.json', checked: true, disabled: false })
    expect(setup.sets).toContainEqual({ value: 'rehearsal.json', checked: false, disabled: true })
    expect(setup.files).toContain('set-1-grades-reviewer-a.json')
    expect(setup.caution).toBe('no work by “reviewer-a” yet; names with work here: reviewer-b')
    expect(setup.comparison).toBe('set-1-grades-reviewer-b.json')
    expect(setup.key).toContain('k1')

    await click('#start')
    await waitFor(`!!document.querySelector('[role=tab]')`, 'the bench to open on a slot')
    const head = await evaluate(`({ set: document.getElementById('set-id').textContent, position: document.getElementById('slot-position').textContent, hash: location.hash })`)
    expect(head).toEqual({ set: 'set-1', position: 'slot 1 of 3', hash: '#a1' })
    expect(await evaluate(`[...document.querySelectorAll('.hunt-name')].map((node) => node.textContent)`)).toEqual(['hunt-a', 'hunt-b'])
    expect(await evaluate(`document.getElementById('progress').textContent`)).toBe('0 of 2 saved · 1 not reached')
  }, STEP_TIMEOUT_MS)

  it('opens on the Answer tab, and the three tabs switch', async () => {
    const shown = () => evaluate<{ tab: string; text: string; toggleHidden: boolean }>(`(() => ({
      tab: document.querySelector('[role=tab][aria-selected=true]').dataset.tab,
      text: document.querySelector('[role=tabpanel]:not([hidden])').textContent,
      toggleHidden: document.querySelector('.view-toggle').hidden,
    }))()`)

    const answer = await shown()
    expect(answer.tab).toBe('answer')
    expect(answer.text).toContain('The widget code is W-1.')
    expect(answer.toggleHidden).toBe(false)

    expect(await evaluate(`document.querySelector('[role=tab][data-tab=read]').textContent`)).toBe('What it read · 1')
    await click('[role=tab][data-tab=read]')
    const read = await shown()
    expect(read.tab).toBe('read')
    expect(read.text).toContain('spec.invalid/a')
    expect(read.text).toContain('code W-1')
    expect(read.toggleHidden).toBe(true)

    await click('[role=tab][data-tab=key]')
    const key = await shown()
    expect(key.tab).toBe('key')
    expect(key.text).toContain('https://spec.invalid/a')
    expect(key.text).toContain('the invented spec hedges on the revision')
    // The required facts and pitfalls are the checks; the Key tab does not repeat them.
    expect(key.text).not.toContain('the superseded fixture cable')
    expect(key.text).not.toContain('Required facts')

    await click('[role=tab][data-tab=answer]')
    expect((await shown()).tab).toBe('answer')
  }, STEP_TIMEOUT_MS)

  it('shows a blank slot the work left before a save, not an error', async () => {
    const bar = await evaluate(`({
      line: document.getElementById('to-save-line').textContent,
      errorsHidden: document.getElementById('save-errors').hidden,
      saveDisabled: document.getElementById('save').disabled,
      checklistHidden: document.getElementById('to-save').hidden,
    })`)
    expect(bar).toEqual({ line: 'left: verdict · 0 of 2 checks · rationale', errorsHidden: true, saveDisabled: true, checklistHidden: true })
    // An optional part left out must leave nothing behind — Element.append writes a null as "null".
    expect(await evaluate<string>(`document.querySelector('.grade-pane').textContent`)).not.toMatch(/\b(null|undefined)\b/)

    await click('#to-save-toggle')
    expect(await evaluate(`[...document.querySelectorAll('#to-save li')].map((item) => item.textContent)`)).toEqual([
      '○choose a verdict',
      '○judge every check (0 of 2)',
      '○write a rationale',
    ])
  }, STEP_TIMEOUT_MS)

  it('writes a judged check into the drafts sidecar', async () => {
    await click('li.check[data-check=c1] button[data-satisfied=true]')
    await waitFor(`document.getElementById('to-save-line').textContent === 'left: verdict · 1 of 2 checks · rationale'`, 'the draft to be written')
    const drafts = JSON.parse(readFileSync(join(privateRoot, 'set-1-grades-reviewer-a.drafts.json'), 'utf8'))
    expect(drafts.drafts.a1.state.checks.c1.satisfied).toBe(true)
    expect(await evaluate(`document.querySelector('li.check[data-check=c1] button[data-satisfied=true]').getAttribute('aria-pressed')`)).toBe('true')
    expect(await evaluate(`[...document.querySelectorAll('#to-save li')].map((item) => item.className)`)).toEqual(['todo', 'todo', 'todo'])
  }, STEP_TIMEOUT_MS)

  it('shows the validator’s own words when a save is refused, and writes nothing', async () => {
    // The Save button stays disabled while work is left, so the refusal is asked for directly.
    await evaluate('save()')
    await waitFor(`!document.getElementById('save-errors').hidden`, 'the refusal to be shown')
    const errors = await evaluate<string[]>(`[...document.querySelectorAll('#save-errors li')].map((item) => item.textContent)`)
    expect(errors).toContain('grade for a1: choose a status — the bench never picks one')
    expect(existsSync(join(privateRoot, 'set-1-grades-reviewer-a.json'))).toBe(false)
  }, STEP_TIMEOUT_MS)

  it('shows the other Grade only once this reviewer’s own is saved, with the disagreements first', async () => {
    expect(await evaluate(`!!document.getElementById('comparison')`)).toBe(false)

    // reviewer-b graded a1 useful partial with c2 unsatisfied; this Grade says c2 is satisfied.
    await click('input[name=verdict][value=useful_partial]')
    await click('li.check[data-check=c2] button[data-satisfied=true]')
    await evaluate(`(() => { const box = document.getElementById('rationale'); box.value = 'the code is right'; box.dispatchEvent(new Event('input')) })()`)
    await waitFor(`!document.getElementById('save').disabled`, 'Save to be enabled')
    expect(await evaluate(`document.getElementById('to-save-line').textContent`)).toBe('ready to save')

    await click('#save')
    await waitFor(`!!document.getElementById('comparison')`, 'the comparison to appear')
    const comparison = await evaluate<{ visible: string; agreementsHidden: boolean }>(`(() => {
      const panel = document.getElementById('comparison').cloneNode(true)
      const agreements = document.querySelector('#comparison .agreements')
      panel.querySelector('.agreements').remove()
      return { visible: panel.textContent, agreementsHidden: agreements.hidden }
    })()`)
    expect(comparison.visible).toContain('Compared with reviewer-b')
    expect(comparison.visible).toContain('c2')
    expect(comparison.visible).toContain('The Answer avoids: the superseded fixture cable')
    expect(comparison.visible).not.toContain('names the invented widget code')
    expect(comparison.agreementsHidden).toBe(true)

    await click('#show-agreements')
    expect(await evaluate(`document.querySelector('#comparison .agreements').textContent`)).toContain('names the invented widget code')

    const written = JSON.parse(readFileSync(join(privateRoot, 'set-1-grades-reviewer-a.json'), 'utf8'))
    expect(parseLiveGrades(written, inputs).ok).toBe(true)
  }, STEP_TIMEOUT_MS)
})
