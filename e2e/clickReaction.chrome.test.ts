import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clickPrepScript, readinessArmScript, readinessWaitScript, type ClickPrep } from '../src/main/browser/collectPageScript.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A click's Reaction closes on what the click did to the page (#335): the
// readiness watch is armed before the click preparation scrolls the ref into
// view, and that scroll of our own making is never the click's effect. Scroll
// events and layout need a real Chrome, so the arm → prep → click → wait
// sequence the controller runs is driven here over CDP.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const SPACER = '<div style="height:3000px"></div>'

const PAGES: Record<string, string> = {
  // A button far below the fold that does nothing when clicked.
  '/inert-below': `<body>${SPACER}<button>Do nothing</button>${SPACER}</body>`,
  // The same, inside a scroller of its own, under a page that smooth-scrolls.
  '/inert-nested': `<body style="scroll-behavior:smooth"><div style="height:200px;overflow:auto;scroll-behavior:smooth">${SPACER}<button>Nested nothing</button>${SPACER}</div>${SPACER}</body>`,
  // A button far below the fold that changes the page.
  '/mutating-below': `<body>${SPACER}<button onclick="this.textContent = 'Done'">Change me</button>${SPACER}</body>`,
  // A button far below the fold whose click scrolls the page itself.
  '/scrolling-below': `<body>${SPACER}<button onclick="window.scrollTo(0, 0)">Back to top</button>${SPACER}</body>`,
}

const READINESS_CAP_MS = 300

describe.skipIf(!canDriveChrome)("a click's Reaction in a real Chrome (#335)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-click-reaction-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** Open the page and click the one button on it as the controller does; answers what the readiness watch saw. */
  async function clickEffect(path: string): Promise<string> {
    await fixtures.open(path)
    // The button is the registry's one ref, as a page read below the fold would hold it.
    await fixtures.chrome.evaluate(`window.__bingbongRefs = [document.querySelector('button')]`)
    await fixtures.chrome.evaluate(readinessArmScript())
    const prep = await fixtures.chrome.evaluate<ClickPrep>(clickPrepScript(0, { listed: 1, shownOnly: false }))
    expect(prep.clickable).toBe(true)
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await fixtures.chrome.cdp.send('Input.dispatchMouseEvent', { type, x: prep.x, y: prep.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
    return fixtures.chrome.evaluate<string>(readinessWaitScript(READINESS_CAP_MS))
  }

  it('reports no effect for a click on a ref outside the viewport that changes nothing', async () => {
    expect(await clickEffect('/inert-below')).toBe('timeout')
  })

  it('reports no effect when the scroll-into-view moves a nested scroller under smooth scrolling', async () => {
    expect(await clickEffect('/inert-nested')).toBe('timeout')
  })

  it('closes on the mutation a click makes', async () => {
    expect(await clickEffect('/mutating-below')).toBe('mutation')
  })

  it('closes on a scroll the page makes itself', async () => {
    expect(await clickEffect('/scrolling-below')).toBe('scroll')
  })
})
