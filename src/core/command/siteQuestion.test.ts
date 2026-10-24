import { describe, expect, it } from 'vitest'
import { exactSiteAnswer, readSiteAnswer, siteQuestionAsk } from './siteQuestion'

// A Site Question (#423): a native confirm the page raised, said aloud and
// answered by the user's next line. The exact lines settle it with no ask;
// with one open, a Dismiss Phrase refuses it.

describe('exactSiteAnswer', () => {
  it.each(['yes', 'Yes.', 'ok', 'Okay', 'confirm'])('accepts on %j', (line) => {
    expect(exactSiteAnswer(line)).toBe('accept')
  })

  it.each(['no', 'No.', 'cancel', 'close this', 'dismiss', 'go away', 'no thanks'])('refuses on %j', (line) => {
    expect(exactSiteAnswer(line)).toBe('refuse')
  })

  it.each(['yeah go ahead', 'no wait, dont', 'play some jazz', 'yes please delete it'])('leaves %j to Jev', (line) => {
    expect(exactSiteAnswer(line)).toBeNull()
  })
})

describe('the Site Question card', () => {
  const question = { kind: 'confirm' as const, text: 'Delete this video?' }

  it('carries the question, the line that raised it and the new line, and offers accept, refuse and a new Command', () => {
    const ask = siteQuestionAsk(question, 'delete it', 'yeah go ahead')
    expect(ask.state).toContain('"Delete this video?"')
    expect(ask.state).toContain('"delete it"')
    expect(ask.state).toContain('"yeah go ahead"')
    expect(Object.keys(ask.questions.answer.options)).toEqual(['accept', 'refuse', 'command'])
  })

  it('names no raising line when the page asked on its own', () => {
    expect(siteQuestionAsk(question, null, 'yes do it').state).not.toContain('while the browser')
  })
})

describe('readSiteAnswer', () => {
  const answer = (choice: string, probability: number) => ({ answer: { type: 'choice' as const, choice, confidence: probability, probabilities: { [choice]: probability } } })

  it('takes a sure answer', () => {
    expect(readSiteAnswer(answer('accept', 0.9), 0.7)).toBe('accept')
    expect(readSiteAnswer(answer('command', 0.8), 0.7)).toBe('command')
  })

  it('reads an unsure answer as none, which the fallback refuses', () => {
    expect(readSiteAnswer(answer('accept', 0.6), 0.7)).toBeNull()
  })

  it('reads a label it never offered as none', () => {
    expect(readSiteAnswer(answer('maybe', 0.99), 0.7)).toBeNull()
  })
})
