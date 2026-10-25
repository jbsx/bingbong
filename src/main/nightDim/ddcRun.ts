import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import type { DdcRun } from '../../core/idle/monitorDim'

// The ddcutil runs Night Dim makes (#413). One queue for all of them, since
// two calls on one bus must not overlap, and each bounded at 3 s: a monitor
// that stops answering costs the night its DDC dim, never a hung call.
//
// With BINGBONG_DDC_SCRIPT set, a scripted monitor answers instead and no
// test or agent run ever reaches a real one; the e2e harness always sets it.
// It scripts the backlights too (./backlight.ts).

export const DDC_SCRIPT_ENV = 'BINGBONG_DDC_SCRIPT'
export const DDC_TIMEOUT_MS = 3000

/** Runs one program with args, answering its stdout; rejects on a non-zero exit, a spawn failure or the timeout. */
export type ExecFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>

export const execFileText: ExecFile = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error === null) return resolve(stdout)
      if (error.killed) return reject(Object.assign(new Error(`${file} ${args.join(' ')} timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' }))
      const said = stderr.trim() || stdout.trim()
      reject(Object.assign(new Error(said === '' ? error.message : `${file} ${args.join(' ')}: ${said}`), { code: error.code }))
    })
  })

/** Every call through one queue: the next starts when the one before has settled. */
export function queued(run: DdcRun): DdcRun {
  let tail: Promise<unknown> = Promise.resolve()
  return (args) => {
    const call = tail.then(
      () => run(args),
      () => run(args),
    )
    tail = call.catch(() => undefined)
    return call
  }
}

/** ddcutil itself, queued and bounded. */
export function createDdcutilRun(options: { exec?: ExecFile; timeoutMs?: number } = {}): DdcRun {
  const exec = options.exec ?? execFileText
  const timeoutMs = options.timeoutMs ?? DDC_TIMEOUT_MS
  return queued((args) => exec('ddcutil', args, timeoutMs))
}

/** The scripted monitor's script: the displays it lists and the brightness it starts at. */
export interface DdcScript {
  /** Each display as detect lists it: `{ bus: 0, connector: 'card0-HDMI-A-1', monitor: 'PHL:PHL 325E1:UK0' }`. */
  displays?: { bus: number; connector: string; monitor: string }[]
  /** The brightness every display starts at. */
  level?: number
  /** A call that fails, as a timed-out one would. */
  fail?: 'detect' | 'get' | 'set'
  /** ddcutil not installed. */
  missing?: boolean
  /** A file each call is appended to, one line of args each, for the e2e to read. */
  log?: string
  /** Each built-in panel's backlight: `{ name: 'intel_backlight', connector: 'card1-eDP-1', level: 96000, max: 96000 }`. */
  backlights?: { name: string; connector: string; level: number; max: number }[]
}

const SCRIPT_SHAPE = `${DDC_SCRIPT_ENV} must be a JSON object: { displays, level, fail, missing, log, backlights }`

export function parseDdcScript(json: string): DdcScript {
  let script: DdcScript
  try {
    script = JSON.parse(json) as DdcScript
  } catch (error) {
    throw new Error(SCRIPT_SHAPE, { cause: error })
  }
  if (typeof script !== 'object' || script === null || Array.isArray(script)) throw new Error(SCRIPT_SHAPE)
  return script
}

/** The stand-in for ddcutil: answers detect, getvcp and setvcp as a monitor would and touches no bus. */
export function createScriptedDdcRun(json: string): DdcRun {
  const script = parseDdcScript(json)
  const displays = script.displays ?? []
  const levels = new Map(displays.map((display) => [display.bus, script.level ?? 50]))
  return queued(async (args) => {
    if (script.log !== undefined) appendFileSync(script.log, `${args.join(' ')}\n`)
    if (script.missing === true) throw Object.assign(new Error('spawn ddcutil ENOENT'), { code: 'ENOENT' })
    if (args[0] === 'detect') {
      if (script.fail === 'detect') throw new Error('ddcutil detect --terse timed out')
      if (displays.length === 0) return 'No displays found.\n'
      return displays.map((display, index) => `Display ${index + 1}\n   I2C bus:          /dev/i2c-${display.bus}\n   DRM connector:    ${display.connector}\n   Monitor:          ${display.monitor}\n`).join('\n')
    }
    const bus = Number(args[args.indexOf('--bus') + 1])
    const level = levels.get(bus)
    if (level === undefined) throw new Error(`ddcutil: no display on bus ${bus}`)
    if (args.includes('getvcp')) {
      if (script.fail === 'get') throw new Error(`ddcutil ${args.join(' ')} timed out`)
      return `VCP 10 C ${level} 100\n`
    }
    if (script.fail === 'set') throw new Error(`ddcutil ${args.join(' ')} timed out`)
    levels.set(bus, Number(args[args.length - 1]))
    return ''
  })
}

/** The scripted monitor when the env names one, else ddcutil. */
export function createDdcRun(env: NodeJS.ProcessEnv): DdcRun {
  const script = env[DDC_SCRIPT_ENV]
  return script ? createScriptedDdcRun(script) : createDdcutilRun()
}
