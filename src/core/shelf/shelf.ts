// The Shelf (#424, CONTEXT.md): the files an upload may be offered —
// `bingbong_downloads`, where downloads and screenshots land, and the one
// folder the owner names in Settings, each read flat (not recursive: a
// guess, cheapest to reverse). Only these files' names go to the decision
// host; nothing else on the machine is read.

/** One file on the Shelf. */
export interface ShelfFile {
  readonly name: string
  readonly path: string
  /** When it was last written, epoch ms. */
  readonly modifiedMs: number
  readonly size: number
}

/** The Shelf's folders: `bingbong_downloads`, and the Settings folder when one is named and is not the same one. */
export function shelfFolders(downloads: string, settingsFolder: string): string[] {
  const bare = (folder: string): string => folder.trim().replace(/\/+$/, '')
  const named = bare(settingsFolder)
  return named === '' || named === bare(downloads) ? [downloads] : [downloads, named]
}

/** A file no upload is offered: hidden, or a download still being written. */
const isPartial = (name: string): boolean => name.startsWith('.') || /\.(crdownload|part|download)$/i.test(name)

/** The Shelf as the card offers it: newest first, the hidden and the half-downloaded left out. */
export function onShelf(files: readonly ShelfFile[]): ShelfFile[] {
  return files.filter((file) => !isPartial(file.name)).sort((a, b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name))
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How old a file is, as the card says it: `a minute old`, `2 hours old`, `9 days old`. */
function ageOf(ms: number): string {
  const say = (n: number, unit: string): string => (n <= 1 ? `a${unit === 'hour' ? 'n' : ''} ${unit} old` : `${n} ${unit}s old`)
  const minutes = Math.max(1, Math.round(ms / MINUTE))
  if (minutes < 60) return say(minutes, 'minute')
  const hours = Math.round(ms / HOUR)
  if (hours < 24) return say(hours, 'hour')
  return say(Math.round(ms / DAY), 'day')
}

/** A size as the card says it: bytes, KB or MB. */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One file's line on the Shelf ask: its name, how old it is and its size. */
export function describeShelfFile(file: ShelfFile, nowMs: number): string {
  return `${JSON.stringify(file.name)}, ${ageOf(Math.max(0, nowMs - file.modifiedMs))}, ${sizeOf(file.size)}`
}

/** A name's words, lower case, in any script. */
const nameWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')

/**
 * The folder spoken words name (#424), among the home folder's own: one
 * every word of whose path below home the words say — "documents" for
 * Documents, "the invoices in documents" for Documents/Invoices — the one
 * whose path the words say the most of, and of those the shallowest, only
 * when no other at its depth is too. The words around the name ("set the
 * upload folder to …", as Elephant's Slot held it on the gate) say nothing
 * of any path, so no list of them is kept. Null for none, or a name two
 * share; a lookup by name, as the weather city's is by the geocoder, never
 * a guess.
 */
export function folderOfWords(words: string, home: string, folders: readonly string[]): string | null {
  const said = new Set(nameWords(words))
  const below = (folder: string): string[] => folder.slice(home.length).split('/').filter((part) => part !== '')
  const inHome = folders.filter((folder) => folder.startsWith(`${home}/`))
  const pick = (wordsOf: (folder: string) => string[]): string | null | undefined => {
    const named = inHome
      .map((folder) => ({ folder, depth: below(folder).length, words: wordsOf(folder) }))
      .filter((candidate) => candidate.words.length > 0 && candidate.words.every((word) => said.has(word)))
    if (named.length === 0) return undefined
    const most = Math.max(...named.map((candidate) => candidate.words.length))
    const best = named.filter((candidate) => candidate.words.length === most)
    const depth = Math.min(...best.map((candidate) => candidate.depth))
    const shallowest = best.filter((candidate) => candidate.depth === depth)
    return shallowest.length === 1 ? shallowest[0]!.folder : null
  }
  // Its whole path below home first; failing any, its own name ("screenshots" for Pictures/Screenshots).
  const byPath = pick((folder) => below(folder).flatMap(nameWords))
  if (byPath !== undefined) return byPath
  return pick((folder) => nameWords(below(folder).at(-1) ?? '')) ?? null
}
