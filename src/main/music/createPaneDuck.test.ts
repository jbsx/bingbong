import { describe, expect, it } from 'vitest'
import { createPaneDuck, type DuckedPane } from './createPaneDuck'

// The pane's duck (#461): the page-side scripts do the lowering (proven in
// a real Chrome, e2e/paneDuck.chrome.test.ts); here, which frames are told
// what, and when.

class FakeFrame {
  readonly scripts: string[] = []
  detached = false
  fails = false

  async executeJavaScript(script: string): Promise<unknown> {
    this.scripts.push(script.includes('/* DUCK_ALL */') ? 'duck' : script.includes('/* UNDUCK_ALL */') ? 'unduck' : script)
    if (this.fails) throw new Error('mid-navigation')
    return 0
  }
}

function fakePane(frames: FakeFrame[]) {
  const listeners = new Map<string, () => void>()
  let destroyed = false
  const pane = {
    isDestroyed: () => destroyed,
    on: (event: string, listener: () => void) => void listeners.set(event, listener),
    off: (event: string) => void listeners.delete(event),
    mainFrame: { framesInSubtree: frames },
  }
  return {
    pane: pane as unknown as DuckedPane,
    load: () => listeners.get('did-frame-finish-load')?.(),
    listening: () => listeners.has('did-frame-finish-load'),
    destroy: () => {
      destroyed = true
    },
  }
}

describe('the pane duck (#461)', () => {
  it('ducks the top and every frame below it, and lets go in each', async () => {
    const top = new FakeFrame()
    const embed = new FakeFrame()
    const { pane } = fakePane([top, embed])
    const duck = createPaneDuck(pane)
    await duck.set(true)
    await duck.set(false)
    expect(top.scripts).toEqual(['duck', 'unduck'])
    expect(embed.scripts).toEqual(['duck', 'unduck'])
  })

  it('a duck already held, or a release with none, tells no frame again', async () => {
    const top = new FakeFrame()
    const duck = createPaneDuck(fakePane([top]).pane)
    await duck.set(false)
    await duck.set(true)
    await duck.set(true)
    expect(top.scripts).toEqual(['duck'])
  })

  it('a document landing while the duck holds is ducked; one landing after the release is not', async () => {
    const top = new FakeFrame()
    const { pane, load } = fakePane([top])
    const duck = createPaneDuck(pane)
    load()
    await duck.set(true)
    load()
    await duck.set(false)
    load()
    expect(top.scripts).toEqual(['duck', 'duck', 'unduck'])
  })

  it('a frame that fails or has gone is passed over, and a pane gone is not touched', async () => {
    const top = new FakeFrame()
    const failing = new FakeFrame()
    failing.fails = true
    const gone = new FakeFrame()
    gone.detached = true
    const fake = fakePane([top, failing, gone])
    const duck = createPaneDuck(fake.pane)
    await duck.set(true)
    expect(top.scripts).toEqual(['duck'])
    expect(gone.scripts).toEqual([])
    fake.destroy()
    await duck.set(false)
    expect(top.scripts).toEqual(['duck'])
  })

  it('detached, it hears no more loads', () => {
    const fake = fakePane([new FakeFrame()])
    const duck = createPaneDuck(fake.pane)
    expect(fake.listening()).toBe(true)
    duck.detach()
    expect(fake.listening()).toBe(false)
  })
})
