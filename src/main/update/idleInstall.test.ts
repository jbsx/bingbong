import { describe, expect, it } from 'vitest'
import { createIdleInstall, restsForUpdate } from './idleInstall'

const RESTING = { up: true, open: false, prompting: false }

describe('restsForUpdate', () => {
  it('is true only on the Idle Screen with its Prompt shut', () => {
    expect(restsForUpdate(RESTING)).toBe(true)
    expect(restsForUpdate({ up: false, open: false, prompting: false })).toBe(false)
    expect(restsForUpdate({ up: true, open: true, prompting: false })).toBe(false)
    expect(restsForUpdate({ up: true, open: true, prompting: true })).toBe(false)
  })
})

describe('createIdleInstall', () => {
  function harness() {
    const shown = new Map<number, typeof RESTING>()
    const installs: string[] = []
    const gate = createIdleInstall({ windows: () => [...shown.values()], install: () => installs.push('install') })
    return { shown, installs, gate }
  }

  it('waits for the Idle Screen when an update finishes downloading during a command (ADR 0090)', () => {
    const { shown, installs, gate } = harness()
    shown.set(1, { up: false, open: false, prompting: false })
    gate.downloaded('0.1.2')
    expect(installs).toEqual([])

    shown.set(1, RESTING)
    gate.shownChanged()
    expect(installs).toEqual(['install'])
  })

  it('installs at once when the download lands while the Idle Screen is up', () => {
    const { shown, installs, gate } = harness()
    shown.set(1, RESTING)
    gate.downloaded('0.1.2')
    expect(installs).toEqual(['install'])
  })

  it('never installs with nothing downloaded, nor with no window, nor twice', () => {
    const { shown, installs, gate } = harness()
    gate.downloaded('0.1.2')
    expect(installs).toEqual([])
    shown.set(1, RESTING)
    gate.shownChanged()
    gate.shownChanged()
    gate.downloaded('0.1.2')
    expect(installs).toEqual(['install'])

    const idle = harness()
    idle.shown.set(1, RESTING)
    idle.gate.shownChanged()
    expect(idle.installs).toEqual([])
  })

  it('waits while any window is busy', () => {
    const { shown, installs, gate } = harness()
    shown.set(1, RESTING)
    shown.set(2, { up: true, open: true, prompting: true })
    gate.downloaded('0.1.2')
    expect(installs).toEqual([])
  })
})
