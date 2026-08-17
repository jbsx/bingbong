// Pure download-routing policy: filenames from the network are hostile input
// (they may carry path separators or be empty), and completed downloads must
// be announced by filename. The Electron will-download glue stays thin; these
// rules are seam-tested here.

const FALLBACK_FILENAME = 'download'

/** Strip path separators and control characters; never return an empty name. */
export function sanitizeDownloadFilename(raw: string): string {
  const cleaned = raw
    .replace(/[/\\]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned === '' ? FALLBACK_FILENAME : cleaned
}

/**
 * The download path under `dir`, de-duplicated with " (n)" before the last
 * extension so agent downloads never overwrite an existing file.
 */
export function uniqueDownloadPath(dir: string, filename: string, exists: (path: string) => boolean): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''

  for (let attempt = 0; ; attempt++) {
    const name = attempt === 0 ? filename : `${stem} (${attempt})${extension}`
    const path = `${dir}/${name}`
    if (!exists(path)) return path
  }
}

/** Spoken + displayed texts for a completed download; both name the file. */
export function downloadAnnouncements(
  filename: string,
  path: string,
): { speak: string; display: string } {
  return {
    speak: `Download complete: ${filename}`,
    display: `Downloaded "${filename}" to ${path}`,
  }
}
