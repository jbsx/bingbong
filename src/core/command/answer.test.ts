import { describe, expect, it } from 'vitest'
import { NONE_SAID, commandAnswer, noResponseAnswer, noneIsALine, passageCard } from './answer'
import type { Command } from './command'

describe('commandAnswer (#333)', () => {
  const command = (verb: Command['verb'], more: Partial<Command> = {}): Command => ({ verb, target: null, slot: null, ...more })
  const lighthouse = { url: 'http://127.0.0.1:4100/interactive', title: 'Lighthouse page' }
  const answer = (of: Command, facts: Partial<Parameters<typeof commandAnswer>[1]> = {}): string | null =>
    commandAnswer(of, { page: lighthouse, ...facts })

  it('names the page a navigate opened, by its title or else its site', () => {
    expect(answer(command('navigate', { slot: 'http://127.0.0.1:4100/interactive' }))).toBe('Opened Lighthouse page.')
    expect(answer(command('navigate', { slot: 'example.com' }), { page: { url: 'https://www.example.com/', title: '' } })).toBe('Opened example.com.')
  })

  it('says what a search searched for', () => {
    expect(answer(command('search', { slot: 'lovely weather' }))).toBe('Searched the web for “lovely weather”.')
  })

  it('says which site a scoped search searched (#340)', () => {
    expect(answer(command('search', { slot: 'donald trumps profile', site: 'x.com' }))).toBe('Searched x.com for “donald trumps profile”.')
  })

  it('scrolls, clicks and types in plain words, naming the ref by its label', () => {
    expect(answer(command('scroll_down'))).toBe('Scrolled down.')
    expect(answer(command('scroll_up'))).toBe('Scrolled up.')
    expect(answer(command('scroll_down'), { scrollEnded: true })).toBe('Already at the bottom.')
    expect(answer(command('scroll_up'), { scrollEnded: true })).toBe('Already at the top.')
    expect(answer(command('click', { target: 3 }), { label: 'Say hello' })).toBe('Clicked “Say hello”.')
    expect(answer(command('click', { target: 3 }))).toBe('Clicked item 3.')
    expect(answer(command('type', { target: 2, slot: 'lisbon' }), { label: 'Search' })).toBe('Typed into “Search”.')
  })

  it('answers a Media Op (#372) with what it did, a seek with where it came to, and says when it changed nothing', () => {
    expect(answer(command('media', { target: 7, mediaOp: { op: 'forward', rung: 'words', seconds: 10 } }), { mediaChanges: '0:16 → 0:26' })).toBe('Skipped forward 10 s, to 0:26.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'back', rung: 'end', seconds: 16.2 } }), { mediaChanges: '0:16 → 0:00' })).toBe('Skipped back 16 s, to 0:00.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'pause' } }), { mediaChanges: 'paused' })).toBe('Paused.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'play' } }), { mediaChanges: 'playing' })).toBe('Playing.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'mute' } }), { mediaChanges: 'no observable change' })).toBe('Muted. Nothing changed: it was already.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'volume', to: 30 } }), { mediaChanges: 'volume 100% → 30%' })).toBe('Volume 30.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'rate', to: 1.5 } }), { mediaChanges: 'speed 1× → 1.5×' })).toBe('Speed 1.5×.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'unloop' } }), { mediaChanges: 'loop off' })).toBe('Loop off.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'captions' } }), { mediaChanges: 'captions en' })).toBe('Captions on.')
    expect(answer(command('media', { target: 7, mediaOp: { op: 'restart' } }), { mediaChanges: '0:16 → 0:00' })).toBe('Restarted.')
  })

  it('steps through history by the page it came to', () => {
    expect(answer(command('back'))).toBe('Went back to Lighthouse page.')
    expect(answer(command('forward'))).toBe('Went forward to Lighthouse page.')
    expect(answer(command('reload'))).toBe('Reloaded.')
  })

  it('names the key pressed, with its modifier and count', () => {
    expect(answer(command('press', { key: { key: 'Enter' } }))).toBe('Pressed Enter.')
    expect(answer(command('press', { key: { key: 'Tab', shift: true }, times: 3 }))).toBe('Pressed Shift+Tab 3 times.')
  })

  it('says how long a Timer was set for, and that it is off', () => {
    expect(answer(command('timer', { durationMs: 90 * 60_000 }))).toBe('Timer set for 1 hour 30 minutes.')
    expect(answer(command('timer'))).toBe('Timer off.')
  })

  it('answers a Stop, a clear and a resume', () => {
    expect(answer(command('stop'))).toBe('Stopped.')
    expect(answer(command('clear'))).toBe('Cleared the field.')
    expect(answer(command('resume'))).toBe('Back on Lighthouse page.')
    expect(answer(command('resume'), { page: { url: 'about:blank', title: '' } })).toBe('There is no page to resume yet.')
  })

  it('leaves the verbs whose Answer is a Card, and the ones that fire nothing, to themselves', () => {
    for (const verb of ['screenshot', 'help', 'none'] as const) expect(answer(command(verb))).toBeNull()
  })
})

describe('passageCard (#401, ADR 0087)', () => {
  it('is the page title over the block, the block verbatim', () => {
    expect(passageCard({ url: 'https://www.gov.uk/passport-fees', title: 'Passport fees - GOV.UK' }, 'Online: £94.50')).toBe('## Passport fees - GOV.UK\n\nOnline: £94.50')
  })

  it('names an untitled page by its host', () => {
    expect(passageCard({ url: 'https://www.gov.uk/passport-fees', title: '' }, 'Online: £94.50')).toBe('## gov.uk\n\nOnline: £94.50')
  })
})

describe('noResponseAnswer', () => {
  const jev = (action: Record<string, number>) => ({ model: 'jev', latencyMs: 1, confidence: { action: 0.9, slot: 0.9 }, probabilities: { action, slot: {} } })

  it('says what the words were read as when nothing on the page fits it, and that they are no command otherwise, with the line to say next (#370, #438)', () => {
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ 'click-9': 0.8, none: 0.2 }) })).toBe('No response.\n\nThe words read as “click 9”, but nothing on this page fits it.\n\nTry “help”.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ volume: 0.7, none: 0.3 }) })).toBe('No response.\n\nThe words read as “volume”, but nothing on this page fits it.\n\nTry “help”.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ none: 0.9 }) })).toBe("No response.\n\nThose words aren't a command.\n\nTry “help”.")
  })

  it('names the second look after a Where Ask (#379, ADR 0082): what it read or why it gave nothing', () => {
    const first = jev({ none: 0.55, 'click-13': 0.2 })
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: first, where: jev({ none: 0.9 }) })).toBe('No response.\n\nNothing on this page fits the words.\n\nTry “help”.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: first, where: jev({ 'click-9': 0.6, none: 0.4 }) })).toBe('No response.\n\nThe words read as “click 9”, but nothing on this page fits it.\n\nTry “help”.')
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: first, where: { model: 'jev', latencyMs: 800, reason: 'timeout' } })).toBe('No response.\n\nReading the words took too long.\n\nTry “help”.')
  })

  it("says why the words went unread when they could not be read at all, in the person's words", () => {
    expect(noResponseAnswer({ grammarError: null, jevAsked: false })).toBe("No response.\n\nThose words aren't a command I know.\n\nTry “help”.")
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: { model: 'jev', latencyMs: 9, reason: 'transport' } })).toBe("No response.\n\nThe words couldn't be read: there's no connection.\n\nTry “help”.")
  })

  it('never names the one that reads the words', () => {
    for (const reason of ['timeout', 'transport', 'http', 'malformed', 'cancelled', 'failed'] as const) {
      expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: { model: 'jev', latencyMs: 1, reason } })).not.toMatch(/jev|decision/i)
    }
    expect(noResponseAnswer({ grammarError: null, jevAsked: true, jev: jev({ 'click-9': 0.6 }), marked: jev({ none: 1 }) })).not.toMatch(/jev/i)
  })

  it("puts the grammar's error first", () => {
    expect(noResponseAnswer({ grammarError: 'I can scroll up or down.', jevAsked: false })).toBe('No response.\n\nI can scroll up or down.\n\nTry “help”.')
  })
})

describe('noneIsALine: a line read `none` that is said back (#500)', () => {
  const jev = (none: number) => ({ model: 'jev', latencyMs: 1, confidence: { action: none, slot: 0.9 }, probabilities: { action: { none, play: 1 - none }, slot: {} } })
  const spoken = { source: 'spoken' as const, overSpeech: false }

  it('a spoken line Jev read `none` unsure, at a speaking level, is a real line (the kiosk, 25–28 Oct)', () => {
    // "L-O-O-P." (turn-mvsihjew-v18): none 0.53 at −11.5 dBFS; "Look this song." (turn-mvp2q7gx-v2): 0.68 at −12.4.
    expect(noneIsALine({ ...spoken, jev: jev(0.53), speechLevelDb: -11.5 })).toBe(true)
    expect(noneIsALine({ ...spoken, jev: jev(0.68), speechLevelDb: -12.4 })).toBe(true)
  })

  it('a `none` Jev is sure of is not a line to the app: a remark, a filler, the TV', () => {
    // "I am away witness you." (turn-mvnsrnxo-a): 0.70 at −14.3; "Hey." (turn-mvplp2z0-v13): 0.99 at −21.5.
    expect(noneIsALine({ ...spoken, jev: jev(0.703), speechLevelDb: -14.3 })).toBe(false)
    expect(noneIsALine({ ...spoken, jev: jev(0.99), speechLevelDb: -21.5 })).toBe(false)
  })

  it('speech under the floor is far from the mic, however unsure the reading: "Cyton piece container." at −37 dBFS', () => {
    expect(noneIsALine({ ...spoken, jev: jev(0.49), speechLevelDb: -37.2 })).toBe(false)
  })

  it("a line over the app's voice, one no host read, one with no level and a typed line stay as they were", () => {
    expect(noneIsALine({ source: 'spoken', overSpeech: true, jev: jev(0.5), speechLevelDb: -12 })).toBe(false)
    expect(noneIsALine({ ...spoken, jev: { model: 'jev', latencyMs: 800, reason: 'timeout' }, speechLevelDb: -12 })).toBe(false)
    expect(noneIsALine({ ...spoken, speechLevelDb: -12 })).toBe(false)
    expect(noneIsALine({ ...spoken, jev: jev(0.5) })).toBe(false)
    expect(noneIsALine({ source: 'typed', overSpeech: false, jev: jev(0.5) })).toBe(false)
  })

  it('says one sentence: what happened and the line to say next', () => {
    expect(NONE_SAID).toBe("I didn't catch that, say it again.")
  })
})
