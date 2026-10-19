import { ipcMain } from 'electron'
import { USAGE_IPC } from '../../core/usage/ipcChannels'
import { fetchUsage, usageBaseUrl, type UsageSnapshot } from '../../core/usage/usage'

/** Long enough for a LAN box that is waking; short enough that a dead one never stacks polls. */
const REQUEST_TIMEOUT_MS = 8_000

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`usage request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/**
 * The AI usage dashboard's IPC: the Idle Screen pulls a snapshot while it
 * shows. Fetched here, not in the renderer, because the dashboard sends no
 * CORS headers. Resolves null when no dashboard URL is set.
 */
export function registerUsageIpc(getUrl: () => string): void {
  ipcMain.handle(USAGE_IPC.get, (): Promise<UsageSnapshot | null> | null => {
    const url = usageBaseUrl(getUrl())
    return url === '' ? null : fetchUsage(fetchJson, url, Date.now())
  })
}
