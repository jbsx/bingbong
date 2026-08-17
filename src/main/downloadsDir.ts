import { join } from 'node:path'

export const DOWNLOADS_DIRNAME = 'bingbong_downloads'

/**
 * Where agent-initiated downloads land: `<OS downloads>/bingbong_downloads`.
 * BINGBONG_DOWNLOADS_DIR overrides it (e2e isolation, kiosk deployments).
 */
export function resolveDownloadsDir(
  env: { BINGBONG_DOWNLOADS_DIR?: string | undefined },
  appDownloadsPath: string,
): string {
  const override = typeof env.BINGBONG_DOWNLOADS_DIR === 'string' ? env.BINGBONG_DOWNLOADS_DIR.trim() : ''
  return override !== '' ? override : join(appDownloadsPath, DOWNLOADS_DIRNAME)
}
