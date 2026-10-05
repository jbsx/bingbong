import { describe, expect, it } from 'vitest'
import { ACQUISITION_ENDED_REASON } from '../../src/core/pipeline/effortEpoch'
import { answerNamingsIn, type AnswerTexts } from './answerNamings.ts'

const answer = (texts: Partial<AnswerTexts>): AnswerTexts => ({ speak: '', display: '', statements: [], ...texts })
const stopPhrases = (texts: Partial<AnswerTexts>): string[] => answerNamingsIn(answer(texts)).stop.map((hit) => hit.phrase)
const internalPhrases = (texts: Partial<AnswerTexts>): string[] => answerNamingsIn(answer(texts)).internal.map((hit) => hit.phrase)

// Issue #323, dated note on ADR 0038. Every sentence here is one a retained
// capture's Answer carried, read on 2026-10-05.
describe('the Answers that name the stop (#323)', () => {
  it('reads the stop and the bound in the wordings the captures hold', () => {
    const named = [
      'But I ran out of browsing budget before I could read the full catalogue entries.',
      'I ran out of time before opening the case page.',
      'I ran out of working time before I could verify the September release.',
      'I ran out of run budget before opening a June-dated official page.',
      'could not read the full details section before the budget ran out.',
      'I couldn’t open the pages before my browsing time ran out.',
      'Not completed (work ran out before I could open the case’s own page)',
      '**Not verified before the budget ran out:**',
      'could not open H4’s own record or the carrying case record before the budget closed.',
      'Not read before budget exhaustion — the page detail was not opened.',
      'was not read before the work budget was exhausted.',
      'I could not capture those quotes before the run ended.',
      'the on-page dateline itself was not directly quoted before the run closed.',
      'The case record was not opened before work stopped; side assignment not observed.',
      '**Not verified (work stopped before I could open the case record):**',
      'resolved to wrong releases or 404s before the deadline.',
      'I exhausted my working time on dead ends and archive lookups',
      'my browsing window closed before I could open and quote the two official releases',
      'the flag spelling from the official docs within this run’s budget',
      'could not verify a June 2013 publication date on an official NASA page within this run.',
    ]
    for (const sentence of named) expect(stopPhrases({ display: sentence }), sentence).not.toEqual([])
  })

  it('reads the Finalize Instruction’s own opening, should an Answer repeat it', () => {
    expect(stopPhrases({ speak: 'No further acquisition was possible, so the case page is unverified.' })).toEqual(['No further acquisition was possible'])
    expect(stopPhrases({ display: `${ACQUISITION_ENDED_REASON}.` })).toEqual(['No further acquisition is possible'])
  })

  it('leaves the same words alone where they are the user’s topic', () => {
    const ordinary = [
      'focus per shot to be the pragmatic choice, and budget several seconds per capture.',
      'Other mappings: `-t/--timeout` preview time, `-e/--encoding` (jpg/png/etc.).',
      'guitars are a named exception to the 85 centimetre London-route limit.',
      'The Voyager team needed time to analyze those observations and make sense of them.',
      'Voyager 1’s dedicated plasma instrument stopped working in 1980.',
      'when a live video window is not required',
      'The description began "probably m…" but was cut off, so its full wording is unverified.',
      'Eurostar Standard is the budget fare; no weight limit if you can carry it yourself.',
    ]
    for (const sentence of ordinary) expect(stopPhrases({ speak: sentence, display: sentence, statements: [sentence] }), sentence).toEqual([])
  })

  it('reads the Spoken Rendering, the Card and each Asked Item statement, and says where', () => {
    const namings = answerNamingsIn({
      speak: 'It holds H4 with K1, but I ran out of time to open the case’s own page.',
      display: 'I could not open the case’s own catalogue page before the run ended.',
      statements: ['about 1765', 'Case’s own catalogue page was not opened before the work budget ended.'],
    })
    expect(namings.stop.map((hit) => [hit.where, hit.phrase])).toEqual([
      ['speak', 'ran out of time'],
      ['display', 'before the run ended'],
      ['asked_item', 'work budget'],
    ])
    expect(namings.stop[1]!.excerpt).toBe('I could not open the case’s own catalogue page before the run ended.')
  })

  it('counts words two phrases both read as one naming', () => {
    // "ran out of browsing budget" is the spent thing and a budget by name.
    expect(stopPhrases({ speak: 'But I ran out of browsing budget before I could read it.' })).toEqual(['ran out of browsing budget'])
    expect(stopPhrases({ speak: 'It was not opened before the budget ran out.' })).toEqual(['budget ran out'])
  })

  it('keeps an excerpt short enough to read in a list', () => {
    const long = `${'word '.repeat(60)}before the deadline ${'word '.repeat(60)}`
    const [hit] = answerNamingsIn(answer({ display: long })).stop
    expect(hit!.phrase).toBe('deadline')
    expect(hit!.excerpt.length).toBeLessThanOrEqual(60 + 'deadline'.length + 40)
  })
})

describe('the Answers that carry internal names (#323)', () => {
  it('reads the glossary, the ids, the tools and the Answer contract’s fields', () => {
    const named = [
      'Both are retained in Session Evidence as the class-specific rows of the same table.',
      '*(Raspberry Pi camera documentation; launch announcement via subagent)*',
      'that I could not read (vision timed out; the Jina reader proxy hit a Cloudflare challenge)',
      '"Camera Module 3 is not mechanically compatible with the camera lid" (memory-6).',
      '**Asked items:** 1. Is the complete load included',
      '"resolution": "completed", "finalization_cause": "objective_met", "evidence_ids": []',
      'so treat it as unverified against an official source in this run.',
    ]
    for (const sentence of named) expect(internalPhrases({ display: sentence }), sentence).not.toEqual([])
  })

  it('is a second count beside the first, sharing no phrase with it', () => {
    const namings = answerNamingsIn(answer({ display: 'Not verified this run: the flag spelling. (memory-2, memory-4)' }))
    expect(namings.stop).toEqual([])
    expect(namings.internal.map((hit) => hit.phrase)).toEqual(['this run', 'memory-2', 'memory-4'])
  })

  it('leaves ordinary words alone', () => {
    const ordinary = [
      'this specific point is not explicitly confirmed on the page read.',
      '`rpicam-still` (libcamera) is still the tool; the tool name and stack differ.',
      'The JPL 2013 news archive (Wayback snapshot) lists the release.',
      'Camera Module 3 fits the 22-pin connector with the Zero cable.',
    ]
    for (const sentence of ordinary) expect(internalPhrases({ display: sentence }), sentence).toEqual([])
  })
})
