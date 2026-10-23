import { isRealPage } from './lastPage'

// The Known Addresses (CONTEXT.md, ADR 0089, #408): the hosts the appliance
// has landed on, a fact it gathers itself. `open <one word>` fires without
// an ask only when the word names one of them, and opens that host as it
// was landed on — never `<word>.com`, which was a guess. A word names a
// host when it is one of the host's labels but the last: "bbc" names
// bbc.co.uk, "wikipedia" en.wikipedia.org. Several named, the latest
// landing wins. Pure state: the store in main keeps it in a file.

/** The ledger's ceiling, the oldest landing evicted. */
const MAX_HOSTS = 500

export interface KnownHost {
  /** The host without a leading `www.`, lower case. */
  readonly host: string
  /** Epoch ms of the latest landing on it. */
  readonly at: number
}

export interface KnownAddresses {
  /** Oldest landing first. */
  readonly hosts: readonly KnownHost[]
}

export const EMPTY_KNOWN_ADDRESSES: KnownAddresses = { hosts: [] }

/** A host a word can name: dotted, letters, digits and dashes, and no IP address. */
const isNamedHost = (host: string): boolean => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) && !/^[\d.]+$/.test(host)

/** The host an address lands on, as the ledger keeps it; null for a page that is no real one, or a host no word names. */
function hostOf(url: string): string | null {
  if (!isRealPage(url) || !URL.canParse(url)) return null
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return isNamedHost(host) ? host : null
}

/** One landing seen: its host is known from now on, the latest landed on. */
export function landedOn(state: KnownAddresses, url: string, at: number): KnownAddresses {
  const host = hostOf(url)
  if (host === null || state.hosts.at(-1)?.host === host) return state
  return { hosts: [...state.hosts.filter((known) => known.host !== host), { host, at }].slice(-MAX_HOSTS) }
}

/** The Known Address a word names, the latest landed on; null for none. */
export function knownAddressOf(state: KnownAddresses, word: string): string | null {
  const wanted = word.trim().toLowerCase()
  if (wanted === '') return null
  for (let at = state.hosts.length - 1; at >= 0; at -= 1) {
    const { host } = state.hosts[at]!
    if (host.split('.').slice(0, -1).includes(wanted)) return host
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Anything (the file) as a valid ledger: an entry it cannot vouch for is dropped, never defaulted. */
export function sanitizeKnownAddresses(raw: unknown): KnownAddresses {
  if (!isRecord(raw) || !Array.isArray(raw.hosts)) return EMPTY_KNOWN_ADDRESSES
  const hosts: KnownHost[] = []
  for (const entry of raw.hosts) {
    if (!isRecord(entry)) continue
    const { host, at } = entry
    if (typeof host !== 'string' || typeof at !== 'number' || !isNamedHost(host)) continue
    if (hosts.some((known) => known.host === host)) continue
    hosts.push({ host, at })
  }
  return { hosts: hosts.slice(-MAX_HOSTS) }
}
