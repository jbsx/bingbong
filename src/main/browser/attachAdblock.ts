import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { adblockCachePaths, resolveAdblockConfig, type AdblockCacheMeta } from '../../core/adblock/adblockConfig'
import {
  createAdblockController,
  type AdblockControllerDeps,
  type AdblockEngine,
} from '../../core/adblock/adblockController'
import type { SettingsStore } from '../settings/settingsStore'
import { reportFault } from '../../core/trace/fault'

// Electron glue for the embedder-level adblocker (issue #21): maps the
// unit-tested controller onto @ghostery/adblocker-electron and the persistent
// browse partition. The whole partition is covered — main pane and subagent
// tabs share the session, so blocking and cosmetic filtering apply to both.
// Covered by e2e; the policy lives in core/adblock.

const FETCH_TIMEOUT_MS = 15_000

export interface AdblockAttachment {
  /** Resolves once the initial load finished — engine enforced or degraded. */
  ready(): Promise<void>
  dispose(): void
}

export function attachAdblock(deps: {
  session: Electron.Session
  settingsStore: SettingsStore
  userDataDir: string
  env: Record<string, string | undefined>
  /** Fired after a disable wipes every webRequest listener on the partition —
   * other components re-assert theirs here (attachIdentityHeaders, ADR 0018). */
  onWebRequestCleared?: () => void
}): AdblockAttachment {
  const { session: partitionSession, settingsStore, userDataDir, env } = deps
  const config = resolveAdblockConfig(env)
  const paths = adblockCachePaths(userDataDir)

  /** Raw-text cache path per URL; hashed so env-overridden lists can't collide
   *  or produce hostile filenames. */
  const listTextPath = (url: string): string => join(paths.listsDir, `${createHash('sha256').update(url).digest('hex')}.txt`)

  // Exactly one engine is enforced at a time; swaps disable the old context
  // before enabling the new one (the library owns global ipcMain channels).
  let enforced: ElectronBlocker | null = null

  const controllerDeps: AdblockControllerDeps = {
    lists: config.lists,
    resourcesUrl: config.resourcesUrl,

    fetchText: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`${url} responded ${response.status}`)
      return response.text()
    },

    readCachedText: (url) => {
      try {
        return readFileSync(listTextPath(url), 'utf8')
      } catch (error) {
        reportFault('adblock.cache.readText', error)
        return null
      }
    },
    writeCachedText: (url, text) => {
      const path = listTextPath(url)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text, 'utf8')
    },

    parseEngine: (listsText, resources) => {
      const blocker = ElectronBlocker.parse(listsText.join('\n'), { enableCompression: true })
      if (resources !== null) blocker.updateResources(resources, String(resources.length))
      return blocker
    },
    serializeEngine: (engine) => (engine as ElectronBlocker).serialize(),
    deserializeEngine: (raw) => ElectronBlocker.deserialize(raw),

    readCache: () => {
      try {
        const meta = JSON.parse(readFileSync(paths.meta, 'utf8')) as AdblockCacheMeta
        const engine = new Uint8Array(readFileSync(paths.engine))
        return { engine, meta }
      } catch (error) {
        reportFault('adblock.cache.read', error)
        return null
      }
    },
    writeCache: (raw, meta) => {
      mkdirSync(dirname(paths.engine), { recursive: true })
      writeFileSync(paths.engine, raw)
      writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    },

    applyEngine: (engine: AdblockEngine | null, enabled: boolean) => {
      const blocker = engine as ElectronBlocker | null
      // Disabling clears ALL webRequest listeners on the partition (Electron
      // allows one listener per event; the library nulls both). Nothing else
      // in this app registers webRequest handlers — if that changes, this
      // swap is where they must be re-registered.
      if (enforced !== null && (enforced !== blocker || !enabled)) {
        enforced.disableBlockingInSession(partitionSession)
        enforced = null
        deps.onWebRequestCleared?.()
      }
      // enableBlockingInSession is idempotent for the same blocker+session.
      if (blocker !== null && enabled) {
        blocker.enableBlockingInSession(partitionSession)
        enforced = blocker
      }
    },

    enabledAtStart: settingsStore.get().adblockEnabled,
    now: () => Date.now(),
    schedule: (callback, ms) => {
      const timer = setTimeout(() => void callback(), ms)
      timer.unref?.()
      return () => clearTimeout(timer)
    },
    onWarning: (message) => process.stderr.write(`adblock: ${message}\n`),
  }

  const controller = createAdblockController(controllerDeps)

  // The settings kill switch applies immediately — no restart, no refetch.
  const unsubscribe = settingsStore.subscribe((settings) => controller.setEnabled(settings.adblockEnabled))

  return {
    ready: () => controller.ready(),
    dispose() {
      unsubscribe()
      controller.dispose()
    },
  }
}
