import type { Song } from './queue'
import { reportFault } from '../trace/fault'

// The search pick (#343): `play <words>` takes the first plain video of
// YouTube's results — no Jev call, and a wrong pick is a Misfire the next
// line recovers (ADR 0076). Read off the `ytInitialData` the results page
// carries rather than its rendered cards: the same data a page evaluation
// or a fetched page yields, present before the cards are drawn, and each
// item named by its renderer — an ad, a Short, a channel, a playlist, a
// shelf ("People also watched") or a video.

const YOUTUBE = 'https://www.youtube.com'

export function resultsUrl(words: string): string {
  return `${YOUTUBE}/results?${new URLSearchParams({ search_query: words }).toString()}`
}

export function watchUrl(id: string): string {
  return `${YOUTUBE}/watch?v=${id}`
}

/** The video a YouTube watch address plays; null for any other address. */
export function videoIdOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (!/(?:^|\.)youtube\.com$/.test(parsed.hostname) || parsed.pathname !== '/watch') return null
  return parsed.searchParams.get('v')
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at a path of keys and indexes; undefined where the path breaks. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  let here = value
  for (const step of path) {
    if (typeof step === 'number' ? !Array.isArray(here) : !isObject(here)) return undefined
    here = (here as Record<string | number, unknown>)[step]
  }
  return here
}

/** A YouTube text: its `simpleText`, its runs joined, or a view model's `content`. */
function textOf(value: unknown): string {
  if (typeof at(value, 'simpleText') === 'string') return at(value, 'simpleText') as string
  if (typeof at(value, 'content') === 'string') return at(value, 'content') as string
  const runs = at(value, 'runs')
  return Array.isArray(runs) ? runs.map((run) => (typeof at(run, 'text') === 'string' ? (at(run, 'text') as string) : '')).join('') : ''
}

/** The items of the results' sections, in order — each one renderer; a shelf's own items stay inside it. */
function resultItems(data: unknown): unknown[] {
  const sections = at(data, 'contents', 'twoColumnSearchResultsRenderer', 'primaryContents', 'sectionListRenderer', 'contents')
  if (!Array.isArray(sections)) return []
  return sections.flatMap((section) => {
    const items = at(section, 'itemSectionRenderer', 'contents')
    return Array.isArray(items) ? items : []
  })
}

/** The plain video an item is; null for an ad, a Short, a channel, a playlist, a shelf or anything else. */
function plainVideoOf(item: unknown): Song | null {
  const renderer = at(item, 'videoRenderer')
  if (isObject(renderer)) {
    if (at(renderer, 'navigationEndpoint', 'reelWatchEndpoint') !== undefined) return null
    const id = renderer['videoId']
    return typeof id === 'string' && id !== '' ? { id, title: textOf(renderer['title']) } : null
  }
  const lockup = at(item, 'lockupViewModel')
  if (isObject(lockup) && lockup['contentType'] === 'LOCKUP_CONTENT_TYPE_VIDEO' && typeof lockup['contentId'] === 'string') {
    return { id: lockup['contentId'], title: textOf(at(lockup, 'metadata', 'lockupMetadataViewModel', 'title')) }
  }
  return null
}

/** The first plain video of a results page's data; null when it has none, or is no results page. */
export function pickVideo(data: unknown): Song | null {
  for (const item of resultItems(data)) {
    const song = plainVideoOf(item)
    if (song !== null) return song
  }
  return null
}

const INITIAL_DATA_HEAD = /(?:var |window\[["'])ytInitialData(?:["']\])?\s*=\s*/

/**
 * The `ytInitialData` a results page's HTML assigns, parsed; null when the
 * page carries none (a consent page, a sign-in wall). The object ends at
 * its closing brace, found outside its strings: they may hold `;` and `</`.
 */
export function initialDataOf(html: string): unknown {
  const head = INITIAL_DATA_HEAD.exec(html)
  if (head === null) return null
  return scanObject(html, head.index + head[0].length)
}

/** The JSON object starting at `start`, found by balancing braces outside strings; null when it does not parse. */
function scanObject(html: string, start: number): unknown {
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i += 1) {
    const char = html[i]
    if (inString) {
      if (char === '\\') i += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as unknown
      } catch (error) {
        reportFault('music.youtubeSearch.initialDataOf', error)
        return null
      }
    }
  }
  return null
}
