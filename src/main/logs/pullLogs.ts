import { mkdir, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { S3Client } from './s3Client.ts'

// `pnpm logs:pull`'s copy (#418): every object under `<machine>/` into a
// local logs dir at the same relative path, skipping a file already there at
// the same size. Each file takes its upload time as its mtime. A key with a
// `.` or `..` segment is refused: nothing lands outside the folder.

export async function pullLogs(client: S3Client, machine: string, dir: string): Promise<{ pulled: number; kept: number }> {
  const prefix = `${machine}/`
  let pulled = 0
  let kept = 0
  for (const object of await client.list(prefix)) {
    const segments = object.key.slice(prefix.length).split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`logs:pull: refusing key ${JSON.stringify(object.key)}`)
    }
    const path = join(dir, ...segments)
    const local = await stat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (local?.size === object.size) {
      kept++
      continue
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await client.get(object.key))
    await utimes(path, object.lastModified, object.lastModified)
    pulled++
  }
  return { pulled, kept }
}
