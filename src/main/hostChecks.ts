import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { HostFinding } from '../core/settings/hostFindings'

// The host checks (#419, ADR 0090): the installed app looks once at boot for
// what it needs from the machine and cannot ship — aplay, a microphone, a
// display. Each one missing is one line in the fault log and on the Settings
// page; there is no separate preflight script.

/** What the checks read of the machine: the real one in main, a fake in tests. */
export interface HostProbe {
  platform: string
  env: Record<string, string | undefined>
  /** The player speech, the chime and the alarm play through (PiperConfig.playerBin). */
  playerBin: string
  onPath(bin: string): boolean
  /** The entries of /dev/snd; throws when it cannot be read. */
  soundDevices(): string[]
}

/** An ALSA capture PCM: `pcmC<card>D<device>c`. */
const CAPTURE_DEVICE = /^pcmC\d+D\d+c$/

function hasCaptureDevice(probe: HostProbe): boolean {
  try {
    return probe.soundDevices().some((name) => CAPTURE_DEVICE.test(name))
  // eslint-disable-next-line no-restricted-syntax -- an unreadable /dev/snd is the finding itself
  } catch {
    return false
  }
}

/** What is missing, one finding each, in the order aplay, microphone, display. */
export function checkHost(probe: HostProbe): HostFinding[] {
  const found: HostFinding[] = []
  if (!probe.onPath(probe.playerBin)) {
    found.push({
      check: 'aplay',
      message: `aplay is not installed (no '${probe.playerBin}' on PATH): nothing the app says or chimes can be heard. Install alsa-utils.`,
    })
  }
  // The devices and the display are read the Linux way; the Mac build checks its own later.
  if (probe.platform !== 'linux') return found
  if (!hasCaptureDevice(probe)) {
    found.push({ check: 'microphone', message: 'No microphone: the sound system has no capture device, so the app cannot hear the wake word or a command.' })
  }
  if (!probe.env.DISPLAY?.trim() && !probe.env.WAYLAND_DISPLAY?.trim()) {
    found.push({ check: 'display', message: 'No display is set (DISPLAY and WAYLAND_DISPLAY are empty): the app has no screen to draw on.' })
  }
  return found
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  // eslint-disable-next-line no-restricted-syntax -- absent or not executable is the answer, not a fault
  } catch {
    return false
  }
}

/** True when `bin` runs: its own path when it has one, else the first match on PATH. */
export function findOnPath(bin: string, path: string): boolean {
  if (bin.includes('/')) return isExecutableFile(bin)
  return path.split(delimiter).some((dir) => dir !== '' && isExecutableFile(join(dir, bin)))
}

/** The checks against this machine. */
export function checkThisHost(env: Record<string, string | undefined>, playerBin: string): HostFinding[] {
  return checkHost({
    platform: process.platform,
    env,
    playerBin,
    onPath: (bin) => findOnPath(bin, env.PATH ?? ''),
    soundDevices: () => readdirSync('/dev/snd'),
  })
}
