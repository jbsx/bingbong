import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT, clickPrepScript, markShownRefsScript, type ClickPrep } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, parseCollectedPage } from '../src/core/browser/snapshot.ts'
import { commandPageOf } from '../src/core/command/command.ts'
import { commandState } from '../src/core/command/jevReading.ts'
import { readRefStates } from '../src/main/browser/readRefStates.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A details is acted on through its summary (#386, ADR 0083): neither a
// click on the details nor its click() toggles it, and on an open one the
// click lands in its body. The summary is the ref, kinded as a button,
// labelled by its own text and carrying the expanded state the tree gives
// it; the details gives none, and a span inside the summary folds into it.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const PAGES: Record<string, string> = {
  '/details': `<body>
    <details id="closed"><summary>Language</summary><p>Any language</p></details>
    <details id="open" open><summary><span class="btn-label">Date range</span></summary><p>Today, this week and this month</p></details>
    <details id="bare"><p>No summary here</p></details>
  </body>`,
}

describe.skipIf(!canDriveChrome)('a details is acted on through its summary (#386, ADR 0083)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-details-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const collect = async () => parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))

  it('makes each summary a button ref labelled by its own text, the details none, and a span inside the summary none', async () => {
    await fixtures.open('/details')
    const collected = await collect()
    expect(collected.elements.map((element) => element.tag)).toEqual(['summary', 'summary', 'details'])
    expect(buildPageSnapshot(collected).refs.map((ref) => [ref.kind, ref.label])).toEqual([
      ['button', 'Language'],
      ['button', 'Date range'],
      // No summary child: the details keeps its cue (the browser's own "Details" summary is out of reach).
      ['button', 'No summary here'],
    ])
  })

  it("carries the summary's expanded state on its line, and no role the button kind already says", async () => {
    await fixtures.open('/details')
    const page = commandPageOf(buildPageSnapshot(await readRefStates(fixtures.chrome.cdp, await collect())))
    expect(commandState('open the language menu', page).split('\n').slice(3, 5)).toEqual([
      '[1] button "Language" expanded=false',
      '[2] button "Date range" expanded=true',
    ])
  })

  /** Click the ref with this label as the click step does: prepare it, then a real click at its point. */
  async function click(label: string): Promise<void> {
    const collected = await collect()
    await fixtures.chrome.evaluate(markShownRefsScript(collected.elements.length))
    const index = collected.elements.findIndex((element) => element.label === label)
    expect(index, `${label} is listed`).toBeGreaterThanOrEqual(0)
    const prep = await fixtures.chrome.evaluate<ClickPrep>(clickPrepScript(index, { listed: collected.elements.length, shownOnly: true }))
    expect(prep).toMatchObject({ ok: true, clickable: true })
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await fixtures.chrome.cdp.send('Input.dispatchMouseEvent', { type, x: prep.x, y: prep.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
  }

  const isOpen = (id: string) => fixtures.chrome.evaluate<boolean>(`document.getElementById(${JSON.stringify(id)}).open`)

  it('opens the closed details and closes the open one with a real click on its summary ref', async () => {
    await fixtures.open('/details')
    await click('Language')
    expect(await isOpen('closed')).toBe(true)
    await click('Date range')
    expect(await isOpen('open')).toBe(false)
  })
})
