import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScriptedBacklight, createSysfsBacklight } from './backlight'

/** A /sys/class/backlight with `intel_backlight` on card1-eDP-1 and `acpi_video0` on the GPU itself. */
function fakeSys(): string {
  const sys = mkdtempSync(join(tmpdir(), 'backlight-'))
  const root = join(sys, 'class', 'backlight')
  mkdirSync(join(sys, 'devices', 'card1-eDP-1'), { recursive: true })
  mkdirSync(join(sys, 'devices', '0000:00:02.0'), { recursive: true })
  for (const [name, device, level, max] of [
    ['intel_backlight', 'card1-eDP-1', '48000', '96000'],
    ['acpi_video0', '0000:00:02.0', '7', '15'],
  ]) {
    mkdirSync(join(root, name), { recursive: true })
    symlinkSync(join(sys, 'devices', device), join(root, name, 'device'))
    writeFileSync(join(root, name, 'brightness'), `${level}\n`)
    writeFileSync(join(root, name, 'max_brightness'), `${max}\n`)
  }
  return root
}

describe('backlight', () => {
  it('lists the kernel backlights by name and connector, and reads their levels', async () => {
    const backlight = createSysfsBacklight({ root: fakeSys() })
    expect(await backlight.list()).toEqual([
      { model: 'acpi_video0', connector: 'built-in', backlight: 'acpi_video0' },
      { model: 'intel_backlight', connector: 'eDP-1', backlight: 'intel_backlight' },
    ])
    expect(await backlight.read('intel_backlight')).toEqual({ current: 48000, max: 96000 })
    await expect(backlight.read('nope')).rejects.toThrow()
  })

  it('lists none where the kernel has no backlight class', async () => {
    expect(await createSysfsBacklight({ root: join(tmpdir(), 'no-such-backlight-root') }).list()).toEqual([])
  })

  it("sets a level through logind's SetBrightness on the caller's session, bounded by the timeout", async () => {
    const seen: string[] = []
    const backlight = createSysfsBacklight({
      root: fakeSys(),
      timeoutMs: 1234,
      exec: async (file, args, timeoutMs) => {
        seen.push(`${file} ${args.join(' ')} ${timeoutMs}`)
        return ''
      },
    })
    await backlight.set('intel_backlight', 38400)
    expect(seen).toEqual(['busctl call org.freedesktop.login1 /org/freedesktop/login1/session/auto org.freedesktop.login1.Session SetBrightness ssu backlight intel_backlight 38400 1234'])
  })

  it('stands in with the scripted backlights, logging each read and set', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'backlight-')), 'calls.log')
    const backlight = createScriptedBacklight(JSON.stringify({ backlights: [{ name: 'intel_backlight', connector: 'card1-eDP-1', level: 96000, max: 96000 }], log }))
    expect(await backlight.list()).toEqual([{ model: 'intel_backlight', connector: 'eDP-1', backlight: 'intel_backlight' }])
    await backlight.set('intel_backlight', 38400)
    expect(await backlight.read('intel_backlight')).toEqual({ current: 38400, max: 96000 })
    expect(readFileSync(log, 'utf8')).toBe('backlight set intel_backlight 38400\nbacklight get intel_backlight\n')
    expect(await createScriptedBacklight('{}').list()).toEqual([])
  })
})
