import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from './events'
import { createLastResultTracker } from './lastResult'

// The Status Capsule's last result (#436; the rule is in lastResult.ts).

const fold = (events: PipelineEvent[]): string | null => {
  const tracker = createLastResultTracker()
  for (const event of events) tracker.onEvent(event)
  return tracker.current()
}

const command = (turnId: string, hop = 0): PipelineEvent => ({ type: 'command', turnId, text: 'read', task: { id: 't1', hop }, at: 0 })
const speak = (turnId: string, text: string): PipelineEvent => ({ type: 'speak', turnId, text, at: 0 })

describe('the last result', () => {
  it('is nothing before anything is said', () => {
    expect(fold([command('t1')])).toBeNull()
  })

  it('is the sentence the Command spoke', () => {
    expect(fold([command('t1'), speak('t1', 'Volume 38 percent.')])).toBe('Volume 38 percent.')
  })

  it('keeps a page read at its first part, the words it began with', () => {
    expect(fold([command('t1'), speak('t1', 'The story begins here.'), speak('t1', 'And it goes on.')])).toBe('The story begins here.')
  })

  it('is the Task end sentence when a later hop speaks under another turn', () => {
    expect(fold([command('t1'), speak('t1', 'Opening.'), command('t2', 1), speak('t2', 'Found the forecast.')])).toBe('Found the forecast.')
  })

  it('stays through a hop past the first, which is the same Task', () => {
    expect(fold([command('t1'), speak('t1', 'Opening.'), command('t2', 1)])).toBe('Opening.')
  })

  it('goes at the next Command, which is the next input', () => {
    expect(fold([command('t1'), speak('t1', 'Done.'), command('t3')])).toBeNull()
  })

  it('is the line the page spoke for itself', () => {
    expect(fold([{ type: 'site_question', text: 'The page asks: leave the page? Say yes or no.', at: 0 }])).toBe('The page asks: leave the page? Say yes or no.')
  })
})

// The Idle Screen's Voice Prompt line (#470) keeps only a failure: the
// sentence a failed Command said, or "No response." for a line read as no
// Command, until the next input.
describe('the last failure', () => {
  const failureOf = (events: PipelineEvent[]): string | null => {
    const tracker = createLastResultTracker()
    for (const event of events) tracker.onEvent(event)
    return tracker.failure()
  }
  const dropped = (turnId: string): PipelineEvent => ({ type: 'command', turnId, text: 'what a lovely day', dropped: true, task: { id: turnId, hop: 0 }, at: 0 })

  it('is nothing after a success', () => {
    expect(failureOf([command('t1'), speak('t1', 'Volume 38 percent.')])).toBeNull()
  })

  it('is the sentence a failed Command said', () => {
    const said = 'Nothing played. Try “play jazz on youtube”.'
    expect(failureOf([command('t1'), { type: 'speak', turnId: 't1', text: said, failure: true, at: 0 }])).toBe(said)
  })

  it('is "No response." for a line read as no Command', () => {
    expect(failureOf([dropped('t1'), { type: 'display', turnId: 't1', text: 'No response.\n\nNothing on this page fits the words.', muted: true, at: 0 }])).toBe('No response.')
  })

  it('goes at the next Command', () => {
    expect(failureOf([command('t1'), { type: 'speak', turnId: 't1', text: 'Nothing played.', failure: true, at: 0 }, command('t3')])).toBeNull()
  })

  it("is never a Stop's grey Answer", () => {
    expect(failureOf([command('t1'), { type: 'display', turnId: 't1', text: 'Nothing to stop.', muted: true, at: 0 }])).toBeNull()
  })
})
