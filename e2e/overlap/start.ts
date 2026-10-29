// A Sequence Case's start (#509, CONTEXT.md Sequence Case): the page shown,
// with the pages behind it, and the song heard, wherever it plays — given
// separately, since on the audio road a song no longer takes the pane. The
// gate puts the start in front of the person in these steps, then checks it
// before line 1: a start it could not put measures nothing, and is `start
// not met`, never red.

import type { CaseStart } from './sequenceCase.ts'

/** One thing a person does to set the start up: open a page, play a song, or say the line the app then asks about. */
export type StartStep = { readonly open: string } | { readonly play: string } | { readonly ask: string }

/** The pages behind first (oldest first), then the page shown, then the song, then the line asked. */
export function startSteps(start: CaseStart): StartStep[] {
  const pages = start.page === undefined ? [] : [...(start.page.behind ?? []).slice().reverse(), start.page.url]
  return [...pages.map((open) => ({ open })), ...(start.music !== undefined ? [{ play: start.music }] : []), ...(start.asked !== undefined ? [{ ask: start.asked }] : [])]
}

const isRealPage = (url: string): boolean => /^https?:\/\//i.test(url)

/**
 * The real pages behind the page shown, nearest first: what a person could
 * step back through. A blank or data page ends the run, as `back` stops at
 * the pane's blank start page (src/core/browser/lastPage.ts).
 */
export function pagesBehind(entries: readonly { readonly url: string }[], currentIndex: number): string[] {
  const out: string[] = []
  for (let index = currentIndex - 1; index >= 0 && isRealPage(entries[index]!.url); index--) out.push(entries[index]!.url)
  return out
}

/** What the person has in front of them once the start is set up. */
export interface SeenStart {
  readonly url: string
  readonly behind: readonly string[]
  /** A song is playing, on the pane or the road. */
  readonly heard: boolean
}

/** The same page, a trailing slash and a fragment aside. */
const samePage = (a: string, b: string): boolean => {
  const bare = (url: string): string => (URL.canParse(url) ? ((u) => `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`)(new URL(url)) : url)
  return bare(a) === bare(b)
}

/** Why the start is not in front of the person, or null when it is. A page or a song the start leaves out is not checked. */
export function startUnmet(start: CaseStart, seen: SeenStart): string | null {
  if (start.page !== undefined) {
    if (!samePage(seen.url, start.page.url)) return `the page shown is ${seen.url}, not ${start.page.url}`
    const wanted = start.page.behind?.length ?? 0
    if (seen.behind.length < wanted) return `${seen.behind.length} page${seen.behind.length === 1 ? '' : 's'} behind the page shown, not ${wanted}`
  }
  if (start.music !== undefined && !seen.heard) return 'no song is heard, on the pane or the road'
  return null
}
