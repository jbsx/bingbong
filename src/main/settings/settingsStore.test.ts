import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../core/settings/settings'
import { createSettingsStore } from './settingsStore'

describe('settingsStore', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-settings-'))
    path = join(dir, 'settings.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults when the file does not exist', () => {
    const store = createSettingsStore(path)
    expect(store.get()).toEqual(defaultSettings())
  })

  it('persists updates to disk so they survive a restart', () => {
    const store = createSettingsStore(path)
    store.update({ ...defaultSettings(), micId: 'mic-9', weather: { city: 'Berlin', units: 'imperial' } })

    const reopened = createSettingsStore(path)
    expect(reopened.get().micId).toBe('mic-9')
    expect(reopened.get().weather).toEqual({ city: 'Berlin', units: 'imperial' })
  })

  it('sanitizes incoming updates before persisting', () => {
    const store = createSettingsStore(path)
    store.update({ wakeWordThreshold: 99, micId: 42 })
    expect(store.get().wakeWordThreshold).toBe(1)
    expect(store.get().micId).toBe('default')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ wakeWordThreshold: 1, micId: 'default' })
  })

  it('falls back to defaults when the file is corrupt', () => {
    writeFileSync(path, '{ not json')
    const store = createSettingsStore(path)
    expect(store.get()).toEqual(defaultSettings())
  })

  it('notifies subscribers on update with the sanitized settings', () => {
    const store = createSettingsStore(path)
    const seen: string[] = []
    const unsubscribe = store.subscribe((settings) => seen.push(settings.micId))

    store.update({ ...defaultSettings(), micId: 'mic-1' })
    expect(seen).toEqual(['mic-1'])

    unsubscribe()
    store.update({ ...defaultSettings(), micId: 'mic-2' })
    expect(seen).toEqual(['mic-1'])
  })
})
