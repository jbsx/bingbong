import { describe, expect, it } from 'vitest'
import { isSearchInspection, queryTokens, similarQueries } from './searchLoopRule'

// Issue #238, ADR 0048: the Search Loop rail's pure rule — what one Search
// Intent is (its terms with scope removed), and which calls inspect a
// search's results rather than escape them. The Round Audit replays these
// same functions over the Run Trace.

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
