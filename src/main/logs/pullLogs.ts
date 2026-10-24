import { mkdir, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { S3Client } from './s3Client.ts'

// `pnpm logs:pull`'s copy (#418): every object under `<machine>/` into a
// local logs dir at the same relative path, skipping a file already there at
// the same size. Each file takes its upload time as its mtime.

export async function pullLogs(client: S3Client, machine: string, dir: string): Promise<{ pulled: number; kept: number }> {
  const prefix = `${machine}/`
  let pulled = 0
  let kept = 0
  for (const object of await client.list(prefix)) {
    const path = join(dir, ...object.key.slice(prefix.length).split('/'))
    const local = await stat(path).catch(() => undefined)
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
