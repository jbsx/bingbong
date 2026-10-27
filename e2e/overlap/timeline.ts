// A run's timeline (#486): what the dashboard heard on the command stream
// (every PipelineEvent, stamped with the wall clock as it arrived) and what
// the pane showed, sampled over CDP (its URL, title, text in view and every
// <video>/<audio>). From it, the spans and moments a person could see or
// hear in line 1's life, counted from line 1's arrival: its words shown, the
// page loading, the page changed, the app speaking, the app asking, the
// media not started yet. A calibration run (line 1 alone) is read this way,
// and a named point is placed inside what it found.

import { classifyBlockerPage } from '../../src/core/browser/blockerNudge.ts'
import type { PipelineEvent } from '../../src/core/pipeline/events.ts'
import type { NamedAfter, NamedWhile } from './sequenceCase.ts'
import type { PlacedTime } from './points.ts'

export interface MediaState {
  readonly playing: boolean
  readonly src: string
  readonly position: number
  readonly volume: number
  readonly loop: boolean
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
    if (spoken !== undefined) spans.speaking = [at(speak.t), at(spoken.t)]
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
