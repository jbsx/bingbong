import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { defaultSettings, sanitizeSettings, type AppSettings } from '../../core/settings/settings'
import { reportFault } from '../../core/trace/fault'

// Settings live in a JSON file under userData. The file is the source of
// truth across restarts; the store keeps the parsed copy and broadcasts
// changes so windows and the LLM wiring pick them up without a relaunch.

export interface SettingsStore {
  get(): AppSettings
  /** Sanitize, persist, broadcast. Returns the settings now in effect. */
  update(raw: unknown): AppSettings
  subscribe(listener: (settings: AppSettings) => void): () => void
}

export function createSettingsStore(path: string): SettingsStore {
  const listeners = new Set<(settings: AppSettings) => void>()
  let current = load(path)

  function load(filePath: string): AppSettings {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(filePath, 'utf8')))
    } catch (error) {
      reportFault('settings.store.load', error)
      return defaultSettings()
    }
  }

  function persist(settings: AppSettings): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }

  return {
    get: () => current,
    update(raw) {
      current = sanitizeSettings(raw)
      persist(current)
      for (const listener of listeners) listener(current)
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
