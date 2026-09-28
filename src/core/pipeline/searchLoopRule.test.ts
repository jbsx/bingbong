import { describe, expect, it } from 'vitest'
import {
  isSearchCheckpoint,
  isSearchInspection,
  queryTokens,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  SEARCH_STREAK_RULE,
  searchCallKindOf,
  searchStreakAfter,
  searchStreakMoveOf,
  similarQueries,
} from './searchLoopRule'

// Issue #238, ADR 0048: the Search Loop rail's pure rule — what one Search
// Intent is (its terms with scope removed), and which calls inspect a
// search's results rather than escape them. The Round Audit replays these
// same functions over the Run Trace. #259 (ADR 0058) added the streak
// itself: a search after a search continues it, whatever the terms. #289
// moved the nudge to the second search and made a checkpoint tool hold the
// streak: recording is not opening.

describe('queryTokens folds scope out of a Search Intent', () => {
  it('drops a search operator together with its argument', () => {
    expect([...queryTokens('site:rmg.co.uk Harrison watch')]).toEqual(['harrison', 'watch'])
    expect([...queryTokens('Harrison watch intitle:catalogue filetype:pdf inurl:collections')]).toEqual(['harrison', 'watch'])
    expect([...queryTokens('Harrison watch -site:ebay.com')]).toEqual(['harrison', 'watch'])
    expect([...queryTokens('Site:RMG.co.uk Harrison')]).toEqual(['harrison'])
  })

  it('drops a quoted operator argument whole, and a spaced one', () => {
    expect([...queryTokens('intitle:"longitude watch" Harrison')]).toEqual(['harrison'])
    expect([...queryTokens('site: rmg Harrison watch')]).toEqual(['harrison', 'watch'])
  })

  it('drops an uppercase connective but keeps the lowercase word', () => {
    expect([...queryTokens('Harrison OR Kendall AND watch')]).toEqual(['harrison', 'kendall', 'watch'])
    expect([...queryTokens('watch or clock')]).toEqual(['watch', 'or', 'clock'])
  })

  it('drops a bare hostname given as a term, judged before punctuation splits it', () => {
    expect([...queryTokens('jpl.nasa.gov Voyager heliopause')]).toEqual(['voyager', 'heliopause'])
    expect([...queryTokens('"eurostar.com" luggage allowance')]).toEqual(['luggage', 'allowance'])
  })

  it('keeps a version or a numbered term — a host ends in an alphabetic top-level label', () => {
    expect([...queryTokens('camera module v1.3 pinout')]).toEqual(['camera', 'module', 'v1', '3', 'pinout'])
    expect([...queryTokens('Harrison H4 No.1 watch')]).toEqual(['harrison', 'h4', 'no', '1', 'watch'])
    expect([...queryTokens('camera 3.5 mm jack')]).toEqual(['camera', '3', '5', 'mm', 'jack'])
  })

  it('keeps the words inside quotes and after a minus sign — emphasis, not scope', () => {
    expect([...queryTokens('"Voyager 1" -probe interstellar')]).toEqual(['voyager', '1', 'probe', 'interstellar'])
  })

  it('keeps the scope when a search is nothing but scope (Decision 2)', () => {
    expect(queryTokens('site:rmg.co.uk').size).toBeGreaterThan(0)
    expect(queryTokens('eurostar.com').size).toBeGreaterThan(0)
    expect(similarQueries('site:rmg.co.uk', 'site:rmg.co.uk')).toBe(true)
    expect(similarQueries('eurostar.com', 'eurostar.com')).toBe(true)
    expect(queryTokens('   ').size).toBe(0)
  })

  it('compares a search that is nothing but scope scope and all, so it continues a search that shares its scope (AC2)', () => {
    expect(similarQueries('site:rmg.co.uk', 'site:rmg.co.uk collections Harrison longitude watch')).toBe(true)
    expect(similarQueries('eurostar.com luggage allowance', 'eurostar.com')).toBe(true)
    expect(similarQueries('site:rmg.co.uk', 'Harrison longitude watch')).toBe(false)
    expect(similarQueries('site:rmg.co.uk', 'site:nasa.gov')).toBe(false)
  })
})

describe('similarQueries compares Search Intents (AC1)', () => {
  it('matches a site: search against the same terms typed into the site’s own box', () => {
    expect(similarQueries('site:rmg.co.uk collections Harrison longitude watch', 'Harrison longitude watch')).toBe(true)
  })

  it('matches the Voyager rewordings whose host tokens, not terms, differ', () => {
    expect(
      similarQueries(
        'science.nasa.gov "Voyager 1 officially interstellar space" September 2013 press release',
        'site:nasa.gov voyager 1 officially interstellar space September 12 2013',
      ),
    ).toBe(true)
  })

  it('still separates a narrowing — the documented loss (Decision 6)', () => {
    expect(similarQueries('"Harrison"', 'Harrison longitude watch')).toBe(false)
  })

  it('never lets a scope swap alone make different terms one intent', () => {
    expect(similarQueries('site:rmg.co.uk Harrison watch', 'site:rmg.co.uk Voyager probe')).toBe(false)
  })
})

describe('isSearchInspection (Decision 5)', () => {
  it('names a page read, a Look and a scroll as inspection', () => {
    expect(isSearchInspection('read_page')).toBe(true)
    expect(isSearchInspection('look')).toBe(true)
    expect(isSearchInspection('scroll')).toBe(true)
  })

  it('leaves every call that leaves the results as escape', () => {
    for (const name of ['click', 'navigate', 'type', 'back', 'go_forward', 'download_url', 'record_evidence']) {
      expect(isSearchInspection(name)).toBe(false)
    }
  })
})

describe('isSearchCheckpoint (#289)', () => {
  it('names the two checkpoint tools, and nothing that looks at or leaves a page', () => {
    expect(isSearchCheckpoint('record_evidence')).toBe(true)
    expect(isSearchCheckpoint('record_candidate')).toBe(true)
    for (const name of ['read_page', 'look', 'scroll', 'click', 'navigate', 'type', 'report_run_plan', 'ask_user']) {
      expect(isSearchCheckpoint(name)).toBe(false)
    }
  })

  it('reads a call that is not a search by its name: inspection, a checkpoint, or any other call', () => {
    expect(searchCallKindOf('read_page')).toBe('inspection')
    expect(searchCallKindOf('record_evidence')).toBe('checkpoint')
    expect(searchCallKindOf('record_candidate')).toBe('checkpoint')
    expect(searchCallKindOf('click')).toBe('other')
    // A navigate or a type is a search only by its arguments, which the caller reads.
    expect(searchCallKindOf('navigate')).toBe('other')
  })
})

describe('the streak (#259, ADR 0058): a search after a search, with nothing opened between them', () => {
  it('advances on a search, ends on an escape, and holds on anything else', () => {
    expect(searchStreakAfter(0, 'search')).toBe(1)
    expect(searchStreakAfter(3, 'search')).toBe(4)
    expect(searchStreakAfter(3, 'escape')).toBe(0)
    expect(searchStreakAfter(3, 'hold')).toBe(3)
  })

  it('reads a call as a move: a search whatever its outcome, inspection holds, another call escapes only when it consumed something', () => {
    expect(searchStreakMoveOf('search', false)).toBe('search')
    expect(searchStreakMoveOf('search', true)).toBe('search')
    expect(searchStreakMoveOf('inspection', true)).toBe('hold')
    // #289: an accepted checkpoint recorded what the Run already had; nothing was opened.
    expect(searchStreakMoveOf('checkpoint', true)).toBe('hold')
    expect(searchStreakMoveOf('checkpoint', false)).toBe('hold')
    expect(searchStreakMoveOf('other', true)).toBe('escape')
    // A failed or refused call, or one that landed on a Not-found Page, consumed nothing.
    expect(searchStreakMoveOf('other', false)).toBe('hold')
  })

  it('is reading 2 of the rule: the whole table of moves, which a change to must raise SEARCH_STREAK_RULE with (#289)', () => {
    const kinds = ['search', 'inspection', 'checkpoint', 'other'] as const
    const table = kinds.flatMap((kind) => [true, false].map((consumed) => `${kind} ${consumed ? 'consumed' : 'nothing'}: ${searchStreakMoveOf(kind, consumed)}`))
    expect({ rule: SEARCH_STREAK_RULE, table, held: ['read_page', 'look', 'scroll', 'record_evidence', 'record_candidate'].map(searchCallKindOf) }).toEqual({
      rule: 2,
      table: [
        'search consumed: search',
        'search nothing: search',
        'inspection consumed: hold',
        'inspection nothing: hold',
        'checkpoint consumed: hold',
        'checkpoint nothing: hold',
        'other consumed: escape',
        'other nothing: hold',
      ],
      held: ['inspection', 'inspection', 'inspection', 'checkpoint', 'checkpoint'],
    })
  })

  it('nudges at the second search and refuses after the fifth (#289): the refusal is where #74 set it', () => {
    expect(SEARCH_LOOP_NUDGE_AFTER).toBe(2)
    expect(SEARCH_LOOP_REFUSE_AFTER).toBe(5)
  })
})
