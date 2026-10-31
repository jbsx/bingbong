import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportRendererFault } from './diagnostics'
import { onCommandTap, tapCommand } from './tapCommand'

vi.mock('./diagnostics', () => ({ reportRendererFault: vi.fn() }))

// A tap's line reaches the Turn Card through these two: the fold hears each
// tap, and hears again only of a tap whose submit says no line ran or rejects.
// A line that ran says nothing as it settles: its reply can land before its
// events, and those still have the mark to take (#532).

describe('tapCommand', () => {
  const submits: { line: string; settle: (ran: boolean) => void; fail: (error: Error) => void }[] = []
  let told: boolean[] = []
  let unsubscribe: () => void

  beforeEach(() => {
    submits.length = 0
    told = []
    vi.stubGlobal('window', {
      bingbong: {
        assistant: {
          submit: (line: string) =>
            new Promise<boolean>((resolve, reject) => {
              submits.push({ line, settle: resolve, fail: reject })
            }),
        },
      },
    })
    unsubscribe = onCommandTap((mark) => told.push(mark))
  })

  afterEach(() => {
    unsubscribe()
    vi.unstubAllGlobals()
  })

  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('says a tap is pending before it submits the line, and nothing more once its line has run', async () => {
    tapCommand('pause')
    expect(told).toEqual([true])
    expect(submits.map((submit) => submit.line)).toEqual(['pause'])
    submits[0]!.settle(true)
    await settled()
    expect(told).toEqual([true])
  })

  it('keeps a second tap pending when the first line settles, and through the second\'s settling too', async () => {
    tapCommand('previous')
    tapCommand('pause')
    expect(told).toEqual([true, true])
    submits[0]!.settle(true)
    await settled()
    expect(told).toEqual([true, true])
    submits[1]!.settle(true)
    await settled()
    expect(told).toEqual([true, true])
  })

  it('takes back one tap for each submit that ran no line, whatever else is out', async () => {
    tapCommand('previous')
    tapCommand('pause')
    tapCommand('skip')
    submits[0]!.settle(false)
    await settled()
    expect(told).toEqual([true, true, true, false])
    submits[1]!.settle(true)
    await settled()
    expect(told).toEqual([true, true, true, false])
    submits[2]!.settle(false)
    await settled()
    expect(told).toEqual([true, true, true, false, false])
  })

  it('takes back the tap of a submit that rejects, and records the fault', async () => {
    const threw = new Error('run threw')
    tapCommand('previous')
    tapCommand('pause')
    submits[0]!.fail(threw)
    await settled()
    expect(told).toEqual([true, true, false])
    expect(vi.mocked(reportRendererFault).mock.calls).toEqual([['tapCommand.submit', threw]])
  })

  it('stops telling a listener that unsubscribed', async () => {
    unsubscribe()
    tapCommand('pause')
    submits[0]!.settle(false)
    await settled()
    expect(told).toEqual([])
  })
})
