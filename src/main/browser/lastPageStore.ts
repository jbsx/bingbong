import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isRealPage, lastPageFrom, sanitizeLastPage, type LastPage } from '../../core/browser/lastPage'
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
  /**
   * A landing the Action Outcome called not found, unavailable or empty
   * (2026-10-22 audit): no page worth going back to. The Last Page goes
   * back to the one before it, and the address is not recorded again
   * until the pane shows another page.
   */
  drop(url: string): void
  onChange(listener: (page: LastPage | null) => void): () => void
}

export function createLastPageStore(path: string, deps?: { now?: () => number }): LastPageStore {
  const now = deps?.now ?? Date.now
  const listeners = new Set<(page: LastPage | null) => void>()
  let current = load()
  /** The Last Page before the current one's address, which a drop goes back to. */
  let before: LastPage | null = null
  /** The address last dropped, while the pane still shows it. */
  let dropped: string | null = null

  function load(): LastPage | null {
    try {
      return sanitizeLastPage(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('browser.lastPageStore.load', error)
      return null
    }
  }

  function persist(page: LastPage | null): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(page, null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('browser.lastPageStore.persist', error)
    }
  }

  function announce(): void {
    for (const listener of listeners) listener(current)
  }

  return {
    get: () => current,
    record(state) {
      if (state.url === dropped) return
      if (isRealPage(state.url)) dropped = null
      const next = lastPageFrom(current, state, now())
      if (next === current) return
      if (next?.url !== current?.url) before = current
      current = next
      if (next !== null) persist(next)
      announce()
    },
    drop(url) {
      dropped = url
      if (current?.url !== url) return
      current = before
      before = null
      persist(current)
      announce()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
