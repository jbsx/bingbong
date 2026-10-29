#!/usr/bin/env node
// `pnpm jev:overlap grow <kept-overlap-dir> [kiosk-logs-dir] [--out dir] [--only name]` and
// `pnpm jev:overlap rebuild [dir]` (#489): the Overlap Jev cases. `grow`
// converts each line #489 claims from the ask its kept run recorded to the
// Appliance Card it would get now — the running Command at the line's
// arrival read from that run's events (its words, its stage, its done so
// far, the media it was opening) — written as `overlap-<case>.json` with the
// card it was built from kept beside it (`overlap`), each expecting the
// Fate the owner's row names. `rebuild` makes every Overlap case's ask
// again from what it keeps, after a change to the card's wording (T1, T2).
// Node runs this .ts directly via type stripping (#36).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) return nextResolve(specifier, context)
    try {
      return nextResolve(`${specifier}.ts`, context)
    } catch {
      return nextResolve(specifier, context)
    }
  },
})
const { withEnded, withRunning } = (await import('../src/core/command/runningCommand.ts')) as typeof import('../src/core/command/runningCommand')
const { JOINED_SLOT_INSTRUCTIONS, withPicked } = (await import('../src/core/command/applianceCard.ts')) as typeof import('../src/core/command/applianceCard')
const { companionCase } = (await import('../src/core/decision/applianceCompanion.ts')) as typeof import('../src/core/decision/applianceCompanion')
const { JEV_CORPUS_DIR } = (await import('../src/main/decision/jevCorpus.ts')) as typeof import('../src/main/decision/jevCorpus')
type RunningCommand = import('../src/core/command/runningCommand').RunningCommand
type EndedCommand = import('../src/core/command/runningCommand').EndedCommand
type DecisionQuestions = import('../src/core/ports/decisionModel').DecisionQuestions
type PickedSong = import('../src/core/command/jevReading').PickedSong
type JoinedLine = import('../src/core/command/jevReading').JoinedLine
/** A joined line's ask (#498): the pick the line it joined had made, and that line, its Slot kept beside the correction's words; no pick while its play was still being looked up (#511), the words it was opening on the line. */
type Joined = { readonly picked?: PickedSong; readonly joins: JoinedLine }

/** A claimed line (#489's table), the run that kept its ask, and the answer the owner's row names. */
interface Source {
  readonly name: string
  readonly turnId: string
  readonly expect: readonly { readonly question: string; readonly label: string; readonly atLeast?: number }[]
  /** A kept overlap:gate run: `<case>/<model dir>/p<n>`. */
  readonly run?: string
  /** A kiosk line read on the page card before the Appliance Card: its ask converted, the running line given. */
  readonly kiosk?: { readonly running: RunningCommand }
  /** The kept dir the run is in, when it is not the one given (#494: #490's narrow runs). */
  readonly from?: string
  /** The running line as the runner carries it now, when the run's own events say otherwise (#494: a line whose failure still sounds is running, #490). */
  readonly running?: RunningCommand
  /** The line just ended when the claimed one was read, nothing running (#499): the card carries it in the running line's place. */
  readonly ended?: EndedCommand
  /** The joined reading's ask, not the Fate's (#498): the pick the first half held, on the card it was read on. */
  readonly joined?: Joined
}

const MAMMOTH = 'decision-models_baseten-mammoth-27b-latest'
const fate = (label: string) => [{ question: 'fate', label }]
const SOURCES: readonly Source[] = [
  { name: '1-replace-new-goal', turnId: 'turn-mvr6e4ow-2', run: `1-replace-new-goal/${MAMMOTH}/p1`, expect: fate('ends') },
  { name: '2-correct-by-coldplay', turnId: 'turn-mvr6g44c-2', run: `2-correct-by-coldplay/${MAMMOTH}/p1`, expect: fate('joins') },
  { name: '2-correct-by-radiohead', turnId: 'turn-mvr6ijd2-2', run: `2-correct-by-radiohead/${MAMMOTH}/p1`, expect: fate('joins') },
  { name: '2-correct-the-other-one', turnId: 'turn-mvr6lcdp-2', run: `2-correct-the-other-one/${MAMMOTH}/p1`, expect: fate('joins') },
  { name: '4-skip-ahead-while-loading', turnId: 'turn-mvr6whm8-2', run: `4-skip-ahead-while-loading/${MAMMOTH}/p3`, expect: fate('waits') },
  { name: '7-is-it-working', turnId: 'turn-mvr7eee9-2', run: `7-is-it-working/${MAMMOTH}/p1`, expect: [{ question: 'action', label: 'say_doing' }] },
  { name: '7-what-are-you-doing', turnId: 'turn-mvr7gp6p-2', run: `7-what-are-you-doing/${MAMMOTH}/p1`, expect: [{ question: 'action', label: 'say_doing' }] },
  { name: '14-remark-during-task', turnId: 'turn-mvr8aguu-v2', run: `14-remark-during-task/${MAMMOTH}/p3`, expect: fate('goes_on') },
  // The two halves' words came 1039 ms apart (the kiosk perf log's endpoint-to-words spans, 623856 → 624895).
  { name: '8-kiosk-back-to-page', turnId: 'turn-mvphyqdu-vl', kiosk: { running: { words: 'Back to-', stage: 'Thinking', done: [], sinceMs: 1039 } }, expect: fate('joins') },
  // #494: the gate's split (#490's narrow runs at 4ec5948b..4d59f720), the Fate at the runner's own bar. narrow1's second half was read while
  // the first was still on the page card; narrow3's after the first had failed, its failure line still sounding, which keeps it running (#490).
  {
    name: '8-split-looking',
    turnId: 'turn-mvriovnw-v2',
    from: '/tmp/impl490/s3/narrow1',
    run: `8-split-by-pause/${MAMMOTH}/p1`,
    running: { words: 'Back to', stage: 'Looking', detail: 'at youtube.com', done: [], sinceMs: 1500 },
    expect: [{ question: 'fate', label: 'joins', atLeast: 0.7 }],
  },
  {
    name: '8-split-speaking',
    turnId: 'turn-mvrkosrw-v2',
    from: '/tmp/impl490/s3/narrow3',
    run: `8-split-by-pause/${MAMMOTH}/p1`,
    running: { words: 'Back to', stage: 'Speaking', done: [], sinceMs: 1730 },
    expect: [{ question: 'fate', label: 'joins', atLeast: 0.7 }],
  },
  // #494 on the ruled start (a page to go back to): the second half read after the first had landed its back, the line still loading.
  // Its start's own play is a line before it, so the running line is the live card's, given here.
  {
    name: '8-split-landed',
    turnId: 'turn-mvrqdupo-v2',
    from: '/tmp/impl494/f1',
    run: `8-split-by-pause/${MAMMOTH}/p1`,
    running: { words: 'Back to', stage: 'Loading', detail: 'duckduckgo.com', done: ['back (opened duckduckgo.com)'], sinceMs: 1500 },
    expect: [{ question: 'fate', label: 'joins', atLeast: 0.7 }],
  },
  // #499: the question about the wait 3.2 s after the play ended (the run of record at 6e0279eb, p3: its `done` at 1793178308958, the
  // question's Thinking at 1793178312183), read alone as none on a card that had forgotten the play. Its doing fact says its end.
  // #498: the joined reading of the run of record (6e0279eb), the second Appliance ask of each line: the first half's pick held (the page open
  // names it at p2 and p3; at p1 the correction came 825 ms into the play, as long as p2's search took to pick, so the same pick), and the
  // first half's Slot kept beside the correction's words (F2).
  ...(['p1', 'p2', 'p3'] as const).map((point, index) => ({
    name: `2-correct-the-other-one-joined-${point}`,
    turnId: ['turn-mvrvh7xx-2', 'turn-mvrvhoic-2', 'turn-mvrvin9r-2'][index]!,
    run: `2-correct-the-other-one/${MAMMOTH}/${point}`,
    joined: { picked: { title: 'Johnny Cash - Hurt', words: 'hurt', playing: false }, joins: { words: 'play hurt', slot: 'hurt' } },
    expect: [{ question: 'action', label: 'correct' }],
  })),
  {
    name: '2-correct-by-coldplay-joined',
    turnId: 'turn-mvrvdlhx-2',
    run: `2-correct-by-coldplay/${MAMMOTH}/p2`,
    joined: { picked: { title: 'Coldplay - Yellow (Official Video)', words: 'yellow', playing: false }, joins: { words: 'play yellow', slot: 'yellow' } },
    expect: [
      { question: 'action', label: 'play' },
      { question: 'slot', label: 's1-1_3-4' },
    ],
  },
  {
    name: '2-correct-by-radiohead-joined',
    turnId: 'turn-mvrvftos-2',
    run: `2-correct-by-radiohead/${MAMMOTH}/p2`,
    joined: { picked: { title: 'Let Down (Remastered)', words: 'let down', playing: false }, joins: { words: 'play let down', slot: 'let down' } },
    expect: [
      { question: 'action', label: 'play' },
      { question: 'slot', label: 's1-2_4-5' },
    ],
  },
  // #511: the joined reading made before the first half's search picked anything (its play fired, nothing on the card named the song), on
  // the audio road (the run that filed #511, 0% point) and on the pane road (#502's road-off runs, Mammoth and Elephant).
  {
    name: '2-correct-by-coldplay-joined-pending',
    turnId: 'turn-mvtgpman-2',
    from: '/tmp/502-gate/keep/audio',
    run: '2-correct-by-coldplay/jev/p1',
    joined: { joins: { words: 'play yellow', slot: 'yellow', opening: 'yellow' } },
    expect: [
      { question: 'action', label: 'play' },
      { question: 'slot', label: 's1-1_3-4' },
    ],
  },
  {
    name: '2-correct-by-coldplay-joined-pending-pane',
    turnId: 'turn-mvsbxqp1-2',
    from: '/tmp/og502/off/keep',
    run: `2-correct-by-coldplay/${MAMMOTH}/p1`,
    joined: { joins: { words: 'play yellow', slot: 'yellow', opening: 'yellow' } },
    expect: [
      { question: 'action', label: 'play' },
      { question: 'slot', label: 's1-1_3-4' },
    ],
  },
  {
    name: '2-correct-by-radiohead-joined-pending-pane',
    turnId: 'turn-mvsit9eq-2',
    from: '/tmp/og502/el-off/keep',
    run: '2-correct-by-radiohead/decision-models_baseten-elephant-9b-latest/p3',
    joined: { joins: { words: 'play let down', slot: 'let down', opening: 'let down' } },
    expect: [
      { question: 'action', label: 'play' },
      { question: 'slot', label: 's1-2_4-5' },
    ],
  },
  {
    name: '7-is-it-working-after-end',
    turnId: 'turn-mvrw2gvr-2',
    run: `7-is-it-working/${MAMMOTH}/p3`,
    ended: { words: 'play let down by radiohead', outcome: 'done', answer: 'Playing “Let Down (Remastered)”.', agoMs: 3225 },
    expect: [{ question: 'action', label: 'say_doing', atLeast: 0.7 }],
  },
]

/** A kept joined ask made with its Slot joined already (#498, F2): the Slot's instructions as the card it was built from had them. */
function withoutJoined(ask: { state: string; questions: DecisionQuestions }): { state: string; questions: DecisionQuestions } {
  const slot = ask.questions.slot
  if (slot === undefined || slot.type !== 'choice') return ask
  const instructions = slot.instructions.endsWith(JOINED_SLOT_INSTRUCTIONS) ? slot.instructions.slice(0, -JOINED_SLOT_INSTRUCTIONS.length) : slot.instructions
  return { ...ask, questions: { ...ask.questions, slot: { ...slot, instructions } } as DecisionQuestions }
}

/** A kept ask made with a line running already (#494): the card it was built from, the running lines and the Fate taken off. */
function withoutRunning(ask: { state: string; questions: DecisionQuestions }): { state: string; questions: DecisionQuestions } {
  // The running lines sit right after the words since #494 (at the foot before): only they leave, the rest of the card stays.
  const lines = ask.state.split('\n')
  const at = lines.findIndex((line) => line.startsWith("Still running, from the user's line before this one"))
  if (at === -1) return ask
  const ofRunning = (line: string) => /^(Its stage|Its done so far|It is opening): /.test(line)
  const state = [...lines.slice(0, at), ...lines.slice(at + 1).filter((line, index) => !(ofRunning(line) && lines.slice(at + 1, at + 1 + index).every(ofRunning)))].join('\n')
  const questions: Record<string, DecisionQuestions[string]> = Object.fromEntries(Object.entries(ask.questions).filter(([key]) => key !== 'fate'))
  const action = questions.action
  const options = action !== undefined && action.type === 'choice' ? Object.fromEntries(Object.entries(action.options).filter(([label]) => label !== 'say_doing')) : undefined
  return { state, questions: { ...questions, ...(action !== undefined && options !== undefined ? { action: { ...action, options } } : {}) } as DecisionQuestions }
}

interface Ask {
  readonly turnId: string
  readonly kind: string
  readonly at: number
  readonly state: string
  readonly questions: DecisionQuestions
  readonly model?: string
}
interface Timed {
  readonly t: number
  readonly event: { readonly type: string; readonly turnId?: string; readonly status?: string; readonly word?: string; readonly detail?: string; readonly text?: string; readonly action?: string; readonly name?: string; readonly args?: Record<string, unknown>; readonly task?: { readonly id: string } }
}

const asksIn = (dir: string): Ask[] =>
  readdirSync(dir)
    .filter((file) => file.startsWith('asks-') && file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Ask))

/**
 * The line running when the ask was made, as the runner's live line would
 * carry it then. Every source's Sequence Case gives one line before the
 * claimed one, so every other turn before the ask is that line's, its later
 * hops among them.
 */
function runningAt(events: readonly Timed[], at: number, own: string): RunningCommand | null {
  const ofLine = events.filter((each) => each.t <= at && each.event.turnId !== undefined && each.event.turnId !== own)
  const first = ofLine.find((each) => each.event.type === 'status' && each.event.status === 'thinking')
  if (first === undefined) return null
  const status = ofLine.filter((each) => each.event.type === 'status' && each.event.status !== 'cancelled').at(-1)!.event
  const stage = status.word ?? `${status.status!.charAt(0).toUpperCase()}${status.status!.slice(1)}`
  const detail = status.status === 'thinking' && status.word === undefined ? undefined : status.detail
  const play = ofLine.find((each) => each.event.type === 'tool_call' && each.event.name === 'play')?.event.args?.words
  const landed = new Set(ofLine.filter((each) => each.event.type === 'tool_result').map((each) => each.event.turnId))
  const done = ofLine.filter((each) => each.event.type === 'command' && landed.has(each.event.turnId)).map((each) => each.event.action!)
  // How long before the claimed line it was given: each line's first event is its Thinking at arrival.
  const given = events.find((each) => each.event.turnId === own)
  const since = given !== undefined ? { sinceMs: given.t - first.t } : {}
  return { words: first.event.detail!, stage, ...(detail !== undefined && detail !== '' ? { detail } : {}), done, ...(typeof play === 'string' ? { opening: play } : {}), ...since }
}

/** The line on the card beside the claimed one: still running (#489), just ended (#499), or joined, its pick held (#498). */
type Beside = { readonly running: RunningCommand } | { readonly ended: EndedCommand } | { readonly joined: Joined }

/** The words the ask was read on, off its first state line. */
function wordsOfState(state: string): string {
  const quoted = /: ("(?:[^"\\]|\\.)*")/.exec(state.split('\n')[0]!)?.[1]
  return quoted !== undefined ? (JSON.parse(quoted) as string) : ''
}

function askWith(base: { state: string; questions: DecisionQuestions }, beside: Beside): { state: string; questions: DecisionQuestions } {
  if ('joined' in beside) return withPicked(base.state, base.questions, beside.joined.picked, wordsOfState(base.state), beside.joined.joins)
  return 'ended' in beside ? withEnded(base.state, base.questions, beside.ended) : withRunning(base.state, base.questions, beside.running)
}

function caseOf(source: Source, base: { state: string; questions: DecisionQuestions }, beside: Beside, transcript: string, model: string | undefined, at: number): object {
  return {
    turnId: source.turnId,
    transcript,
    note:
      'joined' in beside
        ? `An Overlap case (${beside.joined.picked !== undefined ? '#498' : '#511'}): the joined reading's ask as its kept run recorded it, on the Appliance Card with the first half's ${beside.joined.picked !== undefined ? 'pick held' : 'play still being looked up'} and its Slot kept; built by \`pnpm jev:overlap\`. Expects the correction's own reading (row ${source.name.split('-')[0]}, #486).`
        : 'ended' in beside
        ? `An Overlap case (#499): the line's ask as its kept run recorded it, on the Appliance Card with the line just ended then; built by \`pnpm jev:overlap\`. Expects the doing fact, which says its end (row ${source.name.split('-')[0]}, #486).`
        : `An Overlap case (#489): the line's ask as its kept run recorded it, on the Appliance Card with the line running then; built by \`pnpm jev:overlap\`. Expects the Fate the owner's row ${source.name.split('-')[0]} names (#486).`,
    ...(model !== undefined ? { model } : {}),
    recordedAt: at,
    expect: source.expect,
    ask: askWith(base, beside),
    overlap: { ...beside, base },
  }
}

const [mode, ...rest] = process.argv.slice(2)
const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1]! : JEV_CORPUS_DIR
// `--only <name>` grows one source (#499): the kept dir of a later run holds the others' cases under other turns.
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1]! : undefined
const positional = rest.filter((arg, index) => arg !== '--out' && arg !== '--only' && rest[index - 1] !== '--out' && rest[index - 1] !== '--only')

if (mode === 'grow') {
  const [kept, kiosk] = positional
  if (kept === undefined) throw new Error('usage: pnpm jev:overlap grow <kept-overlap-dir> [kiosk-logs-dir] [--out dir] [--only name]')
  for (const source of SOURCES.filter((each) => only === undefined || each.name === only)) {
    if (source.run !== undefined) {
      const dir = source.from ?? kept
      if (!existsSync(join(dir, `${source.run}.json`))) {
        console.log(`${source.name}: no kept run in ${dir}, skipped`)
        continue
      }
      const runFile = join(dir, `${source.run}.json`)
      const asks = asksIn(join(dir, `${source.run}-logs`))
      // A joined reading's ask is the line's second Appliance ask, on the joined words (#498); else its first, the Fate's.
      const ofLine = asks.filter((each) => each.turnId === source.turnId && each.kind === 'appliance')
      const ask = source.joined !== undefined ? ofLine[1] : ofLine[0]
      if (ask === undefined) throw new Error(`${source.name}: no Appliance ask for ${source.turnId}`)
      const events = (JSON.parse(readFileSync(runFile, 'utf8')) as { run: { records: { events: Timed[] } } }).run.records.events
      const running = source.ended !== undefined || source.joined !== undefined ? null : (source.running ?? runningAt(events, ask.at, source.turnId))
      if (running === null && source.ended === undefined && source.joined === undefined) throw new Error(`${source.name}: nothing was running at ${source.turnId}`)
      const beside: Beside = source.joined !== undefined ? { joined: source.joined } : source.ended !== undefined ? { ended: source.ended } : { running: running! }
      const transcript = /: ("(?:[^"\\]|\\.)*")/.exec(ask.state.split('\n')[0]!)?.[1]
      writeFileSync(join(out, `overlap-${source.name}.json`), `${JSON.stringify(caseOf(source, withoutJoined(withoutRunning({ state: ask.state, questions: ask.questions })), beside, transcript !== undefined ? (JSON.parse(transcript) as string) : '', ask.model, ask.at), null, 2)}\n`)
    } else if (source.kiosk !== undefined) {
      if (kiosk === undefined || !existsSync(kiosk)) {
        console.log(`${source.name}: no kiosk logs given, skipped`)
        continue
      }
      const ask = asksIn(kiosk).find((each) => each.turnId === source.turnId && each.kind === 'command')
      if (ask === undefined) throw new Error(`${source.name}: no page-card ask for ${source.turnId}`)
      const companion = companionCase(source.name, { turnId: source.turnId, expect: [], ask: { state: ask.state, questions: ask.questions } })
      if (companion === null) throw new Error(`${source.name}: its ask has no Appliance companion`)
      const transcript = /: ("(?:[^"\\]|\\.)*")/.exec(ask.state.split('\n')[0]!)?.[1]
      writeFileSync(join(out, `overlap-${source.name}.json`), `${JSON.stringify(caseOf(source, companion.ask, { running: source.kiosk.running }, transcript !== undefined ? (JSON.parse(transcript) as string) : '', ask.model, ask.at), null, 2)}\n`)
    }
    console.log(`overlap-${source.name}.json`)
  }
} else if (mode === 'rebuild') {
  const dir = positional[0] ?? JEV_CORPUS_DIR
  let rebuilt = 0
  for (const file of readdirSync(dir).filter((each) => each.startsWith('overlap-') && each.endsWith('.json'))) {
    const path = join(dir, file)
    const kept = JSON.parse(readFileSync(path, 'utf8')) as { overlap?: Beside & { base: { state: string; questions: DecisionQuestions } } }
    // A case grown by another builder keeps no card to rebuild from (#508's overlap-4-resume-at-2200ms): left as it is.
    if (kept.overlap === undefined) {
      console.log(`${file}: no card kept, left as it is`)
      continue
    }
    writeFileSync(path, `${JSON.stringify({ ...kept, ask: askWith(kept.overlap.base, kept.overlap), overlap: kept.overlap }, null, 2)}\n`)
    rebuilt += 1
  }
  console.log(`${rebuilt} Overlap cases rebuilt in ${dir}`)
} else {
  throw new Error('usage: pnpm jev:overlap grow <kept-overlap-dir> [kiosk-logs-dir] [--out dir] | rebuild [dir]')
}
