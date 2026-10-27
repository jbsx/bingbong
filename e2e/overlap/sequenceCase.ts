// The Sequence Case (#486, CONTEXT.md): one JSON file per case in
// fixtures/overlap-cases/, black-box — what is in front of the person, the
// lines with their times, optional noise, and the end state a person could
// observe. The shape is the grill's (note 4102094313 on #486); this reads it
// and refuses a file that is not in it, saying why.

export type NamedWhile = 'loading' | 'speaking' | 'media-not-started'
export type NamedAfter = 'shown' | 'changed' | 'asked'

/** When a line arrives, counted from the first line: a fixed ms, a window sampled at seeded points, or a point a person could see or hear. */
export type LineTime = { readonly ms: number } | { readonly ms: readonly [number, number] } | { readonly while: NamedWhile } | { readonly after: NamedAfter }

export type CaseStart = { readonly url: string } | { readonly playing: string } | { readonly asked: { readonly url: string; readonly line: string } }

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

/** What the Feed shows a line came to; `none` is a line that is no Command of its own (taken into another, or unheard). */
export type LineOutcome = 'done' | 'failed' | 'cancelled' | 'dropped' | 'none'
export const LINE_OUTCOMES: readonly LineOutcome[] = ['done', 'failed', 'cancelled', 'dropped', 'none']

export type SaidExpect = { readonly is: string } | { readonly means: string }

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
  readonly lines?: readonly LineOutcome[]
}

export interface CaseState {
  readonly is: 'red' | 'green'
  readonly on: string
  readonly date: string
  readonly models: readonly string[]
}

export interface SequenceCase {
  /** The file name without `.json`: `<row>-<slug>`. */
  readonly id: string
  readonly row: number
  readonly start: CaseStart
  readonly input: 'typed' | 'spoken'
  readonly listen: 'wake' | 'hotkey'
  readonly lines: readonly CaseLine[]
  readonly noise: readonly CaseNoise[]
  readonly expect: CaseExpect
  readonly evidence: readonly string[]
  readonly state: CaseState
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
  if (isObject(raw)) {
    if (isString(raw.url)) return { url: raw.url }
    if (isString(raw.playing)) return { playing: raw.playing }
    if (isObject(raw.asked) && isString(raw.asked.url) && isString(raw.asked.line)) return { asked: { url: raw.asked.url, line: raw.asked.line } }
  }
  return 'start is { url }, { playing } or { asked: { url, line } }'
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
    if (!Array.isArray(raw.said) || !raw.said.every((said) => isObject(said) && (isString(said.is) || isString(said.means)))) return 'expect.said is [{ is } | { means }, …]'
    out.said = raw.said as SaidExpect[]
  }
  if (raw.lines !== undefined) {
    if (!Array.isArray(raw.lines) || !raw.lines.every((outcome) => LINE_OUTCOMES.includes(outcome as LineOutcome))) return `expect.lines: each outcome is one of ${LINE_OUTCOMES.join(', ')}`
    out.lines = raw.lines as LineOutcome[]
  }
  return Object.keys(out).length === 0 ? 'expect names at least one thing a person could see or hear' : out
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
  const expected = readExpect(raw.expect)
  if (typeof expected === 'string') return fail(expected)
  if (!Array.isArray(raw.evidence) || !raw.evidence.every(isString)) return fail('evidence is a list of ledger turns, or ["none yet"]')
  const state = raw.state
  if (!isObject(state) || (state.is !== 'red' && state.is !== 'green') || !isString(state.on) || !isString(state.date) || !Array.isArray(state.models) || !state.models.every(isString)) {
    return fail('state is { is: red | green, on: <commit>, date, models: [...] }')
  }
  return {
    id,
    row,
    start,
    input,
    listen,
    lines,
    noise,
    expect: expected,
    evidence: raw.evidence as string[],
    state: { is: state.is, on: state.on, date: state.date, models: state.models as string[] },
  }
}
