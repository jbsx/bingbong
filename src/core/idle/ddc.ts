// What ddcutil says, read (#413): the displays `detect --terse` can drive
// and the brightness `getvcp 10 --terse` reports. Night Dim lowers a
// monitor's own brightness over DDC/CI through these; the calls themselves
// are main's.

import type { NightDimMonitor } from './nightDim'

/** A display ddcutil can drive: its model and connector, which stay, and the I²C bus it is on now, which may not. */
export interface DdcDisplay extends NightDimMonitor {
  bus: number
}

/** The displays in `ddcutil detect --terse`, in its order; an invalid or phantom display is left out. */
export function parseDetect(text: string): DdcDisplay[] {
  const displays: DdcDisplay[] = []
  // Each display is a block headed by an unindented line: `Display 1`, `Invalid display`, `Phantom display`.
  for (const block of text.split(/\n(?=\S)/)) {
    if (!/^Display \d+/.test(block)) continue
    const bus = /I2C bus:\s*\/dev\/i2c-(\d+)/.exec(block)
    if (bus === null) continue
    // `i2c-N` when ddcutil names no connector.
    const connector = /DRM[ _]connector:\s*(?:card\d+-)?(\S+)/.exec(block)
    // `Monitor: mfg:model:serial`.
    const monitor = /Monitor:\s*[^:\n]*:([^:\n]*):/.exec(block)
    displays.push({ bus: Number(bus[1]), model: monitor?.[1].trim() ?? '', connector: connector?.[1] ?? `i2c-${bus[1]}` })
  }
  return displays
}

/** The brightness in `getvcp 10 --terse` (`VCP 10 C 40 100`); none for an error or anything else. */
export function parseBrightness(text: string): { current: number; max: number } | null {
  const match = /^VCP 10 C (\d+) (\d+)/m.exec(text)
  return match === null ? null : { current: Number(match[1]), max: Number(match[2]) }
}
