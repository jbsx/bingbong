import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { benchmarkSettings, createBenchmarkProfile } from './profile.ts'

// The profile seed (#224): reconstructed identically per hunt, holding
// nothing but the selected settings, and never a key.

describe('createBenchmarkProfile', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'live-profile-test-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('builds a fresh directory holding only settings.json and an empty downloads dir', () => {
    const profile = createBenchmarkProfile({ root, settings: { webZoomPercent: 100, adblockEnabled: true } })
    expect(profile.userDataDir.startsWith(root)).toBe(true)
    expect(readdirSync(profile.userDataDir).sort()).toEqual(['bingbong_downloads', 'settings.json'])
    expect(readdirSync(profile.downloadsDir)).toEqual([])
    expect(existsSync(profile.logsDir)).toBe(false)
    expect(profile.settings).toMatchObject({ source: 'explicit', webZoomPercent: 100, adblockEnabled: true, routingOverrides: false })
    profile.dispose()
    expect(existsSync(profile.userDataDir)).toBe(false)
  })

  it('reconstructs the same seed for independent hunts — same digest, different directory', () => {
    const a = createBenchmarkProfile({ root, settings: { webZoomPercent: 100 } })
    const b = createBenchmarkProfile({ root, settings: { webZoomPercent: 100 } })
    expect(a.userDataDir).not.toBe(b.userDataDir)
    expect(a.settings.digest).toBe(b.settings.digest)
    expect(readFileSync(join(a.userDataDir, 'settings.json'), 'utf8')).toBe(readFileSync(join(b.userDataDir, 'settings.json'), 'utf8'))
    expect(createBenchmarkProfile({ root, settings: 'defaults' }).settings).toMatchObject({ source: 'defaults' })
  })

  it('never writes routing or provider keys, whatever the input smuggles in', () => {
    const smuggled = { webZoomPercent: 90, apiKeys: { zai: 'sk-secret' }, modelRouting: { orchestrator: { apiKey: 'sk-secret' } } }
    const settings = benchmarkSettings(smuggled as never)
    expect(settings.apiKeys).toEqual({})
    expect(settings.modelRouting.orchestrator).toEqual({ baseUrl: '', model: '', apiKey: '' })
    const profile = createBenchmarkProfile({ root, settings: smuggled as never })
    expect(readFileSync(join(profile.userDataDir, 'settings.json'), 'utf8')).not.toContain('sk-secret')
  })
})
