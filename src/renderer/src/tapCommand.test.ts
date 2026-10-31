import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onCommandTap, tapCommand } from './tapCommand'

// A tap's line reaches the Turn Card through these two: the fold hears a tap
// is pending until no tap's submit is still out.

describe('tapCommand', () => {
  const submits: { line: string; settle: () => void }[] = []
  let told: boolean[] = []
  let unsubscribe: () => void

  beforeEach(() => {
    submits.length = 0
    told = []
    vi.stubGlobal('window', {
      bingbong: {
        assistant: {
          submit: (line: string) =>
            new Promise<void>((resolve) => {
              submits.push({ line, settle: resolve })
            }),
        },
      },
    })
    unsubscribe = onCommandTap((pending) => told.push(pending))
  })

  afterEach(() => {
    unsubscribe()
    vi.unstubAllGlobals()
  })

  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('says a tap is pending before it submits the line, and not once the submit settles', async () => {
    tapCommand('pause')
    expect(told).toEqual([true])
    expect(submits.map((submit) => submit.line)).toEqual(['pause'])
    submits[0]!.settle()
    await settled()
    expect(told).toEqual([true, false])
  })

  it('keeps a second tap pending when the first settles, and lets go when the second does', async () => {
    tapCommand('previous')
    tapCommand('pause')
    expect(told).toEqual([true, true])
    submits[0]!.settle()
    await settled()
    expect(told).toEqual([true, true])
    submits[1]!.settle()
    await settled()
    expect(told).toEqual([true, true, false])
  })

  it('stops telling a listener that unsubscribed', async () => {
    unsubscribe()
    tapCommand('pause')
    submits[0]!.settle()
    await settled()
    expect(told).toEqual([])
  })
})
