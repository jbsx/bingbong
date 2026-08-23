import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '../../core/settings/settings'
import type { RoutingStatus } from '../../core/agent/modelRouting'

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

/** Routing status, live (#76): loads once, then follows settings broadcasts. */
export function useRoutingStatus(): RoutingStatus | null {
  const [status, setStatus] = useState<RoutingStatus | null>(null)

  useEffect(() => {
    void window.bingbong.settings.routingStatus().then(setStatus)
    return window.bingbong.settings.onRoutingStatusChanged(setStatus)
  }, [])

  return status
}
