import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { EMPTY_KNOWN_ADDRESSES, knownAddressOf, landedOn, sanitizeKnownAddresses, type KnownAddresses } from '../../core/browser/knownAddresses'
import type { BrowserPaneState } from '../../core/browser/paneState'
import { reportFault } from '../../core/trace/fault'

// The Known Addresses' persistence (#408, ADR 0089): known-addresses.json in userData
// beside the Last Page, kept across restarts. The rules live in core
// (knownAddresses.ts); this store owns the file and the clock. A corrupt
// file fails closed to no hosts — every bare word is Jev's — and the next
// landing starts it again.

export interface KnownAddressStore {
  /** One pane state seen: its host is known once the pane has landed on it. */
  record(state: Pick<BrowserPaneState, 'url'>): void
  /** The host a word names; null for none. */
  addressOf(word: string): string | null
}

export function createKnownAddressStore(path: string, deps?: { now?: () => number }): KnownAddressStore {
  const now = deps?.now ?? (() => Date.now())
  let state: KnownAddresses = EMPTY_KNOWN_ADDRESSES
  if (existsSync(path)) {
    try {
      state = sanitizeKnownAddresses(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      reportFault('browser.knownAddressStore.load', error)
    }
  }

  function commit(next: KnownAddresses): void {
    if (next === state) return
    state = next
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('browser.knownAddressStore.persist', error)
    }
  }

  return {
    record: (pane) => commit(landedOn(state, pane.url, now())),
    addressOf: (word) => knownAddressOf(state, word),
  }
}
