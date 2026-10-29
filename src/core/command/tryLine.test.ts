import { describe, expect, it } from 'vitest'
import type { Command, CommandRef } from './command'
import { localMatch } from './localMatch'
import { SPOKEN_FAILURES, failureLineOf, notHereLine } from './spokenFailure'
import { BY_FAILURE, BY_KIND, TRY_LINES, nextLine, searchLine, withNextLine } from './tryLine'

// A failure names a line that would have worked (#438, principles 9 and
// 10): a fallback wording per failure and Command kind, in code — never a
// judgement, never another ask.

const command = (verb: Command['verb'], slot: string | null = null): Command => ({ verb, target: null, slot })

describe('nextLine', () => {
  it('a pop-up in the way is closed by Escape; a wall that stayed is left', () => {
    expect(nextLine(SPOKEN_FAILURES.popup)).toBe('press escape')
    expect(nextLine(SPOKEN_FAILURES.blocked)).toBe('press escape')
    // Escape is a rung the Dismissal Ladder already tried on a pop-up that stayed.
    expect(nextLine(SPOKEN_FAILURES.dialogStayed)).toBe('back')
    // The consent rule's click already ran and the wall stayed; "click accept" fires only beside a button that says it word for word.
    expect(nextLine(SPOKEN_FAILURES.consent)).toBe('back')
  })

  it('a page that is no use is left; no page at all is the last one reopened', () => {
    for (const failure of ['blocker', 'notFound', 'unavailable', 'empty'] as const) expect(nextLine(SPOKEN_FAILURES[failure])).toBe('back')
    expect(nextLine(SPOKEN_FAILURES.noPage)).toBe('resume')
    expect(nextLine(SPOKEN_FAILURES.noBack)).toBe('resume')
  })

  it('an address that would not open is left: the grammar has no search for an address, and an IP has none to search for', () => {
    expect(nextLine("That address can't be opened.", command('navigate', 'http://127.0.0.1:1/nothing'))).toBe('back')
    expect(nextLine("That address can't be opened.", command('navigate', 'http://localhost:5173/'))).toBe('back')
    expect(nextLine(failureLineOf('navigate', 'net::ERR_NAME_NOT_RESOLVED'), command('navigate', 'https://www.fixturely.test/x'))).toBe('back')
  })

  it('an item the page lacks, or a Task not sure it is done, names help: the Page Read is gone (#513)', () => {
    expect(nextLine(failureLineOf('click', 'ref 999 refused'), command('click'))).toBe('help')
    expect(nextLine(SPOKEN_FAILURES.unsure)).toBe('help')
  })

  it("what was not found here is searched for on the web, in the grammar's own search line", () => {
    expect(nextLine(notHereLine('the opening hours'), undefined, 'the opening hours')).toBe('navigate the opening hours')
    // Words that read as an address would be opened, not searched for.
    expect(nextLine(notHereLine('bbc.co.uk'), undefined, 'bbc.co.uk')).toBe('help')
  })

  it("a song that would not play names no line: “not that one” is Jev's, and the Queue already moved on", () => {
    expect(nextLine("“x” can't be played.", command('play', 'x'))).toBeNull()
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

// Every Try line parses (#445): each line the tables name, fed to the
// Local Match as the person would say it, is a Command of its kind with no
// Jev call — on no page, and on the pages a failure leaves, whose controls
// do not wear the line's very words (ADR 0089).
describe('every Try line parses through the Local Match', () => {
  const ref = (n: number, kind: CommandRef['kind'], label: string): CommandRef => ({ ref: n, kind, label, href: kind === 'link' ? `https://example.com/${n}` : null, inputType: null })
  const PAGES: Readonly<Record<string, readonly CommandRef[]>> = {
    'no page': [],
    'a consent wall': [ref(1, 'button', 'Accept all'), ref(2, 'button', 'Reject all'), ref(3, 'link', 'Manage preferences')],
    'a not-found page': [ref(1, 'link', 'Home'), ref(2, 'input', 'Search'), ref(3, 'link', 'Go back to the homepage')],
    'a sign-in wall': [ref(1, 'button', 'Sign in'), ref(2, 'button', 'Continue with Google'), ref(3, 'button', 'Close')],
  }

  it('the failure and kind tables name only the fixed lines', () => {
    const fixed: readonly string[] = Object.values(TRY_LINES)
    const named = [...BY_FAILURE.values(), ...Object.values(BY_KIND)].filter((line): line is string => line !== null && line !== undefined)
    expect(named.filter((line) => !fixed.includes(line))).toEqual([])
  })

  for (const [verb, line] of Object.entries(TRY_LINES)) {
    for (const [page, refs] of Object.entries(PAGES)) {
      it(`“${line}” is a ${verb} on ${page}`, () => {
        expect(localMatch(line, refs)?.verb).toBe(verb)
      })
    }
  }

  for (const [page, refs] of Object.entries(PAGES)) {
    it(`the search line is a search for its words on ${page}`, () => {
      expect(localMatch(searchLine('the opening hours'), refs)).toMatchObject({ verb: 'search', slot: 'the opening hours' })
    })
  }
})
