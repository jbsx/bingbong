import { describe, expect, it } from 'vitest'
import { downloadAnnouncements, sanitizeDownloadFilename, uniqueDownloadPath } from './downloadRouting'

describe('sanitizeDownloadFilename', () => {
  it('keeps ordinary filenames untouched', () => {
    expect(sanitizeDownloadFilename('report.pdf')).toBe('report.pdf')
    expect(sanitizeDownloadFilename('my-song (remix).mp3')).toBe('my-song (remix).mp3')
  })

  it('strips path separators so a filename can never escape the downloads dir', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('etcpasswd')
    expect(sanitizeDownloadFilename('a/b\\c.zip')).toBe('abc.zip')
  })

  it('strips control characters', () => {
    expect(sanitizeDownloadFilename('bad\x00file.txt')).toBe('badfile.txt')
  })

  it('falls back when nothing usable remains', () => {
    expect(sanitizeDownloadFilename('')).toBe('download')
    expect(sanitizeDownloadFilename('..')).toBe('download')
    expect(sanitizeDownloadFilename('///')).toBe('download')
  })
})

describe('uniqueDownloadPath', () => {
  const nothingExists = (): boolean => false

  it('returns dir/filename when the path is free', () => {
    expect(uniqueDownloadPath('/dl', 'probe.bin', nothingExists)).toBe('/dl/probe.bin')
  })

  it('appends a counter before the extension on collisions', () => {
    expect(uniqueDownloadPath('/dl', 'probe.bin', (p) => p === '/dl/probe.bin')).toBe('/dl/probe (1).bin')
    expect(uniqueDownloadPath('/dl', 'probe.bin', (p) => p === '/dl/probe.bin' || p === '/dl/probe (1).bin')).toBe(
      '/dl/probe (2).bin',
    )
  })

  it('treats an extensionless name as the whole stem', () => {
    expect(uniqueDownloadPath('/dl', 'data', (p) => p === '/dl/data')).toBe('/dl/data (1)')
  })

  it('handles dotted names like .tar.gz by only splitting the last extension', () => {
    expect(uniqueDownloadPath('/dl', 'archive.tar.gz', (p) => p === '/dl/archive.tar.gz')).toBe(
      '/dl/archive.tar (1).gz',
    )
  })
})

describe('downloadAnnouncements', () => {
  it('speaks a short line with the filename and displays the full path', () => {
    const { speak, display } = downloadAnnouncements('probe.bin', '/home/u/Downloads/bingbong_downloads/probe.bin')

    expect(speak).toBe('Download complete: probe.bin')
    expect(display).toBe('Downloaded "probe.bin" to /home/u/Downloads/bingbong_downloads/probe.bin')
  })
})
