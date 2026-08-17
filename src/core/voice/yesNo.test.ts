import { describe, expect, it } from 'vitest'
import { parseYesNo } from './yesNo'

// The confirmation gate's voice half: a spoken answer inside the 12 s window
// must resolve the prompt. Whisper transcripts carry punctuation, casing and
// filler, so matching is on normalized words.

describe('parseYesNo', () => {
  it.each([
    ['yes', 'yes'],
    ['Yes.', 'yes'],
    ['  YEAH  ', 'yes'],
    ['yep', 'yes'],
    ['yup!', 'yes'],
    ['sure', 'yes'],
    ['okay', 'yes'],
    ['ok', 'yes'],
    ['confirm', 'yes'],
    ['approve', 'yes'],
    ['go ahead', 'yes'],
    ['do it', 'yes'],
    ['affirmative', 'yes'],
    ['um, yeah sure', 'yes'],
    ['no', 'no'],
    ['Nope.', 'no'],
    ['nah', 'no'],
    ['stop', 'no'],
    ['cancel', 'no'],
    ["don't", 'no'],
    ['deny', 'no'],
    ['negative', 'no'],
    ['uh, nope', 'no'],
  ])('maps %j to %s', (transcript, expected) => {
    expect(parseYesNo(transcript)).toBe(expected)
  })

  it.each(['maybe', 'hello', "what's the weather", '', 'bananas'])(
    'returns null for undecided %j',
    (transcript) => {
      expect(parseYesNo(transcript)).toBeNull()
    },
  )

  it('takes the first decision word when both slip out', () => {
    // "no, yes" — the first word is the answer. (A leading "no" denying is
    // also the safe read for the risk gate.)
    expect(parseYesNo('no yes')).toBe('no')
    expect(parseYesNo('yes... no, wait')).toBe('yes')
    expect(parseYesNo('yeah-no')).toBe('yes')
  })
})
