// A run's timeline (#486): what the dashboard heard on the command stream
// (every PipelineEvent, stamped with the wall clock as it arrived) and what
// the pane showed, sampled over CDP (its URL, title, text in view and every
// <video>/<audio>). From it, the spans and moments a person could see or
// hear in line 1's life, counted from line 1's arrival: its words shown, the
// page loading, the page changed, the app speaking, the app asking, the
// media not started yet. A calibration run (line 1 alone) is read this way,
// and a named point is placed inside what it found.

import { classifyBlockerPage } from '../../src/core/browser/blockerNudge.ts'
import type { PipelineEvent, PipelineStatus } from '../../src/core/pipeline/events.ts'
import type { NamedAfter, NamedWhile } from './sequenceCase.ts'
import type { PlacedTime } from './points.ts'

export interface MediaState {
  readonly playing: boolean
  readonly src: string
  readonly position: number
  readonly volume: number
  readonly loop: boolean
  /** The song an element outside the pane plays, on the audio road (#502): its own name, where the pane's title is not it. */
  readonly title?: string
}

export interface PaneSample {
  readonly t: number
  readonly url: string
  readonly title: string
  /** The text in view, as far as the sample read it. */
  readonly text: string
  readonly media: readonly MediaState[]
}

export interface RunRecords {
  readonly events: readonly { readonly t: number; readonly event: PipelineEvent }[]
  readonly pane: readonly PaneSample[]
}

/** Ms from line 1's arrival. */
export type Spans = { -readonly [K in NamedAfter]?: number } & { -readonly [K in NamedWhile]?: readonly [number, number] }

const playingIn = (sample: PaneSample | undefined): boolean => sample?.media.some((media) => media.playing) === true

/** The pane is read this often. */
export const SAMPLE_MS = 400
/** A run has ended when nothing has happened for this long and no Command is running. */
export const QUIET_MS = 2_500
/** A pane sample this old, or a gap this long between two, is not a read of what a person saw: two reads and a second. */
const STALE_SAMPLE_MS = 2 * SAMPLE_MS + 1_000

/**
 * What a person sees has held still at `now`: the pane read lately, the
 * same page and the same media playing for the whole of QUIET_MS. A read
 * sent at `readingSince` and not yet returned holds it (#496 F3): a page
 * that answers no evaluate as a wall draws is never read as still on the
 * sample taken before it stalled, and a stretch with a stall inside it is
 * not read as held on the samples after the stall.
 */
export function paneHeldStill(pane: readonly PaneSample[], now: number, readingSince: number | null): boolean {
  if (readingSince !== null) return false
  const latest = pane[pane.length - 1]
  if (latest === undefined || now - latest.t >= STALE_SAMPLE_MS) return false
  const playingSet = (sample: PaneSample) => `${sample.url} ${sample.media.map((media) => media.playing).join(',')}`
  const first = pane.findIndex((sample) => sample.t >= now - QUIET_MS)
  const stretch = pane.slice(first)
  if (stretch.length < 2 || !stretch.every((sample) => playingSet(sample) === playingSet(latest))) return false
  // A stall inside the stretch hides when its change came (#496): the 2-correct-the-other-one run at ac0483e1 answered no
  // read for 2.35 s as YouTube's sheet drew and paused the song, and the two samples after it alone read as 2.5 s held still.
  const covered = pane.slice(Math.max(0, first - 1))
  return covered.every((sample, i) => i === 0 || sample.t - covered[i - 1]!.t < STALE_SAMPLE_MS)
}

export function spansOf(records: RunRecords, lineAt: number): Spans {
  const spans: Spans = {}
  const after = records.events.filter((record) => record.t >= lineAt)
  const at = (t: number) => t - lineAt
  const shown = after.find((record) => record.event.type === 'command')
  if (shown?.event.type === 'command') {
    spans.shown = at(shown.t)
    // Every turn of line 1's Task: its hops share the Task's id.
    const task = shown.event.task?.id ?? shown.event.turnId
    const turns = new Set(after.flatMap((record) => (record.event.type === 'command' && (record.event.task?.id ?? record.event.turnId) === task ? [record.event.turnId] : [])))
    const ofTask = after.filter((record) => 'turnId' in record.event && record.event.turnId !== undefined && turns.has(record.event.turnId))
    const loading = ofTask.findIndex((record) => record.event.type === 'status' && record.event.status === 'loading')
    if (loading !== -1) {
      const ended = ofTask.slice(loading + 1).find((record) => record.event.type === 'status' || record.event.type === 'done')
      spans.loading = [at(ofTask[loading]!.t), at(ended?.t ?? ofTask[ofTask.length - 1]!.t)]
    }
  }
  const speak = after.find((record) => record.event.type === 'speak')
  if (speak !== undefined) {
    const spoken = after.find((record) => record.event.type === 'spoken' && record.t >= speak.t)
    // A sentence still sounding when the run ended spans to its last record, as an unended loading does (#490: a read longer than the run).
    const last = Math.max(after[after.length - 1]!.t, records.pane[records.pane.length - 1]?.t ?? 0)
    spans.speaking = [at(speak.t), at(spoken?.t ?? last)]
  }
  const asked = after.find((record) => record.event.type === 'site_question')
  if (asked !== undefined) spans.asked = at(asked.t)
  const before = [...records.pane].reverse().find((sample) => sample.t < lineAt)
  const changed = records.pane.find((sample) => sample.t >= lineAt && sample.url !== before?.url)
  if (changed !== undefined) spans.changed = at(changed.t)
  if (spans.shown !== undefined) {
    // A song that never starts was not started for all of line 1's life, to the last thing that happened in it.
    const started = mediaStarted(records, lineAt)
    const end = started ?? after[after.length - 1]?.t
    if (end !== undefined) spans['media-not-started'] = [spans.shown, at(end)]
  }
  return spans
}

/** When new media began playing since line 1: on another page than the one in front at line 1, or where nothing was playing. */
function mediaStarted(records: RunRecords, lineAt: number): number | undefined {
  const before = [...records.pane].reverse().find((sample) => sample.t < lineAt)
  return records.pane.find((sample) => sample.t >= lineAt && playingIn(sample) && (sample.url !== before?.url || !playingIn(before)))?.t
}

/**
 * Where a span begins in a run still going, its end not yet known: the
 * loading stage entered, the first sentence begun, the words shown with no
 * new media playing yet. Undefined until it has begun, or once it can no
 * longer (the media already started).
 */
export function spanBegun(records: RunRecords, lineAt: number, span: NamedWhile): number | undefined {
  const spans = spansOf(records, lineAt)
  if (span === 'loading') return spans.loading?.[0] ?? loadingBegun(records, lineAt)
  if (span === 'speaking') {
    const speak = records.events.find((record) => record.t >= lineAt && record.event.type === 'speak')
    return speak === undefined ? undefined : speak.t - lineAt
  }
  return mediaStarted(records, lineAt) === undefined ? spans.shown : undefined
}

/** The loading stage entered by any turn begun since line 1, its end not yet published. */
function loadingBegun(records: RunRecords, lineAt: number): number | undefined {
  const loading = records.events.find((record) => record.t >= lineAt && record.event.type === 'status' && record.event.status === 'loading')
  return loading === undefined ? undefined : loading.t - lineAt
}

const OPEN_STAGES: ReadonlySet<PipelineStatus> = new Set(['thinking', 'acting', 'loading'])

/**
 * Whether any turn since `from` has entered a stage (thinking, acting,
 * loading) and published no `done` after it (#491). A Planner or Errand
 * step publishes nothing while it thinks, so a run that went quiet with one
 * open has not ended: its next effect is still coming. Every turn counts,
 * an Errand's next step included, whoever's line it serves; a question the
 * app asked (an alert asks nothing) closes what came before it, since it
 * then waits on the person.
 */
export function stageOpen(records: RunRecords, from: number): boolean {
  const entered = new Set<string>()
  for (const { t, event } of records.events) {
    if (t < from) continue
    if (event.type === 'status' && OPEN_STAGES.has(event.status)) entered.add(event.turnId)
    else if (event.type === 'done') entered.delete(event.turnId)
    else if (event.type === 'site_question' && event.alert !== true) entered.clear()
  }
  return entered.size > 0
}

const SAID: Record<NamedAfter | NamedWhile, string> = {
  shown: 'its words were shown',
  changed: 'the page changed',
  asked: 'the app asked',
  loading: 'the page was loading',
  speaking: 'the app was speaking',
  'media-not-started': 'the media had not started yet',
}

/** The point's ms from line 1's arrival, or why line 1's life had no such point. */
export function placeMs(placed: PlacedTime, spans: Spans): number | string {
  if (placed.kind === 'ms') return placed.ms
  if (placed.kind === 'after') return spans[placed.event] ?? `line 1 never came to a point where ${SAID[placed.event]}`
  const span = spans[placed.span]
  if (span === undefined) return `line 1 never came to a point where ${SAID[placed.span]}`
  return Math.round(span[0] + placed.fraction * (span[1] - span[0]))
}

// A challenge's own sentence the classifier's leading-text read misses: a page that asks a person to prove they are no bot, on any site.
const NOT_A_BOT_RE = /confirm (?:that )?you(?:'|’)?re not a bot/i

/**
 * The wall seen before `until` (line 2's arrival), in words, or null: a
 * page the browser's own classifier calls a Blocker (a challenge, a network
 * block, a sign-in wall), read off the pane's URL, title and text in view.
 */
export function wallBefore(pane: readonly PaneSample[], until: number): string | null {
  for (const sample of pane) {
    if (sample.t >= until) break
    const blocker = classifyBlockerPage({ url: sample.url, title: sample.title, textDigest: sample.text })
    if (blocker !== null) return `a ${blocker.signal} on ${blocker.host}`
    if (NOT_A_BOT_RE.test(sample.text)) return `a challenge on ${URL.canParse(sample.url) ? new URL(sample.url).hostname : sample.url}`
  }
  return null
}
