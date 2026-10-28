// A Sequence Case's `expect` checked against the end state a run left
// (#486): the pane's URL, title and text in view, every <video>/<audio>,
// every sentence said, and what the Feed shows each line came to. Every
// check is exact but a sentence's meaning, which goes to the judge. The
// answer is the first check that failed, in words, or null.

import type { CaseExpect, LineOutcome } from './sequenceCase.ts'
import type { MediaState, RunRecords } from './timeline.ts'

export interface EndState {
  readonly url: string
  readonly title: string
  readonly text: string
  readonly media: readonly MediaState[]
  readonly said: readonly string[]
  /** Each sentence the app began: how long it sounded (its start to its end, null when it never ended) and how long it is whole (#490). */
  readonly speech?: readonly { readonly text: string; readonly ms: number | null; readonly wholeMs: number }[]
  /** One per Command the Feed shows after line 1, in order; `running` when it had not ended. */
  readonly lines: readonly LineOutcome[]
}

/** Whether any of the sentences said means `means`. */
export type MeaningJudge = (means: string, said: readonly string[]) => Promise<boolean>

/** A sentence heard for this share of its whole length was heard to its end. */
const WHOLE_SHARE = 0.9

const hostOf = (url: string): string => (URL.canParse(url) ? new URL(url).hostname : url)
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()
const range = (value: readonly [number, number], unit = ''): string => `${value[0]}–${value[1]}${unit}`

/** The media a person would call "the" media: the one playing, else the first that has a source. */
function theMedia(media: readonly MediaState[]): MediaState | undefined {
  return media.find((item) => item.playing) ?? media.find((item) => item.src !== '') ?? media[0]
}

export async function checkEnd(expected: CaseExpect, end: EndState, judge: MeaningJudge): Promise<string | null> {
  if (expected.url !== undefined) {
    if ('host' in expected.url) {
      const host = hostOf(end.url)
      if (host !== expected.url.host && !host.endsWith(`.${expected.url.host}`)) return `the page is on ${host}, not ${expected.url.host}`
    } else if (end.url !== expected.url.is) return `the page is ${end.url}, not ${expected.url.is}`
  }
  for (const text of expected.view?.has ?? []) {
    if (!squash(end.text).toLowerCase().includes(squash(text).toLowerCase())) return `"${text}" is not in view`
  }
  if (expected.media !== undefined) {
    const wanted = expected.media
    const media = theMedia(end.media)
    const playing = end.media.some((item) => item.playing)
    if (wanted.playing === true && !playing) return 'nothing is playing'
    if (wanted.playing === false && playing) return 'media is playing'
    const needsMedia = wanted.has !== undefined || wanted.position !== undefined || wanted.volume !== undefined || wanted.loop !== undefined
    if (needsMedia && media === undefined) return 'there is no media on the page'
    if (media !== undefined) {
      if (wanted.has !== undefined && !`${end.title} ${media.src}`.toLowerCase().includes(wanted.has.toLowerCase())) return `the media is not "${wanted.has}" (${end.title})`
      if (wanted.position !== undefined && (media.position < wanted.position[0] || media.position > wanted.position[1])) return `the media is at ${Math.round(media.position)} s, not ${range(wanted.position, ' s')}`
      if (wanted.volume !== undefined) {
        const [low, high] = typeof wanted.volume === 'number' ? [wanted.volume - 0.01, wanted.volume + 0.01] : wanted.volume
        if (media.volume < low || media.volume > high) return `the volume is ${Math.round(media.volume * 100) / 100}, not ${typeof wanted.volume === 'number' ? wanted.volume : range(wanted.volume)}`
      }
      if (wanted.loop !== undefined && media.loop !== wanted.loop) return wanted.loop ? 'the media is not on loop' : 'the media is on loop'
    }
  }
  // Each sentence in order, an exact one after the one before it; a meaning, among all said.
  let from = 0
  let last = ''
  for (const said of expected.said ?? []) {
    if ('is' in said) {
      const found = end.said.findIndex((sentence, index) => index >= from && sentence.trim() === said.is.trim())
      if (found === -1) return last === '' ? `nothing said was "${said.is}"` : `nothing said was "${said.is}" after "${last}"`
      from = found + 1
      last = said.is
    } else if (!(await judge(said.means, end.said))) return `nothing said meant "${said.means}"`
  }
  if (expected.speech === 'whole') {
    // A sentence cut is one that ended sooner than it takes whole; the slack is a duck's restart, never a lost clause.
    // `spoken` marks every end, a stop's too, so one with no end is still sounding when the run ended: never cut.
    const cut = (end.speech ?? []).find((sentence) => sentence.ms !== null && sentence.ms < WHOLE_SHARE * sentence.wholeMs)
    if (cut !== undefined) return `"${cut.text.slice(0, 60)}" was cut (${Math.round(cut.ms! / 100) / 10} s of ${Math.round(cut.wholeMs / 100) / 10} s)`
  }
  if (expected.lines !== undefined) {
    const wanted = expected.lines.filter((outcome) => outcome !== 'none')
    // Talk heard and read as no Command (a remark, noise) shows dropped and did nothing: by order it cannot be told from a line,
    // so it counts only in a case that expects a line dropped, or one that says nothing else shows.
    const shown = wanted.includes('dropped') || expected.nothingElse === true ? end.lines : end.lines.filter((outcome) => outcome !== 'dropped')
    if (wanted.length !== shown.length || wanted.some((outcome, index) => outcome !== shown[index])) {
      return `the lines came to ${end.lines.length === 0 ? 'no Command' : end.lines.join(', ')}, not ${wanted.join(', ')}`
    }
  }
  return null
}

/** What the Feed shows each Command begun at or after `from` came to: one per Task, in order, its last ending. */
export function lineOutcomes(records: RunRecords, from: number): LineOutcome[] {
  const tasks: { id: string; dropped: boolean; turns: Set<string> }[] = []
  const later = records.events.filter((record) => record.t >= from)
  for (const { event } of later) {
    if (event.type !== 'command') continue
    const id = event.task?.id ?? event.turnId
    const task = tasks.find((item) => item.id === id)
    // A Task is a line's only from its first hop: a later hop of one begun before (the start's Errand going on) is not.
    if (task === undefined && (event.task?.hop ?? 0) === 0) tasks.push({ id, dropped: event.dropped === true, turns: new Set([event.turnId]) })
    else task?.turns.add(event.turnId)
  }
  return tasks.map((task) => {
    if (task.dropped) return 'dropped'
    const ends = later.filter((record) => record.event.type === 'done' && task.turns.has(record.event.turnId))
    const last = ends[ends.length - 1]?.event
    // The last hop begun must have ended: a Task whose next hop is still running has not.
    const lastTurn = [...task.turns].pop()!
    if (last?.type !== 'done' || !ends.some((record) => record.event.type === 'done' && record.event.turnId === lastTurn)) return 'running'
    return last.outcome ?? 'done'
  })
}

/** Every sentence the app said from `from` on. */
export function saidFrom(records: RunRecords, from: number): string[] {
  return records.events.flatMap((record) => (record.t >= from && record.event.type === 'speak' ? [record.event.text] : []))
}
