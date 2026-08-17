import { describe, expect, it } from 'vitest'
import { resolveDownloadsDir } from './downloadsDir'

describe('resolveDownloadsDir', () => {
  it('nests under the OS downloads dir by default', () => {
    expect(resolveDownloadsDir({}, '/home/jbsx/Downloads')).toBe('/home/jbsx/Downloads/bingbong_downloads')
  })

  it('honors a BINGBONG_DOWNLOADS_DIR override', () => {
    expect(resolveDownloadsDir({ BINGBONG_DOWNLOADS_DIR: '/tmp/e2e-dl' }, '/home/jbsx/Downloads')).toBe('/tmp/e2e-dl')
  })

  it('ignores blank overrides', () => {
    expect(resolveDownloadsDir({ BINGBONG_DOWNLOADS_DIR: '   ' }, '/home/jbsx/Downloads')).toBe(
      '/home/jbsx/Downloads/bingbong_downloads',
    )
  })
})
