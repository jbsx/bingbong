import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT, searchSubmitScript, selectFieldScript } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, parseCollectedPage } from '../src/core/browser/snapshot.ts'
import { commandPageOf } from '../src/core/command/command.ts'
import { commandState } from '../src/core/command/jevReading.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A search box is a fact by kind (#398): an editable field that declares it
// searches, sits in a search landmark, or is named for it by its name, id,
// aria-label or placeholder, each tested whole. Its line says `searchbox`
// and what it holds; the submit of its form says `button[submit]`. A
// password or payment field never is one, and a textarea is one only by
// its attributes, never by where it sits.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const PAGES: Record<string, string> = {
  // YouTube: a form, an input named search_query holding stale words, and a submit button labelled twice.
  '/youtube': `<body>
    <form action="/results"><input id="search" name="search_query" aria-label="Search" value="lines tactic"><button aria-label="Search">Search</button></form>
    <input aria-label="Add a comment" name="comment">
  </body>`,
  // Declared: type=search, role=searchbox, enterkeyhint=search.
  '/declared': `<body>
    <input type="search" aria-label="Find">
    <div role="searchbox" contenteditable="true" aria-label="Look up"></div>
    <input enterkeyhint="search" aria-label="Go">
  </body>`,
  // A search landmark: <search>, form[role=search], role=search — a number field and a textarea inside one stay plain.
  '/landmark': `<body>
    <search><input aria-label="Terms"></search>
    <form role="search" action="/s"><input aria-label="Words"><input type="number" aria-label="Max price"><textarea aria-label="Notes"></textarea></form>
  </body>`,
  // Google's box is a textarea named q; a password named query is never one; a plain field is not.
  '/hints': `<body>
    <form action="/search"><textarea name="q" aria-label="Ask"></textarea></form>
    <form action="/login"><input type="password" name="query" aria-label="Secret"><input name="cc-number" autocomplete="cc-number" placeholder="Search card"><input aria-label="Name"></form>
  </body>`,
  // The Search Op's submit: a lone box submits on Enter; a form of two text fields and no submit control does not.
  '/submit': `<body>
    <form id="lone" onsubmit="event.preventDefault(); window.submitted = 'lone'"><input id="q" name="q" value="old words"></form>
    <form id="pair" onsubmit="event.preventDefault(); window.submitted = 'pair'"><input id="what" name="search"><input id="where" name="near"></form>
    <div contenteditable="true" id="edit" role="searchbox">old words</div>
  </body>`,
}

describe.skipIf(!canDriveChrome)('a search box by kind on its line (#398)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-search-box-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** The ref lines of the card Jev is asked with, on the page at this path. */
  const refLines = async (path: string): Promise<string[]> => {
    await fixtures.open(path)
    const page = commandPageOf(buildPageSnapshot(parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))))
    return commandState('search MKBHD', page).split('\n').filter((line) => line.startsWith('['))
  }

  it('names a box by its attributes a searchbox holding its words, and the submit of its form button[submit]', async () => {
    // The button's label joins its aria-label to its own text: the labelOf dedupe is turn-mvjufp7l-15's, not this kind's.
    expect(await refLines('/youtube')).toEqual(['[1] searchbox "Search" holds "lines tactic"', '[2] button[submit] "Search Search"', '[3] input[text] "Add a comment"'])
  })

  it('names a box that declares it searches a searchbox', async () => {
    expect(await refLines('/declared')).toEqual(['[1] searchbox "Find"', '[2] searchbox "Look up"', '[3] searchbox "Go"'])
  })

  it('names a text field in a search landmark a searchbox, but not a number field nor a textarea there', async () => {
    expect(await refLines('/landmark')).toEqual(['[1] searchbox "Terms"', '[2] searchbox "Words"', '[3] input[number] "Max price"', '[4] input "Notes"'])
  })

  it('names a textarea a searchbox by its name, and never a password or payment field', async () => {
    expect(await refLines('/hints')).toEqual(['[1] searchbox "Ask"', '[2] input[password] "Secret"', '[3] input[text] "Search card"', '[4] input[text] "Name"'])
  })

  it('selects what the focused field holds, an input\'s value or an editable\'s contents, so the insert replaces it', async () => {
    await fixtures.open('/submit')
    expect(await fixtures.chrome.evaluate(`(() => { document.getElementById('q').focus(); return ${selectFieldScript()} })()`)).toBe(true)
    expect(await fixtures.chrome.evaluate(`(() => { const q = document.getElementById('q'); return [q.selectionStart, q.selectionEnd] })()`)).toEqual([0, 9])
    expect(await fixtures.chrome.evaluate(`(() => { document.getElementById('edit').focus(); return ${selectFieldScript()} && String(window.getSelection()) })()`)).toBe('old words')
  })

  it('leaves a lone box to Enter, and submits a form Enter would not itself', async () => {
    await fixtures.open('/submit')
    expect(await fixtures.chrome.evaluate(`(() => { document.getElementById('q').focus(); return ${searchSubmitScript()} })()`)).toBe('enter')
    expect(await fixtures.chrome.evaluate(`(() => { document.getElementById('what').focus(); return [${searchSubmitScript()}, window.submitted] })()`)).toEqual(['form', 'pair'])
    expect(await fixtures.chrome.evaluate(`(() => { document.getElementById('edit').focus(); return ${searchSubmitScript()} })()`)).toBe('enter')
  })
})
