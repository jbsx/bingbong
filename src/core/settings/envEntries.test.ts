import { describe, expect, it } from 'vitest'
import { parseDotEnv } from './dotEnv'
import { envEntries, isSecretKey, setEnvValue } from './envEntries'

const FILE = ['# Decision Model', 'TYPESAFE_API_KEY=sk-0123456789abcd', '# BINGBONG_DECISION_TIMEOUT_MS=800', '', 'export BINGBONG_DECISION_MODEL=jev-1.14.0', ''].join('\n')

describe('envEntries', () => {
  it('lists every live key, a secret by its tail only', () => {
    expect(envEntries(FILE, {})).toEqual([
      { key: 'TYPESAFE_API_KEY', value: 'abcd', secret: true, shadowed: false },
      { key: 'BINGBONG_DECISION_MODEL', value: 'jev-1.14.0', secret: false, shadowed: false },
    ])
  })

  it('marks a key the process env sets to something else', () => {
    const [, model] = envEntries(FILE, { BINGBONG_DECISION_MODEL: 'other' })
    expect(model!.shadowed).toBe(true)
    expect(envEntries(FILE, { BINGBONG_DECISION_MODEL: 'jev-1.14.0' })[1]!.shadowed).toBe(false)
  })

  it('shows no tail of a short secret', () => {
    expect(envEntries('ZAI_API_KEY=short', {})[0]!.value).toBe('')
  })
})

describe('isSecretKey', () => {
  it('reads credentials from the name, not a pointer to one', () => {
    expect(isSecretKey('TYPESAFE_API_KEY')).toBe(true)
    expect(isSecretKey('GITHUB_TOKEN')).toBe(true)
    expect(isSecretKey('BINGBONG_DECISION_API_KEY_ENV')).toBe(false)
    expect(isSecretKey('BINGBONG_DECISION_MODEL')).toBe(false)
  })
})

describe('setEnvValue', () => {
  it('replaces a key in place and keeps every comment', () => {
    const next = setEnvValue(FILE, 'BINGBONG_DECISION_MODEL', 'jev-2')
    expect(next).toBe(FILE.replace('export BINGBONG_DECISION_MODEL=jev-1.14.0', 'export BINGBONG_DECISION_MODEL=jev-2'))
  })

  it('appends a new key before the final newline', () => {
    const next = setEnvValue(FILE, 'BINGBONG_DECISION_TIMEOUT_MS', '1500')
    expect(next.endsWith('BINGBONG_DECISION_TIMEOUT_MS=1500\n')).toBe(true)
    expect(next).toContain('# BINGBONG_DECISION_TIMEOUT_MS=800')
  })

  it('removes every line for a key', () => {
    const next = setEnvValue('A=1\nB=2\nA=3\n', 'A', null)
    expect(next).toBe('B=2\n')
  })

  it('creates the file text from nothing', () => {
    expect(setEnvValue('', 'A', '1')).toBe('A=1\n')
  })

  it('quotes a value so the parser reads exactly it back', () => {
    for (const value of ['two words', 'has "quotes"', 'back\\slash', 'a#hash', 'line\nbreak', '']) {
      expect(parseDotEnv(setEnvValue('', 'A', value)).A).toBe(value)
    }
  })

  it('keeps CRLF endings', () => {
    expect(setEnvValue('A=1\r\nB=2\r\n', 'A', '9')).toBe('A=9\r\nB=2\r\n')
  })

  it('refuses a name that is not an env var', () => {
    expect(() => setEnvValue('', 'not a key', '1')).toThrow()
  })
})
