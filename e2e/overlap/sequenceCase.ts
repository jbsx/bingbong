// The Sequence Case (#486, CONTEXT.md): one JSON file per case in
// fixtures/overlap-cases/, black-box — what is in front of the person, the
// lines with their times, optional noise, and the end state a person could
// observe. The shape is the grill's (note 4102094313 on #486); this reads it
// and refuses a file that is not in it, saying why.

import type { Road } from './audioRoad.ts'
import type { Measured } from './report.ts'

export type NamedWhile = 'loading' | 'speaking' | 'media-not-started'
export type NamedAfter = 'shown' | 'changed' | 'asked'

/** When a line arrives, counted from the first line: a fixed ms, a window sampled at seeded points, or a point a person could see or hear. */
export type LineTime = { readonly ms: number } | { readonly ms: readonly [number, number] } | { readonly while: NamedWhile } | { readonly after: NamedAfter }

/**
 * What is in front of the person before line 1 (#509): the page shown, with
 * the pages behind it (nearest first), and the song heard, wherever it plays;
 * with `asked`, a line the app has just asked a question about. The page and
 * the song are given apart, since on the audio road a song leaves the pane
 * alone. At least one is given.
 */
export interface CaseStart {
  readonly page?: { readonly url: string; readonly behind?: readonly string[] }
  readonly music?: string
  readonly asked?: string
}

export interface CaseLine {
  readonly words: string
  readonly audio?: string
  /** Absent on the first line, which is the clock's zero. */
  readonly at?: LineTime
}

export interface CaseNoise {
  readonly audio: string
  readonly at: LineTime
}

/** What the Feed shows a line came to; `none` is a line that is no Command of its own (taken into another, or unheard); `running`, one still under way when the run's bound came (a read longer than the run, #490). */
export type LineOutcome = 'done' | 'failed' | 'cancelled' | 'dropped' | 'none' | 'running'
export const LINE_OUTCOMES: readonly LineOutcome[] = ['done', 'failed', 'cancelled', 'dropped', 'none', 'running']

/** A shape: one sentence that starts and/or ends so; with `notFirstMedia`, what lies between does not name the first media the pane held from line 1 (#486, a correction's "instead."). */
export interface SaidShape {
  readonly startsWith?: string
  readonly endsWith?: string
  readonly notFirstMedia?: true
}

export type SaidExpect = { readonly is: string } | { readonly means: string } | SaidShape

export interface CaseExpect {
  readonly url?: { readonly host: string } | { readonly is: string }
  readonly view?: { readonly has: readonly string[] }
  readonly media?: {
    readonly playing?: boolean
    readonly has?: string
    readonly position?: readonly [number, number]
    /** A level, or a range of levels (`[0.8, 1]` for "louder than it started"). */
    readonly volume?: number | readonly [number, number]
    readonly loop?: boolean
  }
  readonly said?: readonly SaidExpect[]
  /** `whole`: every sentence the app began was never cut: heard to its end, or still sounding when the run ended (#490). */
  readonly speech?: 'whole'
  readonly lines?: readonly LineOutcome[]
  /** The Feed shows `lines` and nothing else, a line heard and read as no Command included (#490). */
  readonly nothingElse?: boolean
}

/** What one full gate run measured on one road: the result, the commit, the date and the models. */
export interface CaseState {
  readonly is: Measured
  readonly on: string
  readonly date: string
  readonly models: readonly string[]
}

/** A result for each road the case was run on (#509): a case is through when green on every road that can hold its start. */
export type CaseStates = Partial<Record<Road, CaseState>>

export interface SequenceCase {
  /** The file name without `.json`: `<row>-<slug>`. */
  readonly id: string
  readonly row: number
  readonly start: CaseStart
  readonly input: 'typed' | 'spoken'
  readonly listen: 'wake' | 'hotkey'
  readonly lines: readonly CaseLine[]
  readonly noise: readonly CaseNoise[]
  /** The app's own voice is heard by the microphone, as in a room (#490): spoken only. */
  readonly echo: boolean
  readonly expect: CaseExpect
  readonly evidence: readonly string[]
  readonly state: CaseStates
}

const WHILES: readonly string[] = ['loading', 'speaking', 'media-not-started']
const AFTERS: readonly string[] = ['shown', 'changed', 'asked']

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isRange = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) && value[0] <= value[1]

function readTime(raw: unknown, what: string): LineTime | string {
  if (!isObject(raw)) return `${what} needs an \`at\`: { ms }, { ms: [from, to] }, { while } or { after }`
  if ('ms' in raw) {
    if (typeof raw.ms === 'number' && raw.ms >= 0) return { ms: raw.ms }
    if (isRange(raw.ms) && raw.ms[0] >= 0) return { ms: [raw.ms[0], raw.ms[1]] }
    return `${what}: a window is [from, to] in ms, from no later than to`
  }
  if ('while' in raw) return typeof raw.while === 'string' && WHILES.includes(raw.while) ? { while: raw.while as NamedWhile } : `${what}: while is one of ${WHILES.join(', ')}`
  if ('after' in raw) return typeof raw.after === 'string' && AFTERS.includes(raw.after) ? { after: raw.after as NamedAfter } : `${what}: after is one of ${AFTERS.join(', ')}`
  return `${what}: an \`at\` is { ms }, { while } or { after }`
}

function readStart(raw: unknown): CaseStart | string {
  const shape = 'start is { page?: { url, behind?: [url, …] }, music?: song, asked?: line }, with at least one'
  if (!isObject(raw) || Object.keys(raw).some((key) => !['page', 'music', 'asked'].includes(key))) return shape
  const out: { -readonly [K in keyof CaseStart]: CaseStart[K] } = {}
  if (raw.page !== undefined) {
    const page = raw.page
    if (!isObject(page) || !isString(page.url) || !URL.canParse(page.url)) return 'start.page is { url, behind?: [url, …] }'
    if (page.behind !== undefined && (!Array.isArray(page.behind) || page.behind.length === 0 || !page.behind.every((url) => isString(url) && URL.canParse(url)))) return 'start.page.behind is the pages behind the page shown, nearest first'
    out.page = { url: page.url, ...(page.behind !== undefined ? { behind: page.behind as string[] } : {}) }
  }
  if (raw.music !== undefined) {
    if (!isString(raw.music)) return 'start.music is the song heard'
    out.music = raw.music
  }
  if (raw.asked !== undefined) {
    if (!isString(raw.asked) || out.page === undefined) return 'start.asked is the line the app asks about, on a start.page'
    out.asked = raw.asked
  }
  return Object.keys(out).length === 0 ? shape : out
}

function readExpect(raw: unknown): CaseExpect | string {
  if (!isObject(raw) || Object.keys(raw).length === 0) return 'expect names at least one thing a person could see or hear'
  const out: { -readonly [K in keyof CaseExpect]: CaseExpect[K] } = {}
  if (raw.url !== undefined) {
    if (isObject(raw.url) && isString(raw.url.host)) out.url = { host: raw.url.host }
    else if (isObject(raw.url) && isString(raw.url.is)) out.url = { is: raw.url.is }
    else return 'expect.url is { host } or { is }'
  }
  if (raw.view !== undefined) {
    if (!isObject(raw.view) || !Array.isArray(raw.view.has) || !raw.view.has.every(isString)) return 'expect.view is { has: [text, …] }'
    out.view = { has: raw.view.has as string[] }
  }
  if (raw.media !== undefined) {
    const media = raw.media
    if (!isObject(media)) return 'expect.media is an object'
    if (media.playing !== undefined && typeof media.playing !== 'boolean') return 'expect.media.playing is true or false'
    if (media.loop !== undefined && typeof media.loop !== 'boolean') return 'expect.media.loop is true or false'
    if (media.has !== undefined && !isString(media.has)) return 'expect.media.has is text'
    if (media.position !== undefined && !isRange(media.position)) return 'expect.media.position is a range [from, to] in seconds'
    if (media.volume !== undefined && typeof media.volume !== 'number' && !isRange(media.volume)) return 'expect.media.volume is a level or a range'
    out.media = media as CaseExpect['media']
  }
  if (raw.said !== undefined) {
    const shape = (said: Record<string, unknown>): boolean =>
      (isString(said.startsWith) || isString(said.endsWith)) && (said.startsWith === undefined || isString(said.startsWith)) && (said.endsWith === undefined || isString(said.endsWith)) && (said.notFirstMedia === undefined || said.notFirstMedia === true)
    if (!Array.isArray(raw.said) || !raw.said.every((said) => isObject(said) && (isString(said.is) || isString(said.means) || shape(said)))) return 'expect.said is [{ is } | { means } | { startsWith, endsWith, notFirstMedia }, …]'
    out.said = raw.said as SaidExpect[]
  }
  if (raw.speech !== undefined) {
    if (raw.speech !== 'whole') return 'expect.speech is "whole"'
    out.speech = 'whole'
  }
  if (raw.nothingElse !== undefined) {
    if (raw.nothingElse !== true || raw.lines === undefined) return 'expect.nothingElse is true, beside expect.lines'
    out.nothingElse = true
  }
  if (raw.lines !== undefined) {
    if (!Array.isArray(raw.lines) || !raw.lines.every((outcome) => LINE_OUTCOMES.includes(outcome as LineOutcome))) return `expect.lines: each outcome is one of ${LINE_OUTCOMES.join(', ')}`
    out.lines = raw.lines as LineOutcome[]
  }
  return Object.keys(out).length === 0 ? 'expect names at least one thing a person could see or hear' : out
}

const RESULTS: readonly Measured[] = ['red', 'green', 'start not met']

function readStates(raw: unknown): CaseStates | string {
  const shape = 'state is { pane?, audio? }, each { is: red | green | start not met, on: <commit>, date, models: [...] }'
  if (!isObject(raw) || Object.keys(raw).length === 0 || Object.keys(raw).some((road) => road !== 'pane' && road !== 'audio')) return shape
  const out: { -readonly [K in keyof CaseStates]: CaseStates[K] } = {}
  for (const [road, state] of Object.entries(raw)) {
    if (!isObject(state) || !RESULTS.includes(state.is as Measured) || !isString(state.on) || !isString(state.date) || !Array.isArray(state.models) || !state.models.every(isString)) return shape
    out[road as Road] = { is: state.is as Measured, on: state.on, date: state.date, models: state.models as string[] }
  }
  return out
}

/** The case in the file, or why it is not one. `file` is the file's name, `<row>-<slug>.json`. */
export function readSequenceCase(raw: unknown, file: string): SequenceCase | string {
  const id = file.replace(/\.json$/, '')
  const row = Number(id.match(/^(\d+)-/)?.[1])
  if (!Number.isInteger(row) || row < 1) return `${file}: the file name is <row>-<slug>.json`
  if (!isObject(raw)) return `${file}: not a JSON object`
  const fail = (why: string) => `${file}: ${why}`
  const start = readStart(raw.start)
  if (typeof start === 'string') return fail(start)
  if (raw.input !== 'typed' && raw.input !== 'spoken') return fail('input is typed or spoken')
  const input = raw.input
  if (raw.listen !== undefined && raw.listen !== 'wake' && raw.listen !== 'hotkey') return fail('listen is wake or hotkey')
  const listen = raw.listen === 'hotkey' ? 'hotkey' : 'wake'
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return fail('lines holds at least one line')
  const lines: CaseLine[] = []
  for (const [index, line] of raw.lines.entries()) {
    const what = `line ${index + 1}`
    if (!isObject(line) || !isString(line.words)) return fail(`${what} needs its words`)
    if (input === 'spoken' && !isString(line.audio)) return fail(`${what} is spoken and needs its audio`)
    if (index === 0) {
      lines.push({ words: line.words, ...(isString(line.audio) ? { audio: line.audio } : {}) })
      continue
    }
    const at = readTime(line.at, what)
    if (typeof at === 'string') return fail(at)
    lines.push({ words: line.words, ...(isString(line.audio) ? { audio: line.audio } : {}), at })
  }
  const noise: CaseNoise[] = []
  if (raw.noise !== undefined) {
    if (input !== 'spoken') return fail('noise is heard: only a spoken case has it')
    if (!Array.isArray(raw.noise)) return fail('noise is a list')
    for (const [index, item] of raw.noise.entries()) {
      if (!isObject(item) || !isString(item.audio)) return fail(`noise ${index + 1} needs its audio`)
      const at = readTime(item.at, `noise ${index + 1}`)
      if (typeof at === 'string') return fail(at)
      noise.push({ audio: item.audio, at })
    }
  }
  if (raw.echo !== undefined && typeof raw.echo !== 'boolean') return fail('echo is true or false')
  if (raw.echo === true && input !== 'spoken') return fail('echo is heard: only a spoken case has it')
  const expected = readExpect(raw.expect)
  if (typeof expected === 'string') return fail(expected)
  if (!Array.isArray(raw.evidence) || !raw.evidence.every(isString)) return fail('evidence is a list of ledger turns, or ["none yet"]')
  const state = readStates(raw.state)
  if (typeof state === 'string') return fail(state)
  return {
    id,
    row,
    start,
    input,
    listen,
    lines,
    noise,
    echo: raw.echo === true,
    expect: expected,
    evidence: raw.evidence as string[],
    state,
  }
}
