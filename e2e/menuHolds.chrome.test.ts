import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COLLECT_PAGE_SCRIPT } from '../src/main/browser/collectPageScript.ts'
import { buildPageSnapshot, parseCollectedPage } from '../src/core/browser/snapshot.ts'
import { commandPageOf } from '../src/core/command/command.ts'
import { commandState } from '../src/core/command/jevReading.ts'
import { readRefStates } from '../src/main/browser/readRefStates.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A closed menu's contents ride its trigger's line (#388): what the user
// names often sits behind a trigger, and the card never showed it. The
// panel is found by kind while it is hidden — the trigger's aria-controls
// target, else the hidden panel beside it in its nearest container — and
// the line is left off when nothing is found or the panel is open.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const PAGES: Record<string, string> = {
  // YouTube's player Settings: aria-controls names a popup, empty until first opened, that then keeps its items while closed.
  '/controls': `<body>
    <button aria-haspopup="true" aria-expanded="false" aria-controls="settings-menu">Settings</button>
    <div id="settings-menu" role="menu" style="display:none">
      <div role="menuitemcheckbox" aria-checked="false"><div class="icon"></div><div class="label">Ambient mode</div><div class="content"><div class="toggle"></div></div></div>
      <div role="menuitem"><div class="label">Sleep timer</div><div class="content">Off</div></div>
      <div role="menuitem"><div class="label">Playback speed</div><div class="content">Normal</div></div>
      <div role="menuitem" style="display:none"><div class="label">Stable volume</div></div>
    </div>
    <button aria-haspopup="menu" aria-expanded="false" aria-controls="empty-menu">More</button>
    <div id="empty-menu" role="menu" style="display:none"></div>
  </body>`,
  // Wikipedia's Vector dropdowns: a checkbox and a sibling panel, no aria-controls.
  '/structure': `<body>
    <style>.content { display: none } .checkbox:checked ~ .content { display: block }</style>
    <div class="dropdown">
      <input type="checkbox" id="tools" class="checkbox" role="button" aria-haspopup="true" aria-label="Tools">
      <label for="tools">Tools</label>
      <div class="content">
        <div class="heading">Actions</div>
        <ul><li><a href="/read"><span>Read</span></a></li><li><a href="/edit"><span>Edit</span></a></li></ul>
        <div class="heading">General</div>
        <ul><li><a href="/info"><span>Page information</span></a></li><li><a href="/cite"><span>Cite this page</span></a></li></ul>
      </div>
    </div>
    <div class="stale"><button aria-haspopup="menu" aria-controls="gone">Share</button><ul style="display:none"><li><a href="/copy">Copy link</a></li></ul></div>
    <div class="row"><button>Plain</button><div style="display:none"><a href="/hidden">Hidden link</a></div></div>
  </body>`,
  '/open': `<body>
    <button aria-haspopup="menu" aria-expanded="true" aria-controls="open-menu">Account</button>
    <div id="open-menu" role="menu"><div role="menuitem">Sign out</div></div>
  </body>`,
}

describe.skipIf(!canDriveChrome)("a closed menu's contents on its trigger's line (#388)", () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures(PAGES, 'bingbong-menu-holds-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  /** The ref lines of the card Jev is asked with, on the page at this path. */
  const refLines = async (path: string): Promise<string[]> => {
    await fixtures.open(path)
    const collected = parseCollectedPage(await fixtures.chrome.evaluate(COLLECT_PAGE_SCRIPT))
    const page = commandPageOf(buildPageSnapshot(await readRefStates(fixtures.chrome.cdp, collected)))
    return commandState('turn on ambient mode', page).split('\n').filter((line) => line.startsWith('['))
  }

  it("names the items of the hidden panel the trigger's aria-controls names, but not one the panel hides itself, and none for an empty one", async () => {
    expect(await refLines('/controls')).toEqual([
      '[1] button "Settings" hasPopup=menu expanded=false menu holds "Ambient mode", "Sleep timer Off", "Playback speed Normal"',
      '[2] button "More" hasPopup=menu expanded=false',
    ])
  })

  it('names the links of the hidden panel beside a trigger with no aria-controls, or one naming nothing, and none beside a trigger that opens nothing', async () => {
    expect(await refLines('/structure')).toEqual([
      '[1] button "Tools Tools" hasPopup=menu menu holds "Read", "Edit", "Page information", "Cite this page"',
      '[2] button "Share" hasPopup=menu menu holds "Copy link"',
      '[3] button "Plain"',
    ])
  })

  it('leaves the line off a trigger whose panel is open, where its items are refs of their own', async () => {
    expect(await refLines('/open')).toEqual([
      '[1] button "Account" hasPopup=menu expanded=true',
      '[2] button "Sign out" role=menuitem',
    ])
  })
})
