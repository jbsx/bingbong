import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { loadEnvFile, resolveEnvFilePath } from './envFile'

const dir = mkdtempSync(join(tmpdir(), 'bingbong-envfile-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveEnvFilePath', () => {
  it('defaults to .env next to the app', () => {
    expect(resolveEnvFilePath({}, '/opt/bingbong')).toBe(join('/opt/bingbong', '.env'))
  })

  it('follows BINGBONG_ENV_FILE when set', () => {
    expect(resolveEnvFilePath({ BINGBONG_ENV_FILE: '/tmp/other-env' }, '/opt/bingbong')).toBe('/tmp/other-env')
    expect(resolveEnvFilePath({ BINGBONG_ENV_FILE: '   ' }, '/opt/bingbong')).toBe(join('/opt/bingbong', '.env'))
  })
})

describe('loadEnvFile', () => {
  it('reads and parses the file, ignoring malformed lines', () => {
    const path = join(dir, 'config.env')
    writeFileSync(path, 'ZAI_API_KEY="from-file"\nbroken line\n', 'utf8')
    expect(loadEnvFile({ BINGBONG_ENV_FILE: path }, dir)).toEqual({ ZAI_API_KEY: 'from-file' })
  })

  it('returns no config for a missing file', () => {
    expect(loadEnvFile({}, join(dir, 'does-not-exist'))).toEqual({})
  })

  it('warns on stderr when the file exists but cannot be read', () => {
    const unreadable = join(dir, 'unreadable-env')
    mkdirSync(unreadable) // a directory: present, but never readable as a file
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      expect(loadEnvFile({ BINGBONG_ENV_FILE: unreadable }, dir)).toEqual({})
      expect(write).toHaveBeenCalledTimes(1)
      expect(String(write.mock.calls[0]?.[0])).toContain(unreadable)
    } finally {
      write.mockRestore()
    }
  })
})
