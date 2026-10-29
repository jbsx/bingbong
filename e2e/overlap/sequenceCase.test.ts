import { describe, expect, it } from 'vitest'
import { readSequenceCase } from './sequenceCase'

const typed = {
  start: { page: { url: 'https://duckduckgo.com/' } },
  input: 'typed',
  lines: [{ words: 'play radiohead' }, { words: 'open the weather', at: { while: 'media-not-started' } }],
  expect: { media: { playing: false }, lines: ['cancelled', 'done'] },
  evidence: ['none yet'],
  state: { pane: { is: 'red', on: 'abc123', date: '2026-10-27', models: ['m'] } },
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

  it('a spoken case may hear the app\'s own voice, and expect its speech whole (#490)', () => {
    const spoken = { ...typed, input: 'spoken', echo: true, lines: [{ words: 'a', audio: 'a.wav' }], expect: { speech: 'whole', lines: ['done'] } }
    expect(readSequenceCase(spoken, '10-x.json')).toMatchObject({ echo: true, expect: { speech: 'whole' } })
    expect(readSequenceCase(typed, '1-x.json')).toMatchObject({ echo: false })
  })

  it('a start gives the page shown, the pages behind it and the song heard apart (#509)', () => {
    const start = { page: { url: 'https://en.wikipedia.org/wiki/Radiohead', behind: ['https://duckduckgo.com/'] }, music: 'iraada niyam' }
    expect(readSequenceCase({ ...typed, start }, '8-x.json')).toMatchObject({ start })
    expect(readSequenceCase({ ...typed, start: { music: 'let down' } }, '9-x.json')).toMatchObject({ start: { music: 'let down' } })
    expect(readSequenceCase({ ...typed, start: { page: { url: 'https://duckduckgo.com/' }, asked: 'errand open it' } }, '11-x.json')).toMatchObject({ start: { asked: 'errand open it' } })
  })

  it('records a result for each road it was run on, a start not met among them (#509)', () => {
    const state = { pane: { is: 'start not met', on: 'abc', date: '2026-10-29', models: ['jev'] }, audio: { is: 'green', on: 'abc', date: '2026-10-29', models: ['jev'] } }
    expect(readSequenceCase({ ...typed, state }, '8-x.json')).toMatchObject({ state })
  })

  it.each([
    ['a file name with no row', typed, 'replace.json', /row/],
    ['a start of no known kind', { ...typed, start: { song: 'x' } }, '1-a.json', /start/],
    ['a start in the old shape', { ...typed, start: { url: 'https://duckduckgo.com/', playing: 'x' } }, '1-a.json', /start/],
    ['an empty start', { ...typed, start: {} }, '1-a.json', /at least one/],
    ['a page with no address', { ...typed, start: { page: { url: 'duckduckgo' } } }, '1-a.json', /start.page/],
    ['pages behind that are not a list of addresses', { ...typed, start: { page: { url: 'https://b.example/', behind: 'https://a.example/' } } }, '1-a.json', /behind/],
    ['a line asked with no page', { ...typed, start: { asked: 'errand open it' } }, '1-a.json', /asked/],
    ['a later line with no time', { ...typed, lines: [{ words: 'a' }, { words: 'b' }] }, '1-a.json', /line 2.*at/],
    ['a window the wrong way round', { ...typed, lines: [{ words: 'a' }, { words: 'b', at: { ms: [900, 300] } }] }, '1-a.json', /window/],
    ['a named point no person could see', { ...typed, lines: [{ words: 'a' }, { words: 'b', at: { while: 'thinking' } }] }, '1-a.json', /while/],
    ['a spoken line with no audio', { ...typed, input: 'spoken' }, '1-a.json', /audio/],
    ['an echo in a typed case', { ...typed, echo: true }, '1-a.json', /echo/],
    ['a speech expect other than whole', { ...typed, expect: { speech: 'cut' } }, '1-a.json', /speech/],
    ['noise in a typed case', { ...typed, noise: [{ audio: 'n.wav', at: { ms: 100 } }] }, '1-a.json', /noise/],
    ['an outcome the Feed never shows', { ...typed, expect: { lines: ['superseded'] } }, '1-a.json', /outcome/],
    ['an empty expect', { ...typed, expect: {} }, '1-a.json', /expect/],
    ['a state neither red nor green', { ...typed, state: { pane: { ...typed.state.pane, is: 'amber' } } }, '1-a.json', /state/],
    ['a state with no road', { ...typed, state: typed.state.pane }, '1-a.json', /state/],
    ['a state on a road that is not one', { ...typed, state: { kitchen: typed.state.pane } }, '1-a.json', /state/],
    ['a state on no road at all', { ...typed, state: {} }, '1-a.json', /state/],
    ['a position that is not a range', { ...typed, expect: { media: { position: 30 } } }, '1-a.json', /position/],
  ])('refuses %s', (_name, json, file, message) => {
    const read = readSequenceCase(json, file)
    expect(typeof read).toBe('string')
    expect(read).toMatch(message)
  })
})
