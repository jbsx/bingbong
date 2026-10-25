// A built-in panel's backlight (the kernel's /sys/class/backlight): what an
// eDP laptop panel has in place of DDC/CI, which it does not implement, so
// `ddcutil detect` finds nothing on it. Night Dim lowers it the same way it
// lowers a monitor over DDC/CI; the reads and the calls are main's.

import type { NightDimMonitor } from './nightDim'

/** A backlight as Night Dim lists it: the device's own name as the model, `intel_backlight`, and its DRM connector, `eDP-1`. */
export interface BacklightDisplay extends NightDimMonitor {
  /** The device under /sys/class/backlight. */
  backlight: string
}

export interface BacklightPort {
  /** Every backlight the kernel has; none on a machine without one. */
  list(): Promise<BacklightDisplay[]>
  /** Its brightness now and the most it takes, in the device's own steps. */
  read(name: string): Promise<{ current: number; max: number }>
  /** Sets its brightness, in the device's own steps; rejects on a failure or a timeout. */
  set(name: string, level: number): Promise<void>
}

/** The connector a backlight's `device` link resolves to (`card1-eDP-1` is `eDP-1`); `built-in` when it is not a connector (`acpi_video0` hangs off the GPU). */
export function backlightConnector(deviceName: string | null): string {
  const match = deviceName === null ? null : /^card\d+-(.+)$/.exec(deviceName)
  return match?.[1] ?? 'built-in'
}
