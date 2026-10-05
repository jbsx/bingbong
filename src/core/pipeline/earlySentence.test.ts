import { describe, expect, it } from 'vitest'

import { createSpokenSentenceWatch, earlySentenceOf, type EarlySentence } from './earlySentence'

// Issue #312: the Answer's spoken sentence is spoken when it closes in the
// stream, after the checks an Answer's `speak` meets at the round's end
// that can be run on the sentence alone.

/** What the watch has settled with so far, read after the microtasks drain. */
async function settled(watch: { ready: Promise<EarlySentence> }): Promise<EarlySentence | 'pending'> {
  return Promise.race([watch.ready, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0))])
}

describe('earlySentenceOf', () => {
  it('caps the sentence at two sentences, as the parse caps an Answer’s speak', () => {
    expect(earlySentenceOf('One. Two. Three.')).toEqual({ speak: 'One. Two.', spoken: 'One. Two.' })
  })

  it('voices the sentence with its Identity Slips deleted (#246) and keeps it as written for the record', () => {
    expect(earlySentenceOf('It costs $39 (memory-3).')).toEqual({ speak: 'It costs $39 (memory-3).', spoken: 'It costs $39.' })
  })

  it('refuses a sentence that fails the Off-language check (#286): it is not spoken early', () => {
    expect(earlySentenceOf('旅行者一号于2012年进入星际空间。')).toBeNull()
  })

  it('refuses a sentence with nothing to say', () => {
    expect(earlySentenceOf('  ')).toBeNull()
    expect(earlySentenceOf('(memory-3)')).toBeNull()
  })
})

describe('createSpokenSentenceWatch', () => {
  it('settles once the sentence has closed and the display key has opened', async () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('{"speak":"It is ')
    watch.onText('42.","disp')
    expect(await settled(watch)).toBe('pending')
    watch.onText('lay":"# The answer')
    expect(await settled(watch)).toEqual({ speak: 'It is 42.', spoken: 'It is 42.' })
  })

  it('reads the sentence behind a preamble', async () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('Here is the answer.\n\n{"speak":"Yes.","display":"')
    expect(await settled(watch)).toEqual({ speak: 'Yes.', spoken: 'Yes.' })
  })

  it('judges the sentence once: one that fails is never spoken early, whatever streams after it', async () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('{"speak":"旅行者一号进入星际空间。","display":"x')
    watch.onText('","speak":"Voyager 1 is in interstellar space."')
    expect(await settled(watch)).toBe('pending')
  })

  it('starts over when the client retries the attempt before the sentence closed', async () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('{"speak":"Abandoned')
    watch.restart()
    watch.onText('{"speak":"Kept.","display":"')
    expect(await settled(watch)).toEqual({ speak: 'Kept.', spoken: 'Kept.' })
    expect(watch.abandoned).toBe(false)
  })

  it('marks a sentence the retried attempt had already closed as abandoned (#271)', () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('{"speak":"Spoken.","display":"')
    watch.restart()
    expect(watch.abandoned).toBe(true)
  })

  it('keeps the Card text the attempt in flight has closed, for a round cut after its sentence was spoken', () => {
    const watch = createSpokenSentenceWatch()
    watch.onText('{"speak":"It is 42.","display":"# The ans')
    expect(watch.cardText()).toBeNull()
    watch.onText('wer is 42.","run_note":"half')
    expect(watch.cardText()).toBe('# The answer is 42.')
    // A retried attempt's text is dropped with it.
    watch.restart()
    expect(watch.cardText()).toBeNull()
  })
})
