import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'

export interface SettingsState {
  /** Null while the first load is in flight. */
  settings: AppSettings | null
  save(next: AppSettings): Promise<void>
}

/** The settings file, live: loads once, then follows every change broadcast. */
export function useSettings(): SettingsState {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.bingbong.settings.get().then(setSettings)
    return window.bingbong.settings.onChanged(setSettings)
  }, [])

  const save = useCallback(async (next: AppSettings) => {
    setSettings(await window.bingbong.settings.update(next))
  }, [])

  return { settings, save }
}
