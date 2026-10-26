import { ipcMain } from 'electron'
import { USAGE_IPC } from '../../core/usage/ipcChannels'
import { fetchUsage, usageBaseUrl, type UsageSnapshot } from '../../core/usage/usage'
import type { EarDay } from '../../core/usage/earTally'

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
 * CORS headers. Resolves null when no dashboard URL is set. The ear's own
 * tally of the day (#463) rides along, local, beside the dashboard's
 * providers; the dashboard is not told.
 */
export function registerUsageIpc(getUrl: () => string, earDay: (at: number) => Readonly<Record<string, EarDay>>): void {
  ipcMain.handle(USAGE_IPC.get, async (): Promise<UsageSnapshot | null> => {
    const url = usageBaseUrl(getUrl())
    if (url === '') return null
    const now = Date.now()
    return { ...(await fetchUsage(fetchJson, url, now)), ear: earDay(now) }
  })
}
