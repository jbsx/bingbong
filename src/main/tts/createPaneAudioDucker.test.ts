import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { createPaneAudioDucker } from './createPaneAudioDucker'
import { DUCK_FACTOR } from '../../core/tts/duckVolumes'

/** One frame below the top (#377): its own media volumes, ducked and restored in its own context. */
class FakeFrame {
  readonly scripts: string[] = []
  constructor(
    private volumes: number[],
    readonly parent: unknown = {},
  ) {}

  async executeJavaScript(script: string): Promise<unknown> {
    this.scripts.push(script)
    if (script.includes('.map(')) return this.volumes
    const applied = /const volumes = (\[[^\]]*\])/.exec(script)
    if (applied) this.volumes = JSON.parse(applied[1]!) as number[]
    return undefined
  }

  get current(): number[] {
    return this.volumes
  }
}

class FakeWebContents {
  readonly scripts: string[] = []
  /** The frame tree: the top itself, then the frames below it (#377). */
  readonly mainFrame: { framesInSubtree: unknown[] } = { framesInSubtree: [] }

  constructor(frames: FakeFrame[] = []) {
    this.mainFrame.framesInSubtree = [this.mainFrame, ...frames]
  }
  private pendingVolumes: { resolve: (volumes: number[]) => void }[] = []

  isDestroyed(): boolean {
    return false
  }

  executeJavaScript(script: string): Promise<unknown> {
    this.scripts.push(script)
    if (script.includes('.map(')) {
      return new Promise((resolve) => this.pendingVolumes.push({ resolve }))
    }
    return Promise.resolve(undefined)
  }

  respondVolumes(volumes: number[]): void {
    this.pendingVolumes.shift()?.resolve(volumes)
  }

  get appliedVolumes(): number[][] {
    return this.scripts
      .filter((script) => script.includes('const volumes = '))
      .map((script) => JSON.parse(script.match(/const volumes = (\[[^\]]*\])/)![1]!) as number[])
  }
}

function asWebContents(fake: FakeWebContents): WebContents {
  return fake as unknown as WebContents
}

describe('pane audio ducker', () => {
  it('ducks media volumes and restores the exact prior levels', async () => {
    const wc = new FakeWebContents()
    const ducker = createPaneAudioDucker(asWebContents(wc))

    ducker.duck()
    wc.respondVolumes([1, 0.5])
    await new Promise((resolve) => setImmediate(resolve))
    expect(wc.appliedVolumes).toEqual([[DUCK_FACTOR, 0.5 * DUCK_FACTOR]])

    ducker.restore()
    expect(wc.appliedVolumes).toEqual([[DUCK_FACTOR, 0.5 * DUCK_FACTOR], [1, 0.5]])
  })

  it('a restore that lands before ducking finishes cancels the duck entirely', async () => {
    const wc = new FakeWebContents()
    const ducker = createPaneAudioDucker(asWebContents(wc))

    ducker.duck()
    // Speech ends (or fails) before the page answered: no duck may apply late.
    ducker.restore()
    wc.respondVolumes([1])
    await new Promise((resolve) => setImmediate(resolve))

    expect(wc.appliedVolumes).toEqual([])

    // And the next speech ducks cleanly from the un-ducked page.
    ducker.duck()
    wc.respondVolumes([0.8])
    await new Promise((resolve) => setImmediate(resolve))
    expect(wc.appliedVolumes).toEqual([[0.8 * DUCK_FACTOR]])
  })

  it('a second duck while ducked is a no-op', async () => {
    const wc = new FakeWebContents()
    const ducker = createPaneAudioDucker(asWebContents(wc))

    ducker.duck()
    wc.respondVolumes([1])
    await new Promise((resolve) => setImmediate(resolve))
    ducker.duck()
    await new Promise((resolve) => setImmediate(resolve))

    expect(wc.appliedVolumes).toEqual([[DUCK_FACTOR]])
  })

  it('ducks the media of every frame below the top too, and puts back each frame\'s own levels (#377)', async () => {
    const embed = new FakeFrame([1, 0.6])
    const wc = new FakeWebContents([embed])
    const ducker = createPaneAudioDucker(asWebContents(wc))

    ducker.duck()
    wc.respondVolumes([0.5])
    await new Promise((resolve) => setImmediate(resolve))
    expect(embed.current).toEqual([DUCK_FACTOR, 0.6 * DUCK_FACTOR])

    ducker.restore()
    await new Promise((resolve) => setImmediate(resolve))
    expect(embed.current).toEqual([1, 0.6])
    expect(wc.appliedVolumes.at(-1)).toEqual([0.5])
  })
})
