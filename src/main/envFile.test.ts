import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
})
