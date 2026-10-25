import { appendFileSync } from 'node:fs'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { backlightConnector, type BacklightDisplay, type BacklightPort } from '../../core/idle/backlight'
import { DDC_SCRIPT_ENV, DDC_TIMEOUT_MS, execFileText, parseDdcScript, type ExecFile } from './ddcRun'

// A built-in panel's backlight for Night Dim. Its levels are read from
// /sys/class/backlight, which anyone may; it is set through logind's
// Session.SetBrightness, which lets the user at the screen do it with no
// root and no udev rule (`busctl` ships with systemd). Each set is bounded
// at 3 s, as a ddcutil call is.
//
// With BINGBONG_DDC_SCRIPT set, the script's backlights answer instead and
// no test or agent run ever reaches the real panel.

export const BACKLIGHT_ROOT = '/sys/class/backlight'

const readLevel = async (path: string): Promise<number> => {
  const text = (await readFile(path, 'utf8')).trim()
  const level = Number(text)
  if (!Number.isInteger(level)) throw new Error(`${path} holds ${JSON.stringify(text)}, not a level`)
  return level
}

/** logind's SetBrightness on the caller's session, `busctl call … ssu backlight <name> <level>`. */
export const setBrightnessArgs = (name: string, level: number): string[] => [
  'call',
  'org.freedesktop.login1',
  '/org/freedesktop/login1/session/auto',
  'org.freedesktop.login1.Session',
  'SetBrightness',
  'ssu',
  'backlight',
  name,
  String(level),
]

/** The kernel's backlights, read from sysfs and set through logind. */
export function createSysfsBacklight(options: { root?: string; exec?: ExecFile; timeoutMs?: number } = {}): BacklightPort {
  const root = options.root ?? BACKLIGHT_ROOT
  const exec = options.exec ?? execFileText
  const timeoutMs = options.timeoutMs ?? DDC_TIMEOUT_MS
  return {
    async list() {
      let names: string[]
      try {
        names = (await readdir(root)).sort()
      } catch (error) {
        // No backlight class at all: a desktop with only external monitors.
        if ((error as { code?: unknown }).code === 'ENOENT') return []
        throw error
      }
      return Promise.all(
        names.map(async (name): Promise<BacklightDisplay> => {
          const device = await realpath(join(root, name, 'device')).then(basename, () => null)
          return { model: name, connector: backlightConnector(device), backlight: name }
        }),
      )
    },
    async read(name) {
      return { current: await readLevel(join(root, name, 'brightness')), max: await readLevel(join(root, name, 'max_brightness')) }
    },
    async set(name, level) {
      await exec('busctl', setBrightnessArgs(name, level), timeoutMs)
    },
  }
}

/** The stand-in: the script's backlights, each read and set logged as `backlight get|set <name> [level]`. */
export function createScriptedBacklight(json: string): BacklightPort {
  const script = parseDdcScript(json)
  const lights = new Map((script.backlights ?? []).map((light) => [light.name, { ...light }]))
  const log = (line: string): void => {
    if (script.log !== undefined) appendFileSync(script.log, `${line}\n`)
  }
  const lightOf = (name: string) => {
    const light = lights.get(name)
    if (light === undefined) throw new Error(`no backlight ${name}`)
    return light
  }
  return {
    list: async () => [...lights.values()].map((light) => ({ model: light.name, connector: backlightConnector(light.connector), backlight: light.name })),
    read: async (name) => {
      log(`backlight get ${name}`)
      const light = lightOf(name)
      return { current: light.level, max: light.max }
    },
    set: async (name, level) => {
      log(`backlight set ${name} ${level}`)
      lightOf(name).level = level
    },
  }
}

/** The scripted backlights when the env names a script, else the kernel's. */
export function createBacklight(env: NodeJS.ProcessEnv): BacklightPort {
  const script = env[DDC_SCRIPT_ENV]
  return script ? createScriptedBacklight(script) : createSysfsBacklight()
}
