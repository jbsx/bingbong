import { describe, expect, it } from 'vitest'
import { createIdleInstall } from './idleInstall'
import { createCheckNow, type ReleaseCheck } from './checkNow'

const BUSY = { up: false, open: false, prompting: false }

describe('createCheckNow (#422)', () => {
  function harness(check: () => Promise<ReleaseCheck | null> = async () => null) {
    const installs: string[] = []
    const checks: string[] = []
    // A command is under way: the Idle Screen's gate alone would never install.
    const gate = createIdleInstall({ windows: () => [BUSY], install: () => installs.push('install') })
    const checkNow = createCheckNow({
      gate,
      runningVersion: '0.1.1',
      check: () => {
        checks.push('check')
        return check()
      },
    })
    return { installs, checks, gate, checkNow }
  }

  it('installs a Release already downloaded at once, past the Idle Screen, once the Answer is said', async () => {
    const { installs, checks, gate, checkNow } = harness()
    gate.downloaded('0.1.2')
    expect(installs).toEqual([])

    const result = await checkNow()
    expect(result).toMatchObject({ kind: 'installing', version: '0.1.2' })
    // The runner says the Answer first; nothing installs until it calls.
    expect(installs).toEqual([])
    expect(checks).toEqual([])
    if (result.kind !== 'installing') throw new Error('not installing')
    result.install()
    result.install()
    gate.shownChanged()
    expect(installs).toEqual(['install'])
  })

  it('says a newer Release found is downloading, and leaves its install to the Idle Screen', async () => {
    const { installs, gate, checkNow } = harness(async () => ({ available: true, version: '0.1.2' }))
    expect(await checkNow()).toEqual({ kind: 'downloading', version: '0.1.2' })

    // The download lands mid-command: the gate holds it, as the hourly check's (the guess #422 names).
    gate.downloaded('0.1.2')
    expect(installs).toEqual([])
  })

  it('installs a Release whose download lands while the check is out', async () => {
    let gate: ReturnType<typeof createIdleInstall> | null = null
    const run = harness(async () => {
      gate!.downloaded('0.1.2')
      return { available: true, version: '0.1.2' }
    })
    gate = run.gate
    expect(await run.checkNow()).toMatchObject({ kind: 'installing', version: '0.1.2' })
  })

  it('says the running version when no newer Release is out', async () => {
    const { checkNow } = harness(async () => ({ available: false, version: '0.1.1' }))
    expect(await checkNow()).toEqual({ kind: 'current', version: '0.1.1' })
  })

  it('reads an inactive updater as unavailable', async () => {
    const { checkNow } = harness(async () => null)
    expect(await checkNow()).toEqual({ kind: 'unavailable' })
  })

  it('reads a check that throws as failed, installing nothing', async () => {
    const { installs, checkNow } = harness(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    expect(await checkNow()).toEqual({ kind: 'failed' })
    expect(installs).toEqual([])
  })
})
