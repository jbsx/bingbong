import { describe, expect, it } from 'vitest'
import type { Command } from './command'
import { SPOKEN_FAILURES, failureLineOf, notHereLine } from './spokenFailure'
import { nextLine, withNextLine } from './tryLine'

// A failure names a line that would have worked (#438, principles 9 and
// 10): a fallback wording per failure and Command kind, in code — never a
// judgement, never another ask.

const command = (verb: Command['verb'], slot: string | null = null): Command => ({ verb, target: null, slot })

describe('nextLine', () => {
  it('a wall in the way is closed: a cookie notice by its accept, any other pop-up by Escape', () => {
    expect(nextLine(SPOKEN_FAILURES.consent)).toBe('click accept')
    expect(nextLine(SPOKEN_FAILURES.popup)).toBe('press escape')
    expect(nextLine(SPOKEN_FAILURES.blocked)).toBe('press escape')
    // Escape is a rung the Dismissal Ladder already tried on a pop-up that stayed.
    expect(nextLine(SPOKEN_FAILURES.dialogStayed)).toBe('back')
  })

  it('a page that is no use is left; no page at all is the last one reopened', () => {
    for (const failure of ['blocker', 'notFound', 'unavailable', 'empty'] as const) expect(nextLine(SPOKEN_FAILURES[failure])).toBe('back')
    expect(nextLine(SPOKEN_FAILURES.noPage)).toBe('resume')
    expect(nextLine(SPOKEN_FAILURES.noBack)).toBe('resume')
  })

  it('an address that would not open is searched for instead', () => {
    expect(nextLine("That address can't be opened.", command('navigate', 'http://127.0.0.1:1/nothing'))).toBe('search 127.0.0.1')
    expect(nextLine(failureLineOf('navigate', 'net::ERR_NAME_NOT_RESOLVED'), command('navigate', 'https://www.fixturely.test/x'))).toBe('search fixturely.test')
  })

  it('an item the page lacks, or a Task not sure it is done, reads the page', () => {
    expect(nextLine(failureLineOf('click', 'ref 999 refused'), command('click'))).toBe('read')
    expect(nextLine(SPOKEN_FAILURES.unsure)).toBe('read')
  })

  it('what was not found here is searched for on the web', () => {
    expect(nextLine(notHereLine('the opening hours'), undefined, 'the opening hours')).toBe('search the opening hours')
  })

  it('a song that would not play is the next result', () => {
    expect(nextLine("“x” can't be played.", command('play', 'x'))).toBe('not that one')
  })

  it('names nothing when no line would do better', () => {
    expect(nextLine(SPOKEN_FAILURES.noShelfFile)).toBeNull()
  })
})

describe('withNextLine', () => {
  it('shows the line under the failure, and says it after it', () => {
    expect(withNextLine(SPOKEN_FAILURES.popup, 'press escape')).toEqual({ shown: 'A pop-up is in the way.\n\nTry “press escape”.', said: 'A pop-up is in the way. Try “press escape”.' })
    expect(withNextLine(SPOKEN_FAILURES.noShelfFile, null)).toEqual({ shown: SPOKEN_FAILURES.noShelfFile, said: SPOKEN_FAILURES.noShelfFile })
  })
})
