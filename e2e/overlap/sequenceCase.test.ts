import { describe, expect, it } from 'vitest'
import { readSequenceCase } from './sequenceCase'

const typed = {
  start: { url: 'https://duckduckgo.com/' },
  input: 'typed',
  lines: [{ words: 'play radiohead' }, { words: 'open the weather', at: { while: 'media-not-started' } }],
  expect: { media: { playing: false }, lines: ['cancelled', 'done'] },
  evidence: ['none yet'],
  state: { is: 'red', on: 'abc123', date: '2026-10-27', models: ['m'] },
}

describe('a Sequence Case read from its file', () => {
  it('takes the shape on the grill note, its id and row from the file name', () => {
    const read = readSequenceCase(typed, '1-replace-new-goal.json')
    expect(read).toMatchObject({ id: '1-replace-new-goal', row: 1, input: 'typed', lines: [{ words: 'play radiohead' }, { words: 'open the weather' }] })
  })

  it('a spoken case listens on the wake road unless it says hotkey', () => {
    const spoken = { ...typed, input: 'spoken', lines: [{ words: 'a', audio: 'a.wav' }, { words: 'b', audio: 'b.wav', at: { ms: 900 } }] }
    expect(readSequenceCase(spoken, '8-x.json')).toMatchObject({ listen: 'wake' })
    expect(readSequenceCase({ ...spoken, listen: 'hotkey' }, '8-x.json')).toMatchObject({ listen: 'hotkey' })
  })

  it.each([
    ['a file name with no row', typed, 'replace.json', /row/],
    ['a start of no known kind', { ...typed, start: { song: 'x' } }, '1-a.json', /start/],
    ['a later line with no time', { ...typed, lines: [{ words: 'a' }, { words: 'b' }] }, '1-a.json', /line 2.*at/],
    ['a window the wrong way round', { ...typed, lines: [{ words: 'a' }, { words: 'b', at: { ms: [900, 300] } }] }, '1-a.json', /window/],
    ['a named point no person could see', { ...typed, lines: [{ words: 'a' }, { words: 'b', at: { while: 'thinking' } }] }, '1-a.json', /while/],
    ['a spoken line with no audio', { ...typed, input: 'spoken' }, '1-a.json', /audio/],
    ['noise in a typed case', { ...typed, noise: [{ audio: 'n.wav', at: { ms: 100 } }] }, '1-a.json', /noise/],
    ['an outcome the Feed never shows', { ...typed, expect: { lines: ['superseded'] } }, '1-a.json', /outcome/],
    ['an empty expect', { ...typed, expect: {} }, '1-a.json', /expect/],
    ['a state neither red nor green', { ...typed, state: { ...typed.state, is: 'amber' } }, '1-a.json', /state/],
    ['a position that is not a range', { ...typed, expect: { media: { position: 30 } } }, '1-a.json', /position/],
  ])('refuses %s', (_name, json, file, message) => {
    const read = readSequenceCase(json, file)
    expect(typeof read).toBe('string')
    expect(read).toMatch(message)
  })
})
