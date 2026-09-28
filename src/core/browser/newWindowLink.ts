import { urlFingerprint } from '../pipeline/progressFingerprints'

// #299, ADR 0073: the New-window Link. A page's attempt to open a window is
// always denied — a native window created inside an in-flight click wedges
// the click (ADR 0018) — and what happens next depends on whose address it
// was. An open to the address of the link that was clicked is followed: the
// pane navigates there itself. Every other open stays denied and is reported
// to the model as a popup, its address printed whole so it can be used.

/** The clause a followed click's Action Outcome carries. */
export const NEW_WINDOW_FOLLOWED_CLAUSE = 'the link asked for a new window; opened here'

/** What a link is to every script that asks a page for one: the node, or the link it sits in. */
export const LINK_SELECTOR = 'a[href], area[href]'

const POPUP_BLOCKED_PREFIX = 'popup blocked: '
const AUTH_POPUP_OPENED_PREFIX = 'auth popup opened: '

/** A denied or opened address is printed whole up to this many characters. */
export const MAX_OPEN_ADDRESS_LENGTH = 2_000
/** A target that is no address to navigate to is printed as its scheme and this short a cut. */
const MAX_TARGET_LENGTH = 40
const CUT_MARK = '…'

/** An address the pane can be sent to: http or https. `data:`, `javascript:` and `about:` targets are none. */
export function isNavigableAddress(address: string): boolean {
  return /^https?:\/\//i.test(address.trim())
}

function cut(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}${CUT_MARK}`
}

/** An open's target as an outcome line prints it. */
export function formatOpenAddress(address: string): string {
  return cut(address, isNavigableAddress(address) ? MAX_OPEN_ADDRESS_LENGTH : MAX_TARGET_LENGTH)
}

export function popupBlockedLine(address: string): string {
  return `${POPUP_BLOCKED_PREFIX}${formatOpenAddress(address)}`
}

export function authPopupOpenedLine(address: string): string {
  return `${AUTH_POPUP_OPENED_PREFIX}${formatOpenAddress(address)}`
}

/** Addresses are compared as the Composed Address rail compares them. */
function sameAddress(left: string, right: string): boolean {
  return urlFingerprint(left).url === urlFingerprint(right).url
}

export interface JudgedWindowOpens {
  /** The open the pane follows, as the page asked for it; null when none matched. */
  readonly followed: string | null
  /** Every other open, in the order the page made them. */
  readonly denied: string[]
}

/**
 * One click's opens against the clicked link's addresses — the one the
 * snapshot showed and the one the link carries right after the click, either
 * of which matches. The first open that matches is followed and the rest are
 * denied. A click on no link hands in no address and follows nothing.
 */
export function judgeWindowOpens(
  opens: readonly string[],
  linkAddresses: readonly (string | null | undefined)[],
): JudgedWindowOpens {
  const addresses = linkAddresses.filter((address): address is string => typeof address === 'string' && isNavigableAddress(address))
  let followed: string | null = null
  const denied: string[] = []
  for (const open of opens) {
    if (followed === null && isNavigableAddress(open) && addresses.some((address) => sameAddress(open, address))) {
      followed = open
    } else {
      denied.push(open)
    }
  }
  return { followed, denied }
}

// Reports ride an outcome line joined by `; `, or a page read as lines of
// their own, so an address ends at whitespace and sheds the joiner.
const POPUP_BLOCKED_RE = new RegExp(`(?:^|[\\s;])${POPUP_BLOCKED_PREFIX}(\\S+)`, 'gm')

/**
 * The addresses of the denied popups a result reports, where they can be
 * navigated to: each is an Offered Address, printed by the app as where the
 * page meant to go. A cut address is not the address, and is left out. The
 * whole text is read, as it is for the hrefs a page lists: a page that
 * prints the report's words offers no more than a link on it would.
 */
export function deniedAddressesIn(text: string): string[] {
  const addresses: string[] = []
  for (const match of text.matchAll(POPUP_BLOCKED_RE)) {
    const address = match[1]!.replace(/;$/, '')
    if (isNavigableAddress(address) && !address.endsWith(CUT_MARK)) addresses.push(address)
  }
  return addresses
}
