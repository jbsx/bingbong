import { reportFault } from '../trace/fault'
import type { BacklightDisplay, BacklightPort } from './backlight'
import { parseBrightness, parseDetect, type DdcDisplay } from './ddc'
import { isNightDimmed, nightLevel, type NightDim, type NightDimMonitor } from './nightDim'

// Night Dim on the monitor itself (#413): while the Idle Screen is up inside
// the window, the picked monitor's own brightness (VCP 0x10) goes down over
// DDC/CI, or a built-in panel's through its backlight, and comes back up
// when the dashboard wakes, when the window ends and when the app quits. The veil is the fallback: veil only, a monitor
// already at its floor, or any call that fails, which also keeps the veil
// for the rest of that night. The two never apply together — `onDimmed`
// tells the dashboard when the monitor took over and when it gave back.
//
// Every call is a ddcutil run or a backlight read or set (main's, each with
// a timeout); this module decides which, in order, one at a time.

/** One ddcutil run: its args, answering its stdout; rejects on a failure or a timeout. */
export type DdcRun = (args: readonly string[]) => Promise<string>

/** A screen Night Dim can lower: a monitor on an I²C bus, or a built-in panel's backlight. */
export type DimDisplay = DdcDisplay | BacklightDisplay

/** What is written before a monitor goes down, so a crash at night cannot leave it dim: the display (its bus, for when detect no longer finds it by name) and its day level. */
export type DimRecord = DimDisplay & { dayLevel: number }

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
  monitors: DimDisplay[]
  /** Empty when a monitor or a backlight was found; otherwise why the veil is all there is. */
  note: string
}

export interface MonitorDim {
  /** Act on the state now; settles when every call it made has. */
  update(state: MonitorDimState): Promise<void>
  /** Put the day level back if the monitor is down (the app quitting). */
  restore(): Promise<void>
  /** At boot: put back the day level a crash at night left in the record. */
  recover(): Promise<void>
  /** The monitors ddcutil finds now and the backlights; also where each monitor's bus is resolved. */
  monitors(): Promise<MonitorList>
  /** Whether the monitor is down right now and the veil stands down. */
  dimmed(): boolean
  /** Whether calls are still in flight, a lower among them: a quit waits for them, then restores. */
  busy(): boolean
}

export interface MonitorDimDeps {
  run: DdcRun
  backlight: BacklightPort
  recovery: DimRecoveryStore
  onDimmed(dimmed: boolean): void
}

const getArgs = (bus: number): string[] => ['--bus', String(bus), 'getvcp', '10', '--terse']
const setArgs = (bus: number, level: number): string[] => ['--bus', String(bus), 'setvcp', '10', String(level)]

const isBacklight = (display: DimDisplay): display is BacklightDisplay => 'backlight' in display

const sameMonitor = (a: NightDimMonitor, b: NightDimMonitor): boolean => a.model === b.model && a.connector === b.connector

/** Why ddcutil could not list a monitor, as Settings says it. */
function whyNone(error: unknown): string {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') return 'ddcutil not installed — see the README'
  return `ddcutil detect failed: ${error instanceof Error ? error.message : String(error)}`
}

export function createMonitorDim(deps: MonitorDimDeps): MonitorDim {
  const { run, backlight, recovery, onDimmed } = deps
  /** The last list detect gave; a display is looked up here first, then by detecting again. */
  let displays: DimDisplay[] | null = null
  /** Why ddcutil listed nothing on the last detect, if it failed. */
  let ddcFailure: unknown = null
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

  /** Both kinds; ddcutil failing lists no monitor and keeps why, a built-in panel needing no ddcutil. */
  const detect = async (): Promise<DimDisplay[]> => {
    let monitors: DdcDisplay[] = []
    ddcFailure = null
    try {
      monitors = parseDetect(await run(['detect', '--terse']))
    } catch (error) {
      ddcFailure = error
    }
    let backlights: BacklightDisplay[] = []
    try {
      backlights = await backlight.list()
    } catch (error) {
      reportFault('idle.monitorDim.backlights', error)
    }
    displays = [...monitors, ...backlights]
    return displays
  }

  /** The display as it is reached now; none when neither kind has it. Rejects with ddcutil's own failure when that may be why. */
  const find = async (monitor: NightDimMonitor): Promise<DimDisplay | null> => {
    const known = displays?.find((display) => sameMonitor(display, monitor))
    if (known !== undefined) return known
    const found = (await detect()).find((display) => sameMonitor(display, monitor))
    if (found === undefined && ddcFailure !== null) throw ddcFailure
    return found ?? null
  }

  const setLevel = async (display: DimDisplay, level: number): Promise<void> => {
    if (isBacklight(display)) await backlight.set(display.backlight, level)
    else await run(setArgs(display.bus, level))
  }

  /** Puts the day level back and deletes the record; on a failure the record stays, for the next try and the next boot. */
  const raise = async (record: DimRecord): Promise<void> => {
    await setLevel(record, record.dayLevel)
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

  const readLevel = async (display: DimDisplay): Promise<number> => {
    if (isBacklight(display)) return (await backlight.read(display.backlight)).current
    const brightness = parseBrightness(await run(getArgs(display.bus)))
    if (brightness === null) throw new Error(`${display.model} did not report its brightness`)
    return brightness.current
  }

  const lower = async (state: MonitorDimState, monitor: NightDimMonitor): Promise<void> => {
    try {
      const display = await find(monitor)
      if (display === null) throw new Error(`${monitor.model} on ${monitor.connector} is neither on an I2C bus ddcutil can see nor a backlight`)
      // A record a failed restore left holds the true day level; the monitor's own reading would be its night one.
      const kept = recovery.read()
      const dayLevel = kept !== null && sameMonitor(kept, monitor) ? kept.dayLevel : await readLevel(display)
      const level = nightLevel(dayLevel, state.nightDim.brightnessPercent)
      // Already at its floor: only the veil goes darker.
      if (level === null) return
      const record: DimRecord = { ...display, dayLevel }
      recovery.write(record)
      await setLevel(display, level)
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
        // A backlight keeps its name; a monitor may be on another bus since.
        let found: DimRecord = record
        if (!isBacklight(record)) {
          try {
            const display = await find(record)
            if (display !== null) found = { ...display, dayLevel: record.dayLevel }
          } catch (error) {
            reportFault('idle.monitorDim.recover', error)
          }
        }
        try {
          await raise(found)
        } catch (error) {
          reportFault('idle.monitorDim.recover', error)
        }
      })
    },
    async monitors() {
      let note = ''
      await enqueue(async () => {
        if ((await detect()).length === 0) note = ddcFailure === null ? 'No monitor answers over DDC/CI, and no backlight — see the README' : whyNone(ddcFailure)
      })
      if (note === '' && whyTonight !== '') note = `The veil dimmed instead tonight: ${whyTonight}`
      return { monitors: displays ?? [], note }
    },
    dimmed: () => lowered !== null,
    busy: () => pending > 0,
  }
}
