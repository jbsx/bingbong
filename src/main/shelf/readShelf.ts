import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { folderOfWords } from '../../core/command/appOp'
import { onShelf, type ShelfFile } from '../../core/shelf/shelf'

// The Shelf read from disk (#424): each folder flat, files only. A folder
// that cannot be read adds nothing; only these folders are ever listed.

/** The files on the Shelf now, newest first: each folder's own files, never a folder below it. */
export async function readShelf(folders: readonly string[]): Promise<ShelfFile[]> {
  const lists = await Promise.all(
    folders.map(async (folder): Promise<ShelfFile[]> => {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry): Promise<ShelfFile | null> => {
            const path = join(folder, entry.name)
            const facts = await stat(path).catch(() => null)
            return facts === null ? null : { name: entry.name, path, modifiedMs: facts.mtimeMs, size: facts.size }
          }),
      )
      return files.filter((file): file is ShelfFile => file !== null)
    }),
  )
  return onShelf(lists.flat())
}

/** The home folder's own folders and those one below them, hidden ones aside: what a spoken folder is looked for among. */
async function homeFolders(home: string): Promise<string[]> {
  const below = async (folder: string): Promise<string[]> =>
    (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => join(folder, entry.name))
  const top = await below(home)
  return [...top, ...(await Promise.all(top.map(below))).flat()]
}

/** Whether a path is a folder that exists. */
const isFolder = async (path: string): Promise<boolean> => (await stat(path).catch(() => null))?.isDirectory() === true

/**
 * The folder words name (#424): a path as written — absolute, or from `~` —
 * when it is a folder; else the one among the home folder's own their
 * words name ({@link folderOfWords}). Null for none.
 */
export async function findFolder(words: string, home = homedir()): Promise<string | null> {
  const said = words.trim()
  const path = said.startsWith('~') ? join(home, said.slice(1)) : isAbsolute(said) ? resolve(said) : null
  if (path !== null) return (await isFolder(path)) ? path.replace(/\/+$/, '') : null
  return folderOfWords(said, home, await homeFolders(home))
}
