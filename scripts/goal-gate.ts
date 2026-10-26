#!/usr/bin/env node
// `pnpm goal:gate` (#465, ADR 0095): the goal corpus (fixtures/goal-cases/)
// run live under the CLI harness and scored. Each case gets a fresh app —
// the built app with `--browser-cli`, launched the way the e2e harness
// launches it (e2e/electronApp.ts: X11 under the xvfb-run the pnpm script
// wraps this in, muted, never on the real display) — opens its `start`
// page from the fixed table below, takes the `transcript` as a typed line
// and is given until the Task ends (the line's prompt comes back) or 90 s.
// What the run left — the final URL and the text in view, every sentence
// said, the page's questions, the Shelf, the clipboard, how the Task ended
// — goes to one fixed judge (GLM-5.3-flash through the Planner's chat
// adapter, thinking off; `--judge` pins another), which answers done, miss
// or wall with one line why. The gate never acts on the world: every
// confirm is declined (BINGBONG_CONFIRM_ANSWER=no, read only under the
// harness), the Shelf is the run's own folder, no account is signed in.
// No fixture page under e2e/ is a YouTube watch page, a shop or a recipe,
// so every start is a real page at a fixed URL (one fixed watch URL, never
// a search). Node runs this .ts directly via type stripping (#36).
//
// Usage:
//   pnpm goal:gate [--repeat N] [--models id,id] [--judge id] [--cases substr,substr] [--keep dir]
//
// --models names the Planner model(s) under test as jev:gate takes them,
// one table each; accepted now, the Planner joins the run in #467. The
// Decision Model and the Planner's key come from the env (the root .env).
// --keep writes each run as the judge saw it, and its verdict, to the dir.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CdpClient } from '../e2e/cdpClient.ts'
import { launchApp, pickFreeDebugPort, type LaunchedApp } from '../e2e/electronApp.ts'
import { resolveDecisionRouting } from '../src/core/decision/decisionRouting.ts'
import { formatGoalGate, GOAL_RUN_BOUND_S, goalJudgeMessages, readGoalCase, readGoalVerdict, type GoalCase, type GoalRow, type GoalRun, type GoalRunScore } from '../src/core/planner/goalCase.ts'
import { createPlannerLimiter } from '../src/core/planner/limiter.ts'
import { PLANNER_GATE_MODEL, resolvePlannerRouting } from '../src/core/planner/plannerRouting.ts'
import type { ChatClient } from '../src/main/planner/chatCompletion.ts'
import { plannerChatClient } from '../src/main/planner/createPlannerModel.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const CASES_DIR = join(REPO, 'fixtures', 'goal-cases')
const PROMPT = 'bingbong> '
/** One watch page for every YouTube case: a channel with a Wikipedia article, comments open and a caption track. */
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const ARTICLE_URL = 'https://en.wikipedia.org/wiki/Alan_Turing'

/** Each case's `start`, as the page to open and the lines that set it up. */
const STARTS: Readonly<Record<string, { readonly url: string; readonly then?: readonly string[] }>> = {
  'a YouTube watch page': { url: WATCH_URL },
  'a YouTube watch page with a caption track': { url: WATCH_URL },
  'a product page (a shoe on a shop site)': { url: 'https://www.allbirds.com/products/mens-tree-runners' },
  'any page': { url: 'https://duckduckgo.com/' },
  'a page with a chart and a caption (a Wikipedia article or a news graphic)': { url: 'https://en.wikipedia.org/wiki/Moore%27s_law' },
  'a recipe page (bbcgoodfood)': { url: 'https://www.bbcgoodfood.com/recipes/easy-pancakes' },
  'a page with a fresh screenshot on the Shelf': { url: ARTICLE_URL, then: ['screenshot'] },
  'an article page': { url: ARTICLE_URL },
}

/** A setup line or the boot is given this long; a landing this long to settle before the Goal Line. */
const SETUP_BOUND_MS = 60_000
const SETTLE_MS = 2_000
/** The judge reads this much of the text in view. */
const TEXT_IN_VIEW_CHARS = 6_000

const args = process.argv.slice(2)
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}
const list = (raw: string | undefined): string[] => (raw ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '')
const repeat = Number(valueOf('--repeat') ?? '1')
if (!Number.isInteger(repeat) || repeat < 1) {
  console.error(`--repeat needs a whole number of runs, got ${valueOf('--repeat')}`)
  process.exit(2)
}
const models = list(valueOf('--models'))
const judgeId = valueOf('--judge') ?? PLANNER_GATE_MODEL
const only = list(valueOf('--cases'))
const keep = valueOf('--keep')
if (keep !== undefined) mkdirSync(keep, { recursive: true })

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function readCases(): GoalCase[] | string {
  const cases: GoalCase[] = []
  for (const file of readdirSync(CASES_DIR).filter((name) => name.endsWith('.json')).sort()) {
    const read = readGoalCase(JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')))
    if (typeof read === 'string') return `${file}: ${read}`
    if (STARTS[read.start] === undefined) return `${file}: no start page in the table for "${read.start}"`
    if (only.length === 0 || only.some((part) => read.id.includes(part))) cases.push(read)
  }
  return cases
}

const promptsIn = (app: LaunchedApp): number => app.stdoutRaw().split(PROMPT).length - 1

/** Waits until the harness has printed `count` prompts — the boot's, then one per line it finished; false at the bound. */
async function waitForPrompts(app: LaunchedApp, count: number, boundMs: number): Promise<boolean> {
  const until = Date.now() + boundMs
  while (promptsIn(app) < count) {
    if (Date.now() > until) return false
    await sleep(100)
  }
  return true
}

interface TargetInfo {
  readonly targetId: string
  readonly type: string
  readonly url: string
}

async function evaluateIn<T>(cdp: CdpClient, targetId: string, expression: string): Promise<T | undefined> {
  const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
  try {
    const response = await cdp.send<{ result?: { value?: T } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    return response.result?.value
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {})
  }
}

async function targets(cdp: CdpClient): Promise<TargetInfo[]> {
  return (await cdp.send<{ targetInfos: TargetInfo[] }>('Target.getTargets')).targetInfos
}

/** The app boots to the Idle Screen: a keydown wakes the dashboard, as any real input does (the e2e harness's way). */
async function wakeDashboard(cdp: CdpClient): Promise<void> {
  const until = Date.now() + SETUP_BOUND_MS
  while (Date.now() < until) {
    const dashboard = (await targets(cdp)).find((target) => target.url.includes('out/renderer/index.html'))
    if (dashboard !== undefined) {
      const awake = await evaluateIn<boolean>(cdp, dashboard.targetId, `(window.dispatchEvent(new KeyboardEvent('keydown')), !!document.querySelector('.url-input'))`).catch(() => false)
      if (awake === true) return
    }
    await sleep(250)
  }
}

/** The text a person looking at the pane sees: every visible text node inside the viewport. */
const TEXT_IN_VIEW = `(() => {
  const out = []
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent.replace(/\\s+/g, ' ').trim()
    const element = node.parentElement
    if (text === '' || element === null) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue
    out.push(text)
  }
  return { title: document.title, text: out.join(' ') }
})()`

async function readPane(cdp: CdpClient): Promise<{ url: string; title: string; text: string }> {
  const pane = (await targets(cdp)).find((target) => target.type === 'page' && !target.url.includes('out/renderer') && !target.url.startsWith('devtools://'))
  if (pane === undefined) return { url: '(no pane)', title: '', text: '' }
  const read = await evaluateIn<{ title: string; text: string }>(cdp, pane.targetId, TEXT_IN_VIEW).catch(() => undefined)
  return { url: pane.url, title: read?.title ?? '', text: (read?.text ?? '').slice(0, TEXT_IN_VIEW_CHARS) }
}

/** The decision records of the line's Task (`cli-<n>-…`), and how it ended: the last of them that carries an ending. */
function taskRecords(logsDir: string, lineNumber: number): { ended: string | null; records: unknown[] } {
  const records: unknown[] = []
  if (!existsSync(logsDir)) return { ended: null, records }
  let ended: string | null = null
  for (const file of readdirSync(logsDir).filter((name) => /^decision-.*\.jsonl$/.test(name)).sort()) {
    for (const line of readFileSync(join(logsDir, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue
      let record: { type?: string; turnId?: string; task?: { id?: string }; ended?: string }
      try {
        record = JSON.parse(line) as typeof record
      } catch {
        continue
      }
      const turn = record.task?.id ?? record.turnId ?? ''
      if (record.type !== 'decision' || !turn.startsWith(`cli-${lineNumber}-`)) continue
      records.push(record)
      if (typeof record.ended === 'string') ended = record.ended
    }
  }
  return { ended, records }
}

/** What the run left on the X clipboard of the Xvfb it ran on. */
function clipboard(): string | null {
  const read = spawnSync('xclip', ['-o', '-selection', 'clipboard'], { encoding: 'utf8', timeout: 2000 })
  return read.status === 0 ? read.stdout.slice(0, 2000) : null
}

/** Every `said: "…"` and `page asks: …` line the harness printed after `from`. */
function heard(output: string): { said: string[]; asked: string[] } {
  const said: string[] = []
  const asked: string[] = []
  for (const raw of output.split('\n')) {
    const line = raw.startsWith(PROMPT) ? raw.slice(PROMPT.length) : raw
    if (line.startsWith('said: ')) {
      try {
        said.push(JSON.parse(line.slice('said: '.length)) as string)
      } catch {
        said.push(line.slice('said: '.length))
      }
    } else if (line.startsWith('page asks: ')) asked.push(line.slice('page asks: '.length))
  }
  return { said, asked }
}

async function runCase(goal: GoalCase, plannerModel: string | undefined): Promise<{ run: GoalRun; records: unknown[] }> {
  const profile = mkdtempSync(join(tmpdir(), 'bingbong-goal-gate-'))
  const shelf = join(profile, 'shelf')
  const start = STARTS[goal.start]!
  const app = await launchApp({
    // The binary itself, not the node_modules/.bin shim (the e2e harness's reason).
    electronBinary: createRequire(import.meta.url)('electron') as string,
    entry: 'out/main/index.js',
    cwd: REPO,
    debugPort: await pickFreeDebugPort(),
    userDataDir: profile,
    args: ['--browser-cli'],
    pipeStdio: true,
    startupTimeoutMs: SETUP_BOUND_MS,
    env: {
      BINGBONG_CONFIRM_ANSWER: 'no',
      BINGBONG_DOWNLOADS_DIR: shelf,
      // The run's env is this script's own, the root .env included: the app reads no file of its own.
      BINGBONG_ENV_FILE: join(profile, 'no-env-file'),
      BINGBONG_WAKE_ENGINE: 'off',
      // No log copying, no News Desk fetch, no brief writer: a run asks only what its line asks.
      BINGBONG_LOG_MACHINE: '',
      BINGBONG_NEWS_FIXTURE: 'http://127.0.0.1:9',
      BINGBONG_NEWS_WRITER_API_KEY_ENV: 'BINGBONG_GOAL_GATE_NO_NEWS_KEY',
      PULSE_SERVER: 'unix:/nonexistent',
      ...(plannerModel !== undefined ? { BINGBONG_PLANNER_MODEL: plannerModel } : {}),
    },
  })
  try {
    await wakeDashboard(app.cdp)
    if (!(await waitForPrompts(app, 1, SETUP_BOUND_MS))) throw new Error('the CLI harness never prompted')
    let lines = 0
    for (const setup of [`navigate ${start.url}`, ...(start.then ?? [])]) {
      app.stdin!.write(`${setup}\n`)
      lines += 1
      if (!(await waitForPrompts(app, lines + 1, SETUP_BOUND_MS))) throw new Error(`the setup line "${setup}" never finished`)
    }
    await sleep(SETTLE_MS)
    const from = app.stdoutRaw().length
    const sentAt = performance.now()
    app.stdin!.write(`${goal.transcript}\n`)
    lines += 1
    const finished = await waitForPrompts(app, lines + 1, GOAL_RUN_BOUND_S * 1000)
    const seconds = (performance.now() - sentAt) / 1000
    const { said, asked } = heard(app.stdoutRaw().slice(from))
    const pane = await readPane(app.cdp)
    const task = taskRecords(join(profile, 'logs'), lines)
    const run: GoalRun = {
      transcript: goal.transcript,
      meant: goal.meant,
      start: goal.start,
      url: pane.url,
      title: pane.title,
      textInView: pane.text,
      said,
      asked,
      declined: asked.length > 0,
      shelf: existsSync(shelf) ? readdirSync(shelf).sort() : [],
      clipboard: clipboard(),
      ended: task.ended,
      seconds: finished ? seconds : GOAL_RUN_BOUND_S,
      timedOut: !finished,
    }
    return { run, records: task.records }
  } finally {
    await app.quit().catch(() => {})
    // The app may still be letting go of its profile as it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}

/** The judge's verdict on one run; a host hiccup is asked once more, an unreadable reply is a miss unjudged. */
async function judge(chat: ChatClient, run: GoalRun): Promise<GoalRunScore> {
  const { system, user } = goalJudgeMessages(run)
  const ask = () =>
    chat.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // The judge must read the same run the same way every time.
      { temperature: 0 },
    )
  const first = await ask()
  const reply = first.status === 'answered' ? first : await ask()
  const base = { seconds: run.seconds, ended: run.timedOut ? 'bound' : run.ended }
  if (reply.status === 'unavailable') return { ...base, verdict: null, why: `judge unavailable: ${reply.reason}` }
  const verdict = readGoalVerdict(reply.content)
  return verdict === null ? { ...base, verdict: null, why: `judge unreadable: ${reply.content.replace(/\s+/g, ' ').slice(0, 80)}` } : { ...base, ...verdict }
}

const cases = readCases()
if (typeof cases === 'string') {
  console.error(`goal:gate: ${cases}`)
  process.exit(2)
}
if (!existsSync(join(REPO, 'out', 'main', 'index.js'))) {
  console.error('goal:gate runs the built app: pnpm build first (pnpm goal:gate does)')
  process.exit(2)
}
const judgeRouting = resolvePlannerRouting({ ...process.env, BINGBONG_PLANNER_MODEL: judgeId, BINGBONG_PLANNER_THINKING: 'off' })
if (!judgeRouting.configured) {
  console.error(`goal:gate cannot reach its judge ${judgeId} — ${judgeRouting.reason}`)
  process.exit(2)
}
const judgeChat = plannerChatClient(judgeRouting, createPlannerLimiter({ perSecond: judgeRouting.perSecond, inFlight: judgeRouting.inFlight }))
const decision = resolveDecisionRouting(process.env)
const decisionName = decision.configured ? decision.endpoint.model : `no Decision Model (${decision.reason})`

let allDone = true
for (const model of models.length === 0 ? [undefined] : models) {
  const rows: GoalRow[] = []
  for (const goal of cases) {
    const runs: GoalRunScore[] = []
    for (let n = 1; n <= repeat; n++) {
      let score: GoalRunScore
      try {
        const { run, records } = await runCase(goal, model)
        score = await judge(judgeChat, run)
        if (keep !== undefined) writeFileSync(join(keep, `${goal.id}${model === undefined ? '' : `-${model}`}-${n}.json`), `${JSON.stringify({ run, score, records }, null, 2)}\n`)
      } catch (error) {
        score = { verdict: null, why: `run failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, seconds: 0, ended: null }
      }
      console.error(`${goal.id} ${n}/${repeat}: ${score.verdict ?? 'unjudged'} in ${score.seconds.toFixed(1)}s (${score.ended ?? '—'}) — ${score.why}`)
      runs.push(score)
    }
    if (runs.some((run) => run.verdict !== 'done')) allDone = false
    rows.push({ id: goal.id, runs })
  }
  const arm = model === undefined ? `Task loop under ${decisionName}, no Planner yet` : `Planner ${model}, Task loop under ${decisionName}`
  console.log(formatGoalGate(rows, { arm, judge: judgeChat.model }))
}
process.exitCode = allDone ? 0 : 1
