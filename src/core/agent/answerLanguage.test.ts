import { describe, expect, it } from 'vitest'
import voyager from './fixtures/off-language-voyager.json'
import { isOffLanguageRendering, nonLatinLetterShare, offLanguageRenderings, OFF_LANGUAGE_RETRY_MESSAGE } from './answerLanguage'

describe('nonLatinLetterShare', () => {
  it('counts letters by script and nothing else', () => {
    expect(nonLatinLetterShare('abc 日本')).toEqual({ letters: 5, nonLatin: 2, share: 0.4 })
  })

  it('does not count digits, punctuation or markdown as letters', () => {
    expect(nonLatinLetterShare('**2013** — [1](#) `_` 12:30, 100%!')).toEqual({ letters: 0, nonLatin: 0, share: 0 })
    expect(nonLatinLetterShare('## 2013年6月').letters).toBe(2)
  })

  it('reads accented Latin letters as Latin', () => {
    expect(nonLatinLetterShare('café naïve Zürich Łódź').nonLatin).toBe(0)
  })

  it('reads an empty rendering as share 0', () => {
    expect(nonLatinLetterShare('')).toEqual({ letters: 0, nonLatin: 0, share: 0 })
  })
})

describe('isOffLanguageRendering', () => {
  it('is off-language with more than half of its letters outside Latin script', () => {
    expect(isOffLanguageRendering('ab 日本語')).toBe(true)
    expect(isOffLanguageRendering('Привет, мир')).toBe(true)
  })

  it('passes at exactly half', () => {
    expect(isOffLanguageRendering('ab 日本')).toBe(false)
  })

  it('passes an empty rendering, and one with no letters', () => {
    expect(isOffLanguageRendering('')).toBe(false)
    expect(isOffLanguageRendering('   ')).toBe(false)
    expect(isOffLanguageRendering('12:30 — 100%')).toBe(false)
  })

  it('passes an English Answer quoting a few words of another script', () => {
    expect(
      isOffLanguageRendering(
        'The station is called 東京駅 (Tōkyō-eki) on the signs, and the ticket office is marked みどりの窓口. Follow the green signs from the Marunouchi exit.',
      ),
    ).toBe(false)
  })
})

describe('the fix-283-3 Voyager Answer (#286)', () => {
  it('is off-language in its Card', () => {
    expect(isOffLanguageRendering(voyager.display)).toBe(true)
    expect(nonLatinLetterShare(voyager.display).share).toBeCloseTo(0.64, 1)
  })

  it('is off-language in its Spoken Rendering', () => {
    expect(isOffLanguageRendering(voyager.speak)).toBe(true)
  })

  it('names both renderings, the Card first, each with its share', () => {
    const failed = offLanguageRenderings(voyager)
    expect(failed.map((entry) => entry.rendering)).toEqual(['card', 'spoken'])
    for (const entry of failed) expect(entry.share).toBeGreaterThan(0.5)
  })
})

describe('offLanguageRenderings', () => {
  it('judges each rendering on its own', () => {
    expect(offLanguageRenderings({ display: 'An English Card.', speak: '这是中文。' })).toEqual([{ rendering: 'spoken', share: 1 }])
    expect(offLanguageRenderings({ display: '这是中文的卡片。', speak: 'An English line.' })).toEqual([{ rendering: 'card', share: 1 }])
  })

  it('names none for an English Answer', () => {
    expect(offLanguageRenderings({ display: 'Voyager 1 crossed the heliopause on 25 August 2012.', speak: 'It crossed in August 2012.' })).toEqual([])
  })
})

describe('OFF_LANGUAGE_RETRY_MESSAGE', () => {
  it('is the sentence the issue approved', () => {
    expect(OFF_LANGUAGE_RETRY_MESSAGE).toBe(
      'Your last reply was the Answer but was not written in English. Reply with the same Answer in English: only the JSON object, "speak" and "display" in English.',
    )
  })
})
