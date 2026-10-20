import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ipcMain, type IpcMainEvent } from 'electron'
import { ElectronBlocker, Request } from '@ghostery/adblocker-electron'
import { adblockCachePaths, resolveAdblockConfig, type AdblockCacheMeta } from '../../core/adblock/adblockConfig'
import {
  createAdblockController,
  type AdblockControllerDeps,
  type AdblockEngine,
} from '../../core/adblock/adblockController'
import { ADBLOCK_SCRIPTLETS_CHANNEL, isolateScriptlet } from '../../core/adblock/scriptlets'
import type { SettingsStore } from '../settings/settingsStore'
import { reportFault } from '../../core/trace/fault'
import scriptletsPreloadPath from './adblockScriptletsPreload.cjs?asset'

// Electron glue for the embedder-level adblocker (issue #21): maps the
// unit-tested controller onto @ghostery/adblocker-electron and the persistent
// browse partition. The whole partition is covered — main pane and subagent
// tabs share the session, so blocking and cosmetic filtering apply to both.
// Covered by e2e; the policy lives in core/adblock.

const FETCH_TIMEOUT_MS = 15_000

const libraryCosmetics = ElectronBlocker.prototype.getCosmeticsFilters
const scriptsTakenOver = new WeakSet<ElectronBlocker>()

/** The library keeps its CSS hiding but injects no scriptlets: its
 * executeJavaScript waits for the load to finish, so ours run them instead,
 * from the frame preload at document start (core/adblock/scriptlets). */
function takeOverScriptlets(blocker: ElectronBlocker): void {
  if (scriptsTakenOver.has(blocker)) return
  scriptsTakenOver.add(blocker)
  blocker.getCosmeticsFilters = (request) => ({ ...libraryCosmetics.call(blocker, request), scripts: [] })
}

/** The page's scriptlets, each in its own scope; none when the page is allow-listed. */
function scriptletsFor(blocker: ElectronBlocker, url: string): string[] {
  const { hostname, domain } = Request.fromRawDetails({ url })
  const { active, scripts } = libraryCosmetics.call(blocker, {
    url,
    hostname,
    domain,
    getBaseRules: false,
    getInjectionRules: true,
    getExtendedRules: false,
    getRulesFromHostname: true,
    getRulesFromDOM: false,
  })
  return active === false ? [] : scripts.map(isolateScriptlet)
}

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
        reportFault('adblock.attachAdblock.readCachedText', error)
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
        reportFault('adblock.attachAdblock.readCache', error)
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
        takeOverScriptlets(blocker)
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
    onWarning: (message) => {
      process.stderr.write(`adblock: ${message}\n`)
      reportFault('adblock.attachAdblock.warning', message)
    },
  }

  const controller = createAdblockController(controllerDeps)

  // Every frame of the partition asks here before its first script runs. The
  // reply must always be set, or the page's renderer waits on it — and set
  // once: the first assignment is what the page receives.
  const scriptletsPreload = partitionSession.registerPreloadScript({ type: 'frame', filePath: scriptletsPreloadPath })
  const onScriptlets = (event: IpcMainEvent, url: unknown): void => {
    let scripts: string[] = []
    if (enforced !== null && typeof url === 'string' && event.sender.session === partitionSession) {
      try {
        scripts = scriptletsFor(enforced, url)
      } catch (error) {
        reportFault('adblock.attachAdblock.scriptlets', error)
      }
    }
    event.returnValue = scripts
  }
  ipcMain.on(ADBLOCK_SCRIPTLETS_CHANNEL, onScriptlets)

  // The settings kill switch applies immediately — no restart, no refetch.
  const unsubscribe = settingsStore.subscribe((settings) => controller.setEnabled(settings.adblockEnabled))

  return {
    ready: () => controller.ready(),
    dispose() {
      unsubscribe()
      ipcMain.removeListener(ADBLOCK_SCRIPTLETS_CHANNEL, onScriptlets)
      partitionSession.unregisterPreloadScript(scriptletsPreload)
      controller.dispose()
    },
  }
}
