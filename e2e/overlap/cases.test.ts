import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSequenceCase, type SequenceCase } from './sequenceCase'
import { startSteps, type StartStep } from './start'

// The cases in fixtures/overlap-cases/ (#509): each moved to the start that
// gives the page and the song apart, and each means the start it meant
// before — the same pages opened, the same song played, the same line asked,
// in the same order. The three whose start assumed the song took the pane
// were then given their page: their start only gains steps, and their
// expect only gains checks (the issue's guard: the measure is only
// tightened).

const DIR = join(import.meta.dirname, '..', '..', 'fixtures', 'overlap-cases')

/** Each case's start as it stood at a2307806, before the move. */
type OldStart = { url: string } | { playing: string } | { url: string; playing: string } | { asked: { url: string; line: string } }
const BEFORE: Record<string, OldStart> = {
  '1-replace-new-goal': { url: 'https://duckduckgo.com/' },
  '10-move-on-while-speaking': { playing: 'let down by radiohead' },
  '10-own-voice-not-taken': { playing: 'let down by radiohead' },
  '10-stop-while-speaking': { url: 'https://en.wikipedia.org/wiki/Stop_the_Clocks' },
  '11-answer-which-one': { asked: { url: 'https://duckduckgo.com/?q=radiohead+albums', line: 'errand open the album I am thinking of' } },
  '12-scroll-while-sheet-closes': { url: 'https://www.w3schools.com/html/tryit.asp?filename=tryhtml_basic' },
  '12-search-while-page-changes': { url: 'https://duckduckgo.com/' },
  '13-loop-this-song-misheard-first': { playing: 'let down by radiohead' },
  '14-remark-during-task': { url: 'https://duckduckgo.com/' },
  '2-correct-by-coldplay': { url: 'https://duckduckgo.com/' },
  '2-correct-by-radiohead': { url: 'https://duckduckgo.com/' },
  '2-correct-the-other-one': { url: 'https://duckduckgo.com/' },
  '3-add-on-loop': { url: 'https://duckduckgo.com/' },
  '3-add-on-turn-it-down': { url: 'https://duckduckgo.com/' },
  '4-pause-while-loading': { url: 'https://duckduckgo.com/' },
  '4-resume-at-2200ms': { url: 'https://duckduckgo.com/' },
  '4-skip-ahead-while-loading': { url: 'https://duckduckgo.com/' },
  '5-independent-timer': { url: 'https://duckduckgo.com/' },
  '5-independent-volume': { playing: 'let down by radiohead' },
  '6-go-back-during-task': { url: 'https://en.wikipedia.org/wiki/Radiohead' },
  '6-never-mind-during-task': { url: 'https://duckduckgo.com/' },
  '6-stop-during-task': { url: 'https://duckduckgo.com/' },
  '7-is-it-working': { url: 'https://duckduckgo.com/' },
  '7-what-are-you-doing': { url: 'https://duckduckgo.com/' },
  '8-split-by-pause': { url: 'https://duckduckgo.com/', playing: 'iraada niyam' },
  '9-pause-said-again': { playing: 'let down by radiohead' },
}

/** Edited after the move (#509), each with its expect as it stood before: a start that gains steps, an expect that gains checks. */
const EDITED: Record<string, object> = {
  '8-split-by-pause': { lines: ['done', 'none'] },
  '10-own-voice-not-taken': { speech: 'whole', lines: ['running'], nothingElse: true },
  '10-move-on-while-speaking': { lines: ['cancelled', 'done'] },
}

/** Whether `part` holds in order inside `whole`. */
function inOrder(part: readonly StartStep[], whole: readonly StartStep[]): boolean {
  let at = 0
  for (const step of whole) if (at < part.length && JSON.stringify(step) === JSON.stringify(part[at])) at += 1
  return at === part.length
}

/** What the gate did for an old start (scripts/overlap-gate.ts setUp at a2307806): the URL, then `play`, then the asked line. */
function stepsBefore(start: OldStart): StartStep[] {
  if ('asked' in start) return [{ open: start.asked.url }, { ask: start.asked.line }]
  return [...('url' in start ? [{ open: start.url }] : []), ...('playing' in start ? [{ play: start.playing }] : [])]
}

const cases: SequenceCase[] = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const read = readSequenceCase(JSON.parse(readFileSync(join(DIR, file), 'utf8')), file)
    if (typeof read === 'string') throw new Error(read)
    return read
  })

describe('the Sequence Cases', () => {
  it('are the 26 there were, every one read', () => {
    expect(cases.map((sequence) => sequence.id).sort()).toEqual(Object.keys(BEFORE).sort())
  })

  it.each(Object.keys(BEFORE).filter((id) => !(id in EDITED)))('%s means the start it meant before', (id) => {
    const sequence = cases.find((item) => item.id === id)!
    expect(startSteps(sequence.start)).toEqual(stepsBefore(BEFORE[id]!))
  })

  it.each(Object.keys(EDITED))('%s gained its page: every step it took before, in order, and more', (id) => {
    const sequence = cases.find((item) => item.id === id)!
    const steps = startSteps(sequence.start)
    expect(inOrder(stepsBefore(BEFORE[id]!), steps)).toBe(true)
    expect(steps.length).toBeGreaterThan(stepsBefore(BEFORE[id]!).length)
  })

  it.each(Object.keys(EDITED))('%s only gained checks', (id) => {
    const sequence = cases.find((item) => item.id === id)!
    expect(sequence.expect).toMatchObject(EDITED[id]!)
    expect(Object.keys(sequence.expect).length).toBeGreaterThan(Object.keys(EDITED[id]!).length)
  })
})
