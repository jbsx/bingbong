import { reportFault } from '../trace/fault'
import { parseBrightness, parseDetect, type DdcDisplay } from './ddc'
import { isNightDimmed, nightLevel, type NightDim, type NightDimMonitor } from './nightDim'

// Night Dim on the monitor itself (#413): while the Idle Screen is up inside
// the window, the picked monitor's own brightness (VCP 0x10) goes down over
// DDC/CI, and comes back up when the dashboard wakes, when the window ends
// and when the app quits. The veil is the fallback: veil only, a monitor
// already at its floor, or any call that fails, which also keeps the veil
// for the rest of that night. The two never apply together — `onDimmed`
// tells the dashboard when the monitor took over and when it gave back.
//
// Every call is a ddcutil run (main's, through one queue with a timeout);
// this module decides which, in order, one at a time.

/** One ddcutil run: its args, answering its stdout; rejects on a failure or a timeout. */
export type DdcRun = (args: readonly string[]) => Promise<string>

/** What is written before a monitor goes down, so a crash at night cannot leave it dim. */
export interface DimRecord extends NightDimMonitor {
  /** The bus it was on, for when detect no longer finds it by name. */
  bus: number
  dayLevel: number
}

/** Where the {@link DimRecord} lives: `<userData>/night-dim.json` in main. */
export interface DimRecoveryStore {
  read(): DimRecord | null
  write(record: DimRecord): void
  clear(): void
}

/** What the switch decides from: whether the Idle Screen is up, the clock, and the setting. */
export interface MonitorDimState {
  idleUp: boolean
  now: Date
  nightDim: NightDim
}

/** What Settings › Screen › Monitor lists, and a line on why it lists none. */
export interface MonitorList {
  monitors: DdcDisplay[]
  /** Empty when ddcutil answered with a monitor; otherwise why the veil is all there is. */
  note: string
}

export interface MonitorDim {
  /** Act on the state now; settles when every call it made has. */
  update(state: MonitorDimState): Promise<void>
  /** Put the day level back if the monitor is down (the app quitting). */
  restore(): Promise<void>
  /** At boot: put back the day level a crash at night left in the record. */
  recover(): Promise<void>
  /** The monitors ddcutil finds now; also where each one's bus is resolved. */
  monitors(): Promise<MonitorList>
  /** Whether the monitor is down right now and the veil stands down. */
  dimmed(): boolean
  /** Whether calls are still in flight, a lower among them: a quit waits for them, then restores. */
  busy(): boolean
}

export interface MonitorDimDeps {
  run: DdcRun
  recovery: DimRecoveryStore
  onDimmed(dimmed: boolean): void
}

const getArgs = (bus: number): string[] => ['--bus', String(bus), 'getvcp', '10', '--terse']
const setArgs = (bus: number, level: number): string[] => ['--bus', String(bus), 'setvcp', '10', String(level)]

const sameMonitor = (a: NightDimMonitor, b: NightDimMonitor): boolean => a.model === b.model && a.connector === b.connector

/** Why ddcutil could not list a monitor, as Settings says it. */
function whyNone(error: unknown): string {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') return 'ddcutil not installed — see the README'
  return `ddcutil detect failed: ${error instanceof Error ? error.message : String(error)}`
}

export function createMonitorDim(deps: MonitorDimDeps): MonitorDim {
  const { run, recovery, onDimmed } = deps
  /** The last list ddcutil gave; a bus is looked up here first, then by detecting again. */
  let displays: DdcDisplay[] | null = null
  /** The monitor while it is down. */
  let lowered: DimRecord | null = null
  /** A call failed inside this window: the veil until the window ends. */
  let failedTonight = false
  /** Why, as Settings says it. */
  let whyTonight = ''
  /** A monitor whose restore failed: still down, tried again on each update while it should be up. */
  let stranded: DimRecord | null = null
  let pending = 0
  let latest: MonitorDimState | null = null
  // One step at a time: a later state waits for the calls of the one before.
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    pending += 1
    const run = (): Promise<void> => step().finally(() => (pending -= 1))
    queue = queue.then(run, run)
    return queue
  }

  const fail = (site: string, error: unknown): void => {
    failedTonight = true
    whyTonight = error instanceof Error ? error.message : String(error)
    reportFault(site, error)
  }

  const detect = async (): Promise<DdcDisplay[]> => {
    displays = parseDetect(await run(['detect', '--terse']))
    return displays
  }

  const busOf = async (monitor: NightDimMonitor): Promise<number | null> => {
    const known = displays?.find((display) => sameMonitor(display, monitor))
    if (known !== undefined) return known.bus
    return (await detect()).find((display) => sameMonitor(display, monitor))?.bus ?? null
  }

  /** Puts the day level back and deletes the record; on a failure the record stays, for the next try and the next boot. */
  const raise = async (record: DimRecord): Promise<void> => {
    await run(setArgs(record.bus, record.dayLevel))
    recovery.clear()
  }

  const bringBack = async (): Promise<void> => {
    if (lowered === null) return
    const record = lowered
    lowered = null
    onDimmed(false)
    try {
      await raise(record)
    } catch (error) {
      stranded = record
      fail('idle.monitorDim.restore', error)
    }
  }

  const retryStranded = async (): Promise<void> => {
    if (stranded === null) return
    try {
      await raise(stranded)
      stranded = null
    } catch (error) {
      reportFault('idle.monitorDim.restore', error)
    }
  }

  const readLevel = async (bus: number, monitor: NightDimMonitor): Promise<number> => {
    const brightness = parseBrightness(await run(getArgs(bus)))
    if (brightness === null) throw new Error(`${monitor.model} did not report its brightness`)
    return brightness.current
  }

  const lower = async (state: MonitorDimState, monitor: NightDimMonitor): Promise<void> => {
    try {
      const bus = await busOf(monitor)
      if (bus === null) throw new Error(`${monitor.model} on ${monitor.connector} is not on any I2C bus ddcutil can see`)
      // A record a failed restore left holds the true day level; the monitor's own reading would be its night one.
      const kept = recovery.read()
      const dayLevel = kept !== null && sameMonitor(kept, monitor) ? kept.dayLevel : await readLevel(bus, monitor)
      const level = nightLevel(dayLevel, state.nightDim.brightnessPercent)
      // Already at its floor: only the veil goes darker.
      if (level === null) return
      const record: DimRecord = { ...monitor, bus, dayLevel }
      recovery.write(record)
      await run(setArgs(bus, level))
      lowered = record
      onDimmed(true)
    } catch (error) {
      fail('idle.monitorDim.lower', error)
    }
  }

  const reconcile = async (): Promise<void> => {
    const state = latest
    if (state === null) return
    const inWindow = isNightDimmed(state.now, state.nightDim)
    if (!inWindow) {
      failedTonight = false
      whyTonight = ''
    }
    const monitor = state.nightDim.monitor
    const want = state.idleUp && inWindow && monitor !== null
    if (lowered !== null) {
      if (want && sameMonitor(lowered, monitor)) return
      await bringBack()
    }
    if (!want) await retryStranded()
    if (want && !failedTonight && stranded === null) await lower(state, monitor)
  }

  return {
    update(state) {
      latest = state
      return enqueue(reconcile)
    },
    restore() {
      return enqueue(bringBack)
    },
    recover() {
      return enqueue(async () => {
        const record = recovery.read()
        if (record === null) return
        let bus = record.bus
        try {
          bus = (await busOf(record)) ?? record.bus
        } catch (error) {
          reportFault('idle.monitorDim.recover', error)
        }
        try {
          await raise({ ...record, bus })
        } catch (error) {
          reportFault('idle.monitorDim.recover', error)
        }
      })
    },
    async monitors() {
      let note = ''
      await enqueue(async () => {
        try {
          if ((await detect()).length === 0) note = 'No monitor answers over DDC/CI — see the README'
        } catch (error) {
          displays = null
          note = whyNone(error)
        }
      })
      if (note === '' && whyTonight !== '') note = `The veil dimmed instead tonight: ${whyTonight}`
      return { monitors: displays ?? [], note }
    },
    dimmed: () => lowered !== null,
    busy: () => pending > 0,
  }
}
