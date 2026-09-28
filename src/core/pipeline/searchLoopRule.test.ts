import { describe, expect, it } from 'vitest'
import {
  isSearchCheckpoint,
  isSearchInspection,
  putSomethingNew,
  queryTokens,
  SEARCH_LOOP_NUDGE_AFTER,
  SEARCH_LOOP_REFUSE_AFTER,
  SEARCH_STREAK_RULE,
  searchCallKindOf,
  searchCallPageOf,
  searchStreakAfter,
  searchStreakMoveOf,
  searchStreakMoveOnPage,
  similarQueries,
  unreadEmptyLandingAfter,
  type SearchCallPage,
} from './searchLoopRule'

// Issue #238, ADR 0048: the Search Loop rail's pure rule — what one Search
// Intent is (its terms with scope removed), and which calls inspect a
// search's results rather than escape them. The Round Audit replays these
// same functions over the Run Trace. #259 (ADR 0058) added the streak
// itself: a search after a search continues it, whatever the terms. #289
// moved the nudge to the second search and made a checkpoint tool hold the
// streak: recording is not opening. #293 made escape something new put in
// front of the Run: only a page-facing call can escape, with an answered
// `ask_user` and an `agent_results` that collected a Subagent Report, and a
// Composed Address rewrite holds. #304 made an Empty Landing hold, and the
// Page Read that returns text from the page it settled on escape.

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

  it('names visual grounding as inspection too (#293, Decision 3)', () => {
    expect(isSearchInspection('ground_visual')).toBe(true)
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
    for (const name of ['read_page', 'look', 'scroll', 'click', 'navigate', 'type']) {
      expect(isSearchCheckpoint(name)).toBe(false)
    }
  })

  it('reads a call that acts on no page as off the page, whatever it returned (#293, Decision 1)', () => {
    for (const name of ['report_run_plan', 'spawn_agent', 'cancel_agent', 'toggle_panel', 'set_panel_mode', 'set_setting', 'app_control', 'new_session']) {
      expect(searchCallKindOf(name), name).toBe('offPage')
      expect(searchStreakMoveOf(searchCallKindOf(name), true), name).toBe('hold')
    }
  })

  it('leaves the two calls that put content in front of the Run able to escape: an answer and a Subagent Report (#293, Decision 1)', () => {
    expect(searchCallKindOf('ask_user')).toBe('other')
    expect(searchCallKindOf('agent_results')).toBe('other')
  })

  it('leaves back, go_forward and media_control able to escape (#293, Decision 3)', () => {
    for (const name of ['back', 'go_forward', 'media_control', 'click', 'type']) expect(searchCallKindOf(name), name).toBe('other')
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
    // #293: a Composed Address rewrite is neither a search of the loop nor escape from it.
    expect(searchStreakMoveOf('rewrite', true)).toBe('hold')
    expect(searchStreakMoveOf('rewrite', false)).toBe('hold')
    // #293: a call that acts on no page put nothing new in front of the Run.
    expect(searchStreakMoveOf('offPage', true)).toBe('hold')
  })

  it('is reading 4 of the rule: the whole table of moves, which a change to must raise SEARCH_STREAK_RULE with (#289, #293, #304)', () => {
    const kinds = ['search', 'inspection', 'checkpoint', 'rewrite', 'offPage', 'other'] as const
    const table = kinds.flatMap((kind) => [true, false].map((consumed) => `${kind} ${consumed ? 'consumed' : 'nothing'}: ${searchStreakMoveOf(kind, consumed)}`))
    const names = ['read_page', 'look', 'scroll', 'ground_visual', 'record_evidence', 'record_candidate', 'report_run_plan', 'spawn_agent', 'cancel_agent', 'set_setting', 'navigate', 'click', 'type', 'back', 'go_forward', 'media_control', 'ask_user', 'agent_results']
    // #304: what a call was to the page in front of the Run, beside its kind.
    const pages: Readonly<Record<string, SearchCallPage>> = {
      'no page': { emptyLanding: false, arrival: false, readText: false },
      'read text': { emptyLanding: false, arrival: false, readText: true },
    }
    const onPage = [true, false].flatMap((unread) =>
      Object.entries(pages).flatMap(([label, page]) =>
        kinds.map((kind) => `${unread ? 'unread Empty Landing' : 'no Empty Landing'}, ${kind} ${label}: ${searchStreakMoveOnPage(kind, true, unread, page)}`),
      ),
    )
    expect(onPage.filter((line) => line.endsWith('escape'))).toEqual([
      'unread Empty Landing, other no page: escape',
      'unread Empty Landing, inspection read text: escape',
      'unread Empty Landing, other read text: escape',
      'no Empty Landing, other no page: escape',
      'no Empty Landing, other read text: escape',
    ])
    expect({ rule: SEARCH_STREAK_RULE, table, names: names.map((name) => `${name}: ${searchCallKindOf(name)}`) }).toEqual({
      rule: 4,
      table: [
        'search consumed: search',
        'search nothing: search',
        'inspection consumed: hold',
        'inspection nothing: hold',
        'checkpoint consumed: hold',
        'checkpoint nothing: hold',
        'rewrite consumed: hold',
        'rewrite nothing: hold',
        'offPage consumed: hold',
        'offPage nothing: hold',
        'other consumed: escape',
        'other nothing: hold',
      ],
      names: [
        'read_page: inspection',
        'look: inspection',
        'scroll: inspection',
        'ground_visual: inspection',
        'record_evidence: checkpoint',
        'record_candidate: checkpoint',
        'report_run_plan: offPage',
        'spawn_agent: offPage',
        'cancel_agent: offPage',
        'set_setting: offPage',
        'navigate: other',
        'click: other',
        'type: other',
        'back: other',
        'go_forward: other',
        'media_control: other',
        'ask_user: other',
        'agent_results: other',
      ],
    })
  })

  it('reads what a call that can escape put in front of the Run: a page, the user’s answer, or a Subagent Report (#293)', () => {
    const page = { blocker: false, userAnswered: false, collectedReport: false }
    expect(putSomethingNew('navigate', page)).toBe(true)
    // A landing on a Blocker put a wall in front of the Run and no page.
    expect(putSomethingNew('navigate', { ...page, blocker: true })).toBe(false)
    expect(putSomethingNew('click', { ...page, blocker: true })).toBe(false)
    // The pipeline's own resolution, never the wording of the result.
    expect(putSomethingNew('ask_user', { ...page, userAnswered: true })).toBe(true)
    expect(putSomethingNew('ask_user', page)).toBe(false)
    expect(putSomethingNew('agent_results', { ...page, collectedReport: true })).toBe(true)
    expect(putSomethingNew('agent_results', page)).toBe(false)
    // Each reads its own fact alone: an answer is no report, and a wall is no bar to either.
    expect(putSomethingNew('agent_results', { ...page, userAnswered: true })).toBe(false)
    expect(putSomethingNew('ask_user', { blocker: true, userAnswered: true, collectedReport: false })).toBe(true)
  })

  describe('an Empty Landing and the Page Read after it (#304)', () => {
    const none: SearchCallPage = { emptyLanding: false, arrival: false, readText: false }
    const landing: SearchCallPage = { emptyLanding: true, arrival: true, readText: false }
    const arrival: SearchCallPage = { ...none, arrival: true }
    const read: SearchCallPage = { ...none, readText: true }

    it('leaves an Empty Landing unread until a Page Read returns text or the next arrival', () => {
      expect(unreadEmptyLandingAfter(false, 'other', landing)).toBe(true)
      // A Look, a scroll, a read that says the page has no text, a checkpoint: the landing is still unread.
      expect(unreadEmptyLandingAfter(true, 'inspection', none)).toBe(true)
      expect(unreadEmptyLandingAfter(true, 'checkpoint', none)).toBe(true)
      // The read that returned text spent it: a second read is inspection again.
      expect(unreadEmptyLandingAfter(true, 'inspection', read)).toBe(false)
      // The next arrival is another page.
      expect(unreadEmptyLandingAfter(true, 'other', arrival)).toBe(false)
      expect(unreadEmptyLandingAfter(true, 'search', arrival)).toBe(false)
      // Another Empty Landing is an arrival, and unread in its turn.
      expect(unreadEmptyLandingAfter(true, 'other', landing)).toBe(true)
    })

    it('leaves no read to escape by after a search or a rewrite that showed no text: reading a listing is inspection', () => {
      expect(unreadEmptyLandingAfter(false, 'search', landing)).toBe(false)
      expect(unreadEmptyLandingAfter(false, 'rewrite', landing)).toBe(false)
      expect(unreadEmptyLandingAfter(true, 'search', landing)).toBe(false)
    })

    it('escapes on the Page Read that returns text from an unread Empty Landing, and on no other inspection', () => {
      expect(searchStreakMoveOnPage('inspection', true, true, read)).toBe('escape')
      expect(searchStreakMoveOnPage('inspection', true, true, none)).toBe('hold')
      expect(searchStreakMoveOnPage('inspection', true, false, read)).toBe('hold')
      // Every other call moves as the table says, whatever is unread.
      expect(searchStreakMoveOnPage('other', false, true, landing)).toBe('hold')
      expect(searchStreakMoveOnPage('search', false, true, landing)).toBe('search')
      expect(searchStreakMoveOnPage('checkpoint', true, true, read)).toBe('hold')
    })

    it('reads the page facts off a call and its outcome', () => {
      const marked = 'navigated: url=https://www.rmg.co.uk/x title="| Royal Museums Greenwich"\nsignature 162b2d4d\nEMPTY:no-text www.rmg.co.uk\nThis page showed no text.'
      expect(searchCallPageOf('navigate', { ok: true, result: marked })).toEqual(landing)
      expect(searchCallPageOf('navigate', { ok: true, result: 'navigated: url=https://www.rmg.co.uk/ title="Home"' })).toEqual(arrival)
      expect(searchCallPageOf('click', { ok: true, result: 'clicked [7]: urlChanged=true dialogOpen=false; page signature changed' })).toEqual(arrival)
      expect(searchCallPageOf('click', { ok: true, result: 'clicked [7]: urlChanged=false dialogOpen=false; no observable change' })).toEqual(none)
      expect(searchCallPageOf('read_page', { ok: true, result: 'signature 162b2d4d\npage text:\nH4\npage text: part 1 of 1 — the text is complete; there is no part 2' })).toEqual(read)
      expect(searchCallPageOf('read_page', { ok: true, result: 'signature 162b2d4d\npage text: part 1 of 1 — this page has no text; there is no part 2' })).toEqual(none)
      // A wall read is no text from the page; a Look is never a Page Read; a failed call was nothing to the page.
      expect(searchCallPageOf('read_page', { ok: true, result: 'signature 162b2d4d\npage text:\nSign in\nBLOCKER:login-wall www.rmg.co.uk\nnudge' })).toEqual(none)
      expect(searchCallPageOf('look', { ok: true, result: 'page text:\nH4' })).toEqual(none)
      expect(searchCallPageOf('navigate', { ok: false, error: marked })).toEqual(none)
    })
  })

  it('nudges at the second search and refuses after the fifth (#289): the refusal is where #74 set it', () => {
    expect(SEARCH_LOOP_NUDGE_AFTER).toBe(2)
    expect(SEARCH_LOOP_REFUSE_AFTER).toBe(5)
  })
})
