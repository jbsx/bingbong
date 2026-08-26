import { nativeTheme } from 'electron'
import type { AppSettings } from '../core/settings/settings'

// Appearance wiring (ADR 0020): the tri-state Setting resolves through
// nativeTheme — themeSource takes the Setting's exact literals, 'system'
// delegates to the OS, and a manual choice wins over the OS signal. Every
// webContents' engine-level prefers-color-scheme follows the resolved
// value (pages that respect it darken themselves; the app never mutates
// page DOM), and native pane backgrounds repaint via paneBackgrounds.

export interface AppearanceStore {
  get(): AppSettings
  subscribe(listener: (settings: AppSettings) => void): () => void
}

export function attachAppearance(store: AppearanceStore): () => void {
  const apply = (): void => {
    nativeTheme.themeSource = store.get().appearance
  }
  apply()
  return store.subscribe(apply)
}
