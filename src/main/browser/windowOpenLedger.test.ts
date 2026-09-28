import { describe, expect, it } from 'vitest'
import { createWindowOpenLedger, PRESS_FRESH_MS } from './windowOpenLedger'

/** A pane whose pressed link, navigations and clock the test sets and reads. */
function makeLedger(options?: { link?: string | null; linkFails?: boolean; navigates?: boolean }) {
  const navigated: string[] = []
  const clock = { at: 10_000 }
  let asked = 0
  const ledger = createWindowOpenLedger({
    async pressedLinkAddress() {
      asked += 1
      if (options?.linkFails) throw new Error('pane webContents destroyed')
      return options?.link ?? null
    },
    navigate(url) {
      if (options?.navigates === false) return false
      navigated.push(url)
      return true
    },
    now: () => clock.at,
  })
  return { ledger, navigated, clock, asked: () => asked }
}

/** Let the user route's page question resolve. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('createWindowOpenLedger', () => {
  it('holds an open made while the model acts for the controller, and asks the page nothing', async () => {
    const { ledger, navigated, asked } = makeLedger({ link: 'https://a.test/page' })

    const release = ledger.hold()
    ledger.recordDenied('https://a.test/page')
    await settled()

    expect(navigated).toEqual([])
    expect(asked()).toBe(0)
    expect(ledger.consume()).toEqual(['https://a.test/page'])
    expect(ledger.consume()).toEqual([])
    release()
  })

  it('navigates the pane on the user’s own press of a New-window Link, and reports nothing', async () => {
    const { ledger, navigated } = makeLedger({ link: 'https://a.test/page' })

    ledger.recordDenied('https://a.test/page')
    await settled()

    expect(navigated).toEqual(['https://a.test/page'])
    expect(ledger.consume()).toEqual([])
  })

  it('keeps an open to some other address denied and reported', async () => {
    const { ledger, navigated } = makeLedger({ link: 'https://a.test/page' })

    ledger.recordDenied('https://ads.test/window')
    await settled()

    expect(navigated).toEqual([])
    expect(ledger.consume()).toEqual(['https://ads.test/window'])
  })

  it('keeps an open denied when no link was pressed', async () => {
    const { ledger, navigated } = makeLedger({ link: null })

    ledger.recordDenied('https://a.test/page')
    await settled()

    expect(navigated).toEqual([])
    expect(ledger.consume()).toEqual(['https://a.test/page'])
  })

  it('never asks the page about a target that is no address', async () => {
    const { ledger, asked } = makeLedger({ link: 'data:text/html,<b>x</b>' })

    ledger.recordDenied('data:text/html,<b>x</b>')
    await settled()

    expect(asked()).toBe(0)
    expect(ledger.consume()).toEqual(['data:text/html,<b>x</b>'])
  })

  it('reports the open when the page cannot be asked or the pane cannot navigate', async () => {
    const unreadable = makeLedger({ linkFails: true })
    unreadable.ledger.recordDenied('https://a.test/page')
    await settled()
    expect(unreadable.ledger.consume()).toEqual(['https://a.test/page'])

    const stuck = makeLedger({ link: 'https://a.test/page', navigates: false })
    stuck.ledger.recordDenied('https://a.test/page')
    await settled()
    expect(stuck.ledger.consume()).toEqual(['https://a.test/page'])
  })

  it('reports an open that arrives just after the model acted, and never follows it', async () => {
    const { ledger, navigated, clock, asked } = makeLedger({ link: 'https://a.test/page' })

    ledger.hold()()
    clock.at += PRESS_FRESH_MS - 1
    ledger.recordDenied('https://a.test/page')
    await settled()

    expect(navigated).toEqual([])
    expect(asked()).toBe(0)
    expect(ledger.consume()).toEqual(['https://a.test/page'])
  })

  it('goes back to the user’s route once every hold is released and the model’s press is stale', async () => {
    const { ledger, navigated, clock } = makeLedger({ link: 'https://a.test/page' })

    const first = ledger.hold()
    const second = ledger.hold()
    first()
    // Releasing twice is one release.
    first()
    ledger.recordDenied('https://a.test/held')
    second()
    clock.at += PRESS_FRESH_MS
    ledger.recordDenied('https://a.test/page')
    await settled()

    expect(navigated).toEqual(['https://a.test/page'])
    expect(ledger.consume()).toEqual(['https://a.test/held'])
  })

  it('reports a press the model’s action overtook while the page was being asked', async () => {
    const { ledger, navigated } = makeLedger({ link: 'https://a.test/page' })

    ledger.recordDenied('https://a.test/page')
    const release = ledger.hold()
    await settled()

    expect(navigated).toEqual([])
    expect(ledger.consume()).toEqual(['https://a.test/page'])
    release()
  })

  it('drops what a Session left behind on clear, an answer still on its way included', async () => {
    const { ledger, navigated } = makeLedger({ link: null })

    const release = ledger.hold()
    ledger.recordDenied('https://a.test/held')
    release()
    ledger.recordDenied('https://a.test/late')
    ledger.clear()
    await settled()

    expect(navigated).toEqual([])
    expect(ledger.consume()).toEqual([])
  })
})
