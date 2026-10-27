import { afterEach, describe, expect, it, vi } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))

const { attachUpdater } = await import('./attachUpdater')

afterEach(() => setFaultSink(null))

describe('attachUpdater outside the installed AppImage (#422)', () => {
  it('answers an update asked for now as unavailable, with no fault', async () => {
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    const updater = attachUpdater({ windows: () => [], env: {} })

    expect(await updater.checkNow()).toEqual({ kind: 'unavailable' })
    expect(faults).toEqual([])
  })
})
