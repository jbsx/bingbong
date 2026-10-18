import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { lastPageFrom, sanitizeLastPage, type LastPage } from '../../core/browser/lastPage'
import type { BrowserPaneState } from '../../core/browser/paneState'
import { reportFault } from '../../core/trace/fault'

// The Last Page's persistence (CONTEXT.md): last-page.json in userData, the
// same shape as the settings and lexicon stores. The transition lives in
// core (lastPage.ts); this store owns the file, the clock and the change
// notifications. A missing or corrupt file is no Last Page — the Idle Screen
// shows none until the pane shows a page.

export interface LastPageStore {
  get(): LastPage | null
  /** One pane state seen: persisted when it moves the Last Page, and announced. */
  record(state: Pick<BrowserPaneState, 'url' | 'title'>): void
  onChange(listener: (page: LastPage | null) => void): () => void
}

export function createLastPageStore(path: string, deps?: { now?: () => number }): LastPageStore {
  const now = deps?.now ?? Date.now
  const listeners = new Set<(page: LastPage | null) => void>()
  let current = load()

  function load(): LastPage | null {
    try {
      return sanitizeLastPage(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('browser.lastPageStore.load', error)
      return null
    }
  }

  function persist(page: LastPage): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(page, null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('browser.lastPageStore.persist', error)
    }
  }

  return {
    get: () => current,
    record(state) {
      const next = lastPageFrom(current, state, now())
      if (next === current) return
      current = next
      if (next !== null) persist(next)
      for (const listener of listeners) listener(current)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
