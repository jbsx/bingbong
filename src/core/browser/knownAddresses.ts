import { isChallengeAddress } from './blockerNudge'
import { isRealPage } from './lastPage'

// The Known Addresses (CONTEXT.md, ADR 0089, #408): the hosts the appliance
// has landed on, a fact it gathers itself. `open <one word>` fires without
// an ask only when the word names one of them, and opens that host as it
// was landed on — never `<word>.com`, which was a guess. A word names a
// host by the host's own name alone, the label before its suffix: "bbc"
// names bbc.co.uk and news.bbc.co.uk, "wikipedia" en.wikipedia.org — never
// a subdomain ("news", "en") nor the suffix. Several named, the latest
// landing wins. A challenge's host is no site the user went to, and is not
// kept. Pure state: the store in main keeps it in a file.

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

/** The host an address lands on, as the ledger keeps it; null for a page that is no real one, a challenge, or a host no word names. */
function hostOf(url: string): string | null {
  if (!isRealPage(url) || !URL.canParse(url) || isChallengeAddress(url)) return null
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return isNamedHost(host) ? host : null
}

/** One landing seen: its host is known from now on, the latest landed on. */
export function landedOn(state: KnownAddresses, url: string, at: number): KnownAddresses {
  const host = hostOf(url)
  if (host === null || state.hosts.at(-1)?.host === host) return state
  return { hosts: [...state.hosts.filter((known) => known.host !== host), { host, at }].slice(-MAX_HOSTS) }
}

/**
 * A host's own name: the label before its suffix — a two-letter country
 * code after a short second level (co.uk, com.au) is the suffix whole, by
 * the shape of the labels and never a list of sites.
 */
function nameOf(host: string): string | undefined {
  const labels = host.split('.')
  const country = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3
  return labels.at(country ? -3 : -2)
}

/** The Known Address a word names, the latest landed on; null for none. */
export function knownAddressOf(state: KnownAddresses, word: string): string | null {
  const wanted = word.trim().toLowerCase()
  if (wanted === '') return null
  for (let at = state.hosts.length - 1; at >= 0; at -= 1) {
    const { host } = state.hosts[at]!
    if (nameOf(host) === wanted) return host
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
