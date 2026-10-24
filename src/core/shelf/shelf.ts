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
  if (ms < HOUR) return say(Math.max(1, Math.round(ms / MINUTE)), 'minute')
  if (ms < DAY) return say(Math.round(ms / HOUR), 'hour')
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
