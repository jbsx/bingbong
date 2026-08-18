// Embedder-level adblocker configuration (issue #21). The engine itself is
// @ghostery/adblocker-electron attached to the persistent browse partition;
// this module owns which lists feed it and when the disk cache is stale.

// v1 lists: EasyList (ads) + uBlock Origin's core filters (breakage fixes and
// quick reaction rules) + a malware-domain blocklist. EasyPrivacy is
// deliberately absent — tracker breakage on a voice-driven browser is painful
// to debug blind; revisit after v1 settles.
export const DEFAULT_ADBLOCK_LISTS: string[] = [
  'https://easylist.to/easylist/easylist.txt',
  'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
]

// Scriptlet/redirect resources (uBlock resources.json mirror maintained by
// Ghostery). Cosmetic *hiding* works without it; scriptlet-based filters need it.
export const DEFAULT_ADBLOCK_RESOURCES_URL =
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

// Lists refresh on a daily cadence; between refreshes the serialized engine
// comes straight from the disk cache so launches don't re-download.
export const ADBLOCK_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface AdblockConfig {
  /** Filter-list URLs; empty means the whole engine stays off. */
  lists: string[]
  /** uBlock resources.json URL, or null to skip scriptlet resources. */
  resourcesUrl: string | null
}

export function resolveAdblockConfig(env: Record<string, string | undefined>): AdblockConfig {
  if (env.BINGBONG_ADBLOCK === 'off') return { lists: [], resourcesUrl: null }

  const override = env.BINGBONG_ADBLOCK_LISTS
  const lists =
    override === undefined
      ? DEFAULT_ADBLOCK_LISTS
      : override
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')

  const resourcesOverride = env.BINGBONG_ADBLOCK_RESOURCES
  return { lists, resourcesUrl: resourcesOverride === undefined ? DEFAULT_ADBLOCK_RESOURCES_URL : resourcesOverride || null }
}

export interface AdblockCachePaths {
  engine: string
  meta: string
}

export function adblockCachePaths(userDataDir: string): AdblockCachePaths {
  return {
    engine: `${userDataDir}/adblock-engine.bin`,
    meta: `${userDataDir}/adblock-meta.json`,
  }
}

export interface AdblockCacheMeta {
  urls: string[]
  updatedAt: number
}

/** A cached engine can skip the network only for the same lists within one update interval. */
export function cacheIsUsable(meta: AdblockCacheMeta | null, lists: string[], now: number, maxAgeMs: number): boolean {
  if (meta === null) return false
  if (meta.urls.length !== lists.length || meta.urls.some((url, index) => url !== lists[index])) return false
  return now - meta.updatedAt < maxAgeMs
}
