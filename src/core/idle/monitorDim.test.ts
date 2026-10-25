import { describe, expect, it } from 'vitest'
import type { BacklightPort } from './backlight'
import { createMonitorDim, type DimRecord, type MonitorDimState } from './monitorDim'
import { defaultNightDim, type NightDim } from './nightDim'

const DETECT = `Display 1
   I2C bus:          /dev/i2c-0
   DRM connector:    card0-HDMI-A-1
   Monitor:          PHL:PHL 325E1:UK02123456789

Display 2
   I2C bus:          /dev/i2c-1
   DRM connector:    card0-DVI-D-1
   Monitor:          WAN:27MQ95FSHDRU:0000000001
`

const PHILIPS = { model: 'PHL 325E1', connector: 'HDMI-A-1' }
const PANEL = { model: 'intel_backlight', connector: 'eDP-1' }
const night = new Date(2026, 9, 24, 23, 30)
const day = new Date(2026, 9, 24, 12, 0)
const picked: NightDim = { ...defaultNightDim(), enabled: true, brightnessPercent: 40, monitor: PHILIPS }

/** A monitor on the bus that answers ddcutil's args as the real one does, and keeps every call; with `panel`, a built-in panel's backlight beside it, its calls kept too. */
function fakeMonitor(options: { level?: number; detect?: string; fail?: 'get' | 'set' | 'detect'; missing?: boolean; panel?: number } = {}) {
  const monitor = { level: options.level ?? 40, panel: options.panel ?? 0, calls: [] as string[], fail: options.fail }
  const backlight: BacklightPort = {
    list: async () => (options.panel === undefined ? [] : [{ ...PANEL, backlight: 'intel_backlight' }]),
    read: async (name) => {
      monitor.calls.push(`backlight get ${name}`)
      return { current: monitor.panel, max: 96000 }
    },
    set: async (name, level) => {
      monitor.calls.push(`backlight set ${name} ${level}`)
      if (monitor.fail === 'set') throw new Error('SetBrightness timed out')
      monitor.panel = level
    },
  }
  const run = async (args: readonly string[]): Promise<string> => {
    monitor.calls.push(args.join(' '))
    if (options.missing) throw Object.assign(new Error('spawn ddcutil ENOENT'), { code: 'ENOENT' })
    if (args[0] === 'detect') {
      if (monitor.fail === 'detect') throw new Error('detect timed out')
      return options.detect ?? DETECT
    }
    if (args.includes('getvcp')) {
      if (monitor.fail === 'get') throw new Error('getvcp timed out')
      return `VCP 10 C ${monitor.level} 100\n`
    }
    if (monitor.fail === 'set') throw new Error('setvcp timed out')
    monitor.level = Number(args[args.length - 1])
    return ''
  }
  return { monitor, run, backlight }
}

function memoryRecovery(start: DimRecord | null = null) {
  const store = { record: start, read: () => store.record, write: (record: DimRecord) => void (store.record = record), clear: () => void (store.record = null) }
  return store
}

function setup(options: Parameters<typeof fakeMonitor>[0] = {}, recoveryStart: DimRecord | null = null) {
  const { monitor, run, backlight } = fakeMonitor(options)
  const recovery = memoryRecovery(recoveryStart)
  const dimmed: boolean[] = []
  const dim = createMonitorDim({ run, backlight, recovery, onDimmed: (value) => dimmed.push(value) })
  const at = (idleUp: boolean, now: Date, nightDim = picked): MonitorDimState => ({ idleUp, now, nightDim })
  return { monitor, recovery, dimmed, dim, at }
}

describe('monitorDim', () => {
  it('lowers the picked monitor to its share of the day level when the Idle Screen is up inside the window, and the veil stands down', async () => {
    const { monitor, dimmed, dim, at } = setup()
    await dim.update(at(true, night))
    expect(monitor.calls).toEqual(['detect --terse', '--bus 0 getvcp 10 --terse', '--bus 0 setvcp 10 16'])
    expect(monitor.level).toBe(16)
    expect(dimmed).toEqual([true])
    expect(dim.dimmed()).toBe(true)
  })

  it('restores the day level when the dashboard wakes, and lowers again when the Idle Screen comes back', async () => {
    const { monitor, dimmed, dim, at, recovery } = setup()
    await dim.update(at(true, night))
    await dim.update(at(false, night))
    expect(monitor.level).toBe(40)
    expect(recovery.record).toBeNull()
    await dim.update(at(true, night))
    expect(monitor.level).toBe(16)
    expect(dimmed).toEqual([true, false, true])
    // The bus is known now: no second detect.
    expect(monitor.calls.filter((call) => call.startsWith('detect'))).toHaveLength(1)
  })

  it('changes nothing outside the window, with the setting off, or with the veil only', async () => {
    const { monitor, dimmed, dim, at } = setup()
    await dim.update(at(true, day))
    await dim.update(at(true, night, { ...picked, enabled: false }))
    await dim.update(at(true, night, { ...picked, monitor: null }))
    await dim.update(at(false, night))
    expect(monitor.calls).toEqual([])
    expect(dimmed).toEqual([])
  })

  it('restores the day level when the window ends under the Idle Screen', async () => {
    const { monitor, dimmed, dim, at } = setup()
    await dim.update(at(true, night))
    await dim.update(at(true, new Date(2026, 9, 25, 7, 0)))
    expect(monitor.level).toBe(40)
    expect(dimmed).toEqual([true, false])
  })

  it('keeps the veil for a monitor already at its floor', async () => {
    const { monitor, dimmed, dim, at, recovery } = setup({ level: 0 })
    await dim.update(at(true, night))
    expect(monitor.calls).toEqual(['detect --terse', '--bus 0 getvcp 10 --terse'])
    expect(dimmed).toEqual([])
    expect(recovery.record).toBeNull()
  })

  it('keeps the veil for the rest of the night after a call fails, and logs the fault', async () => {
    const { setFaultSink } = await import('../trace/fault')
    const faults: string[] = []
    setFaultSink((report) => faults.push(`${report.site}: ${report.message}`))
    try {
      const { monitor, dimmed, dim, at } = setup({ fail: 'get' })
      await dim.update(at(true, night))
      monitor.fail = undefined
      await dim.update(at(false, night))
      await dim.update(at(true, night))
      expect(monitor.calls.filter((call) => call.includes('getvcp'))).toHaveLength(1)
      expect(dimmed).toEqual([])
      expect(faults).toEqual(['idle.monitorDim.lower: getvcp timed out'])
      // The next night tries again.
      await dim.update(at(true, day))
      await dim.update(at(true, night))
      expect(monitor.level).toBe(16)
    } finally {
      setFaultSink(null)
    }
  })

  it('keeps the veil when the picked monitor is not found', async () => {
    const { dimmed, dim, at } = setup()
    await dim.update(at(true, night, { ...picked, monitor: { model: 'DELL U2415', connector: 'DP-1' } }))
    expect(dimmed).toEqual([])
    expect(dim.dimmed()).toBe(false)
  })

  it('finds the picked monitor by model and connector after its bus renumbers', async () => {
    const renumbered = DETECT.replace('/dev/i2c-0', '/dev/i2c-7')
    const { monitor, dim, at } = setup({ detect: renumbered })
    await dim.update(at(true, night))
    expect(monitor.calls).toContain('--bus 7 setvcp 10 16')
  })

  it('writes the day level before lowering and puts it back on quit', async () => {
    const { monitor, dim, at, recovery } = setup()
    await dim.update(at(true, night))
    expect(recovery.record).toEqual({ ...PHILIPS, bus: 0, dayLevel: 40 })
    await dim.restore()
    expect(monitor.level).toBe(40)
    expect(recovery.record).toBeNull()
    expect(dim.dimmed()).toBe(false)
  })

  it('at boot, restores the level a crash at night left and deletes the record', async () => {
    const { monitor, dim, recovery } = setup({ level: 16 }, { ...PHILIPS, bus: 0, dayLevel: 40 })
    await dim.recover()
    expect(monitor.level).toBe(40)
    expect(recovery.record).toBeNull()
  })

  it('keeps the record when the restore at boot fails, for the next boot', async () => {
    const left = { ...PHILIPS, bus: 0, dayLevel: 40 }
    const { dim, recovery } = setup({ level: 16, fail: 'set' }, left)
    await dim.recover()
    expect(recovery.record).toEqual(left)
  })

  it('keeps the day level the record holds when a restore failed, never taking the dimmed level for it', async () => {
    const { monitor, dim, at, recovery } = setup()
    await dim.update(at(true, night))
    monitor.fail = 'set'
    await dim.update(at(false, night))
    monitor.fail = undefined
    // The restore is tried again on the next update, back to the level read by day.
    await dim.update(at(false, night))
    expect(monitor.level).toBe(40)
    expect(recovery.record).toBeNull()
  })

  it('takes the day level from a record a failed restore left, when lowering again', async () => {
    const { monitor, dim, at, recovery } = setup({ level: 16 }, { ...PHILIPS, bus: 0, dayLevel: 40 })
    await dim.update(at(true, night))
    expect(monitor.calls).toContain('--bus 0 setvcp 10 16')
    expect(recovery.record).toEqual({ ...PHILIPS, bus: 0, dayLevel: 40 })
    await dim.update(at(false, night))
    expect(monitor.level).toBe(40)
  })

  it('has work to finish before a quit while a lower is still in flight', async () => {
    const { dim, at } = setup()
    const lowering = dim.update(at(true, night))
    expect(dim.busy()).toBe(true)
    await lowering
    expect(dim.busy()).toBe(false)
    expect(dim.dimmed()).toBe(true)
  })

  it('says in the monitor list why the veil dimmed instead tonight', async () => {
    const { dim, at } = setup({ fail: 'set' })
    await dim.update(at(true, night))
    expect((await dim.monitors()).note).toBe('The veil dimmed instead tonight: setvcp timed out')
  })

  it('at boot with no record, makes no call', async () => {
    const { monitor, dim } = setup()
    await dim.recover()
    expect(monitor.calls).toEqual([])
  })

  it('lists the monitors ddcutil finds, or says why there are none', async () => {
    expect(await setup().dim.monitors()).toEqual({
      monitors: [
        { bus: 0, ...PHILIPS },
        { bus: 1, model: '27MQ95FSHDRU', connector: 'DVI-D-1' },
      ],
      note: '',
    })
    expect(await setup({ missing: true }).dim.monitors()).toEqual({ monitors: [], note: 'ddcutil not installed — see the README' })
    expect(await setup({ detect: 'No displays found.\n' }).dim.monitors()).toEqual({ monitors: [], note: 'No monitor answers over DDC/CI, and no backlight — see the README' })
    expect((await setup({ fail: 'detect' }).dim.monitors()).note).toBe('ddcutil detect failed: detect timed out')
  })

  describe('a built-in panel, which has no DDC/CI', () => {
    const onPanel: NightDim = { ...picked, monitor: PANEL }

    it('lists its backlight beside the monitors, with nothing to say when ddcutil is missing or finds none', async () => {
      const panel = { ...PANEL, backlight: 'intel_backlight' }
      expect(await setup({ missing: true, panel: 96000 }).dim.monitors()).toEqual({ monitors: [panel], note: '' })
      expect(await setup({ detect: 'No displays found.\n', panel: 96000 }).dim.monitors()).toEqual({ monitors: [panel], note: '' })
      expect((await setup({ panel: 96000 }).dim.monitors()).monitors).toEqual([{ bus: 0, ...PHILIPS }, { bus: 1, model: '27MQ95FSHDRU', connector: 'DVI-D-1' }, panel])
    })

    it('lowers the picked backlight to its share of the day level and puts it back, with ddcutil missing', async () => {
      const { monitor, dimmed, dim, at, recovery } = setup({ missing: true, panel: 96000 })
      await dim.update(at(true, night, onPanel))
      expect(monitor.calls).toEqual(['detect --terse', 'backlight get intel_backlight', 'backlight set intel_backlight 38400'])
      expect(recovery.record).toEqual({ ...PANEL, backlight: 'intel_backlight', dayLevel: 96000 })
      expect(dimmed).toEqual([true])
      await dim.update(at(false, night, onPanel))
      expect(monitor.panel).toBe(96000)
      expect(recovery.record).toBeNull()
      expect(dimmed).toEqual([true, false])
    })

    it('at boot, restores the backlight a crash at night left by its name, with no detect', async () => {
      const { monitor, dim, recovery } = setup({ missing: true, panel: 38400 }, { ...PANEL, backlight: 'intel_backlight', dayLevel: 96000 })
      await dim.recover()
      expect(monitor.calls).toEqual(['backlight set intel_backlight 96000'])
      expect(recovery.record).toBeNull()
    })

    it('keeps the veil when the set fails, and says why', async () => {
      const { dimmed, dim, at, recovery } = setup({ missing: true, panel: 96000, fail: 'set' })
      await dim.update(at(true, night, onPanel))
      expect(dimmed).toEqual([])
      // The record stays until a raise lands: the panel may have gone down.
      expect(recovery.record).toEqual({ ...PANEL, backlight: 'intel_backlight', dayLevel: 96000 })
      expect((await dim.monitors()).note).toBe('The veil dimmed instead tonight: SetBrightness timed out')
    })

    it('keeps the veil, with ddcutil\'s own failure, when the picked backlight is gone and ddcutil failed', async () => {
      const { dimmed, dim, at } = setup({ missing: true })
      await dim.update(at(true, night, onPanel))
      expect(dimmed).toEqual([])
      expect((await dim.monitors()).note).toBe('ddcutil not installed — see the README')
    })
  })
})
