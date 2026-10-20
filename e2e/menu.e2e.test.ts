import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blockedOrInertAction } from '../src/core/browser/actionOutcome'
import { startHarness, type Harness } from './harness'
import { cli, refLine, refOf } from './cliSupport'

// The `menu` verb (#363, ADR 0079) from the CLI harness: a right-click on
// a ref opens the page's own menu, whose options the next read lists as
// refs; on a ref with no menu of its own, nothing appears — the right-click
// is inert, and the appliance's native page menu stays closed.

/** The top-level windows the X server shows now: a native menu popped is one more. */
function viewableWindows(): string[] {
  const tree = execFileSync('xwininfo', ['-root', '-children'], { encoding: 'utf8' })
  const ids = [...tree.matchAll(/^\s+(0x[0-9a-f]+)/gm)].map((match) => match[1]!)
  return ids.filter((id) => {
    try {
      return execFileSync('xwininfo', ['-id', id], { encoding: 'utf8' }).includes('Map State: IsViewable')
    } catch {
      // A window that went between the listing and the look shows nothing.
      return false
    }
  })
}

describe('the menu verb from the CLI harness (#363)', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ launchArgs: ['--browser-cli'], pipeStdio: true })
    await harness.waitForCliOutput(/bingbong browser harness/)
    const url = harness.fixture.url('/context-menu')
    await cli(harness, `navigate ${url}`, /^navigated: /)
    await harness.waitForPaneUrl(url)
    await harness.focusPane()
  })

  afterAll(async () => {
    await harness?.quit()
  })

  it("right-clicks the ref, and the page's own menu's options are the next read's refs", async () => {
    const player = refOf(await cli(harness, 'read', refLine('button', 'Fixture video player')))
    expect(harness.cliOutput()).not.toMatch(/"Loop"/)

    const opened = await cli(harness, `menu ${player}`, new RegExp(`^menu \\[${player}\\]: `))
    expect(opened).toMatch(/page signature changed/)

    await cli(harness, 'read', refLine('button', 'Loop'))
    await harness.waitForCliOutput(refLine('button', 'Copy video URL'), { since: 0 })
    expect(await harness.paneEval(`document.getElementById('menu').hidden`)).toBe(false)
    await cli(harness, 'press escape', /^pressed Escape/)
  })

  it('on a plain link nothing appears: the right-click is inert, and no native menu opens', async () => {
    const link = refOf(await cli(harness, 'read', refLine('link', 'Plain link')))
    const before = viewableWindows()

    const line = await cli(harness, `menu ${link}`, new RegExp(`^menu \\[${link}\\]: `))
    expect(line).toBe(`menu [${link}]: urlChanged=false dialogOpen=false; no observable change`)
    expect(blockedOrInertAction(line)).toBe('inert')
    // Past the hold's grace, a native menu would be mapped by now.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(viewableWindows()).toEqual(before)
  })
})
