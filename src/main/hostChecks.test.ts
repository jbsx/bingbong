import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkHost, findOnPath, type HostProbe } from './hostChecks'

const ALL_THERE: HostProbe = {
  platform: 'linux',
  env: { DISPLAY: ':0' },
  playerBin: 'aplay',
  onPath: () => true,
  soundDevices: () => ['controlC0', 'pcmC0D0c', 'pcmC0D0p', 'timer'],
}

describe('checkHost', () => {
  it('finds nothing on a kiosk with aplay, a microphone and a display', () => {
    expect(checkHost(ALL_THERE)).toEqual([])
  })

  it('names each missing piece in one line: aplay, a microphone, a display (#419)', () => {
    expect(checkHost({ ...ALL_THERE, env: {}, onPath: () => false, soundDevices: () => ['controlC0', 'pcmC0D0p'] })).toEqual([
      { check: 'aplay', message: "aplay is not installed (no 'aplay' on PATH): nothing the app says or chimes can be heard. Install alsa-utils." },
      { check: 'microphone', message: 'No microphone: the sound system has no capture device, so the app cannot hear the wake word or a command.' },
      { check: 'display', message: 'No display is set (DISPLAY and WAYLAND_DISPLAY are empty): the app has no screen to draw on.' },
    ])
  })

  it('takes a Wayland display as a display', () => {
    expect(checkHost({ ...ALL_THERE, env: { WAYLAND_DISPLAY: 'wayland-0' } })).toEqual([])
  })

  it('names the player it was given, and an unreadable /dev/snd as no microphone', () => {
    const found = checkHost({
      ...ALL_THERE,
      playerBin: '/opt/bin/aplay',
      onPath: () => false,
      soundDevices: () => {
        throw new Error('ENOENT')
      },
    })
    expect(found.map((finding) => finding.check)).toEqual(['aplay', 'microphone'])
    expect(found[0]!.message).toContain("'/opt/bin/aplay'")
  })

  it('checks only aplay off Linux, where the devices and display are not read this way', () => {
    expect(checkHost({ ...ALL_THERE, platform: 'darwin', env: {}, soundDevices: () => [] })).toEqual([])
  })
})

const dir = mkdtempSync(join(tmpdir(), 'bingbong-hostchecks-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('findOnPath', () => {
  it('finds an executable by name on PATH, or by its own path', () => {
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'aplay'), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(join(dir, 'bin', 'notes'), 'text', { mode: 0o644 })
    const PATH = `/nonexistent:${join(dir, 'bin')}`
    expect(findOnPath('aplay', PATH)).toBe(true)
    expect(findOnPath('notes', PATH)).toBe(false)
    expect(findOnPath('piper', PATH)).toBe(false)
    expect(findOnPath(join(dir, 'bin', 'aplay'), '')).toBe(true)
  })
})
