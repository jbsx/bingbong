// The benchmark Browser Profile seed (#224): a fresh userData directory
// built from a small explicit recipe — the selected benchmark settings
// and nothing else. No cookies, no local storage, no Session evidence,
// no logs, no usage ledger, and never a copy of the developer's personal
// profile: the recipe is reconstructed identically for every independent
// hunt, and a hunt's follow-up keeps the same directory open.
//
// The seed is kept apart from retained diagnostics on purpose. What the
// app writes into this directory during a hunt is archived out of its
// logs dir by artifacts.ts before the directory is removed; the seed
// itself is never archived, because the profile is what the capture
// must not retain.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, sanitizeSettings, type AppSettings } from '../../src/core/settings/settings'
import { digestOf } from './artifacts.ts'
import type { LiveSettingsProvenance } from './types.ts'

/**
 * The settings a caller may select for a benchmark. Routing and provider
 * keys are excluded by type: the env alone routes a measured launch, and
 * a key in settings.json would be a secret sitting in the profile.
 */
export type BenchmarkSettingsInput = Partial<
  Pick<
    AppSettings,
    | 'adblockEnabled'
    | 'webZoomPercent'
    | 'appearance'
    | 'sttModel'
    | 'endpointDelayMs'
    | 'resumptionMergeMs'
    | 'wakeWordThreshold'
    | 'ttsVoice'
    | 'weather'
    | 'micId'
  >
>

export interface BenchmarkProfileOptions {
  /** Where the profile directory is made; the OS temp dir by default. */
  readonly root?: string
  /** `defaults` selects the app's own defaults explicitly; an object selects benchmark values. */
  readonly settings?: 'defaults' | BenchmarkSettingsInput
}

export interface BenchmarkProfile {
  readonly userDataDir: string
  /** The empty benchmark-owned download directory (`BINGBONG_DOWNLOADS_DIR`). */
  readonly downloadsDir: string
  /** Where the app will write its diagnostic families. */
  readonly logsDir: string
  readonly settings: LiveSettingsProvenance
  /** Remove the whole directory. Archive first — nothing here survives it. */
  dispose(): void
}

/**
 * The settings.json a benchmark writes: the app's own sanitizer over the
 * selected values, with routing and keys forced to their empty defaults
 * whatever the input smuggled in.
 */
export function benchmarkSettings(input: 'defaults' | BenchmarkSettingsInput): AppSettings {
  const defaults = defaultSettings()
  const selected = input === 'defaults' ? defaults : sanitizeSettings({ ...defaults, ...input })
  return { ...selected, apiKeys: {}, modelRouting: defaults.modelRouting }
}

/** Build a fresh benchmark profile directory. */
export function createBenchmarkProfile(options: BenchmarkProfileOptions = {}): BenchmarkProfile {
  const input = options.settings ?? 'defaults'
  const userDataDir = mkdtempSync(join(options.root ?? tmpdir(), 'bingbong-live-profile-'))
  // A fresh temp dir is empty by construction; checking is what makes
  // "fresh" a recorded fact rather than an assumption.
  if (readdirSync(userDataDir).length !== 0) throw new Error(`benchmark profile directory is not empty: ${userDataDir}`)
  const settings = benchmarkSettings(input)
  const text = `${JSON.stringify(settings, null, 2)}\n`
  writeFileSync(join(userDataDir, 'settings.json'), text, 'utf8')
  const downloadsDir = join(userDataDir, 'bingbong_downloads')
  mkdirSync(downloadsDir)
  return {
    userDataDir,
    downloadsDir,
    logsDir: join(userDataDir, 'logs'),
    settings: {
      source: input === 'defaults' ? 'defaults' : 'explicit',
      digest: digestOf(text),
      adblockEnabled: settings.adblockEnabled,
      webZoomPercent: settings.webZoomPercent,
      appearance: settings.appearance,
      sttModel: settings.sttModel,
      routingOverrides: false,
    },
    dispose() {
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
}
