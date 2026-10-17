import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes a captured screenshot to disk, creating parent directories — the runner's `screenshot` verb (#324). */
export async function saveScreenshotFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}
