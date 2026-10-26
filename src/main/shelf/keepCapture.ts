import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** The OS clipboard as a capture writes it (#466): Electron's `clipboard`, text or an image — false for an image it cannot decode. */
export interface CaptureClipboard {
  writeText(text: string): void
  writeImage(bytes: Uint8Array): boolean
}

/** What a capture took, named: a text, or an image's bytes — with a PNG of it for the clipboard when its own type is one the clipboard cannot decode. */
export type CaptureKept = { readonly name: string; readonly text: string } | { readonly name: string; readonly bytes: Uint8Array; readonly png?: Uint8Array }

/** Keeps a capture: on the Shelf as a file, and on the clipboard; resolves to the file's path. */
export type KeepCapture = (capture: CaptureKept) => Promise<string>

/**
 * A capture's keeper (#466, ADR 0095): each capture becomes a file in the
 * Shelf's downloads folder, `bingbong_downloads` — a text with a closing
 * line break, an image as its bytes — and goes on the OS clipboard as text
 * or as an image, always both — a WebP or an AVIF (Electron reads PNG and
 * JPEG) as the PNG the page drew of it, and one it could not draw by its
 * file's path. A name already on the Shelf takes `-2`, `-3`: a capture never
 * writes over a file.
 */
export function createCaptureKeeper(folder: () => string, clipboard: CaptureClipboard): KeepCapture {
  return async (capture) => {
    const dir = folder()
    await mkdir(dir, { recursive: true })
    const ext = extname(capture.name)
    const stem = capture.name.slice(0, capture.name.length - ext.length)
    const data = 'text' in capture ? `${capture.text}\n` : capture.bytes
    for (let n = 1; ; n += 1) {
      const path = join(dir, n === 1 ? capture.name : `${stem}-${n}${ext}`)
      try {
        await writeFile(path, data, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      if ('text' in capture) clipboard.writeText(capture.text)
      else if (!clipboard.writeImage(capture.bytes) && (capture.png === undefined || !clipboard.writeImage(capture.png))) clipboard.writeText(path)
      return path
    }
  }
}
